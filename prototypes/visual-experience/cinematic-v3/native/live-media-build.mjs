import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const liveMediaPreloadName='vela-live-media-preload.cjs';
/** Emit before the receipt plugin's writeBundle so its inventory hashes this exact preload. */
export function liveMediaPreload(){
  let root;
  return {name:'aerynth-private-live-media-preload',apply:'build',configResolved(config){root=config.root;},
    async generateBundle(){
      const result=await build({entryPoints:[path.join(root,'src/gpt-live-native-media.ts')],bundle:true,write:false,format:'cjs',platform:'browser',target:'chrome144',external:['electron'],metafile:true,legalComments:'none'});
      const inputs=Object.create(null);
      for(const name of Object.keys(result.metafile.inputs).sort()){
        const file=path.resolve(name),relative=path.relative(root,file).split(path.sep).join('/');
        if(relative.startsWith('../')||!relative.startsWith('src/')||!/\.ts$/u.test(relative))throw Error('live_media_preload_unexpected_source');
        inputs[relative]=createHash('sha256').update(await readFile(file)).digest('hex');
      }
      const required=['src/gpt-live-media.ts','src/gpt-live-native-media.ts','src/wake-live-input.ts'];
      if(Object.keys(inputs).sort().join('|')!==required.join('|')||result.outputFiles.length!==1)throw Error('live_media_preload_source_missing');
      const source=result.outputFiles[0].text;
      if(source.includes('contextBridge')||source.length>262144)throw Error('live_media_preload_boundary_invalid');
      this.emitFile({type:'asset',fileName:liveMediaPreloadName,source});
      this.emitFile({type:'asset',fileName:'vela-live-media-preload.sources.json',source:JSON.stringify({contract:'aerynth.private-live-media-build@1',asset:liveMediaPreloadName,sha256:createHash('sha256').update(source).digest('hex'),inputs})+'\n'});
    },
  };
}

export const wakeCapturePreloadName='vela-wake-capture-preload.cjs';
/** Separate fixed closure; each private preload retains its declared source inventory. */
export function wakeCapturePreload(){
  let root;
  return {name:'aerynth-private-wake-capture-preload',apply:'build',configResolved(config){root=config.root;},
    async generateBundle(){
      const result=await build({entryPoints:[path.join(root,'src/wake-native-capture.ts')],bundle:true,write:false,format:'cjs',platform:'browser',target:'chrome144',external:['electron'],metafile:true,legalComments:'none'});
      const inputs=Object.create(null),required=['src/wake-audio-capture.ts','src/wake-native-capture.ts'];
      for(const name of Object.keys(result.metafile.inputs).sort()){
        const file=path.resolve(name),relative=path.relative(root,file).split(path.sep).join('/');
        if(!required.includes(relative))throw Error('wake_capture_preload_unexpected_source');
        inputs[relative]=createHash('sha256').update(await readFile(file)).digest('hex');
      }
      if(Object.keys(inputs).sort().join('|')!==required.join('|')||result.outputFiles.length!==1)throw Error('wake_capture_preload_source_missing');
      const source=result.outputFiles[0].text,workletSource='native/wake-pcm-worklet.js',workletName='vela-wake-pcm-worklet.js',worklet=await readFile(path.join(root,workletSource));
      if(source.includes('contextBridge')||source.length>262144||worklet.length>16384)throw Error('wake_capture_preload_boundary_invalid');
      const hash=value=>createHash('sha256').update(value).digest('hex');
      this.emitFile({type:'asset',fileName:wakeCapturePreloadName,source});
      this.emitFile({type:'asset',fileName:workletName,source:worklet});
      this.emitFile({type:'asset',fileName:'vela-wake-capture-preload.sources.json',source:JSON.stringify({
        contract:'aerynth.private-wake-capture-build@1',asset:wakeCapturePreloadName,sha256:hash(source),inputs,
        worklet:{asset:workletName,source:workletSource,sha256:hash(worklet)},
      })+'\n'});
    },
  };
}

export const wakeHostName='vela-wake-host.cjs';
export const wakeHostSources=Object.freeze(['prototypes/integrated-backend/src/native-wake-controller.mts','prototypes/integrated-backend/src/wake-audio-buffer.mts','prototypes/integrated-backend/src/wake-capture-host.mts']);
/** Private native-main host bundle. No renderer entry or implicit dependency expansion. */
export function wakeHostCore(){let root;return {name:'aerynth-private-wake-host',apply:'build',configResolved(config){root=config.root;},async generateBundle(){
  const repository=path.resolve(root,'../../..'),result=await build({entryPoints:[path.join(repository,wakeHostSources[0])],bundle:true,write:false,format:'cjs',platform:'node',target:'node22',external:['node:*'],metafile:true,legalComments:'none'}),inputs=Object.create(null);
  for(const name of Object.keys(result.metafile.inputs).sort()){
    const file=path.resolve(name),relative=path.relative(repository,file).split(path.sep).join('/');
    if(!wakeHostSources.includes(relative))throw Error('wake_host_unexpected_source');inputs[relative]=createHash('sha256').update(await readFile(file)).digest('hex');
  }
  if(Object.keys(inputs).sort().join('|')!==wakeHostSources.join('|')||result.outputFiles.length!==1||Object.values(result.metafile.outputs).some(output=>output.imports.some(entry=>entry.external&&!entry.path.startsWith('node:'))))throw Error('wake_host_source_missing');
  const source=result.outputFiles[0].text;if(source.length>262144||source.includes('contextBridge'))throw Error('wake_host_boundary_invalid');
  this.emitFile({type:'asset',fileName:wakeHostName,source});this.emitFile({type:'asset',fileName:'vela-wake-host.sources.json',source:JSON.stringify({contract:'aerynth.private-wake-host-build@1',asset:wakeHostName,sha256:createHash('sha256').update(source).digest('hex'),inputs})+'\n'});
 }};}
