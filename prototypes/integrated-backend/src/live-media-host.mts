import { randomUUID } from 'node:crypto';
import type { LiveChannel, LiveClientCommand, LiveMediaAdapter } from '../../openai-provider/live-contracts.mts';
import type { GptLiveAudioDevice, GptLiveMediaState } from '../../visual-experience/cinematic-v3/src/gpt-live-media.ts';
export type { GptLiveAudioDevice, GptLiveMediaState };
export interface NativeLiveMediaServices extends LiveMediaAdapter {
  prepare(input: { attemptId: string; inputDeviceId?: string; outputDeviceId?: string; bufferLeaseRef?:string; outputOnly?:true }): Promise<{ offerId: string; sdpOffer: string }>;
  quiesceCapture?(input:{attemptId:string;sessionId?:string}):Promise<void>;
  devices(): Promise<GptLiveAudioDevice[]>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  setLocalMute(muted: boolean): Promise<void>;
  resumePlayback(): Promise<void>;
  interruptPlayback(): Promise<void>;
  state(): Promise<GptLiveMediaState>;
  dispose(): Promise<void>;
}
export const NATIVE_LIVE_LIMITS = Object.freeze({ wireBytes: 196608, eventBytes: 65536, inFlight: 8, timeoutMs: 15000 });
const operations = ['prepare','connect','send','close','devices','setInputDevice','setOutputDevice','setLocalMute','resumePlayback','interruptPlayback','state','dispose','quiesceCapture'] as const;
type Operation = typeof operations[number];
const cleanup=(operation:Operation,payload:any)=>['dispose','close','quiesceCapture'].includes(operation)||operation==='send'&&payload?.command?.type==='session.close';
const errors = new Set(['live_media_unavailable','live_media_protocol','live_media_capacity','live_media_backpressure','live_media_timeout','live_media_closed','live_media_operation_failed']);
export class LiveMediaHostError extends Error { readonly code: string; constructor(code: string) { super(errors.has(code) ? code : 'live_media_operation_failed'); this.code = this.message; this.name = 'LiveMediaHostError'; } }
const exact = (value: unknown, keys: readonly string[]): value is Record<string,any> => !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length && keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/u.test(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const within = (value: unknown,max:number=NATIVE_LIVE_LIMITS.wireBytes) => { try { return Buffer.byteLength(JSON.stringify(value)) <= max; } catch { return false; } };
const sdp = (value: unknown) => typeof value === 'string' && Buffer.byteLength(value)>0 && Buffer.byteLength(value)<=65536;
const command = (value: unknown) => exact(value,['type','event_id']) && ['session.close','session.input_audio.mute','session.input_audio.unmute'].includes(String(value.type)) && id(value.event_id) ||
  exact(value,['type','event_id','delegation_id','content']) && ['session.thinking.append','session.commentary.append'].includes(String(value.type)) && id(value.event_id) &&
  (value.delegation_id===null||id(value.delegation_id)) && typeof value.content==='string' && Buffer.byteLength(value.content)<=500;
export const isNativeLiveHostEnvelope = (value: unknown): value is {nativeLiveHost: Record<string,any>} => !!value && (typeof value==='object'||typeof value==='function') && Object.hasOwn(value,'nativeLiveHost');
export type NativeLiveHostMessage = { nativeLiveHost: { version: 1; kind: 'request'|'response'|'event'; id: string; operation: string; payload?: any; result?: any; error?: string } };
function payloadValid(operation: Operation,p: unknown): boolean {
  if (operation==='prepare') return exact(p,['attemptId',...['inputDeviceId','outputDeviceId','bufferLeaseRef','outputOnly'].filter(key=>Object.hasOwn(p??{},key))]) && id(p.attemptId) && ['inputDeviceId','outputDeviceId','bufferLeaseRef'].every(key=>p[key]===undefined||id(p[key])) && (!Object.hasOwn(p,'outputOnly')||p.outputOnly===true&&!Object.hasOwn(p,'inputDeviceId')&&!Object.hasOwn(p,'bufferLeaseRef'));
  if (operation==='quiesceCapture') return exact(p,['attemptId',...(Object.hasOwn(p??{},'sessionId')?['sessionId']:[])])&&id(p.attemptId)&&(p.sessionId===undefined||id(p.sessionId));
  if (operation==='connect') return exact(p,['sessionId','sdpAnswer']) && id(p.sessionId) && sdp(p.sdpAnswer);
  if (operation==='send') return exact(p,['sessionId','command']) && id(p.sessionId) && command(p.command);
  if (operation==='close') return exact(p,['sessionId']) && id(p.sessionId);
  if (operation==='setInputDevice'||operation==='setOutputDevice') return exact(p,['deviceId'])&&id(p.deviceId);
  if (operation==='setLocalMute') return exact(p,['muted'])&&typeof p.muted==='boolean';
  return exact(p,[]);
}
function mediaState(value: any): boolean {
  const required=['contract','connection','microphoneAccess','localTrackEnabled','localSourceMuted','providerInputMute','playback','playbackObserved','humanAudibility','inputDevice','outputDevice','localSpeech','remoteSignal','interruption'];
  return exact(value,[...required,...(Object.hasOwn(value??{},'errorCode')?['errorCode']:[])]) && value.contract==='aerynth.gpt-live-media@1' &&
    ['idle','preparing','prepared','connecting','connected','closed','failed','disposed'].includes(value.connection) &&
    ['not-requested','active','released'].includes(value.microphoneAccess) && typeof value.localTrackEnabled==='boolean' && (value.localSourceMuted===null||typeof value.localSourceMuted==='boolean') &&
    ['unknown','unmuted','mute-pending','muted','unmute-pending'].includes(value.providerInputMute) && ['idle','pending','playing','blocked','paused','interrupted','ended','error'].includes(value.playback) &&
    typeof value.playbackObserved==='boolean' && value.humanAudibility==='unverified' && ['default','selected'].includes(value.inputDevice) && ['default','selected'].includes(value.outputDevice) &&
    ['unavailable','silent','detected'].includes(value.localSpeech) && ['unavailable','silent','detected'].includes(value.remoteSignal) && ['none','explicit-user','inferred-local-barge-in'].includes(value.interruption) &&
    (value.errorCode===undefined||typeof value.errorCode==='string'&&/^live_media_[a-z_]{1,64}$/u.test(value.errorCode));
}
function resultValid(operation: Operation,value: any): boolean {
  if (operation==='prepare') return exact(value,['offerId','sdpOffer'])&&id(value.offerId)&&sdp(value.sdpOffer);
  if (operation==='devices') return Array.isArray(value)&&value.length<=64&&value.every(device=>exact(device,['kind','id','label','labelAvailable'])&&['audioinput','audiooutput'].includes(device.kind)&&id(device.id)&&typeof device.label==='string'&&device.label.length<=200&&typeof device.labelAvailable==='boolean');
  if (operation==='state') return mediaState(value);
  return value===null;
}
export function validateNativeLiveHostMessage(value: unknown): value is NativeLiveHostMessage {
  if (!isNativeLiveHostEnvelope(value)||!exact(value,['nativeLiveHost'])) return false;
  const h=value.nativeLiveHost;
  if (!h||h.version!==1||!uuid(h.id)||!within(value)) return false;
  if (h.kind==='request') return exact(h,['version','kind','id','operation','payload'])&&operations.includes(h.operation)&&payloadValid(h.operation,h.payload);
  if (h.kind==='response') return operations.includes(h.operation)&&(exact(h,['version','kind','id','operation','error'])&&errors.has(h.error)||exact(h,['version','kind','id','operation','result'])&&resultValid(h.operation,h.result));
  if (h.kind!=='event'||!exact(h,['version','kind','id','operation','payload'])) return false;
  const p=h.payload;
  if(h.operation==='provider-event') return exact(p,['sessionId','event'])&&id(p.sessionId)&&!!p.event&&typeof p.event==='object'&&!Array.isArray(p.event)&&within(p.event,NATIVE_LIVE_LIMITS.eventBytes);
  if(h.operation==='connection-lost') return exact(p,['sessionId'])&&id(p.sessionId);
  return h.operation==='state'&&exact(p,['sessionId','state'])&&(p.sessionId===null||id(p.sessionId))&&mediaState(p.state);
}
export function createNativeLiveHostClient(send: (message: NativeLiveHostMessage)=>void, options: {timeoutMs?:number;inFlight?:number}={}) {
  const timeout=options.timeoutMs??NATIVE_LIVE_LIMITS.timeoutMs,capacity=options.inFlight??NATIVE_LIVE_LIMITS.inFlight;
  if(!Number.isSafeInteger(timeout)||timeout<=0||timeout>15000||!Number.isSafeInteger(capacity)||capacity<=0||capacity>8)throw new LiveMediaHostError('live_media_capacity');
  const pending=new Map<string,{operation:Operation;resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
  const sessions=new Map<string,Parameters<LiveMediaAdapter['connect']>[0]>(); let closed=false,queued=0;
  const request=(operation:Operation,payload:unknown)=>new Promise<any>((resolve,reject)=>{
    if(closed)return reject(new LiveMediaHostError('live_media_closed')); if(pending.size>=(operation==='dispose'?12:cleanup(operation,payload)?11:capacity))return reject(new LiveMediaHostError('live_media_backpressure'));
    const key=randomUUID(),message:NativeLiveHostMessage={nativeLiveHost:{version:1,kind:'request',id:key,operation,payload}};
    if(!validateNativeLiveHostMessage(message))return reject(new LiveMediaHostError('live_media_protocol'));
    const timer=setTimeout(()=>{pending.delete(key);reject(new LiveMediaHostError('live_media_timeout'));},timeout);pending.set(key,{operation,resolve,reject,timer});
    try{send(message);}catch{clearTimeout(timer);pending.delete(key);reject(new LiveMediaHostError('live_media_closed'));}
  });
  const services:NativeLiveMediaServices={
    prepare:input=>request('prepare',input),
    quiesceCapture:input=>request('quiesceCapture',input),
    async connect(input){if(sessions.size)throw new LiveMediaHostError('live_media_backpressure');sessions.set(input.sessionId,input);
      try{await request('connect',{sessionId:input.sessionId,sdpAnswer:input.sdpAnswer});}catch(error){sessions.delete(input.sessionId);throw error;}
      return {send:command=>request('send',{sessionId:input.sessionId,command}),close:async()=>{sessions.delete(input.sessionId);await request('close',{sessionId:input.sessionId});}};},
    devices:()=>request('devices',{}),state:()=>request('state',{}),
    setInputDevice:deviceId=>request('setInputDevice',{deviceId}),setOutputDevice:deviceId=>request('setOutputDevice',{deviceId}),
    setLocalMute:muted=>request('setLocalMute',{muted}),resumePlayback:()=>request('resumePlayback',{}),interruptPlayback:()=>request('interruptPlayback',{}),
    dispose:async()=>{await request('dispose',{});sessions.clear();},
  };
  return {services,handle(value:unknown){
    if(!isNativeLiveHostEnvelope(value))return false;
    if(!validateNativeLiveHostMessage(value))return true; const h=value.nativeLiveHost;
    if(h.kind==='response'){const prior=pending.get(h.id);if(!prior)return true;pending.delete(h.id);clearTimeout(prior.timer);
      if(h.operation!==prior.operation)prior.reject(new LiveMediaHostError('live_media_protocol'));else if(h.error)prior.reject(new LiveMediaHostError(h.error));else prior.resolve(structuredClone(h.result));
    }else if(h.kind==='event'){
      const session=sessions.get(h.payload.sessionId);if(!session)return true;
      if(h.operation==='connection-lost'){session.onConnectionLost();sessions.delete(h.payload.sessionId);}
      else if(h.operation==='provider-event'){
        if(++queued>32){queued--;session.onConnectionLost();sessions.delete(h.payload.sessionId);return true;}
        void Promise.resolve().then(()=>session.onEvent(structuredClone(h.payload.event))).catch(()=>{session.onConnectionLost();}).finally(()=>queued--);
      }
    }return true;
  },close(){if(closed)return;closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new LiveMediaHostError('live_media_closed'));}pending.clear();for(const session of sessions.values())session.onConnectionLost();sessions.clear();}};
}
export function createNativeLiveHostServer(services:NativeLiveMediaServices|undefined,send:(message:NativeLiveHostMessage)=>void,options:{timeoutMs?:number;inFlight?:number}={}) {
  const capacity=options.inFlight??8,timeout=options.timeoutMs??15000;
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>8||!Number.isSafeInteger(timeout)||timeout<1||timeout>15000)throw new LiveMediaHostError('live_media_capacity');
  const pending=new Set<string>(),channels=new Map<string,LiveChannel>();let closed=false,connecting=false;
  const publish=(message:NativeLiveHostMessage)=>{if(!closed&&validateNativeLiveHostMessage(message)){try{send(message);}catch{/* Owned transport has closed. */}}};
  const event=(operation:string,payload:unknown)=>publish({nativeLiveHost:{version:1,kind:'event',id:randomUUID(),operation,payload}});
  return {handle(value:unknown){
    if(!isNativeLiveHostEnvelope(value))return false;if(!validateNativeLiveHostMessage(value)||value.nativeLiveHost.kind!=='request')return true;
    const h=structuredClone(value.nativeLiveHost),reply=(result:any,error?:string)=>publish({nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,...(error?{error}:{result})}});
    if(closed)return true;if(!services){reply(null,'live_media_unavailable');return true;}if(pending.has(h.id)||pending.size>=(h.operation==='dispose'?12:cleanup(h.operation as Operation,h.payload)?11:capacity)){reply(null,'live_media_backpressure');return true;}
    pending.add(h.id);let done=false;const timer=setTimeout(()=>{done=true;pending.delete(h.id);reply(null,'live_media_timeout');},timeout);
    void Promise.resolve().then(async()=>{
      let result:any=null;const p=h.payload;
      switch(h.operation){
        case 'prepare':result=await services.prepare(p);break;
        case 'connect':{
          if(channels.size||connecting)throw new LiveMediaHostError('live_media_backpressure');
          connecting=true;let channel:LiveChannel;
          try{channel=await services.connect({sessionId:p.sessionId,sdpAnswer:p.sdpAnswer,onEvent:async e=>event('provider-event',{sessionId:p.sessionId,event:e}),onConnectionLost:()=>{event('connection-lost',{sessionId:p.sessionId});channels.delete(p.sessionId);}});}finally{connecting=false;}
          if(done||closed){await channel.close().catch(()=>{});return;}channels.set(p.sessionId,channel);break;
        }
        case 'send':{const channel=channels.get(p.sessionId);if(!channel)throw new LiveMediaHostError('live_media_protocol');await channel.send(p.command as LiveClientCommand);break;}
        case 'close':{const channel=channels.get(p.sessionId);channels.delete(p.sessionId);await channel?.close();break;}
        case 'devices':result=await services.devices();break;
        case 'state':result=await services.state();break;
        case 'setInputDevice':await services.setInputDevice(p.deviceId);break;
        case 'setOutputDevice':await services.setOutputDevice(p.deviceId);break;
        case 'setLocalMute':await services.setLocalMute(p.muted);break;
        case 'resumePlayback':await services.resumePlayback();break;
        case 'interruptPlayback':await services.interruptPlayback();break;
        case 'quiesceCapture':if(!services.quiesceCapture)throw new LiveMediaHostError('live_media_unavailable');await services.quiesceCapture(p);break;
        case 'dispose':channels.clear();await services.dispose();break;
      }
      if(!done){done=true;clearTimeout(timer);pending.delete(h.id);reply(resultValid(h.operation as Operation,result)?result:null,resultValid(h.operation as Operation,result)?undefined:'live_media_protocol');}
    }).catch(error=>{if(!done){done=true;clearTimeout(timer);pending.delete(h.id);reply(null,error instanceof LiveMediaHostError?error.code:'live_media_operation_failed');}});
    return true;
  },close(){closed=true;pending.clear();for(const channel of channels.values())void channel.close().catch(()=>{});channels.clear();}};
}
