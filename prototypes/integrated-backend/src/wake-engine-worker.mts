import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyWakeArtifacts} from './wake-engine-artifacts.mts';
import {compileWakeKeywords,type WakePhrase} from './wake-engine-phrases.mts';
let spotter:any,stream:any,total=0,base=0,sequence=0,busy=false,ready=false,workerData:any;
let phrases:WakePhrase[]=[];
const safeError=(code:string)=>({error:code});
async function initialize(){
  const {root,registry}=await verifyWakeArtifacts(workerData.artifactRoot,workerData.manifestPath);
  const at=(role:keyof typeof registry.roles)=>path.join(root,registry.roles[role]);
  const keywords=compileWakeKeywords(phrases,await readFile(at('bpe')),workerData.sensitivity);
  await writeFile(workerData.keywordPath,keywords,{flag:'wx'});
  const require=createRequire(at('package')),sherpa=require('./sherpa-onnx.js');
  if(sherpa.version!==registry.version||sherpa.onnxruntimeVersion!==registry.onnxruntimeVersion)throw Error('wake_engine_version');
  spotter=new sherpa.KeywordSpotter({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{transducer:{encoder:at('encoder'),decoder:at('decoder'),joiner:at('joiner')},tokens:at('tokens'),numThreads:1,provider:'cpu',debug:false},maxActivePaths:4,numTrailingBlanks:1,keywordsScore:1,keywordsThreshold:Math.max(0.01,0.5-0.5*workerData.sensitivity),keywordsFile:workerData.keywordPath});
  stream=spotter.createStream();ready=true;
  return {engine:'sherpa-onnx',version:registry.version,modelId:registry.modelId,sampleRate:16000,threads:1,provider:'cpu',threshold:Math.max(0.01,0.5-0.5*workerData.sensitivity)};
}
process.on('message',async(message:any)=>{
  if(!message||!Number.isSafeInteger(message.id)||busy)return;busy=true;
  let samples:Float32Array|undefined;
  try{
    let result:unknown;
    if(message.operation==='start'&&!ready){workerData=message.configuration;phrases=workerData.phrases;result=await initialize();}
    else if(message.operation==='pcm'&&ready){
      samples=message.samples;
      if(!(samples instanceof Float32Array)||samples.length<1||samples.length>16000||message.sequence!==sequence||message.sampleRate!==16000||!samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=1))throw Error('wake_pcm_invalid');
      const cpu=process.cpuUsage(),started=performance.now();sequence++;total+=samples.length;stream.acceptWaveform({samples,sampleRate:16000});const detections=[];
      while(spotter.isReady(stream)){
        spotter.decode(stream);const observed=spotter.getResult(stream);if(!observed.keyword)continue;
        const phrase=phrases.find(item=>item.id===observed.keyword),times=observed.timestamps;
        if(!phrase||!Number.isFinite(observed.start_time)||!Array.isArray(times)||!times.length||!times.every((time:number)=>Number.isFinite(time)&&time>=0))throw Error('wake_engine_result_invalid');
        const keywordStartSample=base+Math.round((observed.start_time+times[0])*16000),keywordEndSample=base+Math.round((observed.start_time+times.at(-1)+0.04)*16000);
        if(keywordStartSample<0||keywordEndSample<keywordStartSample||keywordEndSample>total+640)throw Error('wake_engine_result_invalid');
        detections.push({phraseId:phrase.id,text:phrase.text,keywordStartSample,keywordEndSample:Math.min(total,keywordEndSample),detectedAtSample:total,sampleRate:16000,timestampSource:'sherpa-token-alignment-40ms',boundaryAccuracy:'model-estimate'});
        if(detections.length>8)throw Error('wake_engine_result_invalid');spotter.reset(stream);
      }
      const used=process.cpuUsage(cpu);result={processedSamples:total,detections,metrics:{cpuMicroseconds:used.user+used.system,elapsedMs:performance.now()-started,rssBytes:process.memoryUsage().rss}};
    }else if(message.operation==='reset'&&ready){stream=spotter.createStream();base=total;sequence=0;result=null;}
    else throw Error('wake_engine_protocol');
    process.send?.({id:message.id,result});
  }catch{process.send?.({id:message.id,...safeError(ready?'wake_engine_processing_failed':'wake_engine_setup_failed')});}
  finally{samples?.fill(0);busy=false;}
});
process.on('disconnect',()=>process.exit(0));
