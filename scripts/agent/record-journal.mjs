/** Immutable private transport envelopes around the existing six canonical v1 records. */
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {appendEventLocked,readJournal,withJournalLock} from './journal.mjs';
const kinds=new Set(['task','attempt','evidence','telemetry','context_snapshot','verification_profile']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
function envelope(record,taskId){
 if(record?.schema_version!==1||!kinds.has(record.record_type)||!record.id||!record.repository||!/^[a-f0-9]{40}$/i.test(record.revision))throw Error('Expected canonical v1 record');
 const associatedTask=record.record_type==='task'?record.id:record.task_id||taskId;
 if(!associatedTask)throw Error('Explicit Task correlation required');
 const serialized=JSON.stringify(canonical({record,task_id:associatedTask}));
 return {journal_version:1,event_id:'record_'+createHash('sha256').update(serialized).digest('hex'),task_id:associatedTask,occurred_at:record.finished_at||record.observed_at||record.generated_at||record.created_at,record:canonical(record)};
}
export async function persistRecord(directory,record,{taskId}={}){
 const target=join(directory,'records');
 return withJournalLock(target,()=>appendEventLocked(target,envelope(record,taskId)));
}
export async function readRecordHistory(directory,{taskId,...limits}={}){
 const events=await readJournal(join(directory,'records'),{...limits,missingOk:true});
 return events.map(event=>{
  if(taskId!==undefined){
   if(event.task_id!==taskId) throw Error('Journal contains a record for another Task');
   const expected=envelope(event.record,taskId);
   if(expected.event_id!==event.event_id||expected.occurred_at!==event.occurred_at||expected.journal_version!==event.journal_version)
    throw Error('Record journal identity corruption');
  }
  return event.record;
 });
}
const terminal = state => ['succeeded','failed','cancelled'].includes(state);
export function reduceAttempts(history){
 const latest=new Map();
 for(const record of history){
  if(record.record_type!=='attempt')continue;
  const prior=latest.get(record.id);
  if(!prior){latest.set(record.id,record);continue;}
  for(const key of ['task_id','repository','revision','attempt_number','created_at','started_at','provider','model'])if(prior[key]!==record[key])throw Error('Conflicting Attempt provenance');
  if(terminal(prior.state)&&terminal(record.state)){
   if(JSON.stringify(canonical(prior))!==JSON.stringify(canonical(record)))throw Error('Conflicting terminal Attempt snapshots');
  }else if(terminal(record.state)||(!terminal(prior.state)&&(record.finished_at||record.created_at)>=(prior.finished_at||prior.created_at)))latest.set(record.id,record);
 }
 return [...latest.values()];
}
export async function beginAttempt(directory,record,{requireNew=false}={}){
 if(record.record_type!=='attempt'||record.state!=='running'||record.finished_at)throw Error('Expected running Attempt');
 const target=join(directory,'records');
 return withJournalLock(target,async()=>{
  let prior=[];try{prior=await readJournal(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  const existing=reduceAttempts(prior.map(e=>e.record)).find(r=>r.id===record.id);
  if(existing){
   if(requireNew)throw Error('Attempt already exists; reconcile before restart');
   for(const key of ['task_id','repository','revision','attempt_number'])if(existing[key]!==record[key])throw Error('Attempt identity or revision mismatch');
   if(existing.state!=='running')throw Error('Attempt is already terminal or blocked; explicitly create/resume an Attempt');
   for(const key of ['provider','model'])if(record[key]!==undefined&&existing[key]!==record[key])throw Error('Attempt configuration changed');
   return existing;
  }
  await appendEventLocked(target,envelope(record));return record;
 });
}
export async function reconstructAttempts(directory){
 const history=await readRecordHistory(directory), attempts=reduceAttempts(history);
 let events=[];try{events=await readJournal(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
 const coverage=attempts.map(attempt=>{
  const matching=events.filter(e=>e.attempt_id===attempt.id&&e.task_id===attempt.task_id&&e.repository===attempt.repository&&e.revision===attempt.revision);
  const starts=new Set(),ends=new Set();for(const e of matching){const key=e.trace_id+':'+e.span_id;if(e.kind==='span_start')starts.add(key);if(e.kind==='span_end')ends.add(key);}
  const open=new Set([...starts].filter(key=>!ends.has(key)));
  return {attempt_id:attempt.id,unfinished_span_count:open.size,coverage:open.size||attempt.state==='running'?'partial':'instrumented_operations_only',execution_liveness:'unknown',recovery_action:open.size||attempt.state==='running'?'reconcile_with_execution_owner_before_retry':'none'};
 });
 return {attempts,history,coverage};
}

/** Observe one explicitly invoked Attempt callback; completion is NOT Task acceptance. */
export async function observeAttempt({directory,task,context,attemptId,attemptNumber=1,provider,model,run}){
 const {checkFreshness}=await import('./context.mjs');
 const {observeLifecycle}=await import('./lifecycle.mjs');
 if(typeof run!=='function'||!attemptId||!Number.isInteger(attemptNumber)||attemptNumber<1)throw Error('Explicit Attempt identity and callback required');
 if(!await checkFreshness(context,task,task.revision))throw Error('Fresh source-verified context required');
 const now=new Date().toISOString();
 const attempt=await beginAttempt(directory,{schema_version:1,record_type:'attempt',id:attemptId,created_at:now,repository:task.repository,revision:task.revision,task_id:task.id,attempt_number:attemptNumber,state:'running',started_at:now,...provider?{provider}:{},...model?{model}:{},failure_category:'none'},{requireNew:true});
 // This API is deliberately new-attempt only: incomplete attempts require owner reconciliation.
 const existing=await readJournal(directory);if(existing.some(e=>e.kind==='lifecycle'&&e.attempt_id===attemptId&&e.task_id===task.id))throw Error('Attempt already observed; reconcile before restart');
 for(const state of ['created','ready','started'])await observeLifecycle({directory,task,attemptId,state});
 let value,error,failed=false;
 try{value=await run({attempt,observe:async(phase,callback)=>{const {observeOperation}=await import('./lifecycle.mjs');return observeOperation({directory,task,attemptId,phase,run:callback});}});}catch(e){failed=true;error=e;}
 const finished={...attempt,state:failed?'failed':'succeeded',finished_at:new Date(Math.max(Date.now(),Date.parse(attempt.started_at)+1)).toISOString(),failure_category:failed?'unknown':'none'};
 await persistRecord(directory,finished);
 await observeLifecycle({directory,task,attemptId,state:failed?'failed':'completed'});
 if(failed)throw error;
 return {value,attempt:finished};
}
