import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {BackendCore} from '../src/core.mts';
import type {NativeHostServices} from '../src/native-host.mts';
import {createSystemFactsClient,createSystemFactsServer,type NativeSystemFactsServices} from '../src/system-facts-host.mts';
import {WEATHER_TOOL_NAME,type WeatherQuery} from '../src/weather-tool.mts';
import type {WeatherData} from '../src/weather-data.mts';
import type {StreamEvent,VelaBackendState} from '../src/contracts.mts';
import type {VelaRequest} from '../../vela-core/src/contracts.ts';

const marker='SYNTHETIC_ONLY_CORE_WEATHER_API_KEY';
const current:WeatherQuery={startDate:null,endDate:null,period:'current',metrics:['temperature'],aggregation:'current'};
const monday:WeatherQuery={startDate:null,endDate:null,period:'next-monday',metrics:['humidity'],aggregation:'mean'};
function sse(model:string,output:unknown[],text=''){
 const id='resp-synthetic-weather-'+randomUUID();
 return new Response([
  {type:'response.created',response:{id,status:'in_progress'}},
  ...(text?[{type:'response.output_text.delta',delta:text}]:[]),
  {type:'response.completed',response:{id,status:'completed',model,output,usage:{input_tokens:20,output_tokens:10,total_tokens:30}}},
 ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function fixture(decision:'allow'|'deny'='allow'){
 const directory=mkdtempSync(join(tmpdir(),'aerynth-core-api-weather-')),key=randomBytes(32),bodies:any[]=[],sourceUrls:string[]=[],events:StreamEvent[]=[],outputs:WeatherData[]=[];
 let prompts=0,fixes=0,core:BackendCore,revokeVersion:number|undefined,revocation:Promise<unknown>|undefined;
 let locate:NativeSystemFactsServices['locate']=async input=>({latitude:fixes++?44.551:43.45827,longitude:-72.38753,observedAtMs:Math.max(input.requestedAtMs,Date.now()),source:'wifi'});
 let client:ReturnType<typeof createSystemFactsClient>;
 const server=createSystemFactsServer({authorizeWeatherPurpose:async()=>{prompts++;return decision;},locate:input=>locate(input),battery:async()=>{throw Error('unexpected_battery');}},message=>client.handle(message));
 client=createSystemFactsClient(message=>server.handle(message));
 const host:NativeHostServices={systemFacts:client.services,secrets:{available:async()=>true,
  seal:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},
  open:async bytes=>{const data=Buffer.from(bytes),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();},
 }};
 const exchanges:{query:WeatherQuery;answer:string;inspect?:(data:WeatherData)=>void}[]=[];let active:typeof exchanges[number]|undefined;
 const request:typeof fetch=async(url,init)=>{
  const target=String(url);
  if(target==='https://api.openai.com/v1/models')return Response.json({data:[{id:'gpt-6-luna'}]});
  if(target.startsWith('https://api.weather.gov/')){
   sourceUrls.push(target);assert.equal(new Headers(init?.headers).has('authorization'),false);
   if(target.includes('/points/'))return Response.json({properties:{timeZone:'UTC',forecastHourly:'https://api.weather.gov/gridpoints/BTV/100,30/forecast/hourly',relativeLocation:{properties:{city:'SYNTHETIC_NEVER_SHARE_CITY',state:'XX'}}}});
   assert.equal(target,'https://api.weather.gov/gridpoints/BTV/100,30/forecast/hourly');const hour=Math.floor(Date.now()/3600000)*3600000;
   return Response.json({properties:{generatedAt:new Date(hour).toISOString(),periods:Array.from({length:192},(_,index)=>({startTime:new Date(hour+index*3600000).toISOString(),endTime:new Date(hour+(index+1)*3600000).toISOString(),temperature:55,temperatureUnit:'F',relativeHumidity:{unitCode:'wmoUnit:percent',value:61},shortForecast:'Clear synthetic forecast'}))}});
  }
  assert.equal(target,'https://api.openai.com/v1/responses');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);
  const body=JSON.parse(String(init?.body));bodies.push(body);assert.equal(body.model,'gpt-6-luna');assert(body.tools.some((tool:any)=>tool.name===WEATHER_TOOL_NAME));assert.equal(body.store,false);assert.equal(body.previous_response_id,undefined);
  const returned=body.input.filter((item:any)=>item.type==='function_call_output');
  if(returned.length){assert(active,'missing_synthetic_weather_exchange');assert.equal(returned.length,1);const data=JSON.parse(returned[0].output) as WeatherData;outputs.push(data);active.inspect?.(data);const answer=active.answer;active=undefined;return sse(body.model,[{type:'message',id:'msg-'+randomUUID(),role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]}],answer);}
  active=exchanges.shift();assert(active,'unexpected_synthetic_api_call');return sse(body.model,[{type:'function_call',id:'fc-'+randomUUID(),call_id:'call-'+randomUUID(),name:WEATHER_TOOL_NAME,arguments:JSON.stringify(active.query),status:'completed'}]);
 };
 const create=()=>new BackendCore({path:join(directory,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'},event=>{
  events.push(event);
  if(event.type==='vela.routing.weather_data_observed'&&revokeVersion!==undefined){const expectedVersion=revokeVersion;revokeVersion=undefined;revocation=core.command('velaWeatherPermissionNative',{type:'set',expectedVersion,decision:'deny'});void revocation.catch(()=>{});}
 },host,undefined,{fetch:request});core=create();
 return{get core(){return core;},bodies,sourceUrls,events,outputs,get prompts(){return prompts;},get fixes(){return fixes;},
  async ready(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:marker},expectedVersion:null});await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});},
  async ask(intent:string,query:WeatherQuery,answer:string,inspect?:(data:WeatherData)=>void){
   assert.equal((await core.command('velaRouteNative',{intent,resourceIds:[]})).matched,false,'weather language belongs to the API tool path');
   const preview=await core.command('velaRequestPreview',{intent,resourceIds:[],adaptive:true});assert.equal(preview.providerId,'openai-api-vela');assert.equal(prompts,outputs.length?1:0,'preview never prompts for location');
   const review=await core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});
   const grant=await core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,...(preview.sendDisposition==='routine'?{directSend:true}:{})});
   exchanges.push({query,answer,...(inspect?{inspect}:{})});return await core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as VelaRequest;
  },
  state:()=>core.command('vela',{name:'state',input:{}}) as Promise<VelaBackendState>,setLocate:(next:typeof locate)=>{locate=next;},
  revokeAfterRead(version:number){revokeVersion=version;},async revoked(){assert(revocation,'actual_native_weather_observation_event_required');await revocation;},
  assertPrivate(){for(const body of bodies){const raw=JSON.stringify(body);for(const privateText of [marker,'43.46','44.55','-72.39','SYNTHETIC_NEVER_SHARE_CITY','api.weather.gov/gridpoints',directory])assert(!raw.includes(privateText),'private weather details entered model body');}},
  async reopen(){await core.command('close',{});core=create();},
  async close(){await core.command('close',{});server.close();client.close();assert.equal(dirname(directory),tmpdir());assert(basename(directory).startsWith('aerynth-core-api-weather-'));rmSync(directory,{recursive:true,force:true});},
 };
}

test('actual Core answers the exact outside-temperature question through API weather data, then remembers consent and uses a fresh fix after reopen',async()=>{
 const f=fixture();try{await f.ready();const first=await f.ask('whats the temp outside right now',current,'The current hour forecast is 55°F.',data=>{assert.equal(data.status,'complete');assert.equal(data.current?.values.temperature?.mean,55);});
  assert.equal(first.state,'responded');assert.equal(first.providerId,'openai-api-vela');assert.equal(first.response?.kind,'answer');assert.equal(first.planId,undefined);assert.equal(first.nativeObservation,undefined);assert.equal(f.prompts,1);
  await f.reopen();const second=await f.ask('what will the humidity average next Monday be',monday,'Monday’s complete forecast averages 61% humidity.',data=>{assert.equal(data.requested.period,'next-monday');assert.equal(data.coverage.complete,true);assert.equal(data.aggregate?.values.humidity?.mean,61);});
  assert.equal(second.state,'responded');assert.equal(second.providerId,'openai-api-vela');assert.equal(f.prompts,1);assert.equal(f.fixes,2);assert.deepEqual(f.sourceUrls.filter(url=>url.includes('/points/')),['https://api.weather.gov/points/43.46,-72.39','https://api.weather.gov/points/44.55,-72.39']);
  const state=await f.state();assert.equal(state.plans.length,0);assert.equal(state.conversation?.messages.length,4);const snapshot=await f.core.command('snapshot',{}),answers=snapshot.graph.messages.filter(message=>message.role==='assistant');assert.equal(answers.length,2);assert(answers.every(message=>snapshot.messageEvidence[message.id].providerId==='openai-api-vela'));assert.equal((await f.core.command('providerActivity',{})).codexConnections,0);f.assertPrivate();
 }finally{await f.close();}
});

test('purpose denial is durable and reaches the API as unavailable data without a device fix or invented forecast',async()=>{
 const f=fixture('deny');try{await f.ready();for(let index=0;index<2;index++){const result=await f.ask('whats the temp outside right now',current,'Location sharing is off; I cannot provide a local forecast.',data=>{assert.equal(data.status,'unavailable');assert.equal(data.current,null);assert.equal(data.source.locationObservedAt,null);});assert.equal(result.state,'responded');if(index===0)await f.reopen();}assert.equal(f.prompts,1);assert.equal(f.fixes,0);assert.equal(f.sourceUrls.length,0);assert.equal(f.bodies.length,4);assert.equal((await f.state()).plans.length,0);f.assertPrivate();}finally{await f.close();}
});

test('a stale native fix produces truthful unavailable tool data with no coordinate request to the weather source',async()=>{
 const f=fixture();try{await f.ready();f.setLocate(async input=>({latitude:43.45827,longitude:-72.38753,observedAtMs:input.requestedAtMs-1,source:'wifi'}));const result=await f.ask('whats the temp outside right now',current,'Windows did not provide a fresh location; I cannot give a current forecast.',data=>{assert.equal(data.status,'unavailable');assert.equal(data.errorCode,'location_stale_fix');assert.equal(data.current,null);});assert.equal(result.state,'responded');assert.equal(f.sourceUrls.length,0);assert.equal(f.bodies.length,2);f.assertPrivate();}finally{await f.close();}
});

test('revocation at the actual completed native read event prevents a model continuation and cannot publish stale weather',async()=>{
 const f=fixture();try{await f.ready();await f.ask('whats the temp outside right now',current,'The current hour forecast is 55°F.');const before=await f.core.command('velaWeatherPermissionNative',{type:'status'});f.revokeAfterRead(before.version);const count=f.bodies.length;
  const result=await f.ask('what will the humidity average next Monday be',monday,'THIS_SYNTHETIC_ANSWER_MUST_NOT_BE_DISPATCHED');await f.revoked();assert.notEqual(result.state,'responded');assert.equal(f.bodies.length,count+1);assert.equal(f.outputs.length,1);assert.equal((await f.core.command('velaWeatherPermissionNative',{type:'status'})).decision,'deny');assert(!(await f.state()).conversation?.messages.some(message=>message.content.includes('THIS_SYNTHETIC_ANSWER_MUST_NOT_BE_DISPATCHED')));f.assertPrivate();
 }finally{await f.close();}
});
