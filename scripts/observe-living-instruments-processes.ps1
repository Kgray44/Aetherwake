param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$RootPid,
  [Parameter(Mandatory=$true)][string]$ExpectedExecutablePath,
  [Parameter(Mandatory=$true)][string]$ExpectedStartTimeUtc,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [ValidateRange(1,90)][int]$DurationSeconds = 75,
  [ValidateRange(1000,90000)][int]$IntervalMs = 1000,
  [ValidateSet('electron','node')][string]$ExpectedProcessName = 'electron',
  [switch]$AllowNodeSmoke
)
$ErrorActionPreference = 'Stop'
if ($ExpectedProcessName -eq 'node' -and -not $AllowNodeSmoke) { throw 'Node is permitted only for the explicit owned smoke test.' }
foreach ($candidate in @($ExpectedExecutablePath, $OutputPath)) { if ($candidate -notmatch '^[A-Za-z]:\\') { throw 'An absolute local drive path is required.' } }
$outputFile = [IO.Path]::GetFullPath($OutputPath)
$evidenceDirectory = [IO.Path]::GetDirectoryName($outputFile)
$profileDirectory = [IO.Path]::GetDirectoryName($evidenceDirectory)
$allowedBase = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Aerynth'))
if ([IO.Path]::GetFileName($evidenceDirectory) -ne 'living-instruments-evidence' -or
    [IO.Path]::GetFileName($profileDirectory) -notmatch '^review-living-instruments-\d+$' -or
    -not [string]::Equals([IO.Path]::GetDirectoryName($profileDirectory), $allowedBase, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($outputFile) -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.json$') { throw 'Output must be inside an existing private Living Instruments evidence directory.' }
foreach ($directory in @($allowedBase, $profileDirectory, $evidenceDirectory)) {
  $item = Get-Item -LiteralPath $directory -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Evidence directories must exist and cannot be reparse points.' }
}
if (Test-Path -LiteralPath $outputFile) { throw 'Output already exists; evidence is never overwritten.' }
$expectedPath = (Resolve-Path -LiteralPath $ExpectedExecutablePath).ProviderPath
if ([IO.Path]::GetFileNameWithoutExtension($expectedPath) -ine $ExpectedProcessName) { throw 'Expected executable and process name must agree.' }
$expectedStart = [DateTime]::Parse($ExpectedStartTimeUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
$rootProcess = Get-Process -Id $RootPid
if ($rootProcess.StartTime.ToUniversalTime().Ticks -ne $expectedStart.Ticks -or $rootProcess.ProcessName -ine $ExpectedProcessName -or
    -not [string]::Equals([IO.Path]::GetFullPath($rootProcess.MainModule.FileName), [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)) { throw 'Root PID, creation time, process name and executable identity must match the caller-owned process.' }
$rootProcess.Dispose()
$reserve = & (Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1') -EstimatedCBytes 4194304 -EstimatedDBytes 0 | ConvertFrom-Json
if (-not $reserve.allowed) { throw 'Storage reserve admission was denied.' }
$logicalProcessors = [Environment]::ProcessorCount
$watch = [Diagnostics.Stopwatch]::StartNew()
$samples = New-Object 'Collections.Generic.List[object]'
$previous = @{}
$stopReason = 'duration-complete'
$stopSampling = $false
$encoding = New-Object Text.UTF8Encoding($false)
$receipt = [ordered]@{
  contract = 'aerynth.living-instruments-process-observer@1'; startedAtUtc = [DateTime]::UtcNow.ToString('o')
  root = [ordered]@{ pid=$RootPid; startedAtUtc=$expectedStart.ToString('o'); executable=$expectedPath; expectedName=$ExpectedProcessName; smoke=[bool]$AllowNodeSmoke }
  requestedDurationSeconds=$DurationSeconds; intervalMs=$IntervalMs; logicalProcessorCount=$logicalProcessors
  limits=[ordered]@{ maxSamples=91; maxProcessesPerSample=64; maxJsonBytes=1048576; estimatedAllocationBytes=4194304 }
  reserve=$reserve; samples=$samples
  interpretation=@(
    'CPU uses .NET TotalProcessorTime deltas divided by actual elapsed monotonic sample time, multiplied by 100; one-core percent can exceed 100.'
    'Normalized CPU divides one-core percent by Environment.ProcessorCount, the logical processor count visible to this observer.'
    'Working sets and private bytes are per-process snapshots. Their sums are not unique physical RAM; shared pages may be counted repeatedly.'
    'Aggregate CPU sums only processes with a prior same-identity sample. Newly discovered or exited-between-sample processes have incomplete CPU coverage.'
    'Sampling is sequential and has recorded collection overhead; timestamps and actual intervals are retained. No GPU, latency, display, percentile or acceptance claim.'
    'Only the pinned root and creation-time-checked descendants are recorded. No command lines, users, window titles or unrelated process records are retained.'
    'ReserveGuard admits this owned writer; external applications and previously running processes are outside its coverage.'
  )
}
while ($samples.Count -lt 91 -and $watch.Elapsed.TotalSeconds -lt $DurationSeconds) {
  $sampleStart = $watch.Elapsed.TotalMilliseconds
  $capturedAt = [DateTime]::UtcNow.ToString('o')
  try {
    $rootNow = Get-Process -Id $RootPid
    $sameRoot = $rootNow.StartTime.ToUniversalTime().Ticks -eq $expectedStart.Ticks
    $rootNow.Dispose()
    if (-not $sameRoot) { $stopReason='root-pid-reused'; break }
  } catch { $stopReason='root-exited-or-unreadable'; break }
  $queue = New-Object 'Collections.Generic.Queue[object]'
  $queue.Enqueue([pscustomobject]@{pid=$RootPid; parentPid=$null; start=$expectedStart})
  $seen = @{}
  $records = New-Object 'Collections.Generic.List[object]'
  $errors = New-Object 'Collections.Generic.List[object]'
  $scopeComplete = $true; $knownCpu=0; $workingSet=0L; $privateBytes=0L; $cpuOneCore=0.0; $cpuKnown=0
  $nextPrevious = @{}
  while ($queue.Count -gt 0 -and $records.Count -lt 64) {
    if ($watch.Elapsed.TotalSeconds -ge $DurationSeconds -and $records.Count -gt 0) { $scopeComplete=$false; break }
    $owned = $queue.Dequeue()
    if ($seen.ContainsKey([string]$owned.pid)) { continue }; $seen[[string]$owned.pid]=$true
    try {
      $process = Get-Process -Id $owned.pid
      if ($process.StartTime.ToUniversalTime().Ticks -ne $owned.start.Ticks) {
        $scopeComplete=$false; $process.Dispose()
        if ($owned.pid -eq $RootPid) { $stopReason='root-pid-reused'; $stopSampling=$true; break }
        continue
      }
      $process.Refresh()
      $cpu = $process.TotalProcessorTime.TotalMilliseconds
      $ws = $process.WorkingSet64; $priv = $process.PrivateMemorySize64
      $at = $watch.Elapsed.TotalMilliseconds; $pointTime = [DateTime]::UtcNow.ToString('o'); $process.Dispose()
      $identity = [string]$owned.pid + ':' + [string]$owned.start.Ticks
      $delta=$null; $elapsed=$null; $oneCore=$null; $normalized=$null
      if ($previous.ContainsKey($identity)) {
        $elapsed=$at-$previous[$identity].at; $delta=$cpu-$previous[$identity].cpu
        if ($elapsed -gt 0 -and $delta -ge 0) { $oneCore=$delta/$elapsed*100; $normalized=$oneCore/$logicalProcessors; $cpuOneCore+=$oneCore; $knownCpu+=$delta; $cpuKnown++ }
        else { $delta=$null; $elapsed=$null; $scopeComplete=$false }
      }
      $records.Add([ordered]@{pid=$owned.pid; parentPid=$owned.parentPid; startedAtUtc=$owned.start.ToString('o'); capturedAtUtc=$pointTime
        totalCpuMs=$cpu; deltaCpuMs=$delta; elapsedMs=$elapsed; cpuOneCorePercent=$oneCore; cpuNormalizedPercent=$normalized; workingSetBytes=$ws; privateBytes=$priv})
      $workingSet+=$ws; $privateBytes+=$priv; $nextPrevious[$identity]=@{cpu=$cpu;at=$at}
      # Query children only for a process whose pinned identity was just checked.
      $children = @(Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = ' + $owned.pid) -Property ProcessId,ParentProcessId,CreationDate -OperationTimeoutSec 2)
      $parentCheck=Get-Process -Id $owned.pid
      $parentStillPinned=$parentCheck.StartTime.ToUniversalTime().Ticks -eq $owned.start.Ticks; $parentCheck.Dispose()
      if (-not $parentStillPinned) { $scopeComplete=$false; if ($owned.pid -eq $RootPid) { $stopReason='root-pid-reused'; $stopSampling=$true; break }; continue }
      foreach ($child in $children) {
        if ($queue.Count + $records.Count -ge 64) { $scopeComplete=$false; break }
        try {
          $childProcess=Get-Process -Id $child.ProcessId; $childStart=$childProcess.StartTime.ToUniversalTime(); $childProcess.Dispose()
          if ($childStart -ge $owned.start -and [Math]::Abs(($childStart-$child.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 2) {
            $queue.Enqueue([pscustomobject]@{pid=[int]$child.ProcessId; parentPid=[int]$owned.pid; start=$childStart})
          } else { $scopeComplete=$false }
        } catch { $scopeComplete=$false; $errors.Add(@{operation='descendant-identity';category=$_.Exception.GetType().Name}) }
      }
    } catch {
      $scopeComplete=$false; $errors.Add(@{pid=$owned.pid;operation='owned-process-sample';category=$_.Exception.GetType().Name})
      if ($owned.pid -eq $RootPid) {
        try { $rootCheck=Get-Process -Id $RootPid; $rootPinned=$rootCheck.StartTime.ToUniversalTime().Ticks -eq $expectedStart.Ticks; $rootCheck.Dispose()
          if (-not $rootPinned) { $stopReason='root-pid-reused'; $stopSampling=$true; break }
        } catch { $stopReason='root-exited-or-unreadable'; $stopSampling=$true; break }
      }
    }
  }
  if ($queue.Count -gt 0) { $scopeComplete=$false }
  $sample=[ordered]@{capturedAtUtc=$capturedAt; elapsedFromStartMs=$sampleStart; collectionOverheadMs=$watch.Elapsed.TotalMilliseconds-$sampleStart
    scopeComplete=$scopeComplete; processes=$records; errors=$errors
    sum=[ordered]@{processes=$records.Count; workingSetBytesNotUniqueRam=$(if($records.Count){$workingSet}else{$null}); privateBytesNotUniqueRam=$(if($records.Count){$privateBytes}else{$null})
      cpuProcessesWithPriorSample=$cpuKnown; deltaCpuMsKnown=$knownCpu; cpuOneCorePercentKnown=$(if($cpuKnown){$cpuOneCore}else{$null}); cpuNormalizedPercentKnown=$(if($cpuKnown){$cpuOneCore/$logicalProcessors}else{$null})}}
  $samples.Add($sample); $previous=$nextPrevious
  # Leave headroom for final metadata; refuse growth before the final atomic write.
  $serialized=$receipt | ConvertTo-Json -Depth 12 -Compress
  if ($encoding.GetByteCount($serialized) -gt 950000) { $samples.RemoveAt($samples.Count-1); $stopReason='json-budget'; break }
  $sample.observerWorkMs=$watch.Elapsed.TotalMilliseconds-$sampleStart
  if ($stopSampling) { break }
  $remainingMs=$DurationSeconds*1000-$watch.Elapsed.TotalMilliseconds
  if ($remainingMs -le 0) { break }
  Start-Sleep -Milliseconds ([int][Math]::Min($IntervalMs,$remainingMs))
}
$receipt.finishedAtUtc=[DateTime]::UtcNow.ToString('o'); $receipt.actualDurationMs=$watch.Elapsed.TotalMilliseconds; $receipt.stopReason=$stopReason
$receipt.sampleCount=$samples.Count; $receipt.jsonSerializationAndWriteNotIncludedInLastSample=$true
$json=$receipt | ConvertTo-Json -Depth 12 -Compress; $bytes=$encoding.GetBytes($json)
if ($bytes.Length -gt 1048576) { throw 'JSON byte limit exceeded; no final artifact was written.' }
foreach ($directory in @($allowedBase,$profileDirectory,$evidenceDirectory)) { if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Evidence path changed to a reparse point.' } }
$finalReserve=& (Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1') -EstimatedCBytes 4194304 -EstimatedDBytes 0 | ConvertFrom-Json
if (-not $finalReserve.allowed) { throw 'Storage reserve denied the final bounded evidence write.' }
$temporaryFile=$outputFile+'.tmp-'+[Guid]::NewGuid().ToString('N')
$file=New-Object IO.FileStream($temporaryFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
[IO.File]::Move($temporaryFile,$outputFile)
[pscustomobject]@{output=$outputFile;bytes=$bytes.Length;samples=$samples.Count;stopReason=$stopReason;actualDurationMs=$receipt.actualDurationMs} | ConvertTo-Json -Compress
