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

test('reviewed project assessment finds fourth-ranked evidence without inventing another query', async () => {
  const receipt = { model: 'synthetic-model' };
  const rounds: number[] = [];
  const request = 'Who signs the harbor inspection?';
  const decisive = 'The duty engineer signs.';
  const sources = ['a', 'b', 'c', 'd'].map(id => ({
    sourceId: id, revision: '1', proofDigest: id, sourceKind: 'note' as const,
    title: 'Harbor inspection', text: id === 'd' ? decisive : 'Discussed schedule only.',
  }));
  const api = {
    qualifiedStructuredRoute: () => receipt,
    resolveQualifiedStructuredRoute: async () => receipt,
    isStructuredQualificationCurrent: () => true,
    async structuredProposal(input: any) {
      input.validate();
      if (input.payload.stage === 'interpret') return {
        version: 2, objective: request, clarification: '',
        perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
        needs: [{ key: 'signer', question: request, query: 'harbor inspection' }],
      };
      rounds.push(input.payload.round);
      const match = input.payload.excerpts.find((excerpt: { text: string }) => excerpt.text === decisive);
      return { version: 3, clarification: '', assessment: [{ key: 'signer', status: match ? 'supported' : 'missing',
        passages: match ? [{ source: match.handle, quote: decisive }] : [], query: '' }] };
    },
  } as unknown as VelaApiRuntime;
  const result = await investigateReviewedVelaEvidence(api, request, [], 1, 'synthetic-model', () => {},
    new AbortController().signal, undefined, { sources, partial: false });
  assert.deepEqual(rounds, [1, 2]);
  assert.deepEqual(result.coverage[0].passages, [{ sourceId: 'd', title: 'Harbor inspection', quote: decisive }]);
});

test('a cited note leads to a uniquely named reviewed source outside the lexical results', async () => {
  const receipt = { model: 'synthetic-model' };
  const anchor = 'See the Equipment Handoff for the responsible party.';
  const decisive = 'The duty engineer signs.';
  const sources = [
    ['a', 'Schedule', 'A separate schedule.'],
    ['b', 'Inventory', 'A separate inventory.'],
    ['c', 'Harbor inspection', anchor],
    ['d', 'Equipment Handoff', decisive],
  ].map(([sourceId, title, text]) => ({ sourceId, title, text, revision: '1', proofDigest: sourceId, sourceKind: 'note' as const }));
  const api = {
    qualifiedStructuredRoute: () => receipt,
    resolveQualifiedStructuredRoute: async () => receipt,
    isStructuredQualificationCurrent: () => true,
    async structuredProposal(input: any) {
      input.validate();
      const call = input.payload;
      if (call.stage === 'interpret') return { version: 2, objective: 'Find the signer', clarification: '',
        perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
        needs: [{ key: 'signer', question: 'Who signs?', query: 'harbor inspection' }] };
      const found = call.excerpts.find((excerpt: { text: string }) => excerpt.text === decisive);
      if (call.round === 1) assert.equal(found, undefined);
      return { version: 3, clarification: '', assessment: [{ key: 'signer', status: found ? 'supported' : 'partial', query: '',
        passages: [{ source: 'e1', quote: anchor }, ...(found ? [{ source: found.handle, quote: decisive }] : [])] }] };
    },
  } as unknown as VelaApiRuntime;
  const result = await investigateReviewedVelaEvidence(api, 'Who signs the harbor inspection?', [], 1, 'synthetic-model', () => {},
    new AbortController().signal, undefined, { sources, partial: false });
  assert.equal(result.coverage[0].status, 'supported');
  assert.deepEqual(result.coverage[0].passages.map(passage => passage.sourceId), ['c', 'd']);
});

test('a reviewed snapshot is revalidated at disclosure boundaries regardless of excerpt count', async () => {
  const receipt = { model: 'synthetic-model' };
  const request = 'Who signs the inspection?';
  const quote = 'The duty engineer signs.';
  const api = {
    qualifiedStructuredRoute: () => receipt,
    resolveQualifiedStructuredRoute: async () => receipt,
    isStructuredQualificationCurrent: () => true,
    async structuredProposal(input: any) {
      input.validate();
      if (input.payload.stage === 'interpret') return { version: 2, objective: request, clarification: '',
        perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
        needs: [{ key: 'signer', question: request, query: 'inspection' }] };
      return { version: 3, clarification: '', assessment: [{ key: 'signer', status: 'supported', query: '',
        passages: [{ source: 'e1', quote }] }] };
    },
  } as unknown as VelaApiRuntime;
  async function investigate(count: number, revokeAtAssessment = false) {
    let validations = 0;
    let revoked = false;
    const sources = Array.from({ length: count }, (_, index) => ({
      sourceId: String(index), title: 'Reviewed note', text: quote, revision: '1', proofDigest: String(index), sourceKind: 'note' as const,
    }));
    const runtime = revokeAtAssessment ? { ...api, async structuredProposal(input: Parameters<VelaApiRuntime['structuredProposal']>[0]) {
      const result = await api.structuredProposal(input, new AbortController().signal);
      if ((input.payload as { stage: string }).stage === 'assess') revoked = true;
      return result;
    } } as unknown as VelaApiRuntime : api;
    const run = investigateReviewedVelaEvidence(runtime, request, sources, 1, 'synthetic-model', () => {
      validations++;
      if (revoked) throw new Error('review revoked');
    }, new AbortController().signal);
    if (revokeAtAssessment) await assert.rejects(run, /review revoked/);
    else assert.equal((await run).coverage[0].status, 'supported');
    return validations;
  }
  assert.equal(await investigate(4), await investigate(1));
  await investigate(4, true);
});
