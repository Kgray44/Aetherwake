import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {liveMediaPreload,liveMediaPreloadName} from '../native/live-media-build.mjs';
test('private preload bundle is generated before the renderer receipt with a closed, exact source binding',async()=>{
  const plugin=liveMediaPreload(),root=fileURLToPath(new URL('..',import.meta.url)),assets=[];
  plugin.configResolved({root});await plugin.generateBundle.call({emitFile:asset=>assets.push(asset)});
  assert.deepEqual(assets.map(asset=>asset.fileName),[liveMediaPreloadName,'vela-live-media-preload.sources.json']);
  const [preload,meta]=assets,value=JSON.parse(meta.source);
  assert.equal(value.sha256,createHash('sha256').update(preload.source).digest('hex'));
  assert.deepEqual(Object.keys(value.inputs),['src/gpt-live-media.ts','src/gpt-live-native-media.ts','src/wake-live-input.ts']);
  assert.match(preload.source,/require\("electron"\)/);assert.doesNotMatch(preload.source,/contextBridge|exposeInMainWorld|apiKey|api\.openai\.com/);
  const html=await readFile(new URL('../native/voice-media.html',import.meta.url),'utf8');assert.match(html,/default-src 'none'/);assert.match(html,/script-src 'none'/);assert.doesNotMatch(html,/<script\b|<iframe\b/);
});
