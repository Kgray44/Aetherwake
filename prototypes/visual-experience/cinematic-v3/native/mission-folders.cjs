const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {promisify}=require('node:util'),{execFile}=require('node:child_process');
const FLAG='--missions-folders-only',COMPOSER_ONLY='--vela-composer-source-only',MiB=1024*1024;
function assertFoldersJourney({argv,profile,localAppData=process.env.LOCALAPPDATA}){
 assert(argv.includes('--integration-vela-missions')&&argv.includes(FLAG),'explicit_folder_journey_required');
 assert(!argv.some(value=>value.startsWith('--missions-')&&value!==FLAG)&&!argv.includes('--bootstrap-vela-api')&&!argv.includes('--voice-synthetic-input'),'folder_journey_is_offline_and_exclusive');
 assert(localAppData&&path.isAbsolute(profile)&&/^review-vela-missions-\d+$/u.test(path.basename(profile))&&path.resolve(path.dirname(profile)).toLowerCase()===path.resolve(localAppData,'Aerynth').toLowerCase(),'owned_folder_profile_required');
 assert.equal(argv.filter(value=>value.startsWith('--profile=')).length,1,'one_folder_profile_required');
}
function assertFixtureTarget(documents,fixtureRoot,target,kind){
 assert(path.isAbsolute(documents)&&path.isAbsolute(fixtureRoot)&&path.isAbsolute(target),'absolute_folder_fixture_required');
 assert.equal(path.resolve(path.dirname(fixtureRoot)).toLowerCase(),path.resolve(documents).toLowerCase(),'neutral_documents_fixture_required');
 assert(/^Aerynth-Folder-Review-\d{13}$/u.test(path.basename(fixtureRoot)),'owned_folder_fixture_required');
 assert(['folder','files'].includes(kind),'known_source_kind_required');
 const expected=path.join(fixtureRoot,kind==='folder'?'Neutral optics folder':'Independent.txt');
 assert.equal(path.resolve(target).toLowerCase(),path.resolve(expected).toLowerCase(),'exact_owned_source_target_required');
}
async function prepareFixture(documents){
 const actual=await fs.realpath(documents),fixtureRoot=path.join(actual,'Aerynth-Folder-Review-'+Date.now());
 const folder=path.join(fixtureRoot,'Neutral optics folder'),file=path.join(fixtureRoot,'Independent.txt');
 assertFixtureTarget(actual,fixtureRoot,folder,'folder');assertFixtureTarget(actual,fixtureRoot,file,'files');
 await fs.mkdir(fixtureRoot);await fs.mkdir(folder);await fs.mkdir(path.join(folder,'Calibration'));
 for(const [name,body]of [[path.join(folder,'README.txt'),'Synthetic optics reference.'],[path.join(folder,'Calibration','Alignment.txt'),'Synthetic calibration reference.'],[file,'Synthetic independent source.']])await fs.writeFile(name,body,{flag:'wx'});
 assert((await fs.stat(fixtureRoot)).isDirectory());return {documents:actual,root:fixtureRoot,folder,file,allocationBoundBytes:MiB};
}
/** Operates only a foreground common dialog belonging to this exact owned Electron HWND/PID. */
function sourceDialogScript({pid,ownerHwnd,documents,fixtureRoot,target,kind}){
 assert(Number.isSafeInteger(pid)&&pid>0,'owned_source_pid_required');assert(typeof ownerHwnd==='string'&&/^[1-9][0-9]*$/u.test(ownerHwnd),'owned_source_hwnd_required');
 assertFixtureTarget(documents,fixtureRoot,target,kind);
 const encoded=Buffer.from(target,'utf16le').toString('base64'),title=kind==='folder'?'Choose a folder':'Choose files';
 return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type 'using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public sealed class SourceWindowInfo{public long Handle;public long Owner;public string Title;public string Class;public bool Visible;public bool Foreground;}public static class SourceOwnedWindow{public delegate bool EnumProc(IntPtr h,IntPtr l);[DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc p,IntPtr l);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint c);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);public static SourceWindowInfo[] Owned(uint pid){var r=new List<SourceWindowInfo>();EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&r.Count<16){var t=new StringBuilder(256);var c=new StringBuilder(128);GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);r.Add(new SourceWindowInfo{Handle=h.ToInt64(),Owner=GetWindow(h,4).ToInt64(),Title=t.ToString(),Class=c.ToString(),Visible=IsWindowVisible(h),Foreground=GetForegroundWindow()==h});}return true;},IntPtr.Zero);return r.ToArray();}}'
$ownedProcess=${pid}
$ownedMain=[IntPtr]${ownerHwnd}
$target=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))
$deadline=[DateTime]::UtcNow.AddSeconds(4)
function Assert-ExactOwner([IntPtr]$handle){
 if([SourceOwnedWindow]::GetForegroundWindow() -ne $handle){throw 'source_dialog_not_foreground'}
 $nativeProcess=[uint32]0;[void][SourceOwnedWindow]::GetWindowThreadProcessId($handle,[ref]$nativeProcess)
 if($nativeProcess -ne $ownedProcess){throw 'source_dialog_wrong_process'}
 $ancestor=$handle;$ownedChain=$false
 for($depth=0;$depth -lt 8;$depth++){$ancestor=[SourceOwnedWindow]::GetWindow($ancestor,4);if($ancestor -eq $ownedMain){$ownedChain=$true;break};if($ancestor -eq [IntPtr]::Zero){break}}
 if(!$ownedChain){throw 'source_dialog_wrong_owner_chain'}
}
try{do{
 foreach($entry in [SourceOwnedWindow]::Owned([uint32]$ownedProcess)){
  if($entry.Title -ceq '${title}' -and $entry.Class -ceq '#32770'){
   $handle=[IntPtr]$entry.Handle
   if(!$entry.Visible){continue}
   if([SourceOwnedWindow]::GetForegroundWindow() -ne $handle){
    $foregroundProcess=[uint32]0;[void][SourceOwnedWindow]::GetWindowThreadProcessId([SourceOwnedWindow]::GetForegroundWindow(),[ref]$foregroundProcess)
    if($foregroundProcess -ne $ownedProcess){[Console]::Error.WriteLine('SOURCE_FOREGROUND '+(ConvertTo-Json -InputObject @{handle=[SourceOwnedWindow]::GetForegroundWindow().ToInt64();processId=$foregroundProcess;dialogVisible=$entry.Visible} -Compress));throw 'source_dialog_not_foreground'}
    continue
   }
   Assert-ExactOwner $handle
   $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
   $editType=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
   $edits=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editType)|Where-Object {$_.Current.AutomationId -ceq '1148' -or $_.Current.AutomationId -ceq '1001'})
   if($edits.Count -ne 1){$controls=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editType)|Select-Object -First 16|ForEach-Object {@{automationId=$_.Current.AutomationId;class=$_.Current.ClassName;type=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled;offscreen=$_.Current.IsOffscreen}});throw ('source_dialog_exact_filename_control_unavailable '+(ConvertTo-Json -InputObject $controls -Compress))}
   $value=$edits[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
   if($value.Current.IsReadOnly){throw 'source_dialog_filename_readonly'}
   Assert-ExactOwner $handle;$value.SetValue($target)
   $buttonMatch=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button),[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1'))
   $buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$buttonMatch)
   if($buttons.Count -ne 1 -or !$buttons[0].Current.IsEnabled){throw 'source_dialog_primary_button_unavailable'}
   Assert-ExactOwner $handle;$buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
   Write-Output 'EXACT_OWNED_SOURCE_SELECTED';exit 0
  }
 }
 Start-Sleep -Milliseconds 40
}while([DateTime]::UtcNow -lt $deadline)
throw 'source_dialog_exact_owned_window_unavailable'
}catch{[Console]::Error.WriteLine('OWNED_SOURCE_WINDOWS '+(ConvertTo-Json -InputObject @([SourceOwnedWindow]::Owned([uint32]$ownedProcess)) -Compress));throw}`;
}
const SOURCE_DIALOG_FAILURES=new Set(['source_dialog_not_foreground','source_dialog_wrong_process','source_dialog_wrong_owner_chain','source_dialog_exact_filename_control_unavailable','source_dialog_filename_readonly','source_dialog_primary_button_unavailable','source_dialog_exact_owned_window_unavailable']);
function safeDialogFailure(stderr){
 const clean=String(stderr??'').replace(/_x[0-9a-f]{4}_/giu,' ');
 const code=clean.match(/(?:FullyQualifiedErrorId\s*:\s*|<S S="Error">)(source_dialog_[a-z_]+)\b/u)?.[1];
 return SOURCE_DIALOG_FAILURES.has(code)?code:'source_dialog_unclassified_failure';
}
async function selectOwnedSource(input){
 try{const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(sourceDialogScript(input),'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:4096});
  assert.equal(stdout.trim(),'EXACT_OWNED_SOURCE_SELECTED');return {foregroundPid:input.pid,ownerChainVerified:true,title:input.kind==='folder'?'Choose a folder':'Choose files',kind:input.kind,selection:'exact-owned-neutral-fixture'};
 }catch(error){
  // Private, bounded diagnostic from only this owned child/dialog. Public receipt
  // receives an allowlisted code; no raw window/control values enter renderer DTOs.
  if(input.diagnosticDirectory){const diagnostic=JSON.stringify({kind:input.kind,code:safeDialogFailure(error?.stderr),stderr:String(error?.stderr??'').slice(0,8192),stdout:String(error?.stdout??'').slice(0,1024)},null,2);
   assert(Buffer.byteLength(diagnostic)<=16384,'source_dialog_diagnostic_bound');await fs.writeFile(path.join(input.diagnosticDirectory,'source-dialog-'+input.kind+'-failure.json'),diagnostic,{flag:'wx'});}
  throw Error('exact_owned_source_dialog_failed:'+safeDialogFailure(error?.stderr));
 }
}
async function run({argv,profile,documents,receipt,rpc,js,click,fill,wait,capture,withNativeSourceDialog,ownerHwnd}){
 assertFoldersJourney({argv,profile});const fixture=await prepareFixture(documents);
 receipt.profileContent='Workspace created through actual native Environment Navigator input; actual native file/folder pickers select only owned neutral Documents fixtures. Metadata browsing, no implicit child import, zero provider calls.';
 receipt.folders={fixtureDirectory:path.basename(fixture.root),fixtureAllocationBoundBytes:fixture.allocationBoundBytes,nativeDialogs:[],externalExplorerOpen:'not invoked'};
 const resources='[data-surface-id="resources"]',q=JSON.stringify;
 if(argv.includes(COMPOSER_ONLY)){
  receipt.profileContent='Vela composer attaches a neutral local text fixture using the owned Windows file picker.';
  await checkComposerSource({fixture,profile,receipt,rpc,js,click,fill,wait,withNativeSourceDialog,ownerHwnd});
  await capture('00-vela-composer-source');
  return;
 }
 // Private RPC mutation does not drive the renderer's navigation/panel scope.
 // Use the ordinary workspace creation UI so Resources captures its real scope.
 await click('#workspace-manager');await click('.en-navigator [data-action="toggle-create"]');await click('.en-navigator [data-action="create-workspace"]');
 await fill('.en-navigator input[aria-label="Environment name"]','Synthetic folder source acceptance');await click('.en-navigator [data-action="submit-workspace-create"]');
 const workspace=await wait('Native-created workspace reaches renderer and canonical navigation',async()=>{const value=await rpc('desktop',{type:'snapshot'});return value.workspaces.length===1&&value.navigation.kind==='workspace'&&
  await js(`document.querySelector('#workspace-manager')?.textContent.includes('Synthetic folder source acceptance')`)?value:false;});
 await click('#application-resources');await wait('Resources scope controls',()=>js(`document.querySelector(${q(resources+' [aria-label="Source scope"]')})?.getClientRects().length>0`));
 const pick=async kind=>{
  await click(resources+' [data-resources-add="true"] summary');
  await withNativeSourceDialog(async()=>{const selected=selectOwnedSource({pid:process.pid,ownerHwnd,documents:fixture.documents,fixtureRoot:fixture.root,target:kind==='folder'?fixture.folder:fixture.file,kind,diagnosticDirectory:path.join(profile,'mission-evidence')});selected.catch(()=>{});
   await click(resources+' [data-resource-action="'+(kind==='folder'?'choose-source-folder':'standalone-file')+'"]');receipt.folders.nativeDialogs.push(await selected);});
 };
 await pick('folder');
 let state=await wait('Exactly one canonical folder and placement',async()=>{const value=await rpc('desktop',{type:'snapshot'});return value.resources.length===1&&value.resources[0].kind==='folder'&&value.blocks.length===1&&value;});
 const folderId=state.resources[0].id;assert.equal(state.activeWorkspaceId,workspace.activeWorkspaceId);assert.deepEqual(Object.keys(state.resources[0].folder).sort(),['name','source','sourceRevision']);
 await wait('Workspace sources renders one folder',()=>js(`(()=>{const r=document.querySelector(${q(resources)}),rows=r?.querySelectorAll('.aw-context-resource');return rows?.length===1&&rows[0].querySelector('[data-open-resource]')?.dataset.openResource===${q(folderId)}&&[...r.querySelectorAll('button')].some(b=>b.textContent==='Workspace sources'&&b.getAttribute('aria-pressed')==='true');})()`));
 await capture('00-one-folder-workspace-source');await pick('files');
 state=await wait('One independent file with the original folder',async()=>{const value=await rpc('desktop',{type:'snapshot'});return value.resources.length===2&&value.resources.filter(r=>r.kind==='folder').length===1&&value.resources.filter(r=>r.kind==='file').length===1&&value.blocks.length===2&&value;});
 assert.equal(state.resources.find(r=>r.kind==='folder').id,folderId);
 const groups=await wait('Distinct Files and Folders groups actually render',()=>js(`(()=>{const r=document.querySelector(${q(resources)}),groups=[...r?.querySelectorAll('.aw-context-resource-group')??[]].filter(n=>!n.hidden).map(n=>({label:n.querySelector('.aw-context-group-heading span')?.textContent,rows:n.querySelectorAll('.aw-context-resource').length}));return groups.some(g=>g.label==='Files'&&g.rows===1)&&groups.some(g=>g.label==='Folders'&&g.rows===1)&&groups;})()`));
 receipt.folders.groups=groups;await capture('01-files-and-folders');
 await click(resources+' [data-open-resource="'+folderId+'"]');
 await wait('Canonical folder view is visible',()=>js(`document.querySelector('.aw-folder')?.getClientRects().length>0`));await click('.aw-folder button');
 await wait('Actual folder metadata lists two children',()=>js(`document.querySelector('.aw-folder [aria-label="Folder contents"]')?.children.length===2`));
 await click('.aw-folder [data-folder-entry]');await wait('Explicit child browse lists calibration metadata',()=>js(`document.querySelector('.aw-folder [aria-label="Folder contents"]')?.textContent==='Alignment.txt'`));
 const final=await rpc('desktop',{type:'snapshot'}),activity=await rpc('providerActivity',{});assert.equal(final.resources.length,2);assert.equal(final.blocks.length,2);assert.equal(final.resources.filter(r=>r.kind==='folder').length,1);
 assert.equal(final.resources.some(r=>r.title==='README.txt'||r.title==='Alignment.txt'),false,'browse_must_not_import_children');
 assert.ok(!JSON.stringify(final).includes(fixture.root));assert.doesNotMatch(JSON.stringify(final),/sourceGrantId|selected_path/);
 assert.equal(activity.providerRequests,0);assert.equal(activity.codexConnections,0);await capture('02-folder-metadata-browse');
 receipt.folders.canonical={folderId,folders:1,independentFiles:1,placements:2,implicitChildResources:0};receipt.providerActivity={after:activity};
}
async function checkComposerSource({fixture,profile,receipt,rpc,js,click,fill,wait,withNativeSourceDialog,ownerHwnd}){
 const beforePick=await rpc('desktop',{type:'snapshot'}),q=JSON.stringify;
 const vela='#vela-assistant-surface[data-surface-id="vela"]';
 const composer=vela+' textarea[aria-label="Message Vela"]',draft='Synthetic draft awaiting its source.';
 if(!await js(`document.querySelector(${q(composer)})?.getClientRects().length>0`))await click('#vela');
 await fill(composer,draft);
 await withNativeSourceDialog(async()=>{
  const selected=selectOwnedSource({pid:process.pid,ownerHwnd,documents:fixture.documents,fixtureRoot:fixture.root,target:fixture.file,kind:'files',diagnosticDirectory:path.join(profile,'mission-evidence')});selected.catch(()=>{});
  await click(vela+' button[aria-label="Attach files"]');
  receipt.folders.composerDialog=await selected;
 });
 await wait('Composer keeps the draft and adds the exact local source chip',()=>js(`(()=>{const composer=document.querySelector(${q(composer)});return composer?.value===${q(draft)}&&document.activeElement===composer&&!!document.querySelector(${q(vela+' button[aria-label="Remove source Independent.txt"]')});})()`));
 const afterPick=await rpc('desktop',{type:'snapshot'}),afterActivity=await rpc('providerActivity',{});
 assert.equal(afterPick.blocks.length,beforePick.blocks.length,'composer_pick_does_not_place_blocks');
 assert.equal(afterPick.resources.length,beforePick.resources.length+1,'composer_pick_creates_one_canonical_source');
 const resource=afterPick.resources.find(item=>item.kind==='file'&&item.title==='Independent.txt');
 assert.ok(resource?.id,'canonical_composer_source_required');
 assert.equal(afterActivity.providerRequests,0);assert.equal(afterActivity.codexConnections,0);
 receipt.folders.composerSource={resourceId:resource.id,title:'Independent.txt',draftPreserved:true,providerRequests:0};
 receipt.providerActivity={after:afterActivity};
}
module.exports={assertFoldersJourney,assertFixtureTarget,prepareFixture,sourceDialogScript,safeDialogFailure,selectOwnedSource,run};
