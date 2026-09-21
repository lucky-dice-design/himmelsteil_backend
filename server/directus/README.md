# Directus auf dem IONOS VPS

Zielsystem: Ubuntu 26.04 mit Docker, 4 vCores, 8 GB RAM und 240 GB NVMe. Derselbe VPS stellt Directus unter `admin.himmelsteil.de` bereit. Die Website wird zunächst geschützt unter `preview.himmelsteil.de` ausgeliefert; `himmelsteil.de` wird erst nach der Freigabe aktiviert. GitHub ist Versionsverwaltung und Build-Prüfung, kein Hostingziel.

## Vor dem Start

- Die Neuinstallation muss vollständig abgeschlossen sein.
- Im DNS muss ein A-Record `admin.himmelsteil.de` auf die IPv4-Adresse `212.227.161.13` des VPS zeigen.
- SSH-Anmeldung mit einem Schlüssel einrichten; Passwortanmeldung anschließend deaktivieren.
- In der IONOS-Firewall nur SSH, HTTP und HTTPS freigeben. PostgreSQL und Port 8055 bleiben geschlossen.
- Den persönlichen SSH-Schlüsselzugang in einer zweiten Sitzung testen, bevor Root-Passwort-Login deaktiviert wird. Den Wartungsaccount nach den Arbeiten wieder sperren.

### SSH nach erfolgreichem Schlüsseltest härten

Nur nachdem der Login mit `PreferredAuthentications=publickey` und `PasswordAuthentication=no` für `timo` in einem neuen Fenster funktioniert hat: Die bestehende SSH-Sitzung offen lassen und `00-himmelsteil-ssh.conf` nach `/etc/ssh/sshd_config.d/` installieren. Vor dem Neuladen `sshd -t` und die effektiven Werte prüfen. Danach in einem **weiteren** Fenster erneut als `timo` anmelden. Erst wenn das gelingt, die alte Sitzung schließen.

```bash
sudo install -m 0644 -o root -g root /home/codex-maint/directus/00-himmelsteil-ssh.conf /etc/ssh/sshd_config.d/00-himmelsteil-ssh.conf
sudo sshd -t
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication) '
sudo systemctl reload ssh
```

Die erwarteten Werte sind `no`, `no`, `no`, `yes`. Die IONOS-Remotekonsole bleibt als Notfallzugang verfügbar; sie ist nicht von SSH-Loginregeln betroffen.

## Installation

Der Ordner `server/directus` liegt zunächst unter `/home/codex-maint/directus`. Kopiere ihn mit deinem persönlichen `sudo`-Zugang nach `/opt`; nur `root` und Mitglieder der Gruppe `sudo` können den Zielordner betreten, `.env` ist nur für `root` lesbar:

```bash
sudo install -d -m 0750 -o root -g sudo /opt/himmelsteil-cms
sudo cp -a /home/codex-maint/directus/. /opt/himmelsteil-cms/
sudo chown -R root:sudo /opt/himmelsteil-cms
sudo chmod 0750 /opt/himmelsteil-cms
sudo install -d -m 0755 -o root -g root /opt/himmelsteil-site
cd /opt/himmelsteil-cms
sudo bash setup-env.sh
```

Das Skript fragt nur nach der Administrator-E-Mail, generiert drei unterschiedliche Zufallswerte und zeigt das anfängliche Administrator-Passwort einmalig an. Dieses sofort im Passwortmanager sichern und niemals in Chat oder Screenshots teilen.
Vor `docker compose config` zusätzlich einen eigenen Preview-Passworthash gemäß Abschnitt "Geschützte Vorschau" in `.env` eintragen.

Konfiguration prüfen und Container starten (als `timo` mit `sudo`, da der Benutzer nicht in der Docker-Gruppe ist):

```bash
sudo docker compose config --quiet
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

`docker compose config` ohne `--quiet` nicht verwenden: Die Ausgabe enthält aufgelöste Passwörter aus `.env`.

Caddy fordert das TLS-Zertifikat automatisch an, sobald DNS auf den Server zeigt und Port 80/443 erreichbar ist. Directus ist danach unter `https://CMS-DOMAIN/admin` verfügbar.

Die Directus-Konfiguration begrenzt API-Anfragen pro IP und Dateiuploads. Der öffentliche Browser greift nicht direkt auf Directus zu; der spätere Website-Build verwendet einen separaten, lesenden Token. Der Token darf nie im statischen Verzeichnis liegen.

## Nach dem ersten Login

### Directus-12-Lizenz für eingeschränkte Leserechte

Eine neue selbst gehostete Directus-12-Instanz startet im Core-Tarif. Der Core-Tarif erlaubt keine benutzerdefinierten Permission-Filter wie `status = published` oder `folder = Website`. Ohne passende Lizenz bricht `setup-build-access.mjs` bei `POST /permissions` mit `custom_permission_rules_enabled is a restricted resource` ab. Die bereits angelegte Rolle und Policy gewähren dann **keinen** Lesezugriff; das Skript kann nach der Lizenzaktivierung erneut gestartet werden.

Directus bietet für berechtigte Einzelpersonen und kleine Organisationen einen kostenlosen [Open Innovation Grant](https://directus.com/oig) für Self-Hosting mit benutzerdefinierten Zugriffsregeln an. Die Berechtigung und Bedingungen muss die Betreiberin selbst prüfen und den Schlüssel selbst beantragen. Den Schlüssel im Directus-Adminbereich unter **Settings > License** aktivieren oder als geheime `LICENSE_KEY`-Umgebungsvariable konfigurieren. Niemals in Git, Chat oder Screenshots veröffentlichen. Erst nach angezeigter Aktivierung das Build-Zugriffsskript erneut ausführen. Keine ungeschützten oder zu breiten Leserechte als Ersatz einschalten.

1. Administrator-Passwort im Passwortmanager sichern.
2. Vor dem Datenmodell ein Backup erstellen (`sudo bash backup.sh`).
3. Die drei Collections gemäß `directus/MODEL.md` mit dem Setup-Skript anlegen:

```bash
cd /opt/himmelsteil-cms
sudo docker compose cp setup-schema.mjs directus:/tmp/setup-schema.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-schema.mjs
sudo docker compose exec directus node /tmp/setup-schema.mjs
```

Das Skript fragt die aktuellen Admin-Zugangsdaten interaktiv auf dem VPS ab; das Passwort wird dabei nicht angezeigt oder als Kommandozeilenargument gespeichert. Es kann erneut ausgeführt werden; vorhandene Collections und Felder werden übersprungen.

4. Die Collections und das Bildfeld im Data Studio prüfen.
5. Im Directus-Dateimodul einen Ordner `Website` anlegen. Nur Bilder, die auf der öffentlichen Website erscheinen sollen, dort hochladen.
6. Den eingeschränkten Build-Zugang einrichten:

```bash
cd /opt/himmelsteil-cms
sudo docker compose cp setup-build-access.mjs directus:/tmp/setup-build-access.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-build-access.mjs
sudo docker compose exec directus node /tmp/setup-build-access.mjs
```

Das Skript fragt den aktuellen Admin-Login verdeckt ab. Es erstellt eine Rolle, eine Policy mit Lesezugriff auf veröffentlichte `gallery_items`, `packages` und `posts` sowie auf Dateien im Ordner `Website`, und einen technischen Benutzer `website-build@himmelsteil.de`. Der statische Token wird nicht ausgegeben. Lese- und Schreibzugriff werden mit diesem Benutzer getestet.
Wenn ein bereits vorhandener Build-Token beim Test `401` ergibt, setzt das Skript ihn einmalig neu. Ein zuvor in einer Build-Umgebung gespeicherter Token muss danach ebenfalls aktualisiert werden.

7. Den Token später im technischen Benutzer im Directus-Adminbereich aufrufen und nur in der geschützten Build-Umgebung als `DIRECTUS_TOKEN` speichern; `DIRECTUS_URL` ist `https://admin.himmelsteil.de`. Niemals einen Admin-Token für den Website-Build verwenden oder einen Token in Chat, Screenshots oder Git speichern.

## Geschützte Vorschau

Die Compose-Datei mountet `/opt/himmelsteil-site` schreibgeschützt nach `/srv/site` im Caddy-Container. `Caddyfile` bedient Directus und die passwortgeschützte Vorschau. Die getrennte `Caddyfile.production` mit der Hauptdomain wird nur gemountet, **nicht** importiert und ist daher noch nicht aktiv.

1. Bei IONOS einen **A-Record `preview`** für `preview.himmelsteil.de` auf `212.227.161.13` setzen. `@`, `www` und sämtliche Mail-Records unverändert lassen. Die vorhandenen Ports 80/443 reichen aus.
2. Auf dem VPS einen langen, einzigartigen Preview-Passwortwert wählen und mit Caddy interaktiv hashen. Der Befehl fragt das Passwort ohne Echo ab; es erscheint nicht als Kommandozeilenargument:

```bash
cd /opt/himmelsteil-cms
sudo docker compose exec caddy caddy hash-password --algorithm argon2id
```

Den ausgegebenen Hash in `/opt/himmelsteil-cms/.env` als `PREVIEW_PASSWORD_HASH='<ausgegebener Hash>'` ergänzen. Die **einfachen Anführungszeichen** sind wichtig, weil Argon2id-Hashes Dollarzeichen enthalten. Die Datei bleibt nur für `root` lesbar. Das Klartextpasswort nur im Passwortmanager speichern, nicht in Git, Chat oder der Shell-History. Docker Compose gibt aufgelöste Werte mit `docker compose config` aus; daher ausschließlich `config --quiet` nutzen.

3. Das statische Verzeichnis auf dem VPS anlegen und das lokal gebaute `dist/` übertragen:

```bash
sudo install -d -m 0755 -o root -g root /opt/himmelsteil-site
```

Auf dem Windows-Rechner im Frontend-Ordner `npm run build` ohne `DIRECTUS_URL`/`DIRECTUS_TOKEN` ausführen. Anschließend `dist/` per `scp` in ein **neues** Verzeichnis unter `/home/timo/` kopieren, zum Beispiel `site-preview-upload-1`:

```powershell
cd "C:\Users\bmxra\Documents\ChatGPT\Himmelsteil - Anna Dahlenburg"
npm run build
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" -r .\dist "timo@212.227.161.13:/home/timo/site-preview-upload-1"
```

Auf dem VPS den Quellpfad prüfen und mit `sudo rsync -a --delete /home/timo/site-preview-upload-1/ /opt/himmelsteil-site/` veröffentlichen. `--delete` entfernt dort alte Blogseiten; das Zielverzeichnis darf deshalb ausschließlich die Website enthalten. Für spätere Uploads jeweils einen neuen Verzeichnisnamen verwenden. Falls `rsync` fehlt, zunächst `sudo apt install rsync` ausführen. Keine `.env`, Tokens, Datenbankdateien oder Backups in `dist/` legen.

4. Aus dem Backend-Repository `Caddyfile`, `Caddyfile.production` und `compose.yaml` in ein temporäres Verzeichnis auf dem VPS übertragen:

```powershell
ssh -i "$env:USERPROFILE\.ssh\himmelsteil_timo" timo@212.227.161.13 'mkdir -p /home/timo/cms-preview-config'
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" .\himmelsteil_backend\server\directus\Caddyfile .\himmelsteil_backend\server\directus\Caddyfile.production .\himmelsteil_backend\server\directus\compose.yaml "timo@212.227.161.13:/home/timo/cms-preview-config/"
```

Die bestehende Caddy- und Compose-Datei vorher sichern, dann die drei Dateien nach `/opt/himmelsteil-cms/` kopieren. `Caddyfile.production` muss vorhanden sein, weil Compose es mountet. Auf dem VPS:

```bash
sudo cp -a /opt/himmelsteil-cms/Caddyfile /opt/himmelsteil-cms/Caddyfile.before-preview
sudo cp -a /opt/himmelsteil-cms/compose.yaml /opt/himmelsteil-cms/compose.yaml.before-preview
sudo install -m 0644 -o root -g sudo /home/timo/cms-preview-config/Caddyfile /opt/himmelsteil-cms/Caddyfile
sudo install -m 0644 -o root -g sudo /home/timo/cms-preview-config/Caddyfile.production /opt/himmelsteil-cms/Caddyfile.production
sudo install -m 0644 -o root -g sudo /home/timo/cms-preview-config/compose.yaml /opt/himmelsteil-cms/compose.yaml
cd /opt/himmelsteil-cms
```

Dann vor dem Neustart prüfen:

```bash
sudo docker compose config --quiet
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose up -d
sudo docker compose ps
```

`admin.himmelsteil.de` muss anschließend weiterhin funktionieren. `https://preview.himmelsteil.de` muss ohne Zugangsdaten `401 Unauthorized` liefern und nach Eingabe von Benutzer `preview` und dem gewählten Passwort die Website anzeigen. Der Header `X-Robots-Tag: noindex, nofollow, noarchive` ergänzt den Passwortschutz. [Caddy Basic Auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth) akzeptiert nur Hashes; HTTPS wird von Caddy automatisch verwaltet.

**Noch nicht live schalten:** Die lokale Website enthält Fallback-Inhalte und Platzhalter für Impressum und Datenschutz. Erst Inhalte, Bilder/Bildrechte und Rechtstexte prüfen. Danach die Produktionsblöcke aus `Caddyfile.production` in Caddy importieren und die Web-DNS-Einträge für `@` und `www` auf den VPS richten. Den bisherigen IONOS-Default-Site-A-Record und den alten AAAA-Record für `@` entfernen beziehungsweise ersetzen, sonst können Aufrufe weiter bei IONOS landen. MX-, SPF- und DKIM-Einträge für E-Mail unverändert lassen.

Git sichert nur Quellcode und Konfiguration. PostgreSQL-Daten und Directus-Uploads benötigen weiterhin externe Backups.

Die Variablen `DIRECTUS_ADMIN_EMAIL` und `DIRECTUS_ADMIN_PASSWORD` können nach dem erfolgreichen Bootstrap aus `.env` und `compose.yaml` entfernt werden. Sie werden nur für die initiale Erstellung benötigt.

## Backups

Das Skript `backup.sh` sichert PostgreSQL und Directus-Uploads und behält lokale Sicherungen 14 Tage:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
```

Lokale Backups auf demselben VPS reichen nicht als alleinige Sicherung. Vor dem Produktivbetrieb wird zusätzlich ein verschlüsseltes externes Backup-Ziel eingerichtet.

## Aktualisierung

Directus ist absichtlich auf eine konkrete Version festgelegt. Vor einem Update zuerst ein Backup erstellen, anschließend die Versionsnummer in `compose.yaml` gezielt erhöhen:

```bash
sudo bash backup.sh
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs --tail=100 directus
```
