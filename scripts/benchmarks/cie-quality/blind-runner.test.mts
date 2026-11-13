import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBlindJournal } from './blind-journal.mts';

test('a durable batch journal cannot be reopened against a different native profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-cie-profile-binding-'));
  const path = join(directory, 'batch.sqlite');
  try {
    openBlindJournal(path, { profileId: 'native-profile-a' }).close();
    assert.throws(() => openBlindJournal(path, { profileId: 'native-profile-b' }).close(), /blind_journal_profile_mismatch/);
    assert.throws(() => openBlindJournal(path).close(), /blind_journal_profile_mismatch/);
    openBlindJournal(path, { profileId: 'native-profile-a' }).close();
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
});
import { canStartReviewedCieCase } from './native-budget.mts';
import { readBlindInputs, runBlindCie } from './blind-runner.mts';
const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));

test('a route-bound checkpoint rejects changes of model, provider or transport before dispatch', async () => {
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const signal = new AbortController().signal;
  const route = { provider: 'native-provider', model: 'model-a', transport: 'synthetic' as const };
  let calls = 0;
  const host = async () => { calls++; return {}; };
  const resume = await runBlindCie(bytes, identity, host, signal, { route, maxCases: 1 });
  for (const changed of [{ ...route, model: 'model-b' }, { ...route, provider: 'other-provider' },
    { ...route, transport: 'live' as const }, undefined]) {
    await assert.rejects(runBlindCie(bytes, identity, host, signal, { route: changed, resume, maxCases: 1 }), /checkpoint/);
  }
  assert.equal(calls, 1);
  const continued = await runBlindCie(bytes, identity, host, signal, { route, resume, maxCases: 1 });
  assert.equal(continued.results.length, 2);
  assert.deepEqual(continued.route, route);
});

test('a daily budget stop leaves a resumable prefix without claiming the next case', async () => {
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const journal = openBlindJournal(':memory:');
  let usedToday = 58;
  const seen: string[] = [];
  const signal = new AbortController().signal;
  const run = () => runBlindCie(bytes, identity, async input => {
    seen.push(input.id);
    usedToday += 6;
    return { status: 'synthetic' };
  }, signal, { journal, maxCases: 2, canStartCase: signal => canStartReviewedCieCase(async () => ({
    enabled: true, configurationVersion: 1, maxOutputTokens: 2048, requestsPerDay: 64, usedToday,
  }), signal) });
  try {
    const stopped = await run();
    assert.equal(stopped.stopped, null);
    assert.equal((await journal.read())?.inFlight, null);
    assert.deepEqual(seen, ['blind-001']);
    usedToday = 0;
    const resumed = await run();
    assert.deepEqual(seen, ['blind-001', 'blind-002', 'blind-003']);
    assert.deepEqual(resumed.results.slice(0, 1), stopped.results);
  } finally { journal.close(); }
});

test('SQLite journal survives reopen and refuses a stale claim from another connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-cie-journal-'));
  const path = join(directory, 'evaluation.sqlite');
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const signal = new AbortController().signal;
  let calls = 0;
  const host = async () => { calls++; return { status: 'synthetic' }; };
  try {
    const writer = openBlindJournal(path);
    try {
      const competitor = openBlindJournal(path);
      try {
        const checkpoint = await runBlindCie(bytes, identity, host, signal, { journal: writer, maxCases: 1 });
        assert.equal(await competitor.compareAndSet(null, { checkpoint, inFlight: 'blind-001' }), false);
        const previous = await writer.read();
        assert.equal(await writer.compareAndSet(previous, { checkpoint, inFlight: 'blind-002' }), true);
        assert.equal(await competitor.compareAndSet(previous, { checkpoint, inFlight: null }), false);
      } finally { competitor.close(); }
    } finally { writer.close(); }
    const reopened = openBlindJournal(path);
    try {
      await assert.rejects(runBlindCie(bytes, identity, host, signal, { journal: reopened }), /blind_case_unreconciled/);
      assert.equal(calls, 1);
      assert.equal((await reopened.read())?.inFlight, 'blind-002');
    } finally { reopened.close(); }
  } finally {
    rmSync(path, { force: true });
    rmSync(path + '-journal', { force: true });
    rmdirSync(directory);
  }
});
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

test('concurrent journal runners dispatch each case at most once', async () => {
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  type Journal = NonNullable<NonNullable<Parameters<typeof runBlindCie>[4]>['journal']>;
  let stored: Awaited<ReturnType<Journal['read']>> = null;
  const journal: Journal = {
    async read() { return stored; },
    async compareAndSet(expected, next) {
      if (stored !== expected) return false;
      stored = next;
      return true;
    },
  };
  const seen: string[] = [];
  const run = (maxCases: number) => runBlindCie(bytes, identity, async input => {
    seen.push(input.id);
    return { status: 'synthetic' };
  }, new AbortController().signal, { journal, maxCases });
  const outcomes = await Promise.allSettled([run(1), run(1)]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.deepEqual(seen, ['blind-001']);
  const completed = await run(48);
  assert.equal(completed.complete, true);
  assert.equal(new Set(seen).size, 48);
  assert.deepEqual(await run(48), completed);
  assert.equal(seen.length, 48);
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

test('a lost completion receipt leaves a durable claim and blocks replay on restart', async () => {
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const signal = new AbortController().signal;
  type Journal = NonNullable<NonNullable<Parameters<typeof runBlindCie>[4]>['journal']>;
  let stored: Awaited<ReturnType<Journal['read']>> = null;
  let calls = 0;
  const journal: Journal = {
    async read() { return stored; },
    async compareAndSet(expected, next) {
      assert.deepEqual(stored, expected);
      if (next.inFlight === null) throw new Error('completion receipt unavailable');
      stored = next;
      return true;
    },
  };
  const host = async () => { calls++; return { status: 'synthetic' }; };
  await assert.rejects(runBlindCie(bytes, identity, host, signal, { journal, maxCases: 1 }), /completion receipt/);
  await assert.rejects(runBlindCie(bytes, identity, host, signal, { journal, maxCases: 1 }), /blind_case_unreconciled/);
  assert.equal(calls, 1);
});

test('a recovery claim precedes preflight and an altered pending timing prevents replay', async () => {
  type Journal = NonNullable<NonNullable<Parameters<typeof runBlindCie>[4]>['journal']>;
  let stored: Awaited<ReturnType<Journal['read']>> = null;
  const journal: Journal = {
    async read() { return structuredClone(stored); },
    async compareAndSet(expected, next) { assert.deepEqual(stored, expected); stored = structuredClone(next); return true; },
  };
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const signal = new AbortController().signal;
  const options = { journal, maxCases: 1, route: { provider: 'openai-api-vela', model: 'fixture', transport: 'synthetic' as const },
    canStartCase: async () => { assert.equal(stored?.inFlight, 'blind-001'); assert.ok(stored?.claim); return true; },
    recovery: { binding: 'profile:1', verify: async () => false } };
  let calls = 0;
  const host: Parameters<typeof runBlindCie>[2] = async (_item, _abort, claim) => {
    assert.deepEqual(claim, stored?.claim);
    calls++;
    return { answer: 'fixture' };
  };
  await assert.rejects(runBlindCie(bytes, identity, host, signal, options), /blind_case_unreconciled/);
  const retained = await journal.read();
  assert.ok(retained?.pending);
  retained.pending.endToEndMs += 1;
  stored = retained;
  await assert.rejects(runBlindCie(bytes, identity, host, signal, { ...options,
    recovery: { ...options.recovery, verify: async () => assert.fail('altered prediction reached the host verifier') } }), /blind_case_unreconciled/);
  assert.equal(calls, 1);
});

test('a host result returned after cancellation never enters the gradeable prefix', async () => {
  const journal = openBlindJournal(':memory:', { profileId: 'synthetic-profile' });
  const controller = new AbortController();
  const identity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const verified: unknown[] = [];
  const options = { journal, maxCases: 2, route: { provider: 'openai-api-vela', model: 'fixture', transport: 'synthetic' as const },
    recovery: { binding: 'synthetic-profile:1', verify: async (_claim: unknown, result: unknown) => { verified.push(result); return true; } } };
  let calls = 0;
  try {
    const checkpoint = await runBlindCie(bytes, identity, async input => {
      if (++calls === 2) controller.abort();
      return { answer: input.id };
    }, controller.signal, options);
    assert.deepEqual(checkpoint.results.map(row => row.id), ['blind-001']);
    assert.deepEqual(verified, [{ answer: 'blind-001' }]);
    assert.deepEqual(checkpoint.stopped, { caseId: 'blind-002', kind: 'cancelled' });
    const persisted = await journal.read();
    assert.deepEqual(persisted?.checkpoint, checkpoint);
    assert.equal(persisted?.inFlight, 'blind-002');
    assert.ok(persisted?.claim);
    assert.equal(persisted.pending, undefined);
    await assert.rejects(runBlindCie(bytes, identity, async () => assert.fail('cancelled case replayed'),
      new AbortController().signal, options), /blind_case_unreconciled/);
  } finally { journal.close(); }
});
