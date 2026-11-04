import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname,basename} from 'node:path';
import {BackendCore} from '../src/core.mts';import {createSystemFactsClient,createSystemFactsServer,type DeviceLocation,type NativeSystemFactsServices} from '../src/system-facts-host.mts';
import type {NativeHostServices} from '../src/native-host.mts';import type {VelaBackendState} from '../src/contracts.mts';
function fixture(decision:'allow'|'deny'='allow'){
 const folder=mkdtempSync(join(tmpdir(),'aerynth-weather-battery-')),urls:string[]=[],events:unknown[]=[];let prompts=0,locations=0;
 let locate:NativeSystemFactsServices['locate']=async input=>({latitude:locations++?44.551:43.45827,longitude:-72.38753,observedAtMs:Math.max(input.requestedAtMs,Date.now()),source:'wifi'});
 let client:ReturnType<typeof createSystemFactsClient>;const server=createSystemFactsServer({authorizeWeatherPurpose:async()=>{prompts++;return decision;},locate:input=>locate(input),battery:async()=>({acLineStatus:1,batteryFlag:9,batteryLifePercent:63,batteryLifeSeconds:0xffffffff})},message=>client.handle(message));client=createSystemFactsClient(message=>server.handle(message));
 const host:NativeHostServices={secrets:{available:async()=>false,seal:async()=>{throw Error('unused');},open:async()=>{throw Error('unused');}},systemFacts:client.services};
 const request:typeof fetch=async url=>{urls.push(String(url));assert(String(url).startsWith('https://api.weather.gov/'));if(String(url).includes('/points/'))return Response.json({properties:{timeZone:'UTC',forecastHourly:'https://api.weather.gov/gridpoints/BTV/100,30/forecast/hourly'}});return Response.json({properties:{periods:[{startTime:new Date(Date.now()-3600000).toISOString(),endTime:new Date(Date.now()+3600000).toISOString(),isDaytime:true,shortForecast:'Clear synthetic forecast',temperature:51,temperatureUnit:'F'}]}});};
 const options={path:join(folder,'canonical.sqlite'),provider:'fixture' as const,contentPolicy:'synthetic-only' as const};
 const create=()=>new BackendCore(options,event=>events.push(event),host,undefined,{fetch:request});let core=create();
 return {get core(){return core;},urls,events,get prompts(){return prompts;},setLocate:(fn:typeof locate)=>{locate=fn;},
  ask:async(intent="What's the weather right now?",resourceIds:string[]=[])=>{const result=await core.command('velaRouteNative',{intent,resourceIds});assert(result.matched);return result;},state:()=>core.command('vela',{name:'state',input:{}}) as Promise<VelaBackendState>,
  async reopen(){await core.command('close',{});core=create();},async close(){await core.command('close',{});server.close();client.close();assert.equal(dirname(folder),tmpdir());assert(basename(folder).startsWith('aerynth-weather-battery-'));rmSync(folder,{recursive:true,force:true});}};
}
test('actual Core/private native protocol remembers weather consent across restart and requests fresh A→B positions per question',async()=>{
 const f=fixture();try{const a=await f.ask();assert.equal(a.matched,true);assert.equal(a.request?.response?.kind,'answer');assert.equal(a.request?.planId,undefined);assert(a.request?.nativeObservation?.locationObservedAt);
 assert.equal(f.prompts,1);await f.reopen();const b=await f.ask();assert.equal(b.request?.response?.kind,'answer');assert.equal(f.prompts,1);
 assert.deepEqual(f.urls.filter(url=>url.includes('/points/')),['https://api.weather.gov/points/43.46,-72.39','https://api.weather.gov/points/44.55,-72.39']);
 const state=await f.state();assert.equal(state.plans.length,0);assert.equal(state.conversation!.messages.length,4);assert(!JSON.stringify(state).includes('72.39'));assert(!JSON.stringify(f.events).includes('72.39'));assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
 }finally{await f.close();}
});

test('the exact apostrophe-free weather question reaches native consent and a selected source cannot divert it to inference',async()=>{
 const f=fixture();try{
  const first=await f.ask('whats the weather');assert.equal(first.request?.providerId,null);assert.equal(first.request?.response?.kind,'answer');assert.equal(f.prompts,1);
  const source=(await f.state()).conversation!.resourceId;await f.reopen();
  const second=await f.ask('whats the weather outside',[source]);assert.equal(second.request?.providerId,null);assert.equal(second.request?.planId,undefined);
  assert.equal(f.prompts,1);assert.equal(f.urls.filter(url=>url.includes('/points/')).length,2);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
 }finally{await f.close();}
});
test('actual Core/private protocol rejects a stale cached timestamp without sending coordinates or asking permission again',async()=>{
 const f=fixture();try{await f.ask();f.urls.length=0;f.setLocate(async input=>({latitude:43,longitude:-72,observedAtMs:input.requestedAtMs-1,source:'wifi'}));const stale=await f.ask();assert.equal(stale.request?.response?.kind,'inability');assert.equal(stale.request?.nativeObservation,undefined);assert.equal(f.urls.length,0);assert.equal(f.prompts,1);assert.equal((await f.state()).conversation!.messages.at(-1)!.content,'Windows couldn’t get a fresh location. Check Windows Location settings and try again.');
 }finally{await f.close();}
});
test('denial persists across actual Core reopen and explicit revocation cancels pending observation before egress',async()=>{
 const denied=fixture('deny');try{await denied.ask();await denied.reopen();await denied.ask();assert.equal(denied.prompts,1);assert.equal(denied.urls.length,0);}finally{await denied.close();}
 const f=fixture();try{await f.ask();f.urls.length=0;let release!:(value:DeviceLocation)=>void;let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});f.setLocate(async()=>{started();return new Promise(resolve=>{release=resolve;});});const pending=f.ask();await ready;const before=await f.core.command('velaWeatherPermissionNative',{type:'status'});await f.core.command('velaWeatherPermissionNative',{type:'set',expectedVersion:before.version,decision:'deny'});release({latitude:43,longitude:-72,observedAtMs:Date.now(),source:'wifi'});assert.equal((await pending).request?.response?.kind,'inability');assert.equal(f.urls.length,0);await f.reopen();await f.ask();assert.equal(f.prompts,1);assert.equal(f.urls.length,0);await assert.rejects(f.core.command('velaWeatherPermissionNative',{type:'set',expectedVersion:before.version,decision:'allow'}),/stale_weather_permission/);
 }finally{await f.close();}
});
test('battery question uses existing local fact and private GetSystemPowerStatus port without inference or review plan',async()=>{
 const f=fixture();try{const answer=await f.core.command('velaRouteNative',{intent:"What's my battery level?"});assert(answer.matched);assert.equal(answer.request?.local?.capabilityId,'system.battery');assert.equal(answer.request?.response?.kind,'answer');assert.equal(answer.request?.planId,undefined);assert.match((await f.state()).conversation!.messages.at(-1)!.content,/63%.*AC power is connected and charging/s);assert.equal(f.prompts,0);assert.equal(f.urls.length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);}finally{await f.close();}
});
