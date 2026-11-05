const test=require('node:test');
const assert=require('node:assert/strict');
const {reviewVelaOwner}=require('../native/vela-owner-review.cjs');
const digest='a'.repeat(64),selectedDigest='b'.repeat(64);
function fixture(owner='application-plan'){
 const binding={contract:'aerynth.vela.owner-review@1',operationId:'operation:one',expectedVersion:1,requestId:'request:one',workflowId:'workflow:one',scopeDigest:digest,operationDigest:digest,owner,ownerRef:{id:'owner:one',digest}};
 const view={id:binding.operationId,requestId:binding.requestId,workflowId:binding.workflowId,capabilityId:'app.prepare',state:'awaiting-review',title:'Review',summary:'Ready',reviewAvailable:true};
 const plan={id:binding.ownerRef.id,fingerprint:digest,requestId:binding.requestId,state:'prepared',summary:'Create a workspace',steps:[{action:{type:'createWorkspace'}}],targets:[]};
 const calls=[],events=[];let response=1,allowed=true,changedSelection=false,revokeDuringClaim=false;
 const call=async(name,input)=>{
  calls.push({name,input});events.push(name==='vela'?'vela:'+input.name:name);
  if(name==='vela'&&input.name==='state')return {hostOperations:[view],plans:[plan],capabilities:[]};
  if(name==='vela'&&input.name==='review'){plan.state='approved';return plan;}
  if(name==='vela'&&input.name==='apply'){assert.equal(input.input,plan.id);plan.state='applied';return plan;}
  if(name==='hostOperationReviewNative')return {...binding,expectedVersion:2,operationDigest:selectedDigest,requestId:changedSelection?'request:other':binding.requestId,ownerRef:{...binding.ownerRef,digest:selectedDigest,directory:'C:\\Synthetic\\Repo'}};
  if(name==='hostOperationDispatchNative'){
   assert.equal(input.identityDigest,input.binding.ownerRef.digest);
   if(revokeDuringClaim)allowed=false;
   return {operationId:input.binding.operationId,operationDigest:input.binding.operationDigest,identityDigest:input.identityDigest,approvalDigest:input.approvalDigest,claimId:'claim:one'};
  }
  if(name==='hostOperationResultNative'){assert.equal(input.receipt.claimId,'claim:one');return {...view,state:owner==='codex-inspection'?'unavailable':'observed',reviewAvailable:false};}
  assert.fail('Unexpected command '+name);
 };
 return {binding,view,calls,events,response:v=>{response=v;},allow:v=>{allowed=v;},changedSelection:()=>{changedSelection=true;},revokeDuringClaim:()=>{revokeDuringClaim=true;},
  run:()=>reviewVelaOwner({binding,win:{},event:{},localURL:'file:///synthetic',call,dialog:{showMessageBox:async()=>{events.push('native-review');return {response};},showOpenDialog:async()=>({canceled:response!==1,filePaths:['C:\\Synthetic\\Repo']})},storage:{allowWrite:async()=>true},canAct:async()=>allowed})};
}
test('native No returns canonical pending view without forging a dispatch/result receipt',async()=>{
 const f=fixture();f.response(0);assert.deepEqual(await f.run(),f.view);
 assert.equal(f.calls.some(c=>c.name.startsWith('hostOperation')),false);
 assert.equal(f.calls.some(c=>c.name==='vela'&&c.input.name==='apply'),false);
});
test('application owner keeps exact source identity and claims once after native Yes before actual apply',async()=>{
 const f=fixture();assert.equal((await f.run()).state,'observed');
 assert.ok(f.events.indexOf('native-review')<f.events.indexOf('hostOperationDispatchNative'));
 assert.ok(f.events.indexOf('hostOperationDispatchNative')<f.events.indexOf('vela:apply'));
 assert.equal(f.calls.filter(c=>c.name==='hostOperationDispatchNative').length,1);
});
test('lost scope prevents review, claims and application effects',async()=>{
 const f=fixture();f.allow(false);await assert.rejects(f.run(),/host_operation_scope_changed/);assert.equal(f.calls.length,0);
});
test('revocation during durable claim prevents owner effects and retains the claimed uncertain result',async()=>{
 const f=fixture();f.revokeDuringClaim();await f.run();
 assert.equal(f.calls.some(c=>c.name==='vela'&&c.input.name==='apply'),false);
 const receipt=f.calls.find(c=>c.name==='hostOperationResultNative').input.receipt;
 assert.equal(receipt.state,'unknown');assert.equal(receipt.claimId,'claim:one');
});
test('Codex uses native directory selection and updated source digest; unavailable boundary is a truthful canonical result',async()=>{
 const f=fixture('codex-inspection');assert.equal((await f.run()).state,'unavailable');
 const selection=f.calls.find(c=>c.name==='hostOperationReviewNative');assert.deepEqual(selection.input.selection,{kind:'codex-directory',directory:'C:\\Synthetic\\Repo'});
 const claim=f.calls.find(c=>c.name==='hostOperationDispatchNative');assert.equal(claim.input.identityDigest,selectedDigest);assert.equal(claim.input.binding.expectedVersion,2);
 assert.equal(f.calls.some(c=>/turn|exec|provider/i.test(c.name)),false);
});
test('a changed request during native directory selection cannot acquire authority',async()=>{
 const f=fixture('codex-inspection');f.changedSelection();await assert.rejects(f.run(),/owner_review_changed/);
 assert.equal(f.calls.some(c=>c.name==='hostOperationDispatchNative'),false);
});
