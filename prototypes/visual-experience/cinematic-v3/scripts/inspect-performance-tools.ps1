param(
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$reserve = & (Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1') -EstimatedCBytes 1048576 -EstimatedDBytes 0 | ConvertFrom-Json
if (-not $reserve.allowed) { throw 'Storage reserve denied the bounded diagnostic receipt.' }

# Discovery is read-only. It does not start a system-wide ETW/energy trace or
# change display modes, drivers, power policy, GPU selection, or permissions.
$prototypeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$prototypeExe = Join-Path $prototypeRoot 'node_modules\electron\dist\electron.exe'
$processIds = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.ExecutablePath -eq $prototypeExe } |
    ForEach-Object { [int]$_.ProcessId })
$presentMon = Get-Command PresentMon.exe -ErrorAction SilentlyContinue
$wpr = Get-Command wpr.exe -ErrorAction SilentlyContinue
$wpa = Get-Command wpa.exe -ErrorAction SilentlyContinue
$nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
$profiles = @()
if ($wpr) {
    $profileOutput = & $wpr.Source -profiles 2>&1 | Out-String
    foreach ($candidate in @('GPU', 'DesktopComposition', 'Power', 'Thermal')) {
        if ($profileOutput -match "(?m)^\s+$candidate\s+") { $profiles += $candidate }
    }
}
$appMemoryValues = @()
$appEntries = 0
$memoryQuery = 'unavailable: NVIDIA tool absent'
if ($nvidia) {
    try {
        $rows = @(& $nvidia.Source --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits 2>$null)
        foreach ($row in $rows) {
            $columns = $row -split ',\s*'
            $candidatePid = 0
            if ($columns.Count -ge 2 -and [int]::TryParse($columns[0], [ref]$candidatePid) -and $processIds -contains $candidatePid) {
                $appEntries++
                $memoryMiB = 0.0
                if ([double]::TryParse($columns[1], [ref]$memoryMiB)) { $appMemoryValues += $memoryMiB }
            }
        }
        $memoryQuery = if (-not $processIds.Count) {
            'not measured: no matching prototype process was running'
        } elseif (-not $appEntries) {
            'unavailable: no matching process entry in the observed NVIDIA query'
        } elseif ($appMemoryValues.Count -ne $appEntries) {
            'unavailable: matching entries returned nonnumeric memory values such as [N/A]'
        } else {
            'observed numeric per-process NVIDIA counter; not independently validated physical VRAM'
        }
    } catch {
        $memoryQuery = 'unavailable: NVIDIA query failed'
    }
}
$receipt = [ordered]@{
    capturedAtUTC = [DateTime]::UtcNow.ToString('o')
    kind = 'Read-only local measurement tool discovery; no timing or power trace recorded'
    matchingPrototypeProcesses = $processIds.Count
    tools = [ordered]@{
        presentMonOnPath = [bool]$presentMon
        windowsPerformanceRecorder = [bool]$wpr
        windowsPerformanceAnalyzer = [bool]$wpa
        nvidiaSMI = [bool]$nvidia
        discoveredWprProfiles = $profiles
    }
    presentedFrames = [ordered]@{
        status = 'not measured'
        reason = 'Tool discovery and available ETW profiles do not establish decoded, application-attributed presentation timestamps. Callback/submission cadence is separate.'
    }
    dedicatedMemory = [ordered]@{
        status = $memoryQuery
        matchingNvidiaEntries = $appEntries
        numericMatchingEntries = $appMemoryValues.Count
        reportedMiBSum = $(if ($appEntries -gt 0 -and $appMemoryValues.Count -eq $appEntries) { ($appMemoryValues | Measure-Object -Sum).Sum } else { $null })
    }
    energy = [ordered]@{
        status = 'not measured'
        reason = 'Availability of WPR Power/Thermal profiles is not an application-attributed energy measurement; global GPU power is not reported as application consumption.'
    }
    privacy = 'No process IDs, unrelated process names, machine paths, hardware UUIDs or system-wide trace payloads are included.'
    reserve = $reserve
}
$json = $receipt | ConvertTo-Json -Depth 8
if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1048576) { throw 'Receipt exceeds its admitted byte bound.' }
$destination = [IO.Path]::GetFullPath($OutputPath)
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
} finally {
    $stream.Dispose()
}
$json
