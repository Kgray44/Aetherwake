import {test} from 'node:test';
import assert from 'node:assert/strict';
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
test('signed proof prepares exact contributor head without publishing or granting acceptance',()=>{const value=prepareExactHeadCheck(input());assert.equal(value.request.head_sha,rev);assert.equal(value.request.conclusion,'success');assert.equal(value.owner_accepted,false);assert.equal(value.task_accepted,false);assert.ok(Object.isFrozen(value.request.output));});
test('producer ok and profile status cannot substitute for signed evidence',()=>{const x=input();x.bundle.evidence=[];x.bundle.ok=true;assert.equal(prepareExactHeadCheck(x).request.conclusion,'failure');});
test('report-only profile cannot yield a blocking success',()=>{const x=input();x.bundle.profiles[0].blocking_policy='report_only';assert.equal(prepareExactHeadCheck(x).request.conclusion,'failure');});
test('pending manual gate cannot yield success',()=>{const x=input();x.bundle.profiles[0].checks[0].manual_approval=true;assert.equal(prepareExactHeadCheck(x).request.conclusion,'failure');});
test('fresh head and verifier base must match the original trusted event',()=>{for(const change of [x=>x.currentPullRequest.head.sha='c'.repeat(40),x=>x.currentPullRequest.base.sha='c'.repeat(40),x=>x.currentPullRequest.state='closed',x=>x.currentPullRequest.number=8,x=>x.currentPullRequest.head.repo.full_name='other/repo']){const x=input();change(x);assert.throws(()=>prepareExactHeadCheck(x),/mismatch|stale|Closed/);}});
test('untrusted event mode and repository cannot authorize a payload',()=>{for(const change of [x=>x.eventName='pull_request',x=>x.repository='other/repo',x=>x.event.repository.full_name='other/repo']){const x=input();change(x);assert.throws(()=>prepareExactHeadCheck(x));}});
test('complete path input and tested revision are required',()=>{for(const change of [x=>delete x.verification.paths,x=>x.verification.paths=['../secret'],x=>delete x.verification.testedRevision]){const x=input();change(x);assert.throws(()=>prepareExactHeadCheck(x));}});
test('options cannot override independently bound source/repository',()=>{const x=input();x.verification.repository='other/repo';x.verification.revision='c'.repeat(40);assert.equal(prepareExactHeadCheck(x).request.conclusion,'success');});
test('candidate secrets and markdown never enter external check output',()=>{const x=input();x.bundle.task.title='PRIVATE [link](https://evil.invalid)';const value=prepareExactHeadCheck(x);assert.equal(value.request.conclusion,'failure');assert.ok(!JSON.stringify(value).includes('PRIVATE'));});
test('tested revision is not confused with contributor head and mismatched receipts fail',()=>{const x=input();x.verification.testedRevision='d'.repeat(40);const value=prepareExactHeadCheck(x);assert.equal(value.request.head_sha,rev);assert.equal(value.request.conclusion,'failure');assert.ok(value.request.output.summary.includes('Tested revision: '+'d'.repeat(40)));});
