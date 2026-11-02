import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, VelaError } from '../src/capabilities.ts';
import {
  CAPABILITY_SCHEMA_TOOL,
  CapabilityCatalogLease,
  capabilityCatalogDigest,
  capabilitySchemaTool,
  createCapabilityCatalog,
  validateCatalogDeclaration,
} from '../src/capability-catalog.mts';
import type { CapabilityNativeCall } from '../src/capability-catalog.mts';

function fixture() {
  const catalog = createCapabilityCatalog(CAPABILITIES);
  let authorized = true,
    time = Date.parse('2026-11-02T10:00:00Z');
  const lease = new CapabilityCatalogLease({
    catalog,
    expiresAt: '2026-11-02T10:01:00Z',
    now: () => time,
    authorize() {
      if (!authorized) throw new VelaError('revoked_catalog_scope');
    },
  });
  lease.bind('native:thread', 'native:turn');
  const call = (callId: string, ids: string[] = ['createWorkspace']): CapabilityNativeCall => ({
    threadId: 'native:thread',
    turnId: 'native:turn',
    callId,
    namespace: null,
    tool: CAPABILITY_SCHEMA_TOOL,
    arguments: { catalogDigest: catalog.projection.digest, ids },
  });
  return {
    catalog,
    lease,
    call,
    revoke() {
      authorized = false;
    },
    expire() {
      time += 61000;
    },
  };
}
test('catalog projection and digests are deterministic, isolated and include exact full authorization semantics', () => {
  const a = createCapabilityCatalog(CAPABILITIES),
    b = createCapabilityCatalog([...CAPABILITIES].reverse());
  assert.deepEqual(a, b);
  assert.equal(a.projection.index.length, CAPABILITIES.length);
  assert(!JSON.stringify(a.projection).includes('inputSchema'));
  const changed = structuredClone(CAPABILITIES);
  changed[0].scope += ' Narrower scope';
  assert.notEqual(createCapabilityCatalog(changed).projection.digest, a.projection.digest);
  assert.notEqual(createCapabilityCatalog(CAPABILITIES.slice(1)).projection.digest, a.projection.digest);
  assert.equal(a.declaration.toolDigest, capabilityCatalogDigest(capabilitySchemaTool(a.projection)));
  validateCatalogDeclaration(a, a.declaration);
  assert.throws(() => validateCatalogDeclaration(a, { ...a.declaration, limits: { ...a.declaration.limits, maxCalls: 9 } }), /grant_mismatch/);
  a.descriptors[0].scope = 'Changed clone';
  assert.notEqual(CAPABILITIES.find((item) => item.id === a.descriptors[0].id)!.scope, 'Changed clone');
});
test('authorized lookup returns original complete descriptors only; repeated native call IDs are exact and mismatches fail closed', () => {
  const f = fixture(),
    call = f.call('call:1', ['setOrganization', 'delegateTask']),
    reply = f.lease.read(call);
  assert.equal(reply.success, true);
  assert.deepEqual(
    JSON.parse(reply.contentItems[0].text).capabilities,
    call.arguments && ['setOrganization', 'delegateTask'].map((id) => CAPABILITIES.find((item) => item.id === id)),
  );
  assert.deepEqual(f.lease.read(call), reply);
  assert.equal(f.lease.read(f.call('call:1', ['createWorkspace'])).success, false);
  assert.deepEqual(f.lease.fetchedIds(), ['setOrganization', 'delegateTask']);
  const other = f.call('call:2', ['unknown:capability']);
  const denied = f.lease.read(other);
  assert.equal(denied.success, false);
  assert.deepEqual(f.lease.read(other), denied);
  assert(!denied.contentItems[0].text.includes('scope'));
});
test('catalog tool cannot change scope, read content, execute actions or escape the native identity/expiry fence', () => {
  const f = fixture();
  for (const patch of [
    { threadId: 'other:thread' },
    { turnId: 'other:turn' },
    { namespace: 'arbitrary' },
    { tool: 'execute' },
    { arguments: { catalogDigest: f.catalog.projection.digest, ids: ['content'], resourceId: 'private:resource' } },
    { arguments: { catalogDigest: '0'.repeat(64), ids: ['content'] } },
    { arguments: { catalogDigest: f.catalog.projection.digest, ids: ['content', 'content'] } },
  ])
    assert.equal(f.lease.read({ ...f.call('call:' + Math.random()), ...patch }).success, false);
  f.revoke();
  assert.equal(f.lease.read(f.call('revoked')).success, false);
  const g = fixture();
  g.expire();
  assert.equal(g.lease.read(g.call('expired')).success, false);
  const h = fixture();
  h.lease.close();
  assert.equal(h.lease.read(h.call('closed')).success, false);
  const i = fixture();
  assert.throws(() => i.lease.bind('native:thread', 'different:turn'), /identity_mismatch/);
});
test('call, argument and output bounds are enforced without partial descriptors or unavailable capability fallbacks', () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) assert.equal(f.lease.read(f.call('call:' + n)).success, true);
  assert.equal(f.lease.read(f.call('call:9')).success, false);
  const g = fixture();
  assert.equal(
    g.lease.read(
      g.call(
        'many',
        CAPABILITIES.slice(0, 5).map((c) => c.id),
      ),
    ).success,
    false,
  );
  assert.equal(
    g.lease.read({ ...g.call('large'), arguments: { catalogDigest: g.catalog.projection.digest, ids: ['createWorkspace'], extra: 'x'.repeat(2048) } }).success,
    false,
  );
  const descriptors = structuredClone(CAPABILITIES.slice(0, 1));
  descriptors[0].scope = 'x'.repeat(9000);
  const catalog = createCapabilityCatalog(descriptors),
    lease = new CapabilityCatalogLease({ catalog, expiresAt: new Date(Date.now() + 60000).toISOString(), authorize() {} });
  lease.bind('t', 'r');
  const reply = lease.read({
    threadId: 't',
    turnId: 'r',
    namespace: null,
    tool: CAPABILITY_SCHEMA_TOOL,
    callId: 'oversized',
    arguments: { catalogDigest: catalog.projection.digest, ids: [descriptors[0].id] },
  });
  assert.equal(reply.success, false);
  assert(Buffer.byteLength(JSON.stringify(reply)) < 8192);
  assert.deepEqual(lease.fetchedIds(), []);
});

test('aggregate metadata output is bounded across distinct calls, including recorded failures', () => {
  const descriptors = structuredClone(CAPABILITIES.slice(0, 1));
  descriptors[0].scope = 'x'.repeat(6000);
  const catalog = createCapabilityCatalog(descriptors),
    lease = new CapabilityCatalogLease({ catalog, expiresAt: new Date(Date.now() + 60000).toISOString(), authorize() {} });
  lease.bind('t', 'r');
  const replies = Array.from({ length: 8 }, (_, index) =>
    lease.read({
      threadId: 't',
      turnId: 'r',
      namespace: null,
      tool: CAPABILITY_SCHEMA_TOOL,
      callId: 'call:' + index,
      arguments: { catalogDigest: catalog.projection.digest, ids: [descriptors[0].id] },
    }),
  );
  assert(replies.some((reply) => reply.success));
  assert(replies.some((reply) => !reply.success));
  assert(replies.every((reply) => Buffer.byteLength(JSON.stringify(reply)) <= 8192));
  assert(replies.reduce((total, reply) => total + Buffer.byteLength(JSON.stringify(reply)), 0) <= 32768);
});
