import { createMemoryCaptureEditor, type MemoryCaptureRequest } from '../../conversation-product/src/memory-capture-editor.ts';
import { componentDocument, until } from '../../conversation-product/test/component-dom.mts';
import type { VelaState } from '../../vela-core/src/contracts.ts';
import type { Execution } from '../src/contracts.mts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';
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
    const content = 'After all that we have said about what we should use, the synthetic quartz relay is the approved part.';
    const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content, expectedRevision: detail.conversation.revision, commandId: 'message' });
    const dom = componentDocument(), restore = dom.install();
    let submitted: MemoryCaptureRequest | undefined;
    try {
      const editor = createMemoryCaptureEditor({content, conversationId:chat.resourceId, messageId:message.id, projectId:project.id,
        async review(request) {submitted=request;return false;}, report() {}});
      editor.querySelectorAll('select')[0].value='project';
      (editor as unknown as {fire(name:string):void}).fire('submit');
      await until(()=>submitted!==undefined);
    } finally { restore(); }
    assert.ok(submitted);
    assert.equal(submitted.expectedSourceText, content);
    assert.equal(submitted.expectedProjectId, project.id);
    assert.ok(submitted.keywords.includes('quartz'));
    const saved = await core.command('personalMemoryCaptureCommitNative', await core.command('personalMemoryCapturePreviewNative', submitted));
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
    const indirect = { ...input, resourceIds: [] as string[], intent: 'What was chosen?', includeRecentHistory: false };
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
      if (calls === 1) {
        await assert.rejects(core.command('velaNativeReview', searchBinding), /personal_memory_disclosure_review_required/);
        await assert.rejects(core.command('authorizeVelaRequest', searchBinding), /personal_memory_disclosure_review_required/);
      }
      return { version: 2, objective: 'Recall the decision', clarification: '',
        perception: { kind: 'recall', explicitGoals: [], inferredGoals: [], constraints: [],
          capabilityHints: [], deliverables: ['text'], verification: [] },
        needs: [{ key: 'relay', question: 'Which relay was approved?', query: 'quartz relay' }, { key: 'shipment', question: 'Which shipment date was approved?', query: 'shipment date' }] };
    };
    const queryReview = await core.command('velaMemorySearchNative', searchBinding);
    assert.equal(queryReview.kind, 'review');
    assert.equal(queryReview.request, indirect.intent);
    assert.equal(calls, 0);
    await assert.rejects(core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: '0'.repeat(64) }),
      /personal_memory_disclosure_review_required/);
    assert.equal(calls, 0);
    const raced = await Promise.allSettled([0, 1].map(() => core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: queryReview.digest })));
    assert.equal(raced[0].status, 'fulfilled'); assert.equal(raced[1].status, 'rejected');
    const expanded = (raced[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof core.command<'velaMemorySearchNative'>>>>).value;
    assert.equal(expanded.kind, 'preview');
    assert.equal(calls, 1);
    await assert.rejects(core.command('velaMemorySearchNative', { ...searchBinding, reviewDigest: queryReview.digest }),
      /vela_memory_requires_conversation/);
    const expandedReview = await core.command('velaNativeReview', { previewId: base.id, signature: expanded.signature });
    assert.match(expandedReview.prompt, new RegExp(saved.id));
    assert.equal(expandedReview.memory?.partialCoverage, true);
    assert.match(expandedReview.prompt, /Memory coverage is partial/);
    assert.doesNotMatch(expandedReview.prompt, /shipment date/);
    assert.equal(calls, 1);
    const staleBase = await core.command('velaRequestPreview', { ...indirect, useMemory: undefined });
    const staleBinding = { previewId: staleBase.id, signature: staleBase.signature };
    const staleReview = await core.command('velaMemorySearchNative', staleBinding);
    assert.equal(staleReview.kind, 'review');
    const syntheticProducer = api.structuredProposal;
    api.structuredProposal = async (...args) => {
      const result = await syntheticProducer(...args);
      const current = await core.command('personalMemoryPolicyNative', {});
      await core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: false, expectedVersion: current.version });
      return result;
    };
    await assert.rejects(core.command('velaMemorySearchNative', { ...staleBinding, reviewDigest: staleReview.digest }), /stale_personal_context/);
    await assert.rejects(core.command('velaMemorySearchNative', { ...staleBinding, reviewDigest: staleReview.digest }), /vela_memory_requires_conversation/);
    const paused = await core.command('personalMemoryPolicyNative', {});
    await core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: true, expectedVersion: paused.version });
    api.structuredProposal = syntheticProducer;
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
    const unreviewed = await recall();
    await assert.rejects(core.command('authorizeVelaRequest', { previewId: unreviewed.id, signature: unreviewed.signature }),
      /vela_native_review_required/);
    await assert.rejects(core.command('authorizeVelaRequest', { ...revocationBinding,
      reviewDigest: revocationReview.reviewDigest, directSend: true }), /vela_attached_context_review_required/);
    const { grantId } = await core.command('authorizeVelaRequest', { ...revocationBinding, reviewDigest: revocationReview.reviewDigest });
    await core.command('personalMemoryRevokeSourceNative', {
      conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision,
    });
    await assert.rejects(core.command('vela', { name: 'request', input: { ...revocationBinding,
      intent: input.intent, resourceIds: [], authorizeProvider: true, grantId } }), /stale_personal_context|personal_record_unavailable/);
    await assert.rejects(core.command('velaNativeReview', { previewId: unreviewed.id, signature: unreviewed.signature }),
      /stale_personal_context|personal_record_unavailable/);
    await assert.rejects(recall(), /personal_memory_no_eligible_context/);
  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});


for (const legacyDisclosure of [false, true]) test('Vela memory-derived replies remain readable locally and stay out of voice and attached conversation context' + (legacyDisclosure ? ' (legacy disclosure)' : ''), async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-derived-'));
  const core = new BackendCore({ path: join(root, 'profile.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  try {
    const opened = await core.command('vela', { name: 'open', input: {} }) as VelaState;
    const conversationId = opened.conversation!.resourceId;
    const input = await core.command('addMessage', { resourceId: conversationId, role: 'user',
      content: 'Synthetic reviewed question', expectedRevision: opened.conversation!.revision });
    const reply = await core.command('addMessage', { resourceId: conversationId, role: 'assistant',
      content: 'Synthetic reply containing a private memory', expectedRevision: input.revision });
    const owner = core as unknown as {
      state: { executions: Record<string, Execution>; messageEvidence: Record<string, { executionId: string }> };
      velaHost: import('../../vela-core/src/canonical-host.mts').CanonicalVelaHost;
      voiceContext(id: string, purpose: 'conversation'): Promise<{ contextRef: string; contextDigest: string; history: unknown[] }>;
      validateVoiceContext(ref: string, digest: string): void;
    };
    const branchInput = { resourceId: conversationId, messageId: reply.id, includeMessageIds: [reply.id],
      providerId: 'local', title: 'Synthetic branch', commandId: 'branch', tokenBudget: 8192, expectedRevision: reply.revision };
    const branch = await core.command('branch', branchInput);
    const publish = { name: 'publish' as const, input: { sourceResourceId: conversationId, sourceMessageId: reply.id, evidence: 'excerpt' as const } };
    const share = await core.command('conversation', publish) as { id: string };
    await core.command('conversation', { name: 'inspectShare', input: { shareId: share.id, resourceId: branch.conversation.resourceId } });
    const before = await owner.voiceContext(conversationId, 'conversation');
    assert.match(JSON.stringify(before.history), /containing a private memory/);
    owner.state.executions['memory-execution'] = (legacyDisclosure ? { memoryDisclosure: { receipt: 'synthetic-legacy' } } : { reviewedMemory: true }) as Execution;
    owner.state.messageEvidence[reply.id] = { executionId: 'memory-execution' };
    await assert.rejects(core.command('branch', branchInput), /source_unavailable/);
    await assert.rejects(core.command('branch', { ...branchInput, commandId: 'second-branch' }), /source_unavailable/);
    await assert.rejects(core.command('review', { handoffId: branch.handoff.id, fingerprint: branch.handoff.fingerprint,
      approve: true }), /source_unavailable/);
    await assert.rejects(core.command('conversation', publish), /source_unavailable/);
    await assert.rejects(core.command('conversation', { name: 'inspectShare',
      input: { shareId: share.id, resourceId: branch.conversation.resourceId } }), /source_unavailable/);
    assert.throws(() => owner.validateVoiceContext(before.contextRef, before.contextDigest), /live_context_changed/);
    const after = await owner.voiceContext(conversationId, 'conversation');
    assert.doesNotMatch(JSON.stringify(after.history), /containing a private memory/);
    assert.match(JSON.stringify(after.history), /Synthetic reviewed question/);
    const attached = owner.velaHost.readContent(conversationId, owner.velaHost.scope());
    assert.ok(attached);
    assert.doesNotMatch(attached.content, /containing a private memory/);
    assert.match(attached.content, /Synthetic reviewed question/);
    const local = await core.command('vela', { name: 'state', input: {} }) as VelaState;
    assert(local.conversation?.messages.some(message => message.id === reply.id));
  } finally {
    await core.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
