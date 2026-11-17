import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createWorker } from './worker.mjs';
import { cachedGitHub } from './github-cache.mjs';
import { proposedTask } from '../intake.mjs';

const schema = JSON.parse(readFileSync(new URL('../../contracts/v1.schema.json', import.meta.url)));
const validateEvent = addFormats(new Ajv2020({ strict: false })).compile(JSON.parse(readFileSync(new URL('../../contracts/trace-v1.schema.json',import.meta.url))));
const validate = addFormats(new Ajv2020({ strict: false })).compile(schema);
const migration = readFileSync(new URL('./drizzle/0000_proposals.sql', import.meta.url), 'utf8');
const rev = 'a'.repeat(40);
const blob = 'b'.repeat(40);
const origin = 'https://observatory.example';
const input = {
  title: 'Hosted proposal verification',
  objective: 'Validate proposal persistence in an isolated namespace.',
  primary: 'integration', profile_id: 'integration', criteria: ['Read it after reload'],
  state: 'accepted', owner_acceptance: 'accepted',
};
const cacheMigration = readFileSync(new URL('./drizzle/0001_github_snapshot.sql', import.meta.url), 'utf8');
const conditionalCacheMigration = readFileSync(new URL('./drizzle/0005_github_conditional_cache.sql', import.meta.url), 'utf8');
const detailCacheMigration = readFileSync(new URL('./drizzle/0006_github_details.sql', import.meta.url), 'utf8');
const namespace = 'c0cf1399-8a73-4f08-9b10-997063853638';
const published = proposedTask({ ...input, title: 'Published contract record' }, rev);
const ownerHeader = { 'oai-authenticated-user-id': 'owner-1' };

function fixture(t, { missingMain = false, token, writeStatus = 201 } = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(migration);
  sql.exec(cacheMigration);
  sql.exec(readFileSync(new URL('./drizzle/0002_private_projection.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0003_proposal_publication.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0004_cached_proposal_revision.sql', import.meta.url), 'utf8'));
  sql.exec(conditionalCacheMigration);
  sql.exec(detailCacheMigration);
  sql.exec(readFileSync(new URL('./drizzle/0007_proposal_controls.sql', import.meta.url), 'utf8'));
  let rateLimited = false;
  const writes = [];
  const DB = {
    prepare(statement) {
      const stmt = sql.prepare(statement);
      return { bind: (...args) => ({
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
        run: async () => ({ meta: stmt.run(...args) }),
      }) };
    },
  };

  const requests = [];
  const fetcher = async (path, options) => {
    assert.equal(options.redirect, 'manual');
    const { pathname, searchParams } = new URL(path);
    requests.push(path);
    if (token) assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (options.method === 'PUT') {
      assert.match(pathname, /\/contents\/Proposed%20Tasks\/task_[a-f0-9-]+\.json$/);
      writes.push(JSON.parse(options.body));
      return new Response(null, { status: writeStatus });
    }
    if (rateLimited) {
      return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    }
    if (pathname === '/graphql') return githubTotalsResponse(options);
    if (pathname.endsWith('/git/ref/heads/main')) {
      return missingMain
        ? new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
        : Response.json({ ref: 'refs/heads/main', object: { sha: rev } });
    }
    if (pathname.endsWith('/contents/agent-system/records')) {
      assert.equal(searchParams.get('ref'), rev);
      return Response.json([{ type: 'file', path: 'agent-system/records/task.json', size: 2048, sha: blob }]);
    }
    if (pathname.endsWith('/git/blobs/' + blob)) {
      const contents = JSON.stringify([published, { ...published, id: 'invalid', acceptance: {} }]);
      return Response.json({ sha: blob, encoding: 'base64', content: Buffer.from(contents).toString('base64') });
    }
    if (pathname.endsWith('/contents/agent-system/observatory/records')) return new Response(null, { status: 404 });
    if (pathname.endsWith('/issues')) {
      return Response.json([{ number: 5, title: 'An issue', state: 'open' }, { number: 6, pull_request: {} }]);
    }
    if (pathname.endsWith('/pulls')) return Response.json([{ number: 6, title: 'A PR', state: 'closed', head: { sha: blob } }]);
    if (pathname.endsWith('/actions/runs')) return new Response(null, { status: 503 });
    assert.fail('Unexpected fetch: ' + pathname);
  };
  // A new Worker instance for each request exercises shared D1 rather than isolate memory.
  const call = (path, options) => createWorker({ validate, validateEvent, assets: {}, sourceRevision: blob, fetcher })
    .fetch(new Request(origin + path, options), { DB, GITHUB_PROPOSAL_TOKEN: token });
  const post = (headers = {}) => call('/api/tasks', {
    method: 'POST', body: JSON.stringify(input),
    headers: { ...ownerHeader, origin, 'content-type': 'application/json', ...headers },
  });
  const hitLimit = () => {
    sql.exec('UPDATE github_snapshot SET retry_at = 0');
    rateLimited = true;
  };
  return { call, post, requests, hitLimit, writes };
}

test('hosted API checks identity and same-origin JSON before touching upstream', async t => {
  const { call, post, requests } = fixture(t);
  assert.equal((await call('/api/overview')).status, 401);
  assert.equal((await call('/api/tasks', { method: 'POST' })).status, 401);
  assert.equal((await post({ origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post({ origin: '' })).status, 403);
  assert.equal((await post({ 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await post({ 'content-type': 'application/jsonx' })).status, 415);
  assert.equal((await post({ 'x-observatory-verification': 'live' })).status, 400);
  assert.equal(requests.length, 0);
});

test('private proposal control applies one versioned edit, fences concurrent writes and isolates owners', async t => {
  const { call, post } = fixture(t);
  const { task } = await (await post()).json();
  const path = '/api/tasks/' + task.id + '/control';
  const headers = { ...ownerHeader, origin, 'content-type': 'application/json' };
  const send = (action, overrides = {}) => call(path, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(action) });
  const edit = {
    operation_id: crypto.randomUUID(), expected_version: 1, type: 'edit',
    fields: { ...input, title: 'Updated proposal', priority: 'high', requirements: [{ kind: 'issue', uri: 'https://github.com/Kgray44/Aetherwake/issues/5' }] },
  };
  assert.equal((await send(edit, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await send(edit, { 'oai-authenticated-user-id': 'owner-2' })).status, 404);
  assert.equal((await send(edit, { 'x-observatory-verification': namespace })).status, 404);
  const responses = await Promise.all([send(edit), send({ ...edit, operation_id: crypto.randomUUID() })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const saved = await responses.find(response => response.ok).json();
  assert.equal(saved.version, 2);
  assert.equal(saved.task.owner_acceptance, 'not_reviewed');
  assert.equal(saved.task.state, 'proposed');
  assert.equal(saved.priority, 'high');
  assert.equal(saved.task.acceptance.criteria[0].id, task.acceptance.criteria[0].id);
  const replay = await send({ ...edit, operation_id: saved.history[0].operation_id });
  assert.equal((await replay.json()).history.length, 1);
  assert.equal((await send({ ...edit, operation_id: saved.history[0].operation_id, fields: { ...edit.fields, title: 'Changed operation request' } })).status, 409);
  const transition = { operation_id: crypto.randomUUID(), expected_version: 2, type: 'transition', reason: 'Waiting for recorded evidence' };
  assert.equal((await send({ ...transition, state: 'accepted' })).status, 409);
  assert.equal((await send({ ...transition, state: 'superseded', superseded_by: task.id })).status, 400);
  const blocked = await (await send({ ...transition, state: 'blocked' })).json();
  assert.equal(blocked.task.state, 'blocked');
  assert.equal(blocked.version, 3);
  assert.equal((await send({ ...edit, operation_id: crypto.randomUUID(), expected_version: 3 })).status, 409);
  const { task: publicTask } = await (await post({ 'x-observatory-publish': 'github' })).json();
  const publicControl = '/api/tasks/' + publicTask.id + '/control';
  assert.equal((await call(publicControl, { headers })).status, 404);
  assert.equal((await call(publicControl, { method: 'POST', headers, body: JSON.stringify(edit) })).status, 404);
});

test('a contract-valid proposal persists with owner and verification boundaries', async t => {
  const { call, post } = fixture(t);
  const headers = { ...ownerHeader, 'x-observatory-verification': namespace };
  const result = await post(headers);
  assert.equal(result.status, 201);
  const { task } = await result.json();
  assert.ok(validate(task));
  assert.equal(task.state, 'proposed');
  assert.equal(task.owner_acceptance, 'not_reviewed');
  assert.equal(task.revision, rev);

  const overview = await call('/api/overview', { headers });
  assert.equal(overview.status, 200);
  assert.equal(overview.headers.get('cache-control'), 'private, no-store');
  const data = await overview.json();
  assert.deepEqual(data.records.find(record => record.id === task.id), task);
  assert.equal(data.proposals.verification, true);
  assert.equal(data.deployed_revision, blob);
  assert.equal(data.github.records.status, 'partial');
  assert.equal(data.github.records.rejected, 1);
  assert.equal(data.github.records.provenance[0].blob, blob);
  assert.deepEqual(data.github.issues.items.map(item => item.label), ['#5']);
  assert.deepEqual(data.github.pulls.items.map(item => item.label), ['#6']);
  assert.equal(data.github.ci.status, 'unavailable');
  assert.equal(data.records.length, 2);
  for (const otherHeaders of [ownerHeader, { ...headers, 'oai-authenticated-user-id': 'owner-2' }]) {
    const other = await call('/api/overview', { headers: otherHeaders });
    assert.equal((await other.json()).records.some(record => record.id === task.id), false);
  }
});

test('GitHub failure remains visible and intake requires a resolved main SHA', async t => {
  const { call, post, requests } = fixture(t, { missingMain: true });
  const response = await call('/api/overview', { headers: ownerHeader });
  const data = await response.json();
  assert.equal(data.revision, null);
  assert.equal(data.github.records.status, 'unavailable');
  assert.equal(data.github.issues.status, 'unavailable');
  assert.equal((await post()).status, 503);
  assert.equal(requests.length, 1);
});


test('Worker instances share GitHub results and keep last good data through a rate limit', async t => {
  const { call, post, requests, hitLimit } = fixture(t);
  const read = async () => {
    const result = await call('/api/overview', { headers: ownerHeader });
    assert.equal(result.status, 200);
    return result.json();
  };
  const initial = await read();
  const initialCount = requests.length;
  assert.equal(initial.github.pulls.status, 'available');
  assert.deepEqual((await read()).github, initial.github);
  assert.equal(requests.length, initialCount);

  hitLimit();
  const limited = await read();
  assert.equal(limited.github.pulls.status, 'stale');
  assert.equal(limited.github.pulls.reason, 'GitHub rate limit reached');
  assert.deepEqual(limited.github.pulls.items, initial.github.pulls.items);
  assert.equal(limited.github.pulls.observed_at, initial.github.pulls.observed_at);
  assert.ok(limited.github.retry_at >= Date.now() + 115_000);
  const limitedCount = requests.length;
  assert.deepEqual((await read()).github, limited.github);
  assert.equal((await post({ 'x-observatory-publish': 'github' })).status, 503);
  assert.equal(requests.length, limitedCount);
});

function cacheFixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(cacheMigration);
  sql.exec(conditionalCacheMigration);
  sql.exec(detailCacheMigration);
  return {
    prepare(statement) {
      const stmt = sql.prepare(statement);
      return { bind: (...args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => ({ meta: stmt.run(...args) }),
      }) };
    },
  };
}

function githubReadResponse(path, headers = {}) {
  if (path.startsWith('/git/ref/')) return Response.json({ ref: 'refs/heads/main', object: { sha: rev } }, { headers });
  if (path.startsWith('/actions/runs')) return Response.json({ total_count: 812, workflow_runs: [{ id: 11, name:'CI', head_sha: rev }] }, { headers });
  if (path.startsWith('/issues')) return Response.json([{ number: 9, title:'Recent issue' }], { headers });
  if (path.startsWith('/pulls')) return Response.json([{ number: 10, title:'Recent pull request' }], { headers });
  if (path.startsWith('/contents/')) return new Response(null, { status: 404 });
  assert.fail('Unexpected route: ' + path);
}

function githubTotalsResponse(options, {nameWithOwner='Kgray44/Aetherwake', total=300, headers={}} = {}) {
  assert.equal(options.method, 'POST');
  assert.match(options.headers.Authorization, /^Bearer /);
  assert.equal(options.redirect, 'manual');
  const {query} = JSON.parse(options.body);
  assert.match(query, /repository\(owner: "Kgray44", name: "Aetherwake"\)/);
  for (const state of ['OPEN', 'MERGED', 'CLOSED']) assert.ok(query.includes('states: [' + state + ']'));
  assert.doesNotMatch(query, /\bmutation\b/);
  return Response.json({data:{repository:{
    nameWithOwner, all:{totalCount:total}, open:{totalCount:20}, merged:{totalCount:250}, closed:{totalCount:30},
  }}}, {headers});
}

function requestPath(url) {
  return new URL(url).pathname === '/graphql' ? '/graphql' : url.replace('https://api.github.com/repos/Kgray44/Aetherwake', '');
}

test('authenticated 304s reuse each validated snapshot and skip complete immutable records', async t => {
  const db = cacheFixture(t);
  const now = Date.now();
  const requests = [];
  let active = false;
  let revalidate = false;
  const respond = async (url, options) => {
    const {headers} = options;
    assert.equal(active, false, 'upstream requests run serially');
    active = true;
    await new Promise(resolve => setTimeout(resolve, 1));
    active = false;
    const path = requestPath(url);
    requests.push(path);
    assert.equal(headers.Authorization, 'Bearer fixture-token');
    if (path === '/graphql') return githubTotalsResponse(options, {headers:{'x-ratelimit-remaining':'10','x-ratelimit-limit':'50'}});
    if (/^(\/issues|\/pulls)\?/.test(path)) assert.equal(new URL(url).searchParams.get('direction'), 'desc');
    if (path.startsWith('/contents/')) return githubReadResponse(path);
    const etag = '"validator-' + path.split(/[/?]/)[1] + '"';
    if (revalidate) {
      assert.equal(headers['If-None-Match'], etag);
      return new Response(null, { status: 304 });
    }
    assert.equal(headers['If-None-Match'], undefined);
    return githubReadResponse(path, {
      etag, 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4995',
      'x-ratelimit-reset': String(Math.round((now + 3_600_000) / 1000)),
    });
  };
  const first = await cachedGitHub(db, respond, validate, 'fixture-token', now);
  assert.equal(requests.length, 7);
  assert.equal(first.api.authentication, 'authenticated');
  assert.equal(first.api.limit, 5000);
  assert.equal(first.api.remaining, 4995);
  assert.deepEqual(Object.keys(first.api).sort(), ['authentication','limit','observed_at','remaining','reset_at']);
  assert.equal(first.records.status, 'available');
  revalidate = true;
  const second = await cachedGitHub(db, respond, validate, 'fixture-token', now + 16 * 60_000);
  assert.equal(requests.length, 12, 'four mutable REST groups revalidated and repository totals refreshed');
  for (const key of ['issues','pulls','ci']) assert.equal(JSON.stringify(second[key].items), JSON.stringify(first[key].items));
  assert.equal(second.main.revision, first.main.revision);
  assert.equal(second.ci.repository_total, 812);
  assert.deepEqual(second.pulls.totals, {status:'available', observed_at:second.pulls.totals.observed_at, total:300, open:20, merged:250, closed:30, reason:null});
  assert.ok(second.pulls.totals.observed_at > first.pulls.totals.observed_at);
  assert.deepEqual(requests.filter(path => path === '/graphql'), ['/graphql','/graphql']);
  assert.ok(second.main.observed_at > first.main.observed_at);
  assert.equal(second.records.observed_at, first.records.observed_at);
  assert.deepEqual(second.api, first.api, '304 without budget headers keeps the last observed budget');
  assert.doesNotMatch(JSON.stringify(second), /fixture-token|validator-/);
});

test('a rejected or missing credential serves stale data and rotation clears validators', async t => {
  const db = cacheFixture(t);
  const now = Date.now();
  const requests = [];
  let reject = false;
  const respond = async (url, options) => {
    const {headers} = options;
    const path = requestPath(url);
    requests.push(path);
    assert.ok(headers.Authorization, 'anonymous fallback attempted');
    if (reject) return Response.json({message:'Bad credentials'}, {status:401});
    if (headers.Authorization === 'Bearer fixture-rotated') assert.equal(headers['If-None-Match'], undefined);
    return path === '/graphql' ? githubTotalsResponse(options) : githubReadResponse(path, {etag:'"first"'});
  };
  const first = await cachedGitHub(db, respond, validate, 'fixture-original', now);
  assert.equal(first.api.authentication, 'authenticated');
  assert.equal(requests.length, 7);
  reject = true;
  const later = now + 16 * 60_000;
  const refused = await cachedGitHub(db, respond, validate, 'fixture-original', later);
  assert.equal(requests.length, 8, 'credential rejection stops the whole batch');
  assert.equal(refused.api.authentication, 'rejected');
  assert.equal(refused.main.status, 'stale');
  assert.equal(JSON.stringify(refused.pulls.items), JSON.stringify(first.pulls.items));
  const missing = await cachedGitHub(db, respond, validate, undefined, later + 1000);
  assert.equal(missing.api.authentication, 'missing');
  assert.equal(missing.ci.status, 'stale');
  assert.equal(requests.length, 8, 'a lost configured binding never sends an anonymous request');
  reject = false;
  const rotated = await cachedGitHub(db, respond, validate, 'fixture-rotated', later + 2000);
  assert.equal(rotated.api.authentication, 'authenticated');
  assert.equal(rotated.main.status, 'available');
  assert.equal(requests.length, 13, 'a new binding is verified immediately even during prior auth cooldown');
});

test('success at zero budget honors both Retry-After and reset across visitors and rotation', async t => {
  const db = cacheFixture(t);
  const now = Date.now();
  const reset = Math.floor(now / 1000) * 1000 + 180_000;
  const requests = [];
  const respond = async url => {
    const path = requestPath(url);
    requests.push(path);
    return githubReadResponse(path, {
      'retry-after':'120', 'x-ratelimit-remaining':'0', 'x-ratelimit-limit':'5000',
      'x-ratelimit-reset':String(reset / 1000),
    });
  };
  const first = await cachedGitHub(db, respond, validate, 'some-token', now);
  assert.equal(first.main.status, 'available');
  assert.equal(first.issues.status, 'unavailable');
  assert.equal(first.api.remaining, 0);
  assert.equal(first.api.reset_at, new Date(reset).toISOString());
  assert.equal(first.retry_at, reset + 1000);
  assert.equal(requests.length, 1);
  const second = await cachedGitHub(db, respond, validate, 'another-token', now + 130_000);
  assert.equal(second.api.authentication, 'unverified');
  assert.equal(second.api.remaining, null);
  assert.equal(second.main.status, 'stale');
  assert.equal(second.retry_at, first.retry_at);
  assert.equal(requests.length, 1);
});

test('pull requests and cross-branch runs expose a bounded newest-created window', async t => {
  const db = cacheFixture(t);
  const paths = [];
  const dateAt = value => new Date(Date.parse('2026-01-01T00:00:00Z') + 1000 * value).toISOString();
  const respond = async (url, options) => {
    const path = requestPath(url);
    const query = new URL(url).searchParams;
    paths.push(path);
    if (path === '/graphql') return githubTotalsResponse(options);
    if (path.startsWith('/pulls')) {
      assert.equal(query.get('sort'), 'created');
      assert.equal(query.get('direction'), 'desc');
      assert.equal(query.get('per_page'), '40');
      return Response.json(Array.from({length:42}, (_, index) => ({
        id: 1000 + index, number: 100 + index, title: 'Pull ' + index,
        state: 'closed', created_at: dateAt(index), updated_at: dateAt(200 - index),
        user: {login:'contributor'}, head: {ref:'feature',sha:rev}, base:{ref:'main'},
        draft: false, merged_at: index === 41 ? dateAt(46) : null,
      })));
    }
    if (path.startsWith('/actions/runs')) {
      assert.equal(query.get('branch'), null);
      assert.equal(query.get('per_page'), '40');
      return Response.json({workflow_runs:Array.from({length:42}, (_,index) => ({
        id: 2000 + index, name:'Verification', display_title:'Run ' + index,
        created_at:dateAt(index), updated_at:dateAt(200 - index), actor:{login:'contributor'}, head_sha:rev,
        head_branch:index % 2 ? 'feature' : 'main', event:'pull_request', run_attempt:2, status:'completed', conclusion:'success',
      }))});
    }
    return githubReadResponse(path);
  };
  const snapshot = await cachedGitHub(db, respond, validate, 'fixture-token');
  assert.equal(paths.filter(path => path.startsWith('/pulls')).length, 1);
  assert.equal(paths.filter(path => path.startsWith('/actions/runs')).length, 1);
  assert.equal(snapshot.pulls.items.length, 40);
  assert.equal(snapshot.ci.items.length, 40);
  assert.deepEqual(snapshot.pulls.items[0], {
    id:1041, number:141, label:'#141', title:'Pull 41', state:'closed',
    url:'https://github.com/Kgray44/Aetherwake/pull/141', revision:rev,
    date:dateAt(159), created_at:dateAt(41), updated_at:dateAt(159), author:'contributor',
    head_ref:'feature', base_ref:'main', draft:false, merged:true, merged_at:dateAt(46),
  });
  assert.equal(snapshot.pulls.items[1].merged, false);
  assert.deepEqual(snapshot.ci.items[0], {
    id:2041, label:'Verification', title:'Run 41', state:'success',
    url:'https://github.com/Kgray44/Aetherwake/actions/runs/2041', revision:rev,
    date:dateAt(159), created_at:dateAt(41), updated_at:dateAt(159), author:'contributor',
    branch:'feature', workflow:'Verification', event:'pull_request', attempt:2, status:'completed', conclusion:'success',
  });
  assert.equal(snapshot.ci.items[1].branch, 'main');
});

test('repository totals retain last verified counts after invalid or throttled GraphQL responses', async t => {
  const db = cacheFixture(t);
  const now = Date.now();
  const visits = [];
  let graph = 'valid';
  const respond = async (url, options) => {
    const path = requestPath(url);
    visits.push(path);
    if (path !== '/graphql') return githubReadResponse(path, {'x-ratelimit-remaining':'4500','x-ratelimit-limit':'5000'});
    if (graph === 'sum') return githubTotalsResponse(options, {total:999});
    if (graph === 'repository') return githubTotalsResponse(options, {nameWithOwner:'different/repository'});
    if (graph === 'rate') return Response.json({errors:[{type:'RATE_LIMITED'}]}, {headers:{'Retry-After':'120','x-ratelimit-remaining':'0'}});
    return githubTotalsResponse(options);
  };
  const anonymous = await cachedGitHub(db, respond, validate, undefined, now);
  assert.equal(anonymous.pulls.totals.status, 'unavailable');
  assert.equal(anonymous.pulls.totals.total, null);
  assert.ok(!visits.includes('/graphql'));
  const valid = await cachedGitHub(db, respond, validate, 'fixture-token', now + 1000);
  assert.equal(valid.pulls.totals.total, 300);
  assert.equal(valid.pulls.items.length, 1);
  for (const [index, failure] of ['sum','repository','rate'].entries()) {
    graph = failure;
    const later = now + (index + 1) * 16 * 60_000;
    const observed = await cachedGitHub(db, respond, validate, 'fixture-token', later);
    assert.equal(observed.api.remaining, 4500);
    assert.equal(observed.pulls.status, 'available');
    assert.equal(observed.pulls.totals.status, 'stale');
    assert.equal(observed.pulls.totals.total, 300);
    assert.equal(observed.pulls.totals.observed_at, valid.pulls.totals.observed_at);
    if (failure === 'rate') {
      assert.ok(observed.retry_at >= later + 120_000);
      const before = visits.length;
      const waiting = await cachedGitHub(db, respond, validate, 'fixture-token', later + 1000);
      assert.equal(waiting.pulls.totals.total, 300);
      assert.equal(visits.length, before, 'the cooldown is shared across readers');
    }
  }
});

test('unhinted secondary rate limit backs off exponentially and keeps one lease', async t => {
  const db = cacheFixture(t);
  const now = Date.now();
  let requests = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const respond = async () => {
    requests++;
    started();
    await gate;
    return Response.json({ message:'You have exceeded a secondary rate limit.' }, { status:403 });
  };
  const refresh = cachedGitHub(db, respond, validate, 'fixture-token', now);
  await start;
  const waiting = await cachedGitHub(db, respond, validate, 'rotated-token', now + 1);
  assert.equal(waiting.api.authentication, 'unverified');
  assert.equal(requests, 1, 'token changes cannot start a simultaneous upstream refresh');
  release();
  const first = await refresh;
  assert.ok(first.retry_at >= now + 61_000 && first.retry_at < now + 62_000);
  const second = await cachedGitHub(db, respond, validate, 'fixture-token', first.retry_at + 1);
  assert.ok(second.retry_at >= first.retry_at + 121_000 && second.retry_at < first.retry_at + 122_000);
  assert.equal(requests, 2);
});


test('private export sync is authenticated, origin-bound, persistent and isolated',async t=>{
 const {call}=fixture(t);
 const envelope={export_version:1,authority:'local-task-records',repository:'Kgray44/Aetherwake',generated_at:'2026-11-16T06:00:00.000Z',records:[proposedTask(input,rev)],events:[],coverage:{}};
 envelope.events.push({trace_version:1,event_id:'event_test',task_id:envelope.records[0].id,trace_id:'trace_test',span_id:'span_test',repository:envelope.repository,revision:rev,occurred_at:envelope.generated_at,kind:'measurement',phase:'verification',measurements:[{name:'elapsed_ms',availability:'observed',value:12,unit:'ms',source:'process',method:'monotonic_clock'}]});
 const send=headers=>call('/api/sync',{method:'POST',headers,body:JSON.stringify(envelope)});
 assert.equal((await send({'content-type':'application/json',origin})).status,401);
 assert.equal((await send({...ownerHeader,'content-type':'application/json',origin:'https://foreign.example'})).status,403);
 const headers={...ownerHeader,'content-type':'application/json',origin,'x-observatory-verification':namespace};
 assert.equal((await send(headers)).status,200);
 assert.equal((await send(headers)).status,200);
 const observed=await (await call('/api/overview',{headers})).json();
 assert.equal(observed.execution.authority,'local-task-records');
 assert.equal(observed.records.find(r=>r.id===envelope.records[0].id).objective,'Private task details withheld');
 assert.equal((await (await call('/api/overview',{headers:ownerHeader})).json()).execution,null);
 assert.equal((await (await call('/api/overview',{headers:{...headers,'oai-authenticated-user-id':'other'}})).json()).execution,null);
 assert.equal(observed.execution.events[0].measurements[0].value,12);
 envelope.events[0].prompt='must not leak';assert.equal((await send(headers)).status,400);delete envelope.events[0].prompt;
 envelope.records[0].owner_acceptance='accepted';assert.equal((await send(headers)).status,400);
});
test('MCP uses authenticated caller identity, narrow tools, private projection receipts and isolation',async t=>{
 const {call}=fixture(t);
 const rpc=(method,params,headers={...ownerHeader,'content-type':'application/json'})=>call('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 assert.equal((await rpc('tools/list',{}, {'content-type':'application/json'})).status,401);
 assert.equal((await rpc('tools/list',{}, {...ownerHeader,'content-type':'application/json',origin:'https://attacker.example'})).status,403);
 const listed=await(await rpc('tools/list')).json();assert.deepEqual(listed.result.tools.map(t=>t.name),['project_execution_snapshot','read_execution_projection']);
 const envelope={export_version:1,authority:'local-task-records',repository:'Kgray44/Aetherwake',generated_at:'2026-11-16T06:00:00.000Z',records:[proposedTask(input,rev)],events:[],coverage:{}};
 const params={name:'project_execution_snapshot',arguments:{projection:envelope,verification:namespace}};
 const saved=await(await rpc('tools/call',params)).json();assert.equal(saved.result.isError,false);
 const receipt=JSON.parse(saved.result.content[0].text);assert.match(receipt.digest,/^sha256:[a-f0-9]{64}$/);
 const readParams={name:'read_execution_projection',arguments:{verification:namespace}};
 const loaded=JSON.parse((await(await rpc('tools/call',readParams)).json()).result.content[0].text);assert.deepEqual(loaded.receipt,receipt);
 const foreign=JSON.parse((await(await rpc('tools/call',readParams,{'oai-authenticated-user-id':'foreign','content-type':'application/json'})).json()).result.content[0].text);assert.equal(foreign.projection,null);
 const live=JSON.parse((await(await rpc('tools/call',{name:'read_execution_projection',arguments:{}})).json()).result.content[0].text);assert.equal(live.projection,null);
 assert.equal((await(await rpc('tools/call',{name:'execute',arguments:{}})).json()).error.code,-32601);
 params.arguments.owner_id='foreign';assert.equal((await(await rpc('tools/call',params)).json()).error.code,-32602);delete params.arguments.owner_id;
 envelope.records[0].owner_acceptance='accepted';assert.equal((await(await rpc('tools/call',params)).json()).result.isError,true);
});


test('fabricated passing evidence without an attempt never becomes accepted in the projected UI',async t=>{
 const {call}=fixture(t);
 const task=proposedTask(input,rev);
 const evidence={schema_version:1,record_type:'evidence',id:'fabricated_pass',created_at:'2026-11-16T06:00:00.000Z',repository:task.repository,revision:rev,task_id:task.id,attempt_id:'nonexistent_attempt',criterion_id:task.acceptance.criteria[0].id,kind:'test',result:'passed',synthetic:false,observed_at:'2026-11-16T06:00:00.000Z',artifact:{kind:'artifact',uri:'claimed:test'}};
 const projection={export_version:1,authority:'local-task-records',repository:task.repository,generated_at:'2026-11-16T06:00:00.000Z',records:[task,evidence],events:[],coverage:{}};
 const headers={...ownerHeader,'content-type':'application/json',origin,'x-observatory-verification':namespace};
 assert.equal((await call('/api/sync',{method:'POST',headers,body:JSON.stringify(projection)})).status,200);
 const data=await(await call('/api/overview',{headers})).json();
 const projectedTask=data.records.find(r=>r.id===task.id);
 const claims=data.records.filter(r=>r.record_type==='evidence'&&r.task_id===task.id);
 assert.equal(data.records.some(r=>r.record_type==='attempt'&&r.id===evidence.attempt_id),false);
 const {criterionEvidenceStatus,evidenceClaimStatus}=await import('../src/evidence-status.mjs');
 assert.equal(criterionEvidenceStatus(claims,projectedTask.revision),'unverified_missing_attempt');
 assert.equal(evidenceClaimStatus(claims[0]),'unverified_missing_attempt');
 assert.equal(projectedTask.state,'proposed');
 assert.equal(projectedTask.owner_acceptance,'not_reviewed');
 assert.equal(data.execution.acceptance,'imported records are not approval receipts');
});


test('explicit public intake writes only proposed JSON to the intake branch and safely replays', async t => {
  const { call, post, writes } = fixture(t, { token: 'test-repository-token' });
  const request = { 'x-observatory-publish': 'github', 'x-observatory-request-id': namespace };
  const created = await post(request);
  assert.equal(created.status, 201);
  const { task, github } = await created.json();
  assert.equal(github.state, 'published');
  assert.match(github.url, /observatory-proposed-tasks\/Proposed%20Tasks\//);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].branch, 'observatory-proposed-tasks');
  assert.deepEqual(JSON.parse(Buffer.from(writes[0].content, 'base64').toString('utf8')), task);
  assert.equal(task.state, 'proposed');
  assert.equal(task.owner_acceptance, 'not_reviewed');
  const replay = await post(request);
  assert.equal((await replay.json()).task.id, task.id);
  assert.equal(writes.length, 1);
  const testOnly = await post({ ...request, 'x-observatory-verification': namespace });
  assert.equal(testOnly.status, 201);
  assert.equal((await testOnly.json()).github, null);
  assert.equal(writes.length, 1);
  const other = await call('/api/tasks/' + task.id + '/publish', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'other' },
  });
  assert.equal(other.status, 404);
});

test('a blocked GitHub write leaves a durable, retryable proposal', async t => {
  const { call, post, writes } = fixture(t, { token: 'test-repository-token', writeStatus: 403 });
  const created = await post({ 'x-observatory-publish': 'github' });
  assert.equal(created.status, 201);
  const { task, github } = await created.json();
  assert.equal(github.state, 'pending');
  const overview = await call('/api/overview', { headers: ownerHeader });
  assert.equal((await overview.json()).proposals.publication[task.id], 'pending');
  assert.equal(writes.length, 1);
});

test('rate-limited GitHub permits private proposals bound to a known cached revision', async t => {
  const { call, post, hitLimit, writes } = fixture(t, { token: 'test-proposal-token' });
  assert.equal((await call('/api/overview', { headers: ownerHeader })).status, 200);
  hitLimit();

  const headers = { 'x-observatory-request-id': namespace };
  const response = await post(headers);
  assert.equal(response.status, 201);
  const { task, github, revision_was_stale } = await response.json();
  assert.equal(task.revision, rev);
  assert.equal(task.state, 'proposed');
  assert.equal(github, null);
  assert.equal(revision_was_stale, true);

  const replay = await post(headers);
  assert.equal((await replay.json()).revision_was_stale, true);
  const overview = await call('/api/overview', { headers: ownerHeader });
  const data = await overview.json();
  assert.equal(data.github.main.status, 'stale');
  assert.deepEqual(data.proposals.stale_revision_tasks, [task.id]);
  assert.deepEqual(data.proposals.publication, {});
  assert.equal((await post({ 'x-observatory-publish': 'github' })).status, 503);
  assert.equal(writes.length, 0);
});
