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

export function executionActions({ lifecycle, attempts = [] }) {
  const state = lifecycle.stored_state;
  const result = [];
  if (['proposed', 'blocked'].includes(state) && !lifecycle.executor) result.push('admit');
  if (['admitted', 'queued', 'scheduled', 'running'].includes(state)) result.push('pause');
  if (state === 'paused' && attempts.length < 3) result.push('resume');
  if (state === 'failed' && attempts.length > 0 && attempts.length < 3) result.push('retry');
  if (state === 'verifying') result.push('accept', 'reject');
  if (!['completed', 'failed', 'cancelled', 'superseded', 'archived', 'cancelling'].includes(state)) result.push('cancel');
  return result;
}

export function taskTokenRows(accounting, id) {
  return accounting?.schemaVersion === 1 && Array.isArray(accounting.byAttempt)
    ? accounting.byAttempt.filter(row => row.taskId === id) : [];
}
