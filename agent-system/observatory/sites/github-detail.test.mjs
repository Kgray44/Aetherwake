import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { cachedGitHub, cachedGitHubDetail } from './github-cache.mjs';
import { createWorker } from './worker.mjs';

const provider = 'https://api.github.com/repos/Kgray44/Aetherwake';
const full_name = 'Kgray44/Aetherwake';
const sha = 'a'.repeat(40);
const headers = { 'oai-authenticated-user-id': 'fixture-owner' };
const allow = () => true;

function database(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  for (const name of ['0001_github_snapshot', '0005_github_conditional_cache', '0006_github_details']) {
    sql.exec(readFileSync(new URL('./drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  }
  return {
    prepare(statement) {
      const stmt = sql.prepare(statement);
      return { bind: (...args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => stmt.run(...args),
      }) };
    },
  };
}

function pull(number) {
  return { number, title: 'A pull request', body: 'A summary', head: { ref: 'topic', sha },
    base: { ref: 'main', sha, repo: { full_name } }, requested_reviewers: [{ login: 'reviewer' }],
    labels: [{ name: 'review', color: 'aabbcc' }], changed_files: 2, html_url: 'https://wrong.example',
    logs: 'never-copy-private-provider-fields' };
}

function workflow(id, run_attempt = 1) {
  return { id, name: 'CI', display_title: 'Workflow', status: 'completed', conclusion: 'success', run_attempt,
    head_branch: 'main', head_sha: sha, repository: { full_name } };
}

test('owner-only GET validates the route and shares bounded PR detail between isolates', async t => {
  const DB = database(t);
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, provider + '/pulls/12');
    assert.equal(options.headers.Authorization, 'Bearer detail-token');
    assert.equal(options.redirect, 'manual');
    return Response.json({ ...pull(12), body: 'a'.repeat(8001) }, { headers: { etag: '"first"' } });
  };
  const request = (path, options) => createWorker({ assets: {}, validate: allow, fetcher })
    .fetch(new Request('https://example.test' + path, options), { DB, GITHUB_READ_TOKEN: 'detail-token' });
  assert.equal((await request('/api/github/pulls/12')).status, 401);
  assert.equal((await request('/api/github/pulls/12', { method: 'POST', headers })).status, 405);
  assert.equal((await request('/api/github/pulls/0', { headers })).status, 404);
  assert.equal((await request('/api/github/pulls/999999999999999999', { headers })).status, 400);
  assert.equal(calls, 0);
  const response = await request('/api/github/pulls/12', { headers });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const first = await response.json();
  assert.deepEqual(await (await request('/api/github/pulls/12', { headers })).json(), first);
  assert.equal(first.status, 'available');
  assert.equal(first.detail.body.length, 8000);
  assert.equal(first.detail.body_truncated, true);
  assert.equal(first.detail.url, 'https://github.com/Kgray44/Aetherwake/pull/12');
  assert.equal(JSON.stringify(first).includes('never-copy-private-provider-fields'), false);
  assert.equal(calls, 1);
});

test('uses conditional PR and exact-attempt job reads, limits jobs and suppresses raw provider data', async t => {
  const db = database(t);
  const baseTime = Date.now();
  const requests = [];
  const respond = async (url, { headers }) => {
    requests.push([url, headers['If-None-Match']]);
    if (headers['If-None-Match']) return new Response(null, { status: 304 });
    if (url.endsWith('/actions/runs/123')) return Response.json(workflow(123, 2), { headers: { etag: '"run"' } });
    assert.equal(url, provider + '/actions/runs/123/attempts/2/jobs?per_page=25');
    return Response.json({ total_count: 26, jobs: Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, run_id: 123, status: 'completed', conclusion: 'success',
      steps: [{ number: 1, name: 'Run checks', html_url: 'https://wrong.example' }],
      log: 'never-copy-private-provider-fields',
    })) }, { headers: { etag: '"jobs"' } });
  };
  const first = await cachedGitHubDetail(db, respond, 'fixture-token', 'runs', 123, baseTime);
  assert.equal(first.status, 'partial');
  assert.equal(first.detail.jobs.length, 25);
  assert.equal(first.detail.total_jobs, 26);
  assert.equal(first.detail.jobs_truncated, true);
  assert.equal(first.detail.jobs[0].url, 'https://github.com/Kgray44/Aetherwake/actions/runs/123/job/1');
  assert.equal(JSON.stringify(first).includes('wrong.example'), false);
  assert.equal(JSON.stringify(first).includes('never-copy-private-provider-fields'), false);
  const second = await cachedGitHubDetail(db, respond, 'fixture-token', 'runs', 123, baseTime + 16 * 60_000);
  assert.equal(second.status, 'partial');
  assert.deepEqual(second.detail.jobs, first.detail.jobs);
  assert.notEqual(second.observed_at, first.observed_at);
  assert.deepEqual(requests.map(request => request[1]), [undefined, undefined, '"run"', '"jobs"']);
});

test('one detail response can throttle both detail and overview across isolates', async t => {
  const db = database(t);
  const now = Date.now();
  let calls = 0;
  const throttle = async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
  };
  const first = await cachedGitHubDetail(db, throttle, 'first-token', 'pulls', 12, now);
  assert.equal(first.reason, 'GitHub rate limit reached');
  const second = await cachedGitHubDetail(db, throttle, 'rotated-token', 'pulls', 13, now + 1000);
  const overview = await cachedGitHub(db, throttle, allow, 'first-token', now + 1000);
  assert.equal(second.reason, first.reason);
  assert.equal(overview.pulls.reason, first.reason);
  assert.equal(calls, 1);
});

test('rejected credential never falls back anonymously and blocks subsequent calls until rotation', async t => {
  const db = database(t);
  const now = Date.now();
  const attempts = [];
  const upstream = async (url, { headers }) => {
    attempts.push(headers.Authorization);
    return headers.Authorization === 'Bearer original' ? new Response(null, { status: 401 }) : Response.json(pull(14));
  };
  const denied = await cachedGitHubDetail(db, upstream, 'original', 'pulls', 12, now);
  assert.equal(denied.reason, 'GitHub read credential rejected');
  assert.equal((await cachedGitHubDetail(db, upstream, undefined, 'pulls', 13, now + 1)).status, 'unavailable');
  assert.equal((await cachedGitHubDetail(db, upstream, 'original', 'pulls', 13, now + 2)).reason, denied.reason);
  const overview = await cachedGitHub(db, upstream, allow, 'original', now + 3);
  assert.equal(overview.api.authentication, 'rejected');
  assert.equal((await cachedGitHubDetail(db, upstream, 'rotated', 'pulls', 14, now + 4)).status, 'available');
  assert.deepEqual(attempts, ['Bearer original', 'Bearer rotated']);
});
