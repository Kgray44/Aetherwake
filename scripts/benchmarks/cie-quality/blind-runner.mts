import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
export const BLIND_INPUT_SHA256 = 'bd9fb6898473fb60b3e669d40b097f7e0e231f0ac98997365d86bddbca701997';
export interface BlindCase { id: string; category: string; request: string; sources: { id: string; title: string; text: string }[] }
export type BlindPayload = Pick<BlindCase, 'id' | 'request' | 'sources'>;
type Candidate = { commit: string; tree: string };
type Prediction = { id: string; result: unknown; endToEndMs: number };
interface BlindCheckpoint {
  contract: 'aerynth.cie-blind-predictions@1';
  inputSha256: string;
  candidate: Candidate;
  results: Prediction[];
  stopped: { caseId: string; kind: 'cancelled' | 'host-error' } | null;
  complete: boolean;
  predictionSha256: string;
}
interface BlindJournalState {
  checkpoint: BlindCheckpoint;
  inFlight: string | null;
}
export interface BlindJournal {
  read(): Promise<BlindJournalState | null>;
  /** Atomically compare durable state and commit the next state before resolving. */
  compareAndSet(expected: BlindJournalState | null, next: BlindJournalState): Promise<boolean>;
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function exact(value: any, keys: string[]) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Input-only projection: expected labels, rationales and unknown fields are rejected. */
export function readBlindInputs(bytes: Buffer): readonly BlindCase[] {
  if (sha(bytes) !== BLIND_INPUT_SHA256) throw new Error('blind_input_seal_mismatch');
  const value = JSON.parse(bytes.toString());
  if (!exact(value, ['version', 'cases']) || value.version !== 1 || !Array.isArray(value.cases) || value.cases.length !== 48)
    throw new Error('blind_input_shape');
  const ids = new Set<string>();
  for (const row of value.cases) {
    if (!exact(row, ['id', 'category', 'request', 'sources']) || ![row.id, row.category, row.request].every(v => typeof v === 'string' && v.length) ||
      ids.has(row.id) || !Array.isArray(row.sources) || row.sources.length > 8) throw new Error('blind_case_shape');
    ids.add(row.id);
    const sources = new Set<string>();
    for (const source of row.sources) {
      if (!exact(source, ['id', 'title', 'text']) || ![source.id, source.title, source.text].every(v => typeof v === 'string' && v.length) ||
        sources.has(source.id)) throw new Error('blind_source_shape');
      sources.add(source.id);
    }
  }
  return structuredClone(value.cases);
}
/** The injected host must use canonical CIE, exact admission and existing credential custody.
 * No fallback inference, retries, fabricated predictions, credential reader or promotion. */
export async function runBlindCie(bytes: Buffer, candidate: Candidate,
  run: (input: Readonly<BlindPayload>, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal,
  options: { maxCases?: number; resume?: BlindCheckpoint; journal?: BlindJournal } = {}): Promise<BlindCheckpoint> {
  if (![candidate.commit, candidate.tree].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('candidate_identity');
  const inputs = readBlindInputs(bytes);
  const maxCases = options.maxCases ?? inputs.length;
  if (!Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > inputs.length) throw new Error('blind_batch_capacity');
  const results: Prediction[] = [];
  const journal = options.journal;
  if (journal && options.resume) throw new Error('blind_checkpoint_conflicting_owners');
  let journalState = journal ? await journal.read() : null;
  if (journalState && journalState.inFlight !== null) throw new Error('blind_case_unreconciled');
  const resume = journalState?.checkpoint ?? options.resume;
  if (resume) {
    const { predictionSha256, ...checkpoint } = resume;
    if (checkpoint.contract !== 'aerynth.cie-blind-predictions@1' || checkpoint.inputSha256 !== BLIND_INPUT_SHA256 ||
      checkpoint.candidate?.commit !== candidate.commit || checkpoint.candidate?.tree !== candidate.tree ||
      checkpoint.stopped !== null || !Array.isArray(checkpoint.results) ||
      checkpoint.results.length > inputs.length || checkpoint.complete !== (checkpoint.results.length === inputs.length) ||
      (checkpoint.complete && !journal) || checkpoint.results.some((row, index) =>
        row?.id !== inputs[index].id || !Number.isFinite(row.endToEndMs) || row.endToEndMs < 0) ||
      sha(JSON.stringify(checkpoint)) !== predictionSha256) throw new Error('blind_checkpoint_invalid');
    if (checkpoint.complete) return structuredClone(resume);
    results.push(...structuredClone(checkpoint.results));
  }
  let stopped: BlindCheckpoint['stopped'] = null;
  const snapshot = (): BlindCheckpoint => {
    const payload = { contract: 'aerynth.cie-blind-predictions@1' as const, inputSha256: BLIND_INPUT_SHA256,
      candidate: { ...candidate }, results: structuredClone(results), stopped, complete: results.length === inputs.length && !stopped };
    return { ...payload, predictionSha256: sha(JSON.stringify(payload)) };
  };
  const persist = async (inFlight: string | null) => {
    if (!journal) return;
    const next = { checkpoint: snapshot(), inFlight };
    if (!await journal.compareAndSet(journalState, next)) throw new Error('blind_journal_changed');
    journalState = next;
  };
  for (const input of inputs.slice(results.length, results.length + maxCases)) {
    if (signal.aborted) { stopped = { caseId: input.id, kind: 'cancelled' }; break; }
    if (journal) await persist(input.id);
    // The host must include qualification/preparation inside this callback. No labels exist here.
    const start = performance.now();
    try {
      signal.throwIfAborted();
      const result = await run(structuredClone({ id: input.id, request: input.request, sources: input.sources }), signal);
      results.push({ id: input.id, result: structuredClone(result), endToEndMs: performance.now() - start });
      if (signal.aborted) stopped = { caseId: input.id, kind: 'cancelled' };
    } catch {
      // Preserve completed predictions; never echo possible private host/credential error text.
      stopped = { caseId: input.id, kind: signal.aborted ? 'cancelled' : 'host-error' };
    }
    if (journal) await persist(stopped ? input.id : null);
    if (stopped) break;
  }
  return snapshot();
}
