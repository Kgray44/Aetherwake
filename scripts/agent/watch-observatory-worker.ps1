param(
  [Parameter(Mandatory)][string]$RuntimeRoot,
  [Parameter(Mandatory)][string]$WorkerScript
)

$ErrorActionPreference = 'Stop'
$RuntimeRoot = (Resolve-Path -LiteralPath $RuntimeRoot).Path
$WorkerScript = (Resolve-Path -LiteralPath $WorkerScript).Path
$launcher = Join-Path $RuntimeRoot 'Launch.ps1'
$statusFile = Join-Path $RuntimeRoot 'status.json'
$watchFile = Join-Path $RuntimeRoot 'watch-status.json'
$lockFile = Join-Path $RuntimeRoot 'watch.lock'

function Set-WatchStatus([string]$State) {
  $json = @{ state = $State; checked_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($watchFile, $json)
}

function Test-WorkerRunning {
  if (!(Test-Path -LiteralPath $statusFile)) { return $false }
  # A concurrent status write should defer the check, not launch a second worker.
  $status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
  if ($status.stage -ne 'worker_running' -or !$status.pid) { return $false }
  $worker = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$status.pid)
  if (!$worker) { return $false }
  if (!$worker.CommandLine) { throw 'Worker process identity could not be verified' }
  $command = $worker.CommandLine.Replace('/', '\')
  return $command -like ('*' + [WildcardPattern]::Escape($WorkerScript) + '*') -and
    $command -like ('*' + [WildcardPattern]::Escape((Join-Path $RuntimeRoot 'config.json')) + '*')
}

$lock = [IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None')
try {
  $nextLaunch = [DateTime]::MinValue
  while ($true) {
    try {
      if (Test-WorkerRunning) {
        Set-WatchStatus 'running'
        $nextLaunch = [DateTime]::MinValue
      } elseif ([DateTime]::UtcNow -ge $nextLaunch) {
        $nextLaunch = [DateTime]::UtcNow.AddMinutes(1)
        Set-WatchStatus 'starting'
        & $launcher | Out-Null
      }
    } catch {
      Set-WatchStatus 'host_check_or_launch_failed'
    }
    Start-Sleep -Seconds 12
  }
} finally {
  $lock.Dispose()
}
