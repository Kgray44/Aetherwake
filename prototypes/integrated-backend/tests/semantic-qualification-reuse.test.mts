import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyVelaHistoryModelWithApi, investigateReviewedVelaEvidence } from '../src/vela-semantic-history.mts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';

test('targeted qualification dispatches only the missing contract and retains its authorization fence', async () => {
  const stages: string[] = [];
  let authorized = 0;
  const api = { async qualifyStructuredRoute(input: any) {
    input.validate(); stages.push(input.payload.stage);
    return { evidence: 'simulated' };
  } } as unknown as VelaApiRuntime;
  const result = await qualifyVelaHistoryModelWithApi(api,
    { configurationVersion: 1, model: 'synthetic-model', authorize: () => { authorized++; return true; } },
    new AbortController().signal, undefined, ['assess']);
  assert.deepEqual(stages, ['assess']);
  assert.equal(authorized, 1);
  assert.deepEqual(result.map(row => row.stage), ['assess']);
});

test('explicit qualification still probes both contracts and denied admission dispatches neither', async () => {
  const stages: string[] = [];
  const api = { async qualifyStructuredRoute(input: any) {
    input.validate(); stages.push(input.payload.stage); return { evidence: 'simulated' };
  } } as unknown as VelaApiRuntime;
  const admission = { configurationVersion: 1, model: 'synthetic-model', authorize: () => true };
  await qualifyVelaHistoryModelWithApi(api, admission, new AbortController().signal);
  assert.deepEqual(stages, ['interpret', 'assess']);
  stages.length = 0;
  await assert.rejects(qualifyVelaHistoryModelWithApi(api, { ...admission, authorize: () => false },
    new AbortController().signal, undefined, ['assess']), /semantic_history_disclosure_denied/);
  assert.deepEqual(stages, []);
});

for (const cached of [[], ['interpret'], ['assess'], ['interpret', 'assess']] as const) {
  test(`reviewed evidence qualifies only missing stages with ${cached.join('+') || 'cold'} receipts`, async () => {
    const { semanticHistoryFormats } = await import('../../vela-core/src/semantic-history.mts');
    const receipts = new Map<string, any>(cached.map(stage => [stage, { model: 'synthetic-model', stage }]));
    const stageFor = (schema: unknown) => schema === semanticHistoryFormats.interpret.schema ? 'interpret' : 'assess';
    const probes: string[] = [];
    const api = {
      qualifiedStructuredRoute(_version: number, _models: string[], schema: unknown) { return receipts.get(stageFor(schema)); },
      async resolveQualifiedStructuredRoute(version: number, models: string[], schema: unknown) {
        return receipts.get(stageFor(schema));
      },
      isStructuredQualificationCurrent(receipt: any) { return receipts.get(receipt.stage) === receipt; },
      async qualifyStructuredRoute(input: any) {
        input.validate();
        const stage = input.payload.stage;
        probes.push(stage);
        const receipt = { model: 'synthetic-model', stage };
        receipts.set(stage, receipt);
        return receipt;
      },
      async structuredProposal(input: any) {
        input.validate();
        return { version: 2, objective: 'No historical evidence needed', clarification: '', needs: [],
          perception: { kind: 'recall', explicitGoals: [], inferredGoals: [], constraints: [],
            capabilityHints: [], deliverables: ['text'], verification: [] } };
      },
    } as unknown as VelaApiRuntime;
    await investigateReviewedVelaEvidence(api, 'Synthetic request', [], 1, 'synthetic-model', () => {}, new AbortController().signal);
    assert.deepEqual(probes, ['interpret', 'assess'].filter(stage => !(cached as readonly string[]).includes(stage)));
  });
}
