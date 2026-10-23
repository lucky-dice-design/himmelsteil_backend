# Website-Einstellungen, Galerie-Filter, Bildnachweise und Live/Preview

Diese Erweiterung wird nach allen Basismodulen eingerichtet. Sie benötigt die
bestehenden Policies `Website Build` und `Website Editor`. Kontaktanfragen und
deren Bearbeitungsstatus werden nicht geändert.

## Redaktion

- **Website → Website-Einstellungen** (`site_settings`): Markenname, zugängliche
  Beschriftungen, Header-Links und Footer-Text/-Links. Links lassen sich über
  einen Repeater beschriften, sortieren und auf interne Pfade wie `/kontakt`
  setzen. Über **Logo** (`logo`) lässt sich eine eigene Datei aus dem Ordner
  `Website` auswählen oder hochladen. **Logo-Beschreibung** (`logo_alt`) beschreibt
  das Bild; ohne Angabe wird der Markenname verwendet. Das Logo wird ohne Beschnitt
  und mit erhaltenen Proportionen im Header angezeigt. Mit **Logo auch im Footer
  anzeigen** (`show_footer_logo`) erscheint dieselbe Datei zusätzlich im Footer.
  Ohne ausgewählte Datei wird das bisherige Symbol verwendet. Änderungen gelten auf allen Seiten,
  einschließlich Blogartikeln; die aktive Navigation wird je Seite gesetzt.
- **Bild-Copyright**: Hero-Bild der Startseite, Themenkacheln, Galerie und
  Kontaktbild erhalten ein Textfeld und **Bild-Copyright anzeigen**. Der Schalter
  startet ausgeschaltet. Nur mit eingeschaltetem Schalter, einem vorhandenen Bild
  und ausgefülltem Text erscheint direkt unter dem Bild
  `<figcaption><small><i>…</i></small></figcaption>`. HTML im Text wird escaped.
- **Galerie-Filter** (`site_settings.gallery_filters`): Repeater mit Kategorie,
  Beschriftung und **Filter anzeigen**. Reihenfolge durch Umsortieren ändern;
  einzelne Buttons durch Ausschalten deaktivieren. Kategorien: Alle (`all`),
  Hochzeit (`hochzeit`), Event (`event`), Kollektion (`kollektion`). Jede Kategorie
  darf höchstens einmal vorkommen. Die Beschriftung ist frei bearbeitbar;
  Kategoriekennungen müssen zu den bestehenden Galeriearbeiten passen.
  Eine leere Liste oder ausschließlich deaktivierte Einträge blendet die Leiste
  aus. Ohne Alle-Button beginnt die Galerie weiterhin mit allen Arbeiten und ohne
  aktiven Button. Das Deaktivieren eines Buttons blendet keine Galeriearbeit aus.
  Die Filter folgen dem Live-/Preview-Status der Website-Einstellungen.
- **Veröffentlichung**: `Preview` erscheint ausschließlich in der geschützten
  Vorschau; `Live` erscheint in Vorschau und öffentlicher Ausgabe. Listen haben
  weiterhin `Entwurf`, der in beiden Ausgaben unsichtbar bleibt. Bestehende
  `published`-Einträge werden bei der Einrichtung auf `live` umgestellt; bestehende
  Entwürfe bleiben Entwürfe. Speichern mit Status Live veröffentlicht beim nächsten
  erfolgreichen Live-Build. Für eine Vorschau zuerst Preview auswählen und speichern.

Bei Listeneinträgen entfernt Preview den Eintrag aus der Live-Ausgabe; eine ältere
Live-Fassung desselben Eintrags wird nicht beibehalten. Startseite, Kontakt und
Header/Footer sind Singletons: Hier bleibt der zuletzt erfolgreich gebaute
Live-Stand erhalten, während eine neue Preview-Fassung bearbeitet wird. Dafür
muss nach der Einrichtung einmal mit deren Status Live gebaut werden. Ohne einen
solchen Zwischenstand bricht ein Live-Build ab, statt Preview-Inhalte auszugeben.

Weniger als drei sichtbare Themenkacheln sowie leere Galerie-, Paket- oder
Bloglisten sind erlaubt. Kontakt benötigt weiterhin mindestens eine sichtbare
Anlassoption; eine sichtbare Rechtstextseite benötigt vollständige sichtbare
Abschnitte. Nicht sichtbare Rechtstextseiten erhalten einen neutralen Platzhalter,
damit kein Inhalt eines vorherigen Builds stehen bleibt.

## Einmalige Umstellung auf dem VPS

### Galerie-Filter nachrüsten

Zuerst das Backend deployen und anschließend auf dem VPS ausführen:

```bash
sudo bash /opt/himmelsteil-cms/setup-website-features.sh
```

Das wiederholbare Setup ergänzt das JSON-Feld, Editor-/Build-Rechte und die
Navigation **Website → Website-Einstellungen**. Bestehende Installationen erhalten
einmalig die bisherigen vier aktiven Filter; eigene Konfigurationen und bewusst
geleerte Listen werden bei weiteren Läufen beibehalten. Andere Website-Inhalte
bleiben erhalten. Danach das neue Frontend deployen. Alte private Live-Zwischenstände
ohne Filterfeld verwenden bis zum nächsten Live-Stand die bisherigen vier Filter.

Prüfen: Beschriftung ändern, Reihenfolge tauschen, einen Filter deaktivieren und
alle deaktivieren. In der jeweiligen Ausgabe dürfen nur die gewünschten Buttons
erscheinen; Arbeiten deaktivierter Kategorien bleiben in der Gesamtansicht sichtbar.
Preview-Änderungen dürfen die Live-Filter erst nach Freigabe ersetzen.

### Logo-Felder nachrüsten

Zuerst den aktualisierten Backend-Branch nach `main` übernehmen und dessen
Deployment abwarten. Anschließend auf dem VPS
`sudo bash /opt/himmelsteil-cms/setup-website-features.sh` erneut ausführen:
Das wiederholbare Setup ergänzt die drei Logo-Felder, die Datei-Relation und die
Build-/Editor-Feldrechte; bestehende Einstellungen und Logos bleiben erhalten.
Danach erst die neue Frontend-Version nach `main` übernehmen/deployen, da sie die
neuen Felder liest. Logo-Änderungen folgen dem vorhandenen Live-/Preview-Status
von `site_settings`; die Live-Ausgabe behält bei Preview den letzten Live-Stand.

### Frontend-Deployment meldet `site_settings: 403`

Der neue Frontend-Build benötigt die Migration; ein Push führt sie nicht automatisch
aus. `Preview build started` gefolgt von `Lade live-Inhalte` zeigt zusätzlich einen
alten installierten Vorschau-Runner an. Zuerst den aktuellen Backend-Branch nach
`main` übernehmen und dessen erfolgreichen Deployment-Workflow abwarten. Dieser
stellt die Setup-Dateien bereit und installiert den neuen Preview-Runner.

Anschließend auf dem VPS ausführen:

```bash
sudo bash /opt/himmelsteil-cms/setup-website-features.sh
```

Der Befehl sperrt laufende/geplante Builds während der Migration, erstellt mit dem
bestehenden Verfahren ein Backup, fragt im interaktiven Terminal nach dem aktuellen
Directus-Admin-Zugang (Passwort verdeckt) und richtet Collections/Felder/Leserechte ein.
Danach prüft und baut er die geschützte Vorschau. Er aktiviert keinen öffentlichen
Live-Cronjob. Bei Fehlern abbrechen und die Meldung prüfen; den Frontend-Workflow
erst nach erfolgreichem Abschluss erneut starten.

### Vollständige Ersteinrichtung

Wenn die Hauptdomain nach einer bereits erfolgten Webroot-Umstellung HTTP 404
liefert, zuerst die Directus-Migration erfolgreich abschließen und anschließend
den ersten Live-Build ausführen:

```bash
sudo install -d -m 0755 -o root -g root /opt/himmelsteil-live-site
sudo /usr/local/sbin/himmelsteil-preview-build --live
curl -I https://himmelsteil.de/
```

Scheitert der Live-Build, dessen Fehlermeldung beheben; keine Preview-Dateien in
das öffentliche Verzeichnis kopieren. Startseite, Kontakt und Header/Footer müssen
beim ersten Live-Build auf Live stehen. Nach erfolgreicher Ausgabe `live published`
ist bei einer bereits aktiven `/srv/live-site`-Konfiguration kein Caddy-Neustart nötig.
Der korrigierte Backend-Deployment-Einstiegspunkt behält bei einer noch ausstehenden
Ersteinrichtung den installierten Produktions-Webroot bei, bis `index.html` und
der private Live-Zwischenstand vorhanden sind. Den Einstiegspunkt dafür nach dem
üblichen Verfahren root-eigen aktualisieren; ein GitHub-Push ersetzt ihn nicht.

Bei HTTP 429 wartet das Setup mindestens eine Minute, berücksichtigt längere
`Retry-After`-Angaben und meldet die Pause im Terminal. Die Directus-Ratenbegrenzung
bleibt aktiv. Nach einem abgebrochenen Lauf kann dasselbe Setup erneut ausgeführt
werden; vorhandene Inhalte werden nicht neu angelegt oder überschrieben.

1. Datenbank/Uploads mit dem bestehenden Backup-Verfahren sichern. Den bisherigen
   Vorschau-Cronjob während der Schema- und Quellumstellung vorübergehend aussetzen.
   Das Skript erweitert Feldrechte und den Lesefilter des Build-Kontos um Preview;
   es bleibt ausschließlich lesend. Der Build-Token bleibt serverseitig.
2. Neue Backend-Dateien bereitstellen und im Directus-Verzeichnis das neue Skript
   ausführen, mit interaktiver Admin-Anmeldung:

   ```bash
   node setup-website-features.mjs
   ```

   Der Host-Runner erwartet Directus unter `http://127.0.0.1:8055`, wie die bisherigen
   Setup-Skripte. Wenn dieser Port nur im Container erreichbar ist, beide Skripte
   `setup-website-features.mjs` und `setup-collection-navigation.mjs` in denselben
   Containerordner kopieren und dort mit `docker compose exec directus node …`
   interaktiv ausführen. Nicht `exec -T` verwenden: Die sichere Passwortabfrage
   benötigt ein Terminal. Der optionale Modus `--env-auth` nutzt die Container-
   Variablen `ADMIN_EMAIL` und `ADMIN_PASSWORD`; diese sind Bootstrap-Einstellungen
   und können nach einer Passwortänderung veraltet sein (HTTP 401).

   Das Skript ist wiederholbar: vorhandene Inhalte, Linklisten und Copyright-Texte
   bleiben erhalten. Alte Basisskripte, die Statusrechte auf `published` zurücksetzen,
   nach dieser Migration nicht erneut ausführen, ohne anschließend die Erweiterung
   erneut anzuwenden.
3. Neue Frontend-Quellen nach `/opt/himmelsteil-preview-src` übertragen und den
   aktualisierten `server/preview/build-preview.sh` root-eigen als
   `/usr/local/sbin/himmelsteil-preview-build` installieren. Die bestehende
   `/etc/himmelsteil-preview.env` mit dem Build-Token beibehalten.
4. Getrenntes öffentliches Verzeichnis anlegen, dann beide Builds prüfen. Zuerst
   Startseite, Kontakt und Header/Footer auf Live belassen:

   ```bash
   sudo install -d -m 0755 -o root -g root /opt/himmelsteil-live-site
   sudo /usr/local/sbin/himmelsteil-preview-build --dry-run
   sudo /usr/local/sbin/himmelsteil-preview-build
   sudo /usr/local/sbin/himmelsteil-preview-build --live --dry-run
   sudo /usr/local/sbin/himmelsteil-preview-build --live
   ```

   Preview verwendet weiterhin `/opt/himmelsteil-site`; Live verwendet ausschließlich
   `/opt/himmelsteil-live-site`. Der Live-Zwischenstand liegt root-lesbar unter
   `/var/lib/himmelsteil-publication/live-singletons.json`. In die Sicherung aufnehmen;
   er wird für Preview-Fassungen der Singletons benötigt. Dry-Runs aktualisieren ihn
   nicht. Eine fehlgeschlagene Build-/Strukturprüfung veröffentlicht keine Ausgabe.
   Die Übergangsoption `DIRECTUS_FALLBACK_EMPTY=1` wirkt nur in Preview; Live erhält
   niemals Beispielinhalte als Ersatz für eine leere CMS-Liste.
5. Die aktualisierte Compose-Datei bindet zusätzlich `/opt/himmelsteil-live-site`
   unter `/srv/live-site` ein. Nach vorhandenem Verfahren Compose-Konfiguration
   anwenden/Caddy neu erstellen, Konfiguration validieren und laden. Die öffentliche
   `Caddyfile.production` zeigt jetzt auf `/srv/live-site`; die Preview-Konfiguration
   mit Passwortschutz und `noindex` bleibt auf `/srv/site`. Den vorhandenen Import
   der Produktionskonfiguration nur bei bereits freigegebener Hauptdomain aktivieren.
6. Nach Kontrolle beide Crondateien installieren bzw. den Preview-Cronjob wieder
   aktivieren. `himmelsteil-live.cron` startet Live jede Minute;
   `himmelsteil-preview.cron` startet Preview 30 Sekunden versetzt. Beide teilen sich
   dieselbe Sperre und warten bei Belegung bis zu 120 Sekunden. Die neue Live-Crondatei erst nach dem erfolgreichen initialen Live-Build
   installieren. Die bestehende Logrotation deckt beide Ausgaben ab.

   ```bash
   sudo install -m 0644 -o root -g root himmelsteil-live.cron /etc/cron.d/himmelsteil-live
   ```

Der Frontend-Deployment-Einstiegspunkt baut nach der initialen Live-Einrichtung
ebenfalls beide Ausgaben. Auch dessen aktualisierte `deploy/deploy.sh` wie üblich
nach Prüfung root-eigen installieren. Ein reiner Upload installiert die geschützten
Server-Einstiegspunkte nicht automatisch.

## Lokal prüfen

`npm run test:home` prüft CMS-Texte und Link-Sicherheit, Bildnachweise,
Preview-Isolation, Entfernen alter Blog-/Rechtstextinhalte sowie den Live-Zwischenstand.
Ohne Directus baut `npm run build` weiterhin aus den lokalen Beispieldaten.

Im Backend:

```bash
node --test server/directus/setup-website-features.test.mjs server/directus/setup-collection-navigation.test.mjs
```
