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

test('bounded batches resume the sealed prefix without replaying an evaluated case', async () => {
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const signal = new AbortController().signal;
  const seen: string[] = [];
  const host = async ({ id }: { id: string }) => { seen.push(id); return { status: 'synthetic' }; };
  const first = await runBlindCie(bytes, identity, host, signal, { maxCases: 2 });
  assert.equal(first.complete, false);
  assert.equal(first.stopped, null);
  const next = await runBlindCie(bytes, identity, host, signal, { maxCases: 1, resume: first });
  assert.deepEqual(seen, ['blind-001', 'blind-002', 'blind-003']);
  assert.deepEqual(next.results.slice(0, 2), first.results);
  await assert.rejects(runBlindCie(bytes, identity, host, signal, { resume: { ...next, results: [] } }), /checkpoint/);
  await assert.rejects(runBlindCie(bytes, { ...identity, tree: 'c'.repeat(40) }, host, signal, { resume: first }), /checkpoint/);
  const failed = await runBlindCie(bytes, identity, async () => { throw new Error('unknown outcome'); }, signal, { maxCases: 1 });
  await assert.rejects(runBlindCie(bytes, identity, host, signal, { resume: failed }), /checkpoint/);
  assert.equal(seen.length, 3);
});
