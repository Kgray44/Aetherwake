import path from 'node:path';import {readFile,writeFile} from 'node:fs/promises';import {performance} from 'node:perf_hooks';
import {createLocalWakeEngine} from '../prototypes/integrated-backend/src/wake-engine.mts';
import {DEFAULT_WAKE_PHRASES} from '../prototypes/integrated-backend/src/wake-engine-phrases.mts';
const [artifactRoot,fixtureRoot,outputFile,sensitivityValue='0.5']=process.argv.slice(2);if(![artifactRoot,fixtureRoot,outputFile].every(value=>value&&path.isAbsolute(value)))throw Error('absolute_owned_paths_required');
const sensitivity=Number(sensitivityValue);
function wave(bytes){if(bytes.length>2097152||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('fixture_wave_invalid');let format,data;
 for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;if(end>bytes.length)throw Error('fixture_wave_invalid');const name=bytes.toString('ascii',offset,offset+4);if(name==='fmt ')format=bytes.subarray(start,end);if(name==='data')data=bytes.subarray(start,end);offset=end+(size%2);}
 if(!format||format.length<16||format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt32LE(4)!==16000||format.readUInt16LE(14)!==16||!data||data.length%2)throw Error('fixture_wave_invalid');
 const samples=new Float32Array(data.length/2);for(let i=0;i<samples.length;i++)samples[i]=data.readInt16LE(i*2)/32768;return {samples,sampleRate:16000};}
const fixtures=JSON.parse((await readFile(path.join(fixtureRoot,'fixtures.json'),'utf8')).replace(/^\uFEFF/u,''));if(!Array.isArray(fixtures)||fixtures.length>32)throw Error('fixture_bound');
const engine=createLocalWakeEngine({artifactRoot,manifestPath:path.join(artifactRoot,'wake-model-manifest.json'),workDirectory:path.join(path.dirname(outputFile),'worker-work'),phrases:[...DEFAULT_WAKE_PHRASES],sensitivity});
const start=performance.now(),initialMemory=process.memoryUsage(),results=[];let sequence=0,processedSamples=0;
try{
  const engineInfo=await engine.start(),loadMs=performance.now()-start;
  for(const fixture of fixtures){
    if(typeof fixture.file!=='string'||path.basename(fixture.file)!==fixture.file||!fixture.file.endsWith('.wav'))throw Error('fixture_path_invalid');
    await engine.reset();sequence=0;const data=wave(await readFile(path.join(fixtureRoot,fixture.file)));if(data.sampleRate!==16000)throw Error('fixture_sample_rate');
    const before=performance.now(),detections=[];let previous=processedSamples,cpuMicroseconds=0,peakWorkerRssBytes=0;
    for(let offset=0;offset<data.samples.length;offset+=320){const result=await engine.acceptPcm({sequence:sequence++,sampleRate:16000,samples:data.samples.slice(offset,offset+320)});processedSamples=result.processedSamples;cpuMicroseconds+=result.metrics.cpuMicroseconds;peakWorkerRssBytes=Math.max(peakWorkerRssBytes,result.metrics.rssBytes);detections.push(...result.detections.map(detection=>({...detection,clipKeywordStartSeconds:(detection.keywordStartSample-previous)/16000,clipKeywordEndSeconds:(detection.keywordEndSample-previous)/16000,clipDetectedAtSeconds:(detection.detectedAtSample-previous)/16000})));}
    // Tail silence gives the streaming decoder its required right context.
    for(let i=0;i<40;i++){const result=await engine.acceptPcm({sequence:sequence++,sampleRate:16000,samples:new Float32Array(320)});processedSamples=result.processedSamples;detections.push(...result.detections);}
    const elapsedMs=performance.now()-before,audioSeconds=data.samples.length/16000+0.8;
    results.push({file:fixture.file,expected:fixture.expected,matched:fixture.expected?detections.some(d=>d.phraseId===fixture.expected):detections.length===0,detections,audioSeconds,elapsedMs,cpuMicroseconds,peakWorkerRssBytes,realTimeFactor:elapsedMs/(audioSeconds*1000)});
  }
  const receipt={contract:'aerynth.local-wake-evaluation@1',platform:process.platform,architecture:process.arch,node:process.version,engine:engineInfo,loadMs,initialMemory,loadedMemory:process.memoryUsage(),results,positiveCount:results.filter(row=>row.expected).length,positivePassed:results.filter(row=>row.expected&&row.matched).length,negativeCount:results.filter(row=>!row.expected).length,negativePassed:results.filter(row=>!row.expected&&row.matched).length,microphoneCapture:false,remoteRequests:0,audioSource:'Synthetic offline Windows SAPI PCM only; no human recordings. Accuracy does not establish field false-accept/false-reject rates.'};
  await writeFile(outputFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...receipt,initialMemory:undefined,loadedMemory:undefined,results:results.map(row=>({...row,detections:row.detections.map(d=>({phraseId:d.phraseId,keywordStartSample:d.keywordStartSample,keywordEndSample:d.keywordEndSample,detectedAtSample:d.detectedAtSample,clipKeywordEndSeconds:d.clipKeywordEndSeconds}))}))}));
}finally{await engine.dispose();}
