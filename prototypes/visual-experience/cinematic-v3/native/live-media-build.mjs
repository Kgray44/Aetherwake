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
      if(!inputs['src/gpt-live-native-media.ts']||!inputs['src/gpt-live-media.ts']||result.outputFiles.length!==1)throw Error('live_media_preload_source_missing');
      const source=result.outputFiles[0].text;
      if(source.includes('contextBridge')||source.length>262144)throw Error('live_media_preload_boundary_invalid');
      this.emitFile({type:'asset',fileName:liveMediaPreloadName,source});
      this.emitFile({type:'asset',fileName:'vela-live-media-preload.sources.json',source:JSON.stringify({contract:'aerynth.private-live-media-build@1',asset:liveMediaPreloadName,sha256:createHash('sha256').update(source).digest('hex'),inputs})+'\n'});
    },
  };
}
