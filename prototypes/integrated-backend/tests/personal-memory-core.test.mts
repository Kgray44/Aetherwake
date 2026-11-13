import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { BackendCore } from '../src/core.mts';
import type { NativePersonalMemory } from '../src/personal-memory.mts';

function memoryOwner(core: BackendCore) {
  return (core as unknown as { personalMemory?: NativePersonalMemory }).personalMemory;
}

test('Core composes a lazy private memory owner only in a native private profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-core-'));
  let availabilityChecks = 0;
  const secrets = {
    async available() { availabilityChecks++; return false; },
    async seal() { throw Error('unexpected seal'); },
    async open() { throw Error('unexpected open'); },
  };
  let privateCore: BackendCore | undefined;
  let fixtureCore: BackendCore | undefined;
  try {
    privateCore = new BackendCore({ path: join(root, 'private.sqlite'), privateRoot: root,
      provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
    fixtureCore = new BackendCore({ path: join(root, 'fixture.sqlite'), provider: 'fixture',
      contentPolicy: 'synthetic-only' }, undefined, { secrets });
    assert.equal(memoryOwner(fixtureCore), undefined);
    const owner = memoryOwner(privateCore);
    assert.ok(owner);
    assert.deepEqual(await privateCore.command('personalMemoryPolicyNative', {}), {
      version: 0, storageEnabled: false, ordinaryEnabled: false, velaEnabled: false,
      sharingEnabled: false, sensitiveEnabled: false,
    });
    assert.equal(availabilityChecks, 0);
    assert.equal(owner.hasStorage(), false);
    await assert.rejects(privateCore.command('personalMemoryPolicyNative', { enable: true, expectedVersion: 0 }),
      /personal_storage_disabled/);
    assert.equal(availabilityChecks, 0);
    assert.equal(owner.hasStorage(), false);
    const beforeOpen = availabilityChecks;
    await assert.rejects(owner.open(), /private_key_unavailable/);
    assert.equal(availabilityChecks, beforeOpen + 1);
    await privateCore.command('close', {});
    privateCore = undefined;
    await assert.rejects(owner.open(), /personal_memory_closed/);
  } finally {
    await Promise.allSettled([privateCore?.command('close', {}), fixtureCore?.command('close', {})]);
    rmSync(root, { recursive: true, force: true });
  }
});

test('Core native capture persists a canonical user message across a private profile restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-capture-'));
  let wrapped: string;
  let custodyAvailable = true;
  const secrets = {
    available: async () => custodyAvailable,
    async seal(value: string) { wrapped = value; return randomBytes(64); },
    async open() { return wrapped; },
  };
  const open = () => new BackendCore({ path: join(root, 'profile.sqlite'), privateRoot: root,
    provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
  let core: BackendCore | undefined;
  try {
    core = open();
    const chat = await core.command('createConversation', { title: 'Synthetic chat', commandId: 'chat' });
    const content = 'I prefer a synthetic relay.';
    const append = { resourceId: chat.resourceId, role: 'user' as const,
      content, expectedRevision: chat.revision, commandId: 'message' };
    const message = await core.command('addMessage', append);
    const branch = { resourceId: chat.resourceId, messageId: message.id, includeMessageIds: [message.id],
      providerId: 'local', title: 'Synthetic branch', commandId: 'branch', tokenBudget: 8192,
      expectedRevision: message.revision };
    const fork = await core.command('branch', branch);
    assert.equal(fork.context.items[0]?.content, content);
    assert.deepEqual(await core.command('addMessage', append), message);
    assert.deepEqual(await core.command('branch', branch), fork);
    const preview = await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: message.id,
      scope: 'conversation', category: 'preferences', text: content, keywords: ['relay'],
    });
    assert.equal(preview.sourceText, content);
    const saved = await core.command('personalMemoryCaptureCommitNative', preview);
    await assert.rejects(core.command('personalMemoryCaptureCommitNative', preview), /personal_memory_review_mismatch/);
    await core.command('close', {});
    core = open();
    const inspection = (core as unknown as { personalMemoryReview: ReturnType<typeof createPersonalMemoryReview> }).personalMemoryReview;
    const fact = await inspection.read(saved.id);
    assert.equal(fact.text, content);
    assert.equal(fact.provenance.kind, 'conversation-message');
    assert.equal((await inspection.inspect({ after: null, limit: 8 })).policy.ordinaryEnabled, false);
    const request = { type: 'previewSourceRevocation' as const, id: saved.id, version: fact.version };
    await assert.rejects(core.command('personalMemoryManagementNative', { ...request, version: fact.version + 1 }),
      /stale_personal_context_version/);
    const reviewed = await core.command('personalMemoryManagementNative', request) as {
      binding: import('../src/contracts.mts').CommandMap['personalMemoryRevokeSourceNative']['input']; sourceText: string;
    };
    assert.deepEqual(reviewed, {
      binding: { conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision,
        reviewedFact: { id: saved.id, version: fact.version } },
      sourceText: content,
    });
    const revoke = reviewed.binding;
    await assert.rejects(core.command('personalMemoryRevokeSourceNative', { ...revoke, expectedRevision: chat.revision }), /stale_source_revision/);
    assert.equal((await inspection.read(saved.id)).text, content);
    const graph = (core as unknown as { graph: import('../../connected-conversations/src/graph.ts').ConversationGraph }).graph;
    const mark = graph.markUnavailable;
    graph.markUnavailable = () => { throw Error('synthetic graph write failure'); };
    try {
      await assert.rejects(core.command('personalMemoryRevokeSourceNative', revoke), /synthetic graph write failure/);
    } finally { graph.markUnavailable = mark; }
    assert.equal((await inspection.read(saved.id)).text, content);
    const correction = await inspection.previewManagement({ action: 'correct', id: saved.id, version: fact.version,
      text: 'I prefer a corrected synthetic relay.' });
    const corrected = await inspection.commitManagement(correction);
    await assert.rejects(core.command('personalMemoryRevokeSourceNative', revoke), /stale_personal_context_version/);
    assert.equal((await core.command('openResource', {
      resourceId: chat.resourceId, selection: { messageId: message.id },
    })).status, 'ready');
    const correctedFact = await inspection.read(corrected.id);
    const correctedReview = await core.command('personalMemoryManagementNative', {
      type: 'previewSourceRevocation', id: corrected.id, version: correctedFact.version,
    }) as typeof reviewed;
    const initial = await core.command('personalMemoryPolicyNative', {});
    const ordinary = await core.command('personalMemoryPolicyNative', { enable: true, expectedVersion: initial.version });
    const both = await core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: true, expectedVersion: ordinary.version });
    await assert.rejects(core.command('personalMemoryPolicyNative', { pauseStorage: true, expectedVersion: ordinary.version }),
      /stale_personal_context_version/);
    const paused = await core.command('personalMemoryPolicyNative', { pauseStorage: true, expectedVersion: both.version });
    assert.deepEqual(paused, { ...both, version: both.version + 1, storageEnabled: false, ordinaryEnabled: false, velaEnabled: false });
    for (const assistant of ['ordinary', 'vela'] as const) {
      await assert.rejects(core.command('personalMemoryPolicyNative', { assistant, enable: true, expectedVersion: paused.version }),
        /personal_storage_disabled/);
    }
    assert.deepEqual(await core.command('personalMemoryPolicyNative', {}), paused);
    assert.equal((await inspection.read(saved.id)).text, content);
    await core.command('close', {});
    core = undefined;
    const legacy = WorkspaceKernel.openExisting(join(root, 'profile.sqlite'));
    try {
      legacy.withTransaction(db => {
        db.prepare('DELETE FROM personal_context_conversation_sources WHERE dependent=?').run(corrected.id);
        db.exec('DROP TABLE personal_context_lineage_repair');
      });
    } finally { legacy.close(); }
    core = open();
    // Revocation is the first memory operation after opening this pre-repair profile.
    custodyAvailable = false;
    const sourceOnly = { conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision };
    await assert.rejects(core.command('personalMemoryRevokeSourceNative', sourceOnly), /private_key_unavailable/);
    assert.equal((await core.command('openResource', {
      resourceId: chat.resourceId, selection: { messageId: message.id },
    })).status, 'ready');
    custodyAvailable = true;
    await assert.rejects(core.command('personalMemoryRevokeSourceNative', revoke), /stale_personal_context_version/);
    assert.deepEqual(await core.command('personalMemoryRevokeSourceNative', correctedReview.binding),
      { revision: message.revision + 1, erasedFacts: 2 });
    await core.command('close', {});
    core = open();
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'read', id: saved.id }), /personal_record_unavailable/);
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'read', id: corrected.id }), /personal_record_unavailable/);
    const reopenedSource = await core.command('openResource', { resourceId: chat.resourceId, selection: { messageId: message.id } });
    assert.equal(reopenedSource.status, 'unavailable');
    const replays = await Promise.allSettled([
      core.command('branch', branch),
      core.command('addMessage', append),
    ]);
    for (const replay of replays) {
      assert.equal(replay.status, 'rejected', 'Revoked source text must never escape a cached command receipt');
      assert.match(String(replay.reason), /source_unavailable/);
    }
  } finally {
    await core?.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
