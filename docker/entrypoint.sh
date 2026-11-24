#!/bin/sh
# Small role switch so a single image can run both compose services.
set -eu

# Mark the data directory as private even when a bind mount is used.
if [ -d "${DATA_DIR:-/data}" ]; then
  chmod 0700 "${DATA_DIR:-/data}" 2>/dev/null || true
fi

# LibreOffice and fontconfig must be able to write into HOME.
mkdir -p "${HOME}/.cache/fontconfig" "${HOME}/.config" 2>/dev/null || true

case "${PROCESS_ROLE:-all}" in
  web|all)
    exec node dist/server/index.js
    ;;
  worker)
    exec node dist/server/worker-main.js
    ;;
  *)
    echo "convertlab: unknown PROCESS_ROLE='${PROCESS_ROLE}' (expected all, web or worker)" >&2
    exit 64
    ;;
esac
