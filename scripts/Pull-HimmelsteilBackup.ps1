param(
    [string]$BackupRoot = 'D:\Himmelsteil\Backups',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\himmelsteil_timo'),
    [string]$Server = '212.227.161.13'
)

$ErrorActionPreference = 'Stop'
$sshOptions = @('-i', $KeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "SSH-Schluessel nicht gefunden: $KeyPath"
}

$metadata = @(& ssh @sshOptions "timo@$Server" 'bash /opt/himmelsteil-cms/latest-backup.sh')
if ($LASTEXITCODE -ne 0 -or $metadata.Count -ne 3) {
    throw 'Backup-Metadaten konnten nicht vom VPS gelesen werden.'
}

$timestamp = $metadata[0].Trim()
$expectedDatabaseHash = $metadata[1].Trim().ToLowerInvariant()
$expectedUploadsHash = $metadata[2].Trim().ToLowerInvariant()
if ($timestamp -notmatch '^\d{8}T\d{6}Z$' -or
    $expectedDatabaseHash -notmatch '^[0-9a-f]{64}$' -or
    $expectedUploadsHash -notmatch '^[0-9a-f]{64}$') {
    throw 'Ungueltige Backup-Metadaten vom VPS.'
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$destination = Join-Path $BackupRoot $timestamp
$databaseName = "database-$timestamp.sql.gz"
$uploadsName = "uploads-$timestamp.tar.gz"

function Assert-BackupHash([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Backup-Datei fehlt: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) {
        throw "Pruefsumme stimmt nicht: $Path"
    }
}

if (Test-Path -LiteralPath $destination) {
    Assert-BackupHash (Join-Path $destination $databaseName) $expectedDatabaseHash
    Assert-BackupHash (Join-Path $destination $uploadsName) $expectedUploadsHash
    Write-Host "Backup bereits vorhanden und geprueft: $destination"
    exit 0
}

$partial = Join-Path $BackupRoot ('.partial-' + $timestamp + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $partial | Out-Null
$remoteDirectory = '/opt/himmelsteil-cms/backups'

foreach ($name in @($databaseName, $uploadsName)) {
    $remoteFile = "timo@${Server}:$remoteDirectory/$name"
    & scp @sshOptions $remoteFile $partial
    if ($LASTEXITCODE -ne 0) {
        throw "Download fehlgeschlagen. Unvollstaendige Dateien liegen in $partial"
    }
}

Assert-BackupHash (Join-Path $partial $databaseName) $expectedDatabaseHash
Assert-BackupHash (Join-Path $partial $uploadsName) $expectedUploadsHash
Move-Item -LiteralPath $partial -Destination $destination
Write-Host "Backup heruntergeladen und geprueft: $destination"
