param(
    [Parameter(Mandatory = $true)][string]$VideoPath,
    [Parameter(Mandatory = $true)][string]$FfmpegBin
)
$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$prototypeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $prototypeRoot '.runtime'
$maxOutputBytes = 120 * 1024 * 1024

function ConvertTo-WindowsArgument([string]$Value) {
    # Quote for a native executable's argv parser; no shell evaluates these values.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-LocalTool([string]$Executable, [string[]]$Arguments, [int]$TimeoutMs = 60000) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Local decoder process could not start.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'Local decoder exceeded its bounded execution time.'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout.GetAwaiter().GetResult()
            Stderr = $stderr.GetAwaiter().GetResult()
        }
    } finally {
        $process.Dispose()
    }
}

function ConvertTo-FiniteNumber($Value) {
    $parsed = 0.0
    if ($null -ne $Value -and [double]::TryParse([string]$Value, [Globalization.NumberStyles]::Float, $culture, [ref]$parsed) -and -not [double]::IsNaN($parsed) -and -not [double]::IsInfinity($parsed)) {
        return $parsed
    }
    return $null
}

function Assert-NoRuntimeReparsePoint([string]$Candidate) {
    $ancestor = $Candidate
    while ($ancestor -and $ancestor.Length -ge $runtimeRoot.Length) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Runtime decoding paths must not traverse a reparse point.'
            }
        }
        if ($ancestor.Equals($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)) { break }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
}

$video = Get-Item -LiteralPath $VideoPath -Force
if ($video.PSIsContainer -or $video.Name -notlike 'aerynth-v3-5-*.webm' -or -not $video.FullName.StartsWith($runtimeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Input must be an existing V3.5 prototype WebM inside this prototype runtime directory.'
}
if ($video.Length -le 0 -or $video.Length -gt 32 * 1024 * 1024) {
    throw 'Input is outside the native recorder 32 MiB bound.'
}
if (-not [IO.Path]::GetPathRoot($runtimeRoot).Equals('C:\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'This C-only allocation contract requires the prototype runtime to be on C:.'
}
Assert-NoRuntimeReparsePoint $video.FullName
$decoderDirectory = Get-Item -LiteralPath $FfmpegBin -Force
if (-not $decoderDirectory.PSIsContainer) { throw 'FfmpegBin must be an existing directory.' }
$ffmpeg = Join-Path $decoderDirectory.FullName 'ffmpeg.exe'
$ffprobe = Join-Path $decoderDirectory.FullName 'ffprobe.exe'
if (-not (Test-Path -LiteralPath $ffmpeg -PathType Leaf) -or -not (Test-Path -LiteralPath $ffprobe -PathType Leaf)) {
    throw 'FfmpegBin must contain existing ffmpeg.exe and ffprobe.exe binaries.'
}

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$guard = Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1'
$guardResult = Invoke-LocalTool $windowsPowerShell @('-NoProfile', '-NonInteractive', '-File', $guard, '-EstimatedCBytes', '134217728', '-EstimatedDBytes', '0') 15000
if ($guardResult.ExitCode -ne 0) { throw 'Storage guard did not complete successfully.' }
$reserve = $guardResult.Stdout.Trim() | ConvertFrom-Json
if (-not $reserve.allowed) { throw 'Storage reserve denied the bounded independent review.' }

$reviewParent = Join-Path $runtimeRoot 'v3-5'
Assert-NoRuntimeReparsePoint $reviewParent
$reviewName = 'independent-review-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$reviewRoot = Join-Path $reviewParent $reviewName
[IO.Directory]::CreateDirectory($reviewRoot) | Out-Null
$relativeReviewRoot = '.runtime/v3-5/' + $reviewName
$videoHash = (Get-FileHash -LiteralPath $video.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$report = [ordered]@{
    kind = 'Independent ffmpeg decode of an existing native video; no application window or desktop capture'
    capturedAtUTC = [DateTime]::UtcNow.ToString('o')
    status = 'incomplete'
    source = [ordered]@{ basename = $video.Name; byteCount = $video.Length; sha256 = $videoHash }
    outputDirectory = $relativeReviewRoot
    decoded = $null
    timing = $null
    frames = @()
    storage = [ordered]@{ estimatedCBytes = 134217728; estimatedDBytes = 0; maxPNGBytes = $maxOutputBytes; pngBytes = 0; reserve = $reserve; reserveRechecks = @() }
    limitations = @(
        'Encoded packet PTS and decoded frame PTS belong to the recording, not monitor presentation or application FPS.',
        'Native recorder wall duration, container duration and encoded timestamp span are distinct; a discrepancy remains explicit.',
        'Frame extraction does not change the source video timing, encoded payload, or quality. PNG previews are bounded SDR decoder outputs, not HDR qualification.',
        'This inspection cannot by itself prove owner artistic acceptance or identify the application source build.',
        'ReserveGuard covers this bounded local writer; it is not an OS quota and cannot stop unrelated applications, cloud tasks or processes that did not load the rule.'
    )
}

try {
    $probeResult = Invoke-LocalTool $ffprobe @('-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'stream=codec_name,width,height:format=duration:packet=pts_time,duration_time,data_hash', '-of', 'json', $video.FullName)
    if ($probeResult.ExitCode -ne 0) { throw 'ffprobe failed to inspect the requested input.' }
    $probe = $probeResult.Stdout | ConvertFrom-Json
    $stream = @($probe.streams)[0]
    if (-not $stream -or $stream.width -le 0 -or $stream.height -le 0) { throw 'No decodable video stream dimensions were reported.' }
    $packets = @($probe.packets)
    $timestamped = @($packets | ForEach-Object {
        $pts = ConvertTo-FiniteNumber $_.pts_time
        if ($null -ne $pts) { [pscustomobject]@{ PTS = $pts; Duration = (ConvertTo-FiniteNumber $_.duration_time) } }
    })
    if (-not $timestamped.Count) { throw 'No finite encoded packet timestamps were available.' }
    $firstPTS = ($timestamped | Measure-Object -Property PTS -Minimum).Minimum
    $lastPTS = ($timestamped | Measure-Object -Property PTS -Maximum).Maximum
    $lastPacket = $timestamped | Sort-Object PTS | Select-Object -Last 1
    $lastEndPTS = if ($null -ne $lastPacket.Duration) { $lastPacket.PTS + $lastPacket.Duration } else { $null }
    $dataHashes = @($packets | ForEach-Object { if ($_.data_hash -match '^SHA256:[0-9a-fA-F]{64}$') { $_.data_hash.ToLowerInvariant() } })
    $stablePacketHash = $null
    if ($dataHashes.Count -eq $packets.Count -and $packets.Count -gt 0) {
        $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
        try {
            $digest = $hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes(($dataHashes -join "`n") + "`n"))
            $stablePacketHash = [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
        } finally { $hashAlgorithm.Dispose() }
    }
    $wallSeconds = $null
    $nativeReceiptAvailable = $false
    $nativeReceiptFile = [IO.Path]::ChangeExtension($video.FullName, '.json')
    if (Test-Path -LiteralPath $nativeReceiptFile -PathType Leaf) {
        $nativeReceipt = Get-Content -LiteralPath $nativeReceiptFile -Raw | ConvertFrom-Json
        $wallMs = ConvertTo-FiniteNumber $nativeReceipt.durationMs
        if ($null -ne $wallMs) { $wallSeconds = $wallMs / 1000; $nativeReceiptAvailable = $true }
    }
    $report.decoded = [ordered]@{ codec = $stream.codec_name; width = $stream.width; height = $stream.height }
    $report.timing = [ordered]@{
        firstPacketPTSSeconds = $firstPTS
        lastPacketPTSSeconds = $lastPTS
        lastPacketDurationSeconds = $lastPacket.Duration
        lastPacketEndPTSSeconds = $lastEndPTS
        encodedPacketTimestampSpanSeconds = $lastPTS - $firstPTS
        containerDurationSeconds = ConvertTo-FiniteNumber $probe.format.duration
        packetCount = $packets.Count
        timestampedPacketCount = $timestamped.Count
        packetDataHashCount = $dataHashes.Count
        orderedPacketDataHashesSHA256 = $stablePacketHash
        packetHashMethod = 'SHA-256 of UTF-8 lowercase ffprobe SHA256:<payload hash> values in video-packet order, each followed by LF; timestamps and mux metadata excluded'
        nativeWallReceiptAvailable = $nativeReceiptAvailable
        nativeWallDurationSeconds = $wallSeconds
        encodedPTSSpanMinusNativeWallSeconds = $(if ($null -ne $wallSeconds) { $lastPTS - $firstPTS - $wallSeconds } else { $null })
        deltaMeaning = 'Last encoded packet PTS minus first PTS, minus native receipt wall duration. This excludes final frame duration; neither value is presented FPS.'
    }
    $pngBytes = 0L
    $lastReserveCheck = [DateTime]::UtcNow
    foreach ($requested in @(.3, 2.8, 6.3, 10, 15.8, 21.5, 26.5, 29)) {
        if ($requested -lt $firstPTS -or $requested -gt $lastPTS) { continue }
        if (([DateTime]::UtcNow - $lastReserveCheck).TotalSeconds -ge 240) {
            $recheckResult = Invoke-LocalTool $windowsPowerShell @('-NoProfile', '-NonInteractive', '-File', $guard, '-EstimatedCBytes', '134217728', '-EstimatedDBytes', '0') 15000
            if ($recheckResult.ExitCode -ne 0) { throw 'Storage guard recheck did not complete successfully.' }
            $recheck = $recheckResult.Stdout.Trim() | ConvertFrom-Json
            if (-not $recheck.allowed) { throw 'Storage reserve declined continued independent review.' }
            $report.storage.reserveRechecks += $recheck
            $lastReserveCheck = [DateTime]::UtcNow
        }
        $file = 'frame-' + ([int]($requested * 1000)).ToString('000000', $culture) + 'ms.png'
        $destination = Join-Path $reviewRoot $file
        $timestamp = $requested.ToString('0.###', $culture)
        $decode = Invoke-LocalTool $ffmpeg @('-hide_banner', '-loglevel', 'info', '-n', '-copyts', '-ss', $timestamp, '-i', $video.FullName, '-map', '0:v:0', '-an', '-sn', '-dn', '-frames:v', '1', '-vf', "showinfo,scale=w='min(2000,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease", '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', $destination)
        if ($decode.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw 'ffmpeg failed to extract a requested frame.' }
        $actualPTS = $null
        $ptsMatch = [regex]::Match($decode.Stderr, '\bpts_time:\s*([-+0-9.eE]+)')
        if ($ptsMatch.Success) { $actualPTS = ConvertTo-FiniteNumber $ptsMatch.Groups[1].Value }
        $png = Get-Item -LiteralPath $destination
        $pngBytes += $png.Length
        $report.storage.pngBytes = $pngBytes
        if ($pngBytes -gt $maxOutputBytes) { throw 'Independent review exceeded its bounded PNG allocation.' }
        $report.frames += [ordered]@{
            file = $file
            requestedSeekSeconds = $requested
            decodedFramePTSSeconds = $actualPTS
            decodedFramePTSOffsetFromRequestSeconds = $(if ($null -ne $actualPTS) { $actualPTS - $requested } else { $null })
            byteCount = $png.Length
            sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $report.status = 'decoded'
} catch {
    # Raw native-tool logs can contain local paths. Retain bounded outputs and
    # disclose only the step failure, not private tool or source filesystem names.
    $report.status = 'failed'
    $report.failure = 'Independent probe or frame extraction failed. Source video and any earlier extracted frames remain intact.'
} finally {
    $json = $report | ConvertTo-Json -Depth 12
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1048576) { throw 'Independent receipt exceeded its 1 MiB bound.' }
    $receiptDestination = Join-Path $reviewRoot 'inspection.json'
    $receiptStream = [IO.File]::Open($receiptDestination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        $receiptBytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
        $receiptStream.Write($receiptBytes, 0, $receiptBytes.Length)
    } finally { $receiptStream.Dispose() }
    $json
}
if ($report.status -ne 'decoded') { exit 1 }
