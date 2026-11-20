const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const id = /^[A-Za-z0-9_.:-]{1,160}$/;
const digest = /^[a-f0-9]{64}$/;
const difficulties = new Set(['simple','moderate','complex']);

function attemptWindow(attempts, cutoff) {
  if (!attempts.length) return null;
  let first = Infinity, last = -Infinity;
  for (const attempt of attempts) {
    const start = Date.parse(attempt.started_at), finish = Date.parse(attempt.finished_at);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start || finish > cutoff) return null;
    first = Math.min(first, start);
    last = Math.max(last, finish);
  }
  return last - first;
}

function costForAttempt(record, measurements, cutoff) {
  const values = measurements
    .get(record.id)?.filter(entry => entry.task_id === record.task_id && entry.revision === record.revision &&
      entry.repository === record.repository && Date.parse(entry.observed_at) >= Date.parse(record.started_at) &&
      Date.parse(entry.observed_at) <= cutoff)
    .flatMap(entry => entry.measurements).filter(metric =>
      metric?.name === 'provider_cost_usd' && metric.availability === 'observed' &&
      ['usd','USD'].includes(metric.unit) && metric.method === 'attempt_total' &&
      typeof metric.source === 'string' && metric.source &&
      Number.isFinite(metric.value) && metric.value >= 0) ?? [];
  return values.length === 1 ? values[0].value : null;
}

function indexBy(items, field) {
  const index = new Map();
  for (const item of items) {
    const key = item[field];
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  }
  return index;
}

function verificationScope(task) {
  const profile = task?.acceptance?.profile_id;
  const criteria = task?.acceptance?.criteria;
  if (!profile || !Array.isArray(criteria) || !criteria.length ||
      criteria.some(criterion => typeof criterion?.id !== 'string' || !criterion.id)) return null;
  return JSON.stringify([profile, criteria.map(criterion => criterion.id).sort()]);
}

/**
 * Compare explicit workload pairs using authoritative records already in the projection.
 * @returns {import('./engineering-experiments.types.js').EngineeringExperiments}
 */
export function compareEngineeringExperiments({ pairs, tasks, attempts, telemetry, accounting, cutoff, conflicted }) {
  if (!Array.isArray(pairs) || pairs.length > 100) throw Error('Expected at most 100 experiment pairs');
  const taskById = new Map(tasks.map(task => [task.id,task]));
  const usageByTask = new Map(accounting.byTask.map(summary => [summary.taskId,summary]));
  const attemptsByTask = indexBy(attempts,'task_id');
  const costsByAttempt = indexBy(telemetry.filter(row => Array.isArray(row.measurements)), 'attempt_id');
  const seenPairs = new Set(), seenTasks = new Set();

  function summarize(task) {
    if (!task) return null;
    const rows = (attemptsByTask.get(task.id) ?? []).filter(attempt => attempt.repository === task.repository);
    const usage = usageByTask.get(task.id);
    const terminalHistory = rows.length > 0 && rows.length === usage?.attempts &&
      rows.every(attempt => terminal.has(attempt.state)) &&
      [...rows].sort((a,b) => a.attempt_number - b.attempt_number).every((attempt, index) => attempt.attempt_number === index + 1);
    const complete = terminalHistory && rows.length === usage.completeAttempts;
    const costs = rows.map(row => costForAttempt(row, costsByAttempt, cutoff));
    const cost = terminalHistory && costs.every(value => value !== null) ? costs.reduce((sum, value) => sum + value, 0) : null;
    return {
      taskId:task.id, state:task.state, verified:usage?.verified === true, attempts:rows.length,
      failedAttempts:rows.filter(attempt => attempt.state === 'failed').length,
      firstAttemptVerified:complete && usage.verified && rows.length === 1 && rows[0].state === 'succeeded',
      observedTokens:usage?.observed.totalTokens ?? null,
      totalTokens:complete && !conflicted ? usage.observed.totalTokens : null,
      costUsd:Number.isFinite(cost) && !conflicted ? cost : null,
      attemptWindowMs:attemptWindow(rows,cutoff),
    };
  }

  return {
    schemaVersion:1,
    pairs:pairs.map(pair => {
      const { id:pairId, baselineTaskId, candidateTaskId, workloadDigest, difficulty } = pair ?? {};
      if (![pairId,baselineTaskId,candidateTaskId].every(value => typeof value === 'string' && id.test(value)) ||
          typeof workloadDigest !== 'string' || !digest.test(workloadDigest) || !difficulties.has(difficulty)) throw Error('Invalid experiment pair identity');
      if (seenPairs.has(pairId) || seenTasks.has(baselineTaskId) || seenTasks.has(candidateTaskId) ||
          baselineTaskId === candidateTaskId) throw Error('Experiment pair or Task identity reused');
      seenPairs.add(pairId);
      seenTasks.add(baselineTaskId);
      seenTasks.add(candidateTaskId);

      const baseTask = taskById.get(baselineTaskId), candidateTask = taskById.get(candidateTaskId);
      const baseline = summarize(baseTask), candidate = summarize(candidateTask);
      const taskClass = baseTask?.classification?.primary ?? null;
      const scope = verificationScope(baseTask);
      const matched = scope && scope === verificationScope(candidateTask) && taskClass && baseTask?.repository && baseTask.repository === candidateTask?.repository &&
        baseTask.revision && baseTask.revision === candidateTask?.revision && taskClass === candidateTask?.classification?.primary;
      let status = 'incomplete';
      if (baseTask && candidateTask && !matched) status = 'unmatched';
      else if (matched && baseline.verified && candidate.state === 'failed' && !conflicted) status = 'quality_regression';
      else if (matched && baseline.verified && candidate.verified && baseline.totalTokens !== null && candidate.totalTokens !== null) status = 'measured';

      const delta = (a,b) => Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
      const measured = status === 'measured';
      return {
        id:pairId, baselineTaskId, candidateTaskId, workloadDigest, difficulty, taskClass, status, baseline, candidate,
        tokenReductionPercent:measured && baseline.totalTokens > 0 ?
          100 * (baseline.totalTokens - candidate.totalTokens) / baseline.totalTokens : null,
        attemptWindowDeltaMs:measured ? delta(baseline.attemptWindowMs,candidate.attemptWindowMs) : null,
        costDeltaUsd:measured ? delta(baseline.costUsd,candidate.costUsd) : null,
      };
    }),
  };
}
