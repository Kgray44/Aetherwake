import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BLIND_INPUT_SHA256, readBlindInputs } from './blind-runner.mts';
import { createDormantNativeCieHost } from './native-host-adapter.mts';
import { historyDigest } from '../../../prototypes/vela-core/src/bounded-history.mts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

test('dormant CIE host binds frozen inputs, budgets and canonical receipts without replay', async () => {
  const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));
  const { id, request, sources } = readBlindInputs(bytes).find(item => !item.sources.length)!;
  const payload = { id, request, sources };
  const profileId = '12345678-1234-1234-1234-123456789012';
  const configurationVersion = 2;
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const route = { provider: 'openai-api-vela', model: 'fixture-model', transport: 'synthetic' as const };
  const catalogDigest = sha('catalog');
  const claim = { profileId, configurationVersion, claimToken: 'c'.repeat(64),
    bindingDigest: sha(JSON.stringify([BLIND_INPUT_SHA256, candidate.commit, candidate.tree, route,
      JSON.stringify([profileId, configurationVersion]), id])) };
  const admissions = [{ requestId: 'request', executionId: 'execution' }];
  const answer = 'No "sources" supplied.\nPlease provide a source.';
  const expected = {
    answer, requestId: 'request', messageId: 'message', outcome: 'no-evidence' as const,
    calls: 1, totalTokens: 140, tokenSamples: 1, admissions,
    settlements: [{ executionId: 'execution', stage: 'answer' as const, elapsedMs: 12,
      usage: { totalTokens: 140, source: 'provider-reported' }, reportedModel: route.model }],
    requestedModel: route.model, transport: 'synthetic' as const,
    evidenceAudit: { outbound: [{ inputDigest: sha('exact outbound'), stage: 'other', textSourceIds: [], sourceSignals: [] }],
      sourceBindings: [], assessments: [], compositions: [] },
  };
  let catalog = catalogDigest, usedToday = 0, starts = 0, terminal = true;
  const options = {
    bytes, candidate, route, profileId, configurationVersion, catalogDigest,
    core: {
      readVelaEvaluationProfile: () => ({ profileId, configurationVersion, usage: {
        configurationVersion, enabled: true, maxOutputTokens: 2048, requestsPerDay: 64, usedToday,
      } }),
      readVelaEvaluationAdmissions: () => starts ? admissions : null,
      readVelaEvaluationResult: () => terminal ? {
        state: 'verified-answer' as const, requestId: 'request', messageId: 'message',
        answer, answerDigest: historyDigest(answer),
        receipts: [{ ...admissions[0], outcome: 'completed' as const, elapsedMs: 12, totalTokens: 140 }],
      } : { state: 'unresolved' as const },
    },
    async readCatalog() { return { configurationVersion, digest: catalog, models: [route.model] }; },
    async runReviewed(input: typeof payload) { assert.deepEqual(input, payload); starts++; return expected; },
  };
  const signal = new AbortController().signal;
  assert.throws(() => createDormantNativeCieHost({ ...options, route: { ...route, transport: 'live' } }),
    /live_activation_required/u);
  const host = createDormantNativeCieHost(options);
  await assert.rejects(host.runReviewedCase({ ...payload, request: 'changed' }, signal, claim), /case_binding_invalid/u);
  catalog = sha('changed');
  await assert.rejects(host.runReviewedCase(payload, signal, claim), /catalog_changed/u);
  catalog = catalogDigest;
  usedToday = 59;
  await assert.rejects(host.runReviewedCase(payload, signal, { ...claim, claimToken: 'd'.repeat(64) }), /budget_unavailable/u);
  assert.equal(starts, 0);
  usedToday = 0;
  const admittedClaim = { ...claim, claimToken: 'e'.repeat(64) };
  assert.deepEqual(await host.runReviewedCase(payload, signal, admittedClaim), expected);
  assert.notEqual(historyDigest(answer), sha(answer));
  const reopened = createDormantNativeCieHost(options);
  terminal = false;
  assert.equal(await reopened.verifyRetainedCase(admittedClaim, expected, signal), false);
  await assert.rejects(reopened.runReviewedCase(payload, signal, admittedClaim), /case_unreconciled/u);
  terminal = true;
  assert.equal(await reopened.verifyRetainedCase(admittedClaim, expected, signal), true);
  assert.equal(await reopened.verifyRetainedCase(admittedClaim, { ...expected, answer: 'substituted' }, signal), false);
  for (const changed of [
    { outcome: undefined }, { calls: 2 }, { totalTokens: null },
    { settlements: [{ ...expected.settlements[0], elapsedMs: 13 }] },
    { evidenceAudit: { ...expected.evidenceAudit, assessments: [{ unexpected: true }] } },
  ]) assert.equal(await reopened.verifyRetainedCase(admittedClaim, { ...expected, ...changed }, signal), false);
  assert.equal(starts, 1);
});
