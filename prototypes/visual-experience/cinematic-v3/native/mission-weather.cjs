const assert=require('node:assert/strict'),path=require('node:path');
const FLAG='--missions-weather-product-only';
function assertWeatherJourney({argv,profile,localAppData=process.env.LOCALAPPDATA}){
 assert(argv.includes('--integration-vela-missions')&&argv.includes(FLAG),'explicit_weather_product_journey_required');
 assert(!argv.some(value=>value.startsWith('--missions-')&&value!==FLAG)&&!argv.includes('--bootstrap-vela-api'),'offline_weather_journey_has_no_provider_or_other_journey');
 assert(localAppData&&path.isAbsolute(profile)&&/^review-vela-missions-\d+$/u.test(path.basename(profile))&&path.resolve(path.dirname(profile)).toLowerCase()===path.resolve(localAppData,'Aerynth').toLowerCase(),'owned_weather_profile_required');
 assert.equal(argv.filter(value=>value.startsWith('--profile=')).length,1,'one_weather_profile_required');
}
/** Admission probes only: no weather Send, provider setup, credential access, or permission dialog. */
async function probeOfflineWeather(rpc){
 const usage=await rpc('velaApiUsageStatus',{});
 assert.equal(usage.configurationVersion,null,'unconfigured_weather_api_fixture_required');
 assert.equal(usage.enabled,false,'unpaid_weather_fixture_required');
 const before=await rpc('velaWeatherPermissionNative',{type:'status'});
 const intents=["How's the weather in my area today?","What's the weather right now?"];
 for(const intent of intents){
  assert.equal((await rpc('velaRouteNative',{intent,resourceIds:[]})).matched,false,'weather_must_delegate_to_api');
  await assert.rejects(rpc('velaRequestPreview',{intent,resourceIds:[],adaptive:true,providerId:'openai-api-vela'}),error=>{
   assert.equal(error?.code??error?.message,'vela_api_usage_authorization_required');return true;
  },'weather_api_unavailable_must_not_dispatch');
 }
 assert.deepEqual(await rpc('velaWeatherPermissionNative',{type:'status'}),before,'unavailable_api_must_not_change_weather_consent');
 return {questions:intents.length,expectedError:'vela_api_usage_authorization_required'};
}
async function run({argv,profile,receipt,rpc,js,click,fill,wait,capture,systemFactsAudit}){
 assertWeatherJourney({argv,profile});assert.equal(typeof systemFactsAudit,'function','native_weather_audit_required');
 const fixtureDeny=argv.includes('--weather-deny-fixture');
 receipt.profileContent='Fresh synthetic profile; optional canonical DENY seed. Unpaid native-route/API-unavailable probes and actual native battery UI only. Weather answers require a separately authorized API journey; no weather Send, consent dialog, device fix, or forecast is qualified here.';
 const surface='#vela-assistant-surface[data-surface-id="vela"]',composer=surface+' textarea[aria-label="Message Vela"]',send=surface+' button[aria-label="Send to Vela"]',quote=JSON.stringify;
 const state=()=>rpc('vela',{name:'state',input:{}}),status=()=>js("window.aerynthHost.command('weatherPermission',{type:'status'})");
 const before=await status();assert.equal(before.decision,fixtureDeny?'deny':'unknown');assert.deepEqual(systemFactsAudit(),{purposePrompts:0,locationAttempts:0,batteryReads:0});
 const probes=await probeOfflineWeather(rpc);assert.equal((await state()).requests.length,0,'offline_weather_probes_do_not_create_answers');
 assert.deepEqual(systemFactsAudit(),{purposePrompts:0,locationAttempts:0,batteryReads:0});
 if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
 if(fixtureDeny){await click(surface+' button[aria-label="Vela preferences"]');await wait('Remembered weather permission in settings',()=>js(`document.querySelector(${quote(surface+' [aria-label="Weather location permission"]')})?.textContent.includes('Weather location is off.')`));await capture('00-weather-permission-deny-fixture');}
 const prior=(await state()).requests.length;await fill(composer,"What's my battery level?");await click(send);
 await wait('Canonical native battery response',async()=>{const current=await state();return current.requests.length>prior&&current.requests.at(-1).state==='responded';});
 const current=await state(),battery=current.requests.at(-1),reply=current.conversation?.messages.find(message=>message.id===battery.response?.messageId);assert(reply,'canonical_native_battery_reply_required');
 await wait('Native battery reply is actually visible',()=>js(`document.querySelector(${quote(surface)})?.textContent.includes(${quote(reply.content)})`));
 assert.equal(battery.local?.capabilityId,'system.battery');assert.equal(battery.response?.kind,'answer');assert.equal(battery.local?.facts.kind,'system-battery');assert.equal(battery.planId,undefined);await capture('01-offline-battery-native');
 const activity=await rpc('providerActivity',{}),audit=systemFactsAudit();assert.equal(current.plans.length,0);assert.equal(activity.providerRequests,0);assert.equal(activity.codexConnections,0);assert.deepEqual(audit,{purposePrompts:0,locationAttempts:0,batteryReads:1});assert.deepEqual(await status(),before);
 receipt.weather={qualification:'offline-api-unavailable-route-probes-and-native-battery-ui',weatherApiAnswerQualified:false,weatherComposerSendPerformed:false,routeProbes:probes,nativeAudit:audit,rememberedDecision:before.decision,initialDecisionFixture:fixtureDeny,nativePurposeButtonQualified:false,plans:current.plans.length,providerRequests:activity.providerRequests,codexConnections:activity.codexConnections,osConsentInvoked:false,coordinateRetention:'none requested',actualWindowsAllowPrompt:'not qualified in this journey'};
}
module.exports={assertWeatherJourney,probeOfflineWeather,run};
