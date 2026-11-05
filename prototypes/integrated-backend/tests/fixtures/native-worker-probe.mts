import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Backend} from '../../src/service.mts';
import type {NativeHostServices} from '../../src/native-host.mts';
import type {VelaBackendState} from '../../src/contracts.mts';
import type {WindowsComputerDiscovery} from '../../../application-contract/windows-computer.ts';
import {WINDOWS_MEMORY_POLICY,type WindowsMemorySnapshot} from '../../../application-contract/windows-maintenance.ts';
const scenario=process.env.AERYNTH_WORKER_HOP_SCENARIO!,base=resolve(tmpdir()),directory=mkdtempSync(join(base,'aerynth-native-worker-')),database=join(directory,'canonical.sqlite'),key=randomBytes(32);
let memoryReads=0,computerReads=0,mutations=0,nativeSignal:AbortSignal|undefined,entered!:()=>void;
const nativeEntered=new Promise<void>(done=>{entered=done;}),snapshot:WindowsMemorySnapshot={contract:'aerynth.windows.memory@1',snapshotId:randomUUID(),observedAt:new Date().toISOString(),sampleDurationMs:1,physicalTotalBytes:16*2**30,physicalAvailableBytes:8*2**30,systemCommitBytes:4*2**30,systemCommitLimitBytes:32*2**30,systemCommitHeadroomBytes:28*2**30,systemCacheBytes:2**30,lowMemoryNotification:false,pressure:'healthy',policyVersion:WINDOWS_MEMORY_POLICY,source:'windows-native'};
const native:NativeHostServices={secrets:{available:async()=>true,seal:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},open:async value=>{const bytes=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();}},...(scenario==='absent'?{}:{maintenance:{async diagnose(input,signal){assert.deepEqual(input,{});memoryReads++;nativeSignal=signal;entered();if(scenario==='shutdown')return new Promise<WindowsMemorySnapshot>((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(Error('memory_cancelled')),{once:true});});return snapshot;},async inspect(){throw Error('unexpected_process_inspection');}},computer:{async discover(scope,signal){assert.equal(Object.keys(scope).sort().join(','),'requestId,scopeDigest,workflowId');assert.match(scope.scopeDigest,/^[a-f0-9]{64}$/u);assert(!signal?.aborted);computerReads++;nativeSignal=signal;if(scenario==='shutdown-computer'){entered();return new Promise<WindowsComputerDiscovery>((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(Error('computer_cancelled')),{once:true});});}return {contract:'aerynth.windows.computer@1' as const,snapshotId:randomUUID(),observedAt:new Date().toISOString(),partial:false,windows:[],applications:[]};},async observe(){throw Error('computer_window_scope_required');}}})};
Object.defineProperty(native,'mutate',{get(){mutations++;throw Error('effects_unavailable_in_worker_port');}});
// Exercise production private-host authorization with an isolated synthetic DB,
// synthetic encrypted credential and the zero-network preload; no real profile.
const create=()=>new Backend({path:database,privateRoot:directory,provider:'fixture',contentPolicy:'local-private'},native);
let backend=create();
try{
 await backend.call('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:'SYNTHETIC_ONLY_WORKER_HOP'},expectedVersion:null});await backend.call('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});
 const intent='Synthetic read-only native worker bridge test',preview=await backend.call('velaRequestPreview',{intent,resourceIds:[],adaptive:true}),review=await backend.call('velaNativeReview',{previewId:preview.id,signature:preview.signature}),grant=await backend.call('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,...(preview.sendDisposition==='routine'?{directSend:true}:{})});
 const run=backend.call('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as Promise<any>;
 if(scenario.startsWith('shutdown')){
  const settled=run.catch(error=>({error:error.code??error.message}));await nativeEntered;await backend.close();assert.equal(nativeSignal?.aborted,true);await settled;assert.equal(memoryReads,scenario==='shutdown'?1:0);assert.equal(computerReads,scenario==='shutdown-computer'?1:0);
  backend=create();await backend.call('snapshot',{});assert.equal(memoryReads,scenario==='shutdown'?1:0);assert.equal(computerReads,scenario==='shutdown-computer'?1:0);
 }else{
  const request=await run,state=await backend.call('vela',{name:'state',input:{}}) as VelaBackendState;
  if(scenario==='effect-denied'){assert.equal(request.state,'awaiting-review');assert.equal(memoryReads+computerReads,0);assert.equal(state.hostOperations!.length,1);await assert.rejects(backend.call('vela',{name:'hostOperation',input:{operationId:state.hostOperations![0].id}}),/native_review_required/);}
  else{assert.equal(request.state,'responded');assert.equal(memoryReads,scenario==='absent'?0:1);assert.equal(computerReads,scenario==='absent'?0:1);}
 }
 await backend.close();const db=new DatabaseSync(database,{readOnly:true});try{
  const workflow=JSON.parse(String(db.prepare('SELECT json FROM vela_tool_workflows').get()!.json));
  for(const id of ['windows.memory.diagnose','windows.computer.discover'])assert.equal(workflow.catalog.descriptors.find((item:any)=>item.id===id).availability,scenario==='absent'?'unavailable':'available');
  if(scenario.startsWith('shutdown')){assert.notEqual(workflow.phase,'verified');assert(db.prepare('SELECT state FROM vela_tool_invocations').all().every(row=>row.state!=='observed'));}
  if(scenario==='roundtrip'){const receipts=db.prepare('SELECT json FROM vela_tool_invocations').all().map(row=>JSON.parse(String(row.json)));assert.equal(receipts.length,2);assert(receipts.every(receipt=>receipt.state==='observed'&&receipt.verification.kind==='owner-observed'));assert.equal(JSON.parse(receipts.find(receipt=>receipt.capabilityId==='windows.memory.diagnose').outputJson).snapshotId,snapshot.snapshotId);}
 }finally{db.close();}
 assert.equal(mutations,0);console.log(JSON.stringify({scenario,passed:true,actualBackend:true,actualWorker:true,memoryReads,computerReads,mutations,realHttpCalls:0}));
}finally{await backend.close().catch(()=>{});const part=relative(base,resolve(directory));assert(part.startsWith('aerynth-native-worker-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(directory,{recursive:true,force:true});}
