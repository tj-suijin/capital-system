# Registers (or removes) a Windows scheduled task that starts the paper-run
# supervisor in a console window when you log on.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove
#
# Windows may require an elevated (Run as administrator) PowerShell to
# register a logon trigger. The task only runs after you log on, so an
# automatic Windows Update reboot stops the run until the next logon.
param(
  [switch]$Remove,
  [string]$TaskName = 'CapitalSystemPaperRun'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task ${TaskName}."
  return
}

$script   = Join-Path $root 'scripts\paper-run.ps1'
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$script`"" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Capital system paper run: starts scripts\paper-run.ps1 at logon.' -Force | Out-Null

Write-Host "Registered scheduled task ${TaskName}. It starts the paper-run supervisor at logon."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove it with:     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove"
