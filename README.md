# Himmelsteil Backend

Konfiguration und Dokumentation für das selbst gehostete Directus-CMS auf dem IONOS VPS. Der Quellcode für die statische Website liegt im separaten Repository `himmelsteil_frontend`.

- `server/directus/`: Docker Compose, Caddy, Einrichtung, Backups und SSH-Konfiguration
- `directus/MODEL.md`: Datenmodell für Galerie, Pakete und Blog
- `directus/SETUP.md`: Build- und Redaktionsablauf

Vorhandene VPS-Dateien werden durch einen Git-Push **nicht** automatisch aktualisiert. Änderungen an Compose oder Caddy müssen gezielt übertragen, geprüft und angewendet werden. Insbesondere vor Änderungen an Directus oder PostgreSQL zuerst ein Backup erstellen.

Dieses Repository enthält keine Passwörter, Tokens, Datenbankdaten oder Uploads. Git ersetzt kein externes Backup von PostgreSQL und Directus-Dateien.
