param(
    [ValidateRange(1, 30)][int]$Samples = 6,
    [string]$OutputPath = 'evidence/gpu-probe.json',
    [string]$Conditions = 'Foreground native Balanced scene after focus; exact semantic/idle state not independently determined'
)
$ErrorActionPreference = 'Stop'
$storageGuard = Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1'
$reserve = & $storageGuard -EstimatedCBytes 1048576 -EstimatedDBytes 0 | ConvertFrom-Json
if (-not $reserve.allowed) { throw 'Storage reserve denied the bounded receipt write.' }
$prototypeExe = (Resolve-Path -LiteralPath 'node_modules/electron/dist/electron.exe').Path
$prototypeProcessIds = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -eq $prototypeExe } | ForEach-Object { [int]$_.ProcessId })
if ($prototypeProcessIds.Count -eq 0) { throw 'Launch this prototype first; no matching executable processes found.' }
$sets = @(Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage', '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage' -SampleInterval 1 -MaxSamples $Samples)
$rows = @()
foreach ($set in $sets) {
    $owned = @($set.CounterSamples | Where-Object { $_.InstanceName -match '^pid_(\d+)_' -and $prototypeProcessIds -contains [int]$Matches[1] -and $_.Status -eq 0 })
    $engines = @($owned | Where-Object { $_.Path -like '*\GPU Engine(*)*' })
    $dedicated = @($owned | Where-Object { $_.Path -like '*\Dedicated Usage' })
    $shared = @($owned | Where-Object { $_.Path -like '*\Shared Usage' })
    $rows += [pscustomobject]@{
        time = $set.Timestamp.ToUniversalTime().ToString('o')
        matchingEngineCounters = $engines.Count
        maxSingleEnginePercent = $(if ($engines.Count) { ($engines | Measure-Object CookedValue -Maximum).Maximum } else { $null })
        summedEnginePercent = $(if ($engines.Count) { ($engines | Measure-Object CookedValue -Sum).Sum } else { $null })
        dedicatedBytesCounterSum = $(if ($dedicated.Count) { ($dedicated | Measure-Object CookedValue -Sum).Sum } else { $null })
        sharedBytesCounterSum = $(if ($shared.Count) { ($shared | Measure-Object CookedValue -Sum).Sum } else { $null })
    }
}
$result = [pscustomobject]@{
    kind = 'Observed Windows GPU counters filtered to this prototype executable; de-identified'
    conditions = $Conditions
    processCount = $prototypeProcessIds.Count
    sampleIntervalSeconds = 1
    limitation = 'Engine sums are not whole-GPU utilization. Process memory counters are diagnostic only: Microsoft documents incorrect-value cases, and sums can share memory. No physical VRAM, presented FPS or energy claim.'
    reference = 'https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value'
    samples = $rows
}
$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), $json, [Text.UTF8Encoding]::new($false))
$json
