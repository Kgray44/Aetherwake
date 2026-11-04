const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');const {execFileSync}=require('node:child_process');const {assertWeatherJourney,purposeDialogScript}=require('../native/mission-weather.cjs');
const localAppData=path.resolve('C:/Synthetic/AppData/Local'),profile=path.join(localAppData,'Aerynth/review-vela-missions-12345'),argv=['--integration-vela-missions','--missions-weather-product-only','--profile='+profile];
test('unpaid weather journey requires one exact owned fresh-profile namespace and excludes provider/other journeys',()=>{
 assert.doesNotThrow(()=>assertWeatherJourney({argv,profile,localAppData}));
 for(const changed of [argv.filter(flag=>flag!=='--integration-vela-missions'),[...argv,'--bootstrap-vela-api'],[...argv,'--missions-voice-live-only'],[...argv,'--profile='+profile]])assert.throws(()=>assertWeatherJourney({argv:changed,profile,localAppData}));
 for(const changed of [path.join(localAppData,'Aerynth/review'),path.join(localAppData,'Other/review-vela-missions-12345')])assert.throws(()=>assertWeatherJourney({argv,profile:changed,localAppData}));
});
test('native owned-modal PowerShell parses without running UI or requesting any permission',()=>{
 const source=purposeDialogScript(123,'456'),encoded=Buffer.from(source,'utf16le').toString('base64');
 const parser=`$ProgressPreference='SilentlyContinue';$source=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw $errors[0]};Write-Output 'PARSE_OK'`;
 const stdout=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(parser,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:4096,encoding:'utf8'});assert.equal(stdout.trim(),'PARSE_OK');
 const interop=source.match(/^Add-Type '([^']+)'$/mu)?.[1];assert(interop);const compile=`$ProgressPreference='SilentlyContinue';Add-Type '${interop}';Write-Output 'TYPE_OK'`;
 assert.equal(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(compile,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:4096,encoding:'utf8'}).trim(),'TYPE_OK');
});
