import { canonicalRetrievalQuery } from './history-retrieval.mts';

const statuses = ['supported', 'partial', 'contradicted', 'missing', 'stale', 'inaccessible', 'uncertain'] as const;
type Status = typeof statuses[number];
const intentKinds = ['answer', 'recall', 'plan', 'revise', 'clarify', 'unknown'] as const;
const deliverableKinds = ['text', 'document', 'file', 'code', 'image', 'action', 'interactive'] as const;
export const maxSemanticHistoryNeeds = 6;
const maxCandidates = 14;
const maxRounds = 2;
const maxPassagesPerNeed = 8;
export const maxSemanticAssessmentBytes = 32 * 1024;
const gapReserveBytes = 5 * 1024;
const maxExcerptBytes = 2048;
export const maxReviewedStateBytes = 4096;
export const maxReviewedFileBytes = 12000;
const string = { type: 'string' } as const;
const list = <T extends object>(items: T) => ({ type: 'array', items });
const object = <T extends Record<string, object>>(properties: T) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const version = { type: 'integer', enum: [2] };

export const semanticHistoryFormats = {
  interpret: {
    type: 'json_schema', name: 'vela_request_perception_v2', strict: true,
    schema: object({ version, objective: string, clarification: string,
      perception: object({ kind: { type: 'string', enum: [...intentKinds] },
        explicitGoals: list(string), inferredGoals: list(string), constraints: list(string), capabilityHints: list(string),
        deliverables: list({ type: 'string', enum: [...deliverableKinds] }), verification: list(string) }),
      needs: list(object({ key: string, question: string, query: string })) }),
  },
  assess: {
    type: 'json_schema', name: 'vela_history_assessment_v3', strict: true,
    schema: object({ version: { type: 'integer', enum: [3] }, clarification: string, assessment: list(object({
      key: string, status: { type: 'string', enum: [...statuses] },
      passages: list(object({ source: string, quote: string })), query: string,
    })) }),
  },
} as const;

interface Need { key: string; question: string; query: string }
interface PerceptionProposal {
  kind: typeof intentKinds[number];
  explicitGoals: string[];
  inferredGoals: string[];
  constraints: string[];
  capabilityHints: string[];
  deliverables: typeof deliverableKinds[number][];
  verification: string[];
}
type Proposal = { objective: string; clarification: string; needs: Need[] } &
  ({ version: 1 } | { version: 2; perception: PerceptionProposal });
export type SemanticHistoryScan = 'bounded' | 'partial' | 'unavailable';
export interface SemanticHistorySource {
  sourceId: string;
  sourceKind?: 'conversation-exchange' | 'note' | 'file' | 'mission-checkpoint' | 'workspace-state';
  revision: string;
  text: string;
  title?: string;
  partial?: true;
}
interface Passage { source: string; quote: string }
interface Assessment { key: string; status: Status; sources: string[]; query: string; passages?: Passage[] }
interface EvidenceReview { rows: Assessment[]; clarification: string }
export interface ReviewedProjectCheckContext {
  files: readonly string[];
  commandKind: 'node-test';
  commandState: 'validated-locally';
  requiresStartApproval: true;
}
export type SemanticHistoryCall = (
  | { stage: 'interpret'; request: string; reviewedSourceTitles?: readonly string[]; reviewedMissionGap?: string }
  | { stage: 'assess'; request: string; proposedClarification?: string; needs: readonly Need[];
    excerpts: readonly { handle: string; text: string; title?: string; partial?: true; sourceKind?: SemanticHistorySource['sourceKind'] }[]; round: number }
) & { missionPlanning?: true; reviewedProjectCheck?: ReviewedProjectCheckContext; reviewedMissionCapabilities?: readonly string[] };

interface SemanticHistoryCandidates<T> { sources: readonly T[]; scan: SemanticHistoryScan; moreMatches?: boolean }
interface SemanticHistoryOwner<T extends SemanticHistorySource> {
  /** Longer reviewed investigations can retain the same call and evidence limits. */
  timeBudgetMs?: number;
  /** Serialized bytes appended by the owner to the assessment payload. */
  assessmentMetadataBytes?: number;
  /** Widen discovery only for reviewed snapshots with short source excerpts. */
  adaptiveDiscovery?: boolean;
  // The owner authorizes the current scope on every search and resolves canonical revisions.
  search(query: string): SemanticHistoryCandidates<T>;
  /** Return a bounded next page for a previously truncated query in the same review. */
  widen?(query: string): SemanticHistoryCandidates<T>;
  selected?(): SemanticHistoryCandidates<T>;
  recent?(): SemanticHistoryCandidates<T>;
  isCurrent(source: T): boolean;
  // Native-only disclosure gateway. Check the exact payload/destination on every call.
  // Sources are supplied to validate their current consent and lineage, never as wire metadata.
  disclose(call: SemanticHistoryCall, sources: readonly T[], signal: AbortSignal): Promise<unknown>;
}
interface Result<T> {
  state: 'assessed' | 'unavailable' | 'invalid' | 'stale';
  failure?: AssessmentRejection | 'invalid-request' | 'invalid-perception' | 'no-provider-result' |
    'source-changed' | 'deadline' | 'cancelled' | 'investigation-unavailable';
  proposal?: Proposal;
  clarification?: string;
  rounds: number;
  searchCoverage: SemanticHistoryScan | null;
  coverage: { key: string; status: Status; sources: T[]; passages?: { sourceId: string; quote: string }[] }[];
}

type AssessmentRejection = 'assessment-shape' | 'assessment-need' | 'assessment-query' |
  'assessment-passage' | 'assessment-source' | 'assessment-support';

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function bounded(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= max && (empty || !!value.trim());
}
function validPerception(value: unknown): value is PerceptionProposal {
  const textLists = ['explicitGoals', 'inferredGoals', 'constraints', 'capabilityHints', 'verification'];
  if (!exact(value, ['kind', 'deliverables', ...textLists]) ||
    !intentKinds.includes(value.kind as PerceptionProposal['kind']) ||
    !Array.isArray(value.deliverables) || value.deliverables.length > 5 ||
    new Set(value.deliverables).size !== value.deliverables.length ||
    !value.deliverables.every(kind => deliverableKinds.includes(kind))) return false;
  return textLists.every(key => {
    const entries = value[key];
    return Array.isArray(entries) && entries.length <= 5 && entries.every(entry => bounded(entry, 240));
  });
}
export function parseSemanticHistoryProposal(value: unknown): Proposal | undefined {
  const fields = ['version', 'objective', 'clarification', 'needs'];
  const legacy = exact(value, fields) && value.version === 1;
  const current = exact(value, [...fields, 'perception']) && value.version === 2 && validPerception(value.perception);
  if (!(legacy || current) || !bounded(value.objective, 512) || !bounded(value.clarification, 512, true) || !Array.isArray(value.needs) ||
    value.needs.length > maxSemanticHistoryNeeds) return;
  const keys = new Set<string>();
  for (const need of value.needs) {
    if (!exact(need, ['key', 'question', 'query']) || !bounded(need.key, 24) || !/^[a-zA-Z0-9_-]+$/.test(need.key) ||
      keys.has(need.key) || !bounded(need.question, 512) || !bounded(need.query, 512) ||
      !canonicalRetrievalQuery(need.query)) return;
    keys.add(need.key);
  }
  return structuredClone(value) as unknown as Proposal;
}
function parsePassages(value: unknown, evidence: ReadonlyMap<string, { text: string }>): Passage[] | undefined {
  if (!Array.isArray(value) || value.length > maxPassagesPerNeed) return;
  const passages: Passage[] = [];
  for (const item of value) {
    if (!exact(item, ['source', 'quote']) || typeof item.source !== 'string' || !bounded(item.quote, 512) ||
      !evidence.get(item.source)?.text.includes(item.quote)) return;
    if (passages.some(passage => passage.source === item.source && passage.quote === item.quote)) return;
    passages.push({ source: item.source, quote: item.quote });
  }
  return passages;
}

export function parseSemanticHistoryAssessment(value: unknown, needs: readonly Need[],
  evidence: ReadonlyMap<string, { text: string }>, onReject?: (reason: AssessmentRejection) => void): EvidenceReview | undefined {
  const reject = (reason: AssessmentRejection) => { onReject?.(reason); return undefined; };
  const legacy = exact(value, ['version', 'assessment']) && value.version === 1;
  const versioned = exact(value, ['version', 'assessment', 'clarification']) &&
    (value.version === 2 || value.version === 3) && bounded(value.clarification, 512, true);
  if (!(legacy || versioned) || !Array.isArray(value.assessment)) return reject('assessment-shape');
  if (value.assessment.length !== needs.length) return reject('assessment-need');
  const remaining = new Set(needs.map(need => need.key));
  const rows: Assessment[] = [];
  const quoted = value.version === 3;
  for (const row of value.assessment) {
    if (!exact(row, ['key', 'status', quoted ? 'passages' : 'sources', 'query']) ||
      !statuses.includes(row.status as Status)) return reject('assessment-shape');
    if (typeof row.key !== 'string' || !remaining.delete(row.key)) return reject('assessment-need');
    if (!bounded(row.query, 512, true) || (row.query && !canonicalRetrievalQuery(row.query))) return reject('assessment-query');
    const checkedPassages = quoted ? parsePassages(row.passages, evidence) : undefined;
    if (quoted && !checkedPassages) return reject('assessment-passage');
    const passages = checkedPassages && (row.status === 'missing' || row.status === 'inaccessible' ? [] : checkedPassages);
    const sources = passages ? [...new Set(passages.map(passage => passage.source))] : row.sources;
    if (!Array.isArray(sources) || sources.length > maxCandidates || new Set(sources).size !== sources.length ||
      !sources.every(id => typeof id === 'string' && evidence.has(id))) return reject('assessment-source');
    if ((['supported', 'partial'].includes(row.status as string) && sources.length < 1) ||
      (row.status === 'contradicted' && sources.length < 2)) return reject('assessment-support');
    rows.push({ key: row.key, status: row.status as Status, sources: [...sources], query: row.query,
      ...(passages ? { passages } : {}) });
  }
  return { rows, clarification: versioned ? String(value.clarification) : '' };
}

/** Model proposals guide search. The caller retains authoritative context selection and egress. */
export async function investigateSemanticHistory<T extends SemanticHistorySource>(request: string,
  owner: SemanticHistoryOwner<T>, cancel?: AbortSignal): Promise<Result<T>> {
  const budget = owner.timeBudgetMs;
  const timeout = AbortSignal.timeout(typeof budget === 'number' && Number.isSafeInteger(budget) &&
    budget >= 30_000 && budget <= 75_000 ? budget : 30_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  let rounds = 0;
  let searchCoverage: SemanticHistoryScan | null = null;
  const empty = (state: Result<T>['state'], failure?: Result<T>['failure']): Result<T> =>
    ({ state, ...(failure ? { failure } : {}), rounds, searchCoverage, coverage: [] });
  const disclose = async (call: SemanticHistoryCall, sources: readonly T[]) => {
    signal.throwIfAborted();
    const value = await owner.disclose(call, sources, signal);
    signal.throwIfAborted();
    return value;
  };

  try {
    if (!bounded(request, 8192)) return empty('invalid', 'invalid-request');
    const raw = await disclose({ stage: 'interpret', request }, []);
    if (raw == null) return empty('unavailable', 'no-provider-result');
    const proposal = parseSemanticHistoryProposal(raw);
    if (!proposal) return empty('invalid', 'invalid-perception');
    const pendingClarification = !proposal.needs.length ? proposal.clarification.trim() : '';
    if (!proposal.needs.length && !pendingClarification) return { ...empty('assessed'), proposal };
    const needs = pendingClarification
      ? [{ key: 'clarification', question: pendingClarification, query: canonicalRetrievalQuery(request)?.terms.join(' ') ?? '' }]
      : proposal.needs;
    const candidateLimit = owner.adaptiveDiscovery ? Math.min(maxCandidates, Math.max(8, 2 * needs.length + 2)) : 8;
    const evidence = new Map<string, T>(), observed = new Set<string>();
    const excerpts: Extract<SemanticHistoryCall, { stage: 'assess' }>['excerpts'][number][] = [];
    const assessmentInput = {
      stage: 'assess' as const, request, needs: structuredClone(needs), round: 1,
      ...(pendingClarification ? { proposedClarification: pendingClarification } : {}),
    };
    let assessmentBytes = Buffer.byteLength(JSON.stringify({ ...assessmentInput, excerpts: [] }));
    const assessmentLimit = maxSemanticAssessmentBytes - (owner.assessmentMetadataBytes ?? 0);
    const queries = new Set<string>();
    const truncatedQueries = new Set<string>();
    let next = needs.map(need => need.query).filter(Boolean);
    let widen: string[] = [];
    let anchorsRead = false;
    let priorAssessment: EvidenceReview | undefined;
    let investigateAnchors = false;
    const assessed = (review: EvidenceReview): Result<T> => {
      const clarification = review.rows.some(row => row.status !== 'supported') && (review.clarification || pendingClarification);
      return {
        state: 'assessed', proposal, rounds, searchCoverage, ...(clarification ? { clarification } : {}),
        coverage: review.rows.map(row =>
          ({ key: row.key, status: row.status, sources: row.sources.map(handle => evidence.get(handle)!),
            ...(row.passages ? { passages: row.passages.map(passage =>
              ({ sourceId: evidence.get(passage.source)!.sourceId, quote: passage.quote })) } : {}) })),
      };
    };
    const partial = () => { if (searchCoverage === 'bounded') searchCoverage = 'partial'; };
    const recordScan = (scan: SemanticHistoryScan) => {
      if (searchCoverage === null || searchCoverage === 'bounded' || scan === 'unavailable') searchCoverage = scan;
    };
    const addCandidates = ({ sources, scan }: SemanticHistoryCandidates<T>, limit = candidateLimit) => {
      recordScan(scan);
      if (sources.length > 2 * maxCandidates) partial();
      for (const source of sources.slice(0, 2 * maxCandidates)) {
        if (observed.has(source.sourceId)) continue;
        const textLimit = source.sourceKind === 'file' ? maxReviewedFileBytes :
          source.sourceKind === 'mission-checkpoint' || source.sourceKind === 'workspace-state' || source.sourceKind === 'conversation-exchange'
            ? maxReviewedStateBytes : maxExcerptBytes;
        if (evidence.size >= limit || !bounded(source.text, textLimit) || !owner.isCurrent(source)) {
          partial();
          if (evidence.size >= limit) break;
          continue;
        }
        const handle = 'e' + (evidence.size + 1);
        const excerpt = {
          handle, text: source.text, ...(source.sourceKind ? { sourceKind: source.sourceKind } : {}),
          ...(bounded(source.title, 512) ? { title: source.title } : {}),
          ...(source.partial ? { partial: true as const } : {}),
        };
        const bytes = Buffer.byteLength(JSON.stringify(excerpt)) + Number(excerpts.length > 0);
        const byteLimit = rounds === 1 && owner.adaptiveDiscovery ? assessmentLimit - gapReserveBytes : assessmentLimit;
        if (assessmentBytes + bytes > byteLimit) { partial(); continue; }
        assessmentBytes += bytes;
        excerpts.push(excerpt);
        observed.add(source.sourceId);
        evidence.set(handle, source);
      }
    };

    if (owner.selected) addCandidates(owner.selected());

    while (rounds < maxRounds) {
      rounds++;
      const priorCount = evidence.size;
      // Preserve selected evidence and leave discovery slots for refined queries.
      const limit = rounds < maxRounds ? Math.max(priorCount, candidateLimit - 2) : candidateLimit;
      const matches: T[][] = [];
      for (const query of next) {
        const digest = canonicalRetrievalQuery(query)!.digest;
        if (queries.has(digest)) continue;
        if (evidence.size >= limit) { partial(); break; }
        queries.add(digest);
        const { sources, scan, moreMatches } = owner.search(query);
        if (moreMatches) truncatedQueries.add(digest);
        recordScan(scan);
        if (sources.length > 2 * maxCandidates) partial();
        matches.push(sources.slice(0, 2 * maxCandidates));
      }
      // Admit the top result from each query before lower-ranked results.
      for (let rank = 0; rank < Math.max(0, ...matches.map(sources => sources.length)); rank++) {
        const sources = matches.flatMap(group => group[rank] ? [group[rank]] : []);
        addCandidates({ sources, scan: searchCoverage ?? 'bounded' }, limit);
        if (evidence.size >= limit && matches.some(group => group.length > rank + 1)) { partial(); break; }
      }
      if (owner.recent && !anchorsRead && ((rounds === 1 && evidence.size === priorCount) || investigateAnchors)) {
        anchorsRead = true;
        addCandidates(owner.recent(), limit);
      }
      // Keep the existing refinement and recent-evidence priorities.
      if (owner.widen && widen.length) {
        if (evidence.size >= limit) partial();
        else {
          const pages = widen.map(query => owner.widen!(query));
          for (const page of pages) {
            recordScan(page.scan);
            if (page.sources.length > 2 * maxCandidates) partial();
          }
          const ranks = Math.min(2 * maxCandidates, Math.max(...pages.map(page => page.sources.length)));
          for (let rank = 0; rank < ranks; rank++) {
            addCandidates({ sources: pages.flatMap(page => page.sources[rank] ? [page.sources[rank]] : []),
              scan: searchCoverage ?? 'bounded' }, limit);
            if (evidence.size >= limit && rank + 1 < ranks) { partial(); break; }
          }
        }
      }
      if (priorAssessment && evidence.size === priorCount) {
        if (![...evidence.values()].every(owner.isCurrent)) return empty('stale', 'source-changed');
        return assessed(priorAssessment);
      }

      if (pendingClarification && !evidence.size) return { ...empty('assessed'), proposal, clarification: pendingClarification };
      const sources = [...evidence.values()];
      if (!sources.every(source => owner.isCurrent(source))) return empty('stale', 'source-changed');
      const reviewed = await disclose(structuredClone({ ...assessmentInput, round: rounds, excerpts }), sources);
      if (!sources.every(source => owner.isCurrent(source))) return empty('stale', 'source-changed');
      if (reviewed == null) return empty('unavailable', 'no-provider-result');
      let rejection: AssessmentRejection = 'assessment-shape';
      const assessment = parseSemanticHistoryAssessment(reviewed, needs, evidence, reason => { rejection = reason; });
      if (!assessment) return empty('invalid', rejection);
      priorAssessment = assessment;
      const gaps = assessment.rows.filter(row => row.status !== 'supported');
      next = gaps.filter(row => row.query && !queries.has(canonicalRetrievalQuery(row.query)!.digest)).map(row => row.query);
      const gapKeys = new Set(gaps.filter(row => !row.query || queries.has(canonicalRetrievalQuery(row.query)!.digest))
        .map(row => row.key));
      widen = owner.widen ? needs.flatMap(need => {
        const digest = canonicalRetrievalQuery(need.query)?.digest;
        return gapKeys.has(need.key) && digest && truncatedQueries.delete(digest) ? [need.query] : [];
      }) : [];
      investigateAnchors = !!owner.recent && !anchorsRead && gaps.length > 0;
      const budgetExhausted = rounds === maxRounds || evidence.size === candidateLimit;
      if ((next.length || widen.length || investigateAnchors) && budgetExhausted) partial();
      if ((!next.length && !widen.length && !investigateAnchors) || budgetExhausted) return assessed(assessment);
    }
    return empty('invalid', 'assessment-shape');
  } catch {
    if (signal.aborted) return empty('unavailable',
      timeout.aborted || signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'deadline' : 'cancelled');
    return empty('unavailable', 'investigation-unavailable');
  }
}
