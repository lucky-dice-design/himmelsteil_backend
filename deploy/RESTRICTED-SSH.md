# Eingeschränkter SSH-Zugang für GitHub Deployments

Diese Änderung stellt den gemeinsamen SSH-Einstieg bereit. Der aktuelle
Workflow verwendet weiterhin den bisherigen Transport. Erst nach getrennt
geprüfter Server-/Workflow-Umstellung darf der neue Zugang produktiv deployen.
Der Einstieg läuft als eigener Benutzer `github-deploy`, niemals als root.

## Grenzen dieser Änderung

Ein eingeschränkter SSH-Schlüssel begrenzt Shellzugriff, Weiterleitungen und
Uploadpfade. Er begrenzt nicht automatisch die Privilegien der vorhandenen
root-eigenen Deployment-Skripte: Diese übernehmen bislang auch ausführbaren
Code und Compose-Konfiguration aus Releases. Änderungen daran bleiben eine
privilegierte Freigabe. Eine Umstellung auf den neuen Benutzer allein behebt
diese Vertrauensgrenze nicht.

Deshalb verweigert `deploy` standardmäßig jede Ausführung. Keine bestehende
sudo-Regel und kein Produktionsworkflow wird durch das Hinzufügen dieser Dateien
aktiviert oder verändert. Die bestehende `deploy.yml` erhält nur einen Testschritt.

## Installation in getrennten Schritten

Vorher Konfiguration und Einstiegspunkte sichern und den Wartungszugang offen
halten. Der neue Benutzer benötigt keine Mitgliedschaft in `sudo` oder `docker`
und kein verwendbares Anmeldepasswort. Persönliche Wartungsschlüssel bleiben
getrennt und werden nicht in Actions verwendet.

Vorgesehene Besitzrechte:

| Pfad | Eigentümer | Modus |
| --- | --- | --- |
| `/home/github-deploy` | root:root | 0755 |
| `/home/github-deploy/.ssh` | root:root | 0755 |
| `/home/github-deploy/.ssh/authorized_keys` | root:root | 0644 |
| `/home/github-deploy/deploy-incoming` | github-deploy:github-deploy | 0700 |
| `/usr/local/libexec/lucky-deploy-ssh` | root:root | 0755 |

Zuerst die geprüfte `ssh-entrypoint.py` mit dem persönlichen Wartungszugang in
ein Staging-Verzeichnis übertragen. Fingerabdruck und SHA256-Prüfsumme der
übertragenen Dateien prüfen. Danach installiert der Administrator die Datei
als `/usr/local/libexec/lucky-deploy-ssh`. Nicht direkt aus dem Upload als root
ausführen. Die Shebang startet Python mit `-I`, damit Benutzerpfade und
Python-Umgebungsvariablen keine Module einschleusen.

Der dedizierte öffentliche Schlüssel bekommt diese Optionen in `authorized_keys`:

```text
restrict,command="/usr/local/libexec/lucky-deploy-ssh" ssh-ed25519 <PUBLIC-KEY> <COMMENT>
```

Während der Vorbereitung bleibt stattdessen `command="/usr/bin/false"` aktiv.
SSH muss `status` erlauben, aber `true`, eine Shell, SCP und SFTP ablehnen. Der
neue Transport verwendet daher bewusst keinen allgemeinen SCP-/SFTP-Zugang.

## Protokoll 1

Die Remote-Befehle werden als vollständige Zeichenfolge ohne Shell ausgewertet.
Genau ein Leerzeichen trennt Argumente; zusätzliche Tokens oder Zeilen sind
ungültig. Repository-Namen stammen aus einer festen Liste aller vier Projekte.
Revisionswerte sind 40 kleine Hexadezimalzeichen.

```text
status
upload <repository> <revision> <length> <sha256>
deploy <repository> <revision>
```

`upload` liest genau `length` Bytes aus stdin bis EOF, prüft SHA256 und ersetzt
erst anschließend atomar `deploy-incoming/<repository>/<revision>/release.tar.gz`.
Eine fehlgeschlagene Wiederholung lässt das letzte vollständige Archiv stehen.
Archive werden dabei nicht entpackt. Verzeichniszugriffe verwenden auf Linux
`O_NOFOLLOW` und Directory-Deskriptoren. Erlaubt sind maximal 256 MiB pro Upload,
1 GiB gespeicherte Uploaddateien insgesamt und 16 Revisionen pro Repository.
Alte Uploads räumt ein Administrator nach bestätigtem Deployment gezielt auf.
Ein Upload hat 120 Sekunden Zeit; Uploads und Deployments sind untereinander
serialisiert. Dies ist kein Schutz gegen jede Dienstblockade durch einen bereits
kompromittierten Schlüssel.

Der spätere Workflow sendet das erzeugte Archiv direkt über SSH-stdin; Länge
und Digest werden vorab lokal berechnet. Im Windows-Terminal keine Binärarchive
über eine textverarbeitende PowerShell-Pipeline schicken.

`deploy` ist zunächst deaktiviert. Nach Abschluss der privilegierten Prüfung
kann ein Administrator einzelne Repository-Namen zeilenweise in der root-eigenen,
nicht gruppen-/weltbeschreibbaren regulären Datei
`/etc/lucky-deploy-ssh-enabled` mit Modus 0644 freigeben. Symlinks werden abgelehnt.
Der Einstieg ruft ausschließlich den gleichnamigen installierten
`/usr/local/sbin/deploy-<repository>` über `sudo -n` mit dem validierten SHA auf.
Keine anderen sudo-Befehle werden weitergereicht; die Subprozess-Umgebung ist
fest vorgegeben. Erforderliche eng begrenzte sudo-Regeln sind gesondert zu prüfen.

Vor einer Freigabe muss `/etc/lucky-deploy.conf` auf den neuen Uploadbereich
abgestimmt, die privilegierte Verarbeitung von Releases geprüft und der Workflow
umgestellt sein. Ein syntaktisch gültiger Commit-SHA und eine vom Sender
übermittelte Prüfsumme beweisen keine GitHub-Herkunft oder Produktionsfreigabe.

## Tests und Rückweg

```bash
python3 -I -m unittest discover -s deploy -p 'test_*.py' -v
```

Die Tests verwenden lokale temporäre Dateien und keine produktiven SSH-/sudo-
Aufrufe. Protokolltests sind plattformübergreifend; POSIX-Datei-/Symlinktests
laufen auf Linux und werden unter Windows ausdrücklich übersprungen.

Bei einem Fehler den neuen Schlüssel wieder auf `command="/usr/bin/false"`
setzen. Die Freigabedatei nicht vor Ende der Prüfung anlegen. Änderungen an
bestehenden Zugängen, sudo-Regeln und Uploadpfaden sind eigene Schritte mit
gesonderter Sicherung. Persönliche SSH-Zugänge werden dabei nicht entfernt.
