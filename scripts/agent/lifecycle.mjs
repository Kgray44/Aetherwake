/** Observational lifecycle API, never an execution scheduler or approval authority. */
import {randomUUID} from 'node:crypto';
import {appendEvent,appendEventLocked,withJournalLock,readJournal,traceEvent} from './journal.mjs';
const transitions={created:['ready','cancelled'],ready:['assigned','started','blocked','cancelled'],assigned:['started','blocked','cancelled'],started:['blocked','verifying','failed','interrupted','cancelled','completed'],blocked:['ready','resumed','cancelled'],resumed:['started','verifying','blocked','failed','interrupted','cancelled'],verifying:['completed','failed','blocked','interrupted','cancelled'],failed:['restarted','cancelled'],interrupted:['resumed','cancelled'],restarted:['started','blocked','cancelled'],completed:['integrated'],integrated:[],cancelled:[]};
export async function observeLifecycle(args) {
 return withJournalLock(args.directory,()=>observeLifecycleLocked(args));
}
async function observeLifecycleLocked({directory,task,state,attemptId,eventId,occurredAt}) {
 // Independent authenticated owner acceptance is deliberately not settable here.
 if(state==='accepted') throw Error('Owner acceptance requires independent authenticated evidence');
 let events=[];try{events=await readJournal(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
 const prior=events.filter(e=>e.task_id===task.id&&e.attempt_id===attemptId&&e.kind==='lifecycle');
 if(eventId && prior.some(e=>e.event_id===eventId)) {
  const old=prior.find(e=>e.event_id===eventId);
  if(old.state!==state||old.revision!==task.revision) throw Error('Conflicting lifecycle event');
  return old;
 }
 const previous=prior.at(-1)?.state;
 if(previous ? !transitions[previous]?.includes(state) : state!=='created') throw Error('Invalid lifecycle transition: '+previous+' -> '+state);
 if(prior.length) {
  const last=Date.parse(prior.at(-1).occurred_at);
  if(occurredAt && Date.parse(occurredAt)<=last) throw Error('Lifecycle timestamps must be increasing');
  occurredAt ??= new Date(Math.max(Date.now(),last+1)).toISOString();
 }
 const event=traceEvent({task,attemptId,kind:'lifecycle',state,eventId,occurredAt});
 await appendEventLocked(directory,event);return event;
}
export async function observeOperation({directory,task,attemptId,phase,parentSpanId,run}) {
 if(!attemptId||typeof run!=='function') throw Error('Operation must belong to an Attempt');
 const spanId='span_'+randomUUID();const start=process.hrtime.bigint();
 await appendEvent(directory,traceEvent({task,attemptId,spanId,parentSpanId,phase,kind:'span_start',state:'started'}));
 let value;
 try { value=await run(); }catch(error){await finish('failed');throw error;}
 await finish('completed');return value;
 async function finish(state){await appendEvent(directory,traceEvent({task,attemptId,spanId,parentSpanId,phase,kind:'span_end',state,measurements:[{name:'elapsed_wall_ms',availability:'observed',value:Number(process.hrtime.bigint()-start)/1e6,unit:'ms',source:'local_monotonic_clock',method:'hrtime.bigint'}]}));}
}
export function lifecycleSummary(events,taskId) {
 const selected=events.filter(e=>e.task_id===taskId), first=state=>selected.find(e=>e.kind==='lifecycle'&&e.state===state)?.occurred_at;
 const created=first('created');const delta=state=>created&&first(state)?Date.parse(first(state))-Date.parse(created):null;
 const attempts=new Set(selected.map(e=>e.attempt_id).filter(Boolean));
 return {attempts:attempts.size,failed_attempts:new Set(selected.filter(e=>e.kind==='lifecycle'&&e.state==='failed').map(e=>e.attempt_id).filter(Boolean)).size,time_to_completed_ms:delta('completed'),time_to_integrated_ms:delta('integrated'),time_to_accepted_ms:null,owner_acceptance:'requires_independent_evidence',root_cause:'unavailable_without_diagnosis_evidence'};
}
