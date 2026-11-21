import { estimateOpenAIReference } from './openai-pricing.mjs';

function elapsed(from, to) {
  const duration = Date.parse(to) - Date.parse(from);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function integrationLogFact(fact) {
  if (fact.kind === 'source_location') return [fact.path,fact.line,fact.column].filter(Boolean).join(':');
  if (fact.kind === 'exit_code') return 'Exit code ' + fact.code;
  if (fact.kind === 'test_ordinal') return 'Failing TAP test ' + fact.code;
  return fact.code;
}

export function integrationWorkflowTiming(run) {
  const revisions = new Set([run.head_sha, ...(run.source_repairs ?? []).map(repair=>repair.head_sha)]);
  return (run.workflow_history ?? run.evidence?.workflows ?? [])
    .filter(workflow => revisions.has(workflow.head_sha))
    .map(workflow => ({
      ...workflow,
      queueMs: workflow.attempt === 1 ? elapsed(workflow.created_at, workflow.run_started_at) : null,
      wallMs: workflow.status === 'completed' ? elapsed(workflow.run_started_at, workflow.updated_at) : null,
    }));
}

export function integrationMilestones(run) {
  const acceptedAt = run.task?.accepted_at ?? null;
  const prCreatedAt = run.evidence?.pr_created_at ?? null;
  const mergedAt = run.evidence?.merged_at ?? null;
  return { acceptedAt, prCreatedAt, mergedAt, acceptanceToPrMs: elapsed(acceptedAt, prCreatedAt),
    prToMergeMs: elapsed(prCreatedAt, mergedAt) };
}

export function integrationAnalytics(runs) {
  const workflows = new Map();
  const repairs = new Set();
  const observedTurns = new Map();
  for (const run of runs) for (const workflow of integrationWorkflowTiming(run)) {
    workflows.set([run.repository, workflow.run_id, workflow.attempt, workflow.head_sha].join(':'), workflow);
  }
  for (const run of runs) for (const repair of run.source_repairs ?? []) {
    repairs.add(repair.id);
    if (!repair.usage || !repair.session_id || !repair.turn_id) continue;
    const key = [repair.session_id, repair.turn_id].join(':');
    const previous = observedTurns.get(key);
    if (!previous || (!previous.complete && repair.usage.complete) ||
        (previous.complete === repair.usage.complete && repair.usage.total_tokens > previous.total_tokens)) {
      observedTurns.set(key, repair.usage);
    }
  }
  const usage = [...observedTurns.values()];
  return {
    runs: runs.length,
    merged: runs.filter(run => ['merged', 'deployed'].includes(run.state) && run.evidence?.merged_sha).length,
    blocked: runs.filter(run => run.state === 'blocked').length,
    ciAttempts: workflows.size,
    reruns: new Set(runs.flatMap(run => (run.repair_attempts ?? []).map(attempt => attempt.id))).size,
    automaticReruns: new Set(runs.flatMap(run => (run.repair_attempts ?? [])
      .filter(attempt=>attempt.authorization_id).map(attempt=>attempt.id))).size,
    sourceRepairs: repairs.size,
    repairUsage: usage.length ? {
      uncached: usage.reduce((sum, row) => sum + row.input_tokens - row.cached_input_tokens, 0),
      cached: usage.reduce((sum, row) => sum + row.cached_input_tokens, 0),
      output: usage.reduce((sum, row) => sum + row.output_tokens, 0),
      completeTurns: usage.filter(row => row.complete).length,
    } : null,
  };
}
export function integrationRepairPricing(runs, pricing = {}, now = Date.now()) {
  const turns = new Map();
  for (const run of runs) for (const repair of run.source_repairs ?? []) {
    if (!repair.usage?.complete || !repair.session_id || !repair.turn_id) continue;
    turns.set(repair.session_id + ':' + repair.turn_id, {
      attemptId:repair.id, ...repair.execution_identity,
      observed:{ inputTokens:repair.usage.input_tokens, cachedInputTokens:repair.usage.cached_input_tokens,
        outputTokens:repair.usage.output_tokens, totalTokens:repair.usage.total_tokens,
        cacheWriteInputTokens:repair.usage.cache_write_input_tokens },
    });
  }
  return estimateOpenAIReference([...turns.values()], pricing, now);
}
