#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
umask 077

if [[ -e .env ]]; then
  echo "Abbruch: .env existiert bereits." >&2
  exit 1
fi

read -r -p "Directus-Administrator-E-Mail: " admin_email
if [[ ! "$admin_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Abbruch: Die E-Mail-Adresse ist ungueltig." >&2
  exit 1
fi

directus_secret="$(openssl rand -hex 48)"
postgres_password="$(openssl rand -hex 48)"
admin_password="$(openssl rand -hex 24)"

{
  printf 'DIRECTUS_DOMAIN=admin.himmelsteil.de\n'
  printf 'DIRECTUS_SECRET=%s\n' "$directus_secret"
  printf 'DIRECTUS_ADMIN_EMAIL=%s\n' "$admin_email"
  printf 'DIRECTUS_ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
} > .env

echo "Die Datei .env wurde mit Rechten 600 erstellt."
printf 'Einmaliges Directus-Administrator-Passwort (jetzt im Passwortmanager speichern): %s\n' "$admin_password"
echo "Dieses Passwort und den Inhalt von .env niemals in Chat, Screenshots oder Tickets teilen."
