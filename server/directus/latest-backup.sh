#!/usr/bin/env bash
set -euo pipefail

backup_dir="$(dirname "$0")/backups"
latest=""

for database in "$backup_dir"/database-*.sql.gz; do
  [ -f "$database" ] || continue
  timestamp="${database##*/database-}"
  timestamp="${timestamp%.sql.gz}"
  [[ "$timestamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  [ -f "$backup_dir/uploads-$timestamp.tar.gz" ] || continue
  if [[ "$timestamp" > "$latest" ]]; then
    latest="$timestamp"
  fi
done

if [ -z "$latest" ]; then
  echo "Kein vollstaendiges Backup gefunden." >&2
  exit 1
fi

database="$backup_dir/database-$latest.sql.gz"
uploads="$backup_dir/uploads-$latest.tar.gz"
printf '%s\n' "$latest"
sha256sum "$database" "$uploads" | cut -d ' ' -f 1
