import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyBundle} from '../../scripts/agent/verify.mjs';
const rev='a'.repeat(40), at='2026-11-15T20:00:00Z';
const common=(record_type,id)=>({schema_version:1,record_type,id,created_at:at,repository:'Kgray44/Aetherwake',revision:rev});
const opts={revision:rev,now:'2026-11-15T21:00:00Z'};
function fixture(){
 const task={...common('task','task-1'),title:'Test fix',objective:'Prevent regression',classification:{primary:'bug'},prerequisites:{task_ids:[],capabilities:[]},acceptance:{profile_id:'bug-basic',criteria:[{id:'regression',description:'Regression test passes'}]},state:'verifying',owner_acceptance:'not_reviewed'};
 const attempt={...common('attempt','attempt-1'),task_id:task.id,attempt_number:1,state:'succeeded',started_at:at};
 const profile={...common('verification_profile','profile-1'),profile_id:'bug-basic',task_classes:['bug'],checks:[{id:'regression',procedure:'Run test',required:true}],blocking_policy:'enforce'};
 const evidence={...common('evidence','evidence-1'),task_id:task.id,attempt_id:attempt.id,criterion_id:'regression',kind:'test',result:'passed',observed_at:at,artifact:{kind:'artifact',uri:'artifact://proof'}};
 return {task,attempts:[attempt],profiles:[profile],evidence:[evidence]};
}
test('accepts correctly linked fresh criterion proof without owner approval',()=>{const r=verifyBundle(fixture(),opts);assert.equal(r.ok,true);assert.equal(r.passed,1)});
test('rejects absent required proof',()=>{const x=fixture();x.evidence=[];assert.equal(verifyBundle(x,opts).ok,false)});
test('rejects stale revision',()=>{const x=fixture();x.evidence[0].revision='b'.repeat(40);assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='STALE_REVISION'))});
test('rejects synthetic visual proof',()=>{const x=fixture();x.task.classification.primary='visual';x.profiles[0].task_classes=['visual'];x.evidence[0].kind='visual';x.evidence[0].synthetic=true;assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='SYNTHETIC_EVIDENCE'))});
test('does not infer owner acceptance from passing tests',()=>{const x=fixture();x.task.state='accepted';assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='FALSE_ACCEPTANCE'))});
test('manual review remains pending until owner acceptance',()=>{const x=fixture();x.profiles[0].checks[0].manual_approval=true;assert.equal(verifyBundle(x,opts).manual_pending,true)});
test('rejects unlinked attempt evidence',()=>{const x=fixture();x.evidence[0].attempt_id='absent';assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='UNLINKED_EVIDENCE'))});
test('rejects absent verification profile',()=>{const x=fixture();x.profiles=[];assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='PROFILE_NOT_FOUND'))});
test('blocks unexplained retry',()=>{const x=fixture();x.attempts[0].attempt_number=2;assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='BLIND_RETRY'))});
test('rejects stale context snapshots',()=>{const x=fixture();x.context_snapshots=[{...common('context_snapshot','context-1'),task_id:x.task.id,freshness:'stale'}];assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='STALE_CONTEXT'))});
test('rejects missing required check mapping',()=>{const x=fixture();x.profiles[0].checks.push({id:'missing',procedure:'Run other test',required:true});assert.ok(verifyBundle(x,opts).issues.some(v=>v.code==='REQUIRED_CHECK_UNMAPPED'))});
