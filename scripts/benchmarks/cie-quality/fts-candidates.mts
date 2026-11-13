import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalRetrievalQuery, rankCanonicalRetrieval } from '../../../prototypes/vela-core/src/history-retrieval.mts';
import { fuseCandidates } from './fuse-candidates.mts';

interface Fixture {
  id: string;
  request: string;
  sources: { id: string; title: string; text: string; eligibility: string }[];
}

const [inputPath, outputPath, candidateCommit] = process.argv.slice(2);
if (!inputPath || !outputPath || !/^[a-f0-9]{40}$/.test(candidateCommit ?? '')) {
  throw new Error('Expected input path, new prediction output path and exact candidate commit');
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const input = readFileSync(inputPath);
const inputSha256 = sha(input);
if (inputSha256 !== '9b79a3aa96aa1493fd2655f823654b42454419dfb4f92aeb1c4506eceef67832') {
  throw new Error('Independent lexical holdout input seal mismatch');
}
const { cases }: { cases: Fixture[] } = JSON.parse(input.toString('utf8'));
const time = (rank: () => string[]) => {
  const start = performance.now();
  const candidateIds = rank();
  return { candidateIds, elapsedMs: performance.now() - start };
};
const predictions = cases.map(({ id, request, sources }) => {
  const eligible = sources.filter(source => source.eligibility === 'eligible');
  const query = canonicalRetrievalQuery(request);
  const lexical = time(() => query ? rankCanonicalRetrieval(query,
    eligible.map(source => ({ id: source.id, text: source.title + '\n' + source.text }))).ids.slice(0, 3) : []);
  const fts = time(() => {
    if (!query) return [];
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE reviewed USING fts5(id UNINDEXED, title, body, tokenize='porter unicode61')");
      const insert = db.prepare('INSERT INTO reviewed VALUES (?, ?, ?)');
      for (const source of eligible) insert.run(source.id, source.title, source.text);
      const expression = query.terms.map(term => '"' + term.replaceAll('"', '""') + '"').join(' OR ');
      return db.prepare('SELECT id FROM reviewed WHERE reviewed MATCH ? ORDER BY bm25(reviewed, 0, 2, 1), id LIMIT 3')
        .all(expression).map(row => String(row.id));
    } finally { db.close(); }
  });
  const fusion = time(() => {
    const exact = query ? eligible.filter(source => query.terms.includes(source.id.toLowerCase())).map(source => source.id) : [];
    return fuseCandidates(lexical.candidateIds, fts.candidateIds, exact);
  });
  fusion.elapsedMs += lexical.elapsedMs + fts.elapsedMs;
  return { id, lexical, fts, fusion };
});
const output = JSON.stringify({ contract: 'aerynth.cie-fts-shadow-predictions@2', inputSha256, candidateCommit,
  cases: predictions });
writeFileSync(outputPath, output, { flag: 'wx' });
console.log(JSON.stringify({ cases: cases.length, inputSha256, candidateCommit, predictionSha256: sha(output), paidCalls: 0 }));
