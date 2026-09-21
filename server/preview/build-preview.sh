#!/usr/bin/env bash
set -Eeuo pipefail

source_dir=/opt/himmelsteil-preview-src
site_dir=/opt/himmelsteil-site
env_file=/etc/himmelsteil-preview.env
lock_file=/run/lock/himmelsteil-preview-build.lock

if [[ ${1:-} != '' && ${1:-} != '--dry-run' ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi
if (( EUID != 0 )); then
  echo 'Run as root.' >&2
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo 'Another preview build is running.'
  exit 0
fi

for file in "$source_dir/package.json" "$source_dir/scripts/build-directus-site.mjs" \
  "$source_dir/scripts/check-site.mjs" "$source_dir/content/cms-fallback.json" \
  "$source_dir/dist/index.html" "$env_file"; do
  if [[ ! -f $file ]]; then
    echo "Required file missing: $file" >&2
    exit 1
  fi
done
if [[ ! -d $site_dir ]]; then
  echo "Site directory missing: $site_dir" >&2
  exit 1
fi
if [[ $(stat -c %a "$env_file") != 600 || $(stat -c %u "$env_file") != 0 ]]; then
  echo "Set $env_file owner to root and permissions to 0600." >&2
  exit 1
fi

work_dir=$(mktemp -d /var/tmp/himmelsteil-preview.XXXXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT
cp -a "$source_dir/." "$work_dir/"

echo "$(date -u +%FT%TZ) Preview build started."
docker run --rm --pull=never --cap-drop=ALL --security-opt=no-new-privileges \
  --add-host admin.himmelsteil.de:host-gateway \
  --pids-limit=128 --env-file "$env_file" \
  --mount "type=bind,src=$work_dir,dst=/work" --workdir /work \
  node:22-alpine sh -ec '
    test -n "$DIRECTUS_URL" && test -n "$DIRECTUS_TOKEN"
    node scripts/build-directus-site.mjs
    node scripts/check-site.mjs
  '

if [[ ${1:-} == '--dry-run' ]]; then
  rsync -ani --delete --no-owner --no-group "$work_dir/dist/" "$site_dir/"
  echo 'Dry run complete; nothing published.'
  exit 0
fi

rsync -a --checksum --delay-updates --delete-delay --no-owner --no-group \
  "$work_dir/dist/" "$site_dir/"
echo "$(date -u +%FT%TZ) Preview published."
