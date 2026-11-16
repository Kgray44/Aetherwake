/** Linux proc sampling, bounded frequency; no process-tree or GPU claims. */
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export function observeResources(pid,{intervalMs=250,platform=process.platform}={}) {
 if(!Number.isInteger(intervalMs)||intervalMs<100) throw Error('Sampling interval must be >=100ms');
 let count=0,busy=false,overheadMs=0,peakRss=null,peakVm=null,firstCpu=null,lastCpu=null,firstRead=null,lastRead=null,firstWrite=null,lastWrite=null,ticks=null;
 const setupStarted=process.hrtime.bigint();
 if(platform==='linux')try{ticks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
 overheadMs+=Number(process.hrtime.bigint()-setupStarted)/1e6;
 async function sample(){
  if(busy||platform!=='linux')return;busy=true;const started=process.hrtime.bigint();
  try{
   const [status,stat,io]=await Promise.all([readFile('/proc/'+pid+'/status','utf8'),readFile('/proc/'+pid+'/stat','utf8'),readFile('/proc/'+pid+'/io','utf8').catch(()=>null)]);
   const number=(text,key)=>Number(text?.match(new RegExp('^'+key+':\\s+(\\d+)','m'))?.[1]);
   const rss=number(status,'VmRSS'),hwm=number(status,'VmHWM');if(Number.isFinite(rss))peakRss=Math.max(peakRss??0,rss*1024);if(Number.isFinite(hwm))peakVm=Math.max(peakVm??0,hwm*1024);
   const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');const cpu=Number(fields[11])+Number(fields[12]);if(Number.isFinite(cpu)){firstCpu??=cpu;lastCpu=cpu;}
   for(const [key,set] of [['read_bytes',v=>{firstRead??=v;lastRead=v;}],['write_bytes',v=>{firstWrite??=v;lastWrite=v;}]]) {const v=number(io,key);if(Number.isFinite(v))set(v);}
   count++;
  }catch{}finally{overheadMs+=Number(process.hrtime.bigint()-started)/1e6;busy=false;}
 }
 const timer=platform==='linux'?setInterval(sample,intervalMs):null;timer?.unref();const initial=sample();
 return {async stop(){if(timer)clearInterval(timer);await initial;while(busy)await new Promise(r=>setTimeout(r,1));
  const metric=(name,value,unit)=>({name,availability:value===null?'unavailable':'observed',...(value!==null?{value}:{}),unit,source:'linux_proc',method:'sampled_direct_child_only'});
  return [metric('child_sampled_peak_rss_bytes',count?peakRss:null,'bytes'),metric('child_observed_high_water_rss_bytes',count?peakVm:null,'bytes'),metric('child_sampled_cpu_ms',ticks&&lastCpu!==null?(lastCpu-firstCpu)*1000/ticks:null,'ms'),metric('child_sampled_disk_read_bytes',lastRead===null?null:lastRead-firstRead,'bytes'),metric('child_sampled_disk_write_bytes',lastWrite===null?null:lastWrite-firstWrite,'bytes'),{name:'monitor_sampling_elapsed_ms',availability:'observed',value:overheadMs,unit:'ms',source:'local_monotonic_clock',method:'sampling_including_io_wait'},{name:'resource_sample_count',availability:'observed',value:count,unit:'count',source:'local_observer',method:'successful_samples'}];
 }};
}
