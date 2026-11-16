import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyBundle} from '../../scripts/agent/verify.mjs';
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
test('accepts correctly linked fresh criterion proof without owner approval',()=>{const r=verifyBundle(fixture(),opts);assert.equal(r.ok,true);assert.equal(r.passed,fixture().task.acceptance.criteria.length)});
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


function signed(e, changes={}) {
 const payload={version:1,type:'execution',repository:e.repository,task_id:e.task_id,attempt_id:e.attempt_id,criterion_id:e.criterion_id,source_head:e.revision,tested_revision:rev,record_digest:digest(e),observed_at:at,result:'passed',synthetic:false,artifact_uri:e.artifact.uri,artifact_path:'result.txt',artifact_sha256:createHash('sha256').update('actual test output').digest('hex'),...changes};
 return {key_id:'collector',payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
}
test('class union cannot be reduced to permissive profile',()=>{const x=fixture();x.task.classification.primary='visual';x.profiles[0].task_classes=['visual'];const r=verifyBundle(x,opts);assert.ok(r.issues.some(i=>i.code==='REQUIRED_CHECK_OMITTED'&&i.message.includes('rendered-frames')))});
test('secondary security obligations cannot be omitted',()=>{const x=fixture();x.task.classification.secondary=['security'];assert.ok(verifyBundle(x,opts).required_check_ids.includes('deny-paths'));assert.equal(verifyBundle(x,opts).ok,false)});
test('real cinematic paths add mandatory visual obligations',()=>{const x=fixture();const r=verifyBundle(x,{...opts,paths:['prototypes/visual-experience/cinematic-v3/src/App.tsx']});assert.ok(r.required_check_ids.includes('rendered-frames'));assert.equal(r.ok,false)});
test('optional profile cannot waive task criteria',()=>{const x=fixture();x.profiles[0].checks[0].required=false;x.evidence.shift();assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='MISSING_PASSING_EVIDENCE'))});
test('agent-authored passed fields alone are not proof',()=>{const x=fixture();assert.equal(verifyBundle(x,{...opts,receipts:[]}).passed,0)});
test('bundle cannot provide its own trust store or receipts',()=>{const x=fixture();x.receipts=opts.receipts;x.trustStore=opts.trustStore;assert.equal(verifyBundle(x,{...opts,receipts:[]}).ok,false)});
test('forged owner accepted field fails',()=>{const x=fixture();x.task.owner_acceptance='accepted';x.task.state='accepted';assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='UNAUTHENTICATED_ACCEPTANCE'))});
test('stale Task head fails even when evidence is current',()=>{const x=fixture();x.task.revision='b'.repeat(40);assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='STALE_TASK'))});
test('tested merge revision is distinct from source head',()=>{const x=fixture();assert.equal(verifyBundle(x,{...opts,testedRevision:'b'.repeat(40)}).ok,false)});
test('tampered signed receipt fails',()=>{const x=fixture();opts.receipts[0].payload.result='failed';assert.equal(verifyBundle(x,opts).ok,false)});
test('hash mismatch fails',()=>{const x=fixture();opts.receipts[0]=signed(x.evidence[0],{artifact_sha256:'0'.repeat(64)});assert.equal(verifyBundle(x,opts).ok,false)});
test('receipt path escape fails closed',()=>{const x=fixture();opts.receipts[0]=signed(x.evidence[0],{artifact_path:'../secret.txt'});assert.equal(verifyBundle(x,opts).ok,false)});
test('unsigned and synthetic receipts fail',()=>{const x=fixture();opts.receipts[0]=signed(x.evidence[0],{synthetic:true});assert.equal(verifyBundle(x,opts).ok,false);opts.receipts[0].signature='';assert.equal(verifyBundle(x,opts).ok,false)});
test('invalid freshness window cannot suppress failures',()=>{const x=fixture();assert.equal(verifyBundle(x,{...opts,maxAgeHours:NaN}).ok,false)});
test('missing externally supplied source revision fails closed',()=>{const x=fixture();const r=verifyBundle(x,{...opts,revision:undefined});assert.equal(r.ok,false);assert.ok(r.issues.some(i=>i.code==='INVALID_REVISION'))});
test('malformed collections and criteria fail without a crash',()=>{const x=fixture();x.task.acceptance.criteria=[null];assert.equal(verifyBundle(x,opts).ok,false);x.attempts={};assert.equal(verifyBundle(x,opts).ok,false)});
test('additional applicable governance obligations cannot be omitted',()=>{const x=fixture();const r=verifyBundle(x,{...opts,governanceChecks:['AW-QVA-specific']});assert.ok(r.issues.some(i=>i.code==='REQUIRED_CHECK_OMITTED'&&i.message.includes('AW-QVA-specific')))});
test('collector signature cannot forge owner acceptance',()=>{const x=fixture();x.task.owner_acceptance='accepted';x.task.state='accepted';const payload={version:1,type:'owner_acceptance',repository:x.task.repository,task_id:x.task.id,source_head:rev,tested_revision:rev,record_digest:digest(x.task),observed_at:at,decision:'accepted',actor:'owner'};const envelope={key_id:'collector',payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};opts.receipts.push(envelope);assert.equal(verifyBundle(x,opts).owner_verified,false)});
test('independently configured owner signature authenticates only matching Task',()=>{const x=fixture();x.task.owner_acceptance='accepted';x.task.state='accepted';const owner=generateKeyPairSync('ed25519');const trustStore={...opts.trustStore,owner:{public_key:owner.publicKey.export({type:'spki',format:'pem'}),roles:['owner'],actor:'owner'}};const payload={version:1,type:'owner_acceptance',repository:x.task.repository,task_id:x.task.id,source_head:rev,tested_revision:rev,record_digest:digest(x.task),observed_at:at,decision:'accepted',actor:'owner'};const envelope={key_id:'owner',payload,signature:sign(null,Buffer.from(canonical(payload)),owner.privateKey).toString('base64')};const o={...opts,trustStore,receipts:[...opts.receipts.filter(r=>r.payload.type!=='governance_scope'),scope(x.task),envelope]};assert.equal(verifyBundle(x,o).owner_verified,true);assert.equal(verifyBundle(x,o).ok,true);x.task.objective='Changed after approval';assert.equal(verifyBundle(x,o).owner_verified,false)});

function scope(task, changes={}) {
 const payload={version:1,type:'governance_scope',repository:task.repository,task_id:task.id,source_head:task.revision,tested_revision:rev,record_digest:digest(task),observed_at:at,paths_digest:digest([]),required_check_ids:[],...changes};
 return {key_id:'collector',payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
}
test('signed governance requirements are added and cannot be omitted',()=>{const x=fixture();opts.receipts=opts.receipts.filter(r=>r.payload.type!=='governance_scope');opts.receipts.push(scope(x.task,{required_check_ids:['AW-QVA-specific']}));assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='REQUIRED_CHECK_OMITTED'&&i.message.includes('AW-QVA-specific')))});
test('collector-only key cannot satisfy review obligations',()=>{const x=fixture();const trustStore={collector:{...opts.trustStore.collector,roles:['collector']}};assert.equal(verifyBundle(x,{...opts,trustStore}).ok,false)});
test('canonical schema rejects invalid Attempt state',()=>{const x=fixture();x.attempts[0].state='green';assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='SCHEMA_INVALID'))});
test('evidence and producing attempt source revisions must match',()=>{const x=fixture();x.attempts[0].revision='b'.repeat(40);assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='ATTEMPT_REVISION_MISMATCH'))});
test('canonical schema rejects extra evidence payload fields',()=>{const x=fixture();x.evidence[0].secret='not-contract';assert.ok(verifyBundle(x,opts).issues.some(i=>i.code==='SCHEMA_INVALID'))});

test('backend workflow derives interface, negative and integration obligations',()=>{const x=fixture('backend');const r=verifyBundle(x,opts);assert.equal(r.ok,true);for(const id of ['interface-contract','negative-paths','integration-tests'])assert.ok(r.required_check_ids.includes(id))});
test('visual workflow rejects generic test artifacts despite every check being present',()=>{const x=fixture('visual');const r=verifyBundle(x,opts);assert.equal(r.ok,false);assert.ok(r.issues.some(i=>i.code==='UNVERIFIED_EVIDENCE'))});

test('signed proof cannot replay across trusted repository identities',()=>{const x=fixture();assert.ok(verifyBundle(x,{...opts,repository:'other/repo'}).issues.some(i=>i.code==='REPOSITORY_MISMATCH'))});
