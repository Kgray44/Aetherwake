import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { NativePersonalMemory } from '../src/personal-memory.mts';
import { createPersonalMemoryReview } from '../src/personal-memory-review.mts';

test('native capture reviews exact source, saves once, and leaves provider use off', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const transaction = kernel.withTransaction.bind(kernel);
  const sourceText = 'The synthetic relay is our choice.';
  const message = { conversationId: 'chat', messageId: 'message', projectId: 'project', role: 'user' as const,
    sensitive: false, version: '1', contentDigest: createHash('sha256').update(sourceText).digest('hex') };
  let enabled = true;
  let nativeOpen: () => ReturnType<NativePersonalMemory['open']>;
  const review = createPersonalMemoryReview({
    open: () => nativeOpen(), transaction,
    readSourceText: () => sourceText,
    resolveConversationSource: () => enabled ? message : null,
    resolveScope: scope => ({ scope, version: '1' }),
  });
  let wrappedValue: string;
  const owner = new NativePersonalMemory({
    kernel, host: {
      identity: () => ({ userId: 'local-owner', policyVersion: '1' }),
      resolveConversationSource: () => enabled ? message : null,
      resolveScope: scope => ({ scope, version: '1' }),
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
    await assert.rejects(review.commitCapture(preview), /personal_memory_review_mismatch/);
    const next = await review.previewCapture(input);
    assert.equal(next.enableStorage, false);
    assert.equal(next.policy.ordinaryEnabled, false);
    assert.equal(next.policy.velaEnabled, false);
    review.cancelCapture(next.id);
    await assert.rejects(review.commitCapture(next), /personal_memory_review_mismatch/);
    const stale = await review.previewCapture(input);
    enabled = false;
    await assert.rejects(review.commitCapture(stale), /conversation_source_unavailable/);
  } finally {
    owner.close();
    kernel.close();
  }
});
