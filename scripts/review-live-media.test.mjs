import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {validateLiveMediaPreload} from './review-build.mjs';

test('packager permits only the exact private preload/metadata pair with candidate source hashes',async()=>{
  const root=await fs.mkdtemp(path.join(tmpdir(),'aerynth-live-media-build-'));
  try{
    const app='prototypes/visual-experience/cinematic-v3',dist=path.join(root,'dist'),inputs={},tracked=new Set();
    await fs.mkdir(path.join(root,app,'src'),{recursive:true});await fs.mkdir(dist);
    const hash=value=>createHash('sha256').update(value).digest('hex');
    for(const name of ['src/gpt-live-media.ts','src/gpt-live-native-media.ts','src/wake-live-input.ts']){const file=app+'/'+name,source='// synthetic '+name;await fs.writeFile(path.join(root,file),source);tracked.add(file);inputs[name]=hash(source);}
    const preload='vela-live-media-preload.cjs',meta='vela-live-media-preload.sources.json',assets={[preload]:hash('owned build'),[meta]:hash('receipt-bound metadata')};
    const value={contract:'aerynth.private-live-media-build@1',asset:preload,sha256:assets[preload],inputs};
    await fs.writeFile(path.join(dist,meta),JSON.stringify(value));
    const permitted=await validateLiveMediaPreload(root,dist,tracked,assets);assert.deepEqual([...permitted],[preload,meta]);assert.equal(permitted.has('arbitrary.cjs'),false);
    await assert.rejects(validateLiveMediaPreload(root,dist,tracked,{[preload]:assets[preload]}),/receipt_missing/);
    await fs.appendFile(path.join(root,app,'src/gpt-live-media.ts'),'// changed');await assert.rejects(validateLiveMediaPreload(root,dist,tracked,assets),/source_changed/);
    await fs.writeFile(path.join(dist,meta),JSON.stringify({...value,asset:'foreign.cjs'}));await assert.rejects(validateLiveMediaPreload(root,dist,tracked,assets),/source_binding_invalid/);
  }finally{
    const resolved=path.resolve(root),relative=path.relative(path.resolve(tmpdir()),resolved);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(resolved).startsWith('aerynth-live-media-build-'));await fs.rm(resolved,{recursive:true});
  }
});
