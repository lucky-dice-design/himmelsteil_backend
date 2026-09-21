$ErrorActionPreference = 'Stop'

$taskName = 'Himmelsteil Backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "Task '$taskName' existiert bereits. Bitte erst die Konfiguration pruefen."
}

$pullScript = Join-Path $PSScriptRoot 'Pull-HimmelsteilBackup.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $pullScript)
$trigger = New-ScheduledTaskTrigger -Daily -At '20:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Holt das neueste Directus-Backup vom VPS nach D:\Himmelsteil\Backups.' | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
