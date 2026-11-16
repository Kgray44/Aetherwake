import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createWorker } from './worker.mjs';
import { proposedTask } from '../intake.mjs';

const schema = JSON.parse(readFileSync(new URL('../../contracts/v1.schema.json', import.meta.url)));
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
const namespace = 'c0cf1399-8a73-4f08-9b10-997063853638';
const published = proposedTask({ ...input, title: 'Published contract record' }, rev);
const ownerHeader = { 'oai-authenticated-user-id': 'owner-1' };

function fixture(t, { missingMain = false } = {}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(migration);
  const DB = {
    prepare(statement) {
      const stmt = sql.prepare(statement);
      return { bind: (...args) => ({
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
  const worker = createWorker({ validate, assets: {}, sourceRevision: blob, fetcher });
  const call = (path, options) => worker.fetch(new Request(origin + path, options), { DB });
  const post = (headers = {}) => call('/api/tasks', {
    method: 'POST', body: JSON.stringify(input),
    headers: { ...ownerHeader, origin, 'content-type': 'application/json', ...headers },
  });
  return { call, post, requests };
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
