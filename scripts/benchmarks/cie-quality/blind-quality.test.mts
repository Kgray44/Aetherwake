import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reportBlindQuality } from './blind-quality.mts';
import { runBlindCie } from './blind-runner.mts';

const input = readFileSync(new URL('./cases.public.json', import.meta.url));
const prediction = await runBlindCie(input, { commit: 'a'.repeat(40), tree: 'b'.repeat(40) }, async () => ({}),
  new AbortController().signal, { maxCases: 2 });
const { predictionSha256 } = prediction;
const evaluation = { evaluator: 'independent fixture', predictionSha256, rubricSha256: 'b'.repeat(64) };

test('candidate quality cannot stand in for disclosure, contradiction, or answer grades', () => {
  const report = reportBlindQuality(input, prediction, { ...evaluation, grades: [
    { id: 'blind-001', candidates: { relevant: 2, returned: 3, hits: 1 }, answer: false },
    { id: 'blind-002', candidates: { relevant: 0, returned: 1, hits: 0 }, disclosure: { invalid: 0 } },
  ] });
  assert.equal(report.expectedCases, 48);
  assert.equal(report.predictedCases, 2);
  assert.equal(report.casesWithGrades, 2);
  const times = prediction.results.map(row => row.endToEndMs).sort((a, b) => a - b);
  assert.deepEqual(report.endToEndMs, { samples: 2, p50: times[0], p95: times[1] });
  assert.equal(report.candidates.recall, .5);
  assert.equal(report.candidates.precision, .25);
  assert.deepEqual(report.disclosure, { cases: 1, invalid: 0, casesWithInvalid: 0 });
  assert.deepEqual(report.contradiction, { cases: 0, passed: 0 });
  assert.deepEqual(report.answer, { cases: 1, passed: 0 });
});

test('rejects mismatched predictions, duplicate cases and impossible candidate hits', () => {
  assert.throws(() => reportBlindQuality(input, { ...prediction, results: [] }, { ...evaluation, grades: [] }), /binding/);
  assert.throws(() => reportBlindQuality(input, prediction, { ...evaluation, grades: [{ id: 'blind-003' }] }), /cases/);
  assert.throws(() => reportBlindQuality(input, prediction, { ...evaluation,
    grades: [{ id: 'blind-001' }, { id: 'blind-001' }] }), /cases/);
  assert.throws(() => reportBlindQuality(input, prediction, { ...evaluation,
    grades: [{ id: 'blind-001', candidates: { relevant: 1, returned: 2, hits: 2 } }] }), /counts/);
});

test('request latency includes completed cases awaiting independent grades', () => {
  const report = reportBlindQuality(input, prediction, { ...evaluation, grades: [] });
  assert.equal(report.casesWithGrades, 0);
  assert.equal(report.endToEndMs.samples, 2);
});

test('blind reports distinguish settled live and synthetic calls and retain missing usage', async () => {
  const native = await runBlindCie(input, prediction.candidate, async ({ id }) => ({
    transport: id === 'blind-001' ? 'live' : 'synthetic', requestedModel: 'test-model', calls: 2,
    settlements: [
      { executionId: id + ':1', elapsedMs: 30, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      { executionId: id + ':2', elapsedMs: null, usage: null },
    ],
  }), new AbortController().signal, { maxCases: 2 });
  const report = reportBlindQuality(input, native, { ...evaluation, predictionSha256: native.predictionSha256, grades: [] });
  assert.equal(report.providerObservations.casesWithReceipts, 2);
  assert.deepEqual(report.providerObservations.groups, ['live', 'synthetic'].map(transport => ({
    transport, requestedModel: 'test-model', settledCalls: 2,
    latencyMs: { samples: 1, p50: 30, p95: 30 },
    usage: { samples: 1, inputTokens: 5, outputTokens: 2, totalTokens: 7 },
  })));
});

test('blind reports reject duplicate executions and receipt groups inconsistent with the sealed route', async () => {
  for (const transport of ['live', 'synthetic']) {
    const native = await runBlindCie(input, prediction.candidate, async () => ({
      transport, requestedModel: 'test-model', calls: 2,
      settlements: [{ executionId: 'repeat' }, { executionId: 'repeat' }],
    }), new AbortController().signal, { maxCases: 1,
      route: { transport: 'live', provider: 'openai-api-vela', model: 'test-model' } });
    assert.throws(() => reportBlindQuality(input, native, { ...evaluation, predictionSha256: native.predictionSha256, grades: [] }),
      transport === 'live' ? /blind_settlement_execution/ : /blind_settlement_binding/);
  }
});
