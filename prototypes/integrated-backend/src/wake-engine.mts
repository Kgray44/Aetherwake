import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir,lstat,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateWakePhrases,type WakePhrase} from './wake-engine-phrases.mts';
export type {WakePhrase};
export interface WakeDetection {phraseId:string;text:string;keywordStartSample:number;keywordEndSample:number;detectedAtSample:number;sampleRate:16000;timestampSource:'sherpa-token-alignment-40ms';boundaryAccuracy:'model-estimate'}
export interface WakePcmResult {processedSamples:number;detections:WakeDetection[];metrics:{cpuMicroseconds:number;elapsedMs:number;rssBytes:number}}
export interface WakeEngineInfo {engine:'sherpa-onnx';version:string;modelId:string;sampleRate:16000;threads:1;provider:'cpu';threshold:number}
export interface LocalWakeEngineOptions {artifactRoot:string;manifestPath:string;workDirectory:string;phrases:WakePhrase[];sensitivity:number}
const invalid=()=>{throw Error('wake_engine_invalid_request');};
export function wakeChildEnvironment(workDirectory:string):NodeJS.ProcessEnv{
  const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT??'C:\\Windows';
  return {SystemRoot:systemRoot,WINDIR:systemRoot,COMSPEC:path.join(systemRoot,'System32','cmd.exe'),PATH:path.join(systemRoot,'System32')+';'+systemRoot,TEMP:workDirectory,TMP:workDirectory};
}
export function validateWakePcm(input:unknown):asserts input is {sequence:number;sampleRate:16000;samples:Float32Array}{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3)invalid();const value=input as any;
  if(!Number.isSafeInteger(value.sequence)||value.sequence<0||value.sampleRate!==16000||!(value.samples instanceof Float32Array)||value.samples.buffer instanceof SharedArrayBuffer||value.samples.length<1||value.samples.length>16000||!value.samples.every((sample:number)=>Number.isFinite(sample)&&Math.abs(sample)<=1))invalid();
}
/** A local PCM consumer only. It never opens a device, calls a provider or persists audio. */
export function createLocalWakeEngine(inputOptions:LocalWakeEngineOptions){
  if(!inputOptions||Object.keys(inputOptions).length!==5||!['artifactRoot','manifestPath','workDirectory','phrases','sensitivity'].every(key=>Object.hasOwn(inputOptions,key)))invalid();
  const options=structuredClone(inputOptions);
  const phrases=validateWakePhrases(options.phrases);
  if(![options.artifactRoot,options.manifestPath,options.workDirectory].every(value=>typeof value==='string'&&path.isAbsolute(value))||!Number.isFinite(options.sensitivity)||options.sensitivity<0||options.sensitivity>1)invalid();
  let worker:ChildProcess|undefined,closed=false,started=false,starting=false,serial=0,sequence=0,total=0,disposeFlight:Promise<void>|undefined;
  let pending:{id:number;resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}|undefined;
  let keywordPath=path.join(path.resolve(options.workDirectory),'wake-keywords-'+randomUUID()+'.txt');
  function dispose():Promise<void>{if(disposeFlight)return disposeFlight;closed=true;started=false;const prior=worker;worker=undefined;
    if(pending){clearTimeout(pending.timer);pending.reject(Error('wake_engine_closed'));pending=undefined;}
    disposeFlight=(async()=>{try{
      if(prior&&prior.exitCode===null&&prior.signalCode===null)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('wake_engine_teardown_unconfirmed')),3000);prior.once('exit',()=>{clearTimeout(timer);resolve();});prior.kill();});
    }finally{await unlink(keywordPath).catch(()=>{});}})();return disposeFlight;
  }
  const failWorker=()=>{if(pending){pending.reject(Error('wake_engine_failed'));clearTimeout(pending.timer);pending=undefined;}void dispose().catch(()=>{});};
  const request=(operation:string,payload:Record<string,unknown>={},transfer:ArrayBuffer[]=[])=>new Promise<any>((resolve,reject)=>{
    if(closed||!worker)return reject(Error('wake_engine_closed'));if(pending)return reject(Error('wake_engine_busy'));
    const id=++serial,timer=setTimeout(()=>{if(pending?.id!==id)return;pending=undefined;reject(Error('wake_engine_timeout'));void dispose().catch(()=>{});},operation==='start'?15000:2000);
    pending={id,resolve,reject,timer};try{worker.send!({id,operation,...payload},error=>{for(const buffer of transfer)new Float32Array(buffer).fill(0);if(error&&pending?.id===id){clearTimeout(timer);pending=undefined;reject(Error('wake_engine_closed'));void dispose().catch(()=>{});}});}catch{for(const buffer of transfer)new Float32Array(buffer).fill(0);clearTimeout(timer);pending=undefined;reject(Error('wake_engine_closed'));void dispose().catch(()=>{});}
  });
  return {
    async start():Promise<WakeEngineInfo>{
      if(closed)throw Error('wake_engine_closed');if(worker||starting)throw Error('wake_engine_busy');starting=true;
      try{
      await mkdir(options.workDirectory,{recursive:true});const info=await lstat(options.workDirectory);
      if(!info.isDirectory()||info.isSymbolicLink())invalid();
      keywordPath=path.join(await realpath(options.workDirectory),path.basename(keywordPath));
      if(closed)throw Error('wake_engine_closed');
      worker=spawn(process.execPath,['--experimental-strip-types','--max-old-space-size=64',fileURLToPath(new URL('./wake-engine-worker.mts',import.meta.url))],{stdio:['ignore','pipe','pipe','ipc'],serialization:'advanced',windowsHide:true,env:wakeChildEnvironment(await realpath(options.workDirectory))});
      let diagnosticBytes=0;const discard=(chunk:Buffer)=>{diagnosticBytes+=chunk.length;if(diagnosticBytes>65536)failWorker();};
      worker.stdout?.on('data',discard);worker.stderr?.on('data',discard);
      worker.on('message',(message:any)=>{if(!pending||message?.id!==pending.id)return;
        try{if(Object.keys(message).length!==2||Buffer.byteLength(JSON.stringify(message))>65536)throw Error();}catch{failWorker();return;}
        const prior=pending;pending=undefined;clearTimeout(prior.timer);
        if(message.error){prior.reject(Error('wake_engine_failed'));void dispose().catch(()=>{});}else prior.resolve(message.result);
      });
      worker.on('error',failWorker);
      worker.on('exit',()=>{if(!closed)failWorker();});
      try{const result=await request('start',{configuration:{...options,phrases,keywordPath}});if(result?.engine!=='sherpa-onnx'||result.sampleRate!==16000||result.threads!==1||result.provider!=='cpu')throw Error('wake_engine_failed');started=true;return result;}
      catch(error){await dispose();throw error;}
      }finally{starting=false;}
    },
    async acceptPcm(input:{sequence:number;sampleRate:16000;samples:Float32Array}):Promise<WakePcmResult>{
      validateWakePcm(input);if(closed||!started)throw Error('wake_engine_closed');if(pending)throw Error('wake_engine_busy');if(input.sequence!==sequence)invalid();
      const owned=new Float32Array(input.samples),result=await request('pcm',{sequence:input.sequence,sampleRate:16000,samples:owned},[owned.buffer]);
      const target=total+input.samples.length;
      if(result?.processedSamples!==target||!result.metrics||!Object.values(result.metrics).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)||!Array.isArray(result.detections)||result.detections.length>8||!result.detections.every((d:WakeDetection)=>{
        const phrase=phrases.find(item=>item.id===d.phraseId);return phrase&&d.text===phrase.text&&d.sampleRate===16000&&d.timestampSource==='sherpa-token-alignment-40ms'&&d.boundaryAccuracy==='model-estimate'&&[d.keywordStartSample,d.keywordEndSample,d.detectedAtSample].every(Number.isSafeInteger)&&d.keywordStartSample>=0&&d.keywordStartSample<=d.keywordEndSample&&d.keywordEndSample<=target&&d.detectedAtSample===target;
      })){await dispose();throw Error('wake_engine_failed');}
      sequence++;total=target;return result;
    },
    async reset(){if(!started||closed)throw Error('wake_engine_closed');await request('reset');sequence=0;},dispose,
  };
}
