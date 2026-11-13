import test from 'node:test';
import assert from 'node:assert/strict';
import { reportCognitiveRepetitions } from './report.mts';
const run = { executionId: 'e1', reportedModel: 'test-model', providerEvidence: 'reported', dispatched: true,
  elapsedMs: 10, effort: 'high', attribution: { stage: 'perception' },
  usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, totalTokens: 140 } } as any;
const repetition = (id: string, milliseconds: number, calls = [run]) => ({ id, arm: 'baseline', endToEndMs: milliseconds,
  quality: null, profile: { cognition: { contract: 'test', truncated: false, runs: calls } } }) as any;
test('reports full request duration independently of per-call time and preserves unknown quality/cost', () => {
  const result = reportCognitiveRepetitions([repetition('r1', 400)]);
  assert.equal(result.arms[0].endToEndMs.p50, 400);
  assert.equal(result.rows[0].calls[0].elapsedMs, 10);
  assert.equal(result.rows[0].calls[0].cost, null);
  assert.equal(result.arms[0].independentQualityKnown, 0);
});
test('duplicate identical receipts count once; conflicting or cross-request duplication fail closed', () => {
  assert.equal(reportCognitiveRepetitions([repetition('r1', 10, [run, run])]).rows[0].calls.length, 1);
  assert.throws(() => reportCognitiveRepetitions([repetition('r1', 10, [run, { ...run, elapsedMs: 20 }])]), /conflicting/);
  assert.throws(() => reportCognitiveRepetitions([repetition('r1', 10), repetition('r2', 20)]), /reused/);
});
test('cost requires exact reported model, cache counts and explicit versioned rate provenance', () => {
  const rate = { model: 'test-model', currency: 'USD', source: 'synthetic-fixture', effectiveAt: '2026-11-12',
    inputPerMillion: 2, cachedInputPerMillion: 1, outputPerMillion: 8 };
  assert.equal(reportCognitiveRepetitions([repetition('r1', 10)], [rate]).rows[0].calls[0].cost?.amount, .0005);
  const missing = { ...run, usage: { ...run.usage, cachedInputTokens: null } };
  assert.equal(reportCognitiveRepetitions([repetition('r1', 10, [missing])], [rate]).rows[0].calls[0].cost, null);
});
test('missing end-to-end and simulated provider remain visible instead of zero', () => {
  const result = reportCognitiveRepetitions([repetition('r1', NaN, [{ ...run, providerEvidence: 'simulated' }])]);
  assert.equal(result.arms[0].endToEndMs.samples, 0);
  assert.equal(result.arms[0].endToEndMs.p95, null);
  assert.deepEqual(result.rows[0].issues, ['end-to-end-unavailable', 'simulated-provider']);
});
