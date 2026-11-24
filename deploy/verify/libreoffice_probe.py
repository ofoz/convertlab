"""Checks the LibreOffice path and measures time/memory on the live instance."""
import http.cookiejar, json, os, subprocess, sys, time, urllib.error, urllib.request, uuid, zipfile, io

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1"
ENV_FILE = "/opt/convertlab/.env"
env = dict(l.split("=", 1) for l in open(ENV_FILE).read().splitlines() if "=" in l and not l.startswith("#"))

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(path, data=None, headers=None, raw=False):
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {})
    try:
        with opener.open(req, timeout=600) as r:
            b = r.read()
            return r.status, (b if raw else json.loads(b))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

_, login = call("/api/auth/login", json.dumps({"email": env["ADMIN_EMAIL"], "password": env["ADMIN_PASSWORD"]}).encode(), {"Content-Type": "application/json"})
CSRF = login["csrf"]

def upload_bytes(name, blob, target):
    boundary = uuid.uuid4().hex
    p = b""
    p += f'--{boundary}\r\nContent-Disposition: form-data; name="target"\r\n\r\n{target}\r\n'.encode()
    p += f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
    p += blob + b"\r\n" + f"--{boundary}--\r\n".encode()
    st, res = call("/api/jobs", p, {"Content-Type": f"multipart/form-data; boundary={boundary}", "X-CSRF-Token": CSRF})
    return (res["job"]["id"] if "job" in res else None), st, res

def wait(job_id, limit=150):
    for _ in range(limit):
        _, res = call(f"/api/jobs/{job_id}")
        job = res.get("job", res)
        if job["status"] in ("success", "partial", "failed", "cancelled"):
            return job
        time.sleep(2)
    return {"status": "timeout", "files": []}

print("step 1: pdf -> docx (native OOXML)")
jid, st, _ = upload_bytes("table-bordered.pdf", open("/opt/convertlab/tests/fixtures/table-bordered.pdf", "rb").read(), "docx")
job = wait(jid)
print("  ", job["status"])
_, docx = call(f"/api/jobs/{jid}/files/{job['files'][0]['id']}/download", raw=True)

print("step 2: docx -> pdf (LibreOffice)")
start = time.time()
jid2, st, res = upload_bytes("probe.docx", docx, "pdf")
if not jid2:
    print("  upload failed", st, res); raise SystemExit(1)
job2 = wait(jid2)
elapsed = time.time() - start
print(f"  {job2['status']} after {elapsed:.1f}s")
for f in job2.get("files", []):
    if f["status"] == "success":
        code, blob = call(f"/api/jobs/{jid2}/files/{f['id']}/download", raw=True)
        print(f"  pdf http={code} bytes={len(blob)} magic={blob[:5]!r} note={f.get('error')}")
    else:
        print(f"  {f['status']}: {f.get('error')}")

print("step 3: xlsx styles check")
jid3, st, _ = upload_bytes("table-bordered.pdf", open("/opt/convertlab/tests/fixtures/table-bordered.pdf", "rb").read(), "xlsx")
job3 = wait(jid3)
_, xlsx = call(f"/api/jobs/{jid3}/files/{job3['files'][0]['id']}/download", raw=True)
pkg = zipfile.ZipFile(io.BytesIO(xlsx))
styles = pkg.read("xl/styles.xml").decode()
sheets = [n for n in pkg.namelist() if n.startswith("xl/worksheets/sheet")]
print("  sheets:", sheets)
print("  <border> in styles:", styles.count("<border>"), " thin borders:", styles.count('style="thin"'))
print("  workbook:", pkg.read("xl/workbook.xml").decode()[:400].split("<sheets>")[-1][:300])
