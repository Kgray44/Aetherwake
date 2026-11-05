import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {WakeAudioCapture,validWakeWorkletFrame} from '../src/wake-audio-capture.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const frame=(sequence=0,value=0)=>({kind:'frame',sequence,startSample:sequence*640,sampleRate:16000,samples:new Float32Array(640).fill(value),signalActivity:Math.abs(value)>=0.01?'signal':'quiet',rms:Math.abs(value)});
function fixture(){
  const constraints=[],contexts=[],worklets=[],streams=[],states=[],frames=[],controls={};
  const stream=()=>{const track={stops:0,stop(){this.stops++;},onended:null},value={track,getTracks:()=>[track],getAudioTracks:()=>[track],getVideoTracks:()=>[]};streams.push(value);return value;};
  let stamp=0;
  const capture=new WakeAudioCapture({workletUrl:'file:///owned/dist/vela-wake-pcm-worklet.js',onState:state=>states.push(state),
    onFrame:async value=>{frames.push(value);if(controls.ack)await controls.ack.promise;},environment:{
      getUserMedia:async value=>{constraints.push(value);return controls.media?controls.media.promise:stream();},
      now:()=>stamp,createContext:()=>{const context={sampleRate:controls.sampleRate??16000,closed:0,nodes:[],destination:{},
        audioWorklet:{addModule:async url=>{context.module=url;if(controls.module)await controls.module.promise;}},
        createMediaStreamSource:()=>{const value={disconnects:0,connect(target){this.target=target;},disconnect(){this.disconnects++;}};context.nodes.push(value);return value;},
        createGain:()=>{const value={gain:{value:1},disconnects:0,connect(target){this.target=target;},disconnect(){this.disconnects++;}};context.nodes.push(value);return value;},
        resume:async()=>{if(controls.resume)await controls.resume.promise;},close:async()=>{context.closed++;}};contexts.push(context);return context;},
      createWorklet:context=>{const value={port:{onmessage:null,acks:[],postMessage(ack){this.acks.push(ack);},close(){this.closed=true;}},onprocessorerror:null,disconnects:0,
        connect(target){this.target=target;},disconnect(){this.disconnects++;}};context.nodes.push(value);worklets.push(value);return value;},
    }});
  return {capture,constraints,contexts,worklets,streams,states,frames,controls,stream,stamp(value){stamp=value;},
    emit(value){worklets.at(-1).port.onmessage?.({data:value});},async start(generation=1){return capture.start({generation,inputDeviceId:'native-selected-device'});}};
}
test('OFF/state reads do not open devices; actual 16k context resamples hardware and the local graph is silent',async()=>{
  const f=fixture();assert.equal(f.capture.state().phase,'off');assert.equal(f.constraints.length,0);
  const state=await f.start();assert.equal(state.phase,'capturing');assert.equal(state.sampleRate,16000);
  assert.equal(f.constraints[0].video,false);assert.deepEqual(f.constraints[0].audio.deviceId,{exact:'native-selected-device'});
  assert.equal(f.contexts[0].nodes.find(node=>node.gain).gain.value,0);assert.doesNotMatch(JSON.stringify(state),/native-selected-device|samples|speech/);
  await f.capture.stop();assert(f.streams[0].track.stops>0);assert(f.contexts[0].closed>0);assert(f.worklets[0].port.closed);
});
test('hardware permission resolving after stop releases its tracks and never constructs an audio context',async()=>{
  const f=fixture();f.controls.media=deferred();const starting=f.start();await f.capture.stop();const stream=f.stream();f.controls.media.resolve(stream);await starting;
  assert(stream.track.stops>0);assert.equal(f.contexts.length,0);assert.equal(f.capture.state().phase,'stopped');
});
test('stop during worklet module load releases the actual tracks/context and refuses a late graph',async()=>{
  const f=fixture();f.controls.module=deferred();const starting=f.start();await flush();await f.capture.stop();assert(f.streams[0].track.stops>0);
  f.controls.module.resolve();await starting;assert.equal(f.worklets.length,0);assert.equal(f.capture.state().phase,'stopped');
});
test('late old context resume cleanup cannot destroy a newer generation capture graph',async()=>{
  const f=fixture();const oldResume=deferred();f.controls.resume=oldResume;const first=f.start();await flush();await f.capture.stop();
  delete f.controls.resume;await f.start(2);const current=f.contexts[1],stream=f.streams[1];oldResume.resolve();await first;
  assert.equal(current.closed,0);assert.equal(stream.track.stops,0);assert.equal(f.capture.state().generation,2);assert.equal(f.capture.state().phase,'capturing');await f.capture.dispose();
});
test('a non-16k actual context fails closed instead of mislabeling its samples',async()=>{
  const f=fixture();f.controls.sampleRate=48000;const state=await f.start();assert.equal(state.phase,'failed');assert.equal(state.sampleRate,null);
  assert(f.streams[0].track.stops>0);assert(f.contexts[0].closed>0);assert.equal(f.worklets.length,0);
});
test('frames are contiguous finite PCM, ACK only after native handling, and zeroed after ACK',async()=>{
  const f=fixture();await f.start();f.controls.ack=deferred();const first=frame(0,0.25);f.emit(first);await flush();
  assert.equal(f.frames.length,1);assert.equal(f.worklets[0].port.acks.length,0);assert.equal(f.capture.state().pendingFrames,1);
  f.controls.ack.resolve();await flush();assert.deepEqual(f.worklets[0].port.acks,[{kind:'ack',sequence:0}]);assert(first.samples.every(value=>value===0));
  assert.equal(f.capture.state().activitySource,'local-rms-only');assert.equal(f.capture.state().signalActivity,'signal');await f.capture.dispose();
});
test('handoff pauses keyword mode only, retains bounded local PCM and stale-generation stop cannot affect capture',async()=>{
  const f=fixture();await f.start();f.capture.pause(1);f.emit(frame());await flush();assert.equal(f.frames[0].mode,'handoff');assert.equal(f.capture.state().microphone,'active');
  await f.capture.stop(99);assert.equal(f.streams[0].track.stops,0);await f.capture.dispose();
});
test('corrupt fields, forged RMS, gaps, NaN and over-range PCM fail closed without raw diagnostic data',async()=>{
  for(const value of [{...frame(),rawDiagnostics:'PRIVATE'},{...frame(),rms:0.5,signalActivity:'signal'},frame(1),{...frame(),samples:new Float32Array(640).fill(NaN)},{...frame(),samples:new Float32Array(640).fill(2)}]){
    const f=fixture();await f.start();f.emit(value);await flush();assert.equal(f.capture.state().phase,'failed');assert(f.streams[0].track.stops>0);assert.equal(f.frames.length,0);assert.doesNotMatch(JSON.stringify(f.states),/PRIVATE|NaN/);
  }
});
test('four unacknowledged frames are bounded; stop zeroes all retained PCM and releases capture immediately',async()=>{
  const f=fixture();await f.start();f.controls.ack=deferred();const values=Array.from({length:5},(_,i)=>frame(i,0.2));
  for(const value of values)f.emit(value);await flush();assert.equal(f.frames.length,4);assert.equal(f.capture.state().phase,'failed');
  assert(values.slice(0,4).every(value=>value.samples.every(sample=>sample===0)));assert(f.streams[0].track.stops>0);
  f.controls.ack.resolve();await flush();
});
test('unexpected device end and processor errors release local resources and never reacquire a microphone',async()=>{
  for(const error of ['track','processor']){const f=fixture();await f.start();if(error==='track')f.streams[0].track.onended();else f.worklets[0].onprocessorerror();await flush();
    assert.equal(f.capture.state().phase,'failed');assert.equal(f.constraints.length,1);assert(f.streams[0].track.stops>0);}
});
test('private worklet frames exactly 640 samples at 16k, silence stays inaudible, ACK bounds allocations and signal is RMS only',()=>{
  const code=readFileSync(new URL('../native/wake-pcm-worklet.js',import.meta.url),'utf8'),messages=[];let Processor;
  class Base{constructor(){this.port={onmessage:null,postMessage:value=>messages.push(value)};}}
  vm.runInNewContext(code,{AudioWorkletProcessor:Base,sampleRate:16000,Float32Array,registerProcessor:(name,value)=>{assert.equal(name,'vela-wake-pcm');Processor=value;}});
  const processor=new Processor(),outputs=[[new Float32Array(128).fill(1)]];
  for(let i=0;i<5;i++)assert.equal(processor.process([[new Float32Array(128).fill(0.25)]],outputs),true);
  assert.equal(messages[0].samples.length,640);assert.equal(messages[0].startSample,0);assert.equal(messages[0].signalActivity,'signal');assert.equal(messages[0].rms,0.25);
  assert(outputs[0][0].every(value=>value===0));processor.port.onmessage({data:{kind:'ack',sequence:0}});
  for(let i=0;i<20;i++)processor.process([[new Float32Array(128)]],outputs);
  assert.equal(messages.filter(value=>value.kind==='frame').length,5);
  for(let i=0;i<5;i++)processor.process([[new Float32Array(128)]],outputs);
  assert(messages.some(value=>value.code==='wake_worklet_backpressure'));assert.equal(processor.process([],outputs),false);
});
test('worklet and preload reject wrong sample-rate evidence and malformed binary input',()=>{
  assert.equal(validWakeWorkletFrame({...frame(),sampleRate:48000}),false);assert.equal(validWakeWorkletFrame({...frame(),samples:new Float32Array(639)}),false);
  assert.equal(validWakeWorkletFrame({...frame(),samples:new Proxy(new Float32Array(640),{})}),false);
  const messages=[];let Processor;class Base{constructor(){this.port={postMessage:value=>messages.push(value)};}}
  vm.runInNewContext(readFileSync(new URL('../native/wake-pcm-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,sampleRate:48000,Float32Array,registerProcessor:(_name,value)=>Processor=value});
  const value=new Processor();assert.equal(value.process([],[]),false);assert.equal(messages[0].code,'wake_worklet_sample_rate');
});
