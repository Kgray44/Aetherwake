import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {validateWakeCapturePreload} from './review-build.mjs';
test('packager permits only the fixed wake preload/two-source proof/worklet binding and rejects altered candidate sources',async()=>{
  const root=await fs.mkdtemp(path.join(tmpdir(),'aerynth-wake-capture-build-'));
  try{
    const app='prototypes/visual-experience/cinematic-v3',dist=path.join(root,'dist'),tracked=new Set(),inputs={},hash=value=>createHash('sha256').update(value).digest('hex');
    await fs.mkdir(path.join(root,app,'src'),{recursive:true});await fs.mkdir(path.join(root,app,'native'));await fs.mkdir(dist);
    for(const name of ['src/wake-audio-capture.ts','src/wake-native-capture.ts']){const file=app+'/'+name,source='// synthetic '+name;
      await fs.writeFile(path.join(root,file),source);tracked.add(file);inputs[name]=hash(source);}
    const nativeWorklet='native/wake-pcm-worklet.js',workletSource='// synthetic fixed worklet';tracked.add(app+'/'+nativeWorklet);await fs.writeFile(path.join(root,app,nativeWorklet),workletSource);
    const preload='vela-wake-capture-preload.cjs',metadata='vela-wake-capture-preload.sources.json',worklet='vela-wake-pcm-worklet.js',
      assets={[preload]:hash('built preload'),[metadata]:hash('metadata receipt'),[worklet]:hash(workletSource)},
      value={contract:'aerynth.private-wake-capture-build@1',asset:preload,sha256:assets[preload],inputs,worklet:{asset:worklet,source:nativeWorklet,sha256:assets[worklet]}},
      write=changed=>fs.writeFile(path.join(dist,metadata),JSON.stringify(changed));
    await write(value);assert.deepEqual([...await validateWakeCapturePreload(root,dist,tracked,assets)],[preload,metadata,worklet]);
    assert.equal((await validateWakeCapturePreload(root,dist,tracked,assets)).has('arbitrary.cjs'),false);
    await assert.rejects(validateWakeCapturePreload(root,dist,tracked,{[preload]:assets[preload],[metadata]:assets[metadata]}),/receipt_missing/);
    await write({...value,inputs:{...inputs,'src/unreviewed.ts':hash('foreign')}});await assert.rejects(validateWakeCapturePreload(root,dist,tracked,assets),/source_binding_invalid/);
    await write({...value,asset:'foreign.cjs'});await assert.rejects(validateWakeCapturePreload(root,dist,tracked,assets),/source_binding_invalid/);await write(value);
    const missing=new Set(tracked);missing.delete(app+'/'+nativeWorklet);await assert.rejects(validateWakeCapturePreload(root,dist,missing,assets),/source_changed/);
    await fs.appendFile(path.join(root,app,nativeWorklet),'// edited');await assert.rejects(validateWakeCapturePreload(root,dist,tracked,assets),/source_changed/);
  }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('aerynth-wake-capture-build-'));await fs.rm(root,{recursive:true,force:true});}
});
