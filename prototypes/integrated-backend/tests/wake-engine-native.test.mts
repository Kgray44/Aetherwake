import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {createLocalWakeEngine} from '../src/wake-engine.mts';import {DEFAULT_WAKE_PHRASES} from '../src/wake-engine-phrases.mts';
const root=process.env.AERYNTH_WAKE_TEST_ARTIFACT_ROOT;
test('actual Windows child consumes synthetic PCM with monotonic coordinates, reset and verified teardown',{skip:!root},async()=>{
  const work=await mkdtemp(path.join(tmpdir(),'aerynth-native-wake-'));
  const engine=createLocalWakeEngine({artifactRoot:root!,manifestPath:path.join(root!,'wake-model-manifest.json'),workDirectory:work,phrases:[...DEFAULT_WAKE_PHRASES],sensitivity:0.5});
  try{const info=await engine.start();assert.equal(info.engine,'sherpa-onnx');assert.equal(info.provider,'cpu');assert.equal(info.threads,1);
    const owned=new Float32Array(320);let result=await engine.acceptPcm({sequence:0,sampleRate:16000,samples:owned});assert.equal(result.processedSamples,320);assert.deepEqual(result.detections,[]);assert.ok(result.metrics.rssBytes>0);
    await assert.rejects(engine.acceptPcm({sequence:0,sampleRate:16000,samples:owned}),/wake_engine_invalid_request/);await engine.reset();result=await engine.acceptPcm({sequence:0,sampleRate:16000,samples:owned});assert.equal(result.processedSamples,640);
    await engine.dispose();await assert.rejects(engine.acceptPcm({sequence:1,sampleRate:16000,samples:owned}),/wake_engine_closed/);
  }finally{await engine.dispose();assert.ok(path.basename(work).startsWith('aerynth-native-wake-'));await rm(work,{recursive:true,force:true});}
});
test('disabling during setup cannot revive a late native child',{skip:!root},async()=>{
  const work=await mkdtemp(path.join(tmpdir(),'aerynth-native-wake-')),engine=createLocalWakeEngine({artifactRoot:root!,manifestPath:path.join(root!,'wake-model-manifest.json'),workDirectory:work,phrases:[...DEFAULT_WAKE_PHRASES],sensitivity:0.5});
  const starting=engine.start();await engine.dispose();await assert.rejects(starting,/wake_engine_closed/);await engine.dispose();
  assert.ok(path.basename(work).startsWith('aerynth-native-wake-'));await rm(work,{recursive:true,force:true});
});
