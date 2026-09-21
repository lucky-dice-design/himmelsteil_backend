#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
umask 077

if [ ! -f .env ]; then
  echo "Fehler: .env fehlt." >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

docker compose exec -T database pg_dump -U directus -d directus | gzip > "$backup_dir/database-$timestamp.sql.gz"
docker run --rm -v himmelsteil-cms_directus_uploads:/source:ro -v "$(cd "$backup_dir" && pwd):/backup" alpine:3.22 tar -czf "/backup/uploads-$timestamp.tar.gz" -C /source .

find "$backup_dir" -type f -mtime +14 -delete
echo "Backup erstellt: $backup_dir ($timestamp)"
