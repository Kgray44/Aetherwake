import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readExactHeadCheck} from '../../scripts/agent/check-readback.mjs';
import {prepareExactHeadCheck} from '../../scripts/agent/check-publication.mjs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after} from 'node:test';
import {canonical,digest,verifyReceipt} from '../../scripts/agent/evidence-trust.mjs';
import {routeTask} from '../../scripts/agent/task-router.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const artifactRoot=mkdtempSync(join(tmpdir(),'aads-evidence-'));
writeFileSync(join(artifactRoot,'result.txt'),'actual test output');
after(()=>rmSync(artifactRoot,{recursive:true,force:true}));
const rev='a'.repeat(40), at='2026-11-15T20:00:00Z';
const common=(record_type,id)=>({schema_version:1,record_type,id,created_at:at,repository:'Kgray44/Aetherwake',revision:rev});
const opts={repository:'Kgray44/Aetherwake',revision:rev,now:'2026-11-15T21:00:00Z',artifactRoot,trustStore:{collector:{public_key:publicKey.export({type:'spki',format:'pem'}),roles:['collector','reviewer']}}};
function fixture(primary='bug'){
 const task={...common('task','task-1'),title:'Test fix',objective:'Prevent regression',classification:{primary},prerequisites:{task_ids:[],capabilities:[]},acceptance:{profile_id:'bug-basic',criteria:[{id:'regression',description:'Regression test passes'}]},state:'verifying',owner_acceptance:'not_reviewed'};
 const attempt={...common('attempt','attempt-1'),task_id:task.id,attempt_number:1,state:'succeeded',started_at:at};
 const profile={...common('verification_profile','profile-1'),profile_id:'bug-basic',task_classes:[primary],checks:[{id:'regression',procedure:'Run test',required:true}],blocking_policy:'enforce'};
 const evidence={...common('evidence','evidence-1'),task_id:task.id,attempt_id:attempt.id,criterion_id:'regression',kind:'test',result:'passed',observed_at:at,artifact:{kind:'artifact',uri:'artifact://proof'}};
 const ids=[...new Set(['regression',...routeTask(task,[]).required_check_ids])];
 task.acceptance.criteria=ids.map(id=>({id,description:id}));
 profile.checks=ids.map(id=>({id,procedure:'Run '+id,required:true}));
 const records=ids.map((id,i)=>({...evidence,id:'evidence-'+i,criterion_id:id,kind:['governance-coverage','source-owner-review','affected-scope-review'].includes(id)?'review':'test'}));
 opts.receipts=[...records.map(e=>signed(e)),scope(task)];
 return {task,attempts:[attempt],profiles:[profile],evidence:records};
}

function signed(e, changes={}) {
 const payload={version:1,type:'execution',repository:e.repository,task_id:e.task_id,attempt_id:e.attempt_id,criterion_id:e.criterion_id,source_head:e.revision,tested_revision:rev,record_digest:digest(e),observed_at:at,result:'passed',synthetic:false,artifact_uri:e.artifact.uri,artifact_path:'result.txt',artifact_sha256:createHash('sha256').update('actual test output').digest('hex'),...changes};
 return {key_id:'collector',payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
}

function scope(task, changes={}) {
 const payload={version:1,type:'governance_scope',repository:task.repository,task_id:task.id,source_head:task.revision,tested_revision:rev,record_digest:digest(task),observed_at:at,paths_digest:digest([]),required_check_ids:[],...changes};
 return {key_id:'collector',payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
}
const base='b'.repeat(40);
function input() {
 const bundle=fixture();
 const pr={number:7,state:'open',head:{sha:rev,repo:{full_name:'fork/Aetherwake'}},base:{sha:base,repo:{full_name:opts.repository}}};
 return {eventName:'pull_request_target',event:{number:7,repository:{full_name:opts.repository},pull_request:pr},currentPullRequest:structuredClone(pr),repository:opts.repository,verifierRevision:base,bundle,verification:{...opts,paths:[],testedRevision:rev}};
}
function readbackFixture() {
 const preparation=input(), request=prepareExactHeadCheck(preparation).request;
 const check={id:42,url:'https://api.github.com/repos/'+opts.repository+'/check-runs/42',app:{id:81},...request};
 const calls=[];let prReads=0;
 const config={preparation,checkRunId:42,expectedAppId:81,token:'SYNTHETIC_ONLY',fetchImpl:async(url,options)=>{
  calls.push({url,options});const body=url.includes('/check-runs/')?check:structuredClone(preparation.currentPullRequest);
  if(!url.includes('/check-runs/'))prReads++;
  return new Response(JSON.stringify(body),{status:200});
 }};
 return {config,check,calls,get prReads(){return prReads;}};
}
test('exact App-bound completed check is observed with three GETs and no acceptance grant',async()=>{
 const x=readbackFixture(),r=await readExactHeadCheck(x.config);assert.equal(r.matched,true);assert.equal(r.conclusion,'success');
 assert.equal(r.check_run_id,42);assert.equal(r.task_accepted,false);assert.equal(r.owner_accepted,false);assert.equal(x.prReads,2);
 assert.equal(x.calls.length,3);assert.ok(x.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'));
 assert.ok(x.calls.every(c=>c.options.signal===x.calls[0].options.signal));
 assert.ok(!JSON.stringify(r).includes('SYNTHETIC_ONLY'));
});
test('wrong App, head, ID, repository, name, conclusion or output fail closed',async()=>{
 for(const change of [c=>c.app.id=82,c=>c.head_sha='c'.repeat(40),c=>c.id=43,c=>c.url='https://api.github.com/repos/other/repo/check-runs/42',
  c=>c.name='forged',c=>c.status='in_progress',c=>c.conclusion='neutral',c=>c.output={title:'forged',summary:'forged'}]){
  const x=readbackFixture();x.check.output={...x.check.output};change(x.check);await assert.rejects(()=>readExactHeadCheck(x.config),/mismatch/);assert.equal(x.calls.length,2);
 }
});
test('moved source or base and closed PR during readback invalidate observation',async()=>{
 for(const change of [p=>p.head.sha='c'.repeat(40),p=>p.base.sha='c'.repeat(40),p=>p.state='closed']){
  const x=readbackFixture(),fetch=x.config.fetchImpl;let n=0;
  x.config.fetchImpl=async(url,options)=>{if(++n===3){const p=structuredClone(x.config.preparation.currentPullRequest);change(p);return new Response(JSON.stringify(p));}return fetch(url,options);};
  await assert.rejects(()=>readExactHeadCheck(x.config),/mismatch|stale|Closed/);
 }
});
test('unsigned evidence cannot be confirmed by an externally green check',async()=>{
 const x=readbackFixture();x.config.preparation.verification.receipts=[];await assert.rejects(()=>readExactHeadCheck(x.config),/mismatch/);
});
test('a matching failure check remains a failure observation, not a pass',async()=>{
 const x=readbackFixture();x.config.preparation.verification.receipts=[];Object.assign(x.check,prepareExactHeadCheck(x.config.preparation).request);
 const result=await readExactHeadCheck(x.config);assert.equal(result.conclusion,'failure');assert.equal(result.task_accepted,false);
});
test('invalid identity, missing token and wrong event never issue a request',async()=>{
 for(const change of [x=>x.checkRunId=0,x=>x.expectedAppId=0,x=>x.token='',x=>x.preparation.repository='../secret',x=>x.preparation.eventName='pull_request']){
  const x=readbackFixture();change(x.config);await assert.rejects(()=>readExactHeadCheck(x.config));assert.equal(x.calls.length,0);
 }
});
test('HTTP failure is surfaced once without retry or publication',async()=>{
 for(const status of [401,403,404,429,500]){const x=readbackFixture();let calls=0;x.config.fetchImpl=async()=>{calls++;return new Response('{}',{status});};await assert.rejects(()=>readExactHeadCheck(x.config),/HTTP/);assert.equal(calls,1);}
});
test('oversized streamed or declared bodies and malformed JSON fail closed',async()=>{
 for(const response of [()=>new Response('x',{headers:{'content-length':String(1024*1024+1)}}),()=>new Response('x'.repeat(1024*1024+1)),()=>new Response('not JSON')]){
  const x=readbackFixture();x.config.fetchImpl=async()=>response();await assert.rejects(()=>readExactHeadCheck(x.config));
 }
});
