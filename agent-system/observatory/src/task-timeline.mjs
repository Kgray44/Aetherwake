const humanize = value => String(value ?? '').replaceAll('_', ' ');
const detail = (label, value) => value === undefined || value === null || value === '' ? [] : [[label, String(value)]];
const receiptTitles = {
  register:'Task submitted', publish:'Proposal published', edit:'Task edited', transition:'Proposal state changed',
  configure_execution:'Execution settings changed', admit:'Task admitted to execution', satisfy:'Prerequisite attested', claim:'Executor claimed Task',
  accept:'Task marked complete', reject:'Candidate rejected', retry:'Retry queued', pause:'Pause requested',
  resume:'Task resumed', cancel:'Cancellation requested', archive:'Task archived', reopen:'Task reopened with feedback',
  supersede:'Task superseded', associate:'Delivery reference linked', dependency_cancelled:'Cancelled by dependency',
  failed:'Executor reported failure', finished:'Candidate submitted for review', stopped:'Executor stopped',
  lease_expired:'Executor lease expired', attempt_time_limit_reached:'Attempt time limit reached',
};

const activeExecution = new Set(['running','pausing','cancelling']);

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
    add({id:'end:'+attempt.id,at:attempt.finished_at,type:'Attempt',...identity,outcome:attempt.state,title:'Attempt '+attempt.attempt_number+' finished',
      description:humanize(attempt.state),details:[...common,...detail('Outcome',humanize(attempt.state)),
        ...detail('Failure',attempt.failure_diagnosis ?? attempt.failure)]});
  }
  for (const receipt of audits) {
    if (receipt.target_id && receipt.target_id !== task.id) continue;
    const operation = receipt.kind ?? receipt.type ?? 'operation';
    if (operation === 'heartbeat') continue;
    add({id:'audit:'+receipt.operation_id,at:receipt.at,type:'Audit',title:receiptTitles[operation]??humanize(operation),
      milestone:operation==='accept', attemptId:attemptById.has(receipt.attempt_id)?receipt.attempt_id:null,
      description:humanize(receipt.state),activityType:operation,outcome:receipt.state,
      executor:attemptById.get(receipt.attempt_id)?.executor??attemptById.get(receipt.attempt_id)?.provider,
      href:receipt.reference?.uri, reviewedEvidence:receipt.evidence??[], details:[
        ...detail('Recorded by',receipt.actor),...detail('Task version',receipt.version),...detail('Reason',receipt.reason),
        ...detail('Owner feedback',receipt.feedback),...detail('Scheduled start',receipt.start_at),
        ...detail('Time limit (minutes)',receipt.max_attempt_minutes),
        ...detail('Cancel with dependency',receipt.cancel_with_dependency===undefined?null:receipt.cancel_with_dependency?'Enabled':'Disabled'),...detail('Fields changed',receipt.fields?.map(humanize).join(', ')),
        ...detail('Candidate revision',receipt.revision??receipt.reference?.revision),
        ...detail('Reviewed criteria',receipt.evidence?.length),...detail('Reference type',humanize(receipt.reference?.kind)),
        ...detail('Attempt',receipt.attempt_id),...detail('Operation ID',receipt.operation_id),
      ]});
  }
  for (const event of events) {
    if (event.task_id !== task.id) continue;
    const attempt=attemptById.get(event.attempt_id);
    const actualAttempt=attempt?.revision===event.revision?attempt:null;
    add({id:'trace:'+event.event_id,at:event.occurred_at,type:'Trace',
      title:[humanize(event.phase),humanize(event.kind)].filter(Boolean).join(' · '),attemptId:actualAttempt?.id,
      activityType:event.kind,outcome:event.state,executor:actualAttempt?.executor??actualAttempt?.provider,
      description:[actualAttempt?'Attempt '+actualAttempt.attempt_number:'',humanize(event.state)].filter(Boolean).join(' · '),
      details:[...detail('Attempt ID',event.attempt_id),...detail('Revision',event.revision),...detail('Trace ID',event.trace_id),
        ...detail('Span ID',event.span_id),...detail('Parent span',event.parent_span_id),...detail('Source',event.source),
        ...detail('Latest Task telemetry snapshot received',telemetrySource?.task_id===task.id?telemetrySource.received_at:null)],
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
