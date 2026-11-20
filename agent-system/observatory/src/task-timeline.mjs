const humanize = value => String(value ?? '').replaceAll('_', ' ');
const detail = (label, value) => value === undefined || value === null || value === '' ? [] : [[label, String(value)]];
const receiptTitles = {
  register:'Task submitted', publish:'Proposal published', edit:'Task edited', transition:'Proposal state changed',
  admit:'Task admitted to execution', satisfy:'Prerequisite attested', claim:'Executor claimed Task',
  accept:'Task marked complete', reject:'Candidate rejected', retry:'Retry queued', pause:'Pause requested',
  resume:'Task resumed', cancel:'Cancellation requested', archive:'Task archived', reopen:'Task reopened with feedback',
  supersede:'Task superseded', associate:'Delivery reference linked', dependency_cancelled:'Cancelled by dependency',
  failed:'Executor reported failure', finished:'Candidate submitted for review', stopped:'Executor stopped',
  heartbeat:'Executor heartbeat', orphaned:'Executor lease expired',
};

export function buildTaskTimeline({task, attempts=[], events=[], audits=[], evidence=[], records=[]}) {
  const rows = [];
  const add = item => {
    if (!item.at || !Number.isFinite(Date.parse(item.at))) return;
    rows.push(item);
  };
  const selected = attempts.filter(attempt => attempt.task_id === task.id);
  const attemptById = new Map(selected.map(attempt => [attempt.id, attempt]));
  add({id:'task:'+task.id, at:task.created_at, type:'Task', title:'Task created',
    description:task.title, details:[...detail('Task ID',task.id),...detail('Base revision',task.revision)]});
  for (const attempt of selected) {
    const common = [...detail('Attempt ID',attempt.id),...detail('Executor',attempt.provider ?? attempt.executor),
      ...detail('Model',attempt.model),...detail('Branch',attempt.branch),...detail('Base revision',attempt.revision),
      ...detail('Candidate revision',attempt.candidate_revision)];
    add({id:'start:'+attempt.id,at:attempt.started_at,type:'Attempt',title:'Attempt '+attempt.attempt_number+' started',
      description:[attempt.provider ?? attempt.executor,attempt.model].filter(Boolean).join(' · '),details:common});
    add({id:'end:'+attempt.id,at:attempt.finished_at,type:'Attempt',title:'Attempt '+attempt.attempt_number+' finished',
      description:humanize(attempt.state),details:[...common,...detail('Outcome',humanize(attempt.state)),
        ...detail('Failure',attempt.failure_diagnosis ?? attempt.failure)]});
  }
  for (const receipt of audits) {
    if (receipt.target_id && receipt.target_id !== task.id) continue;
    const operation = receipt.kind ?? receipt.type ?? 'operation';
    add({id:'audit:'+receipt.operation_id,at:receipt.at,type:'Audit',title:receiptTitles[operation]??humanize(operation),
      milestone:operation==='accept', description:humanize(receipt.state),
      href:receipt.reference?.uri, reviewedEvidence:receipt.evidence??[], details:[
        ...detail('Recorded by',receipt.actor),...detail('Task version',receipt.version),...detail('Reason',receipt.reason),
        ...detail('Owner feedback',receipt.feedback),...detail('Fields changed',receipt.fields?.map(humanize).join(', ')),
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
      title:[humanize(event.phase),humanize(event.kind)].filter(Boolean).join(' · '),
      description:[actualAttempt?'Attempt '+actualAttempt.attempt_number:'',humanize(event.state)].filter(Boolean).join(' · '),
      details:[...detail('Attempt ID',event.attempt_id),...detail('Revision',event.revision),...detail('Trace ID',event.trace_id),
        ...detail('Span ID',event.span_id),...detail('Parent span',event.parent_span_id),...detail('Source',event.source)],
      measurements:event.measurements??[]});
  }
  const criteria = new Map((task.acceptance?.criteria??[]).map(item=>[item.id,item.description]));
  for (const item of evidence) {
    if (item.task_id !== task.id) continue;
    add({id:'evidence:'+item.id,at:item.observed_at??item.created_at,type:'Evidence',title:'Reported '+humanize(item.kind)+' result',
      description:humanize(item.result),details:[
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