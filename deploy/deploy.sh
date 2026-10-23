#!/usr/bin/env bash
# Installed root-owned on the VPS; never execute a script from the upload as root.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run using the installed sudo entrypoint.' >&2; exit 1; }
revision=${1:-}
[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full Git commit SHA.' >&2; exit 1; }
# This root-owned file contains only DEPLOY_HOME=/home/<deployment-user>.
source /etc/lucky-deploy.conf
: "${DEPLOY_HOME:?Missing DEPLOY_HOME}"
archive="$DEPLOY_HOME/deploy-incoming/himmelsteil_backend/$revision/release.tar.gz"
test -f "$archive"
exec 9>/run/lock/lucky-vps-deploy.lock
flock -w 900 9
work=$(mktemp -d /var/tmp/himmelsteil_backend.XXXXXXXX)
trap 'rm -rf -- "$work"' EXIT
# Copy first: subsequent extraction is from a root-owned, stable archive.
cp "$archive" "$work/release.tar.gz"
mkdir "$work/source"
# git archive produces regular files; reject links and traversal before extraction.
python3 - "$work/release.tar.gz" "$work/source" <<'PYTHON'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1]) as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Release contains an unsafe archive member')
    archive.extractall(sys.argv[2], filter='data')
PYTHON
src="$work/source"
# Abort before any update if the competing host service has been re-enabled.
if systemctl is-active --quiet caddy.service || systemctl is-enabled --quiet caddy.service; then
  echo 'Host caddy.service must be disabled and stopped; Docker Caddy owns ports 80/443.' >&2
  exit 1
fi
snapshot=/var/backups/lucky-deploy/himmelsteil_backend/$(date -u +%Y%m%dT%H%M%S)-$revision
install -d -m 0700 "$snapshot"
echo "Backup directory: $snapshot"
trap 'status=$?; echo "Deployment failed (exit $status); backup directory: $snapshot" >&2; exit "$status"' ERR
# Caddy is shared by both projects. Root-owned activation files preserve the
# reviewed live domain state and any extra site blocks across both deployments.
test -f /etc/lucky-deploy/caddy-himmelsteil.conf
test -f /etc/lucky-deploy/caddy-extra.conf
assemble_caddy() {
  cat "${1:-/etc/lucky-deploy/caddy-himmelsteil.conf}"
  if [[ -f /etc/lucky-deploy/himmelsteil-production-enabled ]]; then
    printf '\nimport /etc/caddy/Caddyfile.production\n'
  fi
  local lucky_file=${2:-/opt/luckydicedesign/backend/Caddyfile.luckydice}
  if [[ -f $lucky_file ]]; then
    printf '\n'
    cat "$lucky_file"
  fi
  printf '\n'
  cat /etc/lucky-deploy/caddy-extra.conf
}
# Do not silently upgrade the database engine or Directus during code deployment.
# Image changes require an explicit migration with a verified backup first.
check_images() {
  local target=$1 compose=$2
  docker compose --project-directory "$target" -f "$target/compose.yaml" config --format json > "$work/old-compose.json"
  docker compose --project-directory "$target" -f "$compose" config --format json > "$work/new-compose.json"
  python3 - "$work/old-compose.json" "$work/new-compose.json" <<'PYTHON'
import json, sys
old, new = [json.load(open(p))['services'] for p in sys.argv[1:]]
for service in ('database', 'directus', 'luckydice-cms'):
    if service in old and old[service].get('image') != new.get(service, {}).get('image'):
        raise SystemExit(f'{service}: image change requires a manual migration')
PYTHON
  rm "$work/old-compose.json" "$work/new-compose.json"
}
target=/opt/himmelsteil-cms
test -f "$target/.env"
check_images "$target" "$src/server/directus/compose.yaml"
tar --exclude=./backups -czf "$snapshot/config.tar.gz" -C "$target" .
cp -a /etc/lucky-deploy "$snapshot/caddy-management"
# An already public site must keep its current root until the separate Live build
# has produced both a checked page and its private singleton state.
production_config="$work/Caddyfile.production"
cp "$src/server/directus/Caddyfile.production" "$production_config"
if [[ -f /etc/lucky-deploy/himmelsteil-production-enabled ]] && \
   { [[ ! -s /opt/himmelsteil-live-site/index.html ]] || \
     [[ ! -s /var/lib/himmelsteil-publication/live-singletons.json ]]; }; then
  test -s "$target/Caddyfile.production"
  cp "$target/Caddyfile.production" "$production_config"
  echo 'Initial Live build is not ready; preserving the installed public webroot.'
fi
# Validate the whole candidate before replacing any installed files.
stage="$work/candidate"
mkdir "$stage"
rsync -a --exclude='backups/' "$target/" "$stage/"
rsync -a --exclude='.env' --exclude='secrets/' --exclude='backups/' "$src/server/directus/" "$stage/"
install -m 0644 "$production_config" "$stage/Caddyfile.production"
assemble_caddy "$src/server/directus/Caddyfile" > "$stage/Caddyfile"
docker compose --project-name himmelsteil-cms --project-directory "$stage" config --quiet
docker compose --project-name himmelsteil-cms --project-directory "$stage" run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Run the known installed backup script before replacing backend files.
(cd "$target" && bash backup.sh)
rsync -a --chown=root:root --exclude='.env' --exclude='secrets/' --exclude='backups/' "$src/server/directus/" "$target/"
install -m 0644 "$production_config" "$target/Caddyfile.production"
install -m 0644 "$src/server/directus/Caddyfile" /etc/lucky-deploy/caddy-himmelsteil.conf
assemble_caddy > "$target/Caddyfile"
cd "$target"
docker compose config --quiet
# A one-off container validates exactly the new mounted configs and env values.
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose build contact
docker compose up -d --wait --wait-timeout 180
# Recreate Caddy explicitly: replacing bind-mounted config files can retain old inodes.
docker compose up -d --no-deps --force-recreate caddy
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec -T contact node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker compose exec -T directus node -e "fetch('http://127.0.0.1:8055/server/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Update an already configured preview job; do not create its credentials or source.
test -f /etc/himmelsteil-preview.env
test -d /opt/himmelsteil-preview-src
install -m 0750 "$src/server/preview/build-preview.sh" /usr/local/sbin/himmelsteil-preview-build
install -m 0644 "$src/server/preview/himmelsteil-preview.cron" /etc/cron.d/himmelsteil-preview
if [[ -s /opt/himmelsteil-live-site/index.html && \
      -s /var/lib/himmelsteil-publication/live-singletons.json ]]; then
  install -m 0644 "$src/server/preview/himmelsteil-live.cron" /etc/cron.d/himmelsteil-live
fi
install -m 0644 "$src/server/preview/himmelsteil-preview.logrotate" /etc/logrotate.d/himmelsteil-preview
install -m 0750 "$src/server/directus/backup.sh" "$target/backup.sh"
# Test the shared proxy and both CMS backends, including TLS and host routing.
for domain in admin.himmelsteil.de admin.luckydicedesign.de; do
  result=$(curl --silent --show-error --fail --retry 8 --retry-connrefused --retry-delay 2 --max-time 10 \
    --resolve "$domain:443:127.0.0.1" "https://$domain/server/ping")
  [[ $result == pong ]] || { echo "CMS probe failed: $domain" >&2; exit 1; }
done
printf '%s\n' "$revision" > "$target/.deployed-revision"
echo "Himmelsteil backend deployed: $revision; config backup: $snapshot"
# Interactive CMS schema/access setup scripts are deployed but never auto-executed.
