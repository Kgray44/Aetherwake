import type { VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';
import type { Execution } from '../src/contracts.mts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
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
    const request = { type: 'previewSourceRevocation' as const, id: saved.id, version: fact.version };
    await assert.rejects(core.command('personalMemoryManagementNative', { ...request, version: fact.version + 1 }),
      /stale_personal_context_version/);
    const reviewed = await core.command('personalMemoryManagementNative', request) as {
      binding: { conversationId: string; messageId: string; expectedRevision: number }; sourceText: string;
    };
    assert.deepEqual(reviewed, {
      binding: { conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision },
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
      conversationId: chat.resourceId, messageId: message.id, scope: 'project', category: 'decisions', text: content, keywords: ['quartz', 'relay'],
    }));
    const preferenceChat = await core.command('createConversation', { title: 'Synthetic preferences', commandId: 'preferences-chat' });
    const preference = await core.command('addMessage', { resourceId: preferenceChat.resourceId, role: 'user',
      content: 'I prefer the synthetic amber enclosure.', expectedRevision: preferenceChat.revision, commandId: 'preference-message' });
    const global = await core.command('personalMemoryCaptureCommitNative', await core.command('personalMemoryCapturePreviewNative', {
      conversationId: preferenceChat.resourceId, messageId: preference.id, scope: 'assistant.vela', category: 'preferences',
      text: 'I prefer the synthetic amber enclosure.', keywords: ['amber', 'enclosure'],
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
    const memory = memoryOwner(core)!;
    const memoryService = await memory.open();
    const originalPreviewContext = memoryService.previewContext.bind(memoryService);
    memoryService.previewContext = request => ({ ...originalPreviewContext(request),
      items: [], omissions: [{ reason: 'scan-limit', count: 1 }] });
    try {
      await assert.rejects(core.command('velaRequestPreview', { ...input, resourceIds: [] }), /personal_memory_search_incomplete/);
    } finally { memoryService.previewContext = originalPreviewContext; }
    const globalPreview = await core.command('velaRequestPreview', { ...input, resourceIds: [], intent: 'Which amber enclosure?' });
    const globalReview = await core.command('velaNativeReview', { previewId: globalPreview.id, signature: globalPreview.signature });
    assert.match(globalReview.prompt, new RegExp(global.id));
    assert.match(globalReview.prompt, new RegExp(preference.id));
    assert.doesNotMatch(globalReview.prompt, new RegExp(saved.id));
    const indirect = { ...input, resourceIds: [] as string[], intent: 'What did we settle on?', includeRecentHistory: false };
    await assert.rejects(core.command('velaRequestPreview', indirect), /personal_memory_no_eligible_context/);
    const base = await core.command('velaRequestPreview', { ...indirect, useMemory: undefined });
    const searchBinding = { previewId: base.id, signature: base.signature };
    assert.deepEqual(await core.command('velaMemorySearchNative', searchBinding), { kind: 'unavailable' });
    const { velaApiRuntime: api } = core as unknown as { velaApiRuntime: VelaApiRuntime };
    const qualification = Object.freeze({ model: 'gpt-6-luna' }) as NonNullable<ReturnType<VelaApiRuntime['qualifiedStructuredRoute']>>;
    api.qualifiedStructuredRoute = () => qualification;
    api.isStructuredQualificationCurrent = proof => proof === qualification;
    let calls = 0;
    api.structuredProposal = async ({ payload, validate }) => {
      calls++;
      validate();
      assert.deepEqual(payload, { stage: 'interpret', request: indirect.intent });
      return { version: 2, objective: 'Recall the decision', clarification: '',
        perception: { kind: 'recall', explicitGoals: [], inferredGoals: [], constraints: [],
          capabilityHints: [], deliverables: ['text'], verification: [] },
        needs: [{ key: 'relay', question: 'Which relay was approved?', query: 'quartz relay' }] };
    };
    const queryReview = await core.command('velaMemorySearchNative', searchBinding);
    assert.equal(queryReview.kind, 'review');
    assert.equal(queryReview.request, indirect.intent);
    assert.equal(calls, 0);
    await assert.rejects(core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: '0'.repeat(64) }),
      /personal_memory_disclosure_review_required/);
    assert.equal(calls, 0);
    const expanded = await core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: queryReview.digest });
    assert.equal(expanded.kind, 'preview');
    assert.equal(calls, 1);
    await assert.rejects(core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: queryReview.digest }),
      /vela_memory_requires_conversation/);
    const expandedReview = await core.command('velaNativeReview', { previewId: base.id, signature: expanded.signature });
    assert.match(expandedReview.prompt, new RegExp(saved.id));
    assert.equal(calls, 1);
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
    // Two independently captured claims remain separately attributable until the user resolves them.
    const competingText = 'Use the synthetic cobalt relay for the fixture.';
    const competingSource = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content: competingText, expectedRevision: message.revision, commandId: 'competing-message' });
    const competing = await core.command('personalMemoryCaptureCommitNative', await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: competingSource.id, scope: 'project', category: 'decisions',
      text: competingText, keywords: ['relay', 'cobalt'],
    }));
    const reviewRecall = async (intent: string) => {
      const preview = await core.command('velaRequestPreview', { ...input, resourceIds: [], intent });
      return core.command('velaNativeReview', { previewId: preview.id, signature: preview.signature });
    };
    const conflict = await reviewRecall('Which relay should I use?');
    assert.match(conflict.prompt, new RegExp(saved.id));
    assert.match(conflict.prompt, new RegExp(competing.id));
    assert.match(conflict.prompt, new RegExp(message.id));
    assert.match(conflict.prompt, new RegExp(competingSource.id));
    const correction = await core.command('personalMemoryManagementNative', {
      type: 'preview', request: { action: 'correct', id: saved.id, version: 1,
        text: 'The synthetic basalt relay is the approved part.', keywords: ['relay', 'basalt'] },
    }) as import('../src/personal-memory-review.mts').ManagementReview;
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'commit',
      review: { ...correction, keywords: ['tampered'] } }), /personal_memory_review_mismatch/);
    const replacement = await core.command('personalMemoryManagementNative', { type: 'commit', review: correction }) as { id: string };
    await assert.rejects(core.command('authorizeVelaRequest', { previewId: conflict.previewId, signature: conflict.signature,
      reviewDigest: conflict.reviewDigest }), /stale_personal_context|personal_record_unavailable/);
    const revokeCompeting = await core.command('personalMemoryManagementNative', {
      type: 'preview', request: { action: 'revoke', id: competing.id, version: 1 },
    }) as import('../src/personal-memory-review.mts').ManagementReview;
    await core.command('personalMemoryManagementNative', { type: 'commit', review: revokeCompeting });
    await core.command('close', {});
    core = open();
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const current = await reviewRecall('Which basalt relay should I use?');
    assert.match(current.prompt, new RegExp(replacement.id));
    assert.doesNotMatch(current.prompt, new RegExp(saved.id));
    assert.doesNotMatch(current.prompt, new RegExp(competing.id));
    await assert.rejects(reviewRecall('What about quartz?'), /personal_memory_no_eligible_context/);
    const beforeRevocation = await core.command('velaRequestPreview', { ...input, resourceIds: [], intent: 'Which basalt relay should I use?' });
    const revocationBinding = { previewId: beforeRevocation.id, signature: beforeRevocation.signature };
    const revocationReview = await core.command('velaNativeReview', revocationBinding);
    const { grantId } = await core.command('authorizeVelaRequest', { ...revocationBinding, reviewDigest: revocationReview.reviewDigest });
    await core.command('personalMemoryRevokeSourceNative', {
      conversationId: chat.resourceId, messageId: message.id, expectedRevision: competingSource.revision,
    });
    await assert.rejects(core.command('vela', { name: 'request', input: { ...revocationBinding,
      intent: beforeRevocation.intent, resourceIds: [], authorizeProvider: true, grantId } }), /stale_personal_context|personal_record_unavailable/);
    await assert.rejects(reviewRecall(beforeRevocation.intent), /personal_memory_no_eligible_context/);
  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('Vela projects memory acknowledgement only for the matching readable request input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-projection-'));
  const core = new BackendCore({ path: join(root, 'profile.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  try {
    const opened = await core.command('vela', { name: 'open', input: {} }) as VelaState;
    const conversationId = opened.conversation!.resourceId;
    const message = await core.command('addMessage', { resourceId: conversationId, role: 'user',
      content: 'Synthetic reviewed request', expectedRevision: opened.conversation!.revision });
    const owner = core as unknown as { vela: { state(): VelaState }; state: { executions: Record<string, Execution> } };
    const actual = owner.vela.state.bind(owner.vela);
    const request = { id: 'memory-request', conversationId, inputMessageId: message.id, reviewedMemory: true } as VelaRequest;
    owner.vela.state = () => ({ ...actual(), requests: [{ ...request }] });
    const receipt = { state: 'simulated' as const, manifestDigest: 'a'.repeat(64) };
    const execution = { id: 'memory-execution', resourceId: conversationId, providerId: 'openai-api-vela',
      commandId: 'vela-api:' + request.id, inputMessageId: message.id, memoryDisclosure: receipt } as Execution;
    const projected = async () => ((await core.command('vela', { name: 'state', input: {} })) as VelaState).requests[0].memoryDisclosure;
    assert.equal(await projected(), undefined);
    owner.state.executions[execution.id] = execution;
    assert.equal(await projected(), undefined);
    execution.responseId = 'synthetic-provider-response';
    assert.deepEqual(await projected(), receipt);
    execution.inputMessageId = 'foreign-message';
    assert.equal(await projected(), undefined);
    execution.inputMessageId = message.id;
    request.conversationId = 'foreign-conversation';
    assert.equal(await projected(), undefined);
  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
