# Directus selbst hosten

Die öffentliche Website wird statisch auf dem IONOS VPS ausgeliefert. Directus läuft dort als geschütztes Redaktionssystem. GitHub dient vorerst nur der Versionsverwaltung und Build-Prüfung. Nach einer Veröffentlichung in Directus wird die Website manuell neu gebaut und auf den VPS übertragen; eine automatische Veröffentlichung kann später ergänzt werden.

Die vollständige Serverkonfiguration und Installationsanleitung liegen in `server/directus/`. Das erwartete Datenmodell steht in `directus/MODEL.md`.

## Build-Anbindung

Für einen späteren Build aus Directus diese Umgebungsvariablen setzen:

- `DIRECTUS_URL`: öffentliche CMS-Adresse `https://admin.himmelsteil.de`
- `DIRECTUS_TOKEN`: Token eines separaten, nur lesenden Build-Benutzers. Nur in der geschützten Build-Umgebung speichern, nie im Repository oder Frontend.

Ohne `DIRECTUS_URL` verwendet der Build automatisch `content/cms-fallback.json`.

Ein automatischer Veröffentlichungs-Flow ist noch nicht eingerichtet. Bis der echte Content vorliegt, bleibt der Fallback-Build aktiv.

## Redaktionsablauf

1. Inhalt als `draft` speichern.
2. Text und Bilder intern prüfen.
3. Status auf `published` setzen.
4. Website mit dem eingeschränkten Token neu bauen, prüfen und das fertige `dist/` auf den VPS übertragen. Erst danach ist die Änderung öffentlich.

Der spätere Shop bleibt davon entkoppelt und kann als separates System ergänzt werden.
