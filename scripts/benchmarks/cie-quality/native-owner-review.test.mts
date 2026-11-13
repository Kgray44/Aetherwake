import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { historyDigest } from '../../../prototypes/vela-core/src/bounded-history.mts';
import { planningDigest } from '../../../prototypes/vela-core/src/codex-planning-adapter.mts';
import { BLIND_INPUT_SHA256, readBlindInputs } from './blind-runner.mts';
import { checkNativeCieOwnerReview, prepareSourceFreeCieOwnerReview, type NativeCieOwnerReview } from './native-owner-review.mts';

test('dormant native owner check binds actual review bytes and refuses expiry or revocation', () => {
  const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));
  const cases = readBlindInputs(bytes);
  const item = cases.find(row => row.sources.length)!;
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const profileId = '12345678-1234-1234-1234-123456789012';
  const model = 'fixture-model';
  const catalogDigest = 'c'.repeat(64);
  const scope: NativeCieOwnerReview['scope'] = {
    candidate, inputSha256: BLIND_INPUT_SHA256, profileId, configurationVersion: 2, catalogDigest,
    provider: 'openai-api-vela', model, caseIds: [item.id], maxCalls: 6, expiresAt: 200,
  };
  const current = {
    candidate, now: 100, catalog: { configurationVersion: 2, digest: catalogDigest, models: [model] },
    profile: { profileId, configurationVersion: 2, usage: {
      enabled: true, configurationVersion: 2, maxOutputTokens: 2048, requestsPerDay: 64, usedToday: 0,
    } },
  };
  const preview = {
    id: 'preview', signature: 'signature', intent: item.request, expiresAt: new Date(150).toISOString(),
    resourceIds: item.sources.map(source => source.id), providerId: scope.provider,
    sendDisposition: 'review-required', semanticContext: true, route: { kind: 'conversational', model },
  } as Parameters<typeof checkNativeCieOwnerReview>[0]['preview'];
  const prompt = 'Exact controlled public evidence';
  const review = {
    previewId: preview.id, signature: preview.signature, providerId: preview.providerId, route: preview.route,
    semanticContext: true, prompt, promptDigest: historyDigest(prompt), reviewDigest: 'd'.repeat(64),
    context: { included: item.sources.map(source => ({
      id: source.id, kind: 'resource', resourceKind: 'note', title: source.title, content: source.text,
    })) },
  } as Parameters<typeof checkNativeCieOwnerReview>[0]['review'];
  const ownerReview = { scope, caseId: item.id, previewId: preview.id, signature: preview.signature,
    reviewDigest: review.reviewDigest, promptDigest: review.promptDigest };
  const options = { bytes, current, preview, review, ownerReview, caseId: item.id, ownerCurrent: () => true };
  assert.deepEqual(checkNativeCieOwnerReview(options), {
    previewId: preview.id, signature: preview.signature, reviewDigest: review.reviewDigest,
  });
  assert.throws(() => checkNativeCieOwnerReview({ ...options, ownerReview: null }), /review_unavailable/u);
  assert.throws(() => checkNativeCieOwnerReview({ ...options, ownerCurrent: () => false }), /review_unavailable/u);
  let checks = 0;
  assert.throws(() => checkNativeCieOwnerReview({ ...options, ownerCurrent: () => ++checks === 1 }), /review_unavailable/u);
  assert.throws(() => checkNativeCieOwnerReview({ ...options, current: { ...current, now: 150 } }), /scope_changed/u);
  assert.throws(() => checkNativeCieOwnerReview({ ...options, review: { ...review, prompt: 'substitution' } }), /invalid_native_vela_review/u);
  assert.throws(() => checkNativeCieOwnerReview({ ...options, review: { ...review,
    context: { ...review.context, included: [{ ...review.context.included[0], content: 'foreign' }, ...review.context.included.slice(1)] },
  } }), /scope_changed/u);
  const empty = cases.find(row => !row.sources.length)!;
  assert.throws(() => checkNativeCieOwnerReview({
    ...options, caseId: empty.id, preview: { ...preview, intent: empty.request, resourceIds: [] },
    ownerReview: { ...ownerReview, caseId: empty.id, scope: { ...scope, caseIds: [empty.id], maxCalls: 1 } },
  }), /empty_owner_review_unavailable/u);

  const context = { id: 'empty', createdAt: new Date(0).toISOString(), policyVersion: 'fixture',
    discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' as const };
  const emptyPreview = { ...preview, intent: empty.request, resourceIds: [], context };
  const emptyPrompt = JSON.stringify({ request: empty.request, evidence: [] });
  const { reviewDigest: _previousDigest, ...reviewContent } = review;
  const sourceFree = { ...reviewContent, context, prompt: emptyPrompt, promptDigest: planningDigest(emptyPrompt), historyOmissions: [] };
  const exactReview = { ...sourceFree, reviewDigest: planningDigest(sourceFree) };
  const emptyOptions = {
    ...options, caseId: empty.id, preview: emptyPreview, review: exactReview,
    ownerReview: { ...ownerReview, caseId: empty.id, promptDigest: exactReview.promptDigest,
      reviewDigest: exactReview.reviewDigest, scope: { ...scope, caseIds: [empty.id], maxCalls: 1 } },
  };
  const disclosure = prepareSourceFreeCieOwnerReview(emptyOptions);
  assert.equal(disclosure.prompt, emptyPrompt);
  assert.equal(disclosure.expiresAt, 150);
  assert.equal('previewId' in disclosure, false);
  assert.throws(() => prepareSourceFreeCieOwnerReview({ ...emptyOptions, ownerCurrent: () => false }),
    /review_unavailable/u);
  assert.throws(() => prepareSourceFreeCieOwnerReview({ ...emptyOptions, current: { ...current, now: 150 } }),
    /scope_changed/u);
  const changed = [
    { prompt: emptyPrompt + ' ', promptDigest: planningDigest(emptyPrompt + ' ') },
    { promptDigest: '0'.repeat(64) },
    { tools: [] }, { annotations: [] },
    { context: { ...context, included: review.context.included } },
    { historyOmissions: [{ reason: 'fixture-history' }] },
  ];
  for (const patch of changed) {
    const substituted = { ...sourceFree, ...patch } as typeof sourceFree;
    const next = { ...substituted, reviewDigest: planningDigest(substituted) };
    assert.throws(() => prepareSourceFreeCieOwnerReview({
      ...emptyOptions, review: next, ownerReview: { ...emptyOptions.ownerReview,
        reviewDigest: next.reviewDigest, promptDigest: next.promptDigest },
    }), /empty_owner_review_invalid/u);
  }
  assert.throws(() => prepareSourceFreeCieOwnerReview({
    ...emptyOptions, review: { ...exactReview, reviewDigest: 'f'.repeat(64) },
    ownerReview: { ...emptyOptions.ownerReview, reviewDigest: 'f'.repeat(64) },
  }), /empty_owner_review_invalid/u);
});
