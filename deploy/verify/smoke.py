"""End-to-end smoke test for a running ConvertLab instance.

    python3 deploy/verify/smoke.py [base-url] [env-file]

Logs in with the administrator account from the env file, converts the shipped
PDF fixtures, downloads the results and checks that the Office packages really
contain a table (w:tbl / sheet XML with borders).
"""

import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1"
ENV_FILE = sys.argv[2] if len(sys.argv) > 2 else "/opt/convertlab/.env"
FIXTURES = "/opt/convertlab/tests/fixtures"

env = {}
with open(ENV_FILE) as handle:
    for line in handle:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key] = value

cookies = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def call(path, data=None, headers=None, raw=False):
    request = urllib.request.Request(BASE + path, data=data, headers=headers or {})
    try:
        with opener.open(request, timeout=120) as response:
            body = response.read()
            return response.status, (body if raw else json.loads(body))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def upload(name, target):
    boundary = uuid.uuid4().hex
    payload = b""
    payload += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="target"\r\n\r\n{target}\r\n'
    ).encode()
    payload += (
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; '
        f'filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'
    ).encode()
    with open(f"{FIXTURES}/{name}", "rb") as handle:
        payload += handle.read() + b"\r\n"
    payload += f"--{boundary}--\r\n".encode()
    status, result = call(
        "/api/jobs",
        payload,
        {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-CSRF-Token": CSRF,
        },
    )
    if status not in (200, 201, 202):
        print(f"  upload rejected ({status}): {result}")
        return None
    return result["job"]["id"]


def wait(job_id, limit=120):
    for _ in range(limit):
        status, result = call(f"/api/jobs/{job_id}")
        job = result.get("job", result)
        if job["status"] in ("success", "partial", "failed", "cancelled"):
            return job
        time.sleep(2)
    return {"status": "timeout", "files": []}


def inspect(kind, blob):
    import io

    try:
        package = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        return "NOT_A_ZIP"
    names = package.namelist()
    if kind == "docx":
        body = package.read("word/document.xml").decode("utf-8", "replace")
        tables = body.count("<w:tbl>")
        borders = body.count("<w:tblBorders>")
        return f"tables={tables} borderBlocks={borders}"
    sheets = [n for n in names if n.startswith("xl/worksheets/sheet")]
    if not sheets:
        return "NO_SHEET"
    sheet = package.read(sheets[0]).decode("utf-8", "replace")
    return f"sheets={len(sheets)} borderElems={sheet.count('<border>')} freeze={sheet.count('pane')}"


status, login = call(
    "/api/auth/login",
    json.dumps({"email": env["ADMIN_EMAIL"], "password": env["ADMIN_PASSWORD"]}).encode(),
    {"Content-Type": "application/json"},
)
if status != 200:
    print(f"login failed ({status}): {login}")
    raise SystemExit(1)
print(f"login: ok as {login['user']['email']} ({login['user']['role']})")
CSRF = login["csrf"]

status, health = call("/api/health")
print(f"health: {health}")

CASES = [
    ("table-bordered.pdf", "docx"),
    ("table-bordered.pdf", "xlsx"),
    ("table-borderless.pdf", "docx"),
]

failures = 0
for name, target in CASES:
    job_id = upload(name, target)
    if not job_id:
        failures += 1
        continue
    job = wait(job_id)
    print(f"{name} -> {target}: {job['status']} in {len(job.get('files', []))} file(s)")
    for item in job.get("files", []):
        if item.get("status") != "success":
            print(f"  {item.get('name')}: {item.get('status')} {item.get('error')}")
            failures += 1
            continue
        code, blob = call(f"/api/jobs/{job_id}/files/{item['id']}/download", raw=True)
        print(f"  {item['name']}: http={code} bytes={len(blob)} {inspect(target, blob)}")
        if code != 200:
            failures += 1

print("SMOKE OK" if failures == 0 else f"SMOKE FAILURES={failures}")
raise SystemExit(0 if failures == 0 else 1)
