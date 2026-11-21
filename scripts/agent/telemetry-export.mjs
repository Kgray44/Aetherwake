/** Explicit private projection. Never exports prompts, arguments, outputs or machine-local paths. */
import { validMatchedBenchmark } from '../../agent-system/observatory/matched-benchmark.mjs';
import { validDevelopmentNote } from '../../agent-system/observatory/development-notes.mjs';

const hash = v => typeof v==='string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(v);
const safeRef = (ref,index=0) => ({kind:'artifact',uri:'private-ref:'+index,...(hash(ref.revision)?{revision:ref.revision}:{})});
const token = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const pick = (v, keys) => Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
const eventKeys = ['trace_version','event_id','task_id','attempt_id','session_id','trace_id','span_id','parent_span_id','repository','revision','occurred_at','kind','phase','state','measurements','activity','development_note'];
const activityFields = ['kind','source','operation_id','outcome','artifact_digest'];
const activityKinds = new Set(['commit','review','test','benchmark','verification','deployment','deployment_validation','executor_session']);
const activitySources = new Set(['github_actions','codex','sites','verification_runner','local_runner','external']);
const activityOutcomes = new Set(['started','completed','succeeded','failed','cancelled','inconclusive']);
const digest = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);

function validateActivity(event,operations) {
 const a=event.activity;
 if(event.kind!=='engineering_activity') {
  if(a!==undefined) throw Error('Engineering activity requires its own trace kind');
  return;
 }
 if(a?.kind==='codex_turn') {
  if(Object.keys(a).some(key=>!activityFields.includes(key))||a.source!=='codex'||!digest(a.operation_id)||
     !['completed','failed','inconclusive'].includes(a.outcome)||a.artifact_digest!==undefined||
     event.attempt_id!==undefined||event.state!==undefined||event.parent_span_id!==undefined||
     !event.session_id||event.phase!=='other'||event.measurements.length!==6||
     event.event_id!=='codex-turn:'+event.session_id+':'+event.span_id||event.trace_id!=='codex-history:'+event.session_id) {
   throw Error('Invalid Codex turn observation');
  }
  return;
 }
 if(!a||Object.keys(a).some(key=>!activityFields.includes(key))||
    !activityKinds.has(a.kind)||!activitySources.has(a.source)||!digest(a.operation_id)||
    !activityOutcomes.has(a.outcome)||(a.artifact_digest!==undefined&&!digest(a.artifact_digest))||
    event.state!==undefined||event.parent_span_id!==undefined||event.measurements.length!==0) {
  throw Error('Invalid reported engineering activity');
 }
 const stage=a.outcome==='started'?'started':'result';
 if(event.event_id!=='activity_'+a.operation_id+'_'+stage||event.trace_id!==a.operation_id||event.span_id!==a.operation_id) {
  throw Error('Invalid engineering activity identity');
 }
 const scope=JSON.stringify([event.task_id,event.revision,event.attempt_id,event.session_id,a.source,a.kind]);
 const previous=operations.get(a.operation_id);
 if(previous&&previous!==scope) throw Error('Conflicting engineering activity scope');
 operations.set(a.operation_id,scope);
}
export function sanitizeExport({ repository, records=[], events=[] }) {
 const safeRecords = records.map(r => {
   if(r.record_type==='task'&&r.state==='accepted')throw Error('Accepted Task requires independent owner evidence; not exportable by this adapter');
   const base = pick(r,['schema_version','record_type','id','created_at','repository','revision','task_id','attempt_id']);
   switch(r.record_type) {
    case 'task': return {...base,title:'Task '+r.id,objective:'Private task details withheld',classification:pick(r.classification,["primary","secondary"]),prerequisites:{task_ids:r.prerequisites.task_ids,capabilities:[]},acceptance:{profile_id:r.acceptance.profile_id,criteria:r.acceptance.criteria.map(c=>({id:c.id,description:'Private criterion details withheld'}))},state:r.state,owner_acceptance:'not_reviewed'};
    case 'attempt': return {...base,...pick(r,['attempt_number','state','started_at','finished_at','provider','model','failure_category'])};
    case 'telemetry': return {...base,...pick(r,['phase','observed_at']),measurements:r.measurements.map(sanitizeMeasurement)};
    // Evidence artifacts may contain sensitive local paths. Only hashed identifiers exported.
    case 'evidence': {
      const evidence = {...base,...pick(r,['criterion_id','kind','result','observed_at','synthetic']),
        artifact:{kind:'artifact',uri:'private-artifact:'+r.id,...hash(r.artifact?.revision)?{revision:r.artifact.revision}:{}}};
      if(r.matched_benchmark!==undefined) {
        if(!validMatchedBenchmark(r.matched_benchmark))throw Error('Invalid matched benchmark evidence');
        // Accept legacy receipt paths on input and omit them from the projection.
        const {artifact_path,...matched_benchmark}=r.matched_benchmark;
        evidence.matched_benchmark=matched_benchmark;
      }
      return evidence;
    }
    case 'context_snapshot': return {...base,...pick(r,['generated_at','freshness','task_digest']),requirements:(r.requirements||[]).map(safeRef),components:(r.components||[]).map((c,index)=>({name:'component_'+index,owner_ref:safeRef(c.owner_ref,index)}))};
    case 'verification_profile': return {...base,...pick(r,['profile_id','task_classes','blocking_policy']),checks:r.checks.map(c=>({...pick(c,['id','required','manual_approval']),procedure:'Private procedure withheld'}))};
    default: throw Error('Unsupported export record');
   }
 });
 const safeEvents = events.map(e=>({...pick(e,eventKeys.filter(k=>k!=='measurements')),measurements:(e.measurements||[]).map(sanitizeMeasurement)}));
 const result={export_version:1,authority:'local-task-records',repository,generated_at:new Date().toISOString(),records:safeRecords,events:safeEvents,coverage:{scope:'explicitly instrumented operations only',owner_acceptance:'not_authenticated_by_export'}};
 validateExport(result); return result;
}
function sanitizeMeasurement(m) {
 if(!token(m.name)||!['observed','estimated','unavailable'].includes(m.availability)) throw Error('Invalid measurement');
 const r=pick(m,['name','availability','value','unit','source','method','coverage']);
 for(const key of ['unit','source','method']) if(r[key]!==undefined&&!token(r[key])) throw Error('Unsafe measurement label');
 if(r.value!==undefined && r.value!==null && (typeof r.value!=='number'||!Number.isFinite(r.value))) throw Error('Invalid numeric measurement');
 if(r.availability==='unavailable') delete r.value;
 if(r.coverage!==undefined && (typeof r.coverage!=='number'||r.coverage<0||r.coverage>1)) throw Error('Invalid coverage');
 return r;
}
export function validateExport(e) {
 if(e.export_version!==1||e.authority!=='local-task-records'||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(e.repository)||!Array.isArray(e.records)||!Array.isArray(e.events)||e.records.length+e.events.length>10000) throw Error('Invalid export envelope');
 const operations=new Map();
 for(const event of e.events) {
  if(event.state==='accepted')throw Error('Accepted trace requires independent owner evidence');
  if(Object.keys(event).some(k=>!eventKeys.includes(k))||event.trace_version!==1||!token(event.event_id)||!token(event.task_id)||!token(event.trace_id)||!token(event.span_id)||event.repository!==e.repository||!hash(event.revision)||!['queue','waiting','context','investigation','implementation','verification','integration','review','recovery','other'].includes(event.phase)||(event.state!==undefined&&!['created','ready','assigned','started','blocked','verifying','integrated','completed','accepted','failed','interrupted','cancelled','restarted','resumed'].includes(event.state))||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(event.occurred_at)||!Number.isFinite(Date.parse(event.occurred_at))||!['engineering_activity','development_note','lifecycle','span_start','span_end','measurement'].includes(event.kind)) throw Error('Invalid trace');
  if(event.session_id!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event.session_id))throw Error('Unsafe executor session identifier');
  for(const key of ['attempt_id','parent_span_id'])if(event[key]!==undefined&&!token(event[key]))throw Error('Unsafe optional trace identifier');
  validateActivity(event,operations);
  if (event.kind==='development_note'
    ? !event.attempt_id||!event.session_id||event.phase!=='implementation'||event.measurements.length!==0||
      event.state!==undefined||!validDevelopmentNote(event.development_note)
    : event.development_note!==undefined) throw Error('Invalid development note');
  event.measurements.forEach(sanitizeMeasurement);
 }
 for(const r of e.records) {
 for(const key of ['task_id','attempt_id','provider','model','profile_id','criterion_id','task_digest']) if(r[key]!==undefined&&!token(r[key])) throw Error('Unsafe identifier');
 if(!hash(r.revision))throw Error('Invalid revision');
 if(r.task_digest!==undefined&&!/^[a-f0-9]{64}$/.test(r.task_digest))throw Error('Invalid Task digest');
 if(r.attempt_number!==undefined&&(!Number.isInteger(r.attempt_number)||r.attempt_number<1))throw Error('Invalid Attempt number');
 if(r.synthetic!==undefined&&typeof r.synthetic!=='boolean')throw Error('Invalid evidence synthetic flag');
 if(r.matched_benchmark!==undefined&&(r.record_type!=='evidence'||r.kind!=='benchmark'||
    r.synthetic!==false||!validMatchedBenchmark(r.matched_benchmark)))throw Error('Invalid matched benchmark evidence');
 if(r.schema_version!==1||r.repository!==e.repository||!token(r.id)||!['task','attempt','telemetry','evidence','context_snapshot','verification_profile'].includes(r.record_type)) throw Error('Invalid record');
 if(r.prerequisites?.task_ids?.some(id=>!token(id))) throw Error('Unsafe dependency identifier');
 const classes=['bug','feature','visual','backend','performance','security','research','documentation','maintenance','integration'];
 const enums={
  task:{state:['proposed','ready','running','verifying','blocked','failed','accepted','cancelled','superseded']},
  attempt:{state:['queued','running','verifying','succeeded','failed','blocked','cancelled'],failure_category:['none','requirements','implementation','test','integration','environment','visual_mismatch','authorization','unknown']},
  evidence:{kind:['test','visual','motion','benchmark','security','review','build','other'],result:['passed','failed','inconclusive','not_run']},
  telemetry:{phase:['context','implementation','verification','integration','review','other']},
  context_snapshot:{freshness:['current','stale','unverified']},
  verification_profile:{blocking_policy:['report_only','enforce']}
 };
 for(const [key,values] of Object.entries(enums[r.record_type]))if(r[key]!==undefined&&!values.includes(r[key]))throw Error('Invalid record enum');
 if(r.classification && (!classes.includes(r.classification.primary)||(r.classification.secondary||[]).some(c=>!classes.includes(c))))throw Error('Invalid class');
 if(r.acceptance && (!token(r.acceptance.profile_id)||r.acceptance.criteria.some(c=>!token(c.id))))throw Error('Invalid acceptance identity');
 if(r.checks?.some(c=>!token(c.id)||typeof c.required!=='boolean'||(c.manual_approval!==undefined&&typeof c.manual_approval!=='boolean')))throw Error('Invalid profile check');
 if(r.task_classes?.some(c=>!classes.includes(c)))throw Error('Invalid profile class');
 if(r.measurements)r.measurements.forEach(sanitizeMeasurement);
 for(const key of ['created_at','started_at','finished_at','observed_at','generated_at'])if(r[key]!==undefined&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(r[key]))throw Error('Invalid timestamp');
 }
 return true;
}
