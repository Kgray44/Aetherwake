import { taskTokenProgress, taskTokenRows } from './task-engine-client.mjs';

const TURN_SOURCE = 'codex_exec_json_turn_completed';
const STREAM_SOURCE = 'codex_exec_jsonl';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const DAY_MS = 86_400_000;

function metric(event, name, source, unit) {
  const rows = Array.isArray(event.measurements) ? event.measurements.filter(row => row?.name === name && row.source === source) : [];
  const row = rows.length === 1 ? rows[0] : null;
  return row?.availability === 'observed' && row.unit === unit &&
    Number.isSafeInteger(row.value) && row.value >= 0 ? row.value : null;
}

function readTurn(event) {
  const tokens = suffix => metric(event, 'provider_' + suffix, TURN_SOURCE, 'tokens');
  const inputTokens = tokens('input_tokens');
  const outputTokens = tokens('output_tokens');
  const cached = tokens('cached_input_tokens');
  const reasoning = tokens('reasoning_output_tokens');
  const cachedInputTokens = inputTokens !== null && cached > inputTokens ? null : cached;
  const reasoningOutputTokens = outputTokens !== null && reasoning > outputTokens ? null : reasoning;
  const total = inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
  return {
    inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens,
    cacheWriteInputTokens:tokens('cache_write_input_tokens'),
    uncachedInputTokens:inputTokens !== null && cachedInputTokens !== null ? inputTokens - cachedInputTokens : null,
    totalTokens:Number.isSafeInteger(total) ? total : null,
  };
}

function observed(turns) {
  const totals = Object.fromEntries(Object.keys(readTurn({})).map(key => [key, null]));
  const samples = Object.fromEntries(Object.keys(totals).map(key => [key, 0]));
  for (const turn of turns) {
    for (const [key, value] of Object.entries(turn)) {
      if (value == null || !Object.hasOwn(totals,key)) continue;
      // Keep intermediate sums exact. An overflowing field remains unavailable.
      if (samples[key] === 0) totals[key] = 0n;
      totals[key] += BigInt(value);
      samples[key]++;
    }
  }
  for (const [key, value] of Object.entries(totals)) {
    totals[key] = value !== null && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  return {...totals, turns:turns.length, samples};
}

function group(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return map.get(key);
}

export function accountLoadedAttemptReceipts({tasks,attempts,events,cutoff,turnAccounting}) {
  const scopes = new Map(tasks.map(task=>[task.id,{task,attempts:[],events:[],rows:[]}]));
  for (const attempt of attempts) scopes.get(attempt.task_id)?.attempts.push(attempt);
  for (const event of events) {
    if (event.kind==='measurement'&&Date.parse(event.occurred_at)<=cutoff) {
      scopes.get(event.task_id)?.events.push(event);
    }
  }
  for (const row of turnAccounting.byAttempt) scopes.get(row.taskId)?.rows.push(row);
  const byTask = [...scopes.values()].map(({task,attempts,events,rows})=>{
    const final = taskTokenRows({schemaVersion:1,byAttempt:rows},task.id,attempts,events,task.repository);
    const progress = taskTokenProgress(task,attempts,events,final);
    const progressByAttempt = new Map(progress.map(row=>[row.attemptId,row]));
    // Failed/interrupted fresh turns may have only a cumulative lower bound.
    // Replace an empty row with its latest progress; never add it to a final.
    const observedRows = final.map(row=>row.observed.totalTokens===null ? progressByAttempt.get(row.attemptId)??row : row);
    return {taskId:task.id,rows:final,observedRows};
  });
  const summarize = (rows, includePartial = false) => {
    const measured = includePartial ? rows : rows.filter(row=>['complete','observed'].includes(row.coverage));
    const {turns,samples,...tokens}=observed(measured.map(row=>row.observed));
    return {tokens,attemptsWithTotals:measured.filter(row=>row.observed.totalTokens!=null).length,
      attempts:rows.length,appServerReceipts:measured.filter(row=>row.source==='Codex App Server').length};
  };
  return {totals:summarize(byTask.flatMap(task=>task.rows)),
    observed:summarize(byTask.flatMap(task=>task.observedRows),true),
    byTask:byTask.map(({taskId,rows,observedRows})=>({taskId,rows,totals:summarize(rows),
      observedRows,observed:summarize(observedRows,true)})),billing:'Unknown'};
}

function completeStream({starts, ends, turns}) {
  if (starts.length !== 1 || ends.length !== 1 || turns.length === 0) return false;
  const end = ends[0];
  return end.at >= starts[0] && turns.every(turn => turn.at >= starts[0] && turn.values.totalTokens !== null) &&
    metric(end.event, 'provider_core_usage_complete', STREAM_SOURCE, 'boolean') === 1 &&
    metric(end.event, 'provider_usage_recorded_turn_count', STREAM_SOURCE, 'count') === turns.length;
}

/**
 * Account for durable per-turn receipts. Input and output are additive.
 * Cached input and reasoning output are subsets. The legacy generic metric
 * summary still exposes other producers separately from this source.
 */
/** @returns {import('./engineering-token-accounting.types.js').EngineeringTokenAccounting} */
export function accountEngineeringTokens({ tasks, attempts, events, days, cutoff, sourceConflicts }) {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const attemptById = new Map(attempts.map(attempt => [attempt.id, attempt]));
  const streamGroups = new Map();
  let unattributedTurns = 0;
  for (const event of events) {
    const at = Date.parse(event.occurred_at);
    if (!Number.isFinite(at) || at > cutoff) continue;
    const isTurn = event.kind === 'measurement' && Array.isArray(event.measurements) && event.measurements.some(row => row?.source === TURN_SOURCE);
    const attempt = attemptById.get(event.attempt_id);
    const task = taskById.get(event.task_id);
    if (!task || !attempt || attempt.task_id !== task.id || attempt.revision !== event.revision ||
        attempt.repository !== event.repository || task.repository !== event.repository) {
      if (isTurn) unattributedTurns++;
      continue;
    }
    const streams = group(streamGroups, attempt.id, () => new Map());
    const key = JSON.stringify([event.trace_id, event.span_id, event.phase, event.parent_span_id]);
    const span = group(streams, key, () => ({ starts:[], ends:[], turns:[] }));
    if (event.kind === 'span_start') {
      span.starts.push(at);
      span.requested ||= metric(event, 'provider_stream_requested', STREAM_SOURCE, 'boolean') === 1;
    }
    if (event.kind === 'span_end') span.ends.push({at,event});
    if (isTurn) span.turns.push({at,values:readTurn(event)});
  }

  const allTurns = [], taskGroups = new Map(), modelGroups = new Map(), dayGroups = new Map();
  const byAttempt = attempts.filter(attempt => taskById.has(attempt.task_id)).map(attempt => {
    const streams = [...(streamGroups.get(attempt.id)?.values() ?? [])].filter(span =>
      span.requested || span.turns.length || span.ends.some(({event}) =>
        Array.isArray(event.measurements) && event.measurements.some(row => row?.source === STREAM_SOURCE)));
    const turns = streams.flatMap(span => span.turns);
    const values = turns.map(turn => turn.values);
    const coverage = streams.length === 0 ? 'unavailable' :
      TERMINAL.has(attempt.state) && streams.every(completeStream) ? 'complete' : 'partial';
    allTurns.push(...values);
    for (const turn of turns) group(dayGroups, Math.floor(turn.at / DAY_MS), () => []).push(turn.values);
    const task = group(taskGroups, attempt.task_id, () => ({ attempts:0, completeAttempts:0, values:[] }));
    task.attempts++;
    if (coverage === 'complete') task.completeAttempts++;
    task.values.push(...values);
    const provider = attempt.provider ?? null, model = attempt.model ?? null;
    const modelGroup = group(modelGroups, JSON.stringify([provider, model]), () => ({provider,model,attempts:0,values:[]}));
    modelGroup.attempts++;
    modelGroup.values.push(...values);
    return {
      taskId:attempt.task_id, attemptId:attempt.id, revision:attempt.revision,
      attemptNumber:attempt.attempt_number ?? null, provider, model, state:attempt.state, coverage, observed:observed(values),
    };
  });
  const classGroups = new Map();
  const byTask = tasks.map(task => {
    const { attempts = 0, completeAttempts = 0, values = [] } = taskGroups.get(task.id) ?? {};
    const taskClass = task.classification?.primary ?? null;
    const verified = task.state === 'accepted' && ['accepted', 'not_required'].includes(task.owner_acceptance);
    if (attempts || verified) {
      const cohort = group(classGroups, taskClass, () => ({
        taskClass, tasks:0, verifiedTasks:0, attempts:0, completeAttempts:0, missingAttemptTasks:0, values:[]
      }));
      cohort.tasks++;
      cohort.verifiedTasks += Number(verified);
      cohort.attempts += attempts;
      cohort.completeAttempts += completeAttempts;
      cohort.missingAttemptTasks += Number(!attempts);
      cohort.values.push(...values);
    }
    return { taskId:task.id, taskClass, attempts, completeAttempts, verified, observed:observed(values) };
  });
  return {
    schemaVersion:1, observed:observed(allTurns), unattributedTurns, byAttempt, byTask,
    byClass:[...classGroups.values()].map(({values, ...row}) => {
      const usage = observed(values);
      const complete = row.attempts === row.completeAttempts && row.missingAttemptTasks === 0 && unattributedTurns === 0 && sourceConflicts === 0;
      const comparable = complete && row.verifiedTasks > 0 && usage.totalTokens !== null;
      return {
        ...row, observed:usage,
        tokensPerVerifiedTask:comparable ? usage.totalTokens / row.verifiedTasks : null,
        verifiedTasksPerMillionTokens:comparable && usage.totalTokens > 0 ? row.verifiedTasks * 1e6 / usage.totalTokens : null,
      };
    }),
    byModel:[...modelGroups.values()].map(({values, ...row}) => ({ ...row, observed:observed(values) })),
    daily:days.map(({date}) => ({ date, observed:observed(dayGroups.get(Math.floor(Date.parse(date) / DAY_MS)) ?? []) })),
  };
}
