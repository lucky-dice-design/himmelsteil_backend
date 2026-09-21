$ErrorActionPreference = 'Stop'
$backupRoot = 'D:\Himmelsteil\Backups'

if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw "Backup-Ordner nicht gefunden: $backupRoot"
}

$acl = Get-Acl -LiteralPath $backupRoot
$acl.SetAccessRuleProtection($true, $false)
$identities = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
)

foreach ($identity in $identities) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
}

Set-Acl -LiteralPath $backupRoot -AclObject $acl
Write-Host "Berechtigungen eingeschraenkt: $backupRoot"
