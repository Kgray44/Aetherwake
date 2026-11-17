import assert from 'node:assert/strict';
import test from 'node:test';
import { investigateAttempt, investigateRun, selectRunHistory } from './src/failure-investigation.mjs';

const repository = 'Kgray44/Aetherwake';
const revision = 'a'.repeat(40);
const previousRevision = 'b'.repeat(40);
const day = number => '2026-11-' + (10 + number) + 'T00:00:00.000Z';
const current = { kind: 'run', id: 10, attempt: 2, workflow_id: 100, head_repository_id: 123, event: 'pull_request',
  status: 'completed', conclusion: 'failure', created_at: day(4), started_at: day(4), updated_at: day(5),
  head: { ref: 'fix', sha: revision }, pull_requests: [12] };
const past = (overrides = {}) => ({
  id: 9, attempt: 1, workflow_id: 100, head_repository_id: 123, event: 'pull_request',
  status: 'completed', conclusion: 'success', branch: 'fix', revision: previousRevision, created_at: day(3), updated_at: day(3),
  ...overrides,
});
const job = (conclusion, overrides = {}) => ({
  id: 1, name: 'Tests', status: 'completed', conclusion, started_at: day(1), completed_at: day(2),
  steps: [{ number: 1, name: 'Run focused tests', status: 'completed', conclusion }], ...overrides,
});
const details = (row, jobs) => ({ ...row, kind: 'run', head: { ref: row.branch, sha: row.revision }, jobs });

test('CI diagnosis compares exact workflow histories and jobs, identifies tested changes, and links matching local revision observations', () => {
  const passing = past();
  const repeat = past({ id: 8, conclusion: 'failure', created_at: day(2) });
  const wrongFork = past({ id: 20, head_repository_id: 456 });
  const github = { ci: { status: 'available', observed_at: day(5), items: [wrongFork, passing, repeat] } };
  const attempt = { record_type: 'attempt', id: 'attempt-a', task_id: 'task-a', repository, revision, state: 'failed' };
  const evidence = { record_type: 'evidence', id: 'evidence-a', task_id: attempt.task_id, attempt_id: attempt.id,
    repository, revision, artifact: { uri: 'https://github.com/Kgray44/Aetherwake/actions/runs/10/attempts/2' } };
  const diagnosis = investigateRun({
    run: { ...current, jobs: [job('failure')], path: 'src/app.mjs' }, github, records: [attempt, evidence,
      { ...evidence, id: 'evil-evidence', artifact: { uri: 'https://github.com.example/Kgray44/Aetherwake/actions/runs/10/attempts/2' } }],
    events: [], baseline: details(passing, [job('success')]), repeat: details(repeat, [job('failure')]),
    pull: { kind: 'pull', number: 12, head: { sha: revision }, files_status: 'partial', files: [{ path: 'src/app.mjs' }], files_truncated: true },
  });
  assert.equal(diagnosis.history.passing.id, 9);
  assert.deepEqual(diagnosis.history.recentFailures.map(row => row.id), [8]);
  assert.equal(diagnosis.jobs[0].passingElapsedMs, 86_400_000);
  assert.equal(diagnosis.jobs[0].repeated, true);
  assert.deepEqual(diagnosis.jobs[0].steps, [[1, 'Run focused tests']]);
  assert.deepEqual(diagnosis.traces.map(row => row.task), ['task-a']);
  assert.deepEqual(diagnosis.references, [{ task: 'task-a', attempt: 'attempt-a', evidence: 'evidence-a', attemptMatched: true }]);
  assert.equal(diagnosis.changes.files[0].path, 'src/app.mjs');
  assert.equal(diagnosis.changes.files_truncated, true);
  assert.equal(diagnosis.workflowChanged, true);
  assert.match(diagnosis.suggestedNext, /failed step log/);
});

test('CI diagnosis rejects wrong attempts, truncated or ambiguous comparison jobs, and unbound history or changed files', () => {
  const passing = past();
  const repeat = past({ id: 8, conclusion: 'failure', created_at: day(2) });
  const history = { status: 'available', items: [
    passing, repeat,
    past({ id: 11, workflow_id: 101 }),
    past({ id: 12, status: 'in_progress' }),
    past({ id: 13, created_at: day(5) }),
    past({ id: 21, updated_at: day(5) }),
    past({ id: 14, branch: 'another-branch' }),
    past({ id: 15, event: 'push' }),
    past({ id: 16, head_repository_id: undefined }),
    past({ id: 17, created_at: day(3), conclusion: 'failure' }),
    past({ id: 17, created_at: day(3), conclusion: 'success' }),
  ] };
  assert.deepEqual(selectRunHistory(current, history).recentFailures.map(row => row.id), [8]);
  assert.equal(selectRunHistory({ ...current, workflow_id: undefined }, history).passing, null);
  const run = { ...current, jobs: [job('failure'), job('failure', { id: 2 })] };
  const diagnose = (baseline, prior) => investigateRun({ run, github: { ci: history }, records: [], events: [],
    baseline, repeat: prior, pull: { kind: 'pull', number: 12, head: { sha: previousRevision }, files_status: 'available' } });
  const stale = diagnose(details({ ...passing, attempt: 3 }, [job('success')]), { ...details(repeat, [job('failure')]), jobs_truncated: true });
  assert.equal(stale.passingDetail, false);
  assert.equal(stale.jobs[0].passingElapsedMs, null);
  assert.equal(stale.jobs[0].repeated, false);
  assert.equal(stale.changes, null);
  const ambiguous = diagnose(details(passing, [job('success')]), details(repeat, [job('failure')]));
  assert.ok(ambiguous.jobs.every(job => !job.repeated && job.passingElapsedMs === null));
  for (const conclusion of ['success', 'cancelled', 'skipped']) {
    assert.equal(investigateRun({ run: { ...run, conclusion } }), null);
  }
});

const task = { record_type: 'task', id: 'task-a', repository, revision };
const attempt = (overrides = {}) => ({ record_type: 'attempt', id: 'attempt-a', task_id: task.id, repository,
  revision, attempt_number: 3, state: 'failed', failure_category: 'test', started_at: day(4), finished_at: day(5), ...overrides });
const evidence = (row, result, overrides = {}) => ({
  record_type: 'evidence', id: 'evidence-' + row.id, task_id: task.id, repository,
  revision: row.revision, attempt_id: row.id, criterion_id: 'case-1', kind: 'test', result, ...overrides,
});
const metric = (value, overrides = {}) => ({ name: 'child_sampled_peak_rss_bytes', source: 'windows_resource_sampler',
  method: 'periodic_sample', availability: 'observed', value, unit: 'bytes', ...overrides });
const span = (row, kind, overrides = {}) => ({ kind, repository, task_id: task.id, attempt_id: row.id, revision: row.revision,
  event_id: kind, span_id: 'span-1', trace_id: 'trace-1', phase: 'verification',
  occurred_at: kind === 'span_end' ? row.finished_at : row.started_at,
  state: kind === 'span_end' ? 'failed' : 'started', measurements: [], ...overrides,
});
const telemetry = (row, sample) => ({ record_type: 'telemetry', id: 'telemetry-' + row.id, repository, task_id: task.id,
  attempt_id: row.id, revision: row.revision, phase: 'verification', observed_at: row.finished_at, measurements: [sample] });

test('Task diagnosis joins the prior passing attempt, failure artifacts, phase timing and resource measurements on exact identity', () => {
  const failed = attempt();
  const passed = attempt({ id: 'passed', attempt_number: 1, revision: previousRevision,
    state: 'succeeded', started_at: day(1), finished_at: day(2) });
  const repeat = attempt({ id: 'repeat', attempt_number: 2, started_at: day(2), finished_at: day(3) });
  const events = [
    span(failed, 'span_start'),
    span(failed, 'span_end', { measurements: [{ name: 'elapsed_wall_ms', availability: 'observed', value: 20, unit: 'ms' }] }),
    span(failed, 'span_start', { span_id: 'incomplete' }),
  ];
  const result = investigateAttempt({ task, attempt: failed,
    records: [failed, passed, repeat, evidence(failed, 'failed'), evidence(passed, 'passed'),
      telemetry(failed, metric(456)), telemetry(passed, metric(123))],
    events, github: { ci: { status: 'available', items: [past({ revision }), past({ id: 6 })] } } });
  assert.equal(result.passing.id, 'passed');
  assert.deepEqual(result.repeats.map(row => row.id), ['repeat']);
  assert.equal(result.failedCriteria[0].criterion_id, 'case-1');
  assert.equal(result.comparativeEvidence[0].criterion_id, 'case-1');
  assert.equal(result.incomplete, 1);
  assert.equal(result.failedSpans[0].monotonicMs, 20);
  assert.equal(result.resources[0].passing.value, 123);
  assert.deepEqual(result.testedRuns.map(row => row.id), [9]);
  assert.match(result.suggestedNext, /retained artifact/);
});

test('Task diagnosis does not match synthetic, wrong-revision, other-repository, future, or differently sampled evidence', () => {
  const failed = attempt({ failure_category: 'unknown' });
  const passed = attempt({ id: 'passed', attempt_number: 2, revision: previousRevision, state: 'succeeded',
    started_at: day(1), finished_at: day(2) });
  const knownBad = attempt({ id: 'unknown', attempt_number: 1, failure_category: 'unknown', started_at: day(1), finished_at: day(2) });
  const wrong = attempt({ id: 'wrong', attempt_number: 2, state: 'succeeded', repository: 'other/repo', finished_at: day(3) });
  const future = attempt({ id: 'future', attempt_number: 2, state: 'succeeded', started_at: day(3), finished_at: day(5) });
  const result = investigateAttempt({ task, attempt: failed,
    records: [failed, passed, knownBad, wrong, future, evidence(failed, 'failed', { synthetic: true }),
      evidence(failed, 'failed', { revision: previousRevision }), evidence(passed, 'passed'),
      telemetry(failed, metric(456)), telemetry(passed, metric(123, { method: 'process_high_water' }))],
    events: [span(failed, 'span_end'), span(failed, 'span_start', { revision: previousRevision })] });
  assert.equal(result.passing.id, 'passed');
  assert.equal(result.repeats.length, 0);
  assert.equal(result.failedCriteria.length, 0);
  assert.equal(result.comparativeEvidence.length, 0);
  assert.equal(result.failedSpans.length, 0);
  assert.equal(result.incomplete, 1);
  assert.equal(result.resources[0].passing, null);
  assert.match(result.suggestedNext, /Collect the exit result/);
  assert.equal(investigateAttempt({ task, attempt: wrong, records: [wrong], events: [] }), null);
});
