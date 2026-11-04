/** Sandboxed preload entry. This module never exposes a main-world bridge. */
import { BrowserGptLiveMedia, type GptLiveMediaOptions, type GptLiveBrowserEnvironment } from './gpt-live-media.ts';
import type { LiveChannel } from '../../../openai-provider/live-contracts.mts';

type Header = {version:1;kind:'request'|'response'|'event';id:string;operation:string;payload?:any;result?:unknown;error?:string};
type Wire = {nativeLiveHost:Header};
type Media = Pick<BrowserGptLiveMedia,'prepare'|'connect'|'devices'|'state'|'setInputDevice'|'setOutputDevice'|'setLocalMute'|'resumePlayback'|'interruptPlayback'|'dispose'>;
const channel = 'aerynth-private-live-media';
const uuid = (value:unknown):value is string => typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const bounded=(value:unknown)=>{try{return new TextEncoder().encode(JSON.stringify(value)).length<=196608;}catch{return false;}};
const exact=(value:any,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const identifier=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x20\x7f]/u.test(value);
const sdp=(value:unknown)=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=65536;
const operations=new Set(['prepare','connect','send','close','devices','setInputDevice','setOutputDevice','setLocalMute','resumePlayback','interruptPlayback','state','dispose']);
export function validNativeMediaRequest(value:any):value is Wire {
  if(!exact(value,['nativeLiveHost'])||!bounded(value))return false;
  const h=value.nativeLiveHost,p=h?.payload;
  if(!exact(h,['version','kind','id','operation','payload'])||h.version!==1||h.kind!=='request'||!uuid(h.id)||!operations.has(h.operation))return false;
  if(h.operation==='prepare')return exact(p,['attemptId',...(Object.hasOwn(p??{},'inputDeviceId')?['inputDeviceId']:[]),...(Object.hasOwn(p??{},'outputDeviceId')?['outputDeviceId']:[])])&&identifier(p.attemptId)&&(p.inputDeviceId===undefined||identifier(p.inputDeviceId))&&(p.outputDeviceId===undefined||identifier(p.outputDeviceId));
  if(h.operation==='connect')return exact(p,['sessionId','sdpAnswer'])&&identifier(p.sessionId)&&sdp(p.sdpAnswer);
  if(h.operation==='send')return exact(p,['sessionId','command'])&&identifier(p.sessionId)&&
    (exact(p.command,['type','event_id'])&&['session.close','session.input_audio.mute','session.input_audio.unmute'].includes(p.command.type)&&identifier(p.command.event_id)||
     exact(p.command,['type','event_id','delegation_id','content'])&&['session.thinking.append','session.commentary.append'].includes(p.command.type)&&identifier(p.command.event_id)&&(p.command.delegation_id===null||identifier(p.command.delegation_id))&&typeof p.command.content==='string'&&new TextEncoder().encode(p.command.content).length<=500);
  if(h.operation==='close')return exact(p,['sessionId'])&&identifier(p.sessionId);
  if(['setInputDevice','setOutputDevice'].includes(h.operation))return exact(p,['deviceId'])&&identifier(p.deviceId);
  if(h.operation==='setLocalMute')return exact(p,['muted'])&&typeof p.muted==='boolean';
  return exact(p,[]);
}
/** Zero-source audio is available only through a native-owned QA flag, never a renderer DTO. */
export function createSyntheticVoiceEnvironment(): {environment:Partial<GptLiveBrowserEnvironment>;dispose():Promise<void>} {
  const contexts=new Set<AudioContext>();
  return {environment:{
    async getUserMedia(){const context=new AudioContext();contexts.add(context);const destination=context.createMediaStreamDestination();return destination.stream;},
    createAudio(){const audio=document.createElement('audio');audio.muted=true;return audio;},
  },async dispose(){for(const context of contexts)await context.close().catch(()=>{});contexts.clear();}};
}
export function createNativeMediaRuntime(send:(message:Wire)=>void, options:{mediaFactory?:(options:GptLiveMediaOptions)=>Media;syntheticInput?:boolean;randomId?:()=>string}={}) {
  let sessionId:string|null=null, offer:{offerId:string;sdpOffer:string}|null=null, negotiation:{offerId:string;sessionId:string;sdpAnswer:string}|null=null;
  let live:LiveChannel|null=null, closed=false, inFlight=0, eventCount=0, eventAt=Date.now();
  const seen=new Set<string>();
  const synthetic=options.syntheticInput?createSyntheticVoiceEnvironment():null;
  const event=(operation:string,payload:any)=>{
    if(closed||!bounded(payload))return;
    if(Date.now()-eventAt>=1000){eventAt=Date.now();eventCount=0;}
    if(++eventCount>128){if(sessionId)send({nativeLiveHost:{version:1,kind:'event',id:(options.randomId??(()=>crypto.randomUUID()))(),operation:'connection-lost',payload:{sessionId}}});void dispose();return;}
    send({nativeLiveHost:{version:1,kind:'event',id:(options.randomId??(()=>crypto.randomUUID()))(),operation,payload}});
  };
  const media=(options.mediaFactory??(settings=>new BrowserGptLiveMedia(settings)))({
    ...(synthetic?{environment:synthetic.environment}:{}),
    async acceptNegotiation(input){
      if(!negotiation||!offer||input.offerId!==offer.offerId||input.offerId!==negotiation.offerId||input.sessionId!==negotiation.sessionId||input.sdpAnswer!==negotiation.sdpAnswer)throw Error('live_media_negotiation_denied');
      negotiation=null;
    },
    onState:state=>event('state',{sessionId,state}),
  });
  async function dispose(){if(closed)return;closed=true;live=null;offer=null;negotiation=null;sessionId=null;seen.clear();await media.dispose();await synthetic?.dispose();}
  return {
    async handle(value:unknown){
      if(!validNativeMediaRequest(value))return;
      const h=value.nativeLiveHost,p=h.payload;
      const reply=(result:unknown,error?:string)=>send({nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,...(error?{error}:{result})}});
      if(closed){reply(null,h.operation==='dispose'?undefined:'live_media_closed');return;}
      if(inFlight>=8||seen.has(h.id)){reply(null,'live_media_backpressure');return;}
      seen.add(h.id);if(seen.size>512)seen.delete(seen.values().next().value!);inFlight++;
      try{
        let result:unknown=null;
        switch(h.operation){
          case 'prepare':if(offer||live)throw Error();offer=await media.prepare({...('inputDeviceId'in p?{inputDeviceId:p.inputDeviceId}:{}),...('outputDeviceId'in p?{outputDeviceId:p.outputDeviceId}:{})});result=offer;break;
          case 'connect':{
            if(!offer||sessionId||live)throw Error();sessionId=p.sessionId;const boundSession=sessionId;
            negotiation={offerId:offer.offerId,sessionId:boundSession!,sdpAnswer:p.sdpAnswer};
            live=await media.connect({sessionId:boundSession!,sdpAnswer:p.sdpAnswer,
              onEvent:async observed=>{if(sessionId===boundSession)event('provider-event',{sessionId:boundSession,event:observed});},
              onConnectionLost:()=>{if(sessionId!==boundSession)return;event('connection-lost',{sessionId:boundSession});live=null;offer=null;negotiation=null;sessionId=null;},
            });negotiation=null;break;
          }
          case 'send':if(!live||p.sessionId!==sessionId)throw Error();await live.send(p.command);break;
          case 'close':if(p.sessionId!==sessionId)throw Error();await live?.close();live=null;offer=null;negotiation=null;sessionId=null;break;
          case 'devices':result=await media.devices();break;
          case 'state':result=media.state();break;
          case 'setInputDevice':await media.setInputDevice(p.deviceId);break;
          case 'setOutputDevice':await media.setOutputDevice(p.deviceId);break;
          case 'setLocalMute':media.setLocalMute(p.muted);break;
          case 'resumePlayback':await media.resumePlayback();break;
          case 'interruptPlayback':media.interruptPlayback();break;
          case 'dispose':await dispose();break;
        }
        if(!bounded(result))throw Error();reply(result);
      }catch{negotiation=null;reply(null,'live_media_operation_failed');if(['prepare','connect'].includes(h.operation))await dispose();}
      finally{inFlight--;}
    },dispose,
  };
}

declare const require:undefined|((id:string)=>any);
declare const process:{argv:string[]};
// Node test imports do not have require; Electron's sandboxed preload has only its safe subset.
if(typeof require==='function'){
  const {ipcRenderer}=require('electron');
  const token=process.argv.find(arg=>arg.startsWith('--aerynth-live-media-token='))?.slice('--aerynth-live-media-token='.length);
  if(token&&/^[a-f0-9]{64}$/u.test(token)){
    const runtime=createNativeMediaRuntime(message=>ipcRenderer.send(channel+(message.nativeLiveHost.kind==='event'?'-event':'-reply'),{token,message}),{syntheticInput:process.argv.includes('--aerynth-live-media-synthetic')});
    const handler=(_event:unknown,value:any)=>{if(exact(value,['token','message'])&&value.token===token)void runtime.handle(value.message);};
    ipcRenderer.on(channel+'-command',handler);
    addEventListener('unload',()=>{ipcRenderer.removeListener(channel+'-command',handler);void runtime.dispose();},{once:true});
    ipcRenderer.send(channel+'-ready',{token});
  }
}
