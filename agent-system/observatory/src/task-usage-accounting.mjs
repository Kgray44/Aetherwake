import { linkedCodexSessionId } from './task-activity.mjs';
import { accountEngineeringTokens } from './engineering-token-accounting.mjs';
import { uniqueEngineeringEvents } from './engineering-analytics.mjs';
import { desktopSessionTokens, taskTokenRows } from './task-engine-client.mjs';

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

export function taskUsageAccounting({ task, canonical, attempts = [], events = [], now = Date.now() }) {
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
    if (!scope || scope.attemptIds.size || !scope.revisions.has(event.revision) ||
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
    if (attemptIds.size) {
      const linked = usable.filter(row => attemptIds.has(row.attemptId));
      return {id,attemptIds:[...attemptIds],observed:addObserved(linked.map(row=>row.observed)),
        basis:conflict?'Conflicting cumulative receipts':'Linked attempt receipts'};
    }
    readings.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
    const inconsistent = readings.some((item,index) => {
      const prior = readings[index-1];
      return prior && (item.observed.totalTokens < prior.observed.totalTokens ||
        Date.parse(item.at)===Date.parse(prior.at) && JSON.stringify(item.observed)!==JSON.stringify(prior.observed));
    });
    const latest = inconsistent ? null : readings.at(-1);
    return {id,attemptIds:[],observed:latest?.observed??addObserved([]), receiptId:latest?.id, observedAt:latest?.at,
      basis:inconsistent?'Conflicting cumulative receipts':latest?'Reported dedicated session snapshot':'Usage unavailable'};
  });

  const external = sessionRows.filter(row => row.receiptId);
  const coverage = {
    attemptTotals:usable.filter(row=>row.observed.totalTokens!==null).length, attempts:taskAttempts.length,
    sessionTotals:sessionRows.filter(row=>row.observed.totalTokens!==null).length, sessions:sessionRows.length,
    conflicts:eventData.conflicts+sessionRows.filter(row=>row.basis==='Conflicting cumulative receipts').length,
  };
  return {rows,sessionRows,coverage,billing:'Unknown',observed:addObserved([
    ...usable.map(row=>row.observed), ...external.map(row=>row.observed),
  ]),desktop:desktopSessionTokens(task.id,eventData.items.filter(event=>!event.session_id)),
  scope:'Counts include available attempt receipts and reported dedicated session totals. Session views of attempt receipts are counted once. Coverage may be partial, and cumulative input can include repeated context.'};
}
