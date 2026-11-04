import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRetrievalQuery, rankCanonicalRetrieval, HISTORY_RETRIEVAL_LIMITS } from '../src/history-retrieval.mts';

test('lexical discovery ranks exact canonical source identities and retains ambiguity without producing text', () => {
  const query=canonicalRetrievalQuery('What did we decide earlier about the Aurora release color?',true)!;
  const candidates=[{id:'old:1',text:'Aurora release color is violet.'},{id:'old:2',text:'The harbor uses orange.'},{id:'new:1',text:'Unrelated today.'}];
  assert.deepEqual(rankCanonicalRetrieval(query,candidates),{ids:['old:1'],ambiguous:false});
  assert.equal(rankCanonicalRetrieval(query,[candidates[0],{...candidates[0],id:'other:1'}]).ambiguous,true);
  assert.equal(rankCanonicalRetrieval(canonicalRetrievalQuery('Find receipt:exact')!,[{id:'body',text:'receipt:exact'},
    {id:'canonical',text:'Otherwise unrelated',identities:['receipt:exact']}]).ids[0],'canonical');
  assert.equal(canonicalRetrievalQuery('What did we decide earlier?',true),null,'an unspecified earlier decision is not a guessed source');
  assert.equal(canonicalRetrievalQuery('Explain a rainbow.',true),null,'ordinary turns retain their cheap recent-history path');
  assert.equal(canonicalRetrievalQuery('x'.repeat(16001)),null);
  assert(canonicalRetrievalQuery('remember '+Array.from({length:50},(_,i)=>'topic'+i).join(' '))!.terms.length<=HISTORY_RETRIEVAL_LIMITS.maxTerms);
});
