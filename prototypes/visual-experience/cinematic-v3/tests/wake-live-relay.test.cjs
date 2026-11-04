const test=require('node:test'),assert=require('node:assert/strict');
const {createWakeLiveRelay}=require('../native/wake-live-relay.cjs');
function fixture(options={}){
 let feed;const sent=[],releases=[],failures=[],prefix=new Float32Array(1280).fill(.1);
 const relay=createWakeLiveRelay({claim:(_ref,_attempt,callback)=>{feed=callback;return {samples:prefix,release(){prefix.fill(0);}};},release:id=>releases.push(id),
  deliver:async(attempt,frame)=>{sent.push({attempt,startSample:frame.startSample,samples:new Float32Array(frame.samples)});return {accepted:true,nextSample:frame.startSample+frame.samples.length};},failed:id=>failures.push(id),...options});
 return {relay,prefix,sent,releases,failures,feed:(...args)=>feed(...args)};
}
test('relay primes the exact prefix before paid start and forwards continuous same-capture frames in order',async()=>{
 const f=fixture();try{
  f.relay.bind({bufferLeaseRef:'opaque-private-ref',attemptId:'attempt-one'});assert.ok(f.prefix.every(x=>x===0));assert.equal(f.sent.length,0);
  await f.feed({startSample:1280,samples:new Float32Array(640).fill(.2)});await f.relay.ready('attempt-one');
  assert.deepEqual(f.sent.map(frame=>frame.startSample),[0,640,1280]);assert.equal(f.relay.state().ackedSamples,1920);assert.equal(f.relay.state().retainedSamples,0);
  assert.equal(f.relay.stop('old-attempt'),false);assert.equal(f.relay.state().attemptId,'attempt-one');
  f.relay.stop('attempt-one');assert.deepEqual(f.releases,['attempt-one']);
 }finally{f.relay.dispose();f.sent.forEach(frame=>frame.samples.fill(0));}
});
test('unprimed overflow and bad acknowledgements release physical capture once and erase all queued audio',async()=>{
 const f=fixture();f.relay.bind({bufferLeaseRef:'ref',attemptId:'one'});
 for(let offset=1280;offset<128000;offset+=640)await f.feed({startSample:offset,samples:new Float32Array(640)});
 await assert.rejects(f.feed({startSample:128000,samples:new Float32Array(640)}),/protocol/);
 assert.equal(f.relay.state(),null);assert.deepEqual(f.releases,['one']);assert.deepEqual(f.failures,['one']);f.relay.dispose();
 const bad=fixture({deliver:async()=>({accepted:true,nextSample:999})});bad.relay.bind({bufferLeaseRef:'ref',attemptId:'bad'});await assert.rejects(bad.relay.ready('bad'),/closed/);assert.equal(bad.relay.state(),null);assert.deepEqual(bad.releases,['bad']);bad.relay.dispose();
});
