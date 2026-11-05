import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { VelaService } from '../src/service.mts';
import type { HostActionResult, VelaHostPort, VelaLocalHost, VelaMessage, VelaPlan, VelaPlanningPort } from '../src/contracts.ts';

/** Synthetic canonical callbacks on ONE actual SQLite connection. No native/model/provider transport exists in this harness. */
function fixture(file = ':memory:', planner?: VelaPlanningPort) {
  const db = new DatabaseSync(file); db.exec('CREATE TABLE IF NOT EXISTS presentation_test_resources(id TEXT PRIMARY KEY,revision INTEGER); CREATE TABLE IF NOT EXISTS presentation_test_messages(id TEXT PRIMARY KEY,conversation_id TEXT,json TEXT)');
  let serial = 0, allowed = true, service!: VelaService; const calls = { bodies: 0, auth: 0, sourceReads: 0 };
  const transaction = <T,>(work: () => T): T => { const name = 'presentation_' + serial++; db.exec('SAVEPOINT ' + name); try { const result = work(); db.exec('RELEASE ' + name); return result; } catch (error) { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); throw error; } };
  const canonical = {
    ensureConversation: () => { db.prepare("INSERT OR IGNORE INTO presentation_test_resources VALUES('synthetic:vela',1)").run(); return 'synthetic:vela'; },
    appendMessage: (id: string, message: Omit<VelaMessage, 'id'>) => { const value = { ...message, id: randomUUID() }; db.prepare('INSERT INTO presentation_test_messages VALUES(?,?,?)').run(value.id, id, JSON.stringify(value)); db.prepare('UPDATE presentation_test_resources SET revision=revision+1 WHERE id=?').run(id); return value; },
  };
  const host: VelaHostPort = { ...canonical,
    scope: () => ({ principalId: 'synthetic:owner', policyVersion: 'synthetic:policy', resourceIds: ['synthetic:vela'], workspaceIds: [], projectIds: [] }),
    resolve: ref => ref.id === 'synthetic:vela' && allowed ? { id: ref.id, kind: 'resource', resourceKind: 'conversation', title: 'Synthetic canonical Vela', version: 1 } : null,
    canReadContent: () => allowed,
    readConversation: id => { calls.bodies++; return { resourceId: id, revision: Number(db.prepare('SELECT revision FROM presentation_test_resources WHERE id=?').get(id)?.revision ?? 1), messages: db.prepare('SELECT json FROM presentation_test_messages WHERE conversation_id=? ORDER BY rowid').all(id).map(row => JSON.parse(String(row.json))) }; },
    search: () => [], readContent: () => { calls.sourceReads++; throw Error('Presentation cannot read source bodies'); },
    authorize: () => { calls.auth++; return { decision: 'allow', authorizationRef: 'synthetic:authorization:' + calls.auth, policyVersion: 'synthetic:policy' }; },
    applyNative: () => { throw Error('Presentation cannot dispatch native effects'); },
  };
  const local: VelaLocalHost = { ...canonical, identity: () => ({ principalId: 'synthetic:owner', policyVersion: 'synthetic:policy' }), clock: () => ({ epochMs: Date.parse('2026-11-02T12:00Z'), timeZone: 'UTC', locale: 'en-US' }), readMessage: (id, messageId) => { const row = db.prepare('SELECT json FROM presentation_test_messages WHERE id=? AND conversation_id=?').get(messageId, id); return allowed && row ? JSON.parse(String(row.json)) : null; } };
  const options = { db, host, local, planner, transaction, readTransaction: <T,>(work: (value: DatabaseSync) => T): T => transaction(() => work(db)), now: () => '2026-11-02T12:00:00.000Z' };
  const load = () => { service = new VelaService(options); }; load();
  return { db, host, calls, get service() { return service; }, load, another: () => new VelaService(options),
    answer: () => { const result = service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: randomUUID() }); assert(result.matched); return result.request; },
    stored: () => JSON.parse(String(db.prepare('SELECT json FROM vela_state').get()!.json)),
    messages: () => db.prepare('SELECT json FROM presentation_test_messages ORDER BY rowid').all().map(row => JSON.parse(String(row.json))),
    failNextSave: () => { const instance = service as any, save = instance.save; instance.save = function() { save.call(this); instance.save = save; throw Error('synthetic-presentation-save-after-write'); }; },
    deny: () => { allowed = false; }, close: () => db.close(),
  };
}
test('absent presentation initializes v1 IDs-only defaults without creating a conversation or altering history', () => {
  const f = fixture(); try { assert.deepEqual(f.service.state().presentation, { schemaVersion: 1, version: 1, view: 'current', selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] }); assert.equal(f.messages().length, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM presentation_test_resources').get()!.n, 0); } finally { f.close(); }
});
test('pin/dismiss/reopen/history persist only canonical request IDs with exact CAS and no body/provider/action/attention effects', () => {
  const f = fixture(); try {
    const first = f.answer(), second = f.answer(), before = f.stored(), messages = f.messages(), calls = { ...f.calls };
    let value = f.service.presentation({ expectedVersion: 1, patch: { pinnedRequestIds: [first.id], dismissedRequestIds: [second.id], view: 'history', selectedRequestId: first.id } }); assert.equal(value.version, 2);
    assert.deepEqual(f.stored().requests, before.requests); assert.deepEqual(f.stored().receipts, before.receipts); assert.deepEqual(f.stored().plans, before.plans); assert.deepEqual(f.stored().attention, before.attention); assert.deepEqual(f.messages(), messages); assert.deepEqual(f.calls, calls);
    assert.deepEqual(Object.keys(value).sort(), ['schemaVersion', 'version', 'view', 'selectedRequestId', 'dismissedRequestIds', 'pinnedRequestIds'].sort()); assert(!JSON.stringify(value).includes(first.intent));
    assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { view: 'current' } }), /stale_presentation_version/);
    value = f.service.presentation({ expectedVersion: 2, patch: { dismissedRequestIds: [], selectedRequestId: second.id, view: 'current' } }); assert.equal(value.version, 3); assert.deepEqual(value.pinnedRequestIds, [first.id]); assert.equal(value.selectedRequestId, second.id);
    f.load(); assert.deepEqual(f.service.state().presentation, value); assert.deepEqual(f.messages(), messages);
  } finally { f.close(); }
});
test('unknown IDs, payloads, duplicate/oversized arrays and current permission denial fail without metadata or canonical mutation', () => {
  const f = fixture(); try {
    const r = f.answer(), before = f.stored();
    for (const patch of [{ selectedRequestId: 'synthetic:foreign' }, { pinnedRequestIds: ['synthetic:foreign'] }, { dismissedRequestIds: [r.id, r.id] }, { pinnedRequestIds: Array(257).fill(r.id) }, { view: 'invalid' }, { content: 'No body store' }, {}]) assert.throws(() => f.service.presentation({ expectedVersion: 1, patch } as any), /invalid_|presentation_request_not_authorized/);
    assert.deepEqual(f.stored(), before);
    const scope = f.host.scope; f.host.scope = () => ({ ...scope(), resourceIds: [] }); assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { selectedRequestId: r.id } }), /presentation_not_authorized/); f.host.scope = scope;
    const resolveRef = f.host.resolve; f.host.resolve = () => ({ id: 'synthetic:wrong-conversation', kind: 'resource', title: 'Wrong resource', version: 1 }); assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { selectedRequestId: r.id } }), /presentation_not_authorized/); f.host.resolve = resolveRef;
    f.deny(); assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { selectedRequestId: r.id } }), /presentation_not_authorized/); assert.deepEqual(f.stored(), before);
  } finally { f.close(); }
});

test('a competing same-database presentation writer fences the stale service without replacing its canonical state', () => {
  const f = fixture(); try {
    const r = f.answer(), competing = f.another(), value = competing.presentation({ expectedVersion: 1, patch: { pinnedRequestIds: [r.id] } }), persisted = f.stored();
    assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { view: 'history' } }), /stale_presentation_version/); assert.deepEqual(f.stored(), persisted);
    f.load(); assert.deepEqual(f.service.state().presentation, value);
  } finally { f.close(); }
});
test('required prepared/approved/applying/unknown plans cannot be dismissed; pin/history never grants approval or runs actions', () => {
  const f = fixture(); try {
    const r = f.answer(), instance = f.service as any;
    for (const state of ['prepared', 'approved', 'applying', 'unknown']) {
      const plan = { id: 'synthetic:required-plan', requestId: r.id, state } as VelaPlan; instance.data.plans = [plan]; instance.data.requests[0].planId = plan.id;
      assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { dismissedRequestIds: [r.id] } }), /presentation_plan_requires_review/); assert.equal(instance.data.plans[0].state, state);
    }
    instance.data.plans = []; delete instance.data.requests[0].planId;
    const value = f.service.presentation({ expectedVersion: 1, patch: { pinnedRequestIds: [r.id], view: 'history' } }); assert.equal(value.view, 'history'); assert.equal(f.calls.auth, 0);
  } finally { f.close(); }
});
test('same-file restart preserves selected/pinned/dismissed references and all canonical message IDs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-presentation-')), file = join(dir, 'canonical.sqlite'); let f = fixture(file);
  try { const r = f.answer(), value = f.service.presentation({ expectedVersion: 1, patch: { view: 'history', pinnedRequestIds: [r.id], dismissedRequestIds: [r.id] } }), messages = f.messages(); f.close(); f = fixture(file); assert.deepEqual(f.service.state().presentation, value); assert.deepEqual(f.messages(), messages); } finally { f.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert(basename(dir).startsWith('aerynth-presentation-')); rmSync(dir, { recursive: true, force: true }); }
});
test('legacy1/2/3 absence upgrades additively; unknown/null presentation schemas and unknown outer versions reject without resetting data', () => {
  for (const version of [1, 2, 3]) { const f = fixture(); try { f.answer(); const value = f.stored(); delete value.presentation; value.schemaVersion = version; const messages = f.messages(), requests = structuredClone(value.requests); f.db.prepare('UPDATE vela_state SET schema_version=?,json=?').run(version, JSON.stringify(value)); f.load(); assert.equal(f.stored().schemaVersion, 3); assert.equal(f.stored().presentation.schemaVersion, 1); assert.deepEqual(f.stored().requests, requests); assert.deepEqual(f.messages(), messages); } finally { f.close(); } }
  for (const bad of [null, { schemaVersion: 99 }, { schemaVersion: 1, version: 0, view: 'current', selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] }]) { const f = fixture(); try { const value = f.stored(); value.presentation = bad; const json = JSON.stringify(value); f.db.prepare('UPDATE vela_state SET json=?').run(json); assert.throws(() => f.load(), /unsupported_vela_presentation_schema|invalid_vela_presentation_state/); assert.equal(f.db.prepare('SELECT json FROM vela_state').get()!.json, json); } finally { f.close(); } }
  const f = fixture(); try { const value = f.stored(); value.schemaVersion = 99; f.db.prepare('UPDATE vela_state SET schema_version=99,json=?').run(JSON.stringify(value)); assert.throws(() => f.load(), /unsupported_vela_schema/); } finally { f.close(); }
});
const contribution = { providerId: 'synthetic:planner', classification: 'reported' as const, executionId: 'synthetic:execution', sourceMessageId: 'synthetic:provider-message' };
test('failed UI save restores the exact pending provider-request object; one synthetic reply then commits and restarts without another proposal', async () => {
  let release!: () => void, entered!: () => void, proposals = 0; const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(':memory:', { providerId: contribution.providerId, availability: () => ({ available: true, busy: false }), propose: async () => { proposals++; entered(); await wait; return { schemaVersion: 2, kind: 'answer', content: 'Synthetic reported response', contribution }; } });
  try {
    const pending = f.service.request({ intent: 'Synthetic pending question', resourceIds: [], authorizeProvider: true }); await ready;
    const reference = (f.service as any).data.requests[0], before = f.stored(); f.failNextSave();
    assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { view: 'history', pinnedRequestIds: [reference.id] } }), /synthetic-presentation-save/);
    assert.equal((f.service as any).data.requests[0], reference); assert.deepEqual(f.stored(), before);
    const view = f.service.presentation({ expectedVersion: 1, patch: { view: 'history', pinnedRequestIds: [reference.id] } });
    assert.equal(reference.state, 'planning'); assert.equal(f.messages().length, 1); assert.equal(proposals, 1);
    release(); const response = await pending; assert.equal(response.state, 'responded'); assert.equal(reference.state, 'responded'); assert.equal(f.messages().length, 2);
    f.load(); assert.equal(f.stored().requests[0].state, 'responded'); assert.deepEqual(f.stored().presentation, view); assert.equal(proposals, 1);
  } finally { release(); f.close(); }
});
test('failed UI save preserves exact applying-plan/request/receipt aliases across suspended synthetic delegation and terminal commit', async () => {
  let release!: (result: HostActionResult) => void, entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<HostActionResult>(resolve => { release = resolve; });
  const f = fixture(':memory:', { providerId: contribution.providerId, availability: () => ({ available: true, busy: false }), propose: async () => ({ schemaVersion: 2, kind: 'plan', summary: 'Synthetic delegated proposal only', steps: [{ id: 'synthetic:step', explanation: 'Synthetic suspension fixture', action: { type: 'delegateTask', title: 'Synthetic task', objective: 'Synthetic objective', providerId: contribution.providerId, resourceIds: [], constraints: [] } }], contribution }) });
  try {
    f.host.delegateTask = async () => { entered(); return waiting; }; f.service.preferences({ expectedVersion: 1, patch: { delegationEnabled: true } });
    const request = await f.service.request({ intent: 'Synthetic prepared delegation', resourceIds: [], authorizeProvider: true });
    const plan = (f.service as any).data.plans[0] as VelaPlan; f.service.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
    const pending = f.service.apply(plan.id); await ready;
    const data = (f.service as any).data, requestRef = data.requests[0], receiptRef = data.receipts[0], before = f.stored(); f.failNextSave();
    assert.throws(() => f.service.presentation({ expectedVersion: 1, patch: { view: 'history', selectedRequestId: request.id } }), /synthetic-presentation-save/);
    assert.equal((f.service as any).data.plans[0], plan); assert.equal((f.service as any).data.requests[0], requestRef); assert.equal((f.service as any).data.receipts[0], receiptRef); assert.deepEqual(f.stored(), before);
    const view = f.service.presentation({ expectedVersion: 1, patch: { view: 'history', selectedRequestId: request.id } }); assert.equal(plan.state, 'applying');
    release({ status: 'applied', receiptId: 'synthetic:delegation-receipt' }); const result = await pending;
    assert.equal(result.state, 'applied'); assert.equal(receiptRef.state, 'applied'); assert.equal(receiptRef.taskVerified, false); assert.equal(requestRef.state, 'completed'); assert.deepEqual(f.stored().presentation, view);
  } finally { release({ status: 'unknown', receiptId: 'synthetic:cleanup' }); f.close(); }
});
