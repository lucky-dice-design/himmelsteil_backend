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

### Website-Editor

Fuer redaktionelle Arbeit `setup-editor-access.mjs` verwenden. Es legt die Rolle und Policy `Website Editor` mit Data-Studio-Zugang, aber ohne Admin-Rechte an. Die Rolle darf Galerie, Pakete und Blog lesen, erstellen und bearbeiten, jedoch nicht loeschen. Dateien darf sie nur im Ordner `Website` lesen, Bilddateien dort hochladen und Metadaten dort bearbeiten. Sie darf weder Benutzer/Rollen noch Projekteinstellungen verwalten. Fuer eingeschraenkte Datei-Rechte muss die passende Directus-Lizenz bereits aktiv sein.

Vorher ein Backup erstellen. Das Skript in den Directus-Container kopieren und interaktiv starten:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo install -m 0640 -o root -g sudo /home/timo/cms-editor-config/setup-editor-access.mjs /opt/himmelsteil-cms/setup-editor-access.mjs
sudo docker compose cp setup-editor-access.mjs directus:/tmp/setup-editor-access.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-editor-access.mjs
sudo docker compose exec directus node /tmp/setup-editor-access.mjs
```

Das Skript fragt Admin-Zugang, Editor-E-Mail, Namen und ein mindestens 16 Zeichen langes Editor-Passwort im Terminal ab. Passwoerter und Tokens werden nicht ausgegeben. Eine vorhandene E-Mail wird nicht veraendert. Bei einer fehlgeschlagenen Rechtepruefung wird der neu angelegte Editor gesperrt. Das Passwort nur ueber einen sicheren Kanal an den Editor weitergeben und anschliessend die Anmeldung und einen Bild-Upload im Data Studio pruefen. Kein Passwort in Chat, Git oder Shell-Argumente schreiben.

### Upload-Ordner fuer Bildfelder reparieren

Nach Einrichtung aller CMS-Collections `fix-image-upload-folders.mjs` ausfuehren. Es setzt `meta.options.folder` auf den eindeutigen Dateiordner `Website` fuer `home_page.hero_image`, `home_tiles.image`, `gallery_items.image` und `contact_form.intro_image`. Damit verwenden auch direkte Uploads im Bildfeld den vom Build lesbaren Ordner. Die Datei-Policies bleiben unveraendert.

Das Skript benoetigt einen interaktiven Admin-Login. Ohne Argument prueft es nur; mit `--apply` speichert es die Einstellungen und verschiebt bereits verknuepfte Bilder aus dem Stammverzeichnis nach `Website`. Es beruecksichtigt auch Entwuerfe, veraendert keine Bildverknuepfungen und laesst unzugeordnete Uploads unveraendert. Verknuepfte Dateien in anderen Ordnern fuehren vor den Aenderungen zum Abbruch. Nach einem Teilabbruch kann es erneut gestartet werden.

Nach Uebertragung des Skripts nach `/home/timo/` auf dem VPS:

```bash
cd /opt/himmelsteil-cms
sudo docker compose cp /home/timo/fix-image-upload-folders.mjs directus:/tmp/fix-image-upload-folders.mjs
sudo docker compose exec directus node /tmp/fix-image-upload-folders.mjs
sudo docker compose exec directus node /tmp/fix-image-upload-folders.mjs --apply
sudo /usr/local/sbin/himmelsteil-preview-build
```

Danach Directus neu laden und einen direkten Upload im Bildfeld mit dem Redaktionskonto pruefen. Der Upload muss im Ordner `Website` erscheinen und nach Speichern des Inhalts im naechsten erfolgreichen Vorschau-Build sichtbar sein. Der Prueflauf des Skripts ersetzt diesen UI-Test nicht.

### Einrichtung der Startseiten-Collections

`setup-homepage.mjs` legt `home_page` (Singleton), `home_tiles` und `home_occasions` mit den bisherigen Starttexten an. Es ergaenzt die vorhandenen Policies `Website Build` und `Website Editor`; bestehende Inhalte werden nicht ueberschrieben. Die erste Einrichtung benoetigt den Admin-Login, aber keinen Build-Token im Skript.

Das Skript kann nach einem Abbruch erneut laufen: vorhandene Collections, Felder, Verknuepfungen und Startinhalte werden erkannt. Die Singleton wird beim ersten Befuellen ueber `PATCH /items/home_page` geschrieben. Bei einer Rate-Limit-Antwort (`429`) wartet das Skript begrenzt und versucht die Anfrage erneut.

Nach einem Backup das Skript aus dem Backend-Repository nach `/home/timo/cms-home-config/` uebertragen. Auf dem VPS:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo install -m 0640 -o root -g sudo /home/timo/cms-home-config/setup-homepage.mjs /opt/himmelsteil-cms/setup-homepage.mjs
sudo docker compose cp setup-homepage.mjs directus:/tmp/setup-homepage.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-homepage.mjs
sudo docker compose exec directus node /tmp/setup-homepage.mjs
```

Danach im Directus Data Studio die drei Bereiche und die Rechte mit dem Editor-Konto pruefen. Der Hero und die Galerie-Kachel behalten bis zur Auswahl eines CMS-Bilds ihre bisherigen statischen Fotos. Ein neuer Website-Build ist erforderlich, damit Aenderungen auf `preview.himmelsteil.de` erscheinen. Die Produktionsdomain bleibt davon unberuehrt.

### Impressum und Datenschutz im CMS

`setup-legal-pages.mjs` legt die festen Seiten `impressum` und `datenschutz` sowie ihre sortierbaren Textabschnitte an. Die Seiten starten als **Entwurf**; bestehende Datensaetze werden bei erneutem Ausfuehren nicht ueberschrieben. Der Website-Build liest nur veroeffentlichte Seiten und Abschnitte. Die Editor-Rolle kann Texte und Status bearbeiten, aber keine URL-Kennung aendern, keine Rechtstext-Seite erstellen und keine Systemeinstellungen verwalten. Die Texte sind Vorlagen, keine rechtliche Freigabe.

Zuerst das Setup auf dem VPS ausfuehren, **danach** die Frontend-Buildquelle aktualisieren; sonst findet der naechste Cron-Build die neuen Collections noch nicht. Nach einem Backup das Skript aus dem Backend-Repository nach `/home/timo/cms-legal-config/` uebertragen:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo install -m 0640 -o root -g sudo /home/timo/cms-legal-config/setup-legal-pages.mjs /opt/himmelsteil-cms/setup-legal-pages.mjs
sudo docker compose cp setup-legal-pages.mjs directus:/tmp/setup-legal-pages.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-legal-pages.mjs
sudo docker compose exec directus node /tmp/setup-legal-pages.mjs
```

Danach im Data Studio die beiden Seiten und die zugehoerigen Abschnitte bearbeiten. Erst nach fachlicher Pruefung pro Seite den Status auf `Veroeffentlicht` setzen. Fuer die aktualisierte Buildquelle die Anleitung unter `server/preview/README.md` verwenden und `sudo /usr/local/sbin/himmelsteil-preview-build --dry-run` vor dem echten Lauf testen. Bis zur Veroeffentlichung bleiben die bisherigen Platzhalter auf der Vorschau sichtbar. Eine misslungene Build-Pruefung darf nicht durch breitere Rechte oder ungeschuetzte Inhalte umgangen werden.

### Status-Feld fuer den Build-Benutzer

Bei Installationen mit der ersten Version von `setup-build-access.mjs` fehlt im Leserecht fuer `gallery_items`, `packages` und `posts` das Feld `status`. Der statische Build filtert auf `status=published` und erhaelt dann `403`. `fix-build-status-access.mjs` ergaenzt ausschliesslich dieses Feld in den drei vorhandenen Build-Leserechten; der Veroeffentlichungsfilter und der technische Token bleiben unveraendert. Das Skript ist wiederholbar und stoppt bei abweichenden Rechten.

Nach einem Backup das Skript nach `/home/timo/cms-home-config/` uebertragen und auf dem VPS ausfuehren:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo install -m 0640 -o root -g sudo /home/timo/cms-home-config/fix-build-status-access.mjs /opt/himmelsteil-cms/fix-build-status-access.mjs
sudo docker compose cp fix-build-status-access.mjs directus:/tmp/fix-build-status-access.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/fix-build-status-access.mjs
sudo docker compose exec directus node /tmp/fix-build-status-access.mjs
```

## Geschützte Vorschau

Für automatische Aktualisierungen nach einer Veröffentlichung im CMS steht der fünfminütige VPS-Cronjob unter [`server/preview/README.md`](../preview/README.md). Er wird erst nach einem erfolgreichen manuellen Trockenlauf aktiviert; ein fehlgeschlagener Build lässt die bisherige Vorschau unverändert.
Die Umstellung auf extensionlose URLs und die zusätzliche VPS-Härtung stehen unter [`server/security/README.md`](../security/README.md). Die dortigen Caddy- und Directus-Dateien vor dem Austausch sichern und validieren.
Ein Kontaktformular mit Versand ueber das IONOS-Postfach ist unter [`server/contact/README.md`](../contact/README.md) dokumentiert. Das Postfachpasswort wird als separates Docker-Secret gespeichert und darf weder in `.env` noch Git landen.

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

Die Produktionskonfiguration leitet `himmelsteil.com`, `www.himmelsteil.com`
und `www.himmelsteil.de` dauerhaft (HTTP 301) auf `https://himmelsteil.de`
weiter. Pfad und Query-Parameter bleiben erhalten. Auch die `.com`-Domains
müssen im DNS auf den VPS zeigen, damit Caddy ihre HTTPS-Zertifikate beziehen
und erneuern kann. Dafür ist keine Directus-Migration erforderlich.

Git sichert nur Quellcode und Konfiguration. PostgreSQL-Daten und Directus-Uploads benötigen weiterhin externe Backups.

Die Variablen `DIRECTUS_ADMIN_EMAIL` und `DIRECTUS_ADMIN_PASSWORD` können nach dem erfolgreichen Bootstrap aus `.env` und `compose.yaml` entfernt werden. Sie werden nur für die initiale Erstellung benötigt.

## Backups

Das Skript `backup.sh` sichert PostgreSQL und Directus-Uploads und behält Sicherungen auf dem VPS 14 Tage:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
```

`backup.sh` prüft beide Archive und macht sie nur für `root` und die Gruppe `timo` lesbar. Das Leseskript `latest-backup.sh` liefert Zeitstempel und SHA-256-Prüfsummen des neuesten vollständigen Paares. Der Windows-Abruf liegt unter `scripts/Pull-HimmelsteilBackup.ps1` im Backend-Repository. Die Dateien werden standardmäßig unter `D:\Himmelsteil\Backups` gespeichert, also außerhalb beider Git-Repositories.

Die Shell-Skripte aus dem Backend-Repository auf Windows übertragen:

```powershell
ssh -i "$env:USERPROFILE\.ssh\himmelsteil_timo" timo@212.227.161.13 'mkdir -p -m 0700 /home/timo/backup-config'
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" .\server\directus\backup.sh .\server\directus\latest-backup.sh 'timo@212.227.161.13:/home/timo/backup-config/'
```

Einmalig nach der Übertragung auf dem VPS als `timo` ausführen:

```bash
sudo install -m 0750 -o root -g sudo /home/timo/backup-config/backup.sh /opt/himmelsteil-cms/backup.sh
sudo install -m 0755 -o root -g sudo /home/timo/backup-config/latest-backup.sh /opt/himmelsteil-cms/latest-backup.sh
sudo install -d -m 0750 -o root -g timo /opt/himmelsteil-cms/backups
sudo find /opt/himmelsteil-cms/backups -maxdepth 1 -type f \( -name 'database-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -exec chgrp timo {} +
sudo find /opt/himmelsteil-cms/backups -maxdepth 1 -type f \( -name 'database-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -exec chmod 0640 {} +
cd /opt/himmelsteil-cms
sudo bash backup.sh
bash latest-backup.sh
```

Danach auf Windows im Backend-Repository mit PowerShell starten:

```powershell
pwsh -NoProfile -File .\scripts\Pull-HimmelsteilBackup.ps1
```

Der Abruf verwendet den vorhandenen SSH-Schlüssel, lädt nur ein vollständiges Datenbank-/Upload-Paar und prüft beide SHA-256-Werte vor der Übernahme. Er führt **kein** `sudo` über SSH aus. Unvollständige Downloads bleiben zur Diagnose als `.partial-*` liegen und zählen nicht als Backup. Ohne regelmäßig neu erzeugte VPS-Backups kopiert der Abruf nur den letzten Stand erneut; die Automatisierung wird erst nach einem erfolgreichen manuellen Lauf eingerichtet.

Auf Windows nach dem ersten Abruf `pwsh -NoProfile -File .\scripts\Protect-BackupDirectory.ps1` ausfuehren. Das entfernt geerbte Zugriffe auf `D:\Himmelsteil\Backups` und laesst nur den aktuellen Windows-Benutzer, `SYSTEM` und lokale Administratoren zu. Vor dem Produktivbetrieb die Berechtigungen bestehender Dateien ebenfalls pruefen.

### Taegliche Sicherung

Nach einem erfolgreichen manuellen Abruf die Dateien `himmelsteil-backup.service` und `himmelsteil-backup.timer` auf den VPS nach `/home/timo/backup-config/` kopieren und als `timo` installieren:

```bash
sudo install -m 0644 -o root -g root /home/timo/backup-config/himmelsteil-backup.service /etc/systemd/system/himmelsteil-backup.service
sudo install -m 0644 -o root -g root /home/timo/backup-config/himmelsteil-backup.timer /etc/systemd/system/himmelsteil-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now himmelsteil-backup.timer
systemctl list-timers himmelsteil-backup.timer --no-pager
```

Der VPS sichert taeglich um 02:30 UTC; `Persistent=true` holt einen verpassten Lauf nach einem Neustart nach. Unter Windows im Backend-Repository `pwsh -NoProfile -File .\scripts\Install-BackupTask.ps1` ausfuehren. Der Task holt das neueste Backup taeglich um 20:00 Uhr unter dem angemeldeten Benutzer ab und holt einen verpassten Start nach. Der PC muss dafuer eingeschaltet sein und der Benutzer angemeldet sein. Der Task speichert kein Windows-Passwort und nutzt den bestehenden SSH-Schluessel. Status in der Windows-Aufgabenplanung unter `Himmelsteil Backup` beziehungsweise mit `Get-ScheduledTaskInfo -TaskName 'Himmelsteil Backup'` pruefen. Die Backup-Dateien auf `D:` werden derzeit nicht automatisch geloescht; Speicherplatz und Task-Ergebnis regelmaessig kontrollieren.

Die Sicherungen enthalten Datenbankinhalte und hochgeladene Dateien. Zugriff auf den Windows-Account und die Backup-Dateien einschränken und für Verschlüsselung von Laufwerk `D:` sorgen (z. B. BitLocker/Geräteverschlüsselung). Bei einem Verlust des PCs ist diese Kopie ebenfalls weg; für echte Ausfallsicherheit später einen zweiten, getrennten Datenträger oder ein verschlüsseltes Offsite-Ziel ergänzen. Gelegentlich einen Restore auf einem Testsystem prüfen. Keine Backups, Zugangsdaten oder `.env` nach GitHub hochladen.

## Aktualisierung

Directus ist absichtlich auf eine konkrete Version festgelegt. Vor einem Update zuerst ein Backup erstellen, anschließend die Versionsnummer in `compose.yaml` gezielt erhöhen:

```bash
sudo bash backup.sh
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs --tail=100 directus
```
