import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DIAGNOSTIC, diagnosticRunName } from '../ci-policy.mjs';
import { createWorker } from './worker.mjs';

const origin = 'https://observatory.example';
const route = '/api/github/actions';
const repo = 'Kgray44/Aetherwake';
const repository = { full_name: repo, id: 80 };
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const workflow = 123;
const token = 'github_pat_' + 'x'.repeat(32);
const auth = { 'oai-authenticated-user-id': 'owner' };
const confirmation = (type = 'rerun_failed', extra = {}) => ({
  operation_id: crypto.randomUUID(), type, expected_revision: sha, run_id: 100, workflow_id: workflow, attempt: 1, ...extra,
});

function fixture(t, options = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL('./drizzle/0008_ci_operations.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(statement) {
      const query = sql.prepare(statement);
      return { bind: (...args) => ({
        first: async () => query.get(...args),
        all: async () => ({ results: query.all(...args) }),
        run: async () => ({ meta: query.run(...args) }),
      }) };
    },
  };
  const writes = [];
  const reads = [];
  const fail = code => new Response(null, { status: code });
  const failedRun = {
    id: 100, workflow_id: workflow, run_attempt: 1, head_sha: sha, head_branch: 'codex/source',
    repository, head_repository: repository, status: 'completed', conclusion: 'failure',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    pull_requests: [
      { number: 316, base: { repo: { id: repository.id } }, head: { sha } },
      { number: 317, base: { repo: { id: repository.id } }, head: { sha: other } },
    ],
    ...options.run,
  };
  const job = {
    id: 101, run_id: 100, run_attempt: 1, head_sha: sha, name: 'Failing job',
    status: 'completed', conclusion: 'failure', ...options.job,
  };
  let current = failedRun;
  let newAttempt = null;
  let dispatched = null;
  const fetcher = async (uri, init) => {
    assert.equal(new URL(uri).origin, 'https://api.github.com');
    assert.equal(init.headers.Authorization, 'Bearer ' + token);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.ok(uri.startsWith('https://api.github.com/repos/' + repo + '/'));
    const path = uri.slice(('https://api.github.com/repos/' + repo).length);
    if (init.method === 'POST') {
      const input = JSON.parse(init.body);
      writes.push({ path, input });
      if (options.reject) return fail(options.reject);
      if (path.endsWith('/cancel')) {
        current = { ...current, status: 'completed', conclusion: options.cancelConclusion || 'cancelled' };
        return fail(202);
      }
      if (path.endsWith('/rerun') || path.endsWith('/rerun-failed-jobs')) {
        newAttempt = { ...current, run_attempt: 2, status: 'queued', conclusion: null };
        current = newAttempt;
        if (options.lostRerun) throw Error('Connection interrupted');
        return fail(201);
      }
      if (path === '/actions/workflows/' + DIAGNOSTIC.id + '/dispatches') {
        dispatched = {
          ...current, id: 200, workflow_id: DIAGNOSTIC.id, run_attempt: 1,
          head_branch: 'main', head_sha: options.actualDispatchRevision || sha, event: 'workflow_dispatch',
          status: 'queued', conclusion: null, display_title: diagnosticRunName(input.inputs.observatory_operation),
        };
        if (options.lostDispatch) throw Error('Connection interrupted');
        return Response.json({ workflow_run_id: 200, html_url: 'https://github.com/' + repo + '/actions/runs/200' });
      }
      assert.fail('Unexpected write ' + path);
    }
    reads.push(path);
    if (path === '/actions/runs/100') return Response.json(current);
    if (path === '/actions/jobs/101') return Response.json(job);
    if (path === '/actions/runs/100/attempts/1/jobs?per_page=100') {
      const jobs = options.omitAttemptJob ? [] : [job];
      return Response.json({total_count:jobs.length,jobs});
    }
    if (path === '/actions/runs/100/attempts/1') return Response.json({ ...current, run_attempt: 1 });
    if (path === '/actions/runs/100/attempts/2') return newAttempt ? Response.json(newAttempt) : fail(404);
    if (path === '/actions/runs/100/attempts/2/jobs?per_page=50') {
      return Response.json({ jobs: [{ ...job, id: 201, run_attempt: 2 }] });
    }
    if (path === '/actions/workflows/' + DIAGNOSTIC.file) {
      return Response.json({ id: DIAGNOSTIC.id, path: DIAGNOSTIC.path, state: 'active', ...options.workflow });
    }
    if (path === '/git/ref/heads/main') return Response.json({ ref: 'refs/heads/main', object: { sha, type: 'commit' } });
    if (path === '/actions/runs/200/attempts/1') return dispatched ? Response.json(dispatched) : fail(404);
    if (path.startsWith('/actions/workflows/' + DIAGNOSTIC.id + '/runs?')) {
      return Response.json({ workflow_runs: dispatched ? [dispatched] : [] });
    }
    assert.fail('Unexpected read ' + path);
  };
  const env = {
    DB: db, GITHUB_ACTIONS_TOKEN: options.noCredential ? undefined : token, OBSERVATORY_CI_OWNER_ID: 'owner',
    ...(options.sharedToken ? { GITHUB_READ_TOKEN: token } : {}),
    ...(options.sharedIntegrationToken ? { GITHUB_INTEGRATION_PUBLISH_TOKEN:token } : {}),
  };
  const call = (path, config) => createWorker({ assets: {}, fetcher }).fetch(new Request(origin + path, config), env);
  const post = (action, headers = {}) => call(route, { method: 'POST', headers: {
    ...auth, origin, 'content-type': 'application/json', ...headers,
  }, body: JSON.stringify(action) });
  const status = async (id, wait = true) => {
    if (wait) sql.prepare(`UPDATE ci_operations SET updated_at = '2000-01-01T00:00:00Z' WHERE operation_id = ?`).run(id);
    const response = await call(route + '?operation=' + id, { headers: auth });
    assert.equal(response.status, 200);
    return (await response.json()).operation;
  };
  function finishRerun() {
    newAttempt = { ...newAttempt, status: 'completed', conclusion: 'success' };
    current = newAttempt;
  }
  return { reads, writes, call, post, status, finishRerun };
}

test('CI routes require owner permission, separate credentials and same-origin confirmation', async t => {
  const { call, post, writes, reads } = fixture(t);
  const action = confirmation();
  assert.equal((await call(route)).status, 401);
  assert.equal((await post(action, { 'oai-authenticated-user-id': 'other' })).status, 403);
  assert.equal((await post(action, { origin: 'https://other.example' })).status, 403);
  assert.equal((await post(action, { 'x-observatory-verification': crypto.randomUUID() })).status, 403);
  assert.equal((await post({ ...action, endpoint: 'https://attacker.example' })).status, 400);
  assert.equal((await post({ ...action, type: 'force-cancel' })).status, 400);
  assert.equal((await post({ ...action, enable_debug_logging: true })).status, 400);
  assert.equal((await post({ ...action, operation_id: 'bad' })).status, 400);
  assert.equal((await (await call(route, { headers: auth })).json()).access.enabled, true);
  for (const options of [{ noCredential: true }, { sharedToken: true }, {sharedIntegrationToken:true}]) {
    const disabled = fixture(t, options);
    assert.equal((await disabled.post(action)).status, 403);
    assert.equal((await (await disabled.call(route, { headers: auth })).json()).access.enabled, false);
    assert.equal(disabled.writes.length, 0);
  }
  assert.equal(writes.length, 0);
  assert.equal(reads.length, 0);
});

test('job rerun proves attempt membership if GitHub omits the field on the job response', async t => {
  const allowed = fixture(t,{job:{run_attempt:undefined}});
  const denied = fixture(t,{job:{run_attempt:undefined},omitAttemptJob:true});
  const action = confirmation('rerun_job',{job_id:101});
  assert.equal((await allowed.post(action)).status,200);
  assert.ok(allowed.reads.includes('/actions/runs/100/attempts/1/jobs?per_page=100'));
  assert.equal(allowed.writes[0].path,'/actions/jobs/101/rerun');
  assert.equal((await denied.post(action)).status,409);
  assert.equal(denied.writes.length,0);
});

test('reruns once across isolates and confirms both the new attempt and terminal result', async t => {
  const { call, post, status, writes, finishRerun } = fixture(t);
  const action = confirmation('rerun_run');
  const [first, duplicate] = await Promise.all([post(action), post(action)]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(writes, [{ path: '/actions/runs/100/rerun', input: { enable_debug_logging: false } }]);
  assert.equal((await post({ ...action, type: 'rerun_failed' })).status, 409);
  assert.equal((await post({ ...action, operation_id: crypto.randomUUID() })).status, 409);
  const accepted = await status(action.operation_id, false);
  assert.equal(accepted.state, 'accepted');
  assert.deepEqual(accepted.target.pull_requests, [316]);
  const observed = await status(action.operation_id);
  assert.equal(observed.state, 'observed');
  assert.equal(observed.observed.attempt, 2);
  assert.equal(observed.observed.status, 'queued');
  finishRerun();
  const finished = await status(action.operation_id);
  assert.equal(finished.observed.conclusion, 'success');
  const response = await call(route + '?operation=' + action.operation_id, { headers: { 'oai-authenticated-user-id': 'other' } });
  assert.equal(response.status, 403);
  const list = (await (await call(route, { headers: auth })).json()).operations;
  assert.equal(list[0].operation_id, action.operation_id);
});

test('routes all failed jobs and a single failed job to exact GitHub targets', async t => {
  const all = fixture(t);
  const allAction = confirmation();
  assert.equal((await all.post(allAction)).status, 200);
  assert.equal(all.writes[0].path, '/actions/runs/100/rerun-failed-jobs');
  const single = fixture(t);
  const action = confirmation('rerun_job', { job_id: 101 });
  assert.equal((await single.post(action)).status, 200);
  assert.equal(single.writes[0].path, '/actions/jobs/101/rerun');
  const result = await single.status(action.operation_id);
  assert.equal(result.observed.job_id, 201);
  assert.equal(result.target.job_id, 101);
});

test('rejects stale, fork, nonfailed and wrong-attempt targets before mutation', async t => {
  const scope = fixture(t);
  for (const overrides of [{ expected_revision: other }, { workflow_id: 2 }, { attempt: 2 }]) {
    assert.equal((await scope.post(confirmation('rerun_failed', overrides))).status, 409);
  }
  assert.equal((await scope.post(confirmation('cancel'))).status, 409);
  assert.equal(scope.writes.length, 0);
  const fork = fixture(t, { run: { head_repository: { full_name: 'Someone/Aetherwake' } } });
  assert.equal((await fork.post(confirmation())).status, 409);
  const successful = fixture(t, { run: { conclusion: 'success' } });
  assert.equal((await successful.post(confirmation('rerun_run'))).status, 409);
  const staleJob = fixture(t, { job: { run_attempt: 2 } });
  assert.equal((await staleJob.post(confirmation('rerun_job', { job_id: 101 }))).status, 409);
  assert.equal(staleJob.writes.length, 0);
});

test('normal cancellation distinguishes accepted cancellation from the actual completion result', async t => {
  for (const conclusion of ['cancelled', 'success']) {
    const { post, status, writes } = fixture(t, { run: { status: 'in_progress', conclusion: null }, cancelConclusion: conclusion });
    const action = confirmation('cancel');
    assert.equal((await (await post(action)).json()).operation.state, 'accepted');
    assert.deepEqual(writes, [{ path: '/actions/runs/100/cancel', input: {} }]);
    const result = await status(action.operation_id);
    assert.equal(result.state, conclusion === 'cancelled' ? 'observed' : 'not_effective');
    assert.equal(result.observed.conclusion, conclusion);
  }
});

test('dispatch only allows the known workflow on confirmed main, reconciles lost response by operation ID and detects ref races', async t => {
  for (const options of [{}, { lostDispatch: true }, { actualDispatchRevision: other }]) {
    const { post, status, writes } = fixture(t, options);
    const action = { operation_id: crypto.randomUUID(), type: 'dispatch', diagnostic: DIAGNOSTIC.key, expected_revision: sha };
    assert.equal((await post({ ...action, diagnostic: 'anything' })).status, 400);
    assert.equal((await post({ ...action, ref: 'unreviewed-branch' })).status, 400);
    assert.equal((await post({ ...action, expected_revision: other })).status, 409);
    const started = await (await post(action)).json();
    assert.equal(started.operation.state, options.lostDispatch ? 'unknown' : 'accepted');
    assert.equal((await post(action)).status, 200);
    assert.deepEqual(writes, [{
      path: '/actions/workflows/' + DIAGNOSTIC.id + '/dispatches', input: {
        ref: 'main', return_run_details: true, inputs: { expected_revision: sha, observatory_operation: action.operation_id },
      },
    }]);
    const result = await status(action.operation_id);
    assert.equal(result.state, options.actualDispatchRevision ? 'not_effective' : 'observed');
    assert.equal(result.observed.run_id, 200);
  }
  const replaced = fixture(t, { workflow: { id: 9999 } });
  assert.equal((await replaced.post({ operation_id: crypto.randomUUID(), type: 'dispatch', diagnostic: DIAGNOSTIC.key,
    expected_revision: sha })).status, 409);
  assert.equal(replaced.writes.length, 0);
});

test('preserves rejection and ambiguous transport receipts without sending a duplicate', async t => {
  const denied = fixture(t, { reject: 403 });
  const action = confirmation();
  const rejected = await (await denied.post(action)).json();
  assert.equal(rejected.operation.state, 'rejected');
  assert.equal(rejected.operation.github_status, 403);
  assert.equal((await denied.post(action)).status, 200);
  assert.equal(denied.writes.length, 1);
  const unknown = fixture(t, { lostRerun: true });
  assert.equal((await (await unknown.post(action)).json()).operation.state, 'unknown');
  const read = await unknown.status(action.operation_id);
  assert.equal(read.state, 'unknown');
  assert.equal(read.observed.attempt, 2);
  assert.match(read.message, /cannot be attributed/);
  assert.equal((await unknown.post(action)).status, 200);
  assert.equal(unknown.writes.length, 1);
});
