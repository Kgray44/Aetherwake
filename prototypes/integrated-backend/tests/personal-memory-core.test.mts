import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
import { BackendCore } from '../src/core.mts';
import type { NativePersonalMemory } from '../src/personal-memory.mts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';

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
  const secrets = {
    available: async () => true,
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
    const revoke = { conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision };
    await assert.rejects(core.command('personalMemoryRevokeSourceNative', { ...revoke, expectedRevision: chat.revision }), /stale_source_revision/);
    assert.equal((await inspection.read(saved.id)).text, content);
    const graph = (core as unknown as { graph: import('../../connected-conversations/src/graph.ts').ConversationGraph }).graph;
    const mark = graph.markUnavailable;
    graph.markUnavailable = () => { throw Error('synthetic graph write failure'); };
    try {
      await assert.rejects(core.command('personalMemoryRevokeSourceNative', revoke), /synthetic graph write failure/);
    } finally { graph.markUnavailable = mark; }
    assert.equal((await inspection.read(saved.id)).text, content);
    assert.deepEqual(await core.command('personalMemoryRevokeSourceNative', revoke), { revision: message.revision + 1, erasedFacts: 1 });
    await core.command('close', {});
    core = open();
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'read', id: saved.id }), /personal_record_unavailable/);
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

test('Vela prepares reviewed project memory from the real private-profile owner after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-vela-restart-'));
  const envelopes = new Map<string, string>();
  const secrets = {
    available: async () => true,
    async seal(value: string) {
      const wrapped = randomBytes(64);
      envelopes.set(wrapped.toString('hex'), value);
      return wrapped;
    },
    async open(wrapped: Uint8Array) {
      const value = envelopes.get(Buffer.from(wrapped).toString('hex'));
      assert.ok(value);
      return value;
    },
  };
  const open = () => {
    const core = new BackendCore({ path: join(root, 'profile.sqlite'), privateRoot: root,
      provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
    const { velaApiRuntime } = core as unknown as { velaApiRuntime: VelaApiRuntime };
    // Only catalog availability is simulated. Preview uses canonical access and never runs the provider.
    velaApiRuntime.models = async () => ['gpt-6-luna'];
    velaApiRuntime.run = async () => { throw Error('unexpected_provider_dispatch'); };
    return core;
  };
  let core = open();
  try {
    const project = (await core.command('desktop', { type: 'createProject', title: 'Synthetic memory project' })).projects[0];
    const workspace = (await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic memory workspace', projectId: project.id })).workspaces[0];
    const chat = await core.command('createConversation', { title: 'Synthetic source', commandId: 'chat' });
    await core.command('conversation', { name: 'organize', input: {
      type: 'associateProject', resourceId: chat.resourceId, projectId: project.id, expectedVersion: 1,
    } });
    const detail = await core.command('conversation', { name: 'detail', input: { resourceId: chat.resourceId } }) as { conversation: { revision: number } };
    const content = 'The synthetic quartz relay is the approved part.';
    const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content, expectedRevision: detail.conversation.revision, commandId: 'message' });
    const saved = await core.command('personalMemoryCaptureCommitNative', await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: message.id, scope: 'project', category: 'decisions', text: content, keywords: ['quartz'],
    }));
    const policy = await core.command('personalMemoryPolicyNative', {});
    assert.equal(policy.velaEnabled, false);
    await core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: true, expectedVersion: policy.version });
    await core.command('velaApiConfigure', { credential: { configurationId: 'vela-primary', apiKey: 'synthetic-restart-credential' }, expectedVersion: null });
    await core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: true });
    await core.command('close', {});
    core = open();
    const state = await core.command('vela', { name: 'open', input: {} }) as import('../../vela-core/src/contracts.ts').VelaState;
    assert.equal(state.reviewedMemoryAvailable, true);
    assert.notEqual(state.conversation?.resourceId, chat.resourceId);
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const input = { intent: 'Which quartz relay should I use?', resourceIds: [], adaptive: true,
      providerId: 'openai-api-vela', useMemory: true } as const;
    const recall = () => core.command('velaRequestPreview', { ...input, resourceIds: [] });
    const preview = await recall();
    assert.equal(preview.sendDisposition, 'review-required');
    const binding = { previewId: preview.id, signature: preview.signature };
    const reviewed = await core.command('velaNativeReview', binding);
    assert.match(reviewed.prompt, /synthetic quartz relay is the approved part/);
    assert.match(reviewed.prompt, new RegExp(saved.id));
    const bySource = () => core.command('velaRequestPreview', { ...input, resourceIds: [],
      intent: `What was decided in message:${message.id}?`, includeRecentHistory: false });
    const exact = await bySource();
    const exactReview = await core.command('velaNativeReview', { previewId: exact.id, signature: exact.signature });
    assert.match(exactReview.prompt, new RegExp(saved.id));
    await assert.rejects(core.command('velaRequestPreview', { ...input, resourceIds: [],
      intent: 'What was decided in message:msg-999999999?', includeRecentHistory: false }), /personal_memory_no_eligible_context/);
    const other = (await core.command('desktop', { type: 'createProject', title: 'Synthetic unrelated project' })).projects.find(item => item.id !== project.id)!;
    const otherWorkspace = (await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic unrelated workspace', projectId: other.id })).workspaces.find(item => item.id !== workspace.id)!;
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: otherWorkspace.id } });
    await assert.rejects(core.command('authorizeVelaRequest', { ...binding, reviewDigest: reviewed.reviewDigest }), /stale_vela_preview/);
    await assert.rejects(recall(), /personal_memory_no_eligible_context/);
    await assert.rejects(bySource(), /personal_memory_no_eligible_context/);
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const beforeRevocation = await recall();
    const revocationBinding = { previewId: beforeRevocation.id, signature: beforeRevocation.signature };
    const revocationReview = await core.command('velaNativeReview', revocationBinding);
    const { grantId } = await core.command('authorizeVelaRequest', { ...revocationBinding, reviewDigest: revocationReview.reviewDigest });
    await core.command('personalMemoryRevokeSourceNative', {
      conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision,
    });
    await assert.rejects(core.command('vela', { name: 'request', input: { ...revocationBinding,
      intent: input.intent, resourceIds: [], authorizeProvider: true, grantId } }), /stale_personal_context|personal_record_unavailable/);
    await assert.rejects(recall(), /personal_memory_no_eligible_context/);
  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
