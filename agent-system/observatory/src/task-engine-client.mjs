export async function taskEngineRequest(body, headers, { signal, fetcher = fetch } = {}) {
  const response = await fetcher('/api/task-engine/v1', {
    method: 'POST', cache: 'no-store', signal,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (body.op === 'list' && [404, 405].includes(response.status)) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw Object.assign(Error(data?.error ?? 'Task engine request failed (' + response.status + ')'), { status: response.status });
  }
  return data;
}

export function commandForTask(detail, action, operationId) {
  return {
    op: 'command', task_id: detail.task.id, expected_version: detail.version,
    operation_id: operationId, action,
  };
}

export function executionActions({ lifecycle, attempts = [] }, { publishedIntake = false } = {}) {
  const state = lifecycle.stored_state;
  const attemptsThisCycle = lifecycle.cycle_attempts ?? attempts.length;
  if (publishedIntake) return ['proposed', 'blocked'].includes(state) ? ['admit'] : [];
  const result = [];
  if (lifecycle.can_configure_execution===true) result.push('configure_execution');
  if (['proposed', 'blocked'].includes(state) && !lifecycle.executor) result.push('admit');
  if (['admitted', 'queued', 'scheduled', 'running'].includes(state)) result.push('pause');
  if (state === 'paused' && attemptsThisCycle < 3) result.push('resume');
  if (state === 'failed' && attemptsThisCycle > 0 && attemptsThisCycle < 3) result.push('retry');
  if (state === 'verifying') result.push('accept', 'reject');
  if (!['completed', 'failed', 'cancelled', 'superseded', 'archived', 'cancelling'].includes(state)) result.push('cancel');
  if (['completed','proposed','blocked','failed','cancelled','superseded'].includes(state)) result.push('archive');
  if (state === 'completed' || state === 'archived' && lifecycle.evidence?.length) result.unshift('reopen');
  return result;
}

export function reviewRevision(attempt) {
  return attempt?.candidate_revision ?? attempt?.revision ?? null;
}

export function taskTokenRows(accounting, id) {
  return accounting?.schemaVersion === 1 && Array.isArray(accounting.byAttempt)
    ? accounting.byAttempt.filter(row => row.taskId === id) : [];
}

export function desktopSessionTokens(taskId, events) {
  const names = new Set(['desktop_input_tokens','desktop_cached_input_tokens','desktop_uncached_input_tokens',
    'desktop_output_tokens','desktop_reasoning_output_tokens','desktop_total_tokens']);
  const latest = new Map();
  for (const event of events) {
    if (event.task_id !== taskId) continue;
    for (const metric of event.measurements ?? []) {
      if (!names.has(metric.name) || metric.source !== 'codex_desktop_session_usage' || metric.unit !== 'tokens' ||
          metric.availability !== 'observed' || !Number.isSafeInteger(metric.value) || metric.value < 0) continue;
      const previous = latest.get(metric.name);
      if (!previous || String(event.occurred_at ?? '') > previous.at) latest.set(metric.name, {name:metric.name,value:metric.value,at:String(event.occurred_at ?? '')});
    }
  }
  return [...latest.values()];
}
