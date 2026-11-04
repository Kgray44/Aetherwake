import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {createLocalWakeEngine,validateWakePcm,wakeChildEnvironment} from '../src/wake-engine.mts';
import {validateWakePhrases,readEnglishBpeModel,encodeEnglishWakePhrase,compileWakeKeywords} from '../src/wake-engine-phrases.mts';
function model(){const records:Buffer[]=[];let rank=0;for(const text of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','▁','▁H','▁HE','▁HEY','▁V','▁VE']){
  const bytes=Buffer.from(text),score=Buffer.alloc(4);score.writeFloatLE(-rank++);const piece=Buffer.concat([Buffer.from([10,bytes.length]),bytes,Buffer.from([21]),score,Buffer.from([24,1])]);records.push(Buffer.concat([Buffer.from([10,piece.length]),piece]));
}return Buffer.concat(records);}
test('local phrase compilation supports actual BPE pieces and explicit pronunciation aliases without training',()=>{
  const pieces=readEnglishBpeModel(model());assert.deepEqual(encodeEnglishWakePhrase('Hey Vela',pieces),['▁HEY','▁VE','L','A']);
  const keywords=compileWakeKeywords([{id:'hey-vela',text:'Hey Vela',spokenAliases:['Hey Vay La']}],model(),0.5);
  assert.match(keywords,/▁HEY ▁VE L A :2\.000 #0\.250 @hey-vela/u);assert.equal(keywords.split('\n').filter(Boolean).length,2);
});
test('phrases and model records reject injection, unsupported alphabets and malformed binary lengths',()=>{
  for(const phrases of [[],[{id:'x',text:'Hi\n@bypass'}],[{id:'x',text:'你好'}],[{id:'../escape',text:'Hey Vela'}],[{id:'x',text:'Hey Vela',spokenAliases:['bad:999']}],[{id:'x',text:'Hey Vela'},{id:'x',text:'Vela'}]])assert.throws(()=>validateWakePhrases(phrases),/wake_phrase_invalid/);
  for(const bytes of [new Uint8Array(),new Uint8Array([10,255]),new Uint8Array([15])])assert.throws(()=>readEnglishBpeModel(bytes),/wake_phrase_invalid/);
});
test('PCM boundary rejects unbounded, shared, malformed and non-finite audio before worker dispatch',()=>{
  validateWakePcm({sequence:0,sampleRate:16000,samples:new Float32Array(320)});
  for(const input of [{sequence:0,sampleRate:48000,samples:new Float32Array(320)},{sequence:-1,sampleRate:16000,samples:new Float32Array(320)},{sequence:0,sampleRate:16000,samples:new Float32Array(16001)},{sequence:0,sampleRate:16000,samples:new Float32Array([NaN])},{sequence:0,sampleRate:16000,samples:new Float32Array([1.1])},{sequence:0,sampleRate:16000,samples:new Float32Array(new SharedArrayBuffer(128))},{sequence:0,sampleRate:16000,samples:new Float32Array(320),ambientConsent:true}])assert.throws(()=>validateWakePcm(input),/wake_engine_invalid_request/);
});
test('constructing an OFF detector allocates no worker, directory, microphone or network session',async()=>{
  const target=path.join(tmpdir(),'aerynth-wake-off-'+randomUUID());assert.equal(existsSync(target),false);
  const engine=createLocalWakeEngine({artifactRoot:target,manifestPath:path.join(target,'manifest.json'),workDirectory:path.join(target,'work'),phrases:[{id:'hey-vela',text:'Hey Vela'}],sensitivity:0.5});
  assert.equal(existsSync(target),false);await assert.rejects(engine.acceptPcm({sequence:0,sampleRate:16000,samples:new Float32Array(320)}),/wake_engine_closed/);await engine.dispose();assert.equal(existsSync(target),false);
});
test('native child environment contains only Windows essentials and the owned temp directory',()=>{
  const env=wakeChildEnvironment('C:\\owned-wake-work');assert.deepEqual(Object.keys(env).sort(),['COMSPEC','PATH','SystemRoot','TEMP','TMP','WINDIR'].sort());
  for(const key of ['NODE_OPTIONS','NODE_PATH','OPENAI_API_KEY','AERYNTH_NODE_BIN','AERYNTH_NATIVE_HOST_TOKEN','CODEX_HOME'])assert.equal(Object.hasOwn(env,key),false);
  assert.equal(env.TEMP,'C:\\owned-wake-work');assert.equal(env.TMP,env.TEMP);
});
