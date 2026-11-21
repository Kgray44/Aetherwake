const labels = {
  verified:'Verified',observed:'Observed',reported:'Reported',correlated:'Correlated',
  unavailable:'Unavailable',inapplicable:'Not applicable',conflicting:'Conflicting or inconclusive',
};

export function taskDataCoverage({task,canonical,attempts,usage,diagnostics,events,telemetrySource}) {
  const engine = canonical?.task?.id===task.id ? canonical : null;
  const noAttempts = Boolean(engine && engine.attempts?.length===0 && !attempts.length);
  const rows=[];
  const add=(topic,status,basis)=>rows.push({topic,status,label:labels[status],basis});

  const identified = attempts.filter(attempt=>attempt.execution_identity?.model&&attempt.execution_identity?.provider&&
    attempt.execution_identity.source==='codex_app_server_thread_start').length;
  const reported = attempts.filter(attempt=>attempt.model||attempt.provider).length;
  if (identified) add('Provider and model','observed',identified+' of '+attempts.length+' attempts identified at Codex thread start.');
  else if (reported) add('Provider and model','reported','Provider or model fields were supplied without a linked thread-start observation.');
  else add('Provider and model',noAttempts?'inapplicable':'unavailable',noAttempts?'The Task Engine records no attempts.':'No provider and model observation is linked.');

  const measured = diagnostics.coverage.filter(interval=>interval.coveredMs>0).length;
  if (measured) add('Attempt timing','observed','Measured intervals cover '+measured+' of '+diagnostics.coverage.length+
    ' finished attempts with a known duration. Untraced time remains visible in the timing breakdown.');
  else add('Attempt timing',noAttempts?'inapplicable':'unavailable',noAttempts?'The Task Engine records no attempts.':
    'No measured interval is linked to a finished attempt with a known duration.');

  const tokenCoverage=usage.coverage;
  const tokenBasis=tokenCoverage.attemptTotals+' of '+tokenCoverage.attempts+' attempt totals and '+
    tokenCoverage.sessionTotals+' of '+tokenCoverage.sessions+' linked session totals are available.';
  if (tokenCoverage.conflicts) add('Token usage','conflicting',tokenBasis+
    ' The source contains conflicting journal or cumulative usage records. The affected readings were excluded.');
  else if (usage.observed.totalTokens!=null) add('Token usage','observed',tokenBasis);
  else if (usage.progressRows.length) add('Token usage','observed','Codex usage snapshots are available. Final usage receipts supply the Task total.');
  else add('Token usage',noAttempts&&!tokenCoverage.sessions?'inapplicable':'unavailable',tokenBasis);

  const taskEvents=events.filter(event=>event.task_id===task.id&&event.repository===task.repository);
  const receipts=telemetrySource?.task_id===task.id ? telemetrySource.event_receipts??{} : {};
  const dated=taskEvents.filter(event=>Object.hasOwn(receipts,event.event_id)&&
    Number.isFinite(Date.parse(receipts[event.event_id]))).length;
  if (dated) add('Telemetry arrival','observed',dated+' of '+taskEvents.length+' journal events have an Observatory first-receipt timestamp.');
  else add('Telemetry arrival','unavailable',taskEvents.length?'No first-receipt timestamps are linked to these journal events.':
    'No Task journal events are loaded in this snapshot.');

  const reviewed=[...diagnostics.accepted.values()].filter(receipt=>Number.isFinite(Date.parse(receipt.at))).length;
  if (reviewed) add('Owner review','verified',reviewed+' criteria have matching owner acceptance receipts.');
  else if (diagnostics.accepted.size) add('Owner review','correlated','The accepted revision matches the criterion references. Receipt times are unavailable.');
  else add('Owner review','unavailable','No matching owner acceptance receipt is available.');

  const realEvidence=diagnostics.evidence.filter(record=>record.repository===task.repository&&record.synthetic===false).length;
  if (realEvidence) add('Verification contract records','reported',realEvidence+' non-synthetic evidence records describe results.');
  else add('Verification contract records','unavailable','No non-synthetic verification contract records are linked.');
  add('Billing','unavailable','No actual charge is linked to this Task. Published API reference rates are shown separately when available.');
  return rows;
}
