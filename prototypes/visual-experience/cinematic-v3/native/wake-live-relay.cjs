/** Main-only bounded PCM handoff. No public IPC, file writes, provider calls or journal. */
function createWakeLiveRelay({claim,release,deliver,failed,timeoutMs=2000}){
 let owner=null,closed=false;
 const wipe=value=>value?.samples?.fill(0);
 function stop(attemptId){
  const prior=owner;if(!prior||attemptId!==undefined&&attemptId!==prior.attemptId)return false;owner=null;
  clearTimeout(prior.timer);prior.rejectFlight?.(Error('live_media_closed'));
  for(const frame of prior.queue)wipe(frame);prior.queue.splice(0);wipe(prior.inFlight);
  prior.retained=0;for(const waiter of prior.waiters)waiter.reject(Error('live_media_closed'));prior.waiters.splice(0);
  release(prior.attemptId);return true;
 }
 function fault(prior){if(owner!==prior)return;try{stop(prior.attemptId);}finally{failed?.(prior.attemptId);}}
 async function drain(prior){
  if(owner!==prior||!prior.ready||prior.running)return;prior.running=true;
  try{
   while(owner===prior&&prior.queue.length){
    const frame=prior.queue.shift();prior.inFlight=frame;
    const result=await Promise.race([Promise.resolve().then(()=>deliver(prior.attemptId,frame)),new Promise((_,reject)=>{prior.rejectFlight=reject;prior.timer=setTimeout(()=>reject(Error('live_media_timeout')),timeoutMs);})]);
    clearTimeout(prior.timer);prior.rejectFlight=null;
    if(owner!==prior)return;
    if(result?.accepted!==true||result.nextSample!==frame.startSample+frame.samples.length)throw Error('live_media_protocol');
    prior.acked=result.nextSample;prior.retained-=frame.samples.length;wipe(frame);prior.inFlight=null;
    for(const waiter of prior.waiters.filter(waiter=>waiter.until<=prior.acked))waiter.resolve();
    prior.waiters=prior.waiters.filter(waiter=>waiter.until>prior.acked);
   }
  }catch{fault(prior);}
  finally{clearTimeout(prior.timer);prior.rejectFlight=null;wipe(prior.inFlight);prior.inFlight=null;prior.running=false;}
 }
 function enqueue(prior,startSample,samples){
  if(owner!==prior||closed||!(samples instanceof Float32Array)||samples.buffer instanceof SharedArrayBuffer||samples.length<1||samples.length>640||
    !Number.isSafeInteger(startSample)||startSample!==prior.received||!samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=1)||prior.retained+samples.length>128000){fault(prior);throw Error('live_media_protocol');}
  prior.queue.push({startSample,samples:new Float32Array(samples)});prior.retained+=samples.length;prior.received+=samples.length;void drain(prior);
 }
 return {
  bind(input){
   if(closed||owner||typeof input?.bufferLeaseRef!=='string'||typeof input?.attemptId!=='string')throw Error('live_media_protocol');
   const prior={attemptId:input.attemptId,ready:false,received:0,acked:0,retained:0,queue:[],waiters:[],inFlight:null,running:false,timer:null,rejectFlight:null};owner=prior;
   let prefix;
   try{
    prefix=claim(input.bufferLeaseRef,input.attemptId,async frame=>{enqueue(prior,frame.startSample,frame.samples);});
    if(!(prefix?.samples instanceof Float32Array)||prefix.samples.length>128000)throw Error('live_media_protocol');
    for(let offset=0;offset<prefix.samples.length;offset+=640)enqueue(prior,offset,prefix.samples.subarray(offset,offset+640));
   }catch{stop(prior.attemptId);throw Error('live_media_protocol');}finally{prefix?.release();}
  },
  async ready(attemptId){
   const prior=owner;if(!prior||prior.attemptId!==attemptId||closed)throw Error('live_media_protocol');
   prior.ready=true;const until=prior.received;
   const primed=prior.acked>=until?Promise.resolve():new Promise((resolve,reject)=>prior.waiters.push({until,resolve,reject}));
   void drain(prior);await primed;if(owner!==prior)throw Error('live_media_closed');
  },
  stop,
  state(){return owner?{attemptId:owner.attemptId,ready:owner.ready,receivedSamples:owner.received,ackedSamples:owner.acked,retainedSamples:owner.retained}:null;},
  dispose(){if(closed)return;closed=true;stop();},
 };
}
module.exports={createWakeLiveRelay};
