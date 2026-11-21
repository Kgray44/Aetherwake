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

export function taskNextAction(detail, workerAccess) {
  const lifecycle = detail?.lifecycle;
  if (!lifecycle) return null;
  const { state, executor, blockers = [], start_at: startAt } = lifecycle;
  const action = (title, description, section, at) => ({title,description,section,at});
  const options = executionActions(detail);
  if (state === 'blocked' && blockers.length) return action('Resolve prerequisites',
    blockers.length + (blockers.length === 1 ? ' prerequisite is outstanding.' : ' prerequisites are outstanding.'), 'task-controls');
  if (state === 'scheduled') return action('Waiting for scheduled start', 'The Task is eligible for a worker claim at its scheduled start.', 'task-controls',
    Number.isFinite(startAt) ? new Date(startAt).toISOString() : undefined);
  if (['admitted','ready','queued'].includes(state) && executor) return workerAccess==='not_configured'
    ? action('Configure Codex worker access', 'A worker credential is required before a worker can claim this Task.', 'task-controls')
    : action('Waiting for worker claim', 'The Task is in the execution queue.', 'task-controls');
  if (state === 'verifying') return action('Review the candidate', 'Review the linked evidence and record the owner decision.', 'task-evidence');
  if (state === 'failed') return options.includes('retry')
    ? action('Review the failure before retrying', 'Inspect the latest attempt and record what changed before restarting execution.', 'task-attempts')
    : action('Inspect the latest attempt', 'The failure is recorded in the attempt history.', 'task-attempts');
  if (state === 'paused' && options.includes('resume')) return action('Resume when ready', 'The Task is paused and can be returned to the queue.', 'task-controls');
  if (options.includes('admit')) return action('Configure and admit the Task', 'Confirm its execution settings before submitting it to the queue.', 'task-controls');
  return null;
}

export function codexThreadHref(attempt) {
  const id = attempt?.session_id;
  return attempt?.executor==='codex'&&typeof id==='string'&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    ? 'codex://threads/'+id : null;
}

export function reviewRevision(attempt) {
  return attempt?.candidate_revision ?? attempt?.revision ?? null;
}

const appServerSource = 'codex_app_server_token_usage_updated';
const appServerMethods = new Set(['single_ephemeral_thread_total','fresh_thread_total']);
const progressMethods = new Set(['fresh_thread_progress']);

export function isAppServerUsageProgress(event) {
  return event.kind==='measurement'&&(event.measurements??[]).some(metric=>
    metric.source===appServerSource&&progressMethods.has(metric.method));
}

function appServerTokenRow(taskId, repository, attempt, events, progress = false) {
  if (attempt.resume_session_id) return null;
  const methods = progress ? progressMethods : appServerMethods;
  const receipts = events.filter(event => event.kind === 'measurement' && event.task_id === taskId &&
    event.attempt_id === attempt.id && event.revision === attempt.revision && event.repository === repository &&
    (event.session_id ? event.session_id === attempt.session_id : !progress) &&
    (event.measurements ?? []).some(metric => metric.source === appServerSource && methods.has(metric.method)));
  if (!receipts.length || (!progress && receipts.length!==1)) return null;
  if (progress) receipts.sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||
    a.event_id.localeCompare(b.event_id));
  const receipt=receipts[0];
  const tokens = (name, sample=receipt) => {
    const samples = sample.measurements.filter(metric => metric.name === 'provider_' + name + '_tokens' &&
      metric.source === appServerSource && methods.has(metric.method));
    const metric = samples.length === 1 ? samples[0] : null;
    return metric?.availability === 'observed' && metric.unit === 'tokens' &&
      Number.isSafeInteger(metric.value) && metric.value >= 0 ? metric.value : null;
  };
  const totalTokens = tokens('total'), inputTokens = tokens('input'), outputTokens = tokens('output');
  if (totalTokens == null || (inputTokens != null && outputTokens != null && inputTokens + outputTokens !== totalTokens)) return null;
  const cached = tokens('cached_input'), reasoning = tokens('reasoning_output');
  const cachedInputTokens = cached != null && inputTokens != null && cached > inputTokens ? null : cached;
  const reasoningOutputTokens = reasoning != null && outputTokens != null && reasoning > outputTokens ? null : reasoning;
  let pace;
  if (progress && inputTokens != null) {
    const windows = [...new Map(receipts.map(sample=>[sample.event_id,sample])).values()].slice(0,3);
    const samples = windows.map(sample=>({
      at:Date.parse(sample.occurred_at), input:tokens('input',sample),
    }));
    const elapsedMs = samples[0].at - samples[1]?.at;
    const added = inputTokens - samples[1]?.input;
    if (elapsedMs > 0 && samples[1]?.input != null && added >= 0) {
      const sustained = samples.length===3 && samples[2].input!=null &&
        samples[1].at>samples[2].at && added>0 && samples[1].input>samples[2].input;
      pace = {inputPerMinute:added*60_000/elapsedMs, elapsedMs, sustained};
    }
  }
  return {
    taskId, attemptId:attempt.id, revision:attempt.revision, attemptNumber:attempt.attempt_number,
    provider:attempt.execution_identity?.provider ?? attempt.provider ?? attempt.executor ?? 'codex',
    model:attempt.execution_identity?.model ?? attempt.model, identitySource:attempt.execution_identity?.source, state:attempt.state,
    coverage:progress?'in-progress':'observed', source:'Codex App Server', receiptId:receipt.event_id,
    ...(progress?{observedAt:receipt.occurred_at,...(pace?{pace}:{})}:{}),
    observed:{ totalTokens,inputTokens,outputTokens,cachedInputTokens,reasoningOutputTokens,
      cacheWriteInputTokens:tokens('cache_write_input'),
      uncachedInputTokens:inputTokens != null && cachedInputTokens != null ? inputTokens - cachedInputTokens : null, turns:progress?null:1 },
  };
}

export function taskTokenProgress(task, attempts, events, finalRows) {
  const finalized = new Set(finalRows.filter(row=>row.observed.totalTokens!=null).map(row=>row.attemptId));
  return attempts.flatMap(attempt=>{
    if (finalized.has(attempt.id)) return [];
    const row=appServerTokenRow(task.id,task.repository,attempt,events,true);
    return row?[row]:[];
  });
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
