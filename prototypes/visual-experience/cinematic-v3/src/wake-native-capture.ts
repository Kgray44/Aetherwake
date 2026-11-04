/** Sandboxed isolated preload. There is no main-world API or script injection. */
import { WakeAudioCapture, type WakeCaptureState, type WakeCaptureEnvironment, type WakePcmFrame } from './wake-audio-capture.ts';
const CHANNEL = 'aerynth-private-wake-capture';
type Header = { version:1;kind:'request'|'response';id:string;operation:string;payload?:any;result?:unknown;error?:string };
type Wire = { nativeWakeCapture:Header };
type Capture = Pick<WakeAudioCapture,'start'|'pause'|'stop'|'state'|'dispose'>;
const exact = (value:any,keys:string[]) => !!value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&
  keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const generation = (value:unknown):value is number => Number.isSafeInteger(value)&&Number(value)>0;
const uuid = (value:unknown):value is string => typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
export function validNativeWakeRequest(value:any):value is Wire {
  if(!exact(value,['nativeWakeCapture']))return false;
  const h=value.nativeWakeCapture,p=h?.payload;
  if(!exact(h,['version','kind','id','operation','payload'])||h.version!==1||h.kind!=='request'||!uuid(h.id))return false;
  if(h.operation==='arm')return exact(p,['generation',...(Object.hasOwn(p??{},'inputDeviceId')?['inputDeviceId']:[])])&&generation(p.generation)&&
    (p.inputDeviceId===undefined||typeof p.inputDeviceId==='string'&&p.inputDeviceId.length>0&&p.inputDeviceId.length<=256&&!/[\x00-\x1f]/u.test(p.inputDeviceId));
  if(h.operation==='pause')return exact(p,['generation'])&&generation(p.generation);
  if(h.operation==='stop')return exact(p,Object.hasOwn(p??{},'generation')?['generation']:[])&&(p.generation===undefined||generation(p.generation));
  return h.operation==='state'&&exact(p,[]);
}
export function validSyntheticWakePcm(value:any):value is {sampleRate:16000;samples:Float32Array} {
  try{return exact(value,['sampleRate','samples'])&&value.sampleRate===16000&&value.samples instanceof Float32Array&&
    !(value.samples.buffer instanceof SharedArrayBuffer)&&value.samples.length>=1&&value.samples.byteLength<=2097152&&
    value.samples.every((sample:number)=>Number.isFinite(sample)&&Math.abs(sample)<=1);}catch{return false;}
}
/** QA only: constructor-selected PCM or silence; never requests an ambient microphone. */
function syntheticEnvironment(read:()=>Float32Array|null){
  const resources=new Set<{context:AudioContext;source:AudioBufferSourceNode;stream:MediaStream;buffer:AudioBuffer;started:boolean}>();
  return {environment:{async getUserMedia(){
    const context=new AudioContext({sampleRate:16000});if(context.sampleRate!==16000){await context.close();throw Error('wake_synthetic_sample_rate');}
    const destination=context.createMediaStreamDestination(),source=context.createBufferSource(),samples=read()??new Float32Array(16000);
    const buffer=context.createBuffer(1,samples.length,16000);buffer.copyToChannel(new Float32Array(samples),0);source.buffer=buffer;source.connect(destination);
    resources.add({context,source,stream:destination.stream,buffer,started:false});return destination.stream;
  },async startSource(){for(const value of resources)if(!value.started){value.started=true;value.source.start();await value.context.resume();}}
  } satisfies Partial<WakeCaptureEnvironment>,async dispose(){for(const value of resources){for(const track of value.stream.getTracks())track.stop();
    value.buffer.getChannelData(0).fill(0);try{value.source.stop();value.source.disconnect();}catch{/* Already ended. */}await value.context.close().catch(()=>{});}resources.clear();}};
}
export function createNativeWakeRuntime(send:(kind:'reply'|'frame'|'state',value:unknown)=>void,options:{
  workletUrl:string;syntheticInput?:boolean;captureFactory?:(options:ConstructorParameters<typeof WakeAudioCapture>[0])=>Capture;
}){
  let closed=false,arming=false,fixture:Float32Array|null=null;
  const pending=new Map<string,{resolve():void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
  const seen=new Set<string>(),synthetic=options.syntheticInput?syntheticEnvironment(()=>fixture):null;
  const rejectFrames=()=>{for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error('wake_capture_stopped'));}pending.clear();};
  const capture=(options.captureFactory??(settings=>new WakeAudioCapture(settings)))({workletUrl:options.workletUrl,...(synthetic?{environment:synthetic.environment}:{}),
    onState:state=>{if(!closed)send('state',state);},onFrame:frame=>new Promise<void>((resolve,reject)=>{
      if(closed||pending.size>=4)return reject(Error('wake_capture_backpressure'));
      const key=frame.generation+':'+frame.sequence,timer=setTimeout(()=>{pending.delete(key);reject(Error('wake_capture_ack_timeout'));},2000);
      pending.set(key,{resolve,reject,timer});send('frame',frame);
    })});
  const releaseFixture=()=>{fixture?.fill(0);fixture=null;};
  return {
    async handle(value:unknown){
      if(!validNativeWakeRequest(value))return;
      const h=value.nativeWakeCapture,p=h.payload;
      const reply=(result:unknown,error?:string)=>send('reply',{nativeWakeCapture:{version:1,kind:'response',id:h.id,operation:h.operation,...(error?{error}:{result})}});
      if(closed){reply(null,'wake_capture_closed');return;}
      if(h.operation==='stop'){
        if(p.generation!==undefined&&p.generation!==capture.state().generation){reply(capture.state());return;}
        rejectFrames();const stopped=capture.stop(p.generation);await synthetic?.dispose();releaseFixture();
        try{reply(await stopped);}catch{reply(null,'wake_capture_operation_failed');}return;
      }
      if(seen.has(h.id)||arming&&h.operation!=='state'){reply(null,'wake_capture_busy');return;}
      seen.add(h.id);if(seen.size>64)seen.delete(seen.values().next().value!);
      try{if(h.operation==='state'){reply(capture.state());return;}
        if(h.operation==='pause'){reply(capture.pause(p.generation));return;}
        arming=true;reply(await capture.start(p));}
      catch{reply(null,'wake_capture_operation_failed');}
      finally{if(h.operation==='arm')arming=false;}
    },
    ack(value:unknown){if(!exact(value,['generation','sequence'])||!generation((value as any).generation)||!Number.isSafeInteger((value as any).sequence))return;
      const key=(value as any).generation+':'+(value as any).sequence,entry=pending.get(key);if(!entry)return;pending.delete(key);clearTimeout(entry.timer);entry.resolve();},
    setSyntheticPcm(value:unknown){if(!options.syntheticInput||!validSyntheticWakePcm(value)||arming)return false;releaseFixture();fixture=new Float32Array(value.samples);return true;},
    async dispose(){if(closed)return;closed=true;rejectFrames();const stopped=capture.dispose();await synthetic?.dispose();releaseFixture();await stopped;},
    state:()=>capture.state(),
  };
}
declare const require:undefined|((name:string)=>any);
declare const process:{argv:string[]};
if(typeof require==='function'){
  const {ipcRenderer}=require('electron'),token=process.argv.find(arg=>arg.startsWith('--aerynth-wake-token='))?.slice('--aerynth-wake-token='.length),
    workletUrl=process.argv.find(arg=>arg.startsWith('--aerynth-wake-worklet='))?.slice('--aerynth-wake-worklet='.length);
  if(token&&/^[a-f0-9]{64}$/u.test(token)&&workletUrl&&/^file:\/\//u.test(workletUrl)){
    const runtime=createNativeWakeRuntime((kind,value)=>ipcRenderer.send(CHANNEL+'-'+kind,{token,value}),{workletUrl,syntheticInput:process.argv.includes('--aerynth-wake-synthetic')});
    const command=(_event:unknown,value:any)=>{if(exact(value,['token','value'])&&value.token===token)void runtime.handle(value.value);};
    const ack=(_event:unknown,value:any)=>{if(exact(value,['token','value'])&&value.token===token)runtime.ack(value.value);};
    const source=(_event:unknown,value:any)=>{if(exact(value,['token','value'])&&value.token===token)runtime.setSyntheticPcm(value.value);};
    ipcRenderer.on(CHANNEL+'-command',command);ipcRenderer.on(CHANNEL+'-ack',ack);ipcRenderer.on(CHANNEL+'-qa-source',source);
    addEventListener('unload',()=>{ipcRenderer.removeListener(CHANNEL+'-command',command);ipcRenderer.removeListener(CHANNEL+'-ack',ack);ipcRenderer.removeListener(CHANNEL+'-qa-source',source);void runtime.dispose();},{once:true});
    ipcRenderer.send(CHANNEL+'-ready',{token});
  }
}
