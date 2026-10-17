#!/usr/bin/env bash
# Run manually after deploying the backend, before retrying the frontend deployment.
set -Eeuo pipefail
umask 077

if (( EUID != 0 )); then
  echo 'Run: sudo bash /opt/himmelsteil-cms/setup-website-features.sh' >&2
  exit 1
fi
target=/opt/himmelsteil-cms
runner=/usr/local/sbin/himmelsteil-preview-build
for file in "$target/.env" "$target/backup.sh" "$target/setup-website-features.mjs" \
  "$target/setup-collection-navigation.mjs" "$runner"; do
  test -f "$file" || { echo "Missing $file; deploy the updated backend first." >&2; exit 1; }
done
if ! grep -Fq 'SITE_CHANNEL=$channel' "$runner"; then
  echo 'The installed preview builder is outdated; deploy the updated backend first.' >&2
  exit 1
fi

# Block the scheduled builder while statuses and permissions are migrated.
exec 9>/run/lock/himmelsteil-preview-build.lock
flock -w 300 9
cd "$target"
bash backup.sh
container_dir="/tmp/himmelsteil-website-features-$(date -u +%s)-$$"
cleanup() {
  docker compose exec -T directus rm -f -- "$container_dir/setup-website-features.mjs" \
    "$container_dir/setup-collection-navigation.mjs" || true
  docker compose exec -T directus rmdir -- "$container_dir" || true
}
docker compose exec -T directus mkdir -m 0700 "$container_dir"
trap cleanup EXIT
docker compose cp setup-website-features.mjs "directus:$container_dir/setup-website-features.mjs"
docker compose cp setup-collection-navigation.mjs "directus:$container_dir/setup-collection-navigation.mjs"
# Credentials are already in the container environment; do not copy or print them.
docker compose exec -T directus node "$container_dir/setup-website-features.mjs" --env-auth
cleanup
trap - EXIT
flock -u 9

"$runner" --dry-run
"$runner"
echo 'Directus migration and protected preview build completed. Retry the frontend workflow.'
