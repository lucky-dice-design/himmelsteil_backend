# Automatischer Vorschau-Build

> Nach der Erweiterung Live/Preview zusätzlich
> [WEBSITE-FEATURES.md](../../directus/WEBSITE-FEATURES.md) beachten:
> Preview enthält Live- und Preview-Einträge. `--live` baut nur Live-Einträge in
> ein separates öffentliches Verzeichnis. Die untenstehende Anleitung beschreibt
> die ursprüngliche Einrichtung nur der geschützten Vorschau.

Die Root-Cronjobs starten jede Minute den Live-Build und 30 Sekunden versetzt die
geschützte Vorschau. Nur ein erfolgreicher Build mit bestandener Strukturprüfung
ersetzt die jeweilige Ausgabe. Live verwendet `/opt/himmelsteil-live-site`, Preview
weiterhin `/opt/himmelsteil-site`. Änderungen erscheinen beim nächsten Laden nach
dem Build, normalerweise nach etwa einer Minute plus Builddauer. Geöffnete Seiten
werden nicht automatisch neu geladen. Frontend-Codeänderungen benötigen weiterhin
die aktuelle Quellkopie; der eingerichtete GitHub-Workflow übernimmt deren Deployment.

Der kurzlebige Node-Container erreicht `admin.himmelsteil.de` über Dockers `host-gateway`-Zuordnung. Das umgeht einen DNS-Fehler im Container, ohne die DNS-Konfiguration des VPS oder den Directus-Token zu ändern. Der HTTPS-Hostname und damit die Zertifikatsprüfung bleiben gleich.

## Einmalige Vorbereitung

Auf dem Windows-Rechner aus dem Frontend-Projektordner die aktuelle, lokal geprüfte Quellkopie und die Cron-Dateien in ein **neues** Upload-Verzeichnis übertragen. `dist/` ist zugleich Template und Build-Ausgabe. Keine `.env`, `.git` oder Backups übertragen.

```powershell
cd "C:\Users\bmxra\Documents\ChatGPT\Himmelsteil - Anna Dahlenburg"
npm.cmd run check
ssh -i "$env:USERPROFILE\.ssh\himmelsteil_timo" timo@212.227.161.13 'mkdir -m 0700 /home/timo/preview-cron-upload-1'
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" -r .\content .\scripts .\dist .\package.json .\himmelsteil_backend\server\preview\build-preview.sh .\himmelsteil_backend\server\preview\himmelsteil-preview.cron .\himmelsteil_backend\server\preview\himmelsteil-preview.logrotate 'timo@212.227.161.13:/home/timo/preview-cron-upload-1/'
```

Auf dem VPS als `timo` die Quelle an einen root-eigenen Ort kopieren und das Node-Image einmalig laden:

```bash
sudo docker pull node:22-alpine
sudo install -d -m 0700 -o root -g root /opt/himmelsteil-preview-src
sudo rsync -a --delete --no-owner --no-group /home/timo/preview-cron-upload-1/ /opt/himmelsteil-preview-src/
sudo chown -R root:root /opt/himmelsteil-preview-src
sudo install -m 0750 -o root -g root /home/timo/preview-cron-upload-1/build-preview.sh /usr/local/sbin/himmelsteil-preview-build
```

Den **Website-Build-Token**, nicht den Admin-Token, ausschließlich in einer root-lesbaren Datei speichern. Den Token im Directus-Adminbereich beim technischen Benutzer abrufen. Nie in Chat, Git, Shell-Argumente oder Screenshots schreiben. `DIRECTUS_FALLBACK_EMPTY=1` ist nur vorübergehend nötig, solange Galerie oder Pakete im CMS noch leer sind. Nach dem Befüllen entfernen.

```bash
sudo install -m 0600 -o root -g root /dev/null /etc/himmelsteil-preview.env
sudo nano /etc/himmelsteil-preview.env
```

Inhalt der Datei (den Platzhalter im Editor durch den echten Token ersetzen, **ohne** `Bearer`, Anführungszeichen oder Leerzeichen):

```dotenv
DIRECTUS_URL=https://admin.himmelsteil.de
DIRECTUS_TOKEN=HIER_DEN_WEBSITE_BUILD_TOKEN_EINTRAGEN
DIRECTUS_FALLBACK_EMPTY=1
```

`docker --env-file` liest diese Datei; sie gehört bewusst nicht zur Directus-Compose-`.env`. Beim erneuten Installieren die bestehende Datei nicht überschreiben.

## Test und Aktivierung

Den ersten Build zunächst ohne Veröffentlichung prüfen. Der Dry-Run zeigt, welche Dateien der anschließende Lauf hinzufügen, ändern oder entfernen würde. Besonders `--delete` darf nur ein Verzeichnis betreffen, das ausschließlich diese Website enthält.

```bash
sudo /usr/local/sbin/himmelsteil-preview-build --dry-run
sudo /usr/local/sbin/himmelsteil-preview-build
curl -I https://preview.himmelsteil.de/
```

Der letzte Befehl liefert ohne Preview-Zugangsdaten erwartungsgemäß `401`. Die Seite danach im Browser mit dem bestehenden Preview-Passwort kontrollieren. Erst nach erfolgreichem manuellen Lauf Cron und Logrotation aktivieren:

```bash
sudo install -m 0644 -o root -g root /home/timo/preview-cron-upload-1/himmelsteil-preview.cron /etc/cron.d/himmelsteil-preview
sudo install -m 0644 -o root -g root /home/timo/preview-cron-upload-1/himmelsteil-preview.logrotate /etc/logrotate.d/himmelsteil-preview
systemctl is-active cron
sudo cat /etc/cron.d/himmelsteil-preview
sudo tail -n 30 /var/log/himmelsteil-preview-build.log
```

Cron liest neue Dateien in `/etc/cron.d` automatisch ein; `cron.service` unter
Ubuntu bietet keinen Reload-Befehl. Beide Jobs laufen jede Minute. Ein `flock`
verhindert überlappende Builds und wartet bis zu 120 Sekunden, wenn die andere
Ausgabe oder ein Deployment gerade baut. Nach Ablauf wird ein Fehler protokolliert
und der Lauf schlägt fehl; der nächste Cron-Lauf versucht es erneut. Bei längeren
Builds oder Fehlern kann die Veröffentlichung entsprechend länger dauern.
Schlägt Directus oder der Build fehl, bleibt die bisherige Ausgabe erhalten;
der Fehler steht im Log. Das Node-Image wird beim Cron-Lauf nicht automatisch
aktualisiert. Nach Sicherheitsupdates `sudo docker pull node:22-alpine` bewusst
ausführen und den manuellen Build testen.

## Bestehende Live-Installation aktualisieren

Für den kürzeren Aktualisierungstakt ist keine neue Directus-Migration nötig.
Die vorhandene Live-/Preview-Einrichtung muss abgeschlossen sein. Das aktualisierte
Backend-Deployment installiert auch den Live-Cronjob, sobald Live-Seite und privater
Live-Zwischenstand vorhanden sind. Bei noch ausstehender Ersteinrichtung bleibt Live
deaktiviert. Der geschützte Einstiegspunkt `deploy/deploy.sh` muss wie in
`deploy/README.md` beschrieben einmalig root-eigen neu installiert werden;
ein Push ersetzt ihn nicht automatisch.

Bei manueller Installation die geprüften Dateien aus einem Uploadpfad verwenden:

```bash
sudo install -o root -g root -m 0750 build-preview.sh /usr/local/sbin/himmelsteil-preview-build
sudo /usr/local/sbin/himmelsteil-preview-build --live --dry-run
sudo /usr/local/sbin/himmelsteil-preview-build --live
sudo install -o root -g root -m 0644 himmelsteil-live.cron /etc/cron.d/himmelsteil-live
sudo install -o root -g root -m 0644 himmelsteil-preview.cron /etc/cron.d/himmelsteil-preview
```

Die aktualisierten Caddy-Konfigurationen über das Backend-Deployment validieren
und laden: öffentliche Dateien erhalten `Cache-Control: no-cache, max-age=0,
must-revalidate`, Preview erhält `no-store`. Danach Frontend deployen; dessen
CMS-Bilder verwenden bei geändertem Dateiinhalt eine neue Adresse.
Mit `curl -I https://himmelsteil.de/` und `curl -I https://himmelsteil.de/kontakt`
die Cache-Header prüfen. Einen Live-Text im CMS ändern und nach dem nächsten
`live published` im Build-Log beim erneuten Laden kontrollieren. Ebenso den
Austausch eines Bildes unter gleicher Directus-ID prüfen. Preview-Änderungen
dürfen weiterhin nur unter der geschützten Vorschau erscheinen.

Bei späteren Änderungen an HTML, CSS, JS oder Build-Skripten die vier Quellbestandteile erneut in ein neues Upload-Verzeichnis übertragen und mit `sudo rsync` nach `/opt/himmelsteil-preview-src/` kopieren. Danach den Dry-Run und einen manuellen Build ausführen. Änderungen an veröffentlichtem Directus-Content brauchen diesen Schritt nicht.
