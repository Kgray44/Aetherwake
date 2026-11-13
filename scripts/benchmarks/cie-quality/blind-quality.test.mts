import assert from 'node:assert/strict';
import test from 'node:test';
import { reportBlindQuality } from './blind-quality.mts';

const predictionSha256 = 'a'.repeat(64);
const evaluation = { evaluator: 'independent fixture', predictionSha256, rubricSha256: 'b'.repeat(64) };

test('candidate quality cannot stand in for disclosure, contradiction, or answer grades', () => {
  const report = reportBlindQuality(['one', 'two', 'unrun'], predictionSha256, { ...evaluation, grades: [
    { id: 'one', candidates: { relevant: 2, returned: 3, hits: 1 }, answer: false },
    { id: 'two', candidates: { relevant: 0, returned: 1, hits: 0 }, disclosure: { invalid: 0 } },
  ] });
  assert.equal(report.expectedCases, 3);
  assert.equal(report.casesWithGrades, 2);
  assert.equal(report.candidates.recall, .5);
  assert.equal(report.candidates.precision, .25);
  assert.deepEqual(report.disclosure, { cases: 1, invalid: 0, casesWithInvalid: 0 });
  assert.deepEqual(report.contradiction, { cases: 0, passed: 0 });
  assert.deepEqual(report.answer, { cases: 1, passed: 0 });
});

test('rejects mismatched predictions, duplicate cases and impossible candidate hits', () => {
  assert.throws(() => reportBlindQuality(['one'], 'c'.repeat(64), { ...evaluation, grades: [] }), /binding/);
  assert.throws(() => reportBlindQuality(['one'], predictionSha256, { ...evaluation, grades: [{ id: 'one' }, { id: 'one' }] }), /cases/);
  assert.throws(() => reportBlindQuality(['one'], predictionSha256, { ...evaluation,
    grades: [{ id: 'one', candidates: { relevant: 1, returned: 2, hits: 2 } }] }), /counts/);
});
