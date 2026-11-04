import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createNativeWakeRuntime,validNativeWakeRequest,validSyntheticWakePcm} from '../src/wake-native-capture.ts';
const request=(operation,payload={})=>({nativeWakeCapture:{version:1,kind:'request',id:randomUUID(),operation,payload}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
  const sent=[],calls=[],controls={};let settings,revision=0,state={contract:'aerynth.wake-audio-capture@1',generation:null,phase:'off',microphone:'off',
    sampleRate:null,inputDevice:'default',frames:0,pendingFrames:0,signalActivity:'unavailable',activitySource:'local-rms-only'};
  const runtime=createNativeWakeRuntime((kind,value)=>sent.push({kind,value}),{workletUrl:'file:///owned/vela-wake-pcm-worklet.js',captureFactory:options=>{
    settings=options;return {state:()=>({...state}),async start(input){const epoch=++revision;calls.push({kind:'start',input});if(controls.arm)await controls.arm.promise;
      if(epoch===revision)state={...state,generation:input.generation,phase:'capturing',microphone:'active',sampleRate:16000};return {...state};},
      pause(generation){assert.equal(generation,state.generation);state={...state,phase:'handoff'};return {...state};},
      async stop(generation){calls.push({kind:'stop',generation});if(generation===undefined||generation===state.generation){revision++;state={...state,phase:'stopped',microphone:'released'};}return {...state};},
      async dispose(){calls.push({kind:'dispose'});revision++;state={...state,phase:'disposed',microphone:'released'};return {...state};},
    };}});
  return {runtime,sent,calls,controls,get settings(){return settings;}};
}
const frame=(sequence=0,generation=1)=>({generation,sequence,startSample:sequence*640,sampleRate:16000,samples:new Float32Array(640),signalActivity:'quiet',rms:0,mode:'detector'});
test('isolated private capture requests reject extra authority, PCM and model fields',()=>{
  assert(validNativeWakeRequest(request('arm',{generation:1,inputDeviceId:'owned-device'})));
  for(const value of [request('arm',{generation:1,userGesture:true}),request('arm',{generation:1,apiKey:'PRIVATE'}),request('arm',{generation:1,samples:[]}),
    request('arm',{generation:0}),request('arm',{generation:1,workletUrl:'https://foreign'}),request('recognize',{generation:1}),request('state',{enabled:true})])assert.equal(validNativeWakeRequest(value),false);
});
test('state read and refused source injection never construct a capture or request a microphone',async()=>{
  const f=fixture();await f.runtime.handle(request('state'));assert.equal(f.calls.length,0);assert.equal(f.sent[0].value.nativeWakeCapture.result.microphone,'off');
  assert.equal(f.runtime.setSyntheticPcm({sampleRate:16000,samples:new Float32Array(640)}),false);await f.runtime.dispose();
});
test('native ACK must match generation/sequence, and no frame can be acknowledged before owned handling completes',async()=>{
  const f=fixture();await f.runtime.handle(request('arm',{generation:1}));const delivery=f.settings.onFrame(frame());let done=false;delivery.then(()=>done=true);
  f.runtime.ack({generation:2,sequence:0});await flush();assert.equal(done,false);f.runtime.ack({generation:1,sequence:0,forged:true});await flush();assert.equal(done,false);
  f.runtime.ack({generation:1,sequence:0});await delivery;assert.equal(done,true);assert.equal(f.sent.filter(value=>value.kind==='frame').length,1);await f.runtime.dispose();
});
test('stop bypasses pending arm and the replay/capacity lanes',async()=>{
  const f=fixture();f.controls.arm=deferred();const arming=f.runtime.handle(request('arm',{generation:1}));await flush();
  await f.runtime.handle(request('pause',{generation:1}));assert.equal(f.sent.at(-1).value.nativeWakeCapture.error,'wake_capture_busy');
  await f.runtime.handle(request('stop'));assert(f.calls.some(value=>value.kind==='stop'));assert.equal(f.runtime.state().phase,'stopped');
  f.controls.arm.resolve();await arming;assert.equal(f.runtime.state().phase,'stopped');await f.runtime.dispose();
});
test('stale-generation stop preserves new native capture and its outstanding ACK',async()=>{
  const f=fixture();await f.runtime.handle(request('arm',{generation:2}));const delivery=f.settings.onFrame(frame(0,2));let resolved=false;delivery.then(()=>resolved=true);
  await f.runtime.handle(request('stop',{generation:1}));assert.equal(f.runtime.state().phase,'capturing');await flush();assert.equal(resolved,false);
  f.runtime.ack({generation:2,sequence:0});await delivery;await f.runtime.dispose();
});
test('four ACK waits are bounded, and stop rejects every outstanding frame without retaining its audio',async()=>{
  const f=fixture();await f.runtime.handle(request('arm',{generation:1}));const deliveries=Array.from({length:4},(_,i)=>f.settings.onFrame(frame(i)));
  const rejected=deliveries.map(delivery=>assert.rejects(delivery,/wake_capture_stopped/));await assert.rejects(f.settings.onFrame(frame(4)),/backpressure/);
  await f.runtime.handle(request('stop',{generation:1}));await Promise.all(rejected);await f.runtime.dispose();
});
test('synthetic fixture validation is exact PCM with a two-MiB private bound and no ambient permission substitute',()=>{
  assert(validSyntheticWakePcm({sampleRate:16000,samples:new Float32Array(640)}));
  for(const value of [{sampleRate:48000,samples:new Float32Array(640)},{sampleRate:16000,samples:new Float32Array(524289)},
    {sampleRate:16000,samples:new Float32Array(640).fill(Infinity)},{sampleRate:16000,samples:new Float32Array(640),userConsent:true}])assert.equal(validSyntheticWakePcm(value),false);
});
test('sandbox preload never exposes a main-world API or model and only the fixed native worklet is executable',()=>{
  const source=readFileSync(new URL('../src/wake-native-capture.ts',import.meta.url),'utf8'),html=readFileSync(new URL('../native/wake-media.html',import.meta.url),'utf8');
  assert.doesNotMatch(source,/contextBridge|exposeInMainWorld|apiKey|https:\/\/api\./);assert.match(html,/default-src 'none'/);assert.match(html,/connect-src 'none'/);
  assert.match(html,/script-src 'self'/);assert.doesNotMatch(html,/<script\b|<iframe\b|<webview\b/);
});
test('approved synthetic PCM begins after consumer readiness and all synthetic buffers/tracks are cleared on stop',async t=>{
  const prior=globalThis.AudioContext,contexts=[];globalThis.AudioContext=class{
    sampleRate=16000;
    constructor(){this.starts=0;this.closed=0;contexts.push(this);}
    createMediaStreamDestination(){const track={stops:0,stop(){this.stops++;}};this.track=track;return {stream:{getTracks:()=>[track]}};}
    createBufferSource(){return {connect(){},disconnect(){},start:()=>this.starts++,stop(){}};}
    createBuffer(_channels,length){const data=new Float32Array(length);this.data=data;return {copyToChannel:value=>data.set(value),getChannelData:()=>data};}
    async resume(){}async close(){this.closed++;}
  };t.after(()=>{if(prior===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=prior;});
  let environment;const runtime=createNativeWakeRuntime(()=>{},{syntheticInput:true,workletUrl:'file:///owned/vela-wake-pcm-worklet.js',captureFactory:options=>{
    environment=options.environment;return {state(){return {};},async start(){return {};},pause(){return {};},async stop(){return {};},async dispose(){return {};}};
  }});
  const samples=new Float32Array(640).fill(0.25);assert.equal(runtime.setSyntheticPcm({sampleRate:16000,samples}),true);await environment.getUserMedia({});
  assert.equal(contexts[0].starts,0,'the approved phrase prefix is not played while the consumer worklet is still loading');
  assert(contexts[0].data.every(value=>value===0.25));await environment.startSource();assert.equal(contexts[0].starts,1);
  await runtime.dispose();assert(contexts[0].data.every(value=>value===0));assert(contexts[0].track.stops>0);assert(contexts[0].closed>0);
});
