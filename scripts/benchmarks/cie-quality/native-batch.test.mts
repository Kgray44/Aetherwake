import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openBlindJournal } from './blind-journal.mts';
import { readBlindInputs, runBlindCie } from './blind-runner.mts';
import { runNativeCieBatch, type NativeCieEvaluationHost, type NativeCieNoEvidence } from './native-batch.mts';

const bytes = readFileSync(new URL('./cases.public.json', import.meta.url));
const emptyIndex = readBlindInputs(bytes).findIndex(item => item.sources.length === 0);
const candidate = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
const outcome: NativeCieNoEvidence = {
  outcome: 'no-evidence', answer: 'I have no source evidence for that question.', requestId: 'answer', messageId: 'message',
  admissions: [{ requestId: 'interpret', executionId: 'first' }, { requestId: 'answer', executionId: 'last' }],
  settlements: [{ executionId: 'first', stage: 'structured' }, { executionId: 'last', stage: 'answer' }],
  evidenceAudit: { sourceBindings: [], assessments: [], compositions: [{ coverage: [{ status: 'missing', passages: [] }] }] },
};

for (const variant of ['complete', 'citation', 'missing stage'] as const) {
  test(`empty-source native batch recovery: ${variant}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cie-empty-source-'));
    const path = join(directory, 'batch.sqlite');
    const signal = new AbortController().signal;
    const profileId = 'fixture-profile';
    let dispatches = 0;
    let verifications = 0;
    const host: NativeCieEvaluationHost = {
      profileId, configurationVersion: 1, route: { provider: 'openai-api-vela', model: 'fixture', transport: 'synthetic' },
      async readUsage() { return { enabled: true, configurationVersion: 1, maxOutputTokens: 2048, requestsPerDay: 64, usedToday: 0 }; },
      async runReviewedCase(input) {
        dispatches++;
        assert.deepEqual(input.sources, []);
        assert.equal('category' in input, false);
        if (variant === 'citation') return { ...outcome, evidenceAudit: { ...outcome.evidenceAudit,
          compositions: [{ coverage: [{ status: 'missing', passages: [{ sourceId: 'fabricated' }] }] }] } };
        if (variant === 'missing stage') return { ...outcome, settlements: outcome.settlements.slice(1) };
        return outcome;
      },
      async verifyRetainedCase(_claim, result) {
        assert.deepEqual(result, outcome);
        if (++verifications === 1) throw new Error('interrupted before promotion');
        return true;
      },
    };
    const run = () => runNativeCieBatch(bytes, candidate, host, path, 1, signal);
    try {
      const journal = openBlindJournal(path, { profileId });
      try {
        if (emptyIndex > 0) await runBlindCie(bytes, candidate, async () => ({ fixturePrefix: true }), signal,
          { journal, maxCases: emptyIndex, route: host.route });
      } finally { journal.close(); }
      await assert.rejects(run(), variant === 'complete' ? /interrupted before promotion/ : /blind_case_unreconciled/);
      const reopened = openBlindJournal(path, { profileId });
      let pending;
      try { pending = (await reopened.read())?.pending; } finally { reopened.close(); }
      assert.ok(pending && Number.isFinite(pending.endToEndMs));
      if (variant === 'complete') assert.deepEqual((await run()).results.at(-1), pending);
      else {
        await assert.rejects(run(), /blind_case_unreconciled/);
        assert.equal(verifications, 0);
      }
      assert.equal(dispatches, 1);
    } finally {
      rmSync(path, { force: true });
      rmdirSync(directory);
    }
  });
}
