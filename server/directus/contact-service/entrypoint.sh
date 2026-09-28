#!/bin/sh
set -eu

copy_secret() {
  source_path=$1
  target_path=$2
  if [ ! -r "$source_path" ]; then
    echo "Required secret is missing or unreadable: $source_path" >&2
    exit 1
  fi
  install -m 0444 "$source_path" "$target_path"
}

copy_secret /run/secrets/contact_smtp_password /tmp/contact_smtp_password
copy_secret /run/secrets/contact_directus_token /tmp/contact_directus_token

export SMTP_PASSWORD_FILE=/tmp/contact_smtp_password
export DIRECTUS_TOKEN_FILE=/tmp/contact_directus_token
exec su-exec node "$@"
