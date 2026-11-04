const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {assertFoldersJourney,assertFixtureTarget,sourceDialogScript}=require('../native/mission-folders.cjs');
const localAppData=path.resolve('C:/OwnedFixture/AppData/Local'),profile=path.join(localAppData,'Aerynth','review-vela-missions-1793810000000');
const argv=['--integration-vela-missions','--missions-folders-only','--profile='+profile];
test('folder journey refuses mixed/provider journeys and non-owned profiles before native input',()=>{
 assert.doesNotThrow(()=>assertFoldersJourney({argv,profile,localAppData}));
 for(const extra of ['--bootstrap-vela-api','--missions-voice-live-only','--voice-synthetic-input'])assert.throws(()=>assertFoldersJourney({argv:[...argv,extra],profile,localAppData}),/offline_and_exclusive/);
 assert.throws(()=>assertFoldersJourney({argv,profile:path.join(localAppData,'real-user-profile'),localAppData}),/owned_folder_profile_required/);
 assert.throws(()=>assertFoldersJourney({argv:[...argv,'--profile='+profile],profile,localAppData}),/one_folder_profile_required/);
});
test('native dialog selection is limited to the exact neutral Documents fixture target',()=>{
 const documents=path.resolve('C:/OwnedFixture/Documents'),fixtureRoot=path.join(documents,'Aerynth-Folder-Review-1793810000000'),target=path.join(fixtureRoot,'Neutral optics folder');
 assert.doesNotThrow(()=>assertFixtureTarget(documents,fixtureRoot,target,'folder'));
 assert.throws(()=>assertFixtureTarget(documents,fixtureRoot,documents,'folder'),/exact_owned_source_target_required/);
 assert.throws(()=>assertFixtureTarget(documents,path.join(documents,'ExistingUserFolder'),target,'folder'),/owned_folder_fixture_required/);
 assert.throws(()=>sourceDialogScript({pid:0,ownerHwnd:'123',documents,fixtureRoot,target,kind:'folder'}),/owned_source_pid_required/);
 assert.throws(()=>sourceDialogScript({pid:123,ownerHwnd:'0',documents,fixtureRoot,target,kind:'folder'}),/owned_source_hwnd_required/);
 const script=sourceDialogScript({pid:123,ownerHwnd:'456',documents,fixtureRoot,target,kind:'folder'});
 // Parse only. No dialog, UIAutomation invocation, permission, microphone, or process selection occurs.
 const parser="$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('"+Buffer.from(script,'utf16le').toString('base64')+"')),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'source_dialog_script_parse_failed'};Write-Output 'PARSE_OK'";
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(parser,'utf16le').toString('base64')],{windowsHide:true,timeout:4000,maxBuffer:4096,encoding:'utf8'});
 assert.equal(output.trim(),'PARSE_OK');
});
