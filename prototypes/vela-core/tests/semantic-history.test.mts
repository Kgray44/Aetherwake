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
