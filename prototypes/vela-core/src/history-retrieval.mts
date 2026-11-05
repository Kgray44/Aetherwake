import { createHash } from 'node:crypto';

/** Local lexical discovery only. The owner must authorize/prove candidates BEFORE indexing their text.
 * This transient index stores terms and canonical IDs, never a competing transcript or generated summary. */
export const HISTORY_RETRIEVAL_LIMITS = Object.freeze({ maxMessages: 256, maxBytes: 131072, maxTerms: 24, maxQueryBytes: 2048 });
const stop = new Set('a an and are as at be been before can could did do does earlier first for from had has have how i in is it last me my of on or our please previous recall remember remind said say she should that the their them then there these they this those to us was we were what when where which who why will with would you your decide decided decision decisions agree agreed choose chose chosen about again fix repair workspace project named called'.split(' '));
const terms = (value: string, limit: number = HISTORY_RETRIEVAL_LIMITS.maxTerms) => [...new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_:-]{3,200}/gu) ?? [])]
  .filter(term => !stop.has(term)).slice(0, limit);
export function canonicalRetrievalQuery(value: string | undefined, history = false): { terms: string[]; digest: string } | null {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 16000) return null;
  if (history && !/\b(?:earlier|remember|remind|recall|decid\w*|agre\w*|cho[os]\w*|previous|before|original|last)\b|(?:message|request):|[a-f0-9]{8}-[a-f0-9-]{27}/iu.test(value)) return null;
  const selected = terms(value); if (!selected.length || Buffer.byteLength(selected.join(' ')) > HISTORY_RETRIEVAL_LIMITS.maxQueryBytes) return null;
  return { terms: selected, digest: createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
}
export interface CanonicalRetrievalCandidate { id: string; text: string; identities?: readonly string[] }
export function rankCanonicalRetrieval(query: { terms: readonly string[] }, candidates: readonly CanonicalRetrievalCandidate[]): { ids: string[]; ambiguous: boolean } {
  const index = new Map<string, Set<string>>(), identities = new Map<string, ReadonlySet<string>>();
  for (const item of candidates) {
    identities.set(item.id, new Set((item.identities ?? []).map(id => id.toLowerCase())));
    for (const term of terms(item.text, 1024)) { const ids = index.get(term) ?? new Set<string>(); ids.add(item.id); index.set(term, ids); }
  }
  const scores = candidates.map(item => ({ id: item.id, score: query.terms.reduce((score, term) => score +
    (identities.get(item.id)?.has(term) ? 1000 : index.get(term)?.has(item.id) ? 1 + 1 / index.get(term)!.size : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { ids: scores.map(item => item.id), ambiguous: scores.length > 1 && Math.abs(scores[0].score - scores[1].score) < 1e-9 };
}
