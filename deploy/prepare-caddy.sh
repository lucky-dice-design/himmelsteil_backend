#!/usr/bin/env bash
# One-time adoption of the existing shared Caddy config, without reloading it.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
base=$(cd "$(dirname "$0")/../server/directus" && pwd)/Caddyfile
live=/opt/himmelsteil-cms
managed=/etc/lucky-deploy
test -f "$base"
test -f "$live/Caddyfile"
test ! -e "$managed/caddy-himmelsteil.conf" || { echo 'Already prepared; refusing to replace managed state.' >&2; exit 1; }
work=$(mktemp -d /var/tmp/caddy-adopt.XXXXXXXX)
trap 'rm -rf "$work"' EXIT
cp "$base" "$work/Caddyfile"
# Only retain the production import when it is already active.
production=false
if grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/Caddyfile\.production[[:space:]]*$' "$live/Caddyfile"; then
  production=true
  printf '\nimport /etc/caddy/Caddyfile.production\n' >> "$work/Caddyfile"
fi
if [[ -f /opt/luckydicedesign/backend/Caddyfile.luckydice ]]; then
  printf '\n' >> "$work/Caddyfile"
  cat /opt/luckydicedesign/backend/Caddyfile.luckydice >> "$work/Caddyfile"
fi
# Optional root-reviewed extra blocks for a customized live config.
if [[ -f "$managed/caddy-extra.conf" ]]; then
  printf '\n' >> "$work/Caddyfile"
  cat "$managed/caddy-extra.conf" >> "$work/Caddyfile"
fi
cd "$live"
docker compose cp "$work/Caddyfile" caddy:/tmp/Caddyfile.adopt
docker compose exec -T caddy caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > "$work/current.json"
docker compose exec -T caddy caddy adapt --config /tmp/Caddyfile.adopt --adapter caddyfile > "$work/candidate.json"
python3 - "$work/current.json" "$work/candidate.json" <<'PYTHON'
import json, sys
current, candidate = [json.load(open(p)) for p in sys.argv[1:]]
if current != candidate:
    raise SystemExit('Live Caddy differs from the proposed managed config. Review custom blocks before adoption; nothing changed.')
PYTHON
install -d -m 0700 "$managed"
cp -a "$live/Caddyfile" "$managed/Caddyfile.before-adoption"
install -m 0644 "$base" "$managed/caddy-himmelsteil.conf"
if [[ ! -e "$managed/caddy-extra.conf" ]]; then install -m 0644 /dev/null "$managed/caddy-extra.conf"; fi
if [[ $production == true ]]; then touch "$managed/himmelsteil-production-enabled"; fi
echo 'Existing Caddy configuration adopted. No service was reloaded.'
