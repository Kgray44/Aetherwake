import test from 'node:test';
import assert from 'node:assert/strict';
import {WakeLiveInput} from '../src/wake-live-input.ts';
function fixture(){
 const buffers=[],sources=[],track={stopped:false,stop(){this.stopped=true;}},stream={getTracks:()=>[track]};
 const context={sampleRate:16000,currentTime:10,state:'suspended',async resume(){this.state='running';},async close(){this.state='closed';},
  createMediaStreamDestination:()=>({stream,disconnect(){}}),
  createBuffer(_channels,length){const data=new Float32Array(length);const value={data,getChannelData:()=>data};buffers.push(value);return value;},
  createBufferSource(){const source={buffer:null,onended:null,connect(){},disconnect(){},start(at){this.at=at;},stop(){this.stopped=true;}};sources.push(source);return source;}};
 return {input:new WakeLiveInput(()=>context),context,track,buffers,sources};
}
test('one outgoing track receives the whole command prefix and continuous tail in exact order only after activation',async()=>{
 const f=fixture();try{
  const prefix=new Float32Array(640).fill(.1),tail=new Float32Array(640).fill(.2);
  f.input.append(0,prefix);f.input.append(640,tail);assert.equal(f.sources.length,0);assert.equal(f.track.stopped,false);
  await f.input.activate();assert.equal(f.sources.length,2);assert.equal(f.sources[0].at,10.02);assert.ok(Math.abs(f.sources[1].at-10.06)<1e-9);
  assert.ok(f.buffers[0].data.every(value=>Math.abs(value-.1)<1e-6));assert.ok(f.buffers[1].data.every(value=>Math.abs(value-.2)<1e-6));
  f.input.append(1280,new Float32Array(320).fill(.3));assert.ok(Math.abs(f.sources[2].at-10.1)<1e-9);assert.equal(f.input.state().receivedSamples,1600);
  f.sources[0].onended();assert.equal(f.input.state().retainedSamples,960);assert.ok(f.buffers[0].data.every(value=>value===0));
  f.input.quiesce();assert.equal(f.track.stopped,true);assert.ok(f.buffers.every(buffer=>buffer.data.every(value=>value===0)));assert.equal(f.input.state().retainedSamples,0);
 }finally{await f.input.dispose();}
});
test('replayed, nonfinite, oversized and overflowing PCM fails without growing the bounded queue',async()=>{
 const f=fixture();try{
  assert.throws(()=>f.input.append(1,new Float32Array(640)),/frame_invalid/);
  assert.throws(()=>f.input.append(0,new Float32Array(640).fill(NaN)),/frame_invalid/);
  for(let index=0;index<200;index++)f.input.append(index*640,new Float32Array(640));
  assert.equal(f.input.state().retainedSamples,128000);assert.throws(()=>f.input.append(128000,new Float32Array(1)),/frame_invalid/);
  f.input.quiesce();assert.equal(f.input.state().retainedSamples,0);await assert.rejects(f.input.activate(),/closed/);
 }finally{await f.input.dispose();}
});
