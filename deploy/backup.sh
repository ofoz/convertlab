#!/bin/bash
# Nightly ConvertLab backup: PostgreSQL dump + the shared data volume listing.
#
#   install:  cp deploy/backup.sh /usr/local/bin/convertlab-backup && chmod +x /usr/local/bin/convertlab-backup
#   cron:     15 3 * * * /usr/local/bin/convertlab-backup >> /var/log/convertlab-backup.log 2>&1
#
# Restore instructions live in docs/backup-restore.md.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/convertlab}"
DEST="${DEST:-/var/backups/convertlab}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"
cd "$PROJECT_DIR"

# The dump is written inside the container and copied out, so the file is never
# half-written in the destination directory.
docker compose exec -T postgres pg_dump \
  -U convertlab -d convertlab --clean --if-exists --no-owner \
  | gzip -9 > "$DEST/convertlab-db-$STAMP.sql.gz"

# Uploaded and converted files are disposable (2 h TTL); only the database and
# .env are worth keeping. Copy .env so a rebuild can be reproduced.
cp -p .env "$DEST/convertlab-env-$STAMP.txt"
chmod 600 "$DEST/convertlab-env-$STAMP.txt"

find "$DEST" -type f -name 'convertlab-*' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok -> $DEST (db $(du -h "$DEST/convertlab-db-$STAMP.sql.gz" | cut -f1))"
