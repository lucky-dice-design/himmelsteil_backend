# Directus-Datenmodell

Die Website verwendet drei Startseiten-Collections, zwei Rechtstext-Collections sowie die bestehenden Collections fuer Galerie, Pakete und Blog. Listen-Collections verwenden das Directus-Feld `status` mit den Werten `draft` und `published`; der Build liest nur veroeffentlichte Listeneintraege. `home_page` ist eine Singleton ohne Statusfeld und wird erst durch einen neuen statischen Build oeffentlich.

## Rechtstexte

`legal_pages` enthaelt genau die beiden vorbereiteten Datensaetze `impressum` und `datenschutz`. Der Editor kann Status, Seitentitel und SEO-Beschreibung aendern, aber keine URL-Kennung oder Seiten anlegen. Beide Seiten starten als Entwurf. Solange eine Seite nicht veroeffentlicht ist, bleibt der bisherige statische Platzhalter auf der Vorschau bestehen.

`legal_sections` enthaelt die sortierbaren Abschnitte dieser Seiten. Jeder Abschnitt hat eine feste Seitenzuordnung, eine Ueberschrift, einen Text und einen Status. Leerzeilen im Text erzeugen Absaetze, einzelne Zeilenumbrueche einen Zeilenumbruch. HTML wird als Text ausgegeben. Nur veroeffentlichte Abschnitte einer veroeffentlichten Seite erscheinen nach dem naechsten Build. Eine veroeffentlichte Seite ohne vollstaendige Abschnitte laesst den Build fehlschlagen; die bisherige Vorschau bleibt stehen.

Die uebernommenen Texte sind **rechtlich ungepruefte Entwuerfe**. Vor dem Livegang sind Angaben zum Betreiber, zum tatsaechlichen Hosting, zu Server-Logs, eingebundenen Diensten und Kontaktwegen durch die verantwortliche Person fachlich zu pruefen. Die Editor-Rolle hat weiterhin keinen Zugriff auf Benutzer, Rollen oder Systemeinstellungen.

## Startseite

`home_page` ist eine Singleton-Collection fuer die festen Startseitenbloecke. Sie enthaelt SEO-Titel und -Beschreibung, die Texte und optional das Bild des Hero-Bereichs, den Einleitungstext sowie die Ueberschrift des Anlassbereichs. `hero_image_alt` beschreibt das Hero-Bild. Die Ziele der drei Schaltflaechen bleiben im Frontend fest: Kontakt, Galerie und Pakete.

`home_tiles` enthaelt genau drei Kacheln mit den eindeutigen Zielen `galerie`, `pakete` und `blog`. Label, Reihenfolge und optionales Bild sind editierbar; das Linkziel selbst ist fuer Editoren gesperrt. Alle drei Kacheln muessen `published` sein, damit der Build die gleichmaessige Dreierreihe erzeugt. Ohne CMS-Bild verwendet der Build vorlaeufig das vorhandene Galerie-Kachelbild.

`home_occasions` enthaelt die wiederholbaren Anlass-Kacheln mit Titel, Beschreibung, Reihenfolge und Status. Mindestens ein Eintrag muss `published` sein. `seed_key` ist nur fuer die einmalige, wiederholbar ausfuehrbare Uebernahme der vier bisherigen Anlaesse vorgesehen; Editoren bearbeiten dieses Feld nicht.

Der `Website Build`-Benutzer liest die Startseite und nur veroeffentlichte Kacheln/Anlaesse. Der `Website Editor` darf Texte und Bilder bearbeiten und Anlaesse hinzufuegen, aber keine Collections oder Berechtigungen verwalten. Bilddateien bleiben auf den Directus-Ordner `Website` beschraenkt. Das statische Frontend wird weiterhin erst bei einem neuen Build aktualisiert.

## `gallery_items`

| Feld | Typ | Hinweise |
| --- | --- | --- |
| `status` | String | Status-Interface, Standard `draft` |
| `sort` | Integer | Sortierfeld |
| `category` | String | Auswahl: `hochzeit`, `event`, `kollektion` |
| `title` | String | Pflichtfeld |
| `description` | Text | Pflichtfeld |
| `image` | File | Optionales Bild aus Directus Files |
| `image_alt` | String | Pflicht, sobald ein Bild gesetzt ist |
| `swatch_class` | String | Optional: `botanical`, `dark`, `clay`; nur ohne Bild |

## `packages`

| Feld | Typ | Hinweise |
| --- | --- | --- |
| `status` | String | Status-Interface, Standard `draft` |
| `sort` | Integer | Sortierfeld |
| `kicker` | String | Zum Beispiel `Start` oder `Beliebt` |
| `title` | String | Pflichtfeld |
| `description` | Text | Pflichtfeld |
| `features` | JSON | Repeater/Liste aus Textwerten |
| `cta_label` | String | Text des Anfrage-Links |
| `featured` | Boolean | Hebt das Paket farblich hervor |

## `posts`

| Feld | Typ | Hinweise |
| --- | --- | --- |
| `status` | String | Status-Interface, Standard `draft` |
| `title` | String | Pflichtfeld |
| `slug` | String | Pflicht und eindeutig, ohne Umlaute/Leerzeichen |
| `category` | String | Kurze Rubrik |
| `excerpt` | Text | Teaser auf der Blogübersicht |
| `meta_title` | String | Empfohlen: höchstens ca. 60 Zeichen |
| `meta_description` | Text | Empfohlen: ungefähr 140-160 Zeichen |
| `published_at` | Date | Veröffentlichungsdatum |
| `reading_minutes` | Integer | Geschätzte Lesezeit |
| `sections` | JSON | Optionales Array nach dem unten beschriebenen Format; ohne Abschnitte wird der Teaser als Artikeltext verwendet |

### Format für `sections`

Jeder Eintrag kann eines oder mehrere dieser Felder enthalten:

```json
{
  "lead": "Einleitender Absatz",
  "heading": "Zwischenüberschrift",
  "paragraphs": ["Absatz eins", "Absatz zwei"],
  "list": ["Punkt eins", "Punkt zwei"],
  "ordered_list": ["Schritt eins", "Schritt zwei"],
  "callout": "Hervorgehobener Hinweis",
  "subsections": [
    {"heading": "Unterüberschrift", "paragraph": "Text"}
  ]
}
```

## Build-Zugriff

Für den Website-Build wird ein eigener Directus-Benutzer mit ausschließlich lesendem Zugriff auf veröffentlichte Datensätze und verwendete Dateien benötigt. URL und statisches Token bleiben in der geschützten Build-Umgebung und dürfen nicht im Repository oder Frontend landen.
