import { compareEngineeringExperiments } from './engineering-experiments.mjs';
import { accountEngineeringTokens, accountLoadedAttemptReceipts } from './engineering-token-accounting.mjs';
import { evidenceClaimStatus } from './evidence-status.mjs';
import { activityId } from './github-activity.mjs';
import { traceTimeline } from './trace-timeline.mjs';
import { appServerTurnProfiles } from './task-engine-client.mjs';

const DAY_MS = 86_400_000;
const TERMINAL_ATTEMPTS = new Set(['succeeded', 'failed', 'cancelled']);
const CONCLUSIONS = new Set(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure']);
const FEED_STATES = new Set(['available', 'partial', 'stale']);
const TOKEN_NAMES = new Set([
  'provider_input_tokens', 'provider_output_tokens', 'provider_cached_input_tokens',
  'provider_cache_write_input_tokens', 'provider_reasoning_output_tokens',
]);
const RESOURCE_UNITS = new Map([
  ['child_cpu_ms', 'ms'], ['child_sampled_cpu_ms', 'ms'],
  ['observer_cpu_user_ms', 'ms'], ['observer_cpu_system_ms', 'ms'],
  ['child_peak_rss_bytes', 'bytes'], ['child_sampled_peak_rss_bytes', 'bytes'],
  ['child_observed_high_water_rss_bytes', 'bytes'], ['observer_rss_bytes', 'bytes'],
  ['child_disk_read_bytes', 'bytes'], ['child_disk_write_bytes', 'bytes'],
  ['child_sampled_disk_read_bytes', 'bytes'], ['child_sampled_disk_write_bytes', 'bytes'],
  ['gpu_memory_bytes', 'bytes'], ['frame_time_ms', 'ms'], ['monitor_sampling_elapsed_ms', 'ms'],
  ['monitor_helper_observed_cpu_ms', 'ms'],
]);

const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const ratio = (count, total) => total ? count / total : null;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function counts(items, label) {
  const result = new Map();
  for (const item of items) {
    const key = label(item) || 'unknown';
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(result);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function unique(items, identity) {
  const retained = new Map();
  const rejected = new Set();
  for (const item of items ?? []) {
    if (!item) continue;
    const key = identity(item);
    if (key === null || rejected.has(key)) continue;
    const prior = retained.get(key);
    if (!prior) retained.set(key, item);
    else if (prior !== item && JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(item))) {
      retained.delete(key);
      rejected.add(key);
    }
  }
  return { items: [...retained.values()], conflicts: rejected.size };
}

export function uniqueEngineeringEvents(events) {
  return unique(events, event => typeof event.event_id === 'string' && event.event_id ?
    JSON.stringify([event.task_id, event.event_id]) : null);
}

function githubGroup(group, kind) {
  const status = FEED_STATES.has(group?.status) && Array.isArray(group.items) ? group.status : 'unavailable';
  const { items, conflicts } = unique(status === 'unavailable' ? [] : group.items, item => activityId(kind, item));
  return { status, observedAt: group?.observed_at ?? null, items, conflicts };
}

function mergeState(item) {
  if (Number.isFinite(time(item.merged_at))) return true;
  if (typeof item.merged === 'boolean') return item.merged;
  return item.merged_at === null ? false : null;
}

function conclusion(run) {
  if (typeof run.conclusion === 'string' && run.conclusion) return run.conclusion;
  return CONCLUSIONS.has(run.state) ? run.state : null;
}

function duration(start, end, now) {
  const first = time(start), last = time(end);
  return Number.isFinite(first) && last >= first && last <= now ? last - first : null;
}

function dailyTrends(now, recordsKnown, {tasks, attempts, evidence, pulls, merged, ci}, {pullCreated, pullMerged, ciCreated}) {
  const endDate = Math.floor(now / DAY_MS);
  const days = Array.from({length:14}, (_, index) => ({
    date: new Date((endDate - 13 + index) * DAY_MS).toISOString().slice(0, 10),
    tasks: recordsKnown ? 0 : null, attempts: recordsKnown ? 0 : null, evidence: recordsKnown ? 0 : null,
    prsCreated: pullCreated ? 0 : null, prsMerged: pullMerged ? 0 : null,
    ciRuns: ciCreated ? 0 : null, ciSucceeded: ciCreated ? 0 : null, ciFailed: ciCreated ? 0 : null,
  }));
  const add = (key, value) => {
    const timestamp = time(value);
    const day = days[Math.floor(timestamp / DAY_MS) - (endDate - 13)];
    if (typeof day?.[key] === 'number' && timestamp <= now) day[key]++;
  };
  for (const task of tasks) add('tasks', task.created_at);
  for (const attempt of attempts) add('attempts', attempt.created_at);
  for (const record of evidence) add('evidence', record.observed_at);
  for (const pull of pulls.items) add('prsCreated', pull.created_at);
  for (const pull of merged) add('prsMerged', pull.merged_at);
  for (const run of ci.items) {
    add('ciRuns', run.created_at);
    const state = conclusion(run);
    if (state === 'success') add('ciSucceeded', run.created_at);
    if (state === 'failure') add('ciFailed', run.created_at);
  }
  return days;
}

function metricKind(metric) {
  if (metric?.availability !== 'observed' || !Number.isFinite(metric.value) || metric.value < 0) return null;
  // App Server totals and progress notices are cumulative. Only the scoped
  // attempt receipt projection may contribute these to token accounting.
  if (metric.source === 'codex_app_server_token_usage_updated') return null;
  if (TOKEN_NAMES.has(metric.name) && metric.unit === 'tokens' && Number.isSafeInteger(metric.value)) return 'token';
  if (RESOURCE_UNITS.get(metric.name) === metric.unit && RESOURCE_UNITS.has(metric.name)) return 'resource';
  if (metric.name === 'provider_cost_usd' && ['usd', 'USD'].includes(metric.unit)) return 'cost';
  return null;
}

function summarizeMetrics(records, events) {
  const traceScopes = new Set();
  const groups = new Map();
  const costs = [];
  function collect(entry, fromTrace) {
    const seen = new Set();
    for (const metric of Array.isArray(entry.measurements) ? entry.measurements : []) {
      const kind = metricKind(metric);
      if (!kind || seen.has(metric.name)) continue;
      seen.add(metric.name);
      // A wrapped observation can be present in both a trace and a v1 record.
      // Prefer trace observations within the same Attempt, phase and metric.
      const scope = JSON.stringify([entry.task_id, entry.attempt_id, entry.revision, entry.phase, metric.name]);
      if (fromTrace) traceScopes.add(scope);
      else if (traceScopes.has(scope)) continue;
      if (kind === 'cost') {
        costs.push(metric.value);
        continue;
      }
      const { name, unit, source, method } = metric;
      const key = JSON.stringify(kind === 'token' ? [kind, name] : [kind, name, source, method]);
      const group = groups.get(key) ?? {kind, name, unit, source:source ?? null, method:method ?? null, values:[]};
      group.values.push(metric.value);
      groups.set(key, group);
    }
  }
  for (const event of events) collect(event, true);
  for (const record of records) collect(record, false);
  const tokens = [], resources = [];
  for (const {kind, name, unit, source, method, values} of groups.values()) {
    const samples = values.length;
    if (kind === 'token') {
      const total = values.reduce((sum, value) => sum + value, 0);
      tokens.push({name, unit, samples, total:Number.isSafeInteger(total) ? total : null});
    }
    else resources.push({name, unit, samples, source, method, median:median(values), max:Math.max(...values)});
  }
  tokens.sort((a, b) => a.name.localeCompare(b.name));
  resources.sort((a, b) => a.name.localeCompare(b.name));
  return {tokens, resources, costUsd:costs.length ? costs.reduce((sum, value) => sum + value, 0) : null, costSamples:costs.length};
}

/** A summary of the received projection and bounded GitHub collections. */
export function buildEngineeringAnalytics({records, events, github, sessionBindings = [], experimentPairs = [], now = Date.now()} = {}) {
  const cutoff = new Date(now).getTime();
  if (!Number.isFinite(cutoff)) throw new RangeError('Invalid analytics clock');

  const recordSource = Array.isArray(records);
  const traceSource = Array.isArray(events);
  const recordData = unique(recordSource ? records : [], record => typeof record.id === 'string' && record.id ?
    JSON.stringify([record.record_type, record.id]) : null);
  const eventData = uniqueEngineeringEvents(traceSource ? events : []);
  const byType = type => recordData.items.filter(record => record.record_type === type);
  const attemptBindings = new Map(sessionBindings.flatMap(({task_id,attempt_bindings=[]})=>
    attempt_bindings.map(binding=>[JSON.stringify([task_id,binding.id,binding.revision]),binding])));
  const tasks = byType('task'), evidence = byType('evidence');
  const attempts = byType('attempt').map(attempt=>{
    const binding = attemptBindings.get(JSON.stringify([attempt.task_id,attempt.id,attempt.revision]));
    return binding?{...attempt,session_id:binding.session_id,resume_session_id:binding.resume_session_id}:attempt;
  });
  const attemptsById = new Map(attempts.map(attempt => [attempt.id, attempt]));
  const terminal = attempts.filter(attempt => TERMINAL_ATTEMPTS.has(attempt.state));
  const succeeded = terminal.filter(attempt => attempt.state === 'succeeded').length;
  const failed = terminal.filter(attempt => attempt.state === 'failed');
  const attemptTimes = terminal.map(attempt => duration(attempt.started_at, attempt.finished_at, cutoff)).filter(value => value !== null);

  const pulls = githubGroup(github?.pulls, 'pulls');
  const ci = githubGroup(github?.ci, 'runs');
  const merged = pulls.items.filter(pull => mergeState(pull) === true);
  const mergeTimes = merged.map(pull => duration(pull.created_at, pull.merged_at, cutoff)).filter(value => value !== null);
  const ciConcluded = ci.items.filter(conclusion);
  const ciSucceeded = ciConcluded.filter(run => conclusion(run) === 'success').length;
  const ciFailed = ciConcluded.filter(run => conclusion(run) === 'failure').length;
  const countDated = (rows, field) => rows.filter(row => Number.isFinite(time(row[field])) && time(row[field]) <= cutoff).length;
  const mergedKnown = pulls.items.filter(pull => mergeState(pull) !== null).length;
  const pulledDated = countDated(pulls.items, 'created_at');
  const mergedDated = countDated(merged, 'merged_at');
  const ciDated = countDated(ci.items, 'created_at');
  // Legacy snapshots may have rows without dates. Those rows cannot establish daily zeros.
  const pullCreated = pulls.status !== 'unavailable' && (!pulls.items.length || pulledDated > 0);
  const pullMerged = pulls.status !== 'unavailable' && (!pulls.items.length ||
    (mergedKnown > 0 && (!merged.length || mergedDated > 0)));
  const ciCreated = ci.status !== 'unavailable' && (!ci.items.length || ciDated > 0);
  const days = dailyTrends(cutoff, recordSource, {tasks, attempts, evidence, pulls, merged, ci}, {pullCreated, pullMerged, ciCreated});
  const timeline = traceTimeline(eventData.items);
  const complete = timeline.spans.filter(span => span.complete);
  const spanCounts = counts(complete, span => span.phase);
  const sourceConflicts = recordData.conflicts + eventData.conflicts;
  const tokenAccounting = accountEngineeringTokens({tasks,attempts,events:eventData.items,days,cutoff,sourceConflicts});
  const attemptReceiptAccounting = accountLoadedAttemptReceipts({tasks,attempts,events:eventData.items,cutoff,turnAccounting:tokenAccounting});
  const telemetry = byType('telemetry');

  return {
    days,
    sources: {
      records:recordSource ? 'available' : 'unavailable', trace:traceSource ? 'available' : 'unavailable',
      recordConflicts:recordData.conflicts, traceConflicts:eventData.conflicts,
    },
    tasks: {total:tasks.length, byState:counts(tasks, task => task.state), byClass:counts(tasks, task => task.classification?.primary)},
    attempts: {
      total:attempts.length, byState:counts(attempts, attempt => attempt.state),
      byFailure:counts(failed, attempt => attempt.failure_category !== 'none' && attempt.failure_category),
      terminal:terminal.length, succeeded, failed:failed.length, successRate:ratio(succeeded, terminal.length),
      timed:attemptTimes.length, medianMs:median(attemptTimes),
    },
    evidence: {
      total:evidence.length, byResult:counts(evidence, record => record.result),
      byStatus:counts(evidence, record => evidenceClaimStatus(record, [attemptsById.get(record.attempt_id)].filter(Boolean))),
      synthetic:evidence.filter(record => record.synthetic === true).length,
    },
    pulls: {
      status:pulls.status, observedAt:pulls.observedAt, total:pulls.items.length, conflicts:pulls.conflicts,
      merged:merged.length, mergedKnown, createdDated:pulledDated, mergedDated,
      createdInWindow:pullCreated ? days.reduce((total, day) => total + day.prsCreated, 0) : null,
      mergedInWindow:pullMerged ? days.reduce((total, day) => total + day.prsMerged, 0) : null,
      mergeSamples:mergeTimes.length, medianMergeMs:median(mergeTimes),
    },
    ci: {
      status:ci.status, observedAt:ci.observedAt, total:ci.items.length, conflicts:ci.conflicts,
      byOutcome:counts(ci.items, run => conclusion(run) || run.status || run.state), createdDated:ciDated,
      concluded:ciConcluded.length, succeeded:ciSucceeded, failed:ciFailed, successRate:ratio(ciSucceeded, ciConcluded.length),
    },
    trace: {
      events:eventData.items.length, complete:complete.length, incomplete:timeline.incomplete, coveredMs:timeline.coveredMs,
      byPhase:timeline.phases.map(phase => ({...phase, spans:spanCounts[phase.phase]})),
    },
    tokenAccounting,
    attemptReceiptAccounting,
    appServerProfiles:appServerTurnProfiles(attempts,eventData.items.filter(event=>time(event.occurred_at)<=cutoff)),
    experiments:compareEngineeringExperiments({
      pairs:experimentPairs,tasks,attempts,telemetry,events:eventData.items,cutoff,accounting:tokenAccounting,attemptReceipts:attemptReceiptAccounting,
      conflicted:sourceConflicts > 0 || tokenAccounting.unattributedTurns > 0,
    }),
    usage:summarizeMetrics(telemetry, eventData.items),
  };
}
