import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { VelaBackendState, VelaRequestInput } from '../src/contracts.mts';
import type { ProviderReplyKind, VelaPlanningPort, VelaRequest } from '../../vela-core/src/contracts.ts';

/** Actual canonical backend/SQLite and private grant policy; injected provider values are explicit synthetic doubles, never live model evidence. */
const contribution = { providerId: 'synthetic-response-test-double', classification: 'reported' as const, executionId: 'execution:synthetic-response', planningConversationId: 'conversation:synthetic-provider', sourceMessageId: 'message:synthetic-output', nativeThreadId: 'thread:synthetic', nativeTurnId: 'turn:synthetic' };
const response = (kind: ProviderReplyKind = 'answer') => ({ schemaVersion: 2, kind, content: 'Exact synthetic canonical ' + kind + '.', contribution });
function fixture(port: VelaPlanningPort) {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-vela-responses-')), path = join(dir, 'canonical.sqlite');
  const options = { path, provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const, velaPlanningPort: port }; let core = new BackendCore(options), closed = false;
  return { get core() { return core; },
    async reopen(edit?: (db: DatabaseSync) => void) { await core.command('close', {}); closed = true; if (edit) { const db = new DatabaseSync(path); try { edit(db); } finally { db.close(); } } core = new BackendCore(options); closed = false; },
    async close() { if (!closed) await core.command('close', {}); const target = resolve(dir), part = relative(resolve(tmpdir()), target); assert(part.startsWith('aerynth-vela-responses-') && !part.startsWith('..') && !isAbsolute(part)); rmSync(target, { recursive: true, force: true }); },
  };
}
const state = async (core: BackendCore) => await core.command('vela', { name: 'state', input: {} }) as VelaBackendState;
const desktop = (core: BackendCore) => core.command('desktop', { type: 'snapshot' });
async function approvedInput(core: BackendCore, intent: string, resourceIds: string[] = []): Promise<VelaRequestInput> {
  const preview = await core.command('velaRequestPreview', { intent, resourceIds }), grant = await core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature });
  return { intent, resourceIds, authorizeProvider: true, previewId: preview.id, grantId: grant.grantId };
}

test('canonical backend persists each attributed conversational result through real SQLite close/reopen without action or grant replay', async () => {
  let output = response(), calls = 0;
  const port: VelaPlanningPort = { providerId: contribution.providerId, availability: () => ({ available: true, busy: false }), propose: async () => { calls++; return structuredClone(output); } }, f = fixture(port);
  try {
    await f.core.command('vela', { name: 'open', input: {} });
    const initial = await desktop(f.core), created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Synthetic selected response source', workspaceId: null });
    const note = created.resources.find(r => !initial.resources.some(old => old.id === r.id))!, before = await f.core.command('snapshot', {}), ids = created.resources.map(r => r.id).sort();
    await assert.rejects(f.core.command('vela', { name: 'request', input: { intent: 'No untrusted approval boolean', resourceIds: [], authorizeProvider: true } }), /native_vela_grant_required/); assert.equal(calls, 0);
    for (const kind of ['answer', 'clarification', 'inability'] as const) {
      output = response(kind); const input = await approvedInput(f.core, 'Synthetic conversational ' + kind, [note.id]);
      const request = await f.core.command('vela', { name: 'request', input }) as VelaRequest, current = await state(f.core), message = current.conversation!.messages.find(m => m.id === request.response!.messageId)!;
      assert.equal(request.state, 'responded'); assert.equal(request.response!.kind, kind); assert.equal(request.planId, undefined); assert.equal(message.content, output.content); assert.equal(message.source, 'provider'); assert.equal(message.providerId, contribution.providerId); assert.equal(message.classification, 'reported'); assert.equal(message.responseKind, kind); assert.deepEqual(message.providerContribution, contribution); assert.equal(message.planId, undefined);
      assert.equal(current.plans.length, 0); assert.equal(current.receipts.length, 0); assert.deepEqual(current.planningReferences, {}, 'Injected port is not actual native provider execution');
      const priorCalls: number = calls; await assert.rejects(f.core.command('vela', { name: 'request', input }), /native_vela_grant_consumed/); assert.equal(calls, priorCalls, 'A consumed native grant cannot resend a recorded response');
    }
    const saved = await state(f.core), after = await f.core.command('snapshot', {}); assert.equal(calls, 3); assert.equal(saved.identity.id, 'system:vela'); assert.equal(after.conversations.find(c => c.resourceId === saved.conversation!.resourceId)!.providerId, 'local'); assert.equal(saved.conversation!.messages.length, 6);
    assert.deepEqual((await desktop(f.core)).resources.map(r => r.id).sort(), ids); assert.deepEqual((await desktop(f.core)).resources.find(r => r.id === note.id), note); assert.deepEqual(after.executions, {}); assert.deepEqual(after.relationships, before.relationships);
    await f.reopen(db => { const row = db.prepare('SELECT schema_version,json FROM vela_state WHERE id=1').get()!; assert.equal(row.schema_version, 2); const raw = JSON.parse(String(row.json)); assert(raw.requests.every((r: VelaRequest) => r.state === 'responded' && Object.keys(r.response!).sort().join(',') === 'kind,messageId')); });
    const restored = await state(f.core); assert.deepEqual(restored.requests, saved.requests); assert.deepEqual(restored.conversation, saved.conversation); assert.equal(restored.plans.length, 0); assert.equal(restored.receipts.length, 0); assert.equal(calls, 3); assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
  } finally { await f.close(); }
});

test('actual canonical backend reopens a wire-v1 plan from stored schema1 without changing its history, IDs or fingerprint', async () => {
  let calls = 0; const port: VelaPlanningPort = { providerId: contribution.providerId, availability: () => ({ available: true, busy: false }), propose: async () => { calls++; return { schemaVersion: 1, summary: 'Legacy synthetic proposal', steps: [{ id: 'one', explanation: 'Explicit synthetic old wire format', action: { type: 'createResource', kind: 'note', title: 'Never automatically applied', workspaceId: null } }], contribution }; } }, f = fixture(port);
  try {
    const request = await f.core.command('vela', { name: 'request', input: await approvedInput(f.core, 'Legacy plan remains reviewable') }) as VelaRequest; assert.equal(request.state, 'awaiting-review'); const before = await state(f.core);
    await f.reopen(db => { const raw = JSON.parse(String(db.prepare('SELECT json FROM vela_state WHERE id=1').get()!.json)); raw.schemaVersion = 1; db.prepare('UPDATE vela_state SET schema_version=1,json=? WHERE id=1').run(JSON.stringify(raw)); });
    const reopened = await state(f.core); assert.deepEqual(reopened.requests, before.requests); assert.deepEqual(reopened.plans, before.plans); assert.deepEqual(reopened.conversation, before.conversation); assert.equal(calls, 1); assert.equal(reopened.receipts.length, 0); assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
  } finally { await f.close(); }
});

test('canonical navigation scope changing from no project rejects a pending conversational reply before canonical delivery', async () => {
  let finish!: (value: unknown) => void, calls = 0;
  const port: VelaPlanningPort = { providerId: contribution.providerId, availability: () => ({ available: true, busy: false }), propose: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }, f = fixture(port);
  try {
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: null } });
    const input = await approvedInput(f.core, 'Reply only in the reviewed context'), pending = f.core.command('vela', { name: 'request', input }); assert.equal(calls, 1);
    const created = await f.core.command('desktop', { type: 'createProject', title: 'Synthetic changed response scope' }); await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: created.projects[0].id } }); finish(response());
    const request = await pending as VelaRequest, current = await state(f.core); assert.equal(request.state, 'invalid-plan'); assert.equal(request.errorCode, 'stale_context_scope'); assert.equal(request.response, undefined); assert.equal(current.plans.length, 0); assert.equal(current.receipts.length, 0); assert(!current.conversation!.messages.some(m => m.source === 'provider')); assert.equal(calls, 1); assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
  } finally { await f.close(); }
});
