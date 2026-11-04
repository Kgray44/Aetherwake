import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {Backend} from '../src/service.mts';
test('actual Backend reserves four bounded slots for exact safety controls while64 normal snapshots are pending',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aerynth-cleanup-capacity-')),backend=new Backend({path:join(dir,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'});
  try{await backend.call('snapshot',{});const snapshots=Array.from({length:64},()=>backend.call('snapshot',{}));for(const request of snapshots)request.catch(()=>{});
    await assert.rejects(backend.call('snapshot',{}),/backpressure/);await assert.rejects(backend.call('velaWake',{name:'state',input:{}}),/backpressure/,'Ordinary metadata does not receive safety headroom');
    const capture=backend.call('velaWakeCaptureState',{} as any);capture.catch(()=>{});const controls=Array.from({length:3},()=>backend.call('velaWake',{name:'masterOff',input:{}}));for(const request of controls)request.catch(()=>{});
    await assert.rejects(backend.call('velaVoice',{name:'stop',input:{}}),/backpressure/,'Even safety traffic stops at68 total pending requests');
    await assert.rejects(capture,/native_wake_authorization_required/,'Reserved metadata reached the real Core authorization boundary instead of being dropped');
    const results=await Promise.all([...snapshots,...controls]);assert.equal(results.length,67);for(const state of results.slice(64))assert.equal((state as any).microphone,'off');
    await assert.rejects(backend.call('velaVoice',{name:'stop',input:{}}),/live_media_unavailable/,'After draining, Stop reaches the real unavailable-device boundary without a paid or microphone call');assert.equal((await backend.call('providerActivity',{})).providerRequests,0);
  }finally{await backend.close();const part=relative(resolve(tmpdir()),resolve(dir));assert.ok(part.startsWith('aerynth-cleanup-capacity-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}
});
