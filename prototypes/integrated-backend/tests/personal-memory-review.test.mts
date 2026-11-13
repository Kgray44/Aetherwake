import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { NativePersonalMemory } from '../src/personal-memory.mts';
import { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
import type { PersonalScope } from '../../personal-context/src/contracts.ts';

test('native capture reviews exact source, saves once, and leaves provider use off', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const transaction = kernel.withTransaction.bind(kernel);
  const sourceText = 'The synthetic relay is our choice.';
  const message = { conversationId: 'chat', messageId: 'message', projectId: 'project', role: 'user' as const,
    sensitive: false, version: '1', contentDigest: createHash('sha256').update(sourceText).digest('hex') };
  let enabled = true;
  let projectReadable = true;
  const resolveScope = (scope: PersonalScope) =>
    scope.kind === 'project' && !projectReadable ? null : { scope, version: '1' };
  let nativeOpen: () => ReturnType<NativePersonalMemory['open']>;
  const review = createPersonalMemoryReview({
    open: () => nativeOpen(), transaction,
    readSourceText: () => sourceText,
    resolveRecallTarget: id => id === 'other-chat' ? { projectId: 'project' } :
      id === 'foreign-chat' ? { projectId: 'foreign-project' } : null,
    resolveConversationSource: () => enabled ? message : null,
    resolveScope,
  });
  let wrappedValue: string;
  const owner = new NativePersonalMemory({
    kernel, host: {
      identity: () => ({ userId: 'local-owner', policyVersion: '1' }),
      resolveConversationSource: () => enabled ? message : null,
      resolveScope,
      authorize: input => review.authorize(input) ? { decision: 'allow', policyVersion: '1', authorizationRef: 'synthetic-review' } : { decision: 'deny' },
    },
    secrets: { available: async () => true, async seal(value) { wrappedValue = value; return randomBytes(64); }, async open() { return wrappedValue; } },
  });
  nativeOpen = () => owner.open();
  try {
    const input = { conversationId: 'chat', messageId: 'message', scope: 'project', category: 'decisions',
      text: 'Use the synthetic relay', keywords: ['relay'] } as const;
    const preview = await review.previewCapture(input);
    assert.equal(preview.sourceText, sourceText);
    assert.equal(preview.draft.text, input.text);
    assert.equal(preview.enableStorage, true);
    assert.deepEqual(preview.draft.scope, { kind: 'project', id: 'project' });
    const service = await owner.open();
    assert.throws(() => service.reviewFact(preview.draft), /personal_storage_disabled|personal_context_not_authorized/);
    await assert.rejects(review.commitCapture({ ...preview, enableStorage: false }), /personal_memory_review_mismatch/);
    const saved = await review.commitCapture(preview);
    assert.equal(saved.text, input.text);
    assert.throws(() => service.readFact(saved.id), /personal_context_not_authorized/);
    const inspected = await review.inspect({ after: null, limit: 8 });
    assert.deepEqual(inspected.records.map(item => item.id), [saved.id]);
    assert(!JSON.stringify(inspected).includes(saved.text));
    assert.equal((await review.read(saved.id)).provenance.kind, 'conversation-message');
    projectReadable = false;
    assert.deepEqual((await review.inspect({ after: null, limit: 8 })).records, []);
    await assert.rejects(review.read(saved.id), /canonical_scope_unavailable/);
    projectReadable = true;
    await assert.rejects(review.commitCapture(preview), /personal_memory_review_mismatch/);
    const next = await review.previewCapture(input);
    assert.equal(next.enableStorage, false);
    assert.equal(next.policy.ordinaryEnabled, false);
    assert.equal(next.policy.velaEnabled, false);
    const turn = {
      executionId: 'execution', requestId: 'recall', configurationId: 'fixture',
      providerId: 'chatgpt-plan-responses', assistant: 'ordinary', model: 'fixture',
      instructions: 'Trusted instructions', messages: [{ role: 'user', content: 'Which relay?' }],
      contextDigest: '0'.repeat(64),
    } as const;
    assert.equal(await review.prepareOrdinaryRecall('other-chat', turn), null);
    await review.setProviderUse('ordinary', true, next.policy.version);
    const recall = await review.prepareOrdinaryRecall('other-chat', turn);
    assert.ok(recall);
    assert.match(recall.turn.messages[0].content, /synthetic relay/);
    assert.throws(() => recall.validate(recall.turn), /personal_memory_disclosure_review_required/);
    assert.throws(() => recall.approve('0'.repeat(64)), /personal_memory_body_changed/);
    recall.approve(recall.bodyDigest);
    assert.doesNotThrow(() => recall.validate(recall.turn));
    assert.equal(await review.prepareOrdinaryRecall('foreign-chat', turn), null);
    assert.equal(await review.prepareOrdinaryRecall('other-chat', { ...turn, webSearch: true }), null);
    assert.equal(await review.prepareOrdinaryRecall('other-chat', { ...turn, messages: [{ role: 'user', content: 'Weather tomorrow' }] }), null);
    const cancelled = await review.prepareOrdinaryRecall('other-chat', turn);
    assert.ok(cancelled);
    cancelled.revoke();
    assert.throws(() => cancelled.approve(cancelled.bodyDigest), /personal_memory_disclosure_review_required/);
    review.cancelCapture(next.id);
    await assert.rejects(review.commitCapture(next), /personal_memory_review_mismatch/);
    const stale = await review.previewCapture(input);
    enabled = false;
    await assert.rejects(review.commitCapture(stale), /conversation_source_unavailable/);
    await assert.rejects(review.read(saved.id), /conversation_source_unavailable/);
    assert.throws(() => recall.validate(recall.turn), /stale_personal_context/);
  } finally {
    owner.close();
    kernel.close();
  }
});
