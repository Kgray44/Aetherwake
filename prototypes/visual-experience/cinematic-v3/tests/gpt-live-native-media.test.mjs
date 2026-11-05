import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNativeMediaRuntime,validNativeMediaRequest} from '../src/gpt-live-native-media.ts';
const request=(operation,payload={})=>({nativeLiveHost:{version:1,kind:'request',id:randomUUID(),operation,payload}});
function fixture(options={}){
  const sent=[],calls=[];let settings,binding,disposed=0;
  const runtime=createNativeMediaRuntime(wire=>sent.push(wire),{...options,randomId:randomUUID,mediaFactory:mediaOptions=>{settings=mediaOptions;return{
    prepare:async input=>{calls.push(input);if(options.readStream)calls.push(await settings.environment.getUserMedia({audio:true}));return{offerId:'offer-a',sdpOffer:'v=0 PRIVATE_OFFER'};},
    connect:async input=>{binding=input;await settings.acceptNegotiation({offerId:'offer-a',sessionId:input.sessionId,sdpAnswer:input.sdpAnswer});return{send:async command=>calls.push(command),close:async()=>calls.push('close')};},
    devices:async()=>[],state:()=>({fixture:true}),setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:()=>{},resumePlayback:async()=>{},interruptPlayback:()=>{},quiesceCapture:async session=>calls.push({quiesce:session??'all'}),dispose:async()=>{disposed++;},
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

test('private output-only prepare is forwarded exactly and cannot combine microphone or wake capture authority',async()=>{
  const f=fixture();try{
    const attemptId=randomUUID();await f.runtime.handle(request('prepare',{attemptId,outputOnly:true,outputDeviceId:'speaker'}));
    assert.deepEqual(f.calls,[{outputDeviceId:'speaker',outputOnly:true}]);
    for(const payload of [{attemptId,outputOnly:false},{attemptId,outputOnly:true,inputDeviceId:'mic'},{attemptId,outputOnly:true,bufferLeaseRef:'lease'}])assert.equal(validNativeMediaRequest(request('prepare',payload)),false);
  }finally{await f.runtime.dispose();}
});

test('wake input uses one already-owned stream, preserves command audio until matching session start and erases rejected PCM',async()=>{
  const stream={nativeOwned:true},queued=[],calls=[];let next=0;
  const f=fixture({wakeInputEnabled:true,readStream:true,wakeFactory:()=>({stream,ready:async()=>calls.push('ready'),
    append(start,samples){assert.equal(start,next);queued.push(new Float32Array(samples));next+=samples.length;},
    activate:async()=>calls.push('activate'),quiesce:()=>calls.push('quiesce'),dispose:async()=>calls.push('dispose')})});
  const attemptId=randomUUID();try{
    await f.runtime.handle(request('prepare',{attemptId,bufferLeaseRef:'private-lease',inputDeviceId:'private-device',outputDeviceId:'speaker'}));
    assert.deepEqual(f.calls,[{outputDeviceId:'speaker'},stream]);assert(!calls.includes('activate'));
    const samples=new Float32Array([.25,.5]);assert.deepEqual(f.runtime.wakePcm({attemptId,startSample:0,samples}),{accepted:true,nextSample:2});
    assert.deepEqual([...samples],[0,0]);assert.deepEqual([...queued[0]],[.25,.5]);
    const foreign=new Float32Array([.3]);assert.throws(()=>f.runtime.wakePcm({attemptId:'foreign',startSample:2,samples:foreign}),/live_media_protocol/);assert.equal(foreign[0],0);
    await f.runtime.handle(request('connect',{sessionId:'wake:one',sdpAnswer:'v=0'}));
    await f.binding.onEvent({type:'session.started',session:{id:'foreign'}});assert(!calls.includes('activate'));
    await f.binding.onEvent({type:'session.started',session:{id:'wake:one'}});assert.equal(calls.filter(x=>x==='activate').length,1);
    await f.runtime.handle(request('quiesceCapture',{attemptId:'stale',sessionId:'wake:one'}));assert(!calls.includes('quiesce'));
    await f.runtime.handle(request('quiesceCapture',{attemptId,sessionId:'wake:one'}));assert(calls.includes('quiesce'));
    await f.runtime.handle(request('send',{sessionId:'wake:one',command:{type:'session.close',event_id:'closed'}}));assert.equal(f.calls.at(-1).type,'session.close');
    assert.doesNotMatch(JSON.stringify(f.sent),/private-lease|private-device|nativeOwned|samples/);
  }finally{await f.runtime.dispose();}
});

test('an opaque audio lease alone cannot enable the private wake input',async()=>{
  const f=fixture();try{await f.runtime.handle(request('prepare',{attemptId:randomUUID(),bufferLeaseRef:'untrusted-lease'}));
    assert.equal(f.calls.length,0);assert.equal(f.disposed,1);assert.equal(f.sent.at(-1).nativeLiveHost.error,'live_media_operation_failed');
  }finally{await f.runtime.dispose();}
});
test('private quiesce binds the current attempt/session and master quiesce keeps the finalization channel usable',async()=>{
  const f=fixture(),attemptId=randomUUID();try{
    await f.runtime.handle(request('prepare',{attemptId}));await f.runtime.handle(request('connect',{sessionId:'current',sdpAnswer:'v=0'}));
    await f.runtime.handle(request('quiesceCapture',{attemptId:'old-attempt',sessionId:'current'}));assert.ok(!f.calls.some(call=>call.quiesce));
    await f.runtime.handle(request('quiesceCapture',{attemptId,sessionId:'foreign'}));assert.ok(!f.calls.some(call=>call.quiesce));
    await f.runtime.handle(request('quiesceCapture',{attemptId,sessionId:'current'}));assert.deepEqual(f.calls.at(-1),{quiesce:'current'});
    await f.runtime.handle(request('quiesceAll'));assert.deepEqual(f.calls.at(-1),{quiesce:'all'});
    await f.runtime.handle(request('send',{sessionId:'current',command:{type:'session.close',event_id:'close'}}));assert.equal(f.calls.at(-1).type,'session.close');assert.equal(f.disposed,0);
  }finally{await f.runtime.dispose();}
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
