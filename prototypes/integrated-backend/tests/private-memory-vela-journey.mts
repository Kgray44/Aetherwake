import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';

export async function verifyPrivateMemoryVelaJourney(root: string, secrets: NativeHostServices['secrets']) {
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
  }
}
