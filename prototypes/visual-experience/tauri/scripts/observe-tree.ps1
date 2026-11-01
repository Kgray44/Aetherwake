param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$RootProcessId,
  [ValidateRange(1,60)][int]$Seconds = 30,
  [ValidateRange(250,1000)][int]$IntervalMs = 1000,
  [switch]$IncludeGpuCounters,
  [Parameter(Mandatory=$true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
$prototypeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutFile)
if ($output.StartsWith($prototypeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Raw process traces must be written outside the public prototype/repository.'
}
if (-not (Test-Path -LiteralPath (Split-Path -Parent $output) -PathType Container)) { throw 'Output directory does not exist.' }

# Toolhelp lists PID/parent relationships without WMI polling on every sample.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AerynthProcessSnapshot {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Entry {
    public uint dwSize, cntUsage, th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID, cntThreads, th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  public struct Row { public int ProcessId, ParentProcessId; public string Name; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", EntryPoint="Process32FirstW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool First(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", EntryPoint="Process32NextW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Next(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static Row[] Read() {
    var snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    var result = new List<Row>();
    try {
      var entry = new Entry(); entry.dwSize = (uint)Marshal.SizeOf<Entry>();
      if (First(snapshot, ref entry)) do {
        result.Add(new Row { ProcessId=(int)entry.th32ProcessID, ParentProcessId=(int)entry.th32ParentProcessID, Name=entry.szExeFile });
      } while (Next(snapshot, ref entry));
    } finally { CloseHandle(snapshot); }
    return result.ToArray();
  }
}
'@

$samples = New-Object System.Collections.Generic.List[object]
$gaps = New-Object System.Collections.Generic.List[object]
$roles = @{}
$previousCpu = @{}
$previousAt = @{}
$startedUtc = [DateTimeOffset]::UtcNow
$started = [Diagnostics.Stopwatch]::StartNew()
$logicalProcessors = [Environment]::ProcessorCount
$ticks = [Math]::Ceiling(1000 * $Seconds / $IntervalMs)

for ($tick = 0; $tick -lt $ticks; $tick++) {
  $scheduledMs = $tick * $IntervalMs
  $remaining = $scheduledMs - $started.Elapsed.TotalMilliseconds
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Ceiling($remaining)) }
  $sampleStart = [Diagnostics.Stopwatch]::StartNew()
  $sampleOffsetMs = [Math]::Round($started.Elapsed.TotalMilliseconds,2)
  $sampleAt = [DateTimeOffset]::UtcNow
  try {
    $metadata = @([AerynthProcessSnapshot]::Read())
    $byParent = @{}
    foreach ($entry in $metadata) {
      $parent = [int]$entry.ParentProcessId
      if (-not $byParent.ContainsKey($parent)) { $byParent[$parent] = New-Object System.Collections.Generic.List[object] }
      $byParent[$parent].Add($entry)
    }
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($RootProcessId)
    $targetIds = New-Object System.Collections.Generic.List[int]
    $seen = @{}
    while ($queue.Count -gt 0) {
      $current = $queue.Dequeue()
      if ($seen.ContainsKey($current)) { continue }
      $seen[$current] = $true
      if ($metadata.ProcessId -contains $current) { $targetIds.Add($current) }
      if ($byParent.ContainsKey($current)) { foreach ($child in $byParent[$current]) { $queue.Enqueue([int]$child.ProcessId) } }
    }
    if ($targetIds.Count -eq 0) { $gaps.Add([pscustomobject]@{ utc=$sampleAt.ToString('o'); kind='root-process-absent'; tick=$tick }); break }

    $processes = @(Get-Process -Id $targetIds.ToArray() -ErrorAction SilentlyContinue)
    $processRows = New-Object System.Collections.Generic.List[object]
    $treeCpuOneCore = 0.0
    $cpuDeltaCount = 0
    $treeWorkingSet = [long]0
    $treePrivate = [long]0
    foreach ($process in $processes) {
      $id = [int]$process.Id
      if (-not $roles.ContainsKey($id)) {
        $role = if ($id -eq $RootProcessId) { 'host' } else { 'child-unknown' }
        if ($process.ProcessName -eq 'msedgewebview2') { $role = 'webview2-unspecified' }
        $roles[$id] = $role
      }
      $cpuSeconds = $null
      try { if ($null -ne $process.CPU) { $cpuSeconds = [double]$process.CPU } }
      catch { $gaps.Add([pscustomobject]@{ utc=$sampleAt.ToString('o'); kind='cpu-time-unavailable'; pid=$id }) }
      $cpuOneCore = $null
      if ($null -ne $cpuSeconds -and $previousCpu.ContainsKey($id)) {
        $elapsed = ($sampleAt - $previousAt[$id]).TotalSeconds
        if ($elapsed -gt 0) { $cpuOneCore = [Math]::Round(100 * ($cpuSeconds - $previousCpu[$id]) / $elapsed, 3); $treeCpuOneCore += $cpuOneCore; $cpuDeltaCount++ }
      }
      if ($null -ne $cpuSeconds) { $previousCpu[$id] = $cpuSeconds; $previousAt[$id] = $sampleAt }
      $treeWorkingSet += [long]$process.WorkingSet64
      $treePrivate += [long]$process.PrivateMemorySize64
      $processRows.Add([pscustomobject]@{ pid=$id; role=$roles[$id]; name=$process.ProcessName; cpuSeconds=$cpuSeconds; cpuOneCorePercent=$cpuOneCore; workingSetBytes=[long]$process.WorkingSet64; privateBytes=[long]$process.PrivateMemorySize64 })
    }

    $gpuEngines = $null; $gpuMemory = $null; $gpuStatus = 'not-sampled'
    if ($IncludeGpuCounters) {
      $gpuStatus = 'sampled'
      try {
        $gpuEngines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
          Where-Object { $_.Name -match '^pid_(\d+)_' -and $targetIds.Contains([int]$Matches[1]) } |
          ForEach-Object { [pscustomobject]@{ pid=[int]([regex]::Match($_.Name,'^pid_(\d+)_').Groups[1].Value); engine=$_.Name -replace '^.*engtype_', ''; utilizationPercent=[double]$_.UtilizationPercentage } })
      } catch { $gpuStatus = 'partial'; $gaps.Add([pscustomobject]@{ utc=$sampleAt.ToString('o'); kind='gpu-engine-counter-unavailable'; detail=$_.Exception.Message }) }
      try {
        $gpuMemory = @(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUProcessMemory |
          Where-Object { $_.Name -match '^pid_(\d+)_' -and $targetIds.Contains([int]$Matches[1]) } |
          ForEach-Object { [pscustomobject]@{ pid=[int]([regex]::Match($_.Name,'^pid_(\d+)_').Groups[1].Value); dedicatedBytes=[long]$_.DedicatedUsage; sharedBytes=[long]$_.SharedUsage } })
      } catch { $gpuStatus = 'partial'; $gaps.Add([pscustomobject]@{ utc=$sampleAt.ToString('o'); kind='gpu-memory-counter-unavailable'; detail=$_.Exception.Message }) }
      if ($gpuStatus -eq 'sampled' -and $gpuEngines.Count -eq 0 -and $gpuMemory.Count -eq 0) { $gpuStatus = 'no-target-instance' }
    }

    $samples.Add([pscustomobject]@{
      tick=$tick; scheduledOffsetMs=$scheduledMs; actualOffsetMs=$sampleOffsetMs; utc=$sampleAt.ToString('o');
      processCount=$processRows.Count; processes=$processRows; cpuDeltaProcessCount=$cpuDeltaCount;
      treeCpuOneCorePercent=$(if ($cpuDeltaCount -gt 0) { [Math]::Round($treeCpuOneCore,3) } else { $null });
      treeCpuMachineCapacityPercent=$(if ($cpuDeltaCount -gt 0) { [Math]::Round($treeCpuOneCore / $logicalProcessors,3) } else { $null });
      sumWorkingSetBytes=$treeWorkingSet; sumPrivateBytes=$treePrivate;
      gpuStatus=$gpuStatus; gpuEngines=$gpuEngines; gpuMemory=$gpuMemory; samplerElapsedMs=[Math]::Round($sampleStart.Elapsed.TotalMilliseconds,2)
    })
  } catch { $gaps.Add([pscustomobject]@{ utc=$sampleAt.ToString('o'); kind='sample-failed'; tick=$tick; detail=$_.Exception.Message }) }
}

# Role lookup runs after sampling so it cannot distort the 1 Hz sample cadence.
foreach ($id in @($roles.Keys)) {
  if ($roles[$id] -ne 'webview2-unspecified') { continue }
  try {
    $ownedMetadata = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    if ($ownedMetadata.CommandLine -match '--type=([^\s"\x27]+)') { $roles[$id] = 'webview2-' + $Matches[1] }
    elseif ($ownedMetadata.CommandLine -match 'msedgewebview2') { $roles[$id] = 'webview2-browser' }
  } catch { $gaps.Add([pscustomobject]@{ utc=[DateTimeOffset]::UtcNow.ToString('o'); kind='role-query-failed'; pid=$id }) }
}
foreach ($sample in $samples) { foreach ($process in $sample.processes) { $process.role = $roles[[int]$process.pid] } }

$result = [pscustomobject]@{
  schema='aerynth-process-tree-v1'; rootProcessId=$RootProcessId; startedUtc=$startedUtc.ToString('o'); requestedSeconds=$Seconds;
  intervalMs=$IntervalMs; logicalProcessors=$logicalProcessors; includeGpuCounters=[bool]$IncludeGpuCounters;
  caveats=@('Working sets are summed and may double-count shared pages.', 'GPU engine utilization across engines is not an overall GPU-capacity percentage.', 'Samples include only the root and discoverable descendants.');
  samples=$samples; gaps=$gaps
}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $output -Encoding utf8
Write-Output "Wrote $($samples.Count) target-tree samples and $($gaps.Count) gaps to $output"
