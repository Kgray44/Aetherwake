import assert from 'node:assert/strict';
import test from 'node:test';
import { investigateSemanticHistory } from '../src/semantic-history.mts';

const request = 'Which safeguard stopped the batch from being applied twice?';
const evidence = { key: 's1', question: 'What was the duplication safeguard?', query: 'duplicate operation' };
const proposal = { version: 1, objective: 'Find the previously chosen safeguard', clarification: '', needs: [evidence] };
const answer = { version: 1, assessment: [{ key: 's1', status: 'supported', sources: ['e1'], query: '' }] };
const candidate = { sourceId: 'conversation:message', revision: '4', text: 'The idempotency key prevents a second write.' };

test('refines a paraphrase, returns current source evidence and never treats model IDs as authority', async () => {
  const searches: string[] = [];
  const result = await investigateSemanticHistory(request, {
    search: query => { searches.push(query); return { sources: query === 'idempotency key' ? [candidate] : [], scan: 'bounded' }; },
    isCurrent: source => source === candidate,
    disclose: async call => call.stage === 'interpret' ? proposal : searches.length === 1
      ? { version: 1, assessment: [{ key: 's1', status: 'missing', sources: [], query: 'idempotency key' }] }
      : answer,
  });
  assert.deepEqual(searches, ['duplicate operation', 'idempotency key']);
  assert.equal(result.state, 'assessed');
  assert.deepEqual(result.coverage, [{ key: 's1', status: 'supported', sources: [candidate] }]);
});

test('disclosure denial preserves the native fallback and skips model-proposed reads', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => assert.fail('denied interpretation must not search'),
    isCurrent: () => false,
    disclose: async () => null,
  });
  assert.equal(result.state, 'unavailable');
  assert.deepEqual(result.coverage, []);
});

test('rejects an invented source reference and fences out in-flight corrections', async () => {
  for (const revoked of [false, true]) {
    let current = true;
    const result = await investigateSemanticHistory(request, {
      search: () => ({ sources: [candidate], scan: 'partial' }), isCurrent: () => current,
      disclose: async call => {
        if (call.stage === 'interpret') return proposal;
        current = !revoked;
        return revoked ? answer : { version: 1, assessment: [{ ...answer.assessment[0], sources: ['e99'] }] };
      },
    });
    assert.notEqual(result.state, 'assessed');
    assert.deepEqual(result.coverage, []);
  }
});

test('reports partial owner coverage and retains usable hits after an oversized result', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [{ ...candidate, sourceId: 'oversized', text: 'x'.repeat(2049) }, candidate], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      assert.deepEqual(call.excerpts, [{ handle: 'e1', text: candidate.text }]);
      return answer;
    },
  });
  assert.equal(result.searchCoverage, 'partial');
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('separates inferred intent, constraints and verification from the search proposal', async () => {
  const result = await investigateSemanticHistory('Put the handoff on paper and make sure the safety check is covered.', {
    search: () => assert.fail('the model reported no historical evidence need'),
    isCurrent: () => false,
    disclose: async () => ({ version: 2, objective: 'Draft a checked handoff', clarification: '', needs: [],
      perception: { kind: 'plan', explicitGoals: ['Document the handoff'], inferredGoals: ['Review coverage before delivery'],
        constraints: ['Include the safety check'], capabilityHints: ['document authoring'], deliverables: ['document'],
        verification: ['The safety check is present in the final document'] } }),
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.proposal?.version, 2);
  if (result.proposal?.version !== 2) assert.fail('expected v2 perception');
  assert.equal(result.proposal.perception.kind, 'plan');
  assert.deepEqual(result.proposal.perception.deliverables, ['document']);
  assert.equal(result.rounds, 0);
});

test('assesses bounded canonical anchors when proposed queries miss a paraphrase', async () => {
  let anchorReads = 0;
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [], scan: 'bounded' }),
    recent: () => { anchorReads++; return { sources: [candidate], scan: 'partial' }; },
    isCurrent: source => source === candidate,
    disclose: async call => {
      if (call.stage === 'interpret') return proposal;
      assert.deepEqual(call.excerpts, [{ handle: 'e1', text: candidate.text }]);
      return answer;
    },
  });
  assert.equal(anchorReads, 1);
  assert.equal(result.rounds, 1);
  assert.equal(result.searchCoverage, 'partial');
  assert.deepEqual(result.coverage[0].sources, [candidate]);
});

test('keeps a clarification proposed after current evidence leaves the referent unresolved', async () => {
  const alternative = { sourceId: 'conversation:other', revision: '4', text: 'The scheduler retries once after a read timeout.' };
  const result = await investigateSemanticHistory('Which one did we decide to repeat?', {
    search: () => ({ sources: [candidate, alternative], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : {
      version: 2, clarification: 'Do you mean the batch operation or the scheduler read?',
      assessment: [{ key: 's1', status: 'uncertain', sources: ['e1', 'e2'], query: '' }],
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.clarification, 'Do you mean the batch operation or the scheduler read?');
  assert.deepEqual(result.coverage[0].sources, [candidate, alternative]);
});

test('selected notes preserve recent evidence after a conversation query miss', async () => {
  const note = { sourceId: 'selected', revision: '1', text: 'Inspect the equipment on Thursday.' };
  const correction = { sourceId: 'recent', revision: '2', text: 'Move the maintenance visit to Monday.' };
  const result = await investigateSemanticHistory('When should we inspect the equipment?', {
    selected: () => ({ sources: [note], scan: 'bounded' }),
    search: () => ({ sources: [], scan: 'bounded' }),
    recent: () => ({ sources: [correction], scan: 'partial' }),
    isCurrent: () => true,
    disclose: async call => {
      if (call.stage === 'interpret') return { version: 1, objective: 'Resolve inspection date', clarification: '',
        needs: [{ key: 'date', question: 'When is the inspection?', query: 'inspection equipment' }] };
      return { version: 1, assessment: [{ key: 'date', status: call.excerpts.length === 2 ? 'contradicted' : 'supported',
        sources: call.excerpts.map(excerpt => excerpt.handle), query: '' }] };
    },
  });
  assert.equal(result.state, 'assessed');
  assert.equal(result.coverage[0].status, 'contradicted');
  assert.deepEqual(result.coverage[0].sources, [note, correction]);
});

test('binds assessed passages to the original request and rejects invented quotations', async () => {
  for (const quote of [candidate.text, 'An invented approval']) {
    let assessed = false;
    const result = await investigateSemanticHistory(request, {
      search: () => ({ sources: [candidate], scan: 'bounded' }),
      isCurrent: () => true,
      disclose: async call => {
        if (call.stage === 'interpret') return proposal;
        assert.equal(call.request, request);
        assessed = true;
        return { version: 3, clarification: '', assessment: [
          { key: 's1', status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
        ] };
      },
    });
    assert.equal(assessed, true);
    if (quote === candidate.text) {
      assert.equal(result.state, 'assessed');
      assert.deepEqual(result.coverage[0].passages, [{ sourceId: candidate.sourceId, quote }]);
    } else {
      assert.equal(result.state, 'invalid');
      assert.deepEqual(result.coverage, []);
    }
  }
});

test('overlapping passages from one source cannot establish a cross-source contradiction', async () => {
  const result = await investigateSemanticHistory(request, {
    search: () => ({ sources: [candidate], scan: 'bounded' }),
    isCurrent: () => true,
    disclose: async call => call.stage === 'interpret' ? proposal : {
      version: 3, clarification: '', assessment: [{ key: 's1', status: 'contradicted', query: '',
        passages: [{ source: 'e1', quote: 'idempotency key' }, { source: 'e1', quote: candidate.text }] }],
    },
  });
  assert.equal(result.state, 'invalid');
});
