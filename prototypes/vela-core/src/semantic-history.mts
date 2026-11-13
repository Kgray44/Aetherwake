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
    excerpts: readonly { handle: string; text: string; title?: string; partial?: true; sourceKind?: SemanticHistorySource['sourceKind'] }[]; round: number;
    priorDisputes?: readonly { key: string; sources: readonly string[];
      passages: readonly { source: string; start: number; end: number }[] }[] }
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
  /** Discover reviewed references from sources cited for unresolved needs. */
  related?(sources: readonly T[]): SemanticHistoryCandidates<T>;
  selected?(): SemanticHistoryCandidates<T>;
  recent?(): SemanticHistoryCandidates<T>;
  /** When present, validates the whole immutable review for a synchronous batch. */
  isSnapshotCurrent?(): boolean;
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
    let questionFallbacks: string[] = [];
    let widen: { query: string; digest: string; refinement?: string }[] = [];
    let related: T[] = [];
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
      signal.throwIfAborted();
      recordScan(scan);
      if (sources.length && owner.isSnapshotCurrent?.() === false) { partial(); return; }
      if (sources.length > 2 * maxCandidates) partial();
      for (const source of sources.slice(0, 2 * maxCandidates)) {
        signal.throwIfAborted();
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
        if (source.partial) partial();
        assessmentBytes += bytes;
        excerpts.push(excerpt);
        observed.add(source.sourceId);
        evidence.set(handle, source);
      }
    };

    if (owner.selected) addCandidates(owner.selected());

    while (rounds < maxRounds) {
      signal.throwIfAborted();
      rounds++;
      const priorCount = evidence.size;
      const priorDisputes = priorAssessment?.rows.filter(row => row.status === 'contradicted').map(row => ({
        key: row.key, sources: row.sources,
        passages: (row.passages ?? []).map(({ source, quote }) => {
          const start = evidence.get(source)!.text.indexOf(quote);
          return { source, start, end: start + quote.length };
        }),
      }));
      // Preserve selected evidence and leave discovery slots for refined queries.
      const limit = rounds < maxRounds ? Math.max(priorCount, candidateLimit - 2) : candidateLimit;
      const matches: T[][] = [];
      const refinementResults = new Map<string, readonly T[]>();
      const previouslyObserved = widen.length ? new Set(observed) : undefined;
      for (const query of next) {
        signal.throwIfAborted();
        const digest = canonicalRetrievalQuery(query)!.digest;
        if (queries.has(digest)) continue;
        if (evidence.size >= limit) { partial(); break; }
        queries.add(digest);
        const { sources, scan, moreMatches } = owner.search(query);
        if (moreMatches) truncatedQueries.add(digest);
        recordScan(scan);
        if (sources.length > 2 * maxCandidates) partial();
        const batch = sources.slice(0, 2 * maxCandidates);
        matches.push(batch);
        if (previouslyObserved) refinementResults.set(digest, batch);
      }
      // Admit the top result from each query before lower-ranked results.
      for (let rank = 0; rank < Math.max(0, ...matches.map(sources => sources.length)); rank++) {
        const sources = matches.flatMap(group => group[rank] ? [group[rank]] : []);
        addCandidates({ sources, scan: searchCoverage ?? 'bounded' }, limit);
        if (rank === 0 && matches.some(group => group.length > 1) &&
          owner.adaptiveDiscovery && owner.recent && !anchorsRead && investigateAnchors && evidence.size < limit) {
          signal.throwIfAborted();
          anchorsRead = true;
          addCandidates(owner.recent(), Math.min(limit, evidence.size + 1));
        }
        if (evidence.size >= limit && matches.some(group => group.length > rank + 1)) { partial(); break; }
      }
      const remainingPages = widen.filter(({ refinement }) => !refinement ||
        !refinementResults.get(refinement)?.some(source => !previouslyObserved?.has(source.sourceId) && observed.has(source.sourceId)));
      if (owner.recent && !anchorsRead && ((rounds === 1 && evidence.size === priorCount) || investigateAnchors)) {
        signal.throwIfAborted();
        anchorsRead = true;
        addCandidates(owner.recent(), limit);
      }
      if (owner.related && related.length && evidence.size < limit) {
        signal.throwIfAborted();
        addCandidates(owner.related(related), limit);
      }
      // Keep the existing refinement and recent-evidence priorities.
      if (owner.widen && remainingPages.length) {
        if (evidence.size >= limit) partial();
        else {
          const pages = remainingPages.filter(({ digest }) => truncatedQueries.delete(digest))
            .map(({ query }) => {
              signal.throwIfAborted();
              return owner.widen!(query);
            });
          for (const page of pages) {
            recordScan(page.scan);
            if (page.sources.length > 2 * maxCandidates) partial();
          }
          const ranks = Math.min(2 * maxCandidates, Math.max(0, ...pages.map(page => page.sources.length)));
          for (let rank = 0; rank < ranks; rank++) {
            addCandidates({ sources: pages.flatMap(page => page.sources[rank] ? [page.sources[rank]] : []),
              scan: searchCoverage ?? 'bounded' }, limit);
            if (evidence.size >= limit && rank + 1 < ranks) { partial(); break; }
          }
        }
      }
      for (const question of questionFallbacks) {
        if (evidence.size >= limit) { partial(); break; }
        signal.throwIfAborted();
        const digest = canonicalRetrievalQuery(question)!.digest;
        if (queries.has(digest)) continue;
        queries.add(digest);
        addCandidates(owner.search(question), limit);
      }
      signal.throwIfAborted();
      if (priorAssessment && evidence.size === priorCount) {
        if (owner.isSnapshotCurrent?.() === false || ![...evidence.values()].every(owner.isCurrent)) return empty('stale', 'source-changed');
        return assessed(priorAssessment);
      }

      if (pendingClarification && !evidence.size) return { ...empty('assessed'), proposal, clarification: pendingClarification };
      const sources = [...evidence.values()];
      if (owner.isSnapshotCurrent?.() === false || !sources.every(source => owner.isCurrent(source))) return empty('stale', 'source-changed');
      const disputePointers = priorDisputes?.length ? { priorDisputes } : {};
      const pointerBytes = priorDisputes?.length ? Buffer.byteLength(JSON.stringify(disputePointers)) - 1 : 0;
      // Prefer the actual evidence. The host still retains prior dispute citations.
      const followup = assessmentBytes + pointerBytes <= assessmentLimit ? disputePointers : {};
      const reviewed = await disclose(structuredClone({ ...assessmentInput, round: rounds, excerpts, ...followup }), sources);
      if (owner.isSnapshotCurrent?.() === false || !sources.every(source => owner.isCurrent(source))) return empty('stale', 'source-changed');
      if (reviewed == null) return empty('unavailable', 'no-provider-result');
      let rejection: AssessmentRejection = 'assessment-shape';
      const assessment = parseSemanticHistoryAssessment(reviewed, needs, evidence, reason => { rejection = reason; });
      if (!assessment) return empty('invalid', rejection);
      if (priorAssessment) {
        const disputed = new Map(priorAssessment.rows.filter(row => row.status === 'contradicted').map(row => [row.key, row]));
        assessment.rows = assessment.rows.map(row => {
          const prior = disputed.get(row.key);
          if (!prior) return row;
          if (row.status === 'contradicted') {
            if (!prior.passages || !row.passages) return row;
            const combined = [...prior.passages];
            for (const passage of row.passages) {
              if (!combined.some(previous => previous.source === passage.source && previous.quote === passage.quote)) {
                combined.push(passage);
              }
            }
            let passages = combined;
            if (combined.length > maxPassagesPerNeed) {
              partial();
              const firstBySource = new Map<string, Passage>();
              for (const passage of combined) {
                if (!firstBySource.has(passage.source)) firstBySource.set(passage.source, passage);
              }
              const first = [...firstBySource.values()];
              passages = [...first, ...combined.filter(passage => firstBySource.get(passage.source) !== passage)].slice(0, maxPassagesPerNeed);
            }
            return { ...row, passages, sources: [...new Set(passages.map(passage => passage.source))] };
          }
          // A new citation can support a model-proposed resolution. Picking one
          // side of the already cited conflict cannot establish a resolution.
          if (row.status === 'supported' && row.passages?.some(passage =>
            Number(passage.source.slice(1)) > priorCount)) return row;
          return prior;
        });
      }
      priorAssessment = assessment;
      const gaps = assessment.rows.filter(row => row.status !== 'supported');
      related = owner.related ? [...new Set(gaps.flatMap(row => row.sources))].map(handle => evidence.get(handle)!) : [];
      const gapsByKey = new Map(gaps.map(row => [row.key, row]));
      const refinements = new Map(gaps.flatMap(row => {
        const query = canonicalRetrievalQuery(row.query);
        return query && !queries.has(query.digest) ? [[row.key, row.query] as const] : [];
      }));
      next = [...refinements.values()];
      questionFallbacks = owner.adaptiveDiscovery && rounds < maxRounds
        ? needs.filter(need => {
          if (gapsByKey.get(need.key)?.status !== 'missing' || refinements.has(need.key)) return false;
          const question = canonicalRetrievalQuery(need.question);
          return question && !queries.has(question.digest);
        }).map(need => need.question) : [];
      widen = owner.widen ? needs.flatMap(need => {
        const gap = gapsByKey.get(need.key);
        const digest = canonicalRetrievalQuery(need.query)?.digest;
        if (!gap || !digest || !truncatedQueries.has(digest)) return [];
        return [{ query: need.query, digest, refinement: canonicalRetrievalQuery(gap.query)?.digest }];
      }) : [];
      investigateAnchors = !!owner.recent && !anchorsRead && gaps.length > 0;
      const budgetExhausted = rounds === maxRounds || evidence.size === candidateLimit;
      const hasFollowup = next.length || widen.length || related.length || questionFallbacks.length || investigateAnchors;
      if (hasFollowup && budgetExhausted) partial();
      if (!hasFollowup || budgetExhausted) return assessed(assessment);
    }
    return empty('invalid', 'assessment-shape');
  } catch {
    if (signal.aborted) return empty('unavailable',
      timeout.aborted || signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'deadline' : 'cancelled');
    return empty('unavailable', 'investigation-unavailable');
  }
}
