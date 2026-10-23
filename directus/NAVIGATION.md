# Collection-Navigation

`server/directus/setup-collection-navigation.mjs` ordnet die vorhandenen
Collections im Directus Data Studio. Technische Collection-Namen, Inhalte,
Felder, Beziehungen und Berechtigungen bleiben erhalten.

| Gruppe (Icon) | Collections mit Anzeigenamen (Icon) |
| --- | --- |
| Website (`web`) | `site_settings`: Website-Einstellungen (`web`), gemeinsamer Header/Footer und Betriebsdaten |
| Startseite (`home`) | `home_page`: Startseiten-Inhalte (`home`); `home_tiles`: Themenkacheln (`dashboard`); `home_occasions`: Anlässe (`celebration`) |
| Galerie (`photo_library`) | `gallery_page`: Galerie-Seite (`web`), einschließlich Galerie-Filter; `gallery_items`: Galeriearbeiten (`photo_library`) |
| Pakete (`inventory_2`) | `packages_page`: Pakete-Seite (`web`); `packages`: Papeterie-Pakete (`inventory_2`) |
| Blog (`article`) | `blog_page`: Blog-Seite & Artikelbeschriftungen (`web`); `posts`: Blogartikel (`article`) |
| Kontakt & Anfragen (`contact_mail`) | `contact_requests`: Eingegangene Anfragen (`inbox`); `contact_form`: Kontaktformular (`contact_mail`); `contact_options`: Anlass-Auswahl (`list_alt`) |
| Rechtliches (`gavel`) | `legal_pages`: Impressum & Datenschutz (`policy`); `legal_sections`: Rechtstext-Abschnitte (`segment`) |

Die Gruppen sind virtuelle Folder-Collections mit `schema: null`, keine neuen
Inhaltstabellen. Das Skript setzt ausschließlich Icons, Navigationsgruppen,
Reihenfolgen sowie Anzeigenamen für `de-DE` und `en-US`. Andere Übersetzungen
und vorhandene Singular-/Pluralangaben bleiben erhalten. Die deutschen Namen
werden auch bei englischer Studio-Sprache angezeigt.

Neue Gruppen starten aufgeklappt. Bei bestehenden Gruppen bleiben Aufklappzustand,
Farbe und Sichtbarkeit erhalten. Bestehende Collections behalten insbesondere
`hidden`, `singleton`, `sort_field`, Notizen und weitere Metadaten. Ein Editor sieht
weiterhin nur die Collections, für die seine bestehenden Rechte gelten.

## Bestehende VPS-Installation aktualisieren

Der GitHub-Workflow überträgt das Skript, führt diesen interaktiven Schritt aber
nicht automatisch aus. Dafür wird der aktuelle Admin-Login benötigt; Bootstrap-
Passwörter aus einer alten `.env` können inzwischen veraltet sein. Der Vorgang
benötigt keine zusätzlichen GitHub-Secrets.

Zuerst die neue Datei nach `/opt/himmelsteil-cms/setup-collection-navigation.mjs`
übertragen oder den eingerichteten Backend-Workflow ausführen. Für ein manuelles
Upload-Verzeichnis beispielsweise:

```bash
sudo install -m 0644 -o root -g root \
  /home/timo/cms-navigation-upload/setup-collection-navigation.mjs \
  /opt/himmelsteil-cms/setup-collection-navigation.mjs
```

Dann auf dem VPS zuerst sichern und die Vorschau ausführen:

```bash
cd /opt/himmelsteil-cms
sudo bash backup.sh
sudo docker compose cp setup-collection-navigation.mjs directus:/tmp/setup-collection-navigation.mjs
sudo docker compose exec -u root directus chmod 0644 /tmp/setup-collection-navigation.mjs
sudo docker compose exec directus node /tmp/setup-collection-navigation.mjs --dry-run
```

Die Vorschau meldet die vorgesehenen Änderungen, schreibt jedoch keine Metadaten.
Danach mit demselben aktuellen Admin-Zugang anwenden:

```bash
sudo docker compose exec directus node /tmp/setup-collection-navigation.mjs
```

Anschließend das Data Studio neu laden und die Navigation auch mit dem
Editor-Konto prüfen. Website-Build und Container-Neustart sind dafür nicht nötig.
Die Gruppierung nach der Einrichtung zusätzlicher Inhaltsmodule erneut ausführen.
Fehlende Collections werden gemeldet und übersprungen; leere Gruppen werden nicht
angelegt. Falls ein reservierter `nav_*`-Gruppenname bereits eine Datentabelle
bezeichnet, stoppt das Skript vor den ersten Änderungen.

Bei einem API-Fehler können bereits einzelne Metadatenänderungen angewendet sein.
Ein erneuter Lauf setzt den Vorgang fort und überspringt bereits passende Werte.

## Prüfen

```bash
node --test server/directus/setup-collection-navigation.test.mjs
```

Die Tests prüfen Metadatenerhalt, wiederholte Ausführung, Vorschau ohne
Schreibzugriffe, Namenskonflikte und die vollständige Zuordnung der vorhandenen
Collections. Sie laufen auch im Backend-Workflow.

Directus beschreibt diese reinen Navigationsordner in der
[Collection-Dokumentation](https://docs.directus.io/app/data-model/collections)
und `schema: null` in der
[Collections-API](https://docs.directus.io/reference/system/collections).
