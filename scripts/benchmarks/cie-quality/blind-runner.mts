import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
export const BLIND_INPUT_SHA256 = 'bd9fb6898473fb60b3e669d40b097f7e0e231f0ac98997365d86bddbca701997';
export interface BlindCase { id: string; category: string; request: string; sources: { id: string; title: string; text: string }[] }
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
export async function runBlindCie(bytes: Buffer, candidate: { commit: string; tree: string },
  run: (input: Readonly<BlindCase>, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) {
  if (![candidate.commit, candidate.tree].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('candidate_identity');
  const inputs = readBlindInputs(bytes);
  const results: { id: string; result: unknown; endToEndMs: number }[] = [];
  let stopped: { caseId: string; kind: 'cancelled' | 'host-error' } | null = null;
  for (const input of inputs) {
    if (signal.aborted) { stopped = { caseId: input.id, kind: 'cancelled' }; break; }
    // The host must include qualification/preparation inside this callback. No labels exist here.
    const start = performance.now();
    try {
      const result = await run(structuredClone(input), signal);
      results.push({ id: input.id, result: structuredClone(result), endToEndMs: performance.now() - start });
      if (signal.aborted) { stopped = { caseId: input.id, kind: 'cancelled' }; break; }
    } catch {
      // Preserve completed predictions; never echo possible private host/credential error text.
      stopped = { caseId: input.id, kind: signal.aborted ? 'cancelled' : 'host-error' }; break;
    }
  }
  const payload = { contract: 'aerynth.cie-blind-predictions@1', inputSha256: BLIND_INPUT_SHA256, candidate, results, stopped, complete: results.length === inputs.length && !stopped };
  return { ...payload, predictionSha256: sha(JSON.stringify(payload)) };
}
