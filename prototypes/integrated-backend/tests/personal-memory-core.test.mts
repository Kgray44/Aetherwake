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

test('Core native project capture recalls across conversations after restart and respects correction and revocation', async () => {
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
    const project = (await core.command('desktop', { type: 'createProject', title: 'Synthetic relay project' })).projects[0];
    const chat = await core.command('createConversation', { title: 'Synthetic chat', commandId: 'chat' });
    const target = await core.command('createConversation', { title: 'Synthetic follow-up', commandId: 'target' });
    const unrelated = await core.command('createConversation', { title: 'Synthetic unrelated chat', commandId: 'unrelated' });
    for (const resourceId of [chat.resourceId, target.resourceId]) {
      await core.command('conversation', { name: 'organize', input: {
        type: 'associateProject', resourceId, projectId: project.id, expectedVersion: 1,
      } });
    }
    const content = 'I prefer a synthetic relay.';
    const source = await core.command('conversation', {
      name: 'detail', input: { resourceId: chat.resourceId },
    }) as { conversation: { revision: number } };
    const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content, expectedRevision: source.conversation.revision, commandId: 'message' });
    const preview = await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: message.id,
      scope: 'project', category: 'preferences', text: content, keywords: ['relay'],
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
    const turn = {
      executionId: 'synthetic-execution', requestId: 'synthetic-request', configurationId: 'synthetic-fixture',
      providerId: 'chatgpt-plan-responses', assistant: 'ordinary', model: 'synthetic-fixture', instructions: 'Synthetic instructions',
      messages: [{ role: 'user', content: 'Which relay?' }], contextDigest: '0'.repeat(64),
    } as const;
    assert.equal(await inspection.prepareOrdinaryRecall(target.resourceId, turn), null);
    const policy = await core.command('personalMemoryPolicyNative', {});
    assert.equal(policy.ordinaryEnabled, false);
    await core.command('personalMemoryPolicyNative', { enable: true, expectedVersion: policy.version });
    const recall = await inspection.prepareOrdinaryRecall(target.resourceId, turn);
    assert.ok(recall);
    recall.approve(recall.bodyDigest);
    assert.match(recall.turn.messages[0].content, /prefer a synthetic relay/);
    assert.doesNotThrow(() => recall.validate(recall.turn));
    assert.equal(await inspection.prepareOrdinaryRecall(unrelated.resourceId, turn), null);
    const corrected = await inspection.commitManagement(await inspection.previewManagement({
      action: 'correct', id: saved.id, version: fact.version, text: 'I prefer a different synthetic relay.',
    }));
    assert.throws(() => recall.validate(recall.turn), /stale_personal_context/);
    const next = await inspection.prepareOrdinaryRecall(target.resourceId, turn);
    assert.ok(next);
    assert.match(next.turn.messages[0].content, /prefer a different synthetic relay/);
    assert.doesNotMatch(next.turn.messages[0].content, /prefer a synthetic relay/);
    await inspection.commitManagement(await inspection.previewManagement({ action: 'revoke', id: corrected.id, version: 1 }));
    assert.equal(await inspection.prepareOrdinaryRecall(target.resourceId, turn), null);
  } finally {
    await core?.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
