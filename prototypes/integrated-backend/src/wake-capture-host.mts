import { randomUUID } from 'node:crypto';
import type { WakeCaptureState, WakePcmFrame } from '../../visual-experience/cinematic-v3/src/wake-audio-capture.ts';
export type { WakeCaptureState };
export interface NativeWakeCaptureServices {
  arm(input:{generation:number;inputDeviceId?:string}):Promise<WakeCaptureState>;
  pause(input:{generation:number}):Promise<WakeCaptureState>;
  stop(input:{generation?:number}):Promise<WakeCaptureState>;
  state():Promise<WakeCaptureState>;
  lease?(input:{generation:number;keywordEndSample:number;detectedAtSample:number}):Promise<{leaseRef:string;postWakeSpeech:'present'|'absent'|'unknown'}>;
  releaseLease?(input:{leaseRef:string}):Promise<{released:boolean}>;
}
type Operation='arm'|'pause'|'stop'|'state'|'lease'|'releaseLease';
type CaptureResult=WakeCaptureState|{leaseRef:string;postWakeSpeech:'present'|'absent'|'unknown'}|{released:boolean};
export type NativeWakeCaptureMessage={nativeWakeHost:{version:1;kind:'request'|'response';id:string;operation:Operation;payload?:Record<string,unknown>;result?:CaptureResult;error?:string}};
const exact=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,key)??{},'value'));
const generation=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x20\x7f]/u.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v);
const codes=new Set(['wake_host_protocol','wake_host_unavailable','wake_host_closed','wake_host_capacity','wake_host_timeout','wake_host_failed']);
export class WakeCaptureHostError extends Error { readonly code:string;constructor(code:string){super(codes.has(code)?code:'wake_host_failed');this.code=this.message;} }
const within=(v:unknown)=>{try{return Buffer.byteLength(JSON.stringify(v))<=8192;}catch{return false;}};
export function validWakeCaptureState(v:any):v is WakeCaptureState {
  const keys=['contract','generation','phase','microphone','sampleRate','inputDevice','frames','pendingFrames','signalActivity','activitySource'];
  return exact(v,[...keys,...(Object.hasOwn(v??{},'errorCode')?['errorCode']:[])])&&v.contract==='aerynth.wake-audio-capture@1'&&
    (v.generation===null||generation(v.generation))&&['off','arming','capturing','handoff','stopped','failed','disposed'].includes(v.phase)&&
    ['off','requesting','active','released','unknown'].includes(v.microphone)&&(v.sampleRate===null||v.sampleRate===16000)&&
    ['default','selected'].includes(v.inputDevice)&&Number.isSafeInteger(v.frames)&&v.frames>=0&&Number.isInteger(v.pendingFrames)&&v.pendingFrames>=0&&v.pendingFrames<=4&&
    ['unavailable','quiet','signal'].includes(v.signalActivity)&&v.activitySource==='local-rms-only'&&
    (v.errorCode===undefined||typeof v.errorCode==='string'&&/^wake_[a-z_]{1,80}$/u.test(v.errorCode))&&
    (['capturing','handoff'].includes(v.phase)?generation(v.generation)&&v.microphone==='active'&&v.sampleRate===16000:
      v.phase==='arming'?generation(v.generation)&&v.microphone==='requesting':
      v.phase==='failed'?v.microphone!=='active':v.microphone!=='active'&&v.microphone!=='requesting'&&v.pendingFrames===0)&&
    (v.phase!=='off'||v.generation===null&&v.sampleRate===null&&v.microphone==='off');
}
export const isNativeWakeCaptureMessage=(v:unknown)=>!!v&&typeof v==='object'&&Object.hasOwn(v,'nativeWakeHost');
const resultValid=(operation:Operation,v:any)=>operation==='lease'?exact(v,['leaseRef','postWakeSpeech'])&&id(v.leaseRef)&&['present','absent','unknown'].includes(v.postWakeSpeech):
  operation==='releaseLease'?exact(v,['released'])&&typeof v.released==='boolean':validWakeCaptureState(v);
export function validNativeWakeCaptureMessage(v:any):v is NativeWakeCaptureMessage {
  if(!exact(v,['nativeWakeHost'])||!within(v))return false;const h=v.nativeWakeHost;
  if(!h||h.version!==1||!uuid(h.id)||!['arm','pause','stop','state','lease','releaseLease'].includes(h.operation))return false;
  if(h.kind==='response')return exact(h,['version','kind','id','operation',...(Object.hasOwn(h,'error')?['error']:['result'])])&&
    (Object.hasOwn(h,'error')?codes.has(h.error):resultValid(h.operation,h.result));
  if(h.kind!=='request'||!exact(h,['version','kind','id','operation','payload']))return false;const p=h.payload;
  if(h.operation==='state')return exact(p,[]);
  if(h.operation==='releaseLease')return exact(p,['leaseRef'])&&id(p.leaseRef);
  if(h.operation==='lease')return exact(p,['generation','keywordEndSample','detectedAtSample'])&&generation(p.generation)&&Number.isSafeInteger(p.keywordEndSample)&&p.keywordEndSample>=0&&Number.isSafeInteger(p.detectedAtSample)&&p.detectedAtSample>=p.keywordEndSample;
  if(h.operation==='pause')return exact(p,['generation'])&&generation(p.generation);
  if(h.operation==='stop')return exact(p,Object.hasOwn(p??{},'generation')?['generation']:[])&&(p.generation===undefined||generation(p.generation));
  return exact(p,['generation',...(Object.hasOwn(p??{},'inputDeviceId')?['inputDeviceId']:[])])&&generation(p.generation)&&(p.inputDeviceId===undefined||id(p.inputDeviceId));
}
export function createNativeWakeCaptureClient(send:(message:NativeWakeCaptureMessage)=>void,options:{timeoutMs?:number}={}){
  let closed=false;const stopFlights=new Map<string,Promise<WakeCaptureState>>();
  const pending=new Map<string,{operation:Operation;generation?:number;resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
  const timeout=Math.min(15000,Math.max(1,options.timeoutMs??15000));
  const request=(operation:Operation,payload:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{
    if(closed)return reject(new WakeCaptureHostError('wake_host_closed'));
    const maximum=operation!=='stop'?8:payload.generation===undefined?12:11;
    if(pending.size>=maximum)return reject(new WakeCaptureHostError('wake_host_capacity'));
    const message:NativeWakeCaptureMessage={nativeWakeHost:{version:1,kind:'request',id:randomUUID(),operation,payload}};
    if(!validNativeWakeCaptureMessage(message))return reject(new WakeCaptureHostError('wake_host_protocol'));
    const key=message.nativeWakeHost.id,timer=setTimeout(()=>{pending.delete(key);reject(new WakeCaptureHostError('wake_host_timeout'));},timeout);
    pending.set(key,{operation,generation:payload.generation as number|undefined,resolve,reject,timer});try{send(message);}catch{clearTimeout(timer);pending.delete(key);reject(new WakeCaptureHostError('wake_host_closed'));}
  });
  const services:NativeWakeCaptureServices={arm:p=>request('arm',p),pause:p=>request('pause',p),state:()=>request('state'),lease:p=>request('lease',p),releaseLease:p=>request('releaseLease',p),stop:p=>{
    const key=p.generation===undefined?'all':String(p.generation),prior=stopFlights.get(key);if(prior)return prior;
    const value=request('stop',p);stopFlights.set(key,value);void value.finally(()=>{if(stopFlights.get(key)===value)stopFlights.delete(key);}).catch(()=>{});return value;
  }};
  return {services,handle(v:unknown){if(!isNativeWakeCaptureMessage(v))return false;if(!validNativeWakeCaptureMessage(v)||v.nativeWakeHost.kind!=='response')return true;
    const h=v.nativeWakeHost,p=pending.get(h.id);if(!p||h.operation!==p.operation)return true;clearTimeout(p.timer);pending.delete(h.id);
    if(h.error)p.reject(new WakeCaptureHostError(h.error));else if((p.operation==='arm'||p.operation==='pause')&&(h.result as WakeCaptureState).generation!==p.generation)p.reject(new WakeCaptureHostError('wake_host_protocol'));else p.resolve(h.result!);return true;},
    dispose(){closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new WakeCaptureHostError('wake_host_closed'));}pending.clear();},pending:()=>pending.size};
}
export function createNativeWakeCaptureServer(services:NativeWakeCaptureServices|undefined,send:(message:NativeWakeCaptureMessage)=>void,options:{timeoutMs?:number}={}){
  let closed=false;const pending=new Map<string,ReturnType<typeof setTimeout>>(),seen=new Set<string>(),timeout=Math.min(15000,Math.max(1,options.timeoutMs??15000));
  return {handle(v:unknown){if(!isNativeWakeCaptureMessage(v))return false;if(!validNativeWakeCaptureMessage(v)||v.nativeWakeHost.kind!=='request')return true;
    const h=v.nativeWakeHost;const reply=(result?:CaptureResult,error?:string)=>{try{send({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:h.operation,...(error?{error}:{result:result!})}});}catch{/* Closing the owner cannot grant capture. */}};
    if(closed){reply(undefined,'wake_host_closed');return true;}const maximum=h.operation!=='stop'?8:h.payload?.generation===undefined?12:11;
    if(seen.has(h.id)||pending.size>=maximum){reply(undefined,'wake_host_capacity');return true;}
    seen.add(h.id);if(seen.size>512)seen.delete(seen.values().next().value!);let done=false;
    const finish=(result?:CaptureResult,error?:string)=>{if(done||closed)return;done=true;clearTimeout(pending.get(h.id));pending.delete(h.id);reply(result,error);};
    pending.set(h.id,setTimeout(()=>{finish(undefined,'wake_host_timeout');if(h.operation==='arm')void services?.stop({generation:h.payload!.generation as number}).catch(()=>{});},timeout));
    void(async()=>{try{if(!services){finish(undefined,'wake_host_unavailable');return;}
      const p=h.payload!;let result:CaptureResult;
      if(h.operation==='lease'){if(!services.lease)throw Error();result=await services.lease(p as any);}
      else if(h.operation==='releaseLease'){if(!services.releaseLease)throw Error();result=await services.releaseLease(p as any);}
      else result=h.operation==='state'?await services.state():h.operation==='arm'?await services.arm(p as any):h.operation==='pause'?await services.pause(p as any):await services.stop(p as any);
      if(!resultValid(h.operation,result)||(h.operation==='arm'||h.operation==='pause')&&(result as WakeCaptureState).generation!==p.generation)throw Error();
      if(done||closed){if(h.operation==='arm')await services.stop({generation:p.generation as number});return;}finish(result);
    }catch{finish(undefined,'wake_host_failed');}})();return true;},dispose(){closed=true;for(const timer of pending.values())clearTimeout(timer);pending.clear();void services?.stop({}).catch(()=>{});}};
}

/** Upstream PCM uses the existing private native-client command channel, never
 * renderer events or Intelligence Stream. Ordinary renderer RPC cannot call it. */
export type NativeWakePcmFrame=Omit<WakePcmFrame,'samples'>&{pcmBase64:string};
export function encodeNativeWakeFrame(frame:WakePcmFrame):NativeWakePcmFrame{
  const {samples,...metadata}=frame;return {...metadata,pcmBase64:Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength).toString('base64')};
}
export function decodeNativeWakeFrame(v:any):WakePcmFrame {
  if(!exact(v,['generation','sequence','startSample','sampleRate','pcmBase64','signalActivity','rms','mode'])||!generation(v.generation)||
      !Number.isSafeInteger(v.sequence)||v.sequence<0||!Number.isSafeInteger(v.startSample)||v.startSample!==v.sequence*640||v.sampleRate!==16000||
      typeof v.pcmBase64!=='string'||v.pcmBase64.length!==3416||!['quiet','signal'].includes(v.signalActivity)||
      !['detector','handoff'].includes(v.mode)||!Number.isFinite(v.rms)||v.rms<0||v.rms>1||v.signalActivity!==(v.rms>=.01?'signal':'quiet'))throw Error('wake_host_protocol');
  const bytes=Buffer.from(v.pcmBase64,'base64');try{
    if(bytes.length!==2560||bytes.toString('base64')!==v.pcmBase64)throw Error('wake_host_protocol');
    const samples=new Float32Array(640);for(let i=0;i<640;i++)samples[i]=bytes.readFloatLE(i*4);
    const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/640);
    if(!samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1)||Math.abs(rms-v.rms)>1e-6){samples.fill(0);throw new WakeCaptureHostError('wake_host_protocol');}
    const {pcmBase64:_,...metadata}=v;return {...metadata,samples};
  }finally{bytes.fill(0);}
}
