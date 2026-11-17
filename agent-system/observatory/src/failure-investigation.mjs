import { traceTimeline } from './trace-timeline.mjs';

const FAILURES = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const FEED_STATES = new Set(['available', 'partial', 'stale']);
const RESOURCE_NAMES = new Set([
  'child_cpu_ms', 'child_sampled_cpu_ms', 'child_peak_rss_bytes', 'child_sampled_peak_rss_bytes',
  'child_observed_high_water_rss_bytes', 'child_disk_read_bytes', 'child_disk_write_bytes',
  'child_sampled_disk_read_bytes', 'child_sampled_disk_write_bytes', 'gpu_memory_bytes', 'frame_time_ms',
]);
const REVISION = /^[a-f0-9]{40}$/i;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const id = value => Number.isSafeInteger(value) && value > 0;
const elapsed = (start, end) => time(end) >= time(start) ? time(end) - time(start) : null;
const revisionOf = run => run.head?.sha ?? run.revision;
const branchOf = run => run.head?.ref ?? run.branch;
const outcome = run => run.status === 'completed' ? run.conclusion : null;
const numberOf = pull => typeof pull === 'number' ? pull : pull?.number;

export const failedRun = run => FAILURES.has(outcome(run ?? {}));
export const failedAttempts = (task, records) => task ? attemptsForTask(task, records)
  .filter(attempt => attempt.state === 'failed').sort(attemptOrder) : [];

function attemptOrder(a, b) {
  return (time(b.finished_at) - time(a.finished_at)) || b.attempt_number - a.attempt_number;
}

function attemptsForTask(task, records) {
  return records.filter(attempt => attempt.record_type === 'attempt' && attempt.repository === task.repository &&
    attempt.task_id === task.id && REVISION.test(attempt.revision));
}

function sharedBranch(current, other) {
  if (!branchOf(current) || branchOf(current) !== branchOf(other) ||
      !current.event || current.event !== other.event) return false;
  if (id(current.head_repository_id) && id(other.head_repository_id)) {
    return current.head_repository_id === other.head_repository_id;
  }
  // In old cached projections a PR branch might come from any fork. A shared
  // PR number still gives an explicit identity; branch names alone do not.
  if (current.event.startsWith('pull_request')) {
    const numbers = new Set((current.pull_requests ?? []).map(numberOf));
    return (other.pull_requests ?? []).some(pr => id(numberOf(pr)) && numbers.has(numberOf(pr)));
  }
  return true;
}

export function selectRunHistory(run, feed) {
  if (!failedRun(run) || !id(run.workflow_id) || !FEED_STATES.has(feed?.status)) {
    return { passing: null, recentFailures: [], observedAt: feed?.observed_at ?? null, status: feed?.status ?? 'unavailable' };
  }
  const targetStart = time(run.started_at ?? run.created_at);
  const candidates = (feed.items ?? []).filter(row => id(row.id) && row.id !== run.id &&
    row.workflow_id === run.workflow_id && sharedBranch(run, row) && REVISION.test(revisionOf(row)) &&
    time(row.created_at) < time(run.created_at) && time(row.updated_at) <= targetStart);
  const counts = new Map();
  for (const row of candidates) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const ordered = candidates.filter(row => counts.get(row.id) === 1)
    .sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id);
  const recentFailures = ordered.filter(row => outcome(row) === outcome(run));
  return { passing: ordered.find(row => outcome(row) === 'success') ?? null,
    recentFailures, observedAt: feed.observed_at ?? null, status: feed.status };
}

export function selectPulls(revision, github, associated = []) {
  if (!REVISION.test(revision)) return [];
  const candidates = new Map();
  for (const pull of associated ?? []) {
    // Numeric associations are already pinned to the exact head by the
    // GitHub detail projector.
    if (id(pull)) candidates.set(pull, { number: pull });
    else if (id(pull?.number) && pull.head?.sha === revision) candidates.set(pull.number, pull);
  }
  if (FEED_STATES.has(github?.pulls?.status)) {
    for (const pull of github.pulls.items ?? []) {
      if (id(pull.number) && (pull.revision === revision || pull.merge_commit_sha === revision)) candidates.set(pull.number, pull);
    }
  }
  return [...candidates.values()].slice(0, 4);
}

function matchingRunDetail(detail, target, conclusion) {
  return target && detail?.kind === 'run' && detail.id === target.id && detail.attempt === target.attempt &&
    detail.workflow_id === target.workflow_id && sharedBranch(detail, target) && revisionOf(detail) === revisionOf(target) &&
    outcome(detail) === conclusion;
}

function failingJobs(run, passing, repeat) {
  return (run.jobs ?? []).filter(job => failedRun(job)).map(job => {
    const named = (candidate, name) => {
      const rows = (candidate?.jobs ?? []).filter(row => row.name === name);
      // Matrix duplicates and a truncated candidate can make name equality
      // ambiguous. Never turn them into comparisons.
      if (name && rows.length === 1 && !candidate.jobs_truncated && !candidate.jobs_stale) return rows[0];
    };
    const anchor = named(run, job.name);
    const baseline = anchor ? named(passing, job.name) : null;
    const preceding = anchor ? named(repeat, job.name) : null;
    return {
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      elapsedMs: elapsed(job.started_at, job.completed_at),
      passingElapsedMs: baseline && outcome(baseline) === 'success'
        ? elapsed(baseline.started_at, baseline.completed_at) : null,
      repeated: Boolean(preceding && outcome(preceding) === outcome(job)),
      steps: (job.steps ?? []).filter(step => failedRun(step)).map(step => [step.number, step.name]),
      stepsTruncated: job.steps_truncated,
    };
  });
}

function sourceForAttempt(attempt, records, events) {
  const applies = item => item.repository === attempt.repository && item.task_id === attempt.task_id &&
    item.attempt_id === attempt.id && item.revision === attempt.revision;
  const trace = events.filter(applies);
  const { spans, phases, incomplete, coveredMs } = traceTimeline(trace);
  const failedPhases = new Set(spans.filter(span => span.outcome === 'failed').map(span => span.phase));
  // Lifecycle phase is sometimes "other"; preserve the observation but do
  // not use it to infer a repeated operation.
  const failures = spans.filter(span => span.complete && span.outcome === 'failed');
  const evidence = records.filter(row => row.record_type === 'evidence' && applies(row) && row.synthetic !== true);
  const resources = new Map();
  const telemetry = records.filter(row => row.record_type === 'telemetry' && applies(row));
  for (const row of [...trace, ...telemetry]) {
    for (const metric of row.measurements ?? []) {
      if (!RESOURCE_NAMES.has(metric.name) || metric.availability !== 'observed' ||
          !Number.isFinite(metric.value) || metric.value < 0 || !metric.source || !metric.method || !metric.unit) continue;
      const key = JSON.stringify([row.phase, metric.name, metric.source, metric.method, metric.unit]);
      const observation = { ...metric, phase: row.phase, observedAt: row.occurred_at ?? row.observed_at,
        origin: row.event_id ? 'Trace' : 'Telemetry', observation: row.event_id ?? row.id };
      const previous = resources.get(key);
      // Present latest sample, never a sum or an inferred peak.
      if (!previous || time(observation.observedAt) > time(previous.observedAt)) resources.set(key, observation);
    }
  }
  return { phases, failedPhases, failures, evidence, resources, incomplete, coveredMs };
}

export function investigateAttempt({ task, attempt, records, events, github }) {
  if (!attempt || !task || !failedAttempts(task, records).includes(attempt)) return null;
  const source = sourceForAttempt(attempt, records, events);
  const earlier = attemptsForTask(task, records).filter(row => row.id !== attempt.id &&
    time(row.finished_at) <= time(attempt.started_at) && row.attempt_number < attempt.attempt_number).sort(attemptOrder);
  const passing = earlier.find(row => row.state === 'succeeded') ?? null;
  const usableCategory = attempt.failure_category && !['none', 'unknown'].includes(attempt.failure_category);
  const repeats = earlier.filter(row => row.state === 'failed' && usableCategory && row.failure_category === attempt.failure_category);
  const failedCriteria = source.evidence.filter(row => row.result === 'failed');
  const passingSource = passing ? sourceForAttempt(passing, records, events) : null;
  const comparativeEvidence = passingSource?.evidence.filter(row => row.result === 'passed' &&
    failedCriteria.some(failure => failure.criterion_id === row.criterion_id && failure.kind === row.kind)) ?? [];
  const resources = [...source.resources].slice(0, 10).map(([key, metric]) => ({
    ...metric, passing: passingSource?.resources.get(key) ?? null,
  }));
  const testedRuns = FEED_STATES.has(github?.ci?.status) ? (github.ci.items ?? []).filter(row => id(row.id) &&
    revisionOf(row) === attempt.revision).slice(0, 6) : [];
  return {
    attempt, passing, repeats, failedCriteria, comparativeEvidence, resources, testedRuns,
    failedSpans: source.failures, incomplete: source.incomplete, traceMs: source.coveredMs,
    phaseTiming: source.phases.filter(phase => source.failedPhases.has(phase.phase)).map(phase => ({
      ...phase, passingCoveredMs: passingSource?.phases.find(prior => prior.phase === phase.phase)?.coveredMs ?? null,
    })),
    elapsedMs: elapsed(attempt.started_at, attempt.finished_at),
    passingElapsedMs: passing ? elapsed(passing.started_at, passing.finished_at) : null,
    pulls: selectPulls(attempt.revision, github),
    suggestedNext: attempt.failure_category === 'authorization'
      ? 'Review the recorded permission decision and the approved scope before retrying.'
      : failedCriteria[0]
      ? 'Read the retained artifact for the failed criterion and rerun the corresponding check at the same revision.'
      : source.failures[0]
        ? 'Inspect the failed trace span and reproduce the recorded phase at the same revision.'
        : 'Collect the exit result or a failed check artifact for this attempt before making a diagnosis.',
  };
}

function runReferences(records, run, revision) {
  if (!REVISION.test(revision)) return [];
  const base = 'https://github.com/Kgray44/Aetherwake/actions/runs/' + run.id;
  const attemptUrl = base + '/attempts/' + run.attempt;
  const references = new Map();
  for (const record of records) {
    if (record.record_type !== 'evidence' || record.repository !== 'Kgray44/Aetherwake' ||
        record.revision !== revision || record.synthetic === true) continue;
    const uri = record.artifact?.uri;
    if (uri !== base && uri !== attemptUrl) continue;
    const attempt = records.find(row => row.record_type === 'attempt' && row.id === record.attempt_id &&
      row.repository === record.repository && row.task_id === record.task_id && row.revision === revision);
    if (!attempt) continue;
    const current = references.get(attempt.id);
    if (!current || uri === attemptUrl) references.set(attempt.id, {
      task: attempt.task_id, attempt: attempt.id, evidence: record.id, attemptMatched: uri === attemptUrl,
    });
  }
  return [...references.values()].slice(0, 10);
}

export function investigateRun({ run, github, records, events, baseline, repeat, pull }) {
  if (!failedRun(run)) return null;
  const history = selectRunHistory(run, github?.ci);
  const candidate = history.recentFailures[0];
  const passingDetail = matchingRunDetail(baseline, history.passing, 'success') ? baseline : null;
  const repeatDetail = matchingRunDetail(repeat, candidate, outcome(run)) ? repeat : null;
  const jobs = failingJobs(run, passingDetail, repeatDetail);
  const revision = revisionOf(run);
  const exactPulls = selectPulls(revision, github, run.pull_requests);
  const changes = pull?.kind === 'pull' && pull.head?.sha === revision &&
    exactPulls.some(row => row.number === pull.number) && ['available', 'partial', 'stale'].includes(pull.files_status)
      ? pull : null;
  const traces = records.filter(row => row.record_type === 'attempt' && row.repository === 'Kgray44/Aetherwake' &&
    row.revision === revision && REVISION.test(revision)).slice(0, 10)
    .map(attempt => {
      const source = sourceForAttempt(attempt, records, events);
      return { id: attempt.id, task: attempt.task_id, state: attempt.state, failureCategory: attempt.failure_category,
        observations: source.resources.size, failedPhases: [...source.failedPhases] };
    });
  return {
    run, history, jobs, exactPulls, changes, traces, references: runReferences(records, run, revision),
    workflowChanged: Boolean(run.path && changes?.files?.some(file => file.path === run.path)),
    passingDetail: Boolean(passingDetail), repeatDetail: Boolean(repeatDetail),
    elapsedMs: elapsed(run.started_at, run.updated_at),
    passingRevision: history.passing ? revisionOf(history.passing) : null,
    suggestedNext: outcome(run) === 'action_required'
      ? 'Review the required GitHub action or approval on the run page before deciding whether to rerun.'
      : jobs[0]?.steps?.[0]
      ? 'Open the first failed step log and locate the earliest error before deciding whether to rerun.'
      : outcome(run) === 'timed_out'
        ? 'Open the workflow log and locate the last completed step. Check duration and runner capacity for that step.'
        : 'Open the GitHub run logs and identify the first failing job or startup error. Refresh details if jobs are missing.',
  };
}
