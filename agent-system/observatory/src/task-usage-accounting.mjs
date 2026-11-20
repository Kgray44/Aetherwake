import { estimateOpenAIReference } from './openai-pricing.mjs';
import { linkedCodexSessionId } from './task-activity.mjs';
import { accountEngineeringTokens } from './engineering-token-accounting.mjs';
import { uniqueEngineeringEvents } from './engineering-analytics.mjs';
import { desktopSessionTokens, taskTokenProgress, taskTokenRows } from './task-engine-client.mjs';

export const usageFields = [
  ['totalTokens', 'Observed tokens'], ['cachedInputTokens', 'Cached input'],
  ['uncachedInputTokens', 'Uncached input'], ['outputTokens', 'Output'],
];

function addObserved(readings) {
  return Object.fromEntries(usageFields.map(([field]) => {
    const values = readings.map(reading => reading[field]).filter(Number.isSafeInteger);
    const sum = values.reduce((total, value) => total + BigInt(value), 0n);
    return [field, values.length && sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null];
  }));
}

function dedicatedReading(event) {
  const count = name => {
    const matches = (event.measurements ?? []).filter(metric => metric.name === 'desktop_' + name + '_tokens' &&
      metric.source === 'codex_desktop_session_usage' && metric.method === 'task_dedicated_session_total');
    const metric = matches.length === 1 ? matches[0] : null;
    return metric?.availability === 'observed' && metric.unit === 'tokens' &&
      Number.isSafeInteger(metric.value) && metric.value >= 0 ? metric.value : null;
  };
  const totalTokens = count('total'), input = count('input'), cached = count('cached_input'), outputTokens = count('output');
  if (totalTokens === null || (input !== null && outputTokens !== null && input + outputTokens !== totalTokens) ||
      (input !== null && cached !== null && cached > input)) return null;
  return {totalTokens, cachedInputTokens:cached,
    uncachedInputTokens:input !== null && cached !== null ? input - cached : null, outputTokens};
}

function latestDedicatedReading(readings) {
  readings.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
  const inconsistent=readings.some((item,index)=>{
    const prior=readings[index-1];
    return prior&&(item.observed.totalTokens<prior.observed.totalTokens||
      Date.parse(item.at)===Date.parse(prior.at)&&JSON.stringify(item.observed)!==JSON.stringify(prior.observed));
  });
  return {latest:inconsistent?null:readings.at(-1),inconsistent};
}

export function loadedSessionUsage({records,events,bindings,now=Date.now()}) {
  if (!Array.isArray(bindings)) return null;
  const tasks = new Map((records??[]).filter(record=>record.record_type==='task').map(task=>[task.id,task]));
  const links = new Map(), attempted = new Set(), readings = new Map();
  for (const binding of bindings) {
    const task=tasks.get(binding.task_id);
    if (!task) continue;
    for (const id of binding.attempt_sessions) attempted.add(id);
    for (const link of binding.links) {
      const id=link.kind==='executor_session'&&linkedCodexSessionId(link.uri);
      if (!id||!link.revision) continue;
      if (!links.has(id)) links.set(id,new Map());
      const associated=links.get(id);
      if (!associated.has(task.id)) associated.set(task.id,new Set());
      associated.get(task.id).add(link.revision);
    }
  }
  for (const event of uniqueEngineeringEvents(events??[]).items) {
    const id=event.session_id, associated=links.get(id);
    if (attempted.has(id)||associated?.size!==1||!associated.get(event.task_id)?.has(event.revision)||
        tasks.get(event.task_id)?.repository!==event.repository||event.kind!=='measurement'||event.attempt_id||
        !(Date.parse(event.occurred_at)<=now)) continue;
    const observed=dedicatedReading(event);
    if (!observed) continue;
    if (!readings.has(id)) readings.set(id,[]);
    readings.get(id).push({observed,at:event.occurred_at,id:event.event_id});
  }
  const selected = [...readings.values()].map(latestDedicatedReading);
  const measured = selected.flatMap(({latest})=>latest?[latest.observed]:[]);
  return {
    observed:addObserved(measured),measured:measured.length,
    overlapping:[...links.keys()].filter(id=>attempted.has(id)).length,
    shared:[...links.values()].filter(associated=>associated.size>1).length,
    conflicting:selected.filter(item=>item.inconsistent).length,
    linked:links.size,
  };
}

export function taskUsageAccounting({ task, canonical, attempts = [], events = [], pricing = {}, now = Date.now() }) {
  const taskAttempts = attempts.filter(attempt => attempt.task_id === task.id &&
    (!attempt.repository || attempt.repository === task.repository));
  const eventData = uniqueEngineeringEvents(events.filter(event => event.task_id === task.id &&
    event.repository === task.repository && Date.parse(event.occurred_at) <= now));
  const attemptAccounting = accountEngineeringTokens({
    tasks:[task], attempts:taskAttempts.map(attempt => ({...attempt,repository:attempt.repository??task.repository})),
    events:eventData.items, days:[], cutoff:now, sourceConflicts:eventData.conflicts,
  });
  const rows = taskTokenRows(attemptAccounting,task.id,taskAttempts,eventData.items,task.repository);
  const sessions = new Map();
  const session = id => {
    if (!sessions.has(id)) sessions.set(id,{id,attemptIds:new Set(),revisions:new Set(),readings:[]});
    return sessions.get(id);
  };
  const attemptSessions = new Map();
  if (canonical?.task?.id === task.id) {
    for (const link of canonical.lifecycle?.links ?? []) {
      const id = link.kind === 'executor_session' && linkedCodexSessionId(link.uri);
      if (id && link.revision) session(id).revisions.add(link.revision);
    }
    for (const attempt of canonical.attempts ?? []) {
      const id = attempt.session_id ?? attempt.resume_session_id;
      if (!id) continue;
      session(id).attemptIds.add(attempt.id);
      attemptSessions.set(attempt.id,id);
    }
  }
  for (const event of eventData.items) {
    const scope = sessions.get(event.session_id);
    if (!scope || !scope.revisions.has(event.revision) ||
        event.kind !== 'measurement' || event.attempt_id) continue;
    const observed = dedicatedReading(event);
    if (observed) scope.readings.push({observed,at:event.occurred_at,id:event.event_id});
  }

  const cumulativeCounts = new Map();
  for (const row of rows) {
    const id = attemptSessions.get(row.attemptId);
    if (id && row.source === 'Codex App Server') cumulativeCounts.set(id,(cumulativeCounts.get(id)??0)+1);
  }
  const usable = rows.filter(row => row.source !== 'Codex App Server' ||
    (cumulativeCounts.get(attemptSessions.get(row.attemptId))??0) <= 1);

  const sessionRows = [...sessions.values()].map(({id,attemptIds,readings}) => {
    const conflict = (cumulativeCounts.get(id)??0) > 1;
    const linked = usable.filter(row => attemptIds.has(row.attemptId));
    const attemptObserved = addObserved(linked.map(row=>row.observed));
    if (conflict || attemptObserved.totalTokens!==null) {
      return {id,attemptIds:[...attemptIds],observed:attemptObserved,
        basis:conflict?'Conflicting cumulative receipts':'Linked attempt receipts'};
    }
    const {latest,inconsistent} = latestDedicatedReading(readings);
    return {id,attemptIds:[...attemptIds],observed:latest?.observed??attemptObserved, receiptId:latest?.id, observedAt:latest?.at,
      basis:inconsistent?'Conflicting cumulative receipts':latest?'Reported dedicated session snapshot':'Usage unavailable'};
  });

  const coverage = {
    attemptTotals:usable.filter(row=>row.observed.totalTokens!==null).length, attempts:taskAttempts.length,
    sessionTotals:sessionRows.filter(row=>row.observed.totalTokens!==null).length, sessions:sessionRows.length,
    conflicts:eventData.conflicts+sessionRows.filter(row=>row.basis==='Conflicting cumulative receipts').length,
  };
  return {rows,sessionRows,coverage,billing:'Unknown',referencePrice:estimateOpenAIReference(usable, pricing, now),
    progressRows:taskTokenProgress(task,taskAttempts,eventData.items,rows),observed:addObserved([
    ...usable.filter(row=>!attemptSessions.has(row.attemptId)).map(row=>row.observed),
    ...sessionRows.map(row=>row.observed),
  ]),desktop:desktopSessionTokens(task.id,eventData.items.filter(event=>!event.session_id)),
  scope:'Task totals count each linked session once. When a session has no attempt totals, a revision-linked dedicated receipt can supply its session total. Coverage may be partial, and cumulative input can include repeated context.'};
}
