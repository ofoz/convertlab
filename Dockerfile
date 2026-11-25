# syntax=docker/dockerfile:1.7
###############################################################################
# ConvertLab image
#
#   builder : installs every dependency, compiles the back-end to /app/dist/server
#             and the React front-end to /app/dist/web (served by the Node
#             process, so no separate web server is needed)
#   runtime : Node + LibreOffice + FFmpeg + Poppler + Ghostscript + CJK fonts
#             + OCRmyPDF/Tesseract and an isolated Python table reader,
#             running as an unprivileged user
#
# One image serves both roles: PROCESS_ROLE=web starts the HTTP API and
# PROCESS_ROLE=worker starts the BullMQ consumer.
###############################################################################

FROM node:24-trixie-slim AS builder
WORKDIR /app

# Dependencies are installed from the lockfile only, so the build is reproducible.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json ./
COPY scripts ./scripts
COPY src ./src
COPY web ./web
RUN npm run build

###############################################################################

FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/dist/web \
    HOME=/home/app \
    XDG_CACHE_HOME=/home/app/.cache \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHON_TABLE_BIN=/opt/convertlab-python/bin/python \
    PYTHONUNBUFFERED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

# Runtime toolchain. Keep the LibreOffice component list tight: every extra
# component adds ~100 MB to the image for no benefit to this tool.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      libreoffice-common \
      libreoffice-java-common \
      default-jre-headless \
      ffmpeg \
      poppler-utils \
      ghostscript \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
      fontconfig \
      libheif-examples \
      ocrmypdf \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-chi-sim \
      pngquant \
      unpaper \
      tini \
      ca-certificates \
      python3 \
      python3-venv \
      libglib2.0-0 \
      libgomp1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Unprivileged runtime user; LibreOffice and fontconfig need a writable HOME.
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
 && mkdir -p /home/app/.cache/fontconfig /home/app/.config /data \
 && chown -R app:app /home/app /data

# Pre-built font cache keeps the first conversion fast and avoids writing to
# /usr/share/fonts at runtime.
RUN fc-cache -f

# The table enhancer is intentionally isolated from the Node runtime.  RapidTable
# ships an ONNX SLANet Plus model and uses OpenCV/onnxruntime; a dedicated venv
# makes its dependency graph auditable and leaves the main service usable when
# an optional Python package is unavailable.  RapidTable's metadata requests the
# desktop opencv-python wheel, so install that package after the headless wheel
# with --no-deps.
COPY docker/python-requirements.txt /tmp/convertlab-python-requirements.txt
RUN python3 -m venv /opt/convertlab-python \
 && /opt/convertlab-python/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/convertlab-python/bin/pip install --no-cache-dir -r /tmp/convertlab-python-requirements.txt \
 && /opt/convertlab-python/bin/pip install --no-cache-dir --no-deps rapid-table==3.0.2 \
 && /opt/convertlab-python/bin/python - <<'PY'
import hashlib
from pathlib import Path
import pdfplumber
from rapid_table import ModelType, RapidTable, RapidTableInput

model = RapidTable(RapidTableInput(model_type=ModelType.SLANETPLUS, use_ocr=False))
model_path = Path(str(model.cfg.model_dir_or_path))
digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
expected = 'd57a942af6a2f57d6a4a0372573c696a2379bf5857c45e2ac69993f3b334514b'
if digest != expected:
    raise SystemExit(f'Unexpected SLANet Plus model checksum: {digest}')
print(f'pdfplumber {pdfplumber.__version__}; RapidTable SLANet Plus model {digest}')
PY

WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Compiled back-end and front-end. No TypeScript sources are shipped, so the
# runtime never depends on Node's type-stripping support.
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER app
VOLUME ["/data"]
EXPOSE 8080

# Only the web role serves HTTP; the worker role is healthy as soon as the
# process is alive, so the probe short-circuits there instead of reporting a
# permanently unhealthy container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "if(process.env.PROCESS_ROLE==='worker')process.exit(0);fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
