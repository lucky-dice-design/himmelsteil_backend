# VPS-Schutz und saubere URLs

Stand: Die Vorschau ist per Caddy Basic Auth geschützt und SSH akzeptiert nur Schlüssel. UFW ist auf dem VPS **inaktiv**; nicht blind aktivieren. Auf dem Host lauschen nur SSH (22), HTTP (80) und HTTPS (443). PostgreSQL und Directus haben keine veröffentlichten Docker-Ports. Diese Anleitung ergänzt zeitweilige SSH-IP-Sperren mit `nftables` und begrenzt Directus-Anfragen pro echter Client-IP. Sie ist kein Ersatz für Updates, Backups und starke Kontopasswörter.

## Dateien übertragen

Die Dateien aus beiden Repositories in ein neues privates Upload-Verzeichnis übertragen. Nur Website-Quellen, niemals `.env`, Token, Datenbank oder Backups kopieren:

```powershell
cd "C:\Users\bmxra\Documents\ChatGPT\Himmelsteil - Anna Dahlenburg"
npm.cmd run check
npm.cmd run test:home
ssh -i "$env:USERPROFILE\.ssh\himmelsteil_timo" timo@212.227.161.13 'mkdir -m 0700 /home/timo/site-hardening-1; mkdir -m 0700 /home/timo/site-hardening-1/source /home/timo/site-hardening-1/config'
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" -r .\content .\scripts .\dist .\package.json 'timo@212.227.161.13:/home/timo/site-hardening-1/source/'
scp -i "$env:USERPROFILE\.ssh\himmelsteil_timo" .\himmelsteil_backend\server\directus\Caddyfile .\himmelsteil_backend\server\directus\Caddyfile.production .\himmelsteil_backend\server\directus\compose.yaml .\himmelsteil_backend\server\security\himmelsteil-sshd.local 'timo@212.227.161.13:/home/timo/site-hardening-1/config/'
```

## Caddy und Directus

Auf dem VPS als `timo` zuerst die bisherigen Dateien sichern. `compose.yaml` enthält keine neuen Secrets; die bestehende `/opt/himmelsteil-cms/.env` wird nicht geändert. Der Versionsstand von Directus und alle Volumes bleiben erhalten.

```bash
sudo cp -a /opt/himmelsteil-cms/Caddyfile /opt/himmelsteil-cms/Caddyfile.before-hardening
sudo cp -a /opt/himmelsteil-cms/Caddyfile.production /opt/himmelsteil-cms/Caddyfile.production.before-hardening
sudo cp -a /opt/himmelsteil-cms/compose.yaml /opt/himmelsteil-cms/compose.yaml.before-hardening
sudo cp /home/timo/site-hardening-1/config/Caddyfile /opt/himmelsteil-cms/Caddyfile
sudo cp /home/timo/site-hardening-1/config/Caddyfile.production /opt/himmelsteil-cms/Caddyfile.production
sudo cp /home/timo/site-hardening-1/config/compose.yaml /opt/himmelsteil-cms/compose.yaml
cd /opt/himmelsteil-cms
sudo docker compose config --quiet
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile.production
```

Erst wenn alle Prüfungen ohne Fehler enden, Caddy und Directus neu laden:

```bash
sudo docker compose up -d --no-deps --force-recreate directus caddy
sudo docker compose ps
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.himmelsteil.de/server/ping
curl -I https://preview.himmelsteil.de/
```

`admin` soll `200` liefern, die passwortgeschützte Vorschau ohne Zugangsdaten `401`. Zusätzlich die Anmeldung im Directus-Browser testen. Caddy ignoriert fremde `X-Forwarded-For`-Header; Directus vertraut jetzt genau einem Proxy-Hop (`IP_TRUST_PROXY=1`), sodass sein Rate-Limit pro Besucher-IP statt für alle Besucher gemeinsam gilt. Das Limit ist `120` API-Anfragen pro `60` Sekunden und der Login wird mindestens eine Sekunde verzögert. Falls legitime Redaktion dadurch `429` erhält, Limit im Repository gezielt anpassen und Directus neu erstellen. Keine pauschale `IP_TRUST_PROXY=true`-Freigabe verwenden.

Die Caddy-Konfiguration liefert `/galerie` aus `galerie.html` und leitet alte URLs wie `/galerie.html` per `308` auf `/galerie` um. `/index.html` führt nach `/`. Unbekannte Routen bleiben `404`, Assets behalten ihre Dateiendungen. Die Vorschau-Authentifizierung bleibt vor allen Routen aktiv.

## Website-Quelle aktualisieren

Erst nach erfolgreichem Caddy-Test die Quelle des laufenden Cron-Builds ersetzen. `--delete` betrifft ausschließlich die dafür angelegte Quellkopie, nicht Directus oder Backups.

```bash
sudo cp -a /opt/himmelsteil-preview-src /opt/himmelsteil-preview-src.before-clean-urls
sudo rsync -a --delete --no-owner --no-group /home/timo/site-hardening-1/source/ /opt/himmelsteil-preview-src/
sudo chown -R root:root /opt/himmelsteil-preview-src
sudo /usr/local/sbin/himmelsteil-preview-build --dry-run
sudo /usr/local/sbin/himmelsteil-preview-build
```

Mit dem vorhandenen Preview-Passwort im Browser `/`, `/galerie`, `/pakete`, `/blog`, `/blog-test` und `/kontakt` prüfen. `/galerie.html` sollte auf `/galerie` umleiten. Der öffentliche Produktions-Caddyfile bleibt weiterhin **nicht importiert**; die Hauptdomain wird durch diese Schritte nicht live geschaltet. Der Cronjob baut danach alle fünf Minuten mit der neuen Quelle.

## SSH-IP-Sperren

Vorher eine zweite SSH-Sitzung und die IONOS-Remotekonsole als Rückweg bereithalten. Die bestehende Verbindung nicht schließen. UFW bleibt unverändert aus; Fail2ban verwendet eine eigene `nftables`-Regel für SSH/22. Sie sperrt wiederholte fehlgeschlagene SSH-Anmeldungen für eine Stunde, nicht erfolgreiche Logins und nicht HTTP-Besucher. Die IONOS-Firewall bleibt die äußere Portbegrenzung.

```bash
command -v nft
sudo apt update
sudo apt install fail2ban python3-systemd
test -f /etc/fail2ban/action.d/nftables.conf
sudo install -m 0644 -o root -g root /home/timo/site-hardening-1/config/himmelsteil-sshd.local /etc/fail2ban/jail.d/himmelsteil-sshd.local
sudo fail2ban-client -t
sudo systemctl restart fail2ban
systemctl is-active fail2ban
sudo fail2ban-client status sshd
```

Ubuntu aktiviert und startet den Dienst bereits beim Paketinstallieren. Der Neustart lädt die danach installierte Jail-Datei. Danach aus **einem neuen Terminal** die SSH-Anmeldung mit dem bestehenden Schlüssel testen. Bei versehentlicher Sperre über die IONOS-Remotekonsole `sudo fail2ban-client set sshd unbanip DEINE_IP` ausführen. Die IP vorher über einen vertrauenswürdigen Weg ermitteln; nicht pauschal alle Sperren löschen.

Für spätere Updates: zuerst Backup, dann OS- und Container-Updates geplant einspielen und Directus-Release-Notes prüfen. Die IONOS-Firewall sollte öffentlich nur SSH/22, HTTP/80 und HTTPS/443 zulassen. SSH kann später bei stabiler eigener IP zusätzlich im IONOS-Panel auf diese IP eingeschränkt werden. Eine zusätzliche Host-Firewall ist ein eigener, sorgfältig zu testender Schritt; Docker-Portweiterleitungen und SSH-Zugang vor einer UFW-Aktivierung gesondert prüfen. Keine Portregeln ändern, bevor ein zweiter Zugang getestet wurde.
