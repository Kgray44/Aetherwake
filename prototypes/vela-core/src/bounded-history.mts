import { createHash } from 'node:crypto';
import { canonicalUserEvidence } from './voice-evidence.ts';
import { canonicalRetrievalQuery, HISTORY_RETRIEVAL_LIMITS, rankCanonicalRetrieval } from './history-retrieval.mts';
import type { ContextManifest, ProviderContribution, ProviderReplyKind, ResourceRef, VelaMessage, VelaRequest } from './contracts.ts';
import type { HistoryOrigin, HistoryResourceDependency, HistoryMessageDependency, HistoryDependency, HistoryProvenance, ProviderHistoryMessage, ProviderHistory, VelaHandoff } from './history-contracts.ts';
export type { HistoryOrigin, HistoryResourceDependency, HistoryMessageDependency, HistoryDependency, HistoryProvenance, ProviderHistoryMessage, ProviderHistory } from './history-contracts.ts';

/** Canonical history/proof primitives. Readers run in the caller's SAME canonical read transaction. */
export const HISTORY_LIMITS = Object.freeze({ maxMessages: 4, maxEncodedBytes: 4096, lookbackMessages: 12, maxDependencies: 64, maxValidationBytes: 131072 });
/** Metadata projection of an actual persisted request; no history/source content is copied into this projection. */
export interface HistoryRequestRecord extends Pick<VelaRequest, 'id' | 'conversationId' | 'state' | 'providerId'> {
  reviewedMemory?: true;
  taskId?: string;
  origin?: HistoryOrigin; inputMessageId?: string; inputContentDigest?: string;
  response?: { kind: ProviderReplyKind; messageId: string; contentDigest?: string };
  provenance?: HistoryProvenance;
  nativeSourceObservation?:NonNullable<VelaRequest['nativeSourceObservation']>;
  sourcePolicyVersion: string; sourceDependencies: readonly HistoryResourceDependency[];
}
export interface HistoryHeader { id: string; requestId?: string; role: VelaMessage['role']; source: VelaMessage['source']; ordinal: number; contentBytes: number }
export interface HistorySnapshot { conversationId: string; revision: number; headers: readonly HistoryHeader[]; hasEarlier: boolean;
  /** HOST ONLY: the current user query and canonical tail, never renderer-selected history IDs. */
  retrieval?: { query: string; tailOrdinal: number; partial: boolean; mode?: 'semantic-query' } }
export interface HistoryTail { conversationId: string; revision: number; ordinal: number }
export interface CanonicalHistoryMessage { conversationId: string; ordinal: number; message: VelaMessage }
/** Does not materialize or hash message bodies. The exact conversation revision fences body changes. */
export interface HistoryMessageMetadata extends Pick<VelaMessage, 'id' | 'requestId' | 'role' | 'source' | 'classification' | 'providerId' | 'responseKind' | 'providerContribution' | 'voice'> { conversationId: string; ordinal: number }
export interface HistoryMetadataReader {
  request(requestId: string): HistoryRequestRecord | null;
  message(conversationId: string, messageId: string): HistoryMessageMetadata | null;
  resolve(ref: Pick<ResourceRef, 'id' | 'kind'>): ResourceRef | null;
  canReadContent(ref: ResourceRef): boolean;
  verifyProviderContribution(contribution: ProviderContribution, message: HistoryMessageMetadata, request: HistoryRequestRecord): boolean;
  verifyNativeSourceObservation?(request:HistoryRequestRecord):boolean;
}
export interface HistoryReadLimit { overBudget: true }
export interface HistoryProofReader {
  /** These reads enforce current metadata/message/content permission before returning canonical values. */
  request(requestId: string): HistoryRequestRecord | null;
  message(conversationId: string, messageId: string, maxBytes: number): CanonicalHistoryMessage | HistoryReadLimit | null;
  resolve(ref: Pick<ResourceRef, 'id' | 'kind'>): ResourceRef | null;
  content(ref: ResourceRef, maxBytes: number): { ref: ResourceRef; source: string; content: string } | HistoryReadLimit | null;
  /** Actual canonical provider/execution evidence only; no provider invocation or model-written attribution. */
  verifyProviderContribution(contribution: ProviderContribution, message: VelaMessage, request: HistoryRequestRecord): boolean;
  verifyNativeSourceObservation?(request:HistoryRequestRecord):boolean;
}
export type HistoryOmissionReason = 'disabled' | 'no-conversation' | 'no-history' | 'unknown-origin' | 'scope-mismatch' | 'unproven-request'
  | 'non-conversational' | 'missing-pair' | 'message-unavailable' | 'message-changed' | 'provider-evidence' | 'upstream-unavailable'
  | 'upstream-changed' | 'incomplete-proof' | 'dependency-conflict' | 'proof-limit' | 'validation-limit' | 'history-byte-limit'
  | 'prompt-byte-limit' | 'message-limit' | 'lookback-limit' | 'ineligible-boundary';
/** HOST ONLY: never spread this diagnostic object into ProviderHistory/ContextManifest. */
export interface HistoryOmission { reason: HistoryOmissionReason; messageIds?: readonly string[]; requestId?: string; count?: number }
/** HOST ONLY: exact reviewed revision/proofs, bound by the native preview/grant separately from egress. */
export interface HistoryFence {
  schemaVersion: 1; conversationId: string; baseRevision: number; origin: HistoryOrigin;
  messages: readonly HistoryMessageDependency[]; dependencies: readonly HistoryDependency[]; historyDigest: string; digest: string;
  /** Explicit handoffs may select an exchange before the canonical tail. */
  baseTailOrdinal?: number;
}
export interface HistorySelection { history?: ProviderHistory; fence: HistoryFence | null; omissions: readonly HistoryOmission[]; validationBytes: number }
export interface AcceptedHistoryAppend { requestId: string; messageId: string; contentDigest: string; revision: number }
/** Core-only, non-serializable bridge from its actual approved private preview/grant. Never renderer input. */
export interface PrivateFrozenProviderContext {
  requestId?: string;
  context: Readonly<ContextManifest & { history?: ProviderHistory }>;
  historyFence?: HistoryFence;
  validate(phase: 'before-append' | 'before-provider' | 'before-response', acceptedAppend?: AcceptedHistoryAppend): void;
  /** Actual host metadata observed after ensure, before append; optional for older one-argument handlers. */
  onAcceptedAppend(value: AcceptedHistoryAppend, canonicalBase?: { conversationId: string; revision: number }): void;
}
export class HistorySelectionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\x00-\x1f]/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new HistorySelectionError(code); }
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
export const historyDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function validOrigin(origin: unknown): origin is HistoryOrigin {
  if (!record(origin) || !identifier(origin.principalId) || !identifier(origin.policyVersion) || !record(origin.navigation)) return false;
  const n = origin.navigation;
  return n.kind === 'unknown' || n.kind === 'known' && (n.projectId === null || identifier(n.projectId)) && (n.workspaceId === null || identifier(n.workspaceId));
}
function requireOrigin(origin: HistoryOrigin | undefined, current: HistoryOrigin) {
  requireValue(validOrigin(origin) && origin.navigation.kind === 'known' && current.navigation.kind === 'known', 'unknown-origin');
  requireValue(historyDigest(origin) === historyDigest(current), 'scope-mismatch');
}
function resourceRef(ref: ResourceRef): ResourceRef {
  requireValue(record(ref) && identifier(ref.id) && ['resource', 'project', 'workspace', 'collection'].includes(ref.kind) && integer(ref.version) && typeof ref.title === 'string' && ref.title.trim().length > 0 && ref.title.length <= 200 && (ref.resourceKind === undefined || identifier(ref.resourceKind)) && (ref.projectId === undefined || ref.projectId === null || identifier(ref.projectId)) && (ref.state === undefined || ref.state === 'active' || ref.state === 'archived'), 'unproven-request');
  const { id, kind, title, version, resourceKind, projectId, state } = ref;
  return { id, kind, title, version, ...(resourceKind === undefined ? {} : { resourceKind }), ...(projectId === undefined ? {} : { projectId }), ...(state === undefined ? {} : { state }) };
}
function dependencyKey(dep: HistoryDependency) { return dep.kind === 'resource' ? 'r:' + dep.ref.kind + ':' + dep.ref.id : 'm:' + dep.conversationId + ':' + dep.messageId; }
function normalizeDependency(dep: HistoryDependency): HistoryDependency {
  requireValue(record(dep), 'unproven-request');
  if (dep.kind === 'resource') {
    const ref = resourceRef(dep.ref);
    if (dep.content) requireValue(typeof dep.content.source === 'string' && dep.content.source.length <= 1000 && hash(dep.content.digest), 'unproven-request');
    return { kind: 'resource', ref, ...(dep.content ? { content: { source: dep.content.source, digest: dep.content.digest } } : {}) };
  }
  requireValue(dep.kind === 'message' && identifier(dep.conversationId) && identifier(dep.messageId) && identifier(dep.requestId) && integer(dep.ordinal) && hash(dep.contentDigest) && hash(dep.provenanceDigest), 'unproven-request');
  return { kind: 'message', conversationId: dep.conversationId, messageId: dep.messageId, requestId: dep.requestId, ordinal: dep.ordinal, contentDigest: dep.contentDigest, provenanceDigest: dep.provenanceDigest };
}
/** Metadata discovery and an authorized read of the same source combine into ONE conservative proof. */
export function unionHistoryDependencies(...sets: readonly (readonly HistoryDependency[])[]): HistoryDependency[] {
  const result = new Map<string, HistoryDependency>();
  for (const set of sets) { requireValue(Array.isArray(set) && set.length <= HISTORY_LIMITS.maxDependencies, 'proof-limit'); for (const value of set) {
    const next = normalizeDependency(value), key = dependencyKey(next), prior = result.get(key);
    if (prior && historyDigest(prior) !== historyDigest(next)) {
      requireValue(prior.kind === 'resource' && next.kind === 'resource' && historyDigest(prior.ref) === historyDigest(next.ref) && (!prior.content || !next.content), 'dependency-conflict');
      result.set(key, prior.content ? prior : next);
    } else result.set(key, next);
    requireValue(result.size <= HISTORY_LIMITS.maxDependencies, 'proof-limit');
  } }
  return [...result].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, value]) => value);
}
export function historyDependenciesFromContext(context: ContextManifest, conversationId: string): HistoryResourceDependency[] {
  const refs: HistoryResourceDependency[] = context.discovered.map(ref => ({ kind: 'resource', ref: resourceRef(ref) }));
  for (const entry of context.included) refs.push({ kind: 'resource', ref: resourceRef(entry), content: { source: entry.source, digest: entry.contentDigest } });
  requireValue(!refs.some(dep => dep.ref.kind === 'resource' && dep.ref.id === conversationId), 'unproven-request');
  return unionHistoryDependencies(refs) as HistoryResourceDependency[];
}
export function createHistoryProvenance(input: { requestId: string; conversationId: string; origin: HistoryOrigin; inputMessageId: string; inputContentDigest: string; dependencies: readonly HistoryDependency[] }): HistoryProvenance {
  requireValue(identifier(input.requestId) && identifier(input.conversationId) && identifier(input.inputMessageId) && hash(input.inputContentDigest) && validOrigin(input.origin), 'unproven-request');
  const dependencies = unionHistoryDependencies(input.dependencies);
  requireValue(!dependencies.some(dep => dep.kind === 'message' && (dep.requestId === input.requestId || dep.conversationId !== input.conversationId)), 'incomplete-proof');
  return { schemaVersion: 1, dependencies, digest: historyDigest({ schemaVersion: 1, requestId: input.requestId, conversationId: input.conversationId, origin: input.origin, inputMessageId: input.inputMessageId, inputContentDigest: input.inputContentDigest, dependencies }) };
}

function containsDependency(actual: HistoryDependency, expected: HistoryDependency): boolean {
  return historyDigest(actual) === historyDigest(expected) || actual.kind === 'resource' && expected.kind === 'resource' && !expected.content && historyDigest(actual.ref) === historyDigest(expected.ref);
}
const nativeObservation=(request:HistoryRequestRecord)=>request.providerId===null&&request.nativeSourceObservation?.kind==='folder-metadata';
function proveRequest(request: HistoryRequestRecord | null, id: string, origin: HistoryOrigin, conversationId: string, state: 'responded' | 'planning' = 'responded'): HistoryRequestRecord {
  requireValue(request && request.id === id, 'unproven-request'); requireOrigin(request.origin, origin);
  requireValue(state !== 'responded' || !request.reviewedMemory, 'non-conversational');
  requireValue(request.conversationId === conversationId && request.state === state && (identifier(request.providerId)||state==='responded'&&nativeObservation(request)) && identifier(request.inputMessageId) && hash(request.inputContentDigest) && request.provenance?.schemaVersion === 1 && request.sourcePolicyVersion === request.origin!.policyVersion, 'unproven-request');
  if(nativeObservation(request)){const observed=request.nativeSourceObservation!;requireValue(identifier(observed.resourceId)&&integer(observed.version)&&hash(observed.bindingDigest)&&hash(observed.sourceRevision)&&Number.isFinite(Date.parse(observed.observedAt))&&request.sourceDependencies.some(dep=>dep.kind==='resource'&&dep.ref.id===observed.resourceId&&dep.ref.version===observed.version&&dep.ref.resourceKind==='folder'),'unproven-request');}
  if (state === 'responded') requireValue(request.response && identifier(request.response.messageId) && hash(request.response.contentDigest) && ['answer', 'clarification', 'inability'].includes(request.response.kind), 'unproven-request');
  const proof = createHistoryProvenance({ requestId: id, conversationId, origin: request.origin!, inputMessageId: request.inputMessageId, inputContentDigest: request.inputContentDigest, dependencies: request.provenance.dependencies });
  requireValue(proof.digest === request.provenance.digest, 'unproven-request');
  const complete = new Map(proof.dependencies.map(dep => [dependencyKey(dep), dep]));
  for (const dep of unionHistoryDependencies(request.sourceDependencies)) requireValue(complete.has(dependencyKey(dep)) && containsDependency(complete.get(dependencyKey(dep))!, dep), 'incomplete-proof');
  return request;
}

class Verifier {
  readonly reader: HistoryProofReader; readonly origin: HistoryOrigin; readonly conversationId: string;
  bytes = 0;
  private records = new Map<string, CanonicalHistoryMessage>();
  private requests = new Map<string, HistoryRequestRecord>();
  private resources = new Set<string>();
  constructor(reader: HistoryProofReader, origin: HistoryOrigin, conversationId: string) { this.reader = reader; this.origin = origin; this.conversationId = conversationId; }
  request(id: string): HistoryRequestRecord {
    if (this.requests.has(id)) return this.requests.get(id)!;
    const request = proveRequest(this.reader.request(id), id, this.origin, this.conversationId);
    if(nativeObservation(request))requireValue(this.reader.verifyNativeSourceObservation?.(request)===true,'upstream-unavailable');
    this.requests.set(id, request); return request;
  }
  private contains(actual: HistoryDependency, expected: HistoryDependency): boolean {
    return containsDependency(actual, expected);
  }
  message(conversationId: string, messageId: string): CanonicalHistoryMessage {
    const key = conversationId + ':' + messageId; if (this.records.has(key)) return this.records.get(key)!;
    const remaining = HISTORY_LIMITS.maxValidationBytes - this.bytes; requireValue(remaining > 0, 'validation-limit');
    const value = this.reader.message(conversationId, messageId, remaining);
    requireValue(!value || !('overBudget' in value), 'validation-limit');
    requireValue(value && value.conversationId === conversationId && value.message.id === messageId && integer(value.ordinal) && typeof value.message.content === 'string', 'message-unavailable');
    const bytes = Buffer.byteLength(value.message.content, 'utf8'); requireValue(bytes <= remaining, 'validation-limit'); this.bytes += bytes;
    this.records.set(key, value); return value;
  }
  accepted(conversationId: string, messageId: string, request: HistoryRequestRecord): CanonicalHistoryMessage {
    requireValue(conversationId === this.conversationId, 'upstream-unavailable');
    const value = this.message(conversationId, messageId), message = value.message;
    requireValue(message.requestId === request.id, 'message-changed');
    if (messageId === request.inputMessageId) requireValue(message.role === 'user' && message.source === 'user' && canonicalUserEvidence(message) && historyDigest(message.content) === request.inputContentDigest, 'message-changed');
    else {
      requireValue(messageId === request.response?.messageId && message.role === 'assistant' && (nativeObservation(request)?message.source==='vela-native'&&message.classification==='observed'&&!message.providerId&&!message.providerContribution:message.source === 'provider' && message.classification === 'reported') && message.responseKind === request.response.kind && message.content.trim().length > 0 && message.content.length <= 16000 && historyDigest(message.content) === request.response.contentDigest, 'message-changed');
      if(nativeObservation(request))return value;
      const c = message.providerContribution;
      requireValue(c && c.classification === 'reported' && message.providerId === request.providerId && c.providerId === request.providerId && this.reader.verifyProviderContribution(c, message, request) === true, 'provider-evidence');
    }
    return value;
  }
  dependencies(values: readonly HistoryDependency[]) {
    const dependencies = unionHistoryDependencies(values), all = new Map(dependencies.map(dep => [dependencyKey(dep), dep]));
    // All flattened resource gates precede materializing ANY source-derived conversation body.
    for (const dep of [...dependencies.filter(dep => dep.kind === 'resource'), ...dependencies.filter(dep => dep.kind === 'message')]) {
      if (dep.kind === 'resource') {
        requireValue(!(dep.ref.kind === 'resource' && dep.ref.id === this.conversationId), 'incomplete-proof');
        const key = historyDigest(dep); if (this.resources.has(key)) continue;
        const current = this.reader.resolve(dep.ref); requireValue(current, 'upstream-unavailable');
        requireValue(historyDigest(resourceRef(current)) === historyDigest(dep.ref), 'upstream-changed');
        if (dep.content) {
          const remaining = HISTORY_LIMITS.maxValidationBytes - this.bytes; requireValue(remaining > 0, 'validation-limit');
          const content = this.reader.content(dep.ref, remaining); requireValue(content, 'upstream-unavailable'); requireValue(!('overBudget' in content), 'validation-limit');
          const bytes = Buffer.byteLength(content.content, 'utf8'); requireValue(bytes <= remaining, 'validation-limit'); this.bytes += bytes;
          requireValue(historyDigest(resourceRef(content.ref)) === historyDigest(dep.ref) && content.source === dep.content.source && historyDigest(content.content) === dep.content.digest, 'upstream-changed');
        }
        this.resources.add(key);
      } else {
        const request = this.request(dep.requestId), value = this.accepted(dep.conversationId, dep.messageId, request);
        requireValue(value.ordinal === dep.ordinal && historyDigest(value.message.content) === dep.contentDigest && request.provenance!.digest === dep.provenanceDigest, 'message-changed');
        for (const ancestor of request.provenance!.dependencies) requireValue(all.has(dependencyKey(ancestor)) && this.contains(all.get(dependencyKey(ancestor))!, ancestor), 'incomplete-proof');
      }
    }
  }
}
function messageProof(conversationId: string, value: CanonicalHistoryMessage, request: HistoryRequestRecord): HistoryMessageDependency {
  return { kind: 'message', conversationId, messageId: value.message.id, requestId: request.id, ordinal: value.ordinal, contentDigest: historyDigest(value.message.content), provenanceDigest: request.provenance!.digest };
}
const historyPayload = (messages: readonly ProviderHistoryMessage[]): ProviderHistory => ({ schemaVersion: 1, messages, coverage: 'bounded-authorized-whole-messages' });
function providerMessage(message: VelaMessage, requestId: string): ProviderHistoryMessage {
  return { id: message.id, requestId, role: message.role as 'user' | 'assistant', source: message.source as ProviderHistoryMessage['source'], ...(message.providerId ? { providerId: message.providerId } : {}), classification: message.classification as 'observed' | 'reported', content: message.content, contentDigest: historyDigest(message.content) };
}
function fenceBody(fence: Omit<HistoryFence, 'digest'>) { return { ...fence }; }
function validateFenceEnvelope(input: { fence: HistoryFence; origin: HistoryOrigin; current: { conversationId: string; revision: number }; acceptedAppend?: AcceptedHistoryAppend }) {
  const { fence, acceptedAppend: append } = input, { digest, ...body } = fence;
  requireValue(fence.schemaVersion === 1 && identifier(fence.conversationId) && integer(fence.baseRevision) && hash(digest) && hash(fence.historyDigest) && Array.isArray(fence.messages) && fence.messages.length > 0 && fence.messages.length <= HISTORY_LIMITS.maxMessages && fence.messages.length % 2 === 0 && Array.isArray(fence.dependencies) && fence.dependencies.length <= HISTORY_LIMITS.maxDependencies && historyDigest(fenceBody(body)) === digest, 'invalid-history-fence');
  requireOrigin(fence.origin, input.origin);
  requireValue(input.current.conversationId === fence.conversationId && input.current.revision === (append ? append.revision : fence.baseRevision), 'stale-history-revision');
  if (append) requireValue(append.revision === fence.baseRevision + 1 && identifier(append.requestId) && identifier(append.messageId) && hash(append.contentDigest) && !fence.dependencies.some(m => m.kind === 'message' && m.messageId === append.messageId), 'invalid-history-append');
  const declared = new Map(unionHistoryDependencies(fence.dependencies).map(dep => [dependencyKey(dep), historyDigest(dep)]));
  requireValue(fence.messages.every((proof, i) => proof.kind === 'message' && proof.conversationId === fence.conversationId && declared.get(dependencyKey(proof)) === historyDigest(proof) && (i === 0 || proof.ordinal > fence.messages[i - 1].ordinal)), 'incomplete-proof');
  if (fence.baseTailOrdinal !== undefined)
    requireValue(integer(fence.baseTailOrdinal) && fence.baseTailOrdinal >= fence.messages.at(-1)!.ordinal, 'invalid-history-fence');
}
const appendOrdinal = (fence: HistoryFence) => (fence.baseTailOrdinal ?? fence.messages.at(-1)!.ordinal) + 1;

/** Read-only catalog gate: checks canonical proof metadata and permission, NEVER bodies or a history payload. */
export function validateFrozenHistoryMetadata(input: {
  fence: HistoryFence; origin: HistoryOrigin; reader: HistoryMetadataReader;
  current: { conversationId: string; revision: number }; acceptedAppend?: AcceptedHistoryAppend;
}): { valid: true } {
  validateFenceEnvelope(input);
  const { fence, reader } = input, dependencies = unionHistoryDependencies(fence.dependencies), all = new Map(dependencies.map(dep => [dependencyKey(dep), dep]));
  const requests = new Map<string, HistoryRequestRecord>();
  const request = (id: string) => { let value = requests.get(id); if (!value) { value = proveRequest(reader.request(id), id, input.origin, fence.conversationId);if(nativeObservation(value))requireValue(reader.verifyNativeSourceObservation?.(value)===true,'upstream-unavailable'); requests.set(id, value); } return value; };
  // Permission and revision gates for the COMPLETE flattened source set precede inspecting derived message metadata.
  for (const dep of dependencies) if (dep.kind === 'resource') {
    requireValue(!(dep.ref.kind === 'resource' && dep.ref.id === fence.conversationId), 'incomplete-proof');
    const current = reader.resolve(dep.ref); requireValue(current, 'upstream-unavailable');
    requireValue(historyDigest(resourceRef(current)) === historyDigest(dep.ref), 'upstream-changed');
    if (dep.content) requireValue(reader.canReadContent(dep.ref) === true, 'upstream-unavailable');
  }
  for (const dep of dependencies) if (dep.kind === 'message') {
    requireValue(dep.conversationId === fence.conversationId, 'upstream-unavailable');
    const r = request(dep.requestId), m = reader.message(dep.conversationId, dep.messageId);
    requireValue(m && m.id === dep.messageId && m.conversationId === dep.conversationId && m.ordinal === dep.ordinal && m.requestId === r.id && r.provenance!.digest === dep.provenanceDigest, 'message-unavailable');
    if (m.id === r.inputMessageId) requireValue(m.role === 'user' && m.source === 'user' && canonicalUserEvidence(m) && r.inputContentDigest === dep.contentDigest, 'message-changed');
    else {
      requireValue(m.id === r.response!.messageId && m.role === 'assistant' && (nativeObservation(r)?m.source==='vela-native'&&m.classification==='observed'&&!m.providerId&&!m.providerContribution:m.source === 'provider' && m.classification === 'reported') && m.responseKind === r.response!.kind && r.response!.contentDigest === dep.contentDigest, 'message-changed');
      if(!nativeObservation(r)){const c = m.providerContribution; requireValue(c && c.classification === 'reported' && m.providerId === r.providerId && c.providerId === r.providerId && reader.verifyProviderContribution(c, m, r) === true, 'provider-evidence');}
    }
    for (const ancestor of r.provenance!.dependencies) requireValue(all.has(dependencyKey(ancestor)) && containsDependency(all.get(dependencyKey(ancestor))!, ancestor), 'incomplete-proof');
  }
  const append = input.acceptedAppend;
  if (append) {
    const r = proveRequest(reader.request(append.requestId), append.requestId, input.origin, fence.conversationId, 'planning'), m = reader.message(fence.conversationId, append.messageId);
    requireValue(m && m.id === append.messageId && m.conversationId === fence.conversationId && m.requestId === append.requestId && m.role === 'user' && m.source === 'user' && canonicalUserEvidence(m) && m.ordinal === appendOrdinal(fence) && r.inputMessageId === append.messageId && r.inputContentDigest === append.contentDigest, 'invalid-history-append');
    const declared = new Map(r.provenance!.dependencies.map(dep => [dependencyKey(dep), dep]));
    for (const dep of dependencies) requireValue(declared.has(dependencyKey(dep)) && containsDependency(declared.get(dependencyKey(dep))!, dep), 'incomplete-proof');
  }
  return { valid: true };
}
/** No callback may mutate or invoke a provider. fits() measures the entire actual frozen prompt, not raw content length. */
export function selectBoundedHistory(input: {
  enabled: boolean; origin: HistoryOrigin; snapshot: HistorySnapshot | null; reader: HistoryProofReader;
  fits(history: ProviderHistory | undefined): boolean;
  maxMessages?: number; maxEncodedBytes?: number;
}): HistorySelection {
  requireValue(validOrigin(input.origin) && typeof input.fits === 'function', 'invalid-history-input');
  const maxMessages = input.maxMessages ?? HISTORY_LIMITS.maxMessages, maxBytes = input.maxEncodedBytes ?? HISTORY_LIMITS.maxEncodedBytes;
  requireValue(Number.isSafeInteger(maxMessages) && maxMessages >= 0 && maxMessages <= HISTORY_LIMITS.maxMessages && Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= HISTORY_LIMITS.maxEncodedBytes, 'invalid-history-limits');
  requireValue(input.fits(undefined) === true, 'base-prompt-capacity');
  const empty = (reason: HistoryOmissionReason): HistorySelection => ({ fence: null, omissions: [{ reason }], validationBytes: 0 });
  if (!input.enabled) return empty('disabled'); if (!input.snapshot) return empty('no-conversation');
  const snapshot = input.snapshot, headers = snapshot.headers;
  requireValue(identifier(snapshot.conversationId) && integer(snapshot.revision) && Array.isArray(headers) && headers.length <= (snapshot.retrieval ? HISTORY_RETRIEVAL_LIMITS.maxMessages : HISTORY_LIMITS.lookbackMessages) && new Set(headers.map(h => h.id)).size === headers.length && headers.every((h, i) => identifier(h.id) && integer(h.ordinal) && Number.isSafeInteger(h.contentBytes) && h.contentBytes >= 0 && (!i || headers[i - 1].ordinal < h.ordinal)), 'invalid-history-snapshot');
  if (!headers.length) return empty('no-history'); if (input.origin.navigation.kind !== 'known') return empty('unknown-origin');
  if (snapshot.retrieval) return selectQueriedHistory({ ...input, snapshot, maxMessages, maxEncodedBytes: maxBytes });
  const verifier = new Verifier(input.reader, input.origin, snapshot.conversationId), omissions: HistoryOmission[] = [];
  let chosen: ProviderHistoryMessage[] = [], proofs: HistoryMessageDependency[] = [], dependencies: HistoryDependency[] = [];
  for (let index = headers.length - 1; index >= 0; index -= 2) {
    const last = headers[index], first = headers[index - 1], ids = first ? [first.id, last.id] : [last.id];
    if (chosen.length + 2 > maxMessages) { omissions.push({ reason: 'message-limit', count: index + 1 }); break; }
    try {
      requireValue(last.requestId && (last.source === 'provider'||last.source==='vela-native'&&input.reader.request(last.requestId)?.nativeSourceObservation?.kind==='folder-metadata') && last.role === 'assistant', 'non-conversational');
      const request = verifier.request(last.requestId);
      requireValue(first && request.inputMessageId === first.id && request.response!.messageId === last.id && first.requestId === last.requestId && first.role === 'user' && first.source === 'user', 'missing-pair');
      verifier.dependencies(request.provenance!.dependencies);
      const pair = [verifier.accepted(snapshot.conversationId, first.id, request), verifier.accepted(snapshot.conversationId, last.id, request)];
      requireValue(pair[0].ordinal === first.ordinal && pair[1].ordinal === last.ordinal && Buffer.byteLength(pair[0].message.content) === first.contentBytes && Buffer.byteLength(pair[1].message.content) === last.contentBytes, 'message-changed');
      const entries = pair.map(({ message }) => providerMessage(message, request.id));
      const next = historyPayload([...entries, ...chosen]), pairProofs = pair.map(value => messageProof(snapshot.conversationId, value, request));
      const nextDependencies = unionHistoryDependencies(dependencies, request.provenance!.dependencies, pairProofs);
      if (encodedBytes(next) > maxBytes) { omissions.push({ reason: 'history-byte-limit', messageIds: ids, requestId: request.id }); break; }
      if (!input.fits(next)) { omissions.push({ reason: 'prompt-byte-limit', messageIds: ids, requestId: request.id }); break; }
      chosen = [...entries, ...chosen]; proofs = [...pairProofs, ...proofs]; dependencies = nextDependencies;
    } catch (error) {
      const reason = error instanceof HistorySelectionError ? error.code as HistoryOmissionReason : 'upstream-unavailable';
      omissions.push({ reason, messageIds: ids, ...(last.requestId ? { requestId: last.requestId } : {}) });
      if (index > 1) omissions.push({ reason: 'ineligible-boundary', count: index - 1 }); break;
    }
  }
  if (snapshot.hasEarlier) omissions.push({ reason: 'lookback-limit' });
  if (!chosen.length) return { fence: null, omissions, validationBytes: verifier.bytes };
  const history = historyPayload(chosen), body: Omit<HistoryFence, 'digest'> = { schemaVersion: 1, conversationId: snapshot.conversationId, baseRevision: snapshot.revision, origin: structuredClone(input.origin), messages: proofs, dependencies, historyDigest: historyDigest(history) };
  return { history, fence: { ...body, digest: historyDigest(fenceBody(body)) }, omissions, validationBytes: verifier.bytes };
}

/** Exact eligible exchanges are proved before local ranking. Only the selected whole messages leave the host. */
function selectQueriedHistory(input: { origin: HistoryOrigin; snapshot: HistorySnapshot; reader: HistoryProofReader;
  fits(history: ProviderHistory | undefined): boolean; maxMessages: number; maxEncodedBytes: number }): HistorySelection {
  const { snapshot } = input, retrieval = snapshot.retrieval!, query = canonicalRetrievalQuery(retrieval.query, retrieval.mode !== 'semantic-query');
  requireValue(query && integer(retrieval.tailOrdinal) && retrieval.tailOrdinal >= snapshot.headers.at(-1)!.ordinal && typeof retrieval.partial === 'boolean', 'invalid-history-snapshot');
  const verifier = new Verifier(input.reader, input.origin, snapshot.conversationId), omissions: HistoryOmission[] = [];
  const pairs: { id: string; values: CanonicalHistoryMessage[]; entries: ProviderHistoryMessage[]; proofs: HistoryMessageDependency[]; dependencies: HistoryDependency[] }[] = [];
  for (let i = 1; i < snapshot.headers.length; i++) {
    const first = snapshot.headers[i - 1], last = snapshot.headers[i];
    if (first.role !== 'user' || last.role !== 'assistant' || !last.requestId || first.requestId !== last.requestId || last.ordinal !== first.ordinal + 1) continue;
    try {
      const request = verifier.request(last.requestId);
      requireValue(request.inputMessageId === first.id && request.response!.messageId === last.id, 'missing-pair');
      verifier.dependencies(request.provenance!.dependencies);
      const values = [verifier.accepted(snapshot.conversationId, first.id, request), verifier.accepted(snapshot.conversationId, last.id, request)];
      requireValue(values.every((value, j) => value.ordinal === [first, last][j].ordinal && Buffer.byteLength(value.message.content) === [first, last][j].contentBytes), 'message-changed');
      const proofs = values.map(value => messageProof(snapshot.conversationId, value, request));
      pairs.push({ id: request.id, values, entries: values.map(value => providerMessage(value.message, request.id)), proofs,
        dependencies: unionHistoryDependencies(request.provenance!.dependencies, proofs) });
    } catch (error) {
      const reason = error instanceof HistorySelectionError ? error.code as HistoryOmissionReason : 'upstream-unavailable';
      omissions.push({ reason, requestId: last.requestId, messageIds: [first.id, last.id] });
      if (reason === 'validation-limit') break;
    }
  }
  const ranked = rankCanonicalRetrieval(query, pairs.map(pair => ({ id: pair.id, text: pair.entries.map(entry => entry.content).join('\n'),
    identities: [pair.id, ...pair.entries.map(entry => entry.id)] })));
  const recent = [...pairs].sort((a, b) => b.values[1].ordinal - a.values[1].ordinal);
  const order = retrieval.mode === 'semantic-query' ? ranked.ids
    : [...new Set([...ranked.ids.slice(0, ranked.ambiguous ? 2 : 1), ...recent.map(pair => pair.id)])];
  let chosen: typeof pairs = [], dependencies: HistoryDependency[] = [];
  const payload = (selected: typeof pairs): ProviderHistory => ({ ...historyPayload(selected.flatMap(pair => pair.entries)), retrieval: {
    method: 'lexical-canonical-exchanges', queryDigest: query.digest, selectedRequestIds: selected.map(pair => pair.id),
    resolution: ranked.ids.length ? ranked.ambiguous ? 'ambiguous' : 'matched' : 'no-match', scannedMessages: snapshot.headers.length, partial: retrieval.partial } });
  for (const id of order) {
    if ((chosen.length + 1) * 2 > input.maxMessages) break;
    const pair = pairs.find(value => value.id === id)!;
    try {
      const next = [...chosen, pair].sort((a, b) => a.values[0].ordinal - b.values[0].ordinal), nextDependencies = unionHistoryDependencies(dependencies, pair.dependencies), history = payload(next);
      if (encodedBytes(history) > input.maxEncodedBytes) { omissions.push({ reason: 'history-byte-limit', requestId: id }); continue; }
      if (!input.fits(history)) { omissions.push({ reason: 'prompt-byte-limit', requestId: id }); continue; }
      chosen = next; dependencies = nextDependencies;
    } catch (error) { omissions.push({ reason: error instanceof HistorySelectionError ? error.code as HistoryOmissionReason : 'upstream-unavailable', requestId: id }); }
  }
  if (retrieval.partial) omissions.push({ reason: 'lookback-limit' });
  if (!chosen.length) return { fence: null, omissions, validationBytes: verifier.bytes };
  const history = payload(chosen), body: Omit<HistoryFence, 'digest'> = { schemaVersion: 1, conversationId: snapshot.conversationId,
    baseRevision: snapshot.revision, baseTailOrdinal: retrieval.tailOrdinal, origin: structuredClone(input.origin),
    messages: chosen.flatMap(pair => pair.proofs), dependencies, historyDigest: historyDigest(history) };
  return { history, fence: { ...body, digest: historyDigest(fenceBody(body)) }, omissions, validationBytes: verifier.bytes };
}

/** An explicit handoff selects one canonical exchange. No fallback or neighbor bodies. */
export function selectVelaHandoff(input: {
  requestId: string; destinationProviderId: string; origin: HistoryOrigin;
  purpose?: VelaHandoff['purpose'];
  tail: HistoryTail; reader: HistoryProofReader; fits(history: ProviderHistory): boolean;
}): { history: ProviderHistory; fence: HistoryFence; handoff: VelaHandoff } {
  const { requestId, destinationProviderId, origin, tail, reader } = input;
  requireValue(identifier(requestId) && identifier(destinationProviderId) && validOrigin(origin) &&
    identifier(tail.conversationId) && integer(tail.revision) && integer(tail.ordinal), 'invalid-history-input');
  const verifier = new Verifier(reader, origin, tail.conversationId);
  const request = verifier.request(requestId);
  requireValue(identifier(request.providerId),'non-conversational');
  requireValue(request.providerId !== destinationProviderId || input.purpose === 'reviewed-evidence', 'handoff-same-provider');
  requireValue(request.response?.kind === 'answer', 'non-conversational');
  verifier.dependencies(request.provenance!.dependencies);
  const user = verifier.accepted(tail.conversationId, request.inputMessageId!, request);
  const answer = verifier.accepted(tail.conversationId, request.response.messageId, request);
  requireValue(user.ordinal < answer.ordinal && answer.ordinal <= tail.ordinal, 'message-changed');
  const history = historyPayload([user, answer].map(value => providerMessage(value.message, requestId)));
  requireValue(encodedBytes(history) <= HISTORY_LIMITS.maxEncodedBytes && input.fits(history), 'handoff-context-limit');
  const messages = [user, answer].map(value => messageProof(tail.conversationId, value, request));
  const contextDigest = historyDigest(history);
  const body: Omit<HistoryFence, 'digest'> = { schemaVersion: 1, conversationId: tail.conversationId, baseRevision: tail.revision,
    baseTailOrdinal: tail.ordinal, origin: structuredClone(origin), messages,
    dependencies: unionHistoryDependencies(request.provenance!.dependencies, messages), historyDigest: contextDigest };
  return { history, fence: { ...body, digest: historyDigest(fenceBody(body)) },
    handoff: { ...(input.purpose ? { purpose: input.purpose } : {}), taskId: request.taskId ?? requestId,
      sourceRequestId: requestId, sourceMessageId: answer.message.id, sourceProviderId: request.providerId!,
      destinationProviderId, contextDigest } };
}

/** Revalidates an immutable window; it NEVER selects replacements or ignores an arbitrary latest message. */
export function validateFrozenHistory(input: {
  fence: HistoryFence; history: ProviderHistory; origin: HistoryOrigin; reader: HistoryProofReader;
  current: { conversationId: string; revision: number }; acceptedAppend?: AcceptedHistoryAppend;
}): { valid: true; validationBytes: number } {
  validateFenceEnvelope(input); const { fence, acceptedAppend: append } = input;
  requireValue(input.history.schemaVersion === 1 && input.history.coverage === 'bounded-authorized-whole-messages' && encodedBytes(input.history) <= HISTORY_LIMITS.maxEncodedBytes && historyDigest(input.history) === fence.historyDigest, 'invalid-history-fence');
  const verifier = new Verifier(input.reader, input.origin, fence.conversationId); verifier.dependencies(fence.dependencies);
  requireValue(input.history.messages.length === fence.messages.length, 'invalid-history-fence');
  for (const [index, proof] of fence.messages.entries()) {
    const request = verifier.request(proof.requestId), actual = verifier.accepted(proof.conversationId, proof.messageId, request), shown = input.history.messages[index];
    requireValue(proof.conversationId === fence.conversationId && actual.ordinal === proof.ordinal && shown.id === proof.messageId && shown.requestId === proof.requestId && historyDigest(shown.content) === proof.contentDigest && historyDigest(actual.message.content) === proof.contentDigest && historyDigest(shown) === historyDigest(providerMessage(actual.message, request.id)), 'message-changed');
  }
  if (append) {
    requireValue(append.revision === fence.baseRevision + 1 && identifier(append.requestId) && identifier(append.messageId) && hash(append.contentDigest) && !fence.messages.some(m => m.messageId === append.messageId), 'invalid-history-append');
    const appended = verifier.message(fence.conversationId, append.messageId), actual = appended.message;
    requireValue(appended.ordinal === appendOrdinal(fence), 'invalid-history-append');
    requireValue(actual.role === 'user' && actual.source === 'user' && canonicalUserEvidence(actual) && actual.requestId === append.requestId && historyDigest(actual.content) === append.contentDigest, 'invalid-history-append');
    const request = proveRequest(input.reader.request(append.requestId), append.requestId, input.origin, fence.conversationId, 'planning'); requireValue(request.inputMessageId === append.messageId && request.inputContentDigest === historyDigest(actual.content), 'invalid-history-append');
    const declared = new Map(request.provenance!.dependencies.map(dep => [dependencyKey(dep), dep]));
    for (const dep of fence.dependencies) requireValue(declared.has(dependencyKey(dep)) && containsDependency(declared.get(dependencyKey(dep))!, dep), 'incomplete-proof');
  }
  return { valid: true, validationBytes: verifier.bytes };
}
