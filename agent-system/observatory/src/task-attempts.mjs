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
  recover_candidate:'Recovered candidate submitted for review',
  recover_worker_candidate:'Worker reconciled a saved candidate',
  continue_candidate:'Owner authorized continuation from candidate',
  failed:'Worker reported failure', stopped:'Worker stopped', accept:'Owner accepted result', reject:'Owner rejected candidate',
  lease_expired:'Executor lease expired', attempt_time_limit_reached:'Attempt time limit reached',
};

const belongsTo = (attempt, receipt) => receipt.attempt_id===attempt.id &&
  (!receipt.target_id||receipt.target_id===attempt.task_id);

const progressPhases = {context:'Checkout preparation',implementation:'Implementation',
  verification:'Verification',integration:'Candidate submission'};

function attemptSupervision(attempt, trace, receipts) {
  const lastRenewal=receipts.filter(item=>item.kind==='heartbeat'&&Number.isFinite(Date.parse(item.at)))
    .reduce((latest,item)=>!latest||Date.parse(item.at)>Date.parse(latest)?item.at:latest,null);
  const turn=trace.findLast(item=>item.span_id==='codex-'+attempt.id+'-codex_turn'&&
    ['span_start','span_end'].includes(item.kind)&&item.state);
  const progress=trace.findLast(item=>item.kind==='development_note'||
    (item.kind==='span_end'&&item.state==='completed'&&
      Object.hasOwn(progressPhases,item.phase)&&!item.span_id?.endsWith('-terminal_reporting')));
  return {
    lastRenewal,
    leaseUntil:Number.isFinite(attempt.lease_until)?attempt.lease_until:null,
    provider:turn?{state:turn.state,at:turn.occurred_at}:null,
    progress:progress?{label:progress.kind==='development_note'?'Development note':progressPhases[progress.phase],
      at:progress.occurred_at}:null,
    recovery:attempt.state==='orphaned'?'Reconciliation required':
      ['recovered','worker_recovered'].includes(attempt.candidate_origin)?'Candidate recovered':null,
    recoveryUntil:attempt.state==='orphaned'&&Number.isFinite(attempt.recovery_until)?attempt.recovery_until:null,
  };
}

export function attemptJournal(attempt, events, receipts, evidence) {
  const trace = attemptEvents(attempt,events);
  const operationsForAttempt = receipts.filter(item=>belongsTo(attempt,item));
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
    supervision:attemptSupervision(attempt,trace,operationsForAttempt),
  };
}
