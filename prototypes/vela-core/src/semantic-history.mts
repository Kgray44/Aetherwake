import { canonicalRetrievalQuery } from './history-retrieval.mts';

const statuses = ['supported', 'contradicted', 'missing', 'stale', 'inaccessible', 'uncertain'] as const;
type Status = typeof statuses[number];
const maxNeeds = 4;
const maxCandidates = 8;
const maxRounds = 2;
const maxExcerptBytes = 2048;
const string = { type: 'string' } as const;
const list = <T extends object>(items: T) => ({ type: 'array', items });
const object = <T extends Record<string, object>>(properties: T) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const version = { type: 'integer', enum: [1] };

export const semanticHistoryFormats = {
  interpret: {
    type: 'json_schema', name: 'vela_history_needs_v1', strict: true,
    schema: object({ version, objective: string, clarification: string,
      needs: list(object({ key: string, question: string, query: string })) }),
  },
  assess: {
    type: 'json_schema', name: 'vela_history_assessment_v1', strict: true,
    schema: object({ version, assessment: list(object({ key: string, status: { type: 'string', enum: [...statuses] },
      sources: list(string), query: string })) }),
  },
} as const;

interface Need { key: string; question: string; query: string }
interface Proposal { version: 1; objective: string; clarification: string; needs: Need[] }
export type SemanticHistoryScan = 'bounded' | 'partial' | 'unavailable';
export interface SemanticHistorySource { sourceId: string; revision: string; text: string }
interface Assessment { key: string; status: Status; sources: string[]; query: string }
export type SemanticHistoryCall =
  | { stage: 'interpret'; request: string }
  | { stage: 'assess'; needs: readonly Need[]; excerpts: readonly { handle: string; text: string }[]; round: number };

interface SemanticHistoryOwner<T extends SemanticHistorySource> {
  // The owner authorizes the current scope on every search and resolves canonical revisions.
  search(query: string): { sources: readonly T[]; scan: SemanticHistoryScan };
  isCurrent(source: T): boolean;
  // Native-only disclosure gateway. Check the exact payload/destination on every call.
  // Sources are supplied to validate their current consent and lineage, never as wire metadata.
  disclose(call: SemanticHistoryCall, sources: readonly T[], signal: AbortSignal): Promise<unknown>;
}
interface Result<T> {
  state: 'assessed' | 'unavailable' | 'invalid' | 'stale';
  proposal?: Proposal;
  rounds: number;
  searchCoverage: SemanticHistoryScan | null;
  coverage: { key: string; status: Status; sources: T[] }[];
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function bounded(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= max && (empty || !!value.trim());
}
function parseProposal(value: unknown): Proposal | undefined {
  if (!exact(value, ['version', 'objective', 'clarification', 'needs']) || value.version !== 1 ||
    !bounded(value.objective, 512) || !bounded(value.clarification, 512, true) || !Array.isArray(value.needs) ||
    value.needs.length > maxNeeds) return;
  const keys = new Set<string>();
  for (const need of value.needs) {
    if (!exact(need, ['key', 'question', 'query']) || !bounded(need.key, 24) || !/^[a-zA-Z0-9_-]+$/.test(need.key) ||
      keys.has(need.key) || !bounded(need.question, 512) || !bounded(need.query, 512) ||
      !canonicalRetrievalQuery(need.query)) return;
    keys.add(need.key);
  }
  return structuredClone(value) as unknown as Proposal;
}
function parseAssessment<T>(value: unknown, needs: readonly Need[], evidence: Map<string, T>): Assessment[] | undefined {
  if (!exact(value, ['version', 'assessment']) || value.version !== 1 || !Array.isArray(value.assessment) ||
    value.assessment.length !== needs.length) return;
  const remaining = new Set(needs.map(need => need.key));
  for (const row of value.assessment) {
    if (!exact(row, ['key', 'status', 'sources', 'query']) || typeof row.key !== 'string' || !remaining.delete(row.key) ||
      !statuses.includes(row.status as Status) || !Array.isArray(row.sources) || row.sources.length > maxCandidates ||
      new Set(row.sources).size !== row.sources.length || !row.sources.every(id => typeof id === 'string' && evidence.has(id)) ||
      !bounded(row.query, 512, true) || (row.query && !canonicalRetrievalQuery(row.query))) return;
    if ((row.status === 'supported' && row.sources.length < 1) ||
      (row.status === 'contradicted' && row.sources.length < 2)) return;
  }
  return structuredClone(value.assessment) as Assessment[];
}

/** Model proposals guide search. The caller retains authoritative context selection and egress. */
export async function investigateSemanticHistory<T extends SemanticHistorySource>(request: string,
  owner: SemanticHistoryOwner<T>, cancel?: AbortSignal): Promise<Result<T>> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  let rounds = 0;
  let searchCoverage: SemanticHistoryScan | null = null;
  const empty = (state: Result<T>['state']): Result<T> => ({ state, rounds, searchCoverage, coverage: [] });
  const disclose = async (call: SemanticHistoryCall, sources: readonly T[]) => {
    signal.throwIfAborted();
    const value = await owner.disclose(call, sources, signal);
    signal.throwIfAborted();
    return value;
  };

  try {
    if (!bounded(request, 8192)) return empty('invalid');
    const raw = await disclose({ stage: 'interpret', request }, []);
    if (raw == null) return empty('unavailable');
    const proposal = parseProposal(raw);
    if (!proposal) return empty('invalid');
    if (!proposal.needs.length) return { ...empty('assessed'), proposal };
    const evidence = new Map<string, T>(), observed = new Set<string>();
    const queries = new Set<string>();
    let next = proposal.needs.map(need => need.query);

    while (next.length && rounds < maxRounds) {
      rounds++;
      for (const query of next) {
        const digest = canonicalRetrievalQuery(query)!.digest;
        if (queries.has(digest)) continue;
        if (evidence.size === maxCandidates) {
          if (searchCoverage === 'bounded') searchCoverage = 'partial';
          break;
        }
        queries.add(digest);
        const { sources, scan } = owner.search(query);
        if (searchCoverage === null || searchCoverage === 'bounded' || scan === 'unavailable') searchCoverage = scan;
        if (sources.length > 2 * maxCandidates && searchCoverage === 'bounded') searchCoverage = 'partial';
        for (const source of sources.slice(0, 2 * maxCandidates)) {
          if (observed.has(source.sourceId)) continue;
          if (evidence.size === maxCandidates || !bounded(source.text, maxExcerptBytes) || !owner.isCurrent(source)) {
            if (searchCoverage === 'bounded') searchCoverage = 'partial';
            if (evidence.size === maxCandidates) break;
            continue;
          }
          observed.add(source.sourceId);
          evidence.set('e' + (evidence.size + 1), source);
        }
      }

      const sources = [...evidence.values()];
      if (!sources.every(source => owner.isCurrent(source))) return empty('stale');
      const reviewed = await disclose({ stage: 'assess', needs: structuredClone(proposal.needs), round: rounds,
        excerpts: [...evidence].map(([handle, source]) => ({ handle, text: source.text })) }, sources);
      if (!sources.every(source => owner.isCurrent(source))) return empty('stale');
      if (reviewed == null) return empty('unavailable');
      const assessment = parseAssessment(reviewed, proposal.needs, evidence);
      if (!assessment) return empty('invalid');
      next = assessment.filter(row => row.status !== 'supported' && row.query &&
        !queries.has(canonicalRetrievalQuery(row.query)!.digest)).map(row => row.query);
      const budgetExhausted = rounds === maxRounds || evidence.size === maxCandidates;
      if (next.length && budgetExhausted && searchCoverage === 'bounded') searchCoverage = 'partial';
      if (!next.length || budgetExhausted) {
        return { state: 'assessed', proposal, rounds, searchCoverage, coverage: assessment.map(row =>
          ({ key: row.key, status: row.status, sources: row.sources.map(handle => evidence.get(handle)!) })) };
      }
    }
    return empty('invalid');
  } catch {
    return empty('unavailable');
  }
}
