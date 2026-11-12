import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { canonicalRetrievalQuery, createCanonicalRetrievalRanker, type CanonicalRetrievalCandidate } from '../../../prototypes/vela-core/src/history-retrieval.mts';

const baselineRef = '2e725382b0269c7f3608380cc562b510cf592df4';
const baselineSource = execFileSync('git', ['show', baselineRef + ':prototypes/vela-core/src/history-retrieval.mts']);
const baseline: { rankCanonicalRetrieval: (query: { terms: string[] }, sources: CanonicalRetrievalCandidate[]) => unknown } =
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(baselineSource.toString('utf8'))).toString('base64'));
const topics = ['harbor approval', 'safety inspection', 'release deadline', 'verified checkpoint', 'vendor replacement', 'duty engineer'];
const candidates = Array.from({ length: 12 }, (_, index) => ({
  id: 'note-' + index,
  text: topics[index % topics.length] + ' ' + Array.from({ length: 160 }, (_, term) => 'sample' + index + 'word' + term).join(' '),
}));
const before = () => topics.map(topic => baseline.rankCanonicalRetrieval(canonicalRetrievalQuery(topic)!, candidates));
const after = () => {
  const rank = createCanonicalRetrievalRanker(candidates);
  return topics.map(topic => rank(canonicalRetrievalQuery(topic)!));
};
assert.deepEqual(after(), before());

const samples: [number[], number[]] = [[], []];
const arms = [before, after];
for (let index = -30; index < 300; index++) {
  for (const arm of index % 2 ? [1, 0] : [0, 1]) {
    const start = performance.now();
    arms[arm]();
    if (index >= 0) samples[arm].push(performance.now() - start);
  }
}
const distribution = (values: number[]) => {
  values.sort((a, b) => a - b);
  return { count: values.length, p50Ms: values[149], p95Ms: values[284] };
};
console.log(JSON.stringify({ baselineRef, scope: 'local lexical candidate ranking with index construction',
  runtime: process.version, platform: process.platform, sources: candidates.length, queries: topics.length,
  baseline: distribution(samples[0]), candidate: distribution(samples[1]), paidCalls: 0 }, null, 2));
