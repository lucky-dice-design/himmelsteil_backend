# Kontaktformular mit IONOS Mail Basic

Das statische Formular sendet an `/api/contact`. Caddy leitet nur diesen Pfad an den internen Dienst `contact` weiter. Der Dienst legt die Anfrage zuerst in der nicht oeffentlichen Directus-Collection `contact_requests` an und verschickt danach eine Benachrichtigung. Er hat keinen Host-Port, verwendet `info@himmelsteil.de` als Absender und Empfaenger und setzt die Besucheradresse ausschliesslich als `Reply-To`. Das verhindert eine frei waehlbare Absenderdomain und reduziert das Risiko eines offenen Mail-Relays.

IONOS Mail Basic verwendet `smtp.ionos.de` auf Port 465 mit implizitem TLS. Der Dienst akzeptiert nur die bekannten Website-Origins, JSON bis 20 KB, feste Anlasswerte und begrenzte Feldlaengen. Pro IP sind hoechstens fuenf Versuche in 30 Minuten moeglich. Ein Honeypot und eine Mindest-Ausfuellzeit bremsen einfache Bots. Es werden keine automatischen Antwortmails an Besucher versendet.

## Vorbereitungen

1. In IONOS Webmail mit `info@himmelsteil.de` anmelden und eine normale Testmail senden und empfangen.
2. Im Directus-Bereich `Rechtstexte` die Kontaktadresse im Impressum auf `info@himmelsteil.de` setzen.
3. Die Datenschutzerklaerung vor dem oeffentlichen Go-live fachlich pruefen und mindestens Formularfelder, Zweck, Rechtsgrundlage, Empfaenger/Auftragsverarbeitung, Server-Logs und Loeschfristen korrekt beschreiben. Die Repository-Texte sind nur technische Entwuerfe.
4. Vor jeder Serveraenderung `cd /opt/himmelsteil-cms && sudo bash backup.sh` ausfuehren.

Vor dem Containerstart `setup-contact-cms.mjs` im Directus-Container ausfuehren. Es erstellt `contact_form`, `contact_options`, `contact_requests`, die Editorrechte und einen getrennten technischen Benutzer. Der zugehoerige statische Token wird vom Setup-Skript als zweites Docker-Secret erzeugt und nie ausgegeben.

Das Postfachpasswort niemals in Chat, Git, einen Shell-Befehl oder die Compose-`.env` schreiben. `setup-contact-secret.sh` liest es verdeckt und legt es unter `/opt/himmelsteil-cms/secrets/contact_smtp_password` mit Modus `0600` ab.

## Installation

Die Dateien aus `server/directus` und `server/contact/setup-contact-secret.sh` zuerst in ein neues Verzeichnis unter `/home/timo/` hochladen. Auf dem VPS:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo install -m 0750 -o root -g root /home/timo/contact-release-2/setup-contact-secret.sh /usr/local/sbin/himmelsteil-contact-secret
sudo /usr/local/sbin/himmelsteil-contact-secret

sudo install -m 0640 -o root -g sudo /home/timo/contact-release-2/directus/setup-contact-cms.mjs /opt/himmelsteil-cms/setup-contact-cms.mjs
sudo docker compose cp setup-contact-cms.mjs directus:/tmp/setup-contact-cms.mjs
sudo docker compose cp secrets/contact_directus_token directus:/tmp/contact_directus_token
sudo docker compose exec -u root directus chmod 0400 /tmp/contact_directus_token
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-contact-cms.mjs
sudo docker compose exec -u root directus node /tmp/setup-contact-cms.mjs

sudo cp -a Caddyfile Caddyfile.before-contact
sudo cp -a Caddyfile.production Caddyfile.production.before-contact
sudo cp -a compose.yaml compose.yaml.before-contact
sudo install -m 0644 -o root -g sudo /home/timo/contact-release-2/directus/Caddyfile /opt/himmelsteil-cms/Caddyfile
sudo install -m 0644 -o root -g sudo /home/timo/contact-release-2/directus/Caddyfile.production /opt/himmelsteil-cms/Caddyfile.production
sudo install -m 0644 -o root -g sudo /home/timo/contact-release-2/directus/compose.yaml /opt/himmelsteil-cms/compose.yaml
sudo rsync -a --delete --exclude node_modules --no-owner --no-group /home/timo/contact-release-2/directus/contact-service/ /opt/himmelsteil-cms/contact-service/
sudo chown -R root:root /opt/himmelsteil-cms/contact-service

sudo docker compose config --quiet
sudo docker compose build --pull contact
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile.production
sudo docker compose up -d contact caddy
sudo docker compose ps
sudo docker compose exec -T contact node -e \
'fetch("http://127.0.0.1:3000/health").then(async r=>{console.log(r.status,await r.text());if(r.ok===false)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})'
```

Erwartet werden ein gesunder `contact`-Container und beim letzten Befehl HTTP 200. Directus muss weiterhin unter `admin.himmelsteil.de` antworten; die Vorschau liefert ohne Vorschau-Zugang weiterhin 401.

## Frontend aktivieren

Erst nach dem gesunden Maildienst die aktualisierten Dateien `kontakt.html`, `script.js`, `styles.css`, `index.html`, `impressum.html` und `datenschutz.html` in die VPS-Buildquelle unter `/opt/himmelsteil-preview-src/dist/` uebernehmen. Danach:

```bash
sudo /usr/local/sbin/himmelsteil-preview-build --dry-run
sudo /usr/local/sbin/himmelsteil-preview-build
```

In der passwortgeschuetzten Vorschau das Formular mit einer eigenen erreichbaren Antwortadresse absenden. Die Nachricht muss in `info@himmelsteil.de` erscheinen; Antworten muessen an die im Formular verwendete Adresse gehen. Bei Fehlern keine Passwoerter ausgeben, sondern nur folgende Diagnose verwenden:

```bash
cd /opt/himmelsteil-cms
sudo docker compose ps
sudo docker compose logs --tail=100 contact
```

Nach erfolgreichem Test Spamordner, IONOS-Anti-Spam und Postfachspeicher regelmaessig kontrollieren. Das In-Memory-Rate-Limit gilt pro laufendem Container und ist fuer dieses kleine Formular bewusst einfach gehalten. Bei anhaltendem Missbrauch spaeter einen externen CAPTCHA-/Turnstile-Dienst oder ein persistentes Reverse-Proxy-Rate-Limit ergaenzen.
