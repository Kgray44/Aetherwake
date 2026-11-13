import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readBlindInputs, runBlindCie } from './blind-runner.mts';
const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));
test('independently frozen 48-case inputs contain no labels or rationales', () => {
  const cases = readBlindInputs(bytes);
  assert.equal(cases.length, 48);
  for (const row of cases) {
    assert.equal('expected' in row, false); assert.equal('rationale' in row, false);
  }
  assert.throws(() => readBlindInputs(Buffer.from(bytes.toString().replace('"version": 1', '"version": 2'))), /seal/);
});
test('blind runner invokes the host once per case, records no manufactured outcomes and hashes predictions', async () => {
  let calls = 0;
  const result = await runBlindCie(bytes, { commit: 'a'.repeat(40), tree: 'b'.repeat(40) }, async input => {
    calls++; assert.equal('expected' in input, false); assert.equal('category' in input, false); return { state: 'synthetic-test-only' };
  }, new AbortController().signal);
  assert.equal(calls, 48); assert.equal(result.results.length, 48);
  assert.match(result.predictionSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.results.every(row => row.endToEndMs >= 0));
});
test('a host failure is not retried or replaced with a guessed prediction', async () => {
  let calls = 0;
  const result = await runBlindCie(bytes, { commit: 'a'.repeat(40), tree: 'b'.repeat(40) }, async () => {
    calls++; throw new Error('authority-denied');
  }, new AbortController().signal);
  assert.deepEqual(result.stopped, { caseId: 'blind-001', kind: 'host-error' });
  assert.equal(result.complete, false);
  assert.equal(result.results.length, 0);
  assert.equal(calls, 1);
});

test('a late result after cancellation stays outside the sealed prefix and the cancelled run cannot replay', async () => {
  const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const controller = new AbortController();
  const dispatched: string[] = [];
  const host: Parameters<typeof runBlindCie>[2] = async input => {
    dispatched.push(input.id);
    if (input.id === 'blind-002') controller.abort();
    return { answer: input.id };
  };

  const result = await runBlindCie(bytes, candidate, host, controller.signal);
  assert.deepEqual(result.stopped, { caseId: 'blind-002', kind: 'cancelled' });
  assert.equal(result.complete, false);
  assert.deepEqual(result.results.map(row => [row.id, row.result]), [['blind-001', { answer: 'blind-001' }]]);
  assert.ok(result.results[0].endToEndMs >= 0);
  const { predictionSha256, ...payload } = result;
  assert.equal(predictionSha256, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));

  const cancelled = await runBlindCie(bytes, candidate, host, controller.signal);
  assert.equal(cancelled.stopped?.kind, 'cancelled');
  assert.deepEqual(cancelled.results, []);
  assert.deepEqual(dispatched, ['blind-001', 'blind-002']);
});
