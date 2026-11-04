const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {assertWeatherJourney,probeOfflineWeather}=require('../native/mission-weather.cjs');
const localAppData=path.resolve('C:/Synthetic/AppData/Local'),profile=path.join(localAppData,'Aerynth/review-vela-missions-12345'),argv=['--integration-vela-missions','--missions-weather-product-only','--profile='+profile];
test('offline weather admission and battery journey requires an owned fresh profile and excludes provider bootstrap',()=>{
 assert.doesNotThrow(()=>assertWeatherJourney({argv,profile,localAppData}));
 for(const changed of [argv.filter(flag=>flag!=='--integration-vela-missions'),[...argv,'--bootstrap-vela-api'],[...argv,'--missions-voice-live-only'],[...argv,'--profile='+profile]])assert.throws(()=>assertWeatherJourney({argv:changed,profile,localAppData}));
 for(const changed of [path.join(localAppData,'Aerynth/review'),path.join(localAppData,'Other/review-vela-missions-12345')])assert.throws(()=>assertWeatherJourney({argv,profile:changed,localAppData}));
});
function fixture({configured=false,matched=false,error='vela_api_usage_authorization_required',mutated=false}={}){
 const calls=[];let reads=0;
 return {calls,rpc:async(name,input)=>{calls.push({name,input});
  if(name==='velaApiUsageStatus')return {configurationVersion:configured?1:null,enabled:configured};
  if(name==='velaWeatherPermissionNative'){assert.deepEqual(input,{type:'status'});return {version:mutated&&reads++?2:1,decision:'deny'};}
  if(name==='velaRouteNative')return {matched};
  if(name==='velaRequestPreview'){assert.equal(input.providerId,'openai-api-vela');throw Error(error);}
  throw Error('unexpected_permission_or_dispatch_command:'+name);
 }};
}
test('offline probes delegate weather and require API-unavailable without a consent mutation or actual request',async()=>{
 const f=fixture(),result=await probeOfflineWeather(f.rpc);assert.equal(result.questions,2);
 assert.deepEqual(f.calls.map(call=>call.name),['velaApiUsageStatus','velaWeatherPermissionNative','velaRouteNative','velaRequestPreview','velaRouteNative','velaRequestPreview','velaWeatherPermissionNative']);
 assert(f.calls.filter(call=>call.name==='velaRouteNative').every(call=>call.input.resourceIds.length===0));
});
test('offline probes fail closed for configured API, native weather interception, unexpected errors, or consent changes',async()=>{
 for(const options of [{configured:true},{matched:true},{error:'location_denied'},{mutated:true}]){const f=fixture(options);await assert.rejects(probeOfflineWeather(f.rpc));assert(!f.calls.some(call=>call.name==='vela'||call.name==='velaApiConfigure'||call.input?.type==='set'));}
});
