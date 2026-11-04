param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathRooted($OutputDirectory) -or [IO.Path]::GetPathRoot($OutputDirectory) -ne 'C:\' -or (Test-Path -LiteralPath $OutputDirectory)){throw 'new_owned_C_fixture_directory_required'}
$wakeGuard=& powershell.exe -NoProfile -NonInteractive -File (Join-Path $env:LOCALAPPDATA 'AeroStorageWatch\ReserveGuard.ps1') -EstimatedCBytes 4194304 -EstimatedDBytes 0 | ConvertFrom-Json
if(-not $wakeGuard.allowed){throw 'storage_reserve_admission_denied'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Speech
$wakeVoices=@((New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object {$_.VoiceInfo.Culture.Name -eq 'en-US'} | Select-Object -First 2)
if($wakeVoices.Count -eq 0){throw 'offline_synthetic_voice_unavailable'}
$wakeFormat=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$wakeFixtures=@();$wakeIndex=0
foreach($wakeVoice in $wakeVoices){
  foreach($wakeRate in @(-2,0,2)){
    $wakeFile='positive-'+$wakeIndex+'.wav';$wakeIndex++
    $wakeSynth=New-Object System.Speech.Synthesis.SpeechSynthesizer
    try{$wakeSynth.SelectVoice($wakeVoice.VoiceInfo.Name);$wakeSynth.Rate=$wakeRate;$wakeSynth.SetOutputToWaveFile((Join-Path $OutputDirectory $wakeFile),$wakeFormat)
      $wakeSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><break time="300ms"/>Hey <phoneme alphabet="ipa" ph="&#x02C8;ve&#x026A;l&#x0259;">Vela</phoneme><break time="80ms"/>set a timer for ten minutes.<break time="700ms"/></speak>')
    }finally{$wakeSynth.Dispose()}
    $wakeFixtures+=[pscustomobject]@{file=$wakeFile;expected='hey-vela';source='offline Windows SAPI synthetic';pronunciation='Hey VAY-luh';rate=$wakeRate;voice=$wakeVoice.VoiceInfo.Name}
  }
}
foreach($wakeText in @('Hello there. What is the time?','Hey Bella. Please set a timer.','The veil is blue. Let us go.','Hey, lay low for a while.')){
  $wakeFile='negative-'+$wakeIndex+'.wav';$wakeIndex++
  $wakeSynth=New-Object System.Speech.Synthesis.SpeechSynthesizer
  try{$wakeSynth.SetOutputToWaveFile((Join-Path $OutputDirectory $wakeFile),$wakeFormat);$wakeSynth.Speak($wakeText)}finally{$wakeSynth.Dispose()}
  $wakeFixtures+=[pscustomobject]@{file=$wakeFile;expected=$null;source='offline Windows SAPI synthetic';text=$wakeText}
}
$wakeFixtures | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'fixtures.json') -Encoding UTF8
[pscustomobject]@{syntheticFiles=$wakeFixtures.Count;microphoneCapture=$false;outputPlayback=$false;directory=$OutputDirectory} | ConvertTo-Json
