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

import { createRequire } from 'node:module';
const { velaCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
for (const scenario of ['cancel-query','cancel-final','scope-change','policy-change']) test(`broker to real Core query-only memory: ${scenario}`, async () => {
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
    const indirect = { ...input, resourceIds: [] as string[], intent: 'What did we settle on?', includeRecentHistory: false };
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
        needs: [{ key: 'relay', question: 'Which relay was approved?', query: 'quartz relay' }, { key: 'shipment', question: 'Which shipment date was approved?', query: 'shipment date' }] };
    };

    const commands: string[] = [];
    let finalReviews = 0;
    const originalProducer = api.structuredProposal;
    if (scenario === 'policy-change') api.structuredProposal = async (...args) => {
      const proposal = await originalProducer(...args);
      const current = await core.command('personalMemoryPolicyNative', {});
      await core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: false, expectedVersion: current.version });
      return proposal;
    };
    const run = velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, beforeMemoryPreview: async () => {}, validateMemoryReview: () => true,
      input: { name: 'request', input: { intent: indirect.intent, resourceIds: [], providerId: 'openai-api-vela', authorizeProvider: true, useMemory: true, includeRecentHistory: false } },
      reviewMemorySearch: async (review: {request: string}) => {
        assert.equal(review.request, indirect.intent);
        assert.equal(calls, 0);
        if (scenario === 'scope-change') {
          const foreign = (await core.command('desktop', { type: 'createProject', title: 'Other synthetic project' })).projects.find(p => p.id !== project.id)!;
          const currentSource = await core.command('conversation', {name:'detail',input:{resourceId:chat.resourceId}}) as {conversation:{version:number}};
          await core.command('conversation', {name:'organize',input:{type:'associateProject',resourceId:chat.resourceId,projectId:foreign.id,expectedVersion:currentSource.conversation.version}});
        }
        return scenario !== 'cancel-query';
      },
      reviewProvider: async ({review}: {review: {prompt:string;memory?:{partialCoverage?:true}}}) => {
        finalReviews++;
        assert.match(review.prompt, /synthetic quartz relay is the approved part/);
        assert.equal(review.memory?.partialCoverage,true);
        assert.doesNotMatch(review.prompt,/shipment date/);
        return false; // Exact prompt review deliberately declines before any send grant.
      },
      call: async (name: string, input: unknown) => {
        commands.push(name);
        assert.notEqual(name, 'authorizeVelaRequest', 'No send authorization after cancellation/stale scope');
        assert.notEqual(name, 'vela', 'No fallback send');
        return core.command(name as never, input as never);
      },
    });
    await assert.rejects(run, scenario === 'cancel-query' || scenario === 'cancel-final' ? /authorization_cancelled/ : /stale|changed|scope|preview|personal_memory_no_eligible_context/);
    assert.equal(calls, scenario !== 'cancel-query' ? 1 : 0);
    assert.equal(finalReviews, scenario === 'cancel-final' ? 1 : 0);
    assert.equal(commands.includes('authorizeVelaRequest'), false);
    assert.equal(commands.includes('vela'), false);
  } finally {
    await core?.command('close', {});
    rmSync(root, {recursive:true, force:true});
  }
});
