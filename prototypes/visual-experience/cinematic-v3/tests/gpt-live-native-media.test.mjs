import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeMediaRuntime,validNativeMediaRequest} from '../src/gpt-live-native-media.ts';
const request=(operation,payload={})=>({nativeLiveHost:{version:1,kind:'request',id:randomUUID(),operation,payload}});
function fixture(){
  const sent=[],calls=[];let settings,binding,disposed=0;
  const runtime=createNativeMediaRuntime(wire=>sent.push(wire),{randomId:randomUUID,mediaFactory:options=>{settings=options;return{
    prepare:async input=>{calls.push(input);return{offerId:'offer-a',sdpOffer:'v=0 PRIVATE_OFFER'};},
    connect:async input=>{binding=input;await settings.acceptNegotiation({offerId:'offer-a',sessionId:input.sessionId,sdpAnswer:input.sdpAnswer});return{send:async command=>calls.push(command),close:async()=>calls.push('close')};},
    devices:async()=>[],state:()=>({fixture:true}),setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:()=>{},resumePlayback:async()=>{},interruptPlayback:()=>{},dispose:async()=>{disposed++;},
  };}});
  return{runtime,sent,calls,get settings(){return settings;},get binding(){return binding;},get disposed(){return disposed;}};
}
test('isolated media authenticates the cached offer/session/answer and forwards only callbacks from its media adapter',async()=>{
  const f=fixture();try{
    await f.runtime.handle(request('prepare',{attemptId:randomUUID()}));assert.deepEqual(f.calls,[{}]);
    await assert.rejects(f.settings.acceptNegotiation({offerId:'offer-a',sessionId:'invented',sdpAnswer:'v=0'}),/negotiation_denied/);
    await f.runtime.handle(request('connect',{sessionId:'session-a',sdpAnswer:'v=0 PRIVATE_ANSWER'}));
    await f.binding.onEvent({type:'session.started',session:{id:'session-a'}});
    assert.equal(f.sent.at(-1).nativeLiveHost.operation,'provider-event');assert.equal(f.sent.at(-1).nativeLiveHost.payload.sessionId,'session-a');
    await assert.rejects(f.settings.acceptNegotiation({offerId:'offer-a',sessionId:'session-a',sdpAnswer:'v=0 PRIVATE_ANSWER'}),/negotiation_denied/);
    await f.runtime.handle(request('close',{sessionId:'session-a'}));const count=f.sent.length;await f.binding.onEvent({type:'old'});assert.equal(f.sent.length,count);
    assert.ok(!JSON.stringify(f.sent.filter(w=>w.nativeLiveHost.kind==='event')).includes('PRIVATE_'));
  }finally{await f.runtime.dispose();}assert.equal(f.disposed,1);
});
test('isolated protocol rejects unsolicited credentials and session mismatch and returns fixed safe errors',async()=>{
  const f=fixture();try{
    for(const wire of [request('connect',{sessionId:'a',sdpAnswer:'v=0',apiKey:'PRIVATE'}),request('prepare',{attemptId:'a',nativeGrant:true}),request('send',{sessionId:'a',command:{type:'session.update',event_id:'x'}})]){
      assert.equal(validNativeMediaRequest(wire),false);await f.runtime.handle(wire);
    }assert.equal(f.sent.length,0);
    await f.runtime.handle(request('connect',{sessionId:'a',sdpAnswer:'PRIVATE_ANSWER'}));assert.equal(f.sent.at(-1).nativeLiveHost.error,'live_media_operation_failed');assert.equal(f.disposed,1);
    await f.runtime.handle(request('dispose'));assert.equal(f.sent.at(-1).nativeLiveHost.result,null);
  }finally{await f.runtime.dispose();}
});
test('isolated runtime bounds concurrent commands, duplicate IDs and provider event output',async()=>{
  const f=fixture();try{const first=request('devices');await f.runtime.handle(first);await f.runtime.handle(first);assert.equal(f.sent.at(-1).nativeLiveHost.error,'live_media_backpressure');
    await f.runtime.handle(request('prepare',{attemptId:randomUUID()}));await f.runtime.handle(request('connect',{sessionId:'a',sdpAnswer:'v=0'}));
    for(let i=0;i<130;i++)await f.binding.onEvent({type:'fixture'});
    assert.equal(f.disposed,1);assert.equal(f.sent.at(-1).nativeLiveHost.operation,'connection-lost');
  }finally{await f.runtime.dispose();}
});
