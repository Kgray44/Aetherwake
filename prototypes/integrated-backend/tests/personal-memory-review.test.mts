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
  let sensitive = false;
  let openCount = 0;
  let sourceProject: string | null = 'project';
  let activeVelaProject: string | null = 'project';
  let projectReadable = true;
  const resolveScope = (scope: PersonalScope) =>
    scope.kind === 'project' && !projectReadable ? null : { scope, version: '1' };
  let nativeOpen: () => ReturnType<NativePersonalMemory['open']>;
  const review = createPersonalMemoryReview({
    open: () => { openCount++; return nativeOpen(); }, transaction,
    readSourceText: () => sourceText,
    resolveVelaRecallTarget: () => ({ conversationId: 'vela-chat', projectId: activeVelaProject }),
    resolveRecallTarget: id => id === 'other-chat' ? { projectId: 'project' } :
      id === 'foreign-chat' ? { projectId: 'foreign-project' } : null,
    resolveConversationSource: () => enabled ? { ...message, projectId: sourceProject, sensitive } : null,
    resolveScope,
  });
  let wrappedValue: string;
  const owner = new NativePersonalMemory({
    kernel, host: {
      identity: () => ({ userId: 'local-owner', policyVersion: '1' }),
      resolveConversationSource: () => enabled ? { ...message, projectId: sourceProject, sensitive } : null,
      resolveScope,
      authorize: input => review.authorize(input) ? { decision: 'allow', policyVersion: '1', authorizationRef: 'synthetic-review' } : { decision: 'deny' },
    },
    secrets: { available: async () => true, async seal(value) { wrappedValue = value; return randomBytes(64); }, async open() { return wrappedValue; } },
  });
  nativeOpen = () => owner.open();
  try {
    const input = { conversationId: 'chat', messageId: 'message', scope: 'project', category: 'decisions',
      text: 'Use the synthetic relay', keywords: ['relay'] } as const;
    sensitive = true;
    await assert.rejects(review.previewCapture(input), /conversation_source_unavailable/);
    assert.equal(openCount, 0);
    assert.equal(owner.hasStorage(), false);
    sensitive = false;
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
    const globalInput = { ...input, scope: 'assistant.ordinary', category: 'preferences', text: 'I prefer the synthetic quartz finish.', keywords: ['quartz'] } as const;
    await assert.rejects(review.previewCapture(globalInput), /conversation_source_scope_mismatch/);
    sourceProject = null;
    const globalReview = await review.previewCapture(globalInput);
    const globalFact = await review.commitCapture(globalReview);
    assert.deepEqual(globalFact.scope, { kind: 'assistant.ordinary' });
    assert.equal(globalFact.provenance.kind, 'conversation-message');
    sourceProject = 'project';
    await assert.rejects(review.read(globalFact.id), /conversation_source_unavailable/);
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
    const followupTurn = { ...turn, messages: [{ role: 'user', content: 'What did we settle on?' }] } as const;
    const sourceAnchors = [{ kind: 'conversation-message' as const, conversationId: input.conversationId, messageId: input.messageId }];
    assert.equal(await review.prepareOrdinaryRecall('other-chat', followupTurn), null);
    const ordinaryAnchored = await review.prepareOrdinaryRecall('other-chat', followupTurn, sourceAnchors);
    assert.ok(ordinaryAnchored);
    assert.deepEqual(ordinaryAnchored.manifest.items.map(item => item.factId), [saved.id]);
    ordinaryAnchored.approve(ordinaryAnchored.bodyDigest);
    assert.doesNotThrow(() => ordinaryAnchored.validate(ordinaryAnchored.turn));
    assert.equal(await review.prepareOrdinaryRecall('foreign-chat', followupTurn, sourceAnchors), null);
    assert.equal(await review.prepareOrdinaryRecall('other-chat', { ...followupTurn, webSearch: true }, sourceAnchors), null);
    const velaInput = { conversationId: 'vela-chat', projectId: 'project', requestId: 'vela-recall',
      intent: 'Which relay?', prompt: 'Trusted Vela envelope\n{"intent":"Which relay?"}' };
    assert.equal(await review.prepareVelaRecall(velaInput), null);
    const policy = (await review.inspect({ after: null, limit: 1 })).policy;
    await review.setProviderUse('vela', true, policy.version);
    sourceProject = null;
    const globalTurn = { ...turn, messages: [{ role: 'user', content: 'Which quartz finish?' }] } as const;
    const globalRecall = await review.prepareOrdinaryRecall('foreign-chat', globalTurn);
    assert.ok(globalRecall);
    assert.ok(globalRecall.manifest.items.some(item => item.factId === globalFact.id));
    globalRecall.approve(globalRecall.bodyDigest);
    assert.equal(await review.prepareVelaRecall({ ...velaInput, intent: 'Which quartz finish?' }), null);
    sourceProject = 'project';
    assert.throws(() => globalRecall.validate(globalRecall.turn), /stale_personal_context/);
    const velaRecall = await review.prepareVelaRecall(velaInput);
    assert.ok(velaRecall);
    assert.match(velaRecall.prompt, /synthetic relay/);
    assert.throws(() => velaRecall.validate(velaRecall.prompt), /personal_memory_disclosure_review_required/);
    velaRecall.approve(velaRecall.promptDigest);
    assert.doesNotThrow(() => velaRecall.validate(velaRecall.prompt));
    assert.throws(() => velaRecall.validate(velaRecall.prompt + ' altered'), /personal_memory_body_changed/);
    const followup = { ...velaInput, requestId: 'anchored-vela-recall', intent: 'What did we settle on?' };
    assert.equal(await review.prepareVelaRecall(followup), null);
    // The original wording misses. Only a validated evidence query may add search hints.
    const cieProposal = { version: 2, objective: 'Recall the choice', clarification: '',
      perception: { kind: 'recall', explicitGoals: [], inferredGoals: [], constraints: [],
        capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key: 'choice', question: 'Which relay was selected?', query: 'synthetic relay' }] };
    const expanded = await review.prepareVelaRecall(followup, cieProposal);
    assert.ok(expanded);
    assert.match(expanded.prompt, new RegExp(saved.id));
    assert(!expanded.prompt.includes(cieProposal.objective));
    expanded.approve(expanded.promptDigest);
    assert.doesNotThrow(() => expanded.validate(expanded.prompt));
    assert.equal(await review.prepareVelaRecall(followup, { ...cieProposal, projectId: 'project' }), null);
    assert.equal(await review.prepareVelaRecall(followup, { ...cieProposal,
      needs: [{ ...cieProposal.needs[0], sourceAnchors }] }), null);
    const expandedPolicy = (await review.inspect({ after: null, limit: 1 })).policy;
    await review.setProviderUse('vela', false, expandedPolicy.version);
    assert.equal(await review.prepareVelaRecall(followup, cieProposal), null);
    assert.throws(() => expanded.validate(expanded.prompt), /stale_personal_context/);
    await review.setProviderUse('vela', true, expandedPolicy.version + 1);
    const expandedAgain = await review.prepareVelaRecall(followup, cieProposal);
    assert.ok(expandedAgain);
    expandedAgain.approve(expandedAgain.promptDigest);
    activeVelaProject = 'foreign-project';
    assert.equal(await review.prepareVelaRecall({ ...followup, projectId: 'foreign-project' }, cieProposal), null);
    assert.throws(() => expandedAgain.validate(expandedAgain.prompt), /stale_personal_context/);
    activeVelaProject = 'project';
    const anchored = await review.prepareVelaRecall({ ...followup,
      sourceAnchors: [{ kind: 'conversation-message', conversationId: input.conversationId, messageId: input.messageId }] });
    assert.ok(anchored);
    assert.match(anchored.prompt, /synthetic relay/);
    await assert.rejects(review.prepareVelaRecall({ ...velaInput, projectId: 'foreign-project' }), /canonical_scope_unavailable/);
    activeVelaProject = null;
    assert.throws(() => velaRecall.validate(velaRecall.prompt), /stale_personal_context/);
    assert.equal(await review.prepareVelaRecall({ ...velaInput, projectId: null }), null);
    activeVelaProject = 'project';
    const enabledPolicy = (await review.inspect({ after: null, limit: 1 })).policy;
    await review.setProviderUse('ordinary', false, enabledPolicy.version);
    assert.throws(() => recall.validate(recall.turn), /stale_personal_context/);
    assert.equal(await review.prepareOrdinaryRecall('other-chat', turn), null);
    await review.setProviderUse('ordinary', true, enabledPolicy.version + 1);
    assert.throws(() => recall.validate(recall.turn), /stale_personal_context/);
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
    assert.throws(() => velaRecall.validate(velaRecall.prompt), /stale_personal_context/);
    assert.equal(await review.prepareVelaRecall(followup, cieProposal), null);
    enabled = true;
    const correction = await review.previewManagement({ action: 'correct', id: saved.id, version: saved.version, text: 'Use the revised synthetic relay' });
    await assert.rejects(review.commitManagement({ ...correction, text: 'Tampered' }), /personal_memory_review_mismatch/);
    const corrected = await review.commitManagement(correction);
    assert.equal(corrected.action, 'correct');
    assert.equal((await review.read(corrected.id)).text, 'Use the revised synthetic relay');
    const exported = await review.commitManagement(await review.previewManagement({ action: 'export', id: corrected.id, version: 1 }));
    assert.equal(exported.action, 'export');
    if (exported.action === 'export') assert.match(JSON.stringify(exported.bundle), /revised synthetic relay/);
    const revoke = await review.previewManagement({ action: 'revoke', id: corrected.id, version: 1 });
    const staleDeletion = await review.previewManagement({ action: 'delete', id: corrected.id, version: 1 });
    await review.commitManagement(revoke);
    await assert.rejects(review.commitManagement(revoke), /personal_memory_review_mismatch/);
    await assert.rejects(review.commitManagement(staleDeletion), /stale_personal_context_version/);
    assert.equal(await review.prepareOrdinaryRecall('other-chat', turn), null);
    enabled = false;
    const deletion = await review.previewManagement({ action: 'delete', id: corrected.id, version: 2 });
    assert.equal(deletion.fact, null);
    await review.commitManagement(deletion);
    await assert.rejects(review.read(corrected.id), /personal_record_unavailable/);
  } finally {
    owner.close();
    kernel.close();
  }
});
