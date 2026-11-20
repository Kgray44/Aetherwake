import { attemptEvents } from './task-workspace.mjs';
import { attemptMatchesEvidence } from './evidence-status.mjs';

export function mergeTaskAttempts(taskId, reported, canonical) {
  const attempts = new Map(reported.filter(item=>item.task_id===taskId).map(item=>[item.id,item]));
  for (const record of canonical) {
    const prior=attempts.get(record.id);
    const matching=prior?.revision===record.revision?prior:null;
    attempts.set(record.id,{
      ...matching,...record,task_id:taskId,
      failure_diagnosis:record.failure??matching?.failure_diagnosis,
    });
  }
  return [...attempts.values()].sort((a,b)=>a.attempt_number-b.attempt_number ||
    String(a.started_at??'').localeCompare(String(b.started_at??'')) || a.id.localeCompare(b.id));
}

const operations = {
  claim:'Executor claimed attempt', heartbeat:'Worker heartbeat', finished:'Candidate submitted for review',
  failed:'Worker reported failure', stopped:'Worker stopped', accept:'Owner accepted result', reject:'Owner rejected candidate',
  lease_expired:'Executor lease expired', attempt_time_limit_reached:'Attempt time limit reached',
};

export function attemptJournal(attempt, events, receipts, evidence) {
  const trace = attemptEvents(attempt,events);
  const operationsForAttempt = receipts.filter(item=>item.attempt_id===attempt.id &&
    (!item.target_id||item.target_id===attempt.task_id));
  const entries=new Map();
  for (const event of trace) entries.set('trace:'+event.event_id,{
    at:event.occurred_at,source:'Execution trace',title:[event.phase,event.kind].filter(Boolean).join(' · '),
    status:event.state,metrics:event.measurements??[],
  });
  for (const item of operationsForAttempt) entries.set('audit:'+item.operation_id,{
    at:item.at,source:'Task Engine',title:operations[item.kind]??item.kind??item.type,
    status:item.state,reason:item.reason,metrics:[],
  });
  const evidenceRecords = evidence.filter(item=>attemptMatchesEvidence(attempt,item));
  return {
    events:[...entries].map(([id,row])=>({id,...row})).sort((a,b)=>String(b.at??'').localeCompare(String(a.at??''))||a.id.localeCompare(b.id)),
    evidence:evidenceRecords,
  };
}