const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const terminalOutcomes = new Map([['completed','completed'],['failed','failed'],['interrupted','inconclusive']]);
export const codexHistorySource = 'codex_app_server_persisted_history';
export const codexHistoryMetrics = new Set([
  'codex_turn_started_unix_seconds','codex_turn_user_messages','codex_turn_assistant_messages',
  'codex_turn_tool_items','codex_turn_file_change_items','codex_turn_item_page_partial',
]);

export function linkedCodexThread(attempts, threadId) {
  return uuid.test(threadId) && attempts.some(attempt => attempt.session_id === threadId);
}

export function independentCodexTurn(task, attempts, threadId, started, completed) {
  if (!linkedCodexThread(attempts,threadId) ||
      !Number.isFinite(started) || !Number.isFinite(completed) ||
      !Number.isFinite(Date.parse(task.created_at)) || started < Date.parse(task.created_at) || completed < started) return false;
  return attempts.every(attempt => {
    if (attempt.session_id !== threadId && attempt.resume_session_id !== threadId) return true;
    const begin = Date.parse(attempt.started_at);
    const end = Date.parse(attempt.finished_at);
    // History timestamps have second precision. Exclude boundary collisions
    // and any interval whose managed ownership cannot be resolved.
    return Number.isFinite(begin) && (completed + 999 < begin || Number.isFinite(end) && started > end);
  });
}

export function codexTurnObservation(task, attempts, threadId, turn, items, partial, operationId) {
  const outcome = terminalOutcomes.get(turn.status);
  if (!uuid.test(turn.id) || !outcome || !Number.isSafeInteger(turn.startedAt) ||
      !Number.isSafeInteger(turn.completedAt) ||
      !independentCodexTurn(task,attempts,threadId,turn.startedAt*1000,turn.completedAt*1000)) return null;
  const counts = {
    codex_turn_started_unix_seconds:turn.startedAt,
    codex_turn_user_messages:0, codex_turn_assistant_messages:0, codex_turn_tool_items:0,
    codex_turn_file_change_items:0, codex_turn_item_page_partial:Number(partial),
  };
  for (const { item } of items) {
    if (item?.type === 'userMessage') counts.codex_turn_user_messages++;
    if (item?.type === 'agentMessage') counts.codex_turn_assistant_messages++;
    if (['commandExecution','mcpToolCall','dynamicToolCall','webSearch'].includes(item?.type)) counts.codex_turn_tool_items++;
    if (item?.type === 'fileChange') counts.codex_turn_file_change_items++;
  }
  return {
    trace_version:1,event_id:'codex-turn:'+threadId+':'+turn.id,task_id:task.id,session_id:threadId,
    trace_id:'codex-history:'+threadId,span_id:turn.id,repository:task.repository,revision:task.revision,
    occurred_at:new Date(turn.completedAt*1000).toISOString(),kind:'engineering_activity',phase:'other',
    activity:{kind:'codex_turn',source:'codex',operation_id:operationId,outcome},
    measurements:Object.entries(counts).map(([name,value])=>({
      name,value,availability:'observed',source:codexHistorySource,
      unit:name.endsWith('_seconds')?'seconds':name.endsWith('_partial')?'boolean':'count',
    })),
  };
}
