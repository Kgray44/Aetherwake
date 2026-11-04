const assert=require('node:assert/strict'),path=require('node:path'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const FLAG='--missions-weather-product-only';
function assertWeatherJourney({argv,profile,localAppData=process.env.LOCALAPPDATA}){
 assert(argv.includes('--integration-vela-missions')&&argv.includes(FLAG),'explicit_weather_product_journey_required');
 assert(!argv.some(value=>value.startsWith('--missions-')&&value!==FLAG)&&!argv.includes('--bootstrap-vela-api'),'weather_journey_has_no_provider_or_other_journey');
 assert(localAppData&&path.isAbsolute(profile)&&/^review-vela-missions-\d+$/u.test(path.basename(profile))&&path.resolve(path.dirname(profile)).toLowerCase()===path.resolve(localAppData,'Aerynth').toLowerCase(),'owned_weather_profile_required');
 assert.equal(argv.filter(value=>value.startsWith('--profile=')).length,1,'one_weather_profile_required');
}
/** Only the exact fresh owned Electron PID/title/button is eligible. This does not click Windows OS consent. */
function purposeDialogScript(pid,ownerHwnd){
 assert(Number.isSafeInteger(pid)&&pid>0,'owned_weather_pid_required');
 assert(typeof ownerHwnd==='string'&&/^[1-9][0-9]*$/u.test(ownerHwnd),'owned_weather_hwnd_required');
 return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type 'using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public sealed class WeatherWindowInfo{public long Handle;public long Owner;public string Title;public string Class;public bool Foreground;}public static class WeatherOwnedWindow{public delegate bool EnumProc(IntPtr h,IntPtr l);[DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc p,IntPtr l);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint c);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);public static WeatherWindowInfo[] Owned(uint pid){var r=new List<WeatherWindowInfo>();EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&r.Count<16){var t=new StringBuilder(256);var c=new StringBuilder(128);GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);r.Add(new WeatherWindowInfo{Handle=h.ToInt64(),Owner=GetWindow(h,4).ToInt64(),Title=t.ToString(),Class=c.ToString(),Foreground=GetForegroundWindow()==h});}return true;},IntPtr.Zero);return r.ToArray();}}'
$ownedProcess=${pid}
$ownedMain=[IntPtr]${ownerHwnd}
$deadline=[DateTime]::UtcNow.AddSeconds(4)
$ownedInfo='[]'
do {
 $windows=[WeatherOwnedWindow]::Owned([uint32]$ownedProcess)
 $ownedInfo=ConvertTo-Json -InputObject @($windows) -Compress
 foreach($entry in $windows) {
  if($entry.Title -ceq 'Aerynth weather permission') {
   $handle=[IntPtr]$entry.Handle
   if([WeatherOwnedWindow]::GetForegroundWindow() -ne $handle){throw 'weather_modal_not_foreground'}
   $nativeProcess=[uint32]0
   [void][WeatherOwnedWindow]::GetWindowThreadProcessId($handle,[ref]$nativeProcess)
   if($nativeProcess -ne $ownedProcess){throw 'weather_modal_wrong_process'}
   $ancestor=$handle;$ownedChain=$false
   for($depth=0;$depth -lt 8;$depth++){$ancestor=[WeatherOwnedWindow]::GetWindow($ancestor,4);if($ancestor -eq $ownedMain){$ownedChain=$true;break};if($ancestor -eq [IntPtr]::Zero){break}}
   if(!$ownedChain){throw 'weather_modal_wrong_owner_chain'}
   $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
   $match=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button),[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,"Don’t allow"))
   $buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$match)
   if($buttons.Count -ne 1){$buttonCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button);$buttonInfo=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$buttonCondition)|Select-Object -First 8|ForEach-Object {@{name=$_.Current.Name;automationId=$_.Current.AutomationId}});throw ('weather_owned_button_count: '+(ConvertTo-Json -InputObject $buttonInfo -Compress))}
   if([WeatherOwnedWindow]::GetForegroundWindow() -ne $handle){throw 'weather_modal_not_foreground'}
   $invoke=$buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
   $invoke.Invoke()
   Write-Output 'OWNED_APP_PURPOSE_DENIED'
   exit 0
  }
 }
 Start-Sleep -Milliseconds 50
}while([DateTime]::UtcNow -lt $deadline)
throw ('weather_owned_dialog_not_found: '+$ownedInfo)`;
}
async function denyOwnedPurposeDialog(pid,ownerHwnd){
 const script=purposeDialogScript(pid,ownerHwnd);
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:8192});assert.equal(stdout.trim(),'OWNED_APP_PURPOSE_DENIED');return {foregroundPid:pid,ownerChainVerified:true,title:'Aerynth weather permission',button:'Don’t allow'};
}
async function run({argv,profile,receipt,rpc,js,click,fill,wait,capture,operation,systemFactsAudit,withNativeWeatherModal,ownerHwnd}){
 assertWeatherJourney({argv,profile});assert.equal(typeof systemFactsAudit,'function','native_weather_audit_required');
 const fixtureDeny=argv.includes('--weather-deny-fixture');
 receipt.profileContent=fixtureDeny?'Fresh synthetic profile with canonical DENY permission preseeded before renderer load. Actual composer/weather denial/settings/battery rendering; no native consent button or Windows OS prompt qualification.':'Fresh synthetic weather prompts, explicit native APP-purpose denial, and an offline native battery query. No OS-location consent or coordinates requested.';
 const surface='#vela-assistant-surface[data-surface-id="vela"]',composer=surface+' textarea[aria-label="Message Vela"]',send=surface+' button[aria-label="Send to Vela"]',quote=JSON.stringify;
 const state=()=>rpc('vela',{name:'state',input:{}}),status=()=>js("window.aerynthHost.command('weatherPermission',{type:'status'})");
 const before=await status();assert.equal(before.decision,fixtureDeny?'deny':'unknown');assert.deepEqual(systemFactsAudit(),{purposePrompts:0,locationAttempts:0,batteryReads:0});
 if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
 const ask=async(intent,deny=false)=>{const prior=(await state()).requests.length;await fill(composer,intent);if(deny){await withNativeWeatherModal(async()=>{const dialog=denyOwnedPurposeDialog(process.pid,ownerHwnd);dialog.catch(()=>{});await click(send);receipt.nativeModalProof=await dialog;});}else await click(send);
  await wait('Canonical native weather/battery response',async()=>{const current=await state();return current.requests.length>prior&&current.requests.at(-1).state==='responded';});const current=await state(),request=current.requests.at(-1),reply=current.conversation?.messages.find(message=>message.id===request.response?.messageId);assert(reply,'canonical_native_reply_required');await wait('Native reply is actually visible',()=>js(`document.querySelector(${quote(surface)})?.textContent.includes(${quote(reply.content)})`));return request;};
 const first=await ask("How's the weather in my area today?",!fixtureDeny);assert.equal(first.response?.kind,'inability');assert.equal(first.planId,undefined);assert.equal((await status()).decision,'deny');await capture('00-weather-purpose-denied');
 const second=await ask("What's the weather right now?");assert.equal(second.response?.kind,'inability');assert.equal(second.planId,undefined);assert.equal((await status()).decision,'deny');
 await click(surface+' button[aria-label="Vela preferences"]');await wait('Remembered weather permission in settings',()=>js(`document.querySelector(${quote(surface+' [aria-label="Weather location permission"]')})?.textContent.includes('Weather location is off.')`));await capture('01-weather-permission-settings');
 const battery=await ask("What's my battery level?");assert.equal(battery.local?.capabilityId,'system.battery');assert.equal(battery.response?.kind,'answer');assert.equal(battery.local?.facts.kind,'system-battery');assert.equal(battery.planId,undefined);await capture('02-weather-denial-remembered-battery-native');
 const current=await state(),activity=await rpc('providerActivity',{}),audit=systemFactsAudit();assert.equal(current.plans.length,0);assert.equal(activity.providerRequests,0);assert.equal(activity.codexConnections,0);assert.equal(audit.purposePrompts,fixtureDeny?0:1);assert.equal(audit.locationAttempts,0);assert.equal(audit.batteryReads,1);
 receipt.weather={qualification:fixtureDeny?'native-ui-preseeded-canonical-deny-fixture-and-offline-battery':'native-ui-app-purpose-denial-and-offline-battery',questions:3,nativeAudit:audit,rememberedDecision:'deny',initialDecisionFixture:fixtureDeny,nativePurposeButtonQualified:!fixtureDeny,plans:current.plans.length,providerRequests:activity.providerRequests,codexConnections:activity.codexConnections,osConsentInvoked:false,coordinateRetention:'none requested',actualWindowsAllowPrompt:'not qualified in this journey'};
}
module.exports={assertWeatherJourney,purposeDialogScript,denyOwnedPurposeDialog,run};
