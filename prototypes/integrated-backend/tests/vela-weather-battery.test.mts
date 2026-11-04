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
test('weather questions remain API work even with ordinary phrasing or selected context',async()=>{
 const f=fixture();try{for(const intent of ['whats the weather','whats the temp outside right now',"What's the weather right now?",'What is the humidity next Monday?','What is the average temperature next week?']){
  const result=await f.core.command('velaRouteNative',{intent});assert.equal(result.matched,false,intent);
 }assert.equal(f.prompts,0);assert.equal(f.urls.length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
 }finally{await f.close();}
});

test('weather purpose decisions persist independently of API request phrasing and stale permission writes are refused',async()=>{
 const f=fixture();try{const initial=await f.core.command('velaWeatherPermissionNative',{type:'status'});assert.equal(initial.decision,'unknown');
  const allowed=await f.core.command('velaWeatherPermissionNative',{type:'set',expectedVersion:initial.version,decision:'allow'});await f.reopen();
  assert.equal((await f.core.command('velaWeatherPermissionNative',{type:'status'})).decision,'allow');
  await f.core.command('velaWeatherPermissionNative',{type:'set',expectedVersion:allowed.version,decision:'deny'});await f.reopen();
  assert.equal((await f.core.command('velaWeatherPermissionNative',{type:'status'})).decision,'deny');
  await assert.rejects(f.core.command('velaWeatherPermissionNative',{type:'set',expectedVersion:initial.version,decision:'allow'}),/stale_weather_permission/);
  assert.equal(f.prompts,0);assert.equal(f.urls.length,0);
 }finally{await f.close();}
});

test('battery question uses existing local fact and private GetSystemPowerStatus port without inference or review plan',async()=>{
 const f=fixture();try{const answer=await f.core.command('velaRouteNative',{intent:"What's my battery level?"});assert(answer.matched);assert.equal(answer.request?.local?.capabilityId,'system.battery');assert.equal(answer.request?.response?.kind,'answer');assert.equal(answer.request?.planId,undefined);assert.match((await f.state()).conversation!.messages.at(-1)!.content,/63%.*AC power is connected and charging/s);assert.equal(f.prompts,0);assert.equal(f.urls.length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);}finally{await f.close();}
});
