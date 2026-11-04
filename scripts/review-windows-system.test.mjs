import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {validateWindowsSystemNative} from './review-build.mjs';
test('packager permits only the fixed Windows native addon and exact candidate C++ source binding',async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'aerynth-windows-addon-proof-'));try{
  const app='prototypes/visual-experience/cinematic-v3',source='native/windows-system.cpp',dist=path.join(root,'dist'),asset='aerynth-windows-system.node',metadata='aerynth-windows-system.sources.json',hash=value=>createHash('sha256').update(value).digest('hex');
  await fs.mkdir(path.join(root,app,'native'),{recursive:true});await fs.mkdir(dist);await fs.writeFile(path.join(root,app,source),'// synthetic fixed source');await fs.writeFile(path.join(dist,asset),'synthetic-binary-fixture');
  const tracked=new Set([app+'/'+source]),assets={[asset]:hash('synthetic-binary-fixture'),[metadata]:hash('metadata-fixture')},value={contract:'aerynth.private-windows-system-build@1',asset,sha256:assets[asset],inputs:{[source]:hash('// synthetic fixed source')}},write=v=>fs.writeFile(path.join(dist,metadata),JSON.stringify(v));
  await write(value);assert.deepEqual([...await validateWindowsSystemNative(root,dist,tracked,assets)],[asset,metadata]);
  await assert.rejects(validateWindowsSystemNative(root,dist,tracked,{}),/receipt_missing/);await write({...value,asset:'foreign.node'});await assert.rejects(validateWindowsSystemNative(root,dist,tracked,assets),/source_binding_invalid/);
  await write({...value,inputs:{...value.inputs,'native/arbitrary.cpp':hash('other')}});await assert.rejects(validateWindowsSystemNative(root,dist,tracked,assets),/source_binding_invalid/);await write(value);
  await fs.appendFile(path.join(root,app,source),'// edited');await assert.rejects(validateWindowsSystemNative(root,dist,tracked,assets),/source_changed/);
 }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('aerynth-windows-addon-proof-'));await fs.rm(root,{recursive:true,force:true});}
});
