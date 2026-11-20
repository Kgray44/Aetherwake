import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { cachedGitHub, cachedGitHubDetail, peekTaskGitHubDetails } from './github-cache.mjs';
import { createWorker } from './worker.mjs';
import { runItems } from './github.mjs';

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
        all: async () => ({results:stmt.all(...args)}),
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

test('CI identity migration refreshes old run projections without dropping fallback records or rate limits', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const name of ['0001_github_snapshot', '0005_github_conditional_cache', '0006_github_details']) {
    db.exec(readFileSync(new URL('./drizzle/' + name + '.sql', import.meta.url), 'utf8'));
  }
  const snapshot = JSON.stringify({ ci: { items: [{ id: 44 }] } });
  const payload = JSON.stringify({ detail: { id: 44 } });
  db.prepare(`INSERT INTO github_snapshot (id,auth_mode,snapshot,retry_at,rate_until,validators)
    VALUES (1,'authenticated',?,100,200,?)`).run(snapshot, JSON.stringify({ '/actions/runs?per_page=40': 'run-list', '/pulls': 'pull-list' }));
  const insert = db.prepare(`INSERT INTO github_details (cache_key,credential_key,retry_at,stored_at,payload,validators)
    VALUES (?,'token',100,1,?,?)`);
  insert.run('runs:44', payload, JSON.stringify({ core: 'run', jobs: 'jobs' }));
  insert.run('pulls:12', payload, JSON.stringify({ core: 'pull' }));
  db.exec(readFileSync(new URL('./drizzle/0010_refresh_ci_identity.sql', import.meta.url), 'utf8'));
  const list = db.prepare('SELECT snapshot,retry_at,rate_until,validators FROM github_snapshot WHERE id=1').get();
  assert.equal(list.snapshot, snapshot);
  assert.equal(list.retry_at, 0);
  assert.equal(list.rate_until, 200);
  assert.deepEqual(JSON.parse(list.validators), { '/pulls': 'pull-list' });
  const details = db.prepare('SELECT cache_key,retry_at,payload,validators FROM github_details ORDER BY cache_key').all();
  assert.equal(details[0].retry_at, 100);
  assert.equal(details[1].retry_at, 0);
  assert.equal(details[1].payload, payload);
  assert.deepEqual(JSON.parse(details[1].validators), { jobs: 'jobs' });
});

test('workflow snapshots retain only provider-linked pull numbers at the run revision and base repository',()=>{
  const repo=123;
  const row={...workflow(100),repository:{full_name,id:repo},pull_requests:[
    {number:1,head:{sha},base:{repo:{id:repo}}},
    {number:1,head:{sha},base:{repo:{id:repo}}},
    {number:2,head:{sha:'b'.repeat(40)},base:{repo:{id:repo}}},
    {number:3,head:{sha},base:{repo:{id:99}}},
  ]};
  assert.deepEqual(runItems([row])[0].pull_requests,[1]);
  assert.equal(runItems([{...row,repository:{full_name:'another/repo',id:repo}}])[0].pull_requests,undefined);
});

test('reads a bounded workflow history pinned to the selected run and rejects unrelated rows', async t => {
  const db = database(t);
  const target = { ...workflow(123), workflow_id: 42, head_repository: { id: 88 }, event: 'push',
    created_at: '2026-01-02T00:00:00.000Z' };
  const older = { ...target, id: 122, created_at: '2026-01-01T01:00:00.000Z', updated_at: '2026-01-01T01:05:00.000Z' };
  const paths = [];
  const fetcher = async (endpoint, { headers }) => {
    const url = new URL(endpoint);
    paths.push([url.pathname, headers['If-None-Match']]);
    if (headers['If-None-Match']) return new Response(null, { status: 304 });
    if (url.pathname.endsWith('/actions/runs/123')) return Response.json(target, { headers: { etag: '"run"' } });
    assert.ok(url.pathname.endsWith('/actions/workflows/42/runs'));
    assert.deepEqual(Object.fromEntries(url.searchParams), { branch: 'main', event: 'push', created: '<' + target.created_at, per_page: '12' });
    return Response.json({ workflow_runs: [older, target, { ...older, id: 121, event: 'pull_request' },
      { ...older, id: 120, head_repository: { id: 99 } }, { ...older, id: 119, workflow_id: 43 }] }, { headers: { etag: '"history"' } });
  };
  const now = Date.now();
  const first = await cachedGitHubDetail(db, fetcher, 'fixture-token', 'histories', 123, now);
  assert.equal(first.status, 'available');
  assert.deepEqual(first.detail.history.items.map(run => run.id), [122]);
  const revalidated = await cachedGitHubDetail(db, fetcher, 'fixture-token', 'histories', 123, now + 16 * 60000);
  assert.deepEqual(revalidated.detail.history.items, first.detail.history.items);
  assert.deepEqual(paths.map(path => path[1]), [undefined, undefined, '"run"', '"history"']);
});

test('owner-only GET validates the route and shares bounded PR detail between isolates', async t => {
  const DB = database(t);
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer detail-token');
    assert.equal(options.redirect, 'manual');
    if (url === provider + '/pulls/12/files?per_page=20') return Response.json([
      { filename: 'new.txt', previous_filename: 'old.txt', status: 'renamed', additions: 3, deletions: 1, patch: 'never-copy-private-provider-fields' },
      { filename: 'another.txt', status: 'modified', additions: 10, deletions: 4 },
    ]);
    if (url === provider + '/pulls/12/reviews?per_page=20') return Response.json([
      { id: 42, user: { login: 'reviewer' }, state: 'APPROVED', body: 'never-copy-private-provider-fields' },
    ]);
    if (url === provider + '/pulls/12/commits?per_page=20') return Response.json([
      { sha, commit: { committer: { date:'2026-01-02T00:00:00Z' }, message:'never-copy-private-provider-fields' } },
    ]);
    assert.equal(url, provider + '/pulls/12');
    return Response.json({ ...pull(12), commits:1, body: 'a'.repeat(8001) }, { headers: { etag: '"first"' } });
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
  assert.deepEqual(first.detail.files[0], { path: 'new.txt', status: 'renamed', additions: 3, deletions: 1, previous_path: 'old.txt' });
  assert.deepEqual(first.detail.reviews[0], { id: 42, author: 'reviewer', state: 'APPROVED', submitted_at: null });
  assert.equal(first.detail.files_status, 'available');
  assert.equal(first.detail.reviews_status, 'available');
  const ref=uri=>({uri});
  const references=[ref(first.detail.url),ref(first.detail.url+'/files'),
    ref('https://github.com/other/project/pull/12'),ref('https://github.com/Kgray44/Aetherwake/pull/99')];
  const snapshots=await peekTaskGitHubDetails(DB,'detail-token',references);
  assert.equal(snapshots.length,1);
  assert.deepEqual(snapshots[0].reviews,[{id:42,state:'APPROVED',submitted_at:null}]);
  assert.deepEqual(snapshots[0].commit_items,[{revision:sha,committed_at:'2026-01-02T00:00:00.000Z'}]);
  assert.equal(snapshots[0].commit_head,sha);
  assert.equal(snapshots[0].commits_status,'available');
  assert.equal(Object.hasOwn(snapshots[0],'files'),false);
  assert.equal(Object.hasOwn(snapshots[0],'body'),false);
  assert.equal((await peekTaskGitHubDetails(DB,'detail-token',[ref(first.detail.url)],Date.now()+24*60*60000))[0].status,'stale');
  assert.deepEqual(await peekTaskGitHubDetails(DB,'wrong-credential',references),[]);
  assert.deepEqual(await peekTaskGitHubDetails(DB,'detail-token',[ref('https://github.com/other/project/pull/12')]),[]);
  assert.equal(calls, 4);
});

test('an inconsistent commit list after a PR head change leaves commit coverage unavailable',async t=>{
  const db = database(t);
  const changed = 'b'.repeat(40);
  const start = Date.now();
  let head = sha;
  let status = 200;
  const respond = async (url,{headers})=>{
    if (url === provider+'/pulls/12') return Response.json({...pull(12),head:{ref:'topic',sha:head},commits:1});
    if (url.includes('/files?')) return Response.json([
      {filename:'one',status:'added'}, {filename:'two',status:'added'},
    ]);
    if (url.includes('/reviews?')) return Response.json([]);
    assert.equal(url,provider+'/pulls/12/commits?per_page=20');
    assert.equal(headers['If-None-Match'],status===304?'"commits"':undefined);
    if (status===304) return new Response(null,{status,headers:{etag:'"commits"'}});
    return Response.json([{sha}],{headers:{etag:'"commits"'}});
  };
  const first = await cachedGitHubDetail(db,respond,'fixture-token','pulls',12,start);
  assert.equal(first.detail.commits_status,'available');
  status = 304;
  const unchanged = await cachedGitHubDetail(db,respond,'fixture-token','pulls',12,start+16*60000);
  assert.deepEqual(unchanged.detail.commit_items,first.detail.commit_items);
  assert.equal(unchanged.detail.commits_status,'available');
  head = changed;
  status = 200;
  const mismatch = await cachedGitHubDetail(db,respond,'fixture-token','pulls',12,start+32*60000);
  assert.equal(mismatch.detail.commits_status,'unavailable');
  assert.deepEqual(mismatch.detail.commit_items,[]);
});

test('uses conditional exact-attempt job reads, limits jobs and suppresses raw provider data', async t => {
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
    if (headers.Authorization === 'Bearer original') return new Response(null, { status: 401 });
    if (url.includes('per_page')) return Response.json([]);
    return Response.json({ ...pull(14), changed_files: 0 });
  };
  const denied = await cachedGitHubDetail(db, upstream, 'original', 'pulls', 12, now);
  assert.equal(denied.reason, 'GitHub read credential rejected');
  assert.equal((await cachedGitHubDetail(db, upstream, undefined, 'pulls', 13, now + 1)).status, 'unavailable');
  assert.equal((await cachedGitHubDetail(db, upstream, 'original', 'pulls', 13, now + 2)).reason, denied.reason);
  const overview = await cachedGitHub(db, upstream, allow, 'original', now + 3);
  assert.equal(overview.api.authentication, 'rejected');
  assert.equal((await cachedGitHubDetail(db, upstream, 'rotated', 'pulls', 14, now + 4)).status, 'available');
  assert.deepEqual(attempts, ['Bearer original', 'Bearer rotated', 'Bearer rotated', 'Bearer rotated']);
});

test('PR sections reuse validators and retain their own observation times on a partial refresh', async t => {
  const db = database(t);
  const now = Date.now();
  let attempted = 0;
  const upstream = async (url, { headers }) => {
    if (url.endsWith('/pulls/12')) return headers['If-None-Match'] ? new Response(null, { status: 304 })
      : Response.json({ ...pull(12), changed_files: 21 }, { headers: { etag: '"core"' } });
    if (url.endsWith('/files?per_page=20')) {
      if (headers['If-None-Match']) {
        assert.equal(headers['If-None-Match'], '"files"');
        return new Response(null, { status: 304 });
      }
      return Response.json(Array.from({ length: 20 }, (_, i) => ({ filename: i + '.txt', status: 'added' })),
        { headers: { etag: '"files"' } });
    }
    assert.ok(url.endsWith('/reviews?per_page=20'));
    if (attempted++) return new Response(null, { status: 503 });
    return Response.json([{ id: 1, state: 'COMMENTED' }], { headers: { etag: '"reviews"' } });
  };
  const first = await cachedGitHubDetail(db, upstream, 'fixture-token', 'pulls', 12, now);
  assert.equal(first.status, 'partial');
  assert.equal(first.detail.files_truncated, true);
  assert.equal(first.detail.files.length, 20);
  const next = await cachedGitHubDetail(db, upstream, 'fixture-token', 'pulls', 12, now + 16 * 60_000);
  assert.equal(next.detail.files_status, 'partial');
  assert.notEqual(next.detail.files_observed_at, first.detail.files_observed_at);
  assert.equal(next.detail.reviews_status, 'stale');
  assert.deepEqual(next.detail.reviews, first.detail.reviews);
  assert.equal(next.detail.reviews_observed_at, first.detail.reviews_observed_at);
});
