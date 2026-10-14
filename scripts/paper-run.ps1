# Paper-run supervisor: runs the capital system and restarts it after a crash.
#
#   npm run paper
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\paper-run.ps1
#
# Exit code 0 from the system (Ctrl+C or another clean stop) ends the supervisor.
# Exit code 3 (another copy already holds the database lock) ends it too.
# Any other exit counts as a crash. The system is restarted after 15s, 30s,
# 60s and so on, up to 5 minutes. After MaxCrashesPerHour crashes within one
# hour the supervisor stops and sends a Telegram alert.
#
# Supervisor events are written as JSON lines to logs\supervisor.log.
param(
  [int]$MaxCrashesPerHour = 5
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'supervisor.log'

function Write-Log([string]$level, [string]$msg, [hashtable]$extra = @{}) {
  $entry = [ordered]@{ time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); level = $level; mod = 'SUPERVISOR'; msg = $msg }
  foreach ($k in $extra.Keys) { $entry[$k] = $extra[$k] }
  Add-Content -Path $logFile -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
  Write-Host ('[{0}] SUPERVISOR {1}: {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level.ToUpper(), $msg)
}

function Send-Telegram([string]$text) {
  try {
    & node --env-file-if-exists=.env src/tools/notify.js $text | Out-Null
  } catch {
    Write-Log 'error' 'Telegram notify failed' @{ err = $_.Exception.Message }
  }
}

$crashes = @()
Write-Log 'info' 'Supervisor started' @{ pid = $PID; maxCrashesPerHour = $MaxCrashesPerHour }

while ($true) {
  $started = Get-Date
  & node --env-file-if-exists=.env src/index.js run
  $code = $LASTEXITCODE
  $ranForS = [int]((Get-Date) - $started).TotalSeconds

  if ($code -eq 0) {
    Write-Log 'info' 'System stopped cleanly; supervisor exiting' @{ ranForS = $ranForS }
    break
  }
  if ($code -eq 3) {
    Write-Log 'warn' 'Another copy is already running; supervisor exiting' @{ ranForS = $ranForS }
    break
  }

  $now = Get-Date
  $crashes = @($crashes | Where-Object { $_ -gt $now.AddHours(-1) }) + $now
  if ($crashes.Count -ge $MaxCrashesPerHour) {
    Write-Log 'error' 'Too many crashes within an hour; not restarting' @{ exitCode = $code; crashesLastHour = $crashes.Count }
    Send-Telegram "Capital system crashed $($crashes.Count) times within an hour (last exit code $code). The supervisor has stopped restarting it. Check logs/errors.log and logs/supervisor.log."
    break
  }

  $delayS = [int][Math]::Min(300, 15 * [Math]::Pow(2, $crashes.Count - 1))
  Write-Log 'error' 'System exited unexpectedly; restarting' @{ exitCode = $code; ranForS = $ranForS; crashesLastHour = $crashes.Count; restartInS = $delayS }
  Start-Sleep -Seconds $delayS
}
