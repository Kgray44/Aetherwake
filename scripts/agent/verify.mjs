#!/usr/bin/env node
/** Phase D: task-centric evidence verifier for foundation v1 records. */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {routeTask} from './task-router.mjs';
import {verifyReceipt} from './evidence-trust.mjs';
import {validateRecord} from './validate-record.mjs';
const policy=JSON.parse(readFileSync(new URL('../../agent-system/evidence-policy.json',import.meta.url),'utf8'));
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/i.test(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const obj = x => x && typeof x === 'object' && !Array.isArray(x);
const time = x => typeof x === 'string' && !Number.isNaN(Date.parse(x)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(x);
export function verifyBundle(bundle, opts={}) {
  const issues=[], fail=(code,message)=>issues.push({code,message});
  const task=bundle?.task, attempts=bundle?.attempts??[], evidence=bundle?.evidence??[], profiles=bundle?.profiles??[], contexts=bundle?.context_snapshots??[];
  const now=opts.now?Date.parse(opts.now):Date.now(), maxAge=(opts.maxAgeHours??72)*3600000;
  if (!obj(task)) fail('MISSING_TASK','A foundation v1 Task is required');
  for (const [k,v] of Object.entries({attempts,evidence,profiles,contexts})) if (!Array.isArray(v)) fail('INVALID_COLLECTION',k+' must be an array');
  if (!sha(opts.revision)) fail('INVALID_REVISION','Independently supplied expected source head must be a full SHA');
  if (!Number.isFinite(now)||!Number.isFinite(maxAge)||maxAge<=0) fail('INVALID_FRESHNESS','Finite positive freshness required');
  const records=[['task',[task]],['attempt',attempts],['evidence',evidence],['verification_profile',profiles],['context_snapshot',contexts]];
  const ids=new Set();
  for (const [kind,group] of records) for (const r of Array.isArray(group)?group:[]) {
    if (!obj(r)) {fail('INVALID_RECORD',kind+' must be an object');continue;}
    for(const issue of validateRecord(r)) fail('SCHEMA_INVALID',issue);
    if (r.schema_version!==1 || r.record_type!==kind) fail('BAD_CONTRACT',kind+' v1 discriminants missing');
    if (!text(r.id)||ids.has(r.id)) fail('BAD_ID','Missing or duplicate '+kind+' ID');
    ids.add(r.id);
    if (!sha(r.revision)||!text(r.repository)||!time(r.created_at)) fail('BAD_PROVENANCE',kind+' missing revision/repository/time');
    if (obj(task)&&r.repository!==task.repository) fail('REPOSITORY_MISMATCH',kind+' repository differs from Task');
  }
  if (!obj(task)) return {ok:false,issues,checked:0,passed:0,missing:0,manual_pending:false,policy:'report_only'};
  if (!text(task.id)||!text(task.objective)||!text(task.title)||!text(task.classification?.primary)||!Array.isArray(task.prerequisites?.task_ids)||!Array.isArray(task.prerequisites?.capabilities)||!text(task.acceptance?.profile_id)||!Array.isArray(task.acceptance?.criteria)) fail('INVALID_TASK','Task missing intent, class, prerequisites, or acceptance');
  if (task.state==='accepted' && !['accepted','not_required'].includes(task.owner_acceptance)) fail('FALSE_ACCEPTANCE','Owner acceptance must be explicit');
  if (!text(opts.repository)||task.repository!==opts.repository) fail('REPOSITORY_MISMATCH','Task repository does not match independently supplied repository');
  if (opts.revision && task.revision!==opts.revision) fail('STALE_TASK','Task is not bound to current source head');
  let route;
  try { route=routeTask(task,opts.paths??[]); } catch(e) { fail('INVALID_ROUTING',e.message); }
  const scopes=(opts.receipts??[]).filter(r=>r?.payload?.type==='governance_scope'&&verifyReceipt(r,task,opts));
  if(scopes.length!==1) fail('GOVERNANCE_SCOPE_MISSING','Exactly one independently reviewed Task/path-bound governance scope is required');
  const required=new Set([...(route?.required_check_ids??[]),...(opts.governanceChecks??[]),...(scopes[0]?.payload.required_check_ids??[])]);
  const ownerVerified=(opts.receipts??[]).some(r=>r?.payload?.type==='owner_acceptance'&&verifyReceipt(r,task,opts));
  if (task.owner_acceptance==='accepted'&&!ownerVerified) fail('UNAUTHENTICATED_ACCEPTANCE','Editable owner acceptance is not approval proof');
  if (task.state==='accepted'&&!ownerVerified) fail('OWNER_REVIEW_MISSING','Accepted state requires authenticated owner decision');
  const attemptIds=new Set(), numbers=new Set();
  for (const a of Array.isArray(attempts)?attempts:[]) {
    if (!obj(a)) continue;
    if (a.task_id!==task.id||!Number.isInteger(a.attempt_number)||a.attempt_number<1||!time(a.started_at)) fail('INVALID_ATTEMPT','Bad attempt linkage/sequence/time');
    if (numbers.has(a.attempt_number)) fail('DUPLICATE_ATTEMPT','Duplicate attempt sequence');
    numbers.add(a.attempt_number);attemptIds.add(a.id);
    if (a.attempt_number>1 && a.state!=='queued' && !text(a.changed_assumption) && !text(a.failure_diagnosis)) fail('BLIND_RETRY','Repeated attempt needs changed assumption or diagnosis');
  }
  const selected=(Array.isArray(profiles)?profiles:[]).filter(p=>obj(p)&&p.profile_id===task.acceptance?.profile_id);
  if (selected.length!==1) fail('PROFILE_NOT_FOUND','Resolve exactly one profile');
  const profile=selected[0], checks=Array.isArray(profile?.checks)?profile.checks:[];
  if (profile && (!Array.isArray(profile.task_classes)||!profile.task_classes.includes(task.classification?.primary)||!checks.length)) fail('PROFILE_MISMATCH','Profile must cover task primary class and define checks');
  const criteria=Array.isArray(task.acceptance?.criteria)?task.acceptance.criteria:[];
  const criterionIds=new Set();
  for (const c of criteria) {
    if (!text(c?.id)||!text(c?.description)||criterionIds.has(c.id)) fail('INVALID_CRITERION','Criteria need unique IDs and descriptions');
    if (obj(c)) criterionIds.add(c.id);
  }
  for (const id of required) {
    if (!checks.some(c=>c?.id===id&&c.required===true)) fail('REQUIRED_CHECK_OMITTED','Required obligation '+id+' must be a required profile check');
    if (!criterionIds.has(id)) fail('REQUIRED_CHECK_UNMAPPED','Required obligation '+id+' lacks criterion');
  }
  for (const check of checks) if (check?.required && !criterionIds.has(check.id)) fail('REQUIRED_CHECK_UNMAPPED','Required check '+check.id+' lacks acceptance criterion');
  const byCriterion=new Map(), trusted=new Set();
  for (const e of Array.isArray(evidence)?evidence:[]) {
    if (!obj(e)) continue;
    if (e.task_id!==task.id||!attemptIds.has(e.attempt_id)||!criterionIds.has(e.criterion_id)) fail('UNLINKED_EVIDENCE','Evidence '+e.id+' references unknown task/attempt/criterion');
    const attempt=Array.isArray(attempts)?attempts.find(a=>a?.id===e.attempt_id):null;
    if (attempt&&attempt.revision!==e.revision) fail('ATTEMPT_REVISION_MISMATCH','Evidence and producing Attempt revisions differ');
    if (!time(e.observed_at)||!text(e.artifact?.uri)||!text(e.artifact?.kind)) fail('INCOMPLETE_EVIDENCE','Evidence '+e.id+' lacks observation/artifact');
    if (e.synthetic===true && ['visual','motion','review'].includes(e.kind)) fail('SYNTHETIC_EVIDENCE','Synthetic visual/review evidence cannot establish acceptance');
    if (opts.revision&&e.revision!==opts.revision) fail('STALE_REVISION','Evidence '+e.id+' does not match revision');
    if (time(e.observed_at) && (Date.parse(e.observed_at)>now+300000||now-Date.parse(e.observed_at)>maxAge)) fail('STALE_OBSERVATION','Evidence '+e.id+' outside freshness window');
    const reviewer=policy.review_checks.includes(e.criterion_id)||checks.some(c=>c?.id===e.criterion_id&&c.manual_approval===true);
    const kindValid=!policy.evidence_kinds[e.criterion_id]||policy.evidence_kinds[e.criterion_id].includes(e.kind);
    const environmentValid=!policy.native_checks.includes(e.criterion_id)||e.environment==='windows-native';
    if (kindValid&&environmentValid&&(opts.receipts??[]).some(r=>r?.payload?.type==='execution'&&verifyReceipt(r,e,{...opts,requiredRole:reviewer?'reviewer':'collector'}))) trusted.add(e.id);
    else if(e.result==='passed') fail('UNVERIFIED_EVIDENCE','Evidence '+e.id+' lacks independently signed receipt and matching artifact bytes');
    if (!byCriterion.has(e.criterion_id)) byCriterion.set(e.criterion_id,[]);
    byCriterion.get(e.criterion_id).push(e);
  }
  for (const s of Array.isArray(contexts)?contexts:[]) {
    if (!obj(s)) continue;
    if (s.task_id!==task.id||s.freshness!=='current'||(opts.revision&&s.revision!==opts.revision)) fail('STALE_CONTEXT','Context '+s.id+' is not current for this task/revision');
  }
  let passed=0,missing=0,manual_pending=false;
  for (const c of criteria) {
    if (!obj(c)) continue;
    const check=checks.find(x=>x?.id===c.id);
    const valid=(byCriterion.get(c.id)??[]).some(e=>trusted.has(e.id)&&e.result==='passed'&&e.synthetic!==true&&(!opts.revision||e.revision===opts.revision)&&time(e.observed_at)&&Date.parse(e.observed_at)<=now+300000&&now-Date.parse(e.observed_at)<=maxAge);
    if (valid) passed++;
    else {missing++;fail('MISSING_PASSING_EVIDENCE','Criterion '+c.id+' lacks fresh passing proof');}
    if (check?.manual_approval && !ownerVerified) manual_pending=true;
  }
  if (task.state==='accepted'&&manual_pending) fail('OWNER_REVIEW_MISSING','Manual acceptance is required');
  return {ok:issues.length===0,issues,checked:criteria.length,passed,missing,manual_pending,task_id:task.id,required_check_ids:[...required],source_head:opts.revision??null,tested_revision:opts.testedRevision??null,integration_revision:opts.integrationRevision??null,owner_verified:ownerVerified,policy:profile?.blocking_policy??'report_only'};
}
function readJson(file) {
  if(statSync(file).size>8*1024*1024) throw Error('Verification input exceeds 8 MiB limit');
  return JSON.parse(readFileSync(file,'utf8'));
}
export function runCli(argv) {
  const opts={};
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if (a==='--bundle') opts.bundle=argv[++i];
    else if (a==='--repository') opts.repository=argv[++i];
    else if (a==='--revision') opts.revision=argv[++i];
    else if (a==='--tested-revision') opts.testedRevision=argv[++i];
    else if (a==='--integration-revision') opts.integrationRevision=argv[++i];
    else if (a==='--paths-file') opts.paths=readJson(argv[++i]);
    else if (a==='--receipts') opts.receipts=readJson(argv[++i]);
    else if (a==='--trust-store') opts.trustStore=readJson(argv[++i]);
    else if (a==='--artifact-root') opts.artifactRoot=argv[++i];
    else if (a==='--report') opts.report=argv[++i];
    else if (a==='--max-age-hours') opts.maxAgeHours=Number(argv[++i]);
    else if (a==='--enforce') opts.enforce=true;
    else if (a==='--help') {console.log('Usage: node scripts/agent/verify.mjs --bundle PATH [--revision SHA] [--enforce] [--report PATH]');return 0;}
    else throw Error('Unknown argument '+a);
  }
  if (!opts.bundle) throw Error('Missing --bundle');
  const result=verifyBundle(readJson(resolve(opts.bundle)),opts);
  const out=JSON.stringify(result,null,2);
  console.log(out);
  if (opts.report) writeFileSync(resolve(opts.report),out+'\n');
  return !result.ok&&(opts.enforce||result.policy==='enforce')?1:0;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {process.exitCode=runCli(process.argv.slice(2));}
  catch(e){console.error('Evidence verification error: '+e.message);process.exitCode=2;}
}

