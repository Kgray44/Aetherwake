import { isAppServerUsageProgress } from './task-engine-client.mjs';

const humanize = value => String(value ?? '').replaceAll('_', ' ');
const detail = (label, value) => value === undefined || value === null || value === '' ? [] : [[label, String(value)]];
const receiptTitles = {
  register:'Task submitted', publish:'Proposal published', edit:'Task edited', transition:'Proposal state changed',
  configure_execution:'Execution settings changed', admit:'Task admitted to execution', satisfy:'Prerequisite attested', claim:'Executor claimed Task',
  accept:'Task marked complete', reject:'Candidate rejected', retry:'Retry queued', pause:'Pause requested',
  resume:'Task resumed', cancel:'Cancellation requested', archive:'Task archived', reopen:'Task reopened with feedback',
  supersede:'Task superseded', associate:'Delivery reference linked', dependency_cancelled:'Cancelled by dependency',
  failed:'Executor reported failure', finished:'Candidate submitted for review', stopped:'Executor stopped',
  recover_candidate:'Recovered candidate submitted for review',
  lease_expired:'Executor lease expired', attempt_time_limit_reached:'Attempt time limit reached',
};

const activeExecution = new Set(['running','pausing','cancelling']);
const workerStages = {
  worker_initialization:'Worker initialization', checkout_provisioning:'Checkout preparation',
  checkout_fetch:'Fetch pinned revision', checkout_materialization:'Materialize checkout',
  checkout_validation:'Validate checkout', candidate_git_verification:'Verify candidate revision',
  codex_turn:'Codex work', worker_exit_recovery:'Abandoned worker recovered',
  candidate_submission:'Submit candidate', terminal_reporting:'Report terminal outcome', checkout_lock_release:'Release checkout lock',
};

export function executorHeartbeat({ taskId, attempt, state, audits = [], now = Date.now() }) {
  if (!attempt?.id) return null;
  let lastAt = null;
  for (const receipt of audits) {
    if ((receipt.kind ?? receipt.type) !== 'heartbeat' || receipt.attempt_id !== attempt.id ||
        (receipt.target_id && receipt.target_id !== taskId) || !Number.isFinite(Date.parse(receipt.at))) continue;
    if (!lastAt || Date.parse(receipt.at) > Date.parse(lastAt)) lastAt = receipt.at;
  }
  const active = activeExecution.has(state);
  if (!active && !lastAt) return null;
  const leaseUntil = active && Number.isFinite(attempt.lease_until) ? attempt.lease_until : null;
  const status = !active ? 'ended' : leaseUntil != null && now >= leaseUntil ? 'overdue'
    : lastAt ? 'receiving' : 'awaiting';
  return {status,lastAt,leaseUntil};
}

export function taskExecutionStatus({taskId,state,attempt,events=[],audits=[]}) {
  if (!attempt || ['admitted','queued','ready','scheduled','blocked','paused'].includes(state)) return null;
  if (state==='failed'&&(attempt.state==='failed'||attempt.state==='blocked'||attempt.failure||attempt.failure_diagnosis)) {
    const recovered=events.find(event=>event.task_id===taskId&&event.attempt_id===attempt.id&&event.revision===attempt.revision&&
      event.kind==='lifecycle'&&event.span_id==='codex-'+attempt.id+'-worker_exit_recovery');
    const interrupted = events.filter(event=>event.task_id===taskId&&event.attempt_id===attempt.id&&
      event.revision===attempt.revision&&event.kind==='span_end'&&event.span_id==='codex-'+attempt.id+'-codex_turn'&&
      event.state==='interrupted').sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at))[0];
    const diagnosis=attempt.failure_diagnosis??attempt.failure??'No failure reason was recorded.';
    return {
      title:recovered?'Worker exited without a terminal report':interrupted?'Codex turn interrupted':'Attempt '+attempt.attempt_number+' failed',tone:'error',
      at:recovered?.occurred_at??interrupted?.occurred_at??attempt.finished_at,
      description:recovered?'A later worker confirmed the original process was gone. The exit trigger is unknown. Reconcile the preserved checkout before retrying.':
        interrupted?'The execution trace recorded the interruption. Task Engine outcome: '+diagnosis:diagnosis,
    };
  }
  if (!activeExecution.has(state)) {
    if (state==='verifying'&&['recovered','worker_recovered'].includes(attempt.candidate_origin)) {
      const recovered=audits.findLast(receipt=>receipt.kind==='recover_candidate'&&receipt.attempt_id===attempt.id);
      return {title:'Recovered candidate ready for review',tone:'neutral',at:recovered?.at,
        description:'The original executor stopped. A preserved revision was checked and submitted separately.'};
    }
    if (!attempt.finished_at||state==='completed'||state==='archived') return null;
    return {title:attempt.session_id?'Codex stopped working':'Execution attempt ended',tone:'neutral',
      at:attempt.finished_at,description:state==='verifying'?'Candidate awaits owner review.':null};
  }
  const prefix='codex-'+attempt.id+'-';
  const latest=events.filter(event=>event.task_id===taskId&&event.attempt_id===attempt.id&&event.revision===attempt.revision&&
    (event.kind==='span_start'||event.kind==='span_end')&&event.span_id?.startsWith(prefix))
    .sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at))
    .find(event=>Object.hasOwn(workerStages,event.span_id.slice(prefix.length)));
  const heartbeat=executorHeartbeat({taskId,attempt,state,audits});
  const stage=latest?.span_id.slice(prefix.length);
  const title=stage==='codex_turn'?(latest.kind==='span_start'?'Codex started working':'Codex stopped working')
    : stage ? workerStages[stage] : attempt.session_id?'Codex conversation connected':'Worker preparing execution';
  return {title,tone:heartbeat?.status==='overdue'?'error':'neutral',at:latest?.occurred_at??attempt.started_at,
    description:heartbeat?.status==='overdue'?'Worker heartbeat overdue. Check the attempt for updates.'
      : stage==='codex_turn'&&latest.state==='failed'?'The Codex turn reported a failure.'
      : !stage&&attempt.session_id?'Waiting for a Codex work event.':null};
}

export function journalReceiptSummary(timeline) {
  const receipts = new Map(timeline.filter(item=>Object.hasOwn(item,'journalReceipt'))
    .map(item=>[item.id,item]));
  if (!receipts.size) return 'No dated journal events in this snapshot.';
  let observed=0, discrepancies=0;
  for (const {at,journalReceipt} of receipts.values()) {
    const received=Date.parse(journalReceipt);
    if (!Number.isFinite(received)) continue;
    observed++;
    if (received<Date.parse(at)) discrepancies++;
  }
  const coverage = 'First-receipt timestamps are available for '+observed+' of '+receipts.size+' journal events.';
  return discrepancies ? coverage+' Occurrence is later than receipt for '+discrepancies+
    (discrepancies===1?' event.':' events.')+' Cross-source order is uncertain.' : coverage;
}

export function buildTaskTimeline({task, attempts=[], events=[], audits=[], evidence=[], records=[], engineeringEvents=[], telemetrySource}) {
  const rows = [];
  const add = item => {
    if (!item.at || !Number.isFinite(Date.parse(item.at))) return;
    rows.push(item);
  };
  for (const event of engineeringEvents) add(event);
  const selected = attempts.filter(attempt => attempt.task_id === task.id);
  const attemptById = new Map(selected.map(attempt => [attempt.id, attempt]));
  add({id:'task:'+task.id, at:task.created_at, type:'Task', title:'Task created',
    description:task.title, details:[...detail('Task ID',task.id),...detail('Base revision',task.revision)]});
  for (const attempt of selected) {
    const common = [...detail('Attempt ID',attempt.id),...detail('Executor',attempt.provider ?? attempt.executor),
      ...detail('Model',attempt.model),...detail('Branch',attempt.branch),...detail('Base revision',attempt.revision),
      ...detail('Candidate revision',attempt.candidate_revision),...detail('Executor session',attempt.session_id),
      ...detail('Attempt deadline',Number.isFinite(attempt.deadline)?new Date(attempt.deadline).toISOString():null)];
    const identity={attemptId:attempt.id,executor:attempt.executor??attempt.provider,activityType:'attempt'};
    add({id:'start:'+attempt.id,at:attempt.started_at,type:'Attempt',...identity,title:'Attempt '+attempt.attempt_number+' started',
      description:[attempt.provider ?? attempt.executor,attempt.model].filter(Boolean).join(' · '),details:common});
    const checkout = attempt.checkout_diagnostic;
    add({id:'end:'+attempt.id,at:attempt.finished_at,type:'Attempt',...identity,outcome:attempt.state,title:'Attempt '+attempt.attempt_number+' finished',
      description:humanize(attempt.state),details:[...common,...detail('Outcome',humanize(attempt.state)),
        ...detail('Failure',attempt.failure_diagnosis ?? attempt.failure),
        ...(checkout ? [
          ...detail('Checkout',task.id),...detail('Checkout stage',humanize(checkout.stage)),
          ...detail('Operation',checkout.operation),...detail('Category',humanize(checkout.category)),
          ...detail('Git exit code',checkout.exit_code),...detail('Fetch attempts',checkout.fetch_attempts),
          ...detail('Provisioning duration',checkout.duration_ms+' ms'),
          ...detail('Retryable',checkout.retryable?'Yes':'No'),
          ...detail('Recovery required',checkout.recovery_required?'Yes':'No'),
        ] : [])]});
  }
  for (const receipt of audits) {
    if (receipt.target_id && receipt.target_id !== task.id) continue;
    const operation = receipt.kind ?? receipt.type ?? 'operation';
    if (operation === 'heartbeat') continue;
    add({id:'audit:'+receipt.operation_id,at:receipt.at,type:'Audit',title:operation==='reopen'&&receipt.previous_state==='verifying'
        ?'Another round requested':receiptTitles[operation]??humanize(operation),
      milestone:operation==='accept', attemptId:attemptById.has(receipt.attempt_id)?receipt.attempt_id:null,
      description:humanize(receipt.state),activityType:operation,outcome:receipt.state,
      executor:attemptById.get(receipt.attempt_id)?.executor??attemptById.get(receipt.attempt_id)?.provider,
      href:receipt.reference?.uri, reviewedEvidence:receipt.evidence??[], details:[
        ...detail('Recorded by',receipt.actor),...detail('Task version',receipt.version),...detail('Reason',receipt.reason),
        ...detail('Owner feedback',receipt.feedback),...detail('Owner review notes',receipt.notes),...detail('Scheduled start',receipt.start_at),
        ...detail('Time limit (minutes)',receipt.max_attempt_minutes),
        ...detail('Cancel with dependency',receipt.cancel_with_dependency===undefined?null:receipt.cancel_with_dependency?'Enabled':'Disabled'),...detail('Fields changed',receipt.fields?.map(humanize).join(', ')),
        ...detail('Candidate revision',receipt.revision??receipt.reference?.revision),...detail('Original failure',receipt.previous_failure),
        ...detail('Reviewed criteria',receipt.evidence?.length),...detail('Reference type',humanize(receipt.reference?.kind)),
        ...detail('Attempt',receipt.attempt_id),...detail('Operation ID',receipt.operation_id),
      ]});
  }
  const source = telemetrySource?.task_id === task.id ? telemetrySource : null;
  for (const event of events) {
    if (event.task_id !== task.id || event.kind === 'engineering_activity' || event.kind === 'development_note' ||
        isAppServerUsageProgress(event)) continue;
    const attempt=attemptById.get(event.attempt_id);
    const actualAttempt=attempt?.revision===event.revision?attempt:null;
    const receipts = source?.event_receipts;
    const receivedAt = receipts && Object.hasOwn(receipts,event.event_id) ? receipts[event.event_id] : null;
    const clockConflict = receivedAt && Date.parse(receivedAt) < Date.parse(event.occurred_at);
    const stagePrefix = 'codex-'+event.attempt_id+'-';
    const stage = actualAttempt && event.span_id?.startsWith(stagePrefix)
      ? event.span_id.slice(stagePrefix.length) : null;
    const stageName = Object.hasOwn(workerStages,stage) ? workerStages[stage] : null;
    add({id:'trace:'+event.event_id,at:event.occurred_at,type:'Trace',journalReceipt:receivedAt,
      title:stageName ? stageName+' · '+humanize(event.state??event.kind)
        : [humanize(event.phase),humanize(event.kind)].filter(Boolean).join(' · '),attemptId:actualAttempt?.id,
      activityType:event.kind,outcome:event.state,executor:actualAttempt?.executor??actualAttempt?.provider,
      description:[actualAttempt?'Attempt '+actualAttempt.attempt_number:'',humanize(event.state)].filter(Boolean).join(' · '),
      details:[...detail('Attempt ID',event.attempt_id),...detail('Revision',event.revision),...detail('Trace ID',event.trace_id),
        ...detail('Span ID',event.span_id),...detail('Parent span',event.parent_span_id),...detail('Executor session',event.session_id),
        ...detail('Source',event.source),
        ['Observatory first received',receivedAt??'Unavailable'],
        ...detail('Latest Task telemetry snapshot received',receivedAt?null:source?.received_at),
        ...detail('Clock discrepancy',clockConflict?'The journal occurrence is later than the Observatory receipt. Cross-source order is uncertain.':null)],
      measurements:event.measurements??[]});
  }
  const criteria = new Map((task.acceptance?.criteria??[]).map(item=>[item.id,item.description]));
  for (const item of evidence) {
    if (item.task_id !== task.id) continue;
    add({id:'evidence:'+item.id,at:item.observed_at??item.created_at,type:'Evidence',title:'Reported '+humanize(item.kind)+' result',
      description:humanize(item.result),activityType:item.kind,outcome:item.result,details:[
        ...detail('Criterion',criteria.get(item.criterion_id)??item.criterion_id),...detail('Revision',item.revision),
        ...detail('Attempt ID',item.attempt_id),...detail('Source',item.synthetic?'Synthetic evidence':'Reported evidence'),
      ], href:item.artifact?.uri});
  }
  for (const item of records) {
    if (item.task_id !== task.id || !['telemetry','context_snapshot'].includes(item.record_type)) continue;
    add({id:item.record_type+':'+item.id,at:item.observed_at??item.created_at,type:'Trace',
      title:item.record_type==='telemetry'?'Telemetry captured':'Context snapshot recorded',
      details:[...detail('Record ID',item.id),...detail('Attempt ID',item.attempt_id),...detail('Revision',item.revision)],
      measurements:item.measurements??[]});
  }
  return [...new Map(rows.map(row=>[row.id,row])).values()]
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||Number(!!b.milestone)-Number(!!a.milestone)||a.id.localeCompare(b.id));
}
