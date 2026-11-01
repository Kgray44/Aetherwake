param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ProcessId,
  [ValidateRange(1,60)][int]$Seconds = 8,
  [ValidateRange(250,2000)][int]$IntervalMs = 500,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
$samples = New-Object System.Collections.Generic.List[object]
$start = [DateTimeOffset]::UtcNow
$deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
$previous = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $now = [DateTimeOffset]::UtcNow
  $cpuSeconds = [double]$process.CPU
  $cpuOneCorePercent = $null
  if ($null -ne $previous) {
    $elapsed = ($now - $previous.time).TotalSeconds
    if ($elapsed -gt 0) { $cpuOneCorePercent = [Math]::Round(100 * ($cpuSeconds - $previous.cpu) / $elapsed, 2) }
  }
  $samples.Add([pscustomobject]@{
    utc = $now.ToString('o')
    workingSetBytes = [long]$process.WorkingSet64
    privateBytes = [long]$process.PrivateMemorySize64
    handleCount = [int]$process.HandleCount
    cumulativeCpuSeconds = [Math]::Round($cpuSeconds, 3)
    cpuOneCorePercent = $cpuOneCorePercent
  })
  $previous = @{ time = $now; cpu = $cpuSeconds }
  Start-Sleep -Milliseconds $IntervalMs
}
$result = [pscustomobject]@{
  source = 'Windows Get-Process; local sample, not GPU telemetry'
  processId = $ProcessId
  startedUtc = $start.ToString('o')
  requestedSeconds = $Seconds
  intervalMs = $IntervalMs
  samples = $samples
}
$json = $result | ConvertTo-Json -Depth 6
if ($OutFile) {
  $target = [System.IO.Path]::GetFullPath($OutFile)
  $owned = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if (-not $target.StartsWith($owned + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutFile must stay within the Tauri prototype directory.' }
  [System.IO.File]::WriteAllText($target, $json, [System.Text.Encoding]::UTF8)
  Write-Output $target
} else { Write-Output $json }
