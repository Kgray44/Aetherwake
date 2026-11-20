const changingStates=new Set(['admitted','queued','scheduled','running','pausing','cancelling','verifying']);

export function hasLiveTaskWork(tasks) {
  return tasks.some(task=>changingStates.has(task.lifecycle?.stored_state??task.lifecycle?.state));
}

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

const appServerSource = 'codex_app_server_token_usage_updated';
const appServerMethod = 'single_ephemeral_thread_total';

function appServerTokenRow(taskId, repository, attempt, events) {
  const receipts = events.filter(event => event.kind === 'measurement' && event.task_id === taskId &&
    event.attempt_id === attempt.id && event.revision === attempt.revision && event.repository === repository &&
    (event.measurements ?? []).some(metric => metric.source === appServerSource && metric.method === appServerMethod));
  if (receipts.length !== 1) return null;
  const tokens = name => {
    const samples = receipts[0].measurements.filter(metric => metric.name === 'provider_' + name + '_tokens' &&
      metric.source === appServerSource && metric.method === appServerMethod);
    const metric = samples.length === 1 ? samples[0] : null;
    return metric?.availability === 'observed' && metric.unit === 'tokens' &&
      Number.isSafeInteger(metric.value) && metric.value >= 0 ? metric.value : null;
  };
  const totalTokens = tokens('total'), inputTokens = tokens('input'), outputTokens = tokens('output');
  if (totalTokens == null || (inputTokens != null && outputTokens != null && inputTokens + outputTokens !== totalTokens)) return null;
  const cached = tokens('cached_input'), reasoning = tokens('reasoning_output');
  const cachedInputTokens = cached != null && inputTokens != null && cached > inputTokens ? null : cached;
  const reasoningOutputTokens = reasoning != null && outputTokens != null && reasoning > outputTokens ? null : reasoning;
  return {
    taskId, attemptId:attempt.id, revision:attempt.revision, attemptNumber:attempt.attempt_number,
    provider:attempt.provider ?? attempt.executor ?? 'codex', model:attempt.model, state:attempt.state,
    coverage:'observed', source:'Codex App Server',
    observed:{ totalTokens,inputTokens,outputTokens,cachedInputTokens,reasoningOutputTokens,
      cacheWriteInputTokens:tokens('cache_write_input'),
      uncachedInputTokens:inputTokens != null && cachedInputTokens != null ? inputTokens - cachedInputTokens : null, turns:1 },
  };
}

export function taskTokenRows(accounting, id, attempts = [], events = [], repository) {
  const rows = accounting?.schemaVersion === 1 && Array.isArray(accounting.byAttempt)
    ? accounting.byAttempt.filter(row => row.taskId === id) : [];
  if (!repository || !events.length) return rows;
  const byAttempt = new Map(rows.map(row => [row.attemptId + ':' + row.revision, row]));
  for (const attempt of attempts) {
    if (attempt.task_id !== id) continue;
    const key = attempt.id + ':' + attempt.revision;
    const previous = byAttempt.get(key);
    // The two providers can report the same usage. Prefer the qualified CLI
    // receipt when complete, or use the single scoped App Server total.
    if (previous?.coverage === 'complete' && previous.observed.totalTokens != null) continue;
    const current = appServerTokenRow(id, repository, attempt, events);
    if (current) byAttempt.set(key, current);
  }
  return [...byAttempt.values()].sort((a,b) => (a.attemptNumber ?? 0) - (b.attemptNumber ?? 0));
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
