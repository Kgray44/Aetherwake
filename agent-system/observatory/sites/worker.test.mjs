import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createWorker } from './worker.mjs';
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
const namespace = 'c0cf1399-8a73-4f08-9b10-997063853638';
const published = proposedTask({ ...input, title: 'Published contract record' }, rev);
const ownerHeader = { 'oai-authenticated-user-id': 'owner-1' };

function fixture(t, { missingMain = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(migration);
  sql.exec(cacheMigration);
  sql.exec(readFileSync(new URL('./drizzle/0002_private_projection.sql', import.meta.url), 'utf8'));
  let rateLimited = false;
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
    if (rateLimited) {
      return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    }
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
    .fetch(new Request(origin + path, options), { DB });
  const post = (headers = {}) => call('/api/tasks', {
    method: 'POST', body: JSON.stringify(input),
    headers: { ...ownerHeader, origin, 'content-type': 'application/json', ...headers },
  });
  const hitLimit = () => {
    sql.exec('UPDATE github_snapshot SET retry_at = 0');
    rateLimited = true;
  };
  return { call, post, requests, hitLimit };
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
  const { call, post } = fixture(t, { missingMain: true });
  const response = await call('/api/overview', { headers: ownerHeader });
  const data = await response.json();
  assert.equal(data.revision, null);
  assert.equal(data.github.records.status, 'unavailable');
  assert.equal(data.github.issues.status, 'available');
  assert.equal((await post()).status, 503);
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
  assert.equal((await post()).status, 503);
  assert.equal(requests.length, limitedCount);
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
