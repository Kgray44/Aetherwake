import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PERSONAL_CONTEXT_CONTRACT } from './contracts.ts';
import type { ConversationSourceRef, ConversationSourceProof } from './contracts.ts';
import type { Category, Certainty, ContextItem, ContextRequest, FactDraft, OmissionReason, Operation, OriginalImport, OriginalInput, PersonalAuthorization, PersonalContextHost, PersonalContextManifest, PersonalCrypto, PersonalExport, PersonalPolicy, PersonalScope, PolicyPatch, Provenance, RecordRef, ReviewedFact, ScopeProof } from './contracts.ts';

export class PersonalContextError extends Error { readonly code: string; constructor(code: string) { super(code); this.name = 'PersonalContextError'; this.code = code; } }
const check: (value: unknown, code: string) => asserts value = (value, code) => { if (!value) throw new PersonalContextError(code); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\x00-\x1f]/.test(v);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encode = (v: unknown) => JSON.stringify(canonical(v));
const hash = (v: unknown) => createHash('sha256').update(encode(v)).digest('hex');
const bytes = (v: unknown) => Buffer.byteLength(encode(v), 'utf8');
const same = (a: unknown, b: unknown) => encode(a) === encode(b);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
const categories: Category[] = ['identity', 'preferences', 'projects', 'people', 'technical', 'decisions', 'temporary', 'conversation'];
const certainties: Certainty[] = ['explicit-statement', 'user-preference', 'imported-summary', 'historical-observation', 'inference', 'conflicting', 'unknown'];
const LIMITS = Object.freeze({ imports: 64, facts: 4096, revisions: 16384, revisionsPerRecord: 128, cipherBytes: 16 * 1024 * 1024, importBytes: 256 * 1024, factBytes: 16384, contextBytes: 65536, exportBytes: 2 * 1024 * 1024 });
export const PERSONAL_CONTEXT_LIMITS = LIMITS;
const defaultPolicy = (): PersonalPolicy => ({ version: 0, storageEnabled: false, ordinaryEnabled: false, velaEnabled: false, sharingEnabled: false, sensitiveEnabled: false });
type Stored = OriginalImport | ReviewedFact | PersonalPolicy;
type Kind = 'import' | 'fact' | 'policy';
interface Head { id: string; version: number; kind: Kind; scope: PersonalScope | null; state: string }
export interface PersonalContextServiceOptions {
  db: DatabaseSync;
  /** SAME canonical connection; boundary must roll back every module write. No database is opened here. */
  transaction<T>(work: (db: DatabaseSync) => T): T;
  readTransaction?<T>(work: (db: DatabaseSync) => T): T;
  host: PersonalContextHost; crypto: PersonalCrypto; now?: () => string;
}

function scope(value: unknown): asserts value is PersonalScope {
  check(record(value) && typeof value.kind === 'string' && ['user.shared', 'assistant.ordinary', 'assistant.vela', 'project', 'conversation'].includes(value.kind), 'invalid_scope');
  check(['project', 'conversation'].includes(String(value.kind)) ? exact(value, ['kind', 'id']) && id(value.id) : exact(value, ['kind']), 'invalid_scope');
}
function expiration(value: unknown) { check(value === null || typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid_expiration'); }
function original(input: unknown): asserts input is OriginalInput {
  check(record(input) && exact(input, ['source', 'kind', 'scope', 'text', 'sensitive', 'expiresAt']), 'invalid_import');
  scope(input.scope); expiration(input.expiresAt);
  check((input.source === 'user-paste' || input.source === 'user-export') && (input.kind === 'behavior' || input.kind === 'memories') && typeof input.sensitive === 'boolean' && typeof input.text === 'string' && input.text.length > 0 && bytes(input.text) <= LIMITS.importBytes, 'invalid_import');
  check(input.kind !== 'behavior' || ['assistant.ordinary', 'assistant.vela'].includes(input.scope.kind), 'behavior_scope_required');
}
function draft(input: unknown): asserts input is FactDraft {
  check(record(input) && exact(input, ['scope', 'purpose', 'category', 'text', 'keywords', 'certainty', 'sensitive', 'expiresAt', 'source']), 'invalid_fact');
  scope(input.scope); expiration(input.expiresAt);
  check((input.purpose === 'knowledge' || input.purpose === 'behavior') && categories.includes(input.category as Category) && certainties.includes(input.certainty as Certainty) && typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= 4096 && bytes(input.text) <= LIMITS.factBytes && typeof input.sensitive === 'boolean', 'invalid_fact');
  check(Array.isArray(input.keywords) && input.keywords.length > 0 && input.keywords.length <= 16 && input.keywords.every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 64) && new Set(input.keywords).size === input.keywords.length, 'invalid_keywords');
  check(input.purpose !== 'behavior' || input.scope.kind !== 'user.shared', 'shared_behavior_forbidden');
  const source = input.source; check(record(source), 'invalid_provenance');
  if (source.kind === 'conversation-message') {
    check(exact(source, ['kind', 'conversationId', 'messageId', 'version', 'contentDigest']) &&
      id(source.conversationId) && id(source.messageId) && id(source.version) && digest(source.contentDigest), 'invalid_provenance');
    return;
  }
  check(source.kind === 'user-statement' ? exact(source, ['kind']) : source.kind === 'import' && exact(source, ['kind', 'id', 'version', 'start', 'end']) && id(source.id) && Number.isSafeInteger(source.version) && Number(source.version) >= 1 && Number.isSafeInteger(source.start) && Number(source.start) >= 0 && Number.isSafeInteger(source.end) && Number(source.end) > Number(source.start), 'invalid_provenance');
}
function request(value: ContextRequest) {
  check(record(value) && Object.keys(value).every(k => ['requestId', 'assistant', 'providerId', 'query', 'projectId', 'conversationId', 'sharedFactIds', 'includeBehavior', 'maxBytes', 'maxItems', 'maxScan', 'sourceAnchors'].includes(k)) && id(value.requestId) && id(value.providerId) && (value.assistant === 'ordinary' || value.assistant === 'vela') && typeof value.query === 'string' && value.query.length <= 4000 && (value.projectId === null || id(value.projectId)) && (value.conversationId === null || id(value.conversationId)) && Array.isArray(value.sharedFactIds) && value.sharedFactIds.length <= 128 && value.sharedFactIds.every(id) && new Set(value.sharedFactIds).size === value.sharedFactIds.length && typeof value.includeBehavior === 'boolean', 'invalid_context_request');
  check(Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 1024 && value.maxBytes <= LIMITS.contextBytes && Number.isSafeInteger(value.maxItems) && value.maxItems >= 1 && value.maxItems <= 32 && (value.maxScan === undefined || Number.isSafeInteger(value.maxScan) && value.maxScan >= 1 && value.maxScan <= 512), 'invalid_context_budget');
  if (value.sourceAnchors !== undefined) {
    check(Array.isArray(value.sourceAnchors) && value.sourceAnchors.length <= 8 && value.sourceAnchors.every(anchor =>
      record(anchor) && exact(anchor, ['kind', 'conversationId', 'messageId']) && anchor.kind === 'conversation-message' &&
      id(anchor.conversationId) && id(anchor.messageId)), 'invalid_context_request');
    check(new Set(value.sourceAnchors.map(anchor => encode(anchor))).size === value.sourceAnchors.length, 'invalid_context_request');
  }
}
const words = (v: string) => new Set(v.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)?.filter(w => w.length >= 2).slice(0, 128) ?? []);

export class PersonalContextService {
  private opts: PersonalContextServiceOptions;
  constructor(options: PersonalContextServiceOptions) {
    this.opts = options;
    this.tx(() => {
      options.db.exec('CREATE TABLE IF NOT EXISTS personal_context_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
      const row = options.db.prepare('SELECT version FROM personal_context_schema WHERE id=1').get();
      check(!row || row.version === 1, 'unsupported_personal_context_schema');
      options.db.exec(`CREATE TABLE IF NOT EXISTS personal_context_heads(owner TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,scope TEXT,state TEXT NOT NULL,PRIMARY KEY(owner,id));
        CREATE TABLE IF NOT EXISTS personal_context_revisions(owner TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,scope TEXT,state TEXT NOT NULL,cipher BLOB NOT NULL,PRIMARY KEY(owner,id,version));
        CREATE TABLE IF NOT EXISTS personal_context_dependencies(owner TEXT NOT NULL,dependent TEXT NOT NULL,source TEXT NOT NULL,source_version INTEGER NOT NULL,PRIMARY KEY(owner,dependent,source,source_version));
        CREATE TABLE IF NOT EXISTS personal_context_conversation_sources(owner TEXT NOT NULL,conversation_id TEXT NOT NULL,message_id TEXT NOT NULL,dependent TEXT NOT NULL,PRIMARY KEY(owner,conversation_id,message_id,dependent));
        CREATE INDEX IF NOT EXISTS personal_context_conversation_sources_by_fact ON personal_context_conversation_sources(owner,dependent);`);
      if (!row) options.db.prepare('INSERT INTO personal_context_schema VALUES(1,1)').run();
    });
  }
  private tx<T>(work: () => T): T { return this.opts.transaction(db => { check(db === this.opts.db, 'canonical_database_connection_mismatch'); return work(); }); }
  private read<T>(work: () => T): T { return (this.opts.readTransaction ?? this.opts.transaction)(db => { check(db === this.opts.db, 'canonical_database_connection_mismatch'); return work(); }); }
  private now() { const value = this.opts.now?.() ?? new Date().toISOString(); check(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid_host_time'); return value; }
  private identity() { let value; try { value = this.opts.host.identity(); } catch { throw new PersonalContextError('invalid_host_identity'); } check(value && id(value.userId) && id(value.policyVersion), 'invalid_host_identity'); return value; }
  private crypto() { let available = false; try { available = this.opts.crypto.available() === true; } catch {} check(available, 'private_crypto_unavailable'); }
  private authorize(operation: Operation, scopeValue: PersonalScope | null, subject: RecordRef | null = null, extra: Partial<PersonalAuthorization> = {}) {
    const who = this.identity(); let result; try { result = this.opts.host.authorize({ ...structuredClone(extra), operation, ownerId: who.userId, scope: scopeValue, subject }); } catch { throw new PersonalContextError('personal_context_not_authorized'); }
    check(result?.decision === 'allow' && result.policyVersion === who.policyVersion && id(result.authorizationRef), 'personal_context_not_authorized'); return result.authorizationRef;
  }
  private proof(value: PersonalScope): ScopeProof {
    scope(value); let result; try { result = this.opts.host.resolveScope(structuredClone(value)); } catch { throw new PersonalContextError('canonical_scope_unavailable'); }
    check(result && same(result.scope, value) && id(result.version), 'canonical_scope_unavailable'); return structuredClone(result);
  }
  private head(idValue: string): Head | null {
    check(id(idValue), 'invalid_record_id'); const row = this.opts.db.prepare('SELECT id,kind,version,scope,state FROM personal_context_heads WHERE owner=? AND id=?').get(this.identity().userId, idValue);
    if (!row) return null;
    check(['import', 'fact', 'policy'].includes(String(row.kind)) && Number.isSafeInteger(row.version) && Number(row.version) >= 1, 'corrupt_personal_context');
    const value = row.scope === null ? null : JSON.parse(String(row.scope)); if (value !== null) scope(value);
    return { id: String(row.id), kind: row.kind as Kind, version: Number(row.version), scope: value, state: String(row.state) };
  }
  private ref(head: Head): RecordRef { check(head.scope && head.kind !== 'policy', 'invalid_record_kind'); return { id: head.id, kind: head.kind, version: head.version, scope: head.scope }; }
  private decode<T extends Stored>(head: Head, version = head.version): T {
    this.crypto(); const who = this.identity(), row = this.opts.db.prepare('SELECT scope,state,cipher FROM personal_context_revisions WHERE owner=? AND id=? AND version=?').get(who.userId, head.id, version); check(row && row.cipher instanceof Uint8Array, 'revision_unavailable');
    let envelope: any; try { const raw = this.opts.crypto.decrypt(new Uint8Array(row.cipher), this.purpose(who.userId, head.id, version)); check(raw instanceof Uint8Array && raw.length <= LIMITS.importBytes + 32768, 'invalid_ciphertext'); envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw new PersonalContextError('private_content_unavailable'); }
    check(envelope?.schemaVersion === 1 && envelope.owner === who.userId && envelope.id === head.id && envelope.kind === head.kind && envelope.version === version && record(envelope.value) && envelope.value.version === version, 'private_content_binding_mismatch');
    const value = envelope.value;
    if (head.kind === 'policy') check(exact(value, ['version', 'storageEnabled', 'ordinaryEnabled', 'velaEnabled', 'sharingEnabled', 'sensitiveEnabled']) && Object.entries(value).every(([key, item]) => key === 'version' || typeof item === 'boolean'), 'corrupt_personal_context');
    else {
      check(value.id === head.id && same(value.scope, JSON.parse(String(row.scope))) && value.state === row.state && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), 'private_content_binding_mismatch');
      if (version === head.version) check(same(value.scope, head.scope) && value.state === head.state, 'private_content_binding_mismatch');
      if (head.kind === 'import') { const { id: _id, version: _version, state: _state, createdAt: _created, updatedAt: _updated, contentDigest: _digest, ...fields } = value; original(fields); check(value.state === 'active' || value.state === 'revoked', 'corrupt_personal_context'); check(value.contentDigest === hash(value.text), 'corrupt_personal_context'); }
      else {
        const { id: _id, version: _version, state: _state, createdAt: _created, updatedAt: _updated, reviewedAt: _reviewed, reviewedBy: _by, provenance, supersededBy: _next, ...fields } = value;
        check(record(provenance), 'corrupt_personal_context');
        if (provenance.kind === 'conversation-message') draft({ ...fields, source: provenance });
        else {
          check(provenance.kind === 'user-statement' ? exact(provenance, ['kind']) :
            provenance.kind === 'import' && exact(provenance, ['kind', 'id', 'version', 'contentDigest', 'start', 'end']) && digest(provenance.contentDigest), 'corrupt_personal_context');
          const { contentDigest: _sourceDigest, ...source } = provenance;
          draft({ ...fields, source });
        }
        check(['active', 'revoked', 'superseded'].includes(value.state) && id(value.reviewedBy) && typeof value.reviewedAt === 'string' && Number.isFinite(Date.parse(value.reviewedAt)) && (value.supersededBy === null || id(value.supersededBy)), 'corrupt_personal_context');
      }
    }
    return envelope.value as T;
  }
  private purpose(owner: string, value: string, version: number) { return 'aerynth.personal-context/1:' + encode([owner, value, version]); }
  private put(kind: Kind, value: Stored, scopeValue: PersonalScope | null, state: string, expected: number) {
    this.crypto(); const owner = this.identity().userId, valueId = kind === 'policy' ? 'policy' : (value as OriginalImport | ReviewedFact).id, existing = this.head(valueId);
    check((existing?.version ?? 0) === expected && (!existing || existing.kind === kind) && value.version === expected + 1, 'stale_personal_context_version');
    const counts = this.opts.db.prepare('SELECT count(*) AS n,coalesce(sum(length(cipher)),0) AS bytes FROM personal_context_revisions').get()!;
    const ownCount = Number(this.opts.db.prepare('SELECT count(*) AS n FROM personal_context_revisions WHERE owner=? AND id=?').get(owner, valueId)!.n);
    check(Number(counts.n) < LIMITS.revisions && ownCount < LIMITS.revisionsPerRecord, 'personal_context_capacity_reached');
    if (!existing && kind !== 'policy') check(Number(this.opts.db.prepare('SELECT count(*) AS n FROM personal_context_heads WHERE owner=? AND kind=?').get(owner, kind)!.n) < (kind === 'import' ? LIMITS.imports : LIMITS.facts), 'personal_context_capacity_reached');
    let cipher: Uint8Array; try { cipher = this.opts.crypto.encrypt(new TextEncoder().encode(encode({ schemaVersion: 1, owner, id: valueId, kind, version: value.version, value })), this.purpose(owner, valueId, value.version)); } catch { throw new PersonalContextError('private_encryption_failed'); }
    check(cipher instanceof Uint8Array && cipher.length > 0 && cipher.length <= LIMITS.importBytes + 65536 && Number(counts.bytes) + cipher.length <= LIMITS.cipherBytes, 'personal_context_capacity_reached');
    this.opts.db.prepare('INSERT INTO personal_context_revisions VALUES(?,?,?,?,?,?)').run(owner, valueId, value.version, scopeValue ? encode(scopeValue) : null, state, cipher);
    this.opts.db.prepare('INSERT INTO personal_context_heads VALUES(?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET version=excluded.version,scope=excluded.scope,state=excluded.state').run(owner, valueId, kind, value.version, scopeValue ? encode(scopeValue) : null, state);
    if (kind === 'fact') {
      const provenance = (value as ReviewedFact).provenance;
      if (provenance.kind === 'import')
        this.opts.db.prepare('INSERT OR IGNORE INTO personal_context_dependencies VALUES(?,?,?,?)').run(owner, valueId, provenance.id, provenance.version);
      if (provenance.kind === 'conversation-message')
        this.opts.db.prepare('INSERT OR IGNORE INTO personal_context_conversation_sources VALUES(?,?,?,?)').run(owner, provenance.conversationId, provenance.messageId, valueId);
    }
  }
  private policyValue(): PersonalPolicy { const head = this.head('policy'); return head ? this.decode<PersonalPolicy>(head) : defaultPolicy(); }
  policy(): PersonalPolicy { return this.read(() => { this.authorize('policy.read', null); return this.policyValue(); }); }
  setPolicy(input: { expectedVersion: number; patch: PolicyPatch }): PersonalPolicy {
    check(record(input) && exact(input, ['expectedVersion', 'patch']) && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0 && record(input.patch) && Object.keys(input.patch).length > 0 && Object.entries(input.patch).every(([k, v]) => ['storageEnabled', 'ordinaryEnabled', 'velaEnabled', 'sharingEnabled', 'sensitiveEnabled'].includes(k) && typeof v === 'boolean'), 'invalid_privacy_policy');
    return this.tx(() => { this.authorize('policy.write', null); const current = this.policyValue(); check(current.version === input.expectedVersion, 'stale_personal_context_version'); const value = { ...current, ...input.patch, version: current.version + 1 }; this.put('policy', value, null, 'active', current.version); return value; });
  }
  private storage(sensitive: boolean) { const policy = this.policyValue(); check(policy.storageEnabled && (!sensitive || policy.sensitiveEnabled), 'personal_storage_disabled'); }
  importOriginal(input: OriginalInput): OriginalImport {
    original(input); return this.tx(() => { this.storage(input.sensitive); this.proof(input.scope); this.authorize('import.write', input.scope); const now = this.now(), value: OriginalImport = { ...structuredClone(input), id: randomUUID(), version: 1, state: 'active', createdAt: now, updatedAt: now, contentDigest: hash(input.text) }; this.put('import', value, value.scope, value.state, 0); return value; });
  }
  editImport(input: { id: string; expectedVersion: number; replacement: OriginalInput }): OriginalImport {
    original(input.replacement); return this.tx(() => { const head = this.required(input.id, 'import', input.expectedVersion), old = this.readable<OriginalImport>(head); this.storage(input.replacement.sensitive); this.proof(input.replacement.scope); this.authorize('import.write', input.replacement.scope, this.ref(head)); const value: OriginalImport = { ...structuredClone(input.replacement), id: old.id, version: old.version + 1, state: 'active', createdAt: old.createdAt, updatedAt: this.now(), contentDigest: hash(input.replacement.text) }; this.put('import', value, value.scope, value.state, old.version); return value; });
  }
  private required(idValue: string, kind: 'import' | 'fact', expected?: number): Head { const head = this.head(idValue); check(head && head.kind === kind, 'personal_record_unavailable'); if (expected !== undefined) check(Number.isSafeInteger(expected) && expected === head.version, 'stale_personal_context_version'); return head; }
  private revision(head: Head, version: number): Head {
    check(Number.isSafeInteger(version) && version >= 1 && version <= head.version, 'revision_unavailable');
    const row = this.opts.db.prepare('SELECT scope,state FROM personal_context_revisions WHERE owner=? AND id=? AND version=?').get(this.identity().userId, head.id, version); check(row, 'revision_unavailable');
    return { ...head, version, scope: row.scope === null ? null : JSON.parse(String(row.scope)), state: String(row.state) };
  }
  private readable<T extends Stored>(head: Head, version = head.version): T { const ref = this.revision(head, version); check(ref.scope, 'invalid_record_kind'); this.proof(ref.scope); this.authorize('record.read', ref.scope, this.ref(ref)); return this.decode<T>(ref); }
  readImport(idValue: string, version?: number): OriginalImport { return this.read(() => this.readable<OriginalImport>(this.required(idValue, 'import'), version)); }
  readFact(idValue: string, version?: number): ReviewedFact {
    return this.read(() => {
      const value = this.readable<ReviewedFact>(this.required(idValue, 'fact'), version);
      this.requireCurrentConversationSource(value);
      return value;
    });
  }
  /** Owner's inspectable metadata index, including retained revoked records. No private body decryption. */
  describeFact(idValue: string): RecordRef & { state: string } {
    return this.read(() => {
      const head = this.required(idValue, 'fact');
      const ref = this.ref(head);
      this.authorize('record.list', ref.scope, ref);
      return { ...ref, state: head.state };
    });
  }
  list(input: { kind: 'import' | 'fact'; after: string | null; limit: number }): { records: (RecordRef & { state: string })[]; next: string | null } {
    check(record(input) && exact(input, ['kind', 'after', 'limit']) && (input.kind === 'import' || input.kind === 'fact') && (input.after === null || id(input.after)) && Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100, 'invalid_record_list');
    return this.read(() => { const rows = this.opts.db.prepare('SELECT id FROM personal_context_heads WHERE owner=? AND kind=? AND id>? ORDER BY id LIMIT ?').all(this.identity().userId, input.kind, input.after ?? '', input.limit + 1), records: (RecordRef & { state: string })[] = [];
      for (const row of rows.slice(0, input.limit)) { const head = this.required(String(row.id), input.kind); try { this.authorize('record.list', head.scope, this.ref(head)); records.push({ ...this.ref(head), state: head.state }); } catch (error) { if (!(error instanceof PersonalContextError && error.code === 'personal_context_not_authorized')) throw error; } }
      return { records, next: rows.length > input.limit ? String(rows[input.limit - 1].id) : null }; });
  }
  private conversationSource(reference: ConversationSourceRef): ConversationSourceProof | null {
    const { conversationId, messageId } = reference;
    let source;
    try {
      source = this.opts.host.resolveConversationSource?.({ kind: 'conversation-message', conversationId, messageId });
    } catch {
      return null;
    }
    return source?.conversationId === conversationId && source.messageId === messageId &&
      source.role === 'user' && id(source.version) && digest(source.contentDigest) &&
      (source.projectId === null || id(source.projectId)) && typeof source.sensitive === 'boolean' ? source : null;
  }
  private sourceScopeMatches(scopeValue: PersonalScope, source: ConversationSourceProof, category: Category): boolean {
    return (scopeValue.kind === 'conversation' && scopeValue.id === source.conversationId) ||
      (scopeValue.kind === 'project' && scopeValue.id === source.projectId) ||
      (scopeValue.kind === 'assistant.ordinary' && source.projectId === null && category === 'preferences');
  }
  private currentConversationSource(value: ReviewedFact): ConversationSourceProof | null {
    const provenance = value.provenance;
    if (provenance.kind !== 'conversation-message') return null;
    const source = this.conversationSource(provenance);
    return source && source.version === provenance.version && source.contentDigest === provenance.contentDigest &&
      this.sourceScopeMatches(value.scope, source, value.category) && (!source.sensitive || value.sensitive) ? source : null;
  }
  private requireCurrentConversationSource(value: ReviewedFact): void {
    if (value.provenance.kind === 'conversation-message')
      check(this.currentConversationSource(value), 'conversation_source_unavailable');
  }
  private provenance(input: FactDraft): Provenance {
    if (input.source.kind === 'user-statement') return { kind: 'user-statement' };
    if (input.source.kind === 'conversation-message') {
      const source = this.conversationSource(input.source);
      check(source, 'conversation_source_unavailable');
      check(source.version === input.source.version && source.contentDigest === input.source.contentDigest, 'stale_conversation_source');
      check(input.purpose === 'knowledge' && this.sourceScopeMatches(input.scope, source, input.category), 'conversation_source_scope_mismatch');
      check(!source.sensitive || input.sensitive, 'sensitive_source_requires_sensitive_fact');
      return structuredClone(input.source);
    }
    const head = this.required(input.source.id, 'import', input.source.version), source = this.readable<OriginalImport>(head);
    check(source.state === 'active' && (!source.expiresAt || Date.parse(source.expiresAt) > Date.parse(this.now())) && input.source.end <= source.text.length, 'import_source_unavailable');
    check(!source.sensitive || input.sensitive, 'sensitive_source_requires_sensitive_fact');
    // A behavioral import is a profile, never a route to smuggle its personality into another assistant.
    check(source.kind !== 'behavior' || input.purpose === 'behavior' && same(source.scope, input.scope), 'behavior_profile_isolation');
    return { kind: 'import', id: source.id, version: source.version, contentDigest: source.contentDigest, start: input.source.start, end: input.source.end };
  }
  private reviewed(input: FactDraft, previous?: ReviewedFact): ReviewedFact {
    this.storage(input.sensitive); this.proof(input.scope); this.authorize('fact.review', input.scope, previous ? { id: previous.id, version: previous.version, kind: 'fact', scope: previous.scope } : null);
    const provenance = this.provenance(input), now = this.now(); const { source: _source, ...fields } = structuredClone(input);
    return { ...fields, id: previous?.id ?? randomUUID(), version: previous ? previous.version + 1 : 1, state: 'active', createdAt: previous?.createdAt ?? now, updatedAt: now, reviewedAt: now, reviewedBy: this.identity().userId, provenance, supersededBy: null };
  }
  reviewFact(input: FactDraft): ReviewedFact { draft(input); return this.tx(() => { const value = this.reviewed(input); this.put('fact', value, value.scope, value.state, 0); return value; }); }
  editFact(input: { id: string; expectedVersion: number; replacement: FactDraft }): ReviewedFact {
    draft(input.replacement); return this.tx(() => { const head = this.required(input.id, 'fact', input.expectedVersion), old = this.readable<ReviewedFact>(head), value = this.reviewed(input.replacement, old); this.put('fact', value, value.scope, value.state, old.version); return value; });
  }
  correctFact(input: { id: string; expectedVersion: number; replacement: FactDraft }): { previous: ReviewedFact; replacement: ReviewedFact } {
    draft(input.replacement); return this.tx(() => { const head = this.required(input.id, 'fact', input.expectedVersion), old = this.readable<ReviewedFact>(head); this.requireCurrentConversationSource(old); this.authorize('fact.review', old.scope, this.ref(head)); const replacement = this.reviewed(input.replacement), previous: ReviewedFact = { ...old, version: old.version + 1, state: 'superseded', supersededBy: replacement.id, updatedAt: this.now() }; this.put('fact', replacement, replacement.scope, replacement.state, 0); this.put('fact', previous, previous.scope, previous.state, old.version); return { previous, replacement }; });
  }
  revoke(input: { id: string; expectedVersion: number }): RecordRef {
    return this.tx(() => { const head = this.head(input.id); check(head && head.kind !== 'policy' && head.version === input.expectedVersion, 'stale_personal_context_version'); this.authorize('record.revoke', head.scope, this.ref(head)); const old = this.decode<OriginalImport | ReviewedFact>(head), value = { ...old, version: old.version + 1, state: 'revoked' as const, updatedAt: this.now() }; this.put(head.kind, value, value.scope, value.state, old.version); return { ...this.ref(head), version: value.version }; });
  }
  /** Deletes all encrypted revisions and dependent fact revisions. Not physical erasure of WAL/backups. */
  hardDelete(input: { id: string; expectedVersion: number }): { deleted: RecordRef[] } {
    return this.tx(() => { const owner = this.identity().userId, head = this.head(input.id); check(head && head.kind !== 'policy' && head.version === input.expectedVersion, 'stale_personal_context_version');
      const dependents = this.opts.db.prepare('SELECT DISTINCT dependent FROM personal_context_dependencies WHERE owner=? AND source=?').all(owner, head.id).map(row => this.head(String(row.dependent))).filter((value): value is Head => !!value);
      return this.deleteHeads(owner, [head, ...dependents]); });
  }
  /** Invoked by the canonical owner for an explicitly authorized source
   * erasure. Can join the source owner's transaction without decrypting data. */
  eraseConversationSource(source: ConversationSourceRef): { deleted: RecordRef[] } {
    check(record(source) && exact(source, ['kind', 'conversationId', 'messageId']) &&
      source.kind === 'conversation-message' && id(source.conversationId) && id(source.messageId), 'invalid_provenance');
    return this.tx(() => {
      const owner = this.identity().userId;
      this.authorize('source.erase', null, null, { conversationSource: source });
      const rows = this.opts.db.prepare('SELECT dependent FROM personal_context_conversation_sources WHERE owner=? AND conversation_id=? AND message_id=? ORDER BY dependent')
        .all(owner, source.conversationId, source.messageId);
      const heads = rows.map(row => this.required(String(row.dependent), 'fact'));
      return this.deleteHeads(owner, heads, source);
    });
  }
  private deleteHeads(owner: string, heads: Head[], conversationSource?: ConversationSourceRef): { deleted: RecordRef[] } {
    const references = heads.map(value => this.ref(value));
    for (const reference of references)
      this.authorize('record.delete', reference.scope, reference, conversationSource ? { conversationSource } : { references });
    for (const value of heads) {
      this.opts.db.prepare('DELETE FROM personal_context_revisions WHERE owner=? AND id=?').run(owner, value.id);
      this.opts.db.prepare('DELETE FROM personal_context_dependencies WHERE owner=? AND (dependent=? OR source=?)').run(owner, value.id, value.id);
      this.opts.db.prepare('DELETE FROM personal_context_conversation_sources WHERE owner=? AND dependent=?').run(owner, value.id);
      this.opts.db.prepare('DELETE FROM personal_context_heads WHERE owner=? AND id=?').run(owner, value.id);
    }
    return { deleted: references };
  }
  export(input: { ids: string[]; maxBytes: number }): PersonalExport {
    check(record(input) && exact(input, ['ids', 'maxBytes']) && Array.isArray(input.ids) && input.ids.length <= 128 && input.ids.every(id) && new Set(input.ids).size === input.ids.length && Number.isSafeInteger(input.maxBytes) && input.maxBytes >= 1 && input.maxBytes <= LIMITS.exportBytes, 'invalid_export');
    return this.read(() => { const value: PersonalExport = { contract: PERSONAL_CONTEXT_CONTRACT, ownerId: this.identity().userId, exportedAt: this.now(), records: [] };
      for (const idValue of input.ids) {
        const head = this.head(idValue);
        check(head && head.kind !== 'policy', 'personal_record_unavailable');
        const revisions: (OriginalImport | ReviewedFact)[] = [];
        value.records.push({ kind: head.kind, revisions });
        for (let version = 1; version <= head.version; version++) {
          const ref = this.revision(head, version);
          check(ref.scope, 'invalid_record_kind');
          this.proof(ref.scope);
          this.authorize('record.export', ref.scope, this.ref(ref));
          const revision = this.decode<OriginalImport | ReviewedFact>(ref);
          if ('provenance' in revision) this.requireCurrentConversationSource(revision);
          revisions.push(revision);
          check(bytes(value) <= input.maxBytes, 'export_budget_exceeded');
        }
      }
      return value; });
  }
  private inScope(value: PersonalScope, input: ContextRequest) { return value.kind === 'assistant.' + input.assistant || value.kind === 'user.shared' || value.kind === 'project' && value.id === input.projectId || value.kind === 'conversation' && value.id === input.conversationId; }
  private item(value: ReviewedFact): ContextItem { return { factId: value.id, version: value.version, scope: value.scope, purpose: value.purpose, category: value.category, text: value.text, certainty: value.certainty, provenance: value.provenance, reviewedAt: value.reviewedAt }; }
  private usable(value: ReviewedFact, head: Head, input: ContextRequest, policy: PersonalPolicy, sourceCache = new Map<string, OriginalImport>()): OmissionReason | null {
    if (head.state !== 'active' || value.state !== 'active') return 'inactive';
    if (value.expiresAt && Date.parse(value.expiresAt) <= Date.parse(this.now())) return 'expired';
    if (value.sensitive && !policy.sensitiveEnabled) return 'sensitive-disabled';
    if (!this.inScope(value.scope, input)) return 'outside-scope';
    if (value.scope.kind === 'user.shared' && (!policy.sharingEnabled || !input.sharedFactIds.includes(value.id))) return 'not-shared';
    if (value.purpose === 'behavior' && (!input.includeBehavior || value.scope.kind === 'user.shared')) return 'irrelevant';
    if (value.provenance.kind === 'conversation-message') {
      const source = this.currentConversationSource(value);
      if (!source || (source.sensitive && !policy.sensitiveEnabled)) return 'source-changed';
    }
    if (value.provenance.kind === 'import') {
      const source = this.head(value.provenance.id); if (!source || source.kind !== 'import' || source.state !== 'active' || source.version !== value.provenance.version) return 'source-changed';
      this.proof(source.scope!); this.authorize('record.read', source.scope, this.ref(source));
      let original = sourceCache.get(source.id); if (!original || original.version !== source.version) { original = this.decode<OriginalImport>(source); sourceCache.set(source.id, original); } if (original.contentDigest !== value.provenance.contentDigest || original.expiresAt && Date.parse(original.expiresAt) <= Date.parse(this.now()) || original.sensitive && !policy.sensitiveEnabled) return 'source-changed';
      if (original.kind === 'behavior' && (value.purpose !== 'behavior' || !same(original.scope, value.scope))) return 'source-changed';
    }
    return null;
  }
  private seal(value: Omit<PersonalContextManifest, 'encodedBytes' | 'digest'>): PersonalContextManifest {
    const signed = { ...value, encodedBytes: 0, digest: '' }; let previous = -1;
    while (signed.encodedBytes !== previous) { previous = signed.encodedBytes; signed.encodedBytes = bytes({ ...signed, digest: '0'.repeat(64) }); }
    const { id: _id, createdAt: _time, digest: _digest, ...body } = signed; signed.digest = hash(body); return signed;
  }
  private requestProofs(input: ContextRequest): ScopeProof[] {
    return [{ kind: 'assistant.' + input.assistant } as PersonalScope, ...(input.projectId ? [{ kind: 'project' as const, id: input.projectId }] : []), ...(input.conversationId ? [{ kind: 'conversation' as const, id: input.conversationId }] : [])].map(value => this.proof(value));
  }
  private sourceCandidates(input: ContextRequest, ownerId: string): Set<string> {
    const ids = new Set<string>();
    if (!input.sourceAnchors?.length) return ids;
    const lookup = this.opts.db.prepare('SELECT dependent FROM personal_context_conversation_sources WHERE owner=? AND conversation_id=? AND message_id=?');
    for (const anchor of input.sourceAnchors) {
      if (!this.conversationSource(anchor)) continue;
      for (const row of lookup.all(ownerId, anchor.conversationId, anchor.messageId)) ids.add(String(row.dependent));
    }
    return ids;
  }
  previewContext(input: ContextRequest): PersonalContextManifest {
    request(input); return this.read(() => {
      this.authorize('context.preview', null, null, { request: input }); const who = this.identity(), policy = this.policyValue(), scopes = this.requestProofs(input), omissions = new Map<OmissionReason, number>(), items: ContextItem[] = [];
      const omit = (reason: OmissionReason, count = 1) => omissions.set(reason, (omissions.get(reason) ?? 0) + count);
      const base = (reasons = omissions) => this.seal({ contract: PERSONAL_CONTEXT_CONTRACT, id: manifestId, createdAt: created, ownerId: who.userId, hostPolicyVersion: who.policyVersion, policyVersion: policy.version, requestDigest: hash(input), trust: 'untrusted-personalization-data', scopes, items, omissions: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => a.reason.localeCompare(b.reason)) });
      const manifestId = randomUUID(), created = this.now();
      if (!(input.assistant === 'ordinary' ? policy.ordinaryEnabled : policy.velaEnabled)) { omit('disabled'); const result = base(); check(result.encodedBytes <= input.maxBytes, 'context_budget_too_small'); return result; }
      const heads = this.opts.db.prepare("SELECT id FROM personal_context_heads WHERE owner=? AND kind='fact' ORDER BY id LIMIT ?").all(who.userId, LIMITS.facts + 1); check(heads.length <= LIMITS.facts, 'personal_context_capacity_reached');
      const anchors = this.sourceCandidates(input, who.userId);
      if (anchors.size) heads.sort((a, b) => Number(anchors.has(String(b.id))) - Number(anchors.has(String(a.id))));
      const query = words(input.query), candidates: { value: ReviewedFact; score: number; anchored: boolean; proofs: ScopeProof[] }[] = [], sourceCache = new Map<string, OriginalImport>(); let scanned = 0;
      for (const row of heads) {
        const head = this.required(String(row.id), 'fact');
        if (!this.inScope(head.scope!, input)) { omit('outside-scope'); continue; }
        if (head.scope!.kind === 'user.shared' && (!policy.sharingEnabled || !input.sharedFactIds.includes(head.id))) { omit('not-shared'); continue; }
        if (head.state !== 'active') { omit('inactive'); continue; }
        if (scanned >= (input.maxScan ?? 128)) { omit('scan-limit'); continue; } scanned++;
        try {
          const proof = this.proof(head.scope!); this.authorize('record.read', head.scope, this.ref(head)); const value = this.decode<ReviewedFact>(head), reason = this.usable(value, head, input, policy, sourceCache); if (reason) { omit(reason); continue; }
          const score = value.purpose === 'behavior' ? 1000 : value.keywords.reduce((sum, key) => sum + [...words(key)].filter(word => query.has(word)).length, 0);
          const provenance = value.provenance;
          const anchored = anchors.has(value.id) && provenance.kind === 'conversation-message' && input.sourceAnchors!.some(anchor =>
            anchor.conversationId === provenance.conversationId && anchor.messageId === provenance.messageId);
          if (!score && !anchored) { omit('irrelevant'); continue; }
          const proofs = [proof]; if (provenance.kind === 'import') proofs.push(this.proof(this.head(provenance.id)!.scope!));
          candidates.push({ value, score, anchored, proofs });
        } catch (error) { if (error instanceof PersonalContextError && ['canonical_scope_unavailable', 'personal_context_not_authorized', 'private_content_unavailable'].includes(error.code)) { omit('unavailable'); continue; } throw error; }
      }
      // Reserve the bounded omission envelope before packing WHOLE reviewed facts; no text truncation.
      candidates.sort((a, b) => Number(b.anchored) - Number(a.anchored) || b.score - a.score || a.value.id.localeCompare(b.value.id));
      for (const candidate of candidates) {
        if (items.length >= input.maxItems) { omit('item-budget'); continue; }
        const oldScopes = scopes.length; for (const proof of candidate.proofs) if (!scopes.some(value => same(value, proof))) scopes.push(proof);
        items.push(this.item(candidate.value));
        const reserved = new Map(omissions); reserved.set('byte-budget', candidates.length); reserved.set('item-budget', candidates.length);
        if (base(reserved).encodedBytes > input.maxBytes) { items.pop(); scopes.splice(oldScopes); omit('byte-budget'); }
      }
      const result = base(); check(result.encodedBytes <= input.maxBytes, 'context_budget_too_small'); return structuredClone(result);
    });
  }
  /** Host calls immediately before dispatch (and again before committing derived output). Never reselects memory. */
  validateContext(manifest: PersonalContextManifest, input: ContextRequest): { context: PersonalContextManifest; authorizationRef: string } {
    request(input); return this.read(() => {
      const who = this.identity(), policy = this.policyValue();
      check(record(manifest) && manifest.contract === PERSONAL_CONTEXT_CONTRACT && manifest.trust === 'untrusted-personalization-data' && manifest.ownerId === who.userId && manifest.hostPolicyVersion === who.policyVersion && manifest.policyVersion === policy.version && manifest.requestDigest === hash(input) && manifest.encodedBytes === bytes(manifest) && manifest.encodedBytes <= input.maxBytes && Array.isArray(manifest.items) && manifest.items.length <= input.maxItems && Array.isArray(manifest.scopes), 'stale_personal_context');
      const { id: _id, createdAt: _time, digest: _digest, ...body } = manifest; check(manifest.digest === hash(body), 'personal_context_digest_mismatch');
      for (const proof of manifest.scopes) check(same(this.proof(proof.scope), proof), 'stale_personal_scope');
      const expectedScopes = this.requestProofs(input), sourceCache = new Map<string, OriginalImport>();
      const references: RecordRef[] = []; const seen = new Set<string>();
      for (const item of manifest.items) {
        check(!seen.has(item.factId), 'invalid_context_item'); seen.add(item.factId); check(input.assistant === 'ordinary' ? policy.ordinaryEnabled : policy.velaEnabled, 'personal_disclosure_disabled');
        const head = this.required(item.factId, 'fact', item.version), itemProof = this.proof(head.scope!); this.authorize('record.read', head.scope, this.ref(head));
        const value = this.decode<ReviewedFact>(head); check(!this.usable(value, head, input, policy, sourceCache) && same(this.item(value), item), 'stale_personal_context'); references.push(this.ref(head));
        const required = [itemProof]; if (value.provenance.kind === 'import') { const source = this.required(value.provenance.id, 'import', value.provenance.version); references.push(this.ref(source)); required.push(this.proof(source.scope!)); }
        for (const proof of required) if (!expectedScopes.some(value => same(value, proof))) expectedScopes.push(proof);
      }
      check(same(manifest.scopes, expectedScopes), 'stale_personal_scope');
      const authorizationRef = this.authorize('context.disclose', null, null, { request: input, manifestDigest: manifest.digest, references }); return { context: structuredClone(manifest), authorizationRef };
    });
  }
}
