# Directus-Datenmodell

Die Website erwartet drei Collections. Alle Collections verwenden das Directus-Feld `status` mit den Werten `draft` und `published`. Der Build liest ausschließlich veröffentlichte Einträge.

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
| `sections` | JSON | Repeater nach dem unten beschriebenen Format |

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
