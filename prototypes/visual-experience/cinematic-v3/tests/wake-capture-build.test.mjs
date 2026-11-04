import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {wakeCapturePreload,wakeCapturePreloadName,liveMediaPreload} from '../native/live-media-build.mjs';
test('wake capture has a separate exact two-source sandbox preload and fixed byte-identical trusted worklet asset',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),assets=[],plugin=wakeCapturePreload();plugin.configResolved({root});
  await plugin.generateBundle.call({emitFile:value=>assets.push(value)});
  assert.deepEqual(assets.map(asset=>asset.fileName),[wakeCapturePreloadName,'vela-wake-pcm-worklet.js','vela-wake-capture-preload.sources.json']);
  const [preload,worklet,metadata]=assets,value=JSON.parse(metadata.source),hash=input=>createHash('sha256').update(input).digest('hex');
  assert.equal(value.contract,'aerynth.private-wake-capture-build@1');assert.equal(value.sha256,hash(preload.source));
  assert.deepEqual(Object.keys(value.inputs),['src/wake-audio-capture.ts','src/wake-native-capture.ts']);
  assert.deepEqual(value.worklet,{asset:'vela-wake-pcm-worklet.js',source:'native/wake-pcm-worklet.js',sha256:hash(worklet.source)});
  assert.equal(hash(worklet.source),hash(await readFile(new URL('../native/wake-pcm-worklet.js',import.meta.url))));
  assert.match(preload.source,/require\("electron"\)/);assert.doesNotMatch(preload.source,/contextBridge|exposeInMainWorld|apiKey|api\.openai\.com/);
  const legacy=[],old=liveMediaPreload();old.configResolved({root});await old.generateBundle.call({emitFile:value=>legacy.push(value)});
  assert.deepEqual(Object.keys(JSON.parse(legacy[1].source).inputs),['src/gpt-live-media.ts','src/gpt-live-native-media.ts','src/wake-live-input.ts'],'the private Live preload has exactly its three declared media and input sources');
});
