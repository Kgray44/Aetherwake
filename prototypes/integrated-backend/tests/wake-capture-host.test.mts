import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeWakeCaptureClient,createNativeWakeCaptureServer,validNativeWakeCaptureMessage,validWakeCaptureState,encodeNativeWakeFrame,decodeNativeWakeFrame,type NativeWakeCaptureMessage,type WakeCaptureState } from '../src/wake-capture-host.mts';
const off=():WakeCaptureState=>({contract:'aerynth.wake-audio-capture@1',generation:null,phase:'off',microphone:'off',sampleRate:null,inputDevice:'default',frames:0,pendingFrames:0,signalActivity:'unavailable',activitySource:'local-rms-only'});
const active=(generation=1):WakeCaptureState=>({...off(),generation,phase:'capturing',microphone:'active',sampleRate:16000});
test('two private capture hops carry validated generation controls and opaque leases without PCM or private diagnostics',async()=>{
  const messages:NativeWakeCaptureMessage[]=[];let upstream:ReturnType<typeof createNativeWakeCaptureClient>,downstream:ReturnType<typeof createNativeWakeCaptureClient>;
  let generation=0;const actual=createNativeWakeCaptureServer({arm:async input=>{generation=input.generation;return active(generation);},pause:async()=>({...active(generation),phase:'handoff'}),stop:async()=>({...off(),generation,phase:'stopped',microphone:'released'}),state:async()=>off(),
    lease:async input=>{assert.equal(input.generation,generation);return {leaseRef:'opaque-main-lease',postWakeSpeech:'present'};},releaseLease:async input=>({released:input.leaseRef==='opaque-main-lease'})},message=>{messages.push(message);downstream.handle(message);});
  downstream=createNativeWakeCaptureClient(message=>{messages.push(message);actual.handle(message);});
  const relay=createNativeWakeCaptureServer(downstream.services,message=>upstream.handle(message));
  upstream=createNativeWakeCaptureClient(message=>relay.handle(message));
  try{assert.equal((await upstream.services.arm({generation:7})).generation,7);assert.equal((await upstream.services.pause({generation:7})).phase,'handoff');
    const lease=await upstream.services.lease!({generation:7,keywordEndSample:480,detectedAtSample:640});assert.equal(lease.leaseRef,'opaque-main-lease');assert.deepEqual(await upstream.services.releaseLease!({leaseRef:lease.leaseRef}),{released:true});
    assert.ok(messages.every(validNativeWakeCaptureMessage));assert.ok(!JSON.stringify(messages).includes('pcmBase64'));
  }finally{upstream.dispose();downstream.dispose();relay.dispose();actual.dispose();}
});
test('normal capacity cannot absorb a generation-scoped or master stop; only identical stop scopes coalesce',async()=>{
  const messages:NativeWakeCaptureMessage[]=[],client=createNativeWakeCaptureClient(message=>messages.push(message),{timeoutMs:100});
  const requests=Array.from({length:8},()=>client.services.state().catch(error=>error.code));
  const a=client.services.stop({generation:1}),same=client.services.stop({generation:1}),b=client.services.stop({generation:2}),c=client.services.stop({generation:3}),master=client.services.stop({});
  assert.equal(a,same);assert.notEqual(a,master);assert.equal(client.pending(),12);
  await assert.rejects(client.services.stop({generation:4}),/wake_host_capacity/);await assert.rejects(client.services.state(),/wake_host_capacity/);
  for(const message of messages){const h=message.nativeWakeHost;client.handle({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:h.operation,result:off()}});}
  await Promise.all([...requests,a,b,c,master]);client.dispose();
});
test('malformed, wrong-operation, wrong-generation and late responses cannot authorize local capture',async()=>{
  const messages:NativeWakeCaptureMessage[]=[],client=createNativeWakeCaptureClient(message=>messages.push(message),{timeoutMs:20});
  const pending=client.services.arm({generation:3});const h=messages[0].nativeWakeHost;
  client.handle({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:'state',result:active(3)}});
  client.handle({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:'arm',result:active(4)}});
  await assert.rejects(pending,/wake_host_protocol/);
  const timeout=client.services.state();await assert.rejects(timeout,/wake_host_timeout/);assert.equal(client.pending(),0);
  client.handle({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:'arm',result:active(3)}});
  assert.equal(client.pending(),0);client.dispose();await assert.rejects(client.services.state(),/wake_host_closed/);
});
test('state consistency and actual frame RMS are checked, with private decode buffers owned by the receiver',()=>{
  assert.equal(validWakeCaptureState({...off(),phase:'capturing'}),false);assert.equal(validWakeCaptureState({...active(),microphone:'off'}),false);
  const samples=new Float32Array(640).fill(.125),frame={generation:1,sequence:0,startSample:0,sampleRate:16000 as const,samples,signalActivity:'signal' as const,rms:.125,mode:'detector' as const};
  const wire=encodeNativeWakeFrame(frame),decoded=decodeNativeWakeFrame(wire);assert.deepEqual(decoded.samples,samples);decoded.samples.fill(0);assert.equal(samples[0],.125);
  assert.throws(()=>decodeNativeWakeFrame({...wire,rms:.2}),/wake_host_protocol/);assert.throws(()=>decodeNativeWakeFrame({...wire,sequence:1}),/wake_host_protocol/);
  assert.throws(()=>decodeNativeWakeFrame({...wire,pcmBase64:'a'.repeat(3416)}),/wake_host_protocol/);
});
test('server replays and private exceptions are bounded and never return raw diagnostics',async()=>{
  const sent:NativeWakeCaptureMessage[]=[],server=createNativeWakeCaptureServer({arm:async()=>{throw Error('PRIVATE_PATH_CREDENTIAL_MUST_NOT_ESCAPE');},pause:async()=>off(),stop:async()=>off(),state:async()=>off()},message=>sent.push(message));
  const client=createNativeWakeCaptureClient(message=>{server.handle(message);server.handle(message);},{timeoutMs:20});
  const pending=client.services.arm({generation:1});await new Promise(done=>setTimeout(done,0));assert.equal(sent.length,2);assert.ok(sent.every(message=>['wake_host_capacity','wake_host_failed'].includes(message.nativeWakeHost.error!)));
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'));for(const message of sent)client.handle(message);await assert.rejects(pending);client.dispose();server.dispose();
});
test('server timeout releases request capacity and a late arm receives generation-bound physical cleanup',async()=>{
  let release!:(value:WakeCaptureState)=>void;const stops:unknown[]=[],sent:NativeWakeCaptureMessage[]=[];
  const server=createNativeWakeCaptureServer({arm:async()=>new Promise(resolve=>{release=resolve;}),pause:async()=>off(),state:async()=>off(),stop:async scope=>{stops.push(scope);return off();}},message=>sent.push(message),{timeoutMs:5});
  const client=createNativeWakeCaptureClient(message=>server.handle(message),{timeoutMs:100});
  const promise=client.services.arm({generation:4});await new Promise(resolve=>setTimeout(resolve,15));for(const message of sent)client.handle(message);await assert.rejects(promise,/wake_host_timeout/);
  release(active(4));await new Promise(resolve=>setTimeout(resolve,0));assert.ok(stops.filter((scope:any)=>scope.generation===4).length>=2);
  assert.equal(sent.length,1);client.dispose();server.dispose();assert.deepEqual(stops.at(-1),{});
});
