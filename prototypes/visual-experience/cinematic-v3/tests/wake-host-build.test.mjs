import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {wakeHostCore,wakeHostSources,wakeHostName} from '../native/live-media-build.mjs';
test('wake host has a separate exact three-source Node bundle and rejects dependency expansion',async()=>{
 const repository=await fs.mkdtemp(path.join(tmpdir(),'aerynth-wake-host-build-'));try{
  const root=path.join(repository,'prototypes/visual-experience/cinematic-v3');await fs.mkdir(root,{recursive:true});const folder=path.join(repository,'prototypes/integrated-backend/src');await fs.mkdir(folder,{recursive:true});
  const entry="import {ring} from './wake-audio-buffer.mts';import {transport} from './wake-capture-host.mts';import {randomUUID} from 'node:crypto';export const createNativeWakeController=()=>[ring(),transport(),randomUUID()];";
  await fs.writeFile(path.join(folder,'native-wake-controller.mts'),entry);await fs.writeFile(path.join(folder,'wake-audio-buffer.mts'),'export const ring=()=>1;');await fs.writeFile(path.join(folder,'wake-capture-host.mts'),'export const transport=()=>2;');
  const run=async()=>{const plugin=wakeHostCore(),assets=[];plugin.configResolved({root});await plugin.generateBundle.call({emitFile:asset=>assets.push(asset)});return assets;};const assets=await run();assert.deepEqual(assets.map(asset=>asset.fileName),[wakeHostName,'vela-wake-host.sources.json']);const metadata=JSON.parse(assets[1].source),hash=value=>createHash('sha256').update(value).digest('hex');assert.deepEqual(Object.keys(metadata.inputs),wakeHostSources);assert.equal(metadata.sha256,hash(assets[0].source));assert.match(assets[0].source,/require\("node:crypto"\)/);
  for(const source of wakeHostSources)assert.equal(metadata.inputs[source],hash(await fs.readFile(path.join(repository,source))));
  await fs.writeFile(path.join(folder,'extra.mts'),'export const extra=3;');await fs.writeFile(path.join(folder,'native-wake-controller.mts'),entry+"import {extra} from './extra.mts';export {extra};");await assert.rejects(run(),/wake_host_unexpected_source/);
  await fs.writeFile(path.join(folder,'native-wake-controller.mts'),"export {ring} from './wake-audio-buffer.mts';");await assert.rejects(run(),/wake_host_source_missing/);
 }finally{assert.equal(path.dirname(repository),path.resolve(tmpdir()));assert(path.basename(repository).startsWith('aerynth-wake-host-build-'));await fs.rm(repository,{recursive:true,force:true});}
});
