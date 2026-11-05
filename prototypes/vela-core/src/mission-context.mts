import { createHash } from 'node:crypto';
import { historyDigest } from './bounded-history.mts';
import type { VelaHostPort } from './contracts.ts';

export const MISSION_CONTEXT_CONTRACT = 'aerynth.vela-mission-context@1' as const;
const limits = { bytes: 65536, sourceBytes: 16384, sources: 64, required: 16, dependencies: 16,
  deferredBytes: 1024, scoreCacheEntries: 128 };

export interface MissionContextScope { projectId: string | null; workspaceId: string }
export interface MissionContextBinding {
  readonly missionId: string;
  readonly revision: number;
  readonly taskId: string;
  readonly scope: Readonly<MissionContextScope>;
}
export interface MissionSourceRef {
  kind: 'resource' | 'conversation-message' | 'handoff' | 'personal-fact';
  id: string;
}
export interface MissionSourceSnapshot {
  ref: MissionSourceRef;
  version: string | number;
  locator: string;
  scope: { kind: 'project' | 'workspace'; id: string } | { kind: 'shared' };
  certainty: 'observed' | 'reviewed' | 'reported' | 'inferred' | 'unknown';
  observedAt?: string;
  content: string;
}
/** Trusted, read-only owning-service boundary. Discovery is not permission to read or disclose. */
export interface MissionContextSource {
  scopeVersion(binding: MissionContextBinding): string | null;
  retrieve(binding: MissionContextBinding, query: string): readonly MissionSourceRef[];
  /** Resolve the current snapshot only after applying the mission's current scope and content policy. */
  read(ref: Readonly<MissionSourceRef>, binding: MissionContextBinding): MissionSourceSnapshot | null;
}
export interface MissionContextDependency {
  readonly taskId: string;
  readonly evidenceId: string;
  readonly attemptId: string;
  readonly source: string;
  readonly observedAt: string;
  readonly value: unknown;
}
export interface MissionContextRequest extends MissionContextBinding {
  readonly missionObjective: string;
  readonly taskObjective: string;
  readonly criteria: readonly string[];
  readonly constraints?: readonly string[];
  readonly dependencyTaskIds: readonly string[];
  /** The scheduler supplies current verified evidence for each declared prerequisite. */
  readonly dependencies: readonly MissionContextDependency[];
  readonly requiredSources?: readonly Readonly<MissionSourceRef & { expectedVersion?: string | number }>[];
  readonly maxTokens: number;
  /** Optional tokenizer for this exact payload encoding. Provider framing and output are outside this budget. */
  readonly tokenCounter?: { id: string; count(payloadJson: string): number };
}
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
type Evidence = Readonly<Omit<MissionContextDependency, 'value'> & { value: Json }>;
type Citation = Readonly<Omit<MissionSourceSnapshot, 'content'> & {
  digest: string;
  inclusion: 'required' | 'relevant';
}>;
type QuotedSource = Readonly<{ citation: Citation; content: string; trust: 'untrusted-source-data' }>;
type Omission = 'unavailable' | 'irrelevant' | 'duplicate' | 'budget';
type SourceProof = Readonly<Pick<Citation, 'ref' | 'version' | 'digest'>>;
type Compaction = Readonly<{
  strategy: 'whole-source-selection';
  deferred: readonly SourceProof[];
  untracked: number;
}>;
type Accounting = Readonly<{
  method: 'tokenizer' | 'utf8-byte-estimate';
  tokenizerId: string | null;
  tokens: number;
  maxTokens: number;
  payloadBytes: number;
}>;
/** Private execution package. Expose metadata to the presenter only through the host's scoped projection. */
export interface MissionContextPackage {
  readonly contract: typeof MISSION_CONTEXT_CONTRACT;
  readonly payload: Readonly<{
    binding: MissionContextBinding;
    missionObjective: string;
    taskObjective: string;
    criteria: readonly string[];
    constraints: readonly string[];
    dependencies: readonly Evidence[];
    sources: readonly QuotedSource[];
  }>;
  /** Host-only projection. Retain the receipt if needed and resolve source bodies from their owners. */
  readonly manifest: Readonly<{
    contract: typeof MISSION_CONTEXT_CONTRACT;
    binding: MissionContextBinding;
    scopeVersion: string | null;
    requestDigest: string;
    payloadDigest: string;
    sources: readonly Citation[];
    dependencies: readonly Readonly<{ taskId: string; evidenceId: string; attemptId: string; digest: string }>[];
    retrieval: 'searched' | 'not-configured' | 'unavailable';
    omissions: readonly Readonly<{ reason: Omission; count: number }>[];
    compaction?: Compaction;
    accounting: Accounting;
    digest: string;
  }>;
}

export class MissionContextError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'MissionContextError'; this.code = code; }
}
class CounterUnavailable extends Error {}
function requireContext(condition: unknown, code: string): asserts condition {
  if (!condition) throw new MissionContextError(code);
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length <= max && value.trim().length > 0;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;
const version = (value: unknown) => text(value) || integer(value);
const timestamp = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));
const sourceKey = (ref: Readonly<MissionSourceRef>) => JSON.stringify([ref.kind, ref.id]);
const validRef = (ref: MissionSourceRef | undefined) => !!ref &&
  ['resource', 'conversation-message', 'handoff', 'personal-fact'].includes(ref.kind) && text(ref.id);
const words = (value: string) => new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
const overlap = (terms: ReadonlySet<string>, sample: ReadonlySet<string>) => [...terms].filter(term => sample.has(term)).length;

/** Caller-owned and disposable. Retain only a hash and numeric score, never source or query text. */
export function createMissionContextCache() {
  const scores = new Map<string, number>();
  let hits = 0;
  return {
    score(key: string, compute: () => number): number {
      const cached = scores.get(key);
      if (cached !== undefined) {
        hits++;
        scores.delete(key);
        scores.set(key, cached);
        return cached;
      }
      const score = compute();
      scores.set(key, score);
      if (scores.size > limits.scoreCacheEntries) scores.delete(scores.keys().next().value!);
      return score;
    },
    stats: () => ({ entries: scores.size, hits }),
  };
}
type MissionContextCache = ReturnType<typeof createMissionContextCache>;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Dependency evidence remains whole. Reject non-JSON values and oversized graphs instead of truncating. */
function evidenceValue(input: unknown): Json {
  let nodes = 0, stringBytes = 0;
  function string(value: string) {
    stringBytes += Buffer.byteLength(value);
    requireContext(stringBytes <= limits.bytes, 'mission_context_required_budget_exceeded');
    return value;
  }
  function visit(value: unknown, depth: number): Json {
    requireContext(++nodes <= 4096 && depth <= 16, 'mission_context_required_budget_exceeded');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return string(value);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
      requireContext(value.length <= 4096, 'mission_context_required_budget_exceeded');
      return Array.from(value, item => visit(item, depth + 1));
    }
    requireContext(value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'mission_context_invalid_evidence');
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compare);
    requireContext(keys.length <= 4096, 'mission_context_required_budget_exceeded');
    return Object.fromEntries(keys.map(key => [string(key), visit(record[key], depth + 1)]));
  }
  return visit(input, 0);
}

function mandatory(input: MissionContextRequest) {
  requireContext(text(input.missionId) && integer(input.revision) && text(input.taskId) &&
    input.scope && text(input.scope.workspaceId) && (input.scope.projectId === null || text(input.scope.projectId)) &&
    text(input.missionObjective, 8192) && text(input.taskObjective, 8192) && integer(input.maxTokens, limits.bytes) &&
    (!input.tokenCounter || text(input.tokenCounter.id) && typeof input.tokenCounter.count === 'function'), 'mission_context_invalid_request');
  const criteria = input.criteria, constraints = input.constraints ?? [];
  requireContext(Array.isArray(criteria) && criteria.length > 0 && criteria.length <= 32 &&
    Array.isArray(constraints) && constraints.length <= 32 && [...criteria, ...constraints].every(value => text(value, 4096)), 'mission_context_invalid_criteria');
  const { dependencyTaskIds, dependencies } = input;
  requireContext(Array.isArray(dependencyTaskIds) && dependencyTaskIds.length <= limits.dependencies &&
    [...dependencyTaskIds].every(id => text(id) && id !== input.taskId) && new Set(dependencyTaskIds).size === dependencyTaskIds.length &&
    Array.isArray(dependencies) && dependencies.length === dependencyTaskIds.length, 'mission_context_dependencies_unavailable');
  const expected = new Set(dependencyTaskIds), evidenceIds = new Set<string>();
  const evidence = [...dependencies].map(item => {
    requireContext(item && expected.delete(item.taskId) && text(item.evidenceId) && !evidenceIds.has(item.evidenceId) &&
      text(item.attemptId) && text(item.source, 1000) && timestamp(item.observedAt), 'mission_context_dependencies_unavailable');
    evidenceIds.add(item.evidenceId);
    return { taskId: item.taskId, evidenceId: item.evidenceId, attemptId: item.attemptId,
      source: item.source, observedAt: item.observedAt, value: evidenceValue(item.value) };
  }).sort((a, b) => compare(a.taskId, b.taskId));
  const required = input.requiredSources ?? [];
  requireContext(Array.isArray(required) && required.length <= limits.required &&
    [...required].every(ref => validRef(ref) && (ref.expectedVersion === undefined || version(ref.expectedVersion))) &&
    new Set(required.map(sourceKey)).size === required.length, 'mission_context_invalid_source');
  const requiredRefs = required.map(({ kind, id, expectedVersion }) => ({ kind, id, expectedVersion }))
    .sort((a, b) => compare(sourceKey(a), sourceKey(b)));
  const binding = freeze({ missionId: input.missionId, revision: input.revision, taskId: input.taskId,
    scope: { projectId: input.scope.projectId, workspaceId: input.scope.workspaceId } });
  const payload = { binding, missionObjective: input.missionObjective, taskObjective: input.taskObjective,
    criteria: [...criteria], constraints: [...constraints], dependencies: evidence };
  const requestDigest = historyDigest({ payload, requiredRefs, maxTokens: input.maxTokens, tokenizerId: input.tokenCounter?.id ?? null });
  return { binding, payload, requiredRefs, requestDigest };
}

function scopeVersion(source: MissionContextSource | undefined, binding: MissionContextBinding): string | null {
  if (!source) return null;
  let current: string | null = null;
  try { current = source.scopeVersion(binding); } catch { /* owning service unavailable */ }
  requireContext(text(current, 512), 'mission_context_scope_unavailable');
  return current;
}

const certaintyOrder = ['unknown', 'inferred', 'reported', 'reviewed', 'observed'];
function readSource(source: MissionContextSource | undefined, ref: Readonly<MissionSourceRef>, binding: MissionContextBinding, inclusion: Citation['inclusion']): QuotedSource | null {
  let item: MissionSourceSnapshot | null = null;
  try { item = source?.read(Object.freeze({ kind: ref.kind, id: ref.id }), binding) ?? null; }
  catch { /* inaccessible canonical source */ }
  if (!item || !validRef(item.ref) || sourceKey(item.ref) !== sourceKey(ref) || !version(item.version) ||
      !text(item.locator, 1000) || !certaintyOrder.includes(item.certainty) ||
      item.observedAt !== undefined && !timestamp(item.observedAt) ||
      !text(item.content, limits.sourceBytes) || Buffer.byteLength(item.content) > limits.sourceBytes) return null;
  const { scope } = item;
  if (!scope || !(scope.kind === 'shared' || scope.kind === 'project' && scope.id === binding.scope.projectId ||
      scope.kind === 'workspace' && scope.id === binding.scope.workspaceId)) return null;
  return { citation: { ref: { kind: ref.kind, id: ref.id }, version: item.version, locator: item.locator,
    scope: scope.kind === 'shared' ? { kind: 'shared' } : { kind: scope.kind, id: scope.id }, certainty: item.certainty,
    ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt }), digest: digest(item.content), inclusion },
    content: item.content, trust: 'untrusted-source-data' };
}

function measure(payloadJson: string, maxTokens: number, counter?: MissionContextRequest['tokenCounter']): Accounting {
  const payloadBytes = Buffer.byteLength(payloadJson);
  if (!counter) return { method: 'utf8-byte-estimate', tokenizerId: null, tokens: payloadBytes, maxTokens, payloadBytes };
  try {
    const tokens = counter.count(payloadJson);
    if (integer(tokens)) return { method: 'tokenizer', tokenizerId: counter.id, tokens, maxTokens, payloadBytes };
  } catch { /* restart packing with the conservative estimate */ }
  throw new CounterUnavailable();
}
const fits = (account: Accounting) => account.tokens <= account.maxTokens && account.payloadBytes <= limits.bytes;

export function compileMissionContext(input: MissionContextRequest, source?: MissionContextSource,
  cache?: MissionContextCache): MissionContextPackage {
  const { binding, payload: requiredPayload, requiredRefs, requestDigest } = mandatory(input);
  const { maxTokens } = input;
  let counter = input.tokenCounter;
  const stamp = scopeVersion(source, binding);
  const pinned = requiredRefs.map(ref => {
    const item = readSource(source, ref, binding, 'required');
    requireContext(item && (ref.expectedVersion === undefined || item.citation.version === ref.expectedVersion), 'mission_context_required_source_unavailable');
    return item;
  });
  const baseJson = JSON.stringify({ ...requiredPayload, sources: pinned });
  let baseAccounting: Accounting;
  try { baseAccounting = measure(baseJson, maxTokens, counter); }
  catch (error) {
    if (!(error instanceof CounterUnavailable)) throw error;
    counter = undefined;
    baseAccounting = measure(baseJson, maxTokens);
  }
  requireContext(fits(baseAccounting), 'mission_context_required_budget_exceeded');
  const taskTerms = words([requiredPayload.taskObjective, ...requiredPayload.criteria].join(' '));
  const missionTerms = words(requiredPayload.missionObjective);
  const rankingKey = cache ? historyDigest([binding.scope, stamp, [...taskTerms].sort(compare), [...missionTerms].sort(compare)]) : null;
  const query = [...taskTerms].slice(0, 16).join(' ').slice(0, 200);
  let retrieval: MissionContextPackage['manifest']['retrieval'] = source ? 'searched' : 'not-configured';
  let refs: readonly MissionSourceRef[] = [];
  if (source) {
    try {
      refs = source.retrieve(binding, query);
      if (!Array.isArray(refs) || refs.length > limits.sources || !refs.every(validRef)) throw new Error();
    } catch { retrieval = 'unavailable'; refs = []; }
  }
  const omissions = new Map<Omission, number>();
  const omit = (reason: Omission) => omissions.set(reason, (omissions.get(reason) ?? 0) + 1);
  const seen = new Set(requiredRefs.map(sourceKey));
  const candidates: { item: QuotedSource; score: number; certainty: number; date: number; bytes: number }[] = [];
  for (const ref of refs) {
    const key = sourceKey(ref);
    if (seen.has(key)) { omit('duplicate'); continue; }
    seen.add(key);
    const item = readSource(source, ref, binding, 'relevant');
    if (!item) { omit('unavailable'); continue; }
    const calculateScore = () => {
      const terms = words(item.content);
      return overlap(taskTerms, terms) * 3 + overlap(missionTerms, terms);
    };
    const { version, digest } = item.citation;
    const score = cache ? cache.score(historyDigest([rankingKey, ref.kind, ref.id, version, digest]), calculateScore) : calculateScore();
    if (!score) { omit('irrelevant'); continue; }
    candidates.push({ item, score, certainty: certaintyOrder.indexOf(item.citation.certainty),
      date: item.citation.observedAt ? Date.parse(item.citation.observedAt) : 0, bytes: Buffer.byteLength(item.content) });
  }
  candidates.sort((a, b) => b.score - a.score || b.certainty - a.certainty || b.date - a.date || a.bytes - b.bytes ||
    compare(sourceKey(a.item.citation.ref), sourceKey(b.item.citation.ref)));
  const fixedOmissions = new Map(omissions);
  function pack() {
    omissions.clear();
    for (const [reason, count] of fixedOmissions) omissions.set(reason, count);
    const sources = [...pinned], payload = { ...requiredPayload, sources }, deferred: SourceProof[] = [];
    let deferredBytes = 2, untracked = 0;
    let payloadJson = baseJson, accounting = baseAccounting;
    const included = new Set(pinned.map(item => item.citation.digest));
    for (const { item } of candidates) {
      if (included.has(item.citation.digest)) { omit('duplicate'); continue; }
      sources.push(item);
      const nextJson = JSON.stringify(payload), next = measure(nextJson, maxTokens, counter);
      if (!fits(next)) {
        sources.pop();
        omit('budget');
        const { ref, version, digest } = item.citation;
        const proof = { ref, version, digest };
        const bytes = Buffer.byteLength(JSON.stringify(proof)) + Number(deferred.length > 0);
        if (deferredBytes + bytes <= limits.deferredBytes) {
          deferred.push(proof);
          deferredBytes += bytes;
        } else untracked++;
        continue;
      }
      included.add(item.citation.digest);
      payloadJson = nextJson;
      accounting = next;
    }
    return { payload, payloadJson, accounting, deferred, untracked };
  }
  let packed: ReturnType<typeof pack>;
  try { packed = pack(); }
  catch (error) {
    if (!(error instanceof CounterUnavailable)) throw error;
    counter = undefined;
    baseAccounting = measure(baseJson, maxTokens);
    requireContext(fits(baseAccounting), 'mission_context_required_budget_exceeded');
    packed = pack();
  }
  requireContext(scopeVersion(source, binding) === stamp, 'mission_context_scope_changed');
  const manifest = { contract: MISSION_CONTEXT_CONTRACT, binding, scopeVersion: stamp, requestDigest,
    payloadDigest: digest(packed.payloadJson), sources: packed.payload.sources.map(item => item.citation),
    dependencies: requiredPayload.dependencies.map(({ taskId, evidenceId, attemptId, ...proof }) =>
      ({ taskId, evidenceId, attemptId, digest: historyDigest(proof) })), retrieval,
    omissions: [...omissions].sort(([a], [b]) => compare(a, b)).map(([reason, count]) => ({ reason, count })),
    ...(packed.deferred.length || packed.untracked ? { compaction: { strategy: 'whole-source-selection' as const,
      deferred: packed.deferred, untracked: packed.untracked } } : {}),
    accounting: packed.accounting };
  return freeze({ contract: MISSION_CONTEXT_CONTRACT, payload: packed.payload, manifest: { ...manifest, digest: historyDigest(manifest) } });
}

function readReceiptSources(manifest: MissionContextPackage['manifest'], source?: MissionContextSource) {
  const { digest: manifestDigest, ...receipt } = manifest;
  requireContext(manifest.contract === MISSION_CONTEXT_CONTRACT && manifestDigest === historyDigest(receipt), 'mission_context_changed');
  const { binding } = manifest;
  const stamp = scopeVersion(source, binding);
  requireContext(stamp === manifest.scopeVersion, 'mission_context_scope_changed');
  const current = new Map<string, QuotedSource>();
  for (const citation of manifest.sources) {
    const key = sourceKey(citation.ref);
    const item = readSource(source, citation.ref, binding, citation.inclusion);
    requireContext(!current.has(key) && item && historyDigest(item.citation) === historyDigest(citation), 'mission_context_source_changed');
    current.set(key, item);
  }
  const deferred = new Set<string>();
  for (const proof of manifest.compaction?.deferred ?? []) {
    const key = sourceKey(proof.ref);
    const item = readSource(source, proof.ref, binding, 'relevant');
    requireContext(!current.has(key) && !deferred.has(key) && item && item.citation.version === proof.version &&
      item.citation.digest === proof.digest, 'mission_context_source_changed');
    deferred.add(key);
  }
  requireContext(scopeVersion(source, binding) === stamp, 'mission_context_scope_changed');
  return current;
}

/** Check current owning-service access and source integrity using only the durable receipt. */
export function validateMissionContextSources(manifest: MissionContextPackage['manifest'], source?: MissionContextSource): void {
  readReceiptSources(manifest, source);
}

/** Recheck with current scheduler inputs and owning services immediately before dispatch or accepting derived results. */
export function validateMissionContext(value: MissionContextPackage, current: MissionContextRequest, source?: MissionContextSource): void {
  const { binding, payload: requiredPayload, requiredRefs, requestDigest } = mandatory(current);
  const { manifest, payload } = value;
  const { sources, ...required } = payload;
  const payloadJson = JSON.stringify(payload);
  requireContext(value.contract === MISSION_CONTEXT_CONTRACT && manifest.requestDigest === requestDigest &&
    historyDigest(manifest.binding) === historyDigest(binding) && historyDigest(required) === historyDigest(requiredPayload) &&
    manifest.payloadDigest === digest(payloadJson) && historyDigest(manifest.sources) === historyDigest(sources.map(item => item.citation)), 'mission_context_changed');
  const currentSources = readReceiptSources(manifest, source);
  const pinned = new Map(requiredRefs.map(ref => [sourceKey(ref), ref]));
  for (const quoted of sources) {
    const ref = quoted.citation.ref, key = sourceKey(ref), requiredRef = pinned.get(key);
    const item = currentSources.get(key);
    requireContext(item && item.citation.inclusion === (requiredRef ? 'required' : 'relevant') &&
      (requiredRef?.expectedVersion === undefined || item.citation.version === requiredRef.expectedVersion) &&
      historyDigest(quoted) === historyDigest(item), 'mission_context_source_changed');
  }
  requireContext(requiredRefs.every(ref => currentSources.has(sourceKey(ref))), 'mission_context_required_source_unavailable');
  const counter = manifest.accounting.method === 'tokenizer' ? current.tokenCounter : undefined;
  let accounting: Accounting;
  try { accounting = measure(payloadJson, current.maxTokens, counter); }
  catch { throw new MissionContextError('mission_context_accounting_changed'); }
  requireContext(fits(accounting) && historyDigest(accounting) === historyDigest(manifest.accounting), 'mission_context_accounting_changed');
  requireContext(scopeVersion(source, binding) === manifest.scopeVersion, 'mission_context_scope_changed');
}

/** Use only Notes allowed by the owning host and the mission's canonical resource eligibility. Graph and
 * Personal Context adapters should use their narrower message/share and disclosure contracts respectively. */
export function canonicalMissionContextSource(
  host: Pick<VelaHostPort, 'scope' | 'search' | 'resolve' | 'readContent' | 'canReadContent'>,
  eligible: (binding: MissionContextBinding, resourceId: string) => boolean,
): MissionContextSource {
  function scoped(binding: MissionContextBinding) {
    const current = host.scope();
    if (!current.workspaceIds.includes(binding.scope.workspaceId) ||
        binding.scope.projectId !== null && !current.projectIds.includes(binding.scope.projectId)) return null;
    return current;
  }
  return {
    scopeVersion(binding) {
      const scope = scoped(binding);
      return scope ? historyDigest([scope.principalId, scope.policyVersion]) : null;
    },
    retrieve(binding, query) {
      const scope = scoped(binding);
      if (!scope) return [];
      const found = new Set<string>();
      for (const term of [...words(query)].slice(0, 8)) {
        for (const ref of host.search(term, scope, 8)) {
          if (ref.kind === 'resource' && ref.resourceKind === 'note' && eligible(binding, ref.id)) found.add(ref.id);
        }
      }
      return [...found].sort(compare).map(id => ({ kind: 'resource', id }));
    },
    read(ref, binding) {
      const scope = scoped(binding);
      if (!scope || ref.kind !== 'resource' || !scope.resourceIds.includes(ref.id) || !eligible(binding, ref.id)) return null;
      const resolved = host.resolve({ kind: 'resource', id: ref.id }, scope);
      if (!resolved || resolved.kind !== 'resource' || resolved.id !== ref.id || resolved.resourceKind !== 'note' ||
          (resolved.projectId ?? null) !== binding.scope.projectId || host.canReadContent?.(resolved, scope) !== true) return null;
      const item = host.readContent(ref.id, scope);
      if (!item || item.ref.kind !== resolved.kind || item.ref.id !== resolved.id || item.ref.version !== resolved.version) return null;
      return { ref: { ...ref }, version: item.ref.version, locator: item.source,
        scope: { kind: 'workspace', id: binding.scope.workspaceId }, certainty: 'unknown', content: item.content };
    },
  };
}
