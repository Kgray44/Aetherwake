import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createWorker } from './worker.mjs';
import { cachedGitHub } from './github-cache.mjs';
import { proposedTask } from '../intake.mjs';
import { createTelemetryClient, readStagedSnapshot, retryTelemetry } from '../src/telemetry-client.mjs';
import { codexTurnObservation } from '../codex-turn-observation.mjs';
import { sha256 } from './task-telemetry.mjs';

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

function fixture(t, { missingMain = false, token, writeStatus = 201, taskKey, assets = {} } = {}) {
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
  sql.exec(readFileSync(new URL('./drizzle/0008_ci_operations.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0009_task_telemetry.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0011_task_engine.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0012_task_trace_receipts.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0013_task_worker_liveness.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./drizzle/0014_task_worker_scope.sql', import.meta.url), 'utf8'));
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
  const call = (path, options) => createWorker({ validate, validateEvent, assets, sourceRevision: blob, fetcher })
    .fetch(new Request(origin + path, options), { DB, GITHUB_PROPOSAL_TOKEN: token, OBSERVATORY_TASK_ENGINE_OWNER_ID: 'owner-1', OBSERVATORY_TASK_WORKER_KEY: taskKey });
  const post = (headers = {}) => call('/api/tasks', {
    method: 'POST', body: JSON.stringify(input),
    headers: { ...ownerHeader, origin, 'content-type': 'application/json', ...headers },
  });
  const hitLimit = () => {
    sql.exec('UPDATE github_snapshot SET retry_at = 0');
    rateLimited = true;
  };
  return { call, post, requests, hitLimit, writes, sql };
}

test('linked Codex history persists once without rewriting managed Task execution', async t => {
  const { call,sql } = fixture(t);
  const scope = await sha256(JSON.stringify(['observatory-telemetry-v1','owner-1','live']));
  const headers = {...ownerHeader,origin,'content-type':'application/json','x-observatory-sync-scope':scope};
  const post = (path,body,overrides={})=>call(path,{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(body)});
  const registered = await (await post('/api/task-engine/v1',{
    op:'register',operation_id:crypto.randomUUID(),fields:input,
  })).json();
  const now = Math.floor(Date.now()/1000);
  const timestamp = seconds=>new Date(seconds*1000).toISOString();
  const task = {...registered.task,created_at:timestamp(now-900),state:'failed'};
  const session_id = crypto.randomUUID();
  const attempt = {id:'attempt_'+crypto.randomUUID(),session_id,state:'failed',started_at:timestamp(now-500),finished_at:timestamp(now-300)};
  const version = registered.version+1;
  const eventReceipt = {kind:'failed',operation_id:crypto.randomUUID(),version,state:'failed',at:attempt.finished_at};
  sql.prepare('UPDATE proposals SET record=?,engine=?,version=? WHERE task_id=?')
    .run(JSON.stringify(task),JSON.stringify({state:'failed',attempts:[attempt],event:eventReceipt}),version,task.id);
  const turn = {id:crypto.randomUUID(),startedAt:now-200,completedAt:now-100,status:'completed'};
  const eventId = 'codex-turn:'+session_id+':'+turn.id;
  const event = codexTurnObservation(task,[attempt],session_id,turn,[
    {item:{type:'userMessage',text:'private message'}},{item:{type:'commandExecution',command:'private command'}},
  ],false,await sha256(eventId));
  const request = {base:null,generated_at:timestamp(now),records:[task],events:[event]};
  const path = '/api/task-telemetry/'+task.id;
  const first = await post(path,request);
  assert.equal(first.status,200,await first.clone().text());
  const receipt = await first.json();
  assert.deepEqual(await (await post(path,request)).json(),receipt);
  const baseline = await (await call(path,{headers})).json();
  assert.equal(baseline.baseline.projection.events.length,1);
  assert.doesNotMatch(JSON.stringify(baseline),/private message|private command/);
  const forged = {...event,attempt_id:attempt.id};
  assert.ok((await post(path,{...request,events:[forged]})).status>=400);
  const duringAttempt = {...event,occurred_at:timestamp(now-400),measurements:event.measurements.map(metric=>
    metric.name.endsWith('_seconds')?{...metric,value:now-450}:metric)};
  assert.equal((await post(path,{...request,events:[duringAttempt]})).status,409);
  assert.ok((await post(path,request,{'oai-authenticated-user-id':'owner-2'})).status>=400);
  const current = await (await post('/api/task-engine/v1',{op:'get',task_id:task.id})).json();
  assert.equal(current.lifecycle.state,'failed');
  assert.deepEqual(current.attempts,[attempt]);
  assert.equal(current.version,version);
});

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

test('PDF renderer survives a deployment while an older Task tab remains open', async t => {
  const {call}=fixture(t,{assets:{
    '/assets/task-report.worker.js':{type:'text/javascript',content:'current renderer'},
    '/assets/task-report.worker-2v1c1DxX.js':{type:'text/javascript',content:'previous renderer'},
  }});
  for (const path of ['/assets/task-report.worker.js','/assets/task-report.worker-B2nFH3hs.js']) {
    const response=await call(path);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'text/javascript');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(await response.text(),'current renderer');
  }
  const present=await call('/assets/task-report.worker-2v1c1DxX.js');
  assert.equal(await present.text(),'previous renderer');
  assert.equal((await call('/assets/unrelated-B2nFH3hs.js')).status,404);
});

test('only fingerprinted static assets receive a long browser cache lifetime', async t => {
  const {call}=fixture(t,{assets:{
    '/':{type:'text/html',content:'index'},
    '/assets/index-a1234567.js':{type:'text/javascript',content:'code'},
    '/assets/shared.js':{type:'text/javascript',content:'code'},
  }});
  assert.equal((await call('/')).headers.get('cache-control'),'private, no-store');
  assert.equal((await call('/assets/index-a1234567.js')).headers.get('cache-control'),'private, max-age=31536000, immutable');
  assert.equal((await call('/assets/shared.js')).headers.get('cache-control'),'private, no-store');
});

test('cached-first overview serves private Tasks without making an upstream request', async t => {
  const {call,post,requests,hitLimit}=fixture(t,{token:'read-test-token'});
  const cold=await (await call('/api/overview?prefer=cached',{headers:ownerHeader})).json();
  assert.equal(cold.github_refresh_pending,true);
  assert.equal(cold.github.main.status,'unavailable');
  assert.equal(requests.length,0);
  const {task}=await (await post()).json();
  hitLimit();
  const before=requests.length;
  const local=await (await call('/api/overview?prefer=cached',{headers:ownerHeader})).json();
  assert.equal(local.github_refresh_pending,true);
  assert.equal(local.github.main.status,'stale');
  assert.equal(local.records.some(record=>record.id===task.id),true);
  assert.equal(requests.length,before);
  const refreshed=await (await call('/api/overview',{headers:ownerHeader})).json();
  assert.equal(refreshed.github_refresh_pending,false);
  assert.equal(refreshed.github.main.status,'stale');
  assert.ok(requests.length>before);
});

test('only the owner sees whether a Codex executor credential is configured',async t=>{
  const path='/api/task-engine/v1';
  const headers={...ownerHeader,origin,'content-type':'application/json'};
  const read=(call,identity={})=>call(path,{method:'POST',headers:{...headers,...identity},body:JSON.stringify({op:'list'})});
  const key='worker-test-only-credential-value-000000';
  const enabled=fixture(t,{taskKey:key});
  const configured=await (await read(enabled.call)).text();
  assert.deepEqual(JSON.parse(configured).executor_access,{codex:'configured'});
  assert.equal(configured.includes(key),false);
  const unauthorized=await (await read(enabled.call,{'oai-authenticated-user-id':'owner-2'})).json();
  assert.equal(unauthorized.executor_access,undefined);
  const disabled=fixture(t);
  assert.deepEqual((await (await read(disabled.call)).json()).executor_access,{codex:'not_configured'});
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

test('the automatic telemetry client resumes after a lost response, uploads only deltas and shows owner-scoped data', async t => {
  const { call, post, sql } = fixture(t);
  const isolation = { 'x-observatory-verification': namespace };
  const headers = { ...ownerHeader, ...isolation };
  const { task } = await (await post(headers)).json();
  const firstOverview = await (await call('/api/overview', { headers })).json();
  const scope = firstOverview.telemetry_scope;
  const path = '/api/task-telemetry/' + task.id;
  const posted = [];
  let loseReply = true;
  const client = () => createTelemetryClient({ headers: isolation, scope, fetcher: async (url, options) => {
    const response = await call(url, { ...options, headers: { ...ownerHeader, origin, ...options.headers } });
    if (options.method === 'POST') {
      posted.push(JSON.parse(options.body));
      if (loseReply) { loseReply = false; throw Error('transport closed after commit'); }
    }
    return response;
  } });
  const generated = Date.now() - 1000;
  const event = {
    trace_version: 1, event_id: 'telemetry-probe-event', task_id: task.id, trace_id: 'trace-probe',
    session_id: '10000000-0000-4000-8000-000000000001',
    span_id: 'span-probe', repository: task.repository, revision: task.revision,
    occurred_at: new Date(generated).toISOString(), kind: 'measurement', phase: 'verification',
    measurements: [{ name: 'elapsed_wall_ms', availability: 'observed', value: 45, unit: 'ms', source: 'fixture', method: 'fixture' }],
  };
  const file = (offset, events) => new Blob([JSON.stringify({
    export_version: 1, authority: 'local-task-records', repository: task.repository,
    generated_at: new Date(generated + offset).toISOString(), records: [task], events,
  })]);
  const { snapshot: first } = await readStagedSnapshot(file(0, [event]));
  await assert.rejects(client().synchronize(task.id, first), error => {
    assert.equal(retryTelemetry(error, 1, 1000), 3000);
    assert.equal(retryTelemetry(error, 4, 1000), null);
    return true;
  });
  assert.equal((await client().synchronize(task.id, first)).changed, false);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].records[0].objective, 'Private task details withheld');
  const firstReceipt = (await (await call('/api/overview', { headers })).json()).execution.sources[0];
  assert.equal(firstReceipt.event_receipts[event.event_id], firstReceipt.received_at);
  const event2 = { ...event, event_id: 'another-probe-event', occurred_at: new Date(generated - 5000).toISOString() };
  const { snapshot: next } = await readStagedSnapshot(file(1, [event, event2]));
  assert.equal((await client().synchronize(task.id, next)).changed, true);
  assert.deepEqual(posted[1].records, []);
  assert.deepEqual(posted[1].events.map(item => item.event_id), [event2.event_id]);
  const replay = await call(path, { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json', 'x-observatory-sync-scope': scope }, body: JSON.stringify(posted[1]) });
  assert.equal(replay.status, 200);
  const overview = await (await call('/api/overview', { headers })).json();
  assert.equal(overview.execution.events.length, 2);
  assert.equal(overview.execution.events.find(item=>item.event_id===event.event_id).session_id,event.session_id);
  assert.equal(overview.execution.sources[0].task_id, task.id);
  assert.deepEqual(overview.execution.sources[0].event_receipts, {
    [event.event_id]: firstReceipt.received_at,
    [event2.event_id]: overview.execution.sources[0].received_at,
  });
  assert.equal((await replay.json()).received_at, overview.execution.sources[0].received_at);
  assert.equal(overview.proposals.controls[task.id], undefined);
  assert.equal((await (await call('/api/overview', { headers: ownerHeader })).json()).execution, null);
  assert.equal((await call(path, { headers: { ...headers, 'oai-authenticated-user-id': 'owner-2', 'x-observatory-sync-scope': scope } })).status, 403);
  assert.equal((await call(path, { headers })).status, 403);
  assert.equal((await call(path)).status, 401);
  await assert.rejects(client().synchronize(task.id, { ...next, events: [event2] }), /missing previously synchronized/);
  await assert.rejects(client().synchronize(task.id, { ...next, events: [{ ...event, phase: 'other' }, event2] }), /rewrites/);
  const badChange = { ...posted[1], base: overview.execution.sources[0].digest, generated_at: new Date(generated + 2).toISOString(),
    events: [{ ...event, event_id: 'outside-task', task_id: 'outside-task' }] };
  assert.equal((await call(path, { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json', 'x-observatory-sync-scope': scope },
    body: JSON.stringify(badChange) })).status, 400);
  // An older worker can append events while leaving the previously recorded range untouched.
  sql.prepare('UPDATE task_telemetry SET event_receipt_batches = ? WHERE task_id = ?')
    .run(JSON.stringify([[0, 1, firstReceipt.received_at]]), task.id);
  const rollbackSource = (await (await call('/api/overview', { headers })).json()).execution.sources[0];
  assert.deepEqual(rollbackSource.event_receipts, { [event.event_id]: firstReceipt.received_at });
  // An existing snapshot may predate the receipt migration. Its original arrivals stay unknown.
  sql.prepare("UPDATE task_telemetry SET event_receipt_batches = '[]' WHERE task_id = ?").run(task.id);
  const operation = 'a'.repeat(64);
  const event3 = {...event,event_id:'activity_'+operation+'_result',trace_id:operation,span_id:operation,
    kind:'engineering_activity',measurements:[],activity:{kind:'test',source:'local_runner',outcome:'succeeded',operation_id:operation}};
  const badActivity = {...event3,activity:{...event3.activity,source_path:'private path'}};
  assert.equal((await call(path,{method:'POST',headers:{...headers,origin,'content-type':'application/json','x-observatory-sync-scope':scope},
    body:JSON.stringify({...badChange,events:[badActivity]})})).status,400);
  const { snapshot: upgraded } = await readStagedSnapshot(file(3, [event, event2, event3]));
  assert.equal((await client().synchronize(task.id, upgraded)).changed, true);
  const upgradedSource = (await (await call('/api/overview', { headers })).json()).execution.sources[0];
  assert.deepEqual(upgradedSource.event_receipts, { [event3.event_id]: upgradedSource.received_at });
  const event4 = {...event,event_id:'worker-snapshot-after-independent-activity'};
  const { snapshot: workerSnapshot } = await readStagedSnapshot(file(4, [event, event2, event4]));
  assert.equal((await client().synchronize(task.id, workerSnapshot)).changed,true);
  assert.deepEqual(posted.at(-1).events.map(item=>item.event_id),[event4.event_id]);
  const combined = (await (await call('/api/overview', {headers})).json()).execution;
  assert.equal(combined.events.length,4);
  assert.equal(combined.sources[0].event_receipts[event3.event_id],upgradedSource.received_at);
  assert.ok(combined.events.some(item=>item.event_id===event3.event_id));
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
        workflow_id:2300, head_repository:{id:2400},
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
    workflow_id:2300, head_repository_id:2400,
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
 const listed=await(await rpc('tools/list')).json();assert.deepEqual(listed.result.tools.map(t=>t.name),['task_engine_v1','project_execution_snapshot','read_execution_projection','sync_task_telemetry']);
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
 const record=proposedTask(input,rev);
 const sync={name:'sync_task_telemetry',arguments:{task_id:record.id,verification:namespace,
  change:{base:null,generated_at:new Date().toISOString(),records:[record],events:[]}}};
 const decoded=async(params,headers)=>JSON.parse((await(await rpc('tools/call',params,headers)).json()).result.content[0].text);
 const first=await decoded(sync);
 assert.equal(first.status,200);
 assert.deepEqual(await decoded(sync),first);
 const read={name:sync.name,arguments:{task_id:record.id,verification:namespace}};
 assert.equal((await decoded(read)).baseline.digest,first.digest);
 assert.equal((await decoded(read,{'oai-authenticated-user-id':'foreign','content-type':'application/json'})).baseline,null);
 assert.equal((await decoded({...read,arguments:{task_id:record.id}})).baseline,null);
});


test('verification telemetry cannot exhaust live Task telemetry slots',async t=>{
  const {call}=fixture(t);
  const generated_at=new Date().toISOString();
  const draft=proposedTask(input,rev);
  async function sync(index,verification) {
    const record={...draft,id:'task_capacity_'+index};
    const request={jsonrpc:'2.0',id:index,method:'tools/call',params:{name:'sync_task_telemetry',arguments:{
      task_id:record.id,...(verification?{verification}:{}),change:{base:null,generated_at,records:[record],events:[]},
    }}};
    const response=await call('/mcp',{method:'POST',headers:{...ownerHeader,'content-type':'application/json'},body:JSON.stringify(request)});
    const data=(await response.json()).result;
    assert.equal(data.isError,false);
    return JSON.parse(data.content[0].text);
  }
  const verificationScopes=[namespace,crypto.randomUUID(),crypto.randomUUID()];
  for (const scope of verificationScopes) {
    for (let i=1;i<=8;i++) assert.equal((await sync(i,scope)).status,200);
    assert.deepEqual(await sync(9,scope),{status:413,error:'Private Task telemetry storage limit reached'});
  }
  assert.deepEqual(await sync(1,crypto.randomUUID()),{status:413,error:'Private Task telemetry storage limit reached'});
  for (let i=1;i<=25;i++) assert.equal((await sync(i)).status,200);
  assert.equal((await sync(25)).status,200);
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

test('MCP registration, Site editing and worker claims preserve the 100,000-character boundary', async t => {
  const workerKey = 'test-only-' + 'k'.repeat(40);
  const { call } = fixture(t,{taskKey:workerKey});
  const headers = {...ownerHeader,origin,'content-type':'application/json'};
  const operation = (op, fields = {}) => ({op,operation_id:crypto.randomUUID(),...fields});
  const rpc = async (request, worker = false) => {
    const response = await call('/mcp',{method:'POST',headers,body:JSON.stringify({
      jsonrpc:'2.0',id:1,method:'tools/call',params:{
        name:'task_engine_v1',arguments:{request,verification:namespace,...(worker?{worker_key:workerKey}:{})},
      },
    })});
    return (await response.json()).result.structuredContent;
  };
  for (const length of [6000,6001,99_999,100_000,100_001]) {
    const objective = ' \r\n' + '🧭'.repeat(length-4) + ' ';
    const response = await rpc(operation('register',{fields:{...input,objective}}));
    assert.equal(response.status,length<=100_000?201:400);
    if (length<=100_000) assert.equal(response.task.objective,objective);
  }
  for (const objective of [null,[],1,'  ', 'Unpaired UTF-16 surrogate \ud800']) {
    assert.equal((await rpc(operation('register',{fields:{...input,objective}}))).status,400);
  }
  const initial = '界'.repeat(99_999);
  const created = await rpc(operation('register',{fields:{...input,objective:initial}}));
  const task_id = created.task.id;
  const command = (expected_version, action) => operation('command',{task_id,expected_version,action});
  const admitted = await rpc(command(created.version,{type:'admit',executor:'codex'}));
  assert.equal(admitted.status,200);
  const objective = ' \n' + '🧭'.repeat(99_997) + ' ';
  const action = {type:'edit',fields:{...input,objective}};
  const response = await call('/api/task-engine/v1',{method:'POST',headers:{
    ...headers,'x-observatory-verification':namespace,
  },body:JSON.stringify(command(admitted.version,action))});
  assert.equal(response.status,200,await response.clone().text().then(value=>value.slice(0,240)));
  const reloaded = await rpc({op:'get',task_id});
  assert.equal(reloaded.task.objective,objective);
  const audit = reloaded.events.find(event=>event.kind==='edit').specification;
  assert.equal(audit.before.objective,initial);
  assert.equal(audit.after.objective,objective);
  const claimed = await rpc(operation('claim',{task_ids:[task_id],separate_execution_notes:true}),true);
  assert.equal(claimed.status,200);
  assert.equal(claimed.claim.task.objective,objective);
  assert.equal(claimed.claim.attempt.spec_version,reloaded.version);
  const malformed = await call('/api/task-engine/v1',{method:'POST',headers,body:new Uint8Array([0x7b,0xff,0x7d])});
  assert.equal(malformed.status,400);
});

test('Codex Task tool and Site API share registration, version, owner scope and audit events', async t => {
  const key = 'test-only-' + 'k'.repeat(40);
  const { call } = fixture(t, { taskKey: key });
  const headers = { ...ownerHeader, origin, 'content-type': 'application/json' };
  const http = (body, extra = {}) => call('/api/task-engine/v1', {
    method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body),
  });
  const tool = async (request, extras = {}) => {
    const response = await call('/mcp', { method: 'POST', headers, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'task_engine_v1', arguments: { request, ...extras } },
    }) });
    const value = await response.json();
    assert.deepEqual(value.result.structuredContent,JSON.parse(value.result.content[0].text));
    return value.result.structuredContent;
  };
  const listed = await call('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})});
  const schema = (await listed.json()).result.tools.find(item=>item.name==='task_engine_v1').inputSchema;
  const requestProperties = schema.properties.request.properties;
  assert.equal(requestProperties.operation_id.format,'uuid');
  assert.equal(requestProperties.expected_version.type,'integer');
  assert.ok(requestProperties.fields.required.includes('objective'));
  assert.equal(requestProperties.fields.properties.objective.maxLength,100_000);
  assert.ok(requestProperties.action.properties.type.enum.includes('admit'));
  assert.ok(requestProperties.action.properties.type.enum.includes('retry'));
  assert.ok(requestProperties.action.properties.type.enum.includes('addendum'));
  assert.ok(!requestProperties.action.properties.type.enum.includes('accept'));
  assert.match(schema.properties.verification.description,/Independent of request.operation_id/);
  const missingId=await tool({op:'register',fields:input},{verification:namespace});
  assert.deepEqual(missingId,{status:400,error:'Operation UUID required'});
  const registered = await tool({ op: 'register', operation_id: crypto.randomUUID(), fields: input });
  assert.equal(registered.status, 201);
  const { task, version } = registered;
  const get = { op: 'get', task_id: task.id };
  assert.equal((await http(get, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await http(get, { 'oai-authenticated-user-id': 'owner-2' })).status, 404);
  assert.equal((await http(get, { 'x-observatory-verification': namespace })).status, 404);
  assert.equal((await (await http(get)).json()).task.id, task.id);
  assert.equal((await tool(get)).version, version);
  const command = { op: 'command', task_id: task.id, operation_id: crypto.randomUUID(), expected_version: version,
    action: { type: 'admit', executor: 'codex' } };
  assert.equal((await tool({...command,action:{type:'accept'}})).status,403);
  assert.equal((await tool(command)).status,200);
  assert.equal((await tool(command)).version,version+1);
  const claim = { op: 'claim', operation_id: crypto.randomUUID(), task_ids: [task.id] };
  assert.equal((await tool(claim)).status, 403);
  assert.equal((await tool(claim, { worker_key: 'x'.repeat(47) })).status, 403);
  const { claim: leased } = await tool(claim, { worker_key: key });
  assert.equal(leased.attempt.id, (await tool(claim, { worker_key: key })).claim.attempt.id);
  const detail = await tool(get);
  assert.equal(detail.lifecycle.state, 'running');
  assert.equal(detail.attempts[0].lease, undefined);
  assert.deepEqual(detail.events.map(event => event.kind), ['register', 'admit', 'claim']);
  const overview = await (await call('/api/overview', { headers: ownerHeader })).json();
  assert.equal(overview.records.find(item => item.id === task.id).state, 'running');
  assert.equal(overview.records.find(item => item.id === leased.attempt.id).task_id, task.id);

  const session_id = crypto.randomUUID();
  const failure = await tool({
    op:'report', operation_id:crypto.randomUUID(), task_id:task.id, attempt_id:leased.attempt.id, lease:leased.lease,
    report:{type:'failed', failure:'Fixture: Task records were unavailable', session_id},
  }, {worker_key:key});
  assert.equal(failure.lifecycle.state,'failed');
  const retry = {
    ...command, operation_id:crypto.randomUUID(), expected_version:failure.version,
    action:{type:'retry', changed_assumption:'Canonical Task records are now readable.'},
  };
  const resume = await tool({...retry, action:{type:'resume'}});
  assert.equal(resume.status,409);
  assert.match(resume.error,/owner Retry/);
  assert.equal((await tool(retry,{worker_key:key})).status,403);
  assert.equal((await tool({...retry,expected_version:detail.version})).status,409);
  const retried = await tool(retry);
  assert.equal(retried.status,200);
  assert.equal((await tool(retry)).version,retried.version);
  const resumedClaim = {
    ...claim, operation_id:crypto.randomUUID(), conversation_continuation:true,
  };
  const resumedAttempt = (await tool(resumedClaim,{worker_key:key})).claim;
  assert.equal(resumedAttempt.attempt.resume_session_id,session_id);
  assert.equal(resumedAttempt.attempt.revision,leased.attempt.revision);
  assert.equal(resumedAttempt.attempt.changed_assumption,retry.action.changed_assumption);
  assert.ok(resumedAttempt.task.objective.endsWith(retry.action.changed_assumption));
  assert.deepEqual((await tool(resumedClaim,{worker_key:key})).claim,resumedAttempt);
  const retriedDetail = await tool(get);
  assert.equal(retriedDetail.task.objective,task.objective);
  assert.deepEqual(retriedDetail.attempts.map(attempt=>attempt.state),['failed','running']);
  assert.equal(retriedDetail.events.filter(event=>event.kind==='retry').length,1);

  const fixtureTask=await tool({op:'register',operation_id:crypto.randomUUID(),fields:input},{verification:namespace});
  const fixtureCommand=(expected_version,action)=>tool({op:'command',task_id:fixtureTask.task.id,
    operation_id:crypto.randomUUID(),expected_version,action},{verification:namespace});
  const edited=await fixtureCommand(fixtureTask.version,{type:'edit',fields:{...input,title:'Edited MCP fixture',priority:'high'}});
  assert.equal(edited.task.title,'Edited MCP fixture');
  const scheduled=await fixtureCommand(edited.version,{type:'admit',executor:'codex',start_at:'2050-01-01T13:00:00Z'});
  assert.equal(scheduled.lifecycle.state,'scheduled');
  assert.equal((await fixtureCommand(edited.version,{type:'pause'})).status,409);
  const paused=await fixtureCommand(scheduled.version,{type:'pause'});
  assert.equal(paused.lifecycle.state,'paused');
  const resumed=await fixtureCommand(paused.version,{type:'resume'});
  assert.equal(resumed.lifecycle.state,'scheduled');
  const configured=await fixtureCommand(resumed.version,{type:'configure_execution',start_at:null});
  assert.equal(configured.lifecycle.state,'ready');
  assert.equal((await fixtureCommand(configured.version,{type:'cancel'})).lifecycle.state,'cancelled');
  assert.equal((await tool({op:'get',task_id:fixtureTask.task.id})).status,404);
});

test('owner admission activates a published proposal without rewriting its intake document', async t => {
  const { call, post, writes } = fixture(t, { token: 'proposal-test-token' });
  const headers = { ...ownerHeader, origin, 'content-type': 'application/json' };
  const creation = await post({ 'x-observatory-publish': 'github' });
  const { task, github } = await creation.json();
  assert.equal(github.state, 'published');
  assert.equal(writes.length, 1);
  const response = await call('/api/task-engine/v1', { method: 'POST', headers, body: JSON.stringify({
    op: 'command', task_id: task.id, expected_version: 1, operation_id: crypto.randomUUID(),
    action: { type: 'admit', executor: 'codex' },
  }) });
  const activated = await response.json();
  assert.equal(response.status, 200);
  assert.equal(activated.task.id, task.id);
  assert.equal(activated.lifecycle.state, 'ready');
  const publish = await call('/api/tasks/' + task.id + '/publish', { method: 'POST', headers, body: '{}' });
  assert.equal((await publish.json()).github.state, 'published');
  assert.equal(writes.length, 1);
});

test('a scoped executor can claim the verification Task without activating its live twin', async t => {
  const key = 'test-only-' + 'k'.repeat(40);
  const { call } = fixture(t, { taskKey: key });
  const headers = { ...ownerHeader, origin, 'content-type': 'application/json' };
  const rpc = async (request, args = {}) => {
    const response = await call('/mcp', { method: 'POST', headers, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'task_engine_v1', arguments: { request, ...args } },
    }) });
    return JSON.parse((await response.json()).result.content[0].text);
  };
  const operation_id = crypto.randomUUID();
  const register = { op: 'register', operation_id, fields: input };
  const both = await Promise.all([rpc(register), rpc(register, { verification: namespace })]);
  assert.deepEqual(both.map(reply => reply.status), [201, 201]);
  const task_id = both[0].task.id;
  assert.equal(both[1].task.id, task_id);
  const receipt = await call('/api/task-engine/v1', {
    method: 'POST', headers: { ...headers, 'x-observatory-verification': namespace }, body: JSON.stringify({
      op: 'command', task_id, expected_version: 1, operation_id: crypto.randomUUID(),
      action: { type: 'admit', executor: 'codex' },
    }),
  });
  assert.equal(receipt.status, 200);
  const claim = { op: 'claim', operation_id: crypto.randomUUID(), task_ids: [task_id] };
  assert.equal((await rpc(claim, { worker_key: key })).claim, null);
  assert.equal((await rpc(claim, { worker_key: key, verification: namespace })).claim.task.id, task_id);
  const states = await Promise.all([rpc({ op: 'get', task_id }), rpc({ op: 'get', task_id }, { verification: namespace })]);
  assert.deepEqual(states.map(item => item.lifecycle.state), ['proposed', 'running']);
});

test('owner pricing route refreshes exact OpenAI text rates and sends no Task data upstream', async () => {
  const markdown = [
    '# Model', 'Model ID: `gpt-6.2-sol`', '## Pricing', '### Text tokens',
    '| Metric | Price | Unit |', '| --- | ---: | --- |',
    '| Input | $2 | 1M tokens |', '| Cached input | $0.1 | 1M tokens |', '| Output | $10 | 1M tokens |',
    '### Batch', '| Input | $1 | 1M tokens |',
  ].join('\n');
  const calls = [];
  const worker = createWorker({fetcher:async (url, options) => {
    calls.push([url, options]);
    return new Response(markdown,{headers:{'content-type':'text/markdown; charset=utf-8'}});
  }});
  const get = (model, options = {}) => worker.fetch(new Request(origin+'/api/openai-pricing/'+model,options),{});
  assert.equal((await get('gpt-6.2-sol')).status,401);
  assert.equal((await get('gpt-6.2-sol',{headers:ownerHeader,method:'POST'})).status,405);
  const [first, second] = await Promise.all([get('gpt-6.2-sol',{headers:ownerHeader}),get('gpt-6.2-sol',{headers:ownerHeader})]);
  const {pricing} = await first.json();
  assert.deepEqual(pricing.usdPerMillion,{input:2,cachedInput:0.1,output:10});
  assert.deepEqual(await second.json(),{pricing});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'https://developers.openai.com/api/docs/models/gpt-6.2-sol.md');
  assert.deepEqual(calls[0][1].headers,{accept:'text/markdown'});
  assert.equal(calls[0][1].redirect,'manual');
  assert.deepEqual(await (await get('gpt-other',{headers:ownerHeader})).json(),{pricing:null});
});
