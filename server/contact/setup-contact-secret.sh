#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  echo "Run with sudo." >&2
  exit 1
fi

read -r -s -p "IONOS-Passwort fuer info@himmelsteil.de: " password
printf '\n'
read -r -s -p "Passwort wiederholen: " confirmation
printf '\n'

if [[ -z $password || $password != "$confirmation" ]]; then
  echo "Die Passwoerter sind leer oder stimmen nicht ueberein." >&2
  exit 1
fi

install -d -m 0700 -o root -g root /opt/himmelsteil-cms/secrets
umask 077
temporary=$(mktemp /opt/himmelsteil-cms/secrets/.contact_smtp_password.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
printf '%s' "$password" > "$temporary"
install -m 0600 -o root -g root "$temporary" /opt/himmelsteil-cms/secrets/contact_smtp_password

if [[ ! -s /opt/himmelsteil-cms/secrets/contact_directus_token ]]; then
  token_temporary=$(mktemp /opt/himmelsteil-cms/secrets/.contact_directus_token.XXXXXX)
  openssl rand -hex 32 > "$token_temporary"
  install -m 0600 -o root -g root "$token_temporary" /opt/himmelsteil-cms/secrets/contact_directus_token
  rm -f -- "$token_temporary"
fi

unset password confirmation
echo "SMTP-Secret und interner Directus-Token gespeichert. Die Werte wurden nicht ausgegeben."
