import test from 'node:test';
import assert from 'node:assert/strict';
import {createSystemFactsClient,createSystemFactsServer} from '../src/system-facts-host.mts';
import {readLocalWeather} from '../src/local-weather.mts';

test('private system-facts hops retain bounded consent states and reject invented location diagnostics',async()=>{
 for(const code of ['location_os_denied','location_permission_unspecified','location_cancelled','location_permission_timeout','location_native_consent_unavailable','location_fresh_fix_unavailable','location_private_account_details']){
  let client:ReturnType<typeof createSystemFactsClient>;
  const server=createSystemFactsServer({authorizeWeatherPurpose:async()=> 'allow',locate:async()=>{throw Error(code);},battery:async()=>{throw Error('unused');}},message=>client.handle(message));
  client=createSystemFactsClient(message=>server.handle(message));
  try{await assert.rejects(client.services.locate({requestedAtMs:Date.now()}),error=>error instanceof Error&&error.message===(code==='location_private_account_details'?'location_native_unavailable':code));}
  finally{server.close();client.close();}
 }
 let pending:any;
 const client=createSystemFactsClient(message=>{pending=message.systemHost;});
 try{const call=client.services.locate({requestedAtMs:Date.now()});client.handle({systemHost:{version:1,kind:'response',id:pending.id,operation:'locate',error:'location_sensitive_private_text'}});await assert.rejects(call,{message:'location_native_unavailable'});}
 finally{client.close();}
});

test('unspecified, cancelled and timed-out consent never claims Windows denial or sends a forecast request',async()=>{
 let requests=0;
 const request:typeof fetch=async()=>{requests++;throw Error('unexpected_forecast_request');};
 for(const code of ['location_permission_unspecified','location_cancelled','location_permission_timeout','location_native_consent_unavailable']){
  const result=await readLocalWeather('now',new AbortController().signal,{locate:async()=>{throw Error(code);},request});
  assert.equal(result.ok,false);assert.equal(result.content,'Windows couldn’t get a fresh location. Check Windows Location settings and try again.');assert.doesNotMatch(result.content,/blocked|denied/iu);
 }
 const denied=await readLocalWeather('now',new AbortController().signal,{locate:async()=>{throw Error('location_os_denied');},request});
 assert.match(denied.content,/Windows Location access is blocked/u);assert.equal(requests,0);
});
