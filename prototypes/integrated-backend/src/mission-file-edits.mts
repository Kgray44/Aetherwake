import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MissionFileEditOwner, MissionFileEditPhase, MissionFileEditView } from '../../application-contract/mission-file-edits.ts';
import type { ProviderPort } from './contracts.mts';
import { ensure } from './contracts.mts';
import { mediaSourceRevision } from './media-sources.mts';
import { admitVelaFileEdit, observeVelaFileEdit, parseVelaFileEdit, publishVelaFile, readVelaFileEditTargets,
  stageVelaFile, validateVelaFileEditTarget, velaEditSiblings, verifyVelaReplacement,
  type VelaFileEditItem, type VelaFileEditRecord, type VelaFileEditTarget } from './vela-file-edit.mts';
import { interpretVelaProjectCheck, planVelaProjectCheck } from './vela-project-check.mts';

export const MISSION_FILE_EDIT_LIMITS = Object.freeze({ operations: 128, inspections: 256, events: 32, bytes: 8192, leaseMs: 180000 });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,127}$/iu.test(value);
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
export interface MissionEditScope { principalId: string; policyVersion: string; projectId: string | null; workspaceId: string; stamp: string }
/** Private authority to inspect one selected source. It never authorizes a write. */
export interface SelectedFileReadAuthority { id: string; version: number; purpose: 'selected-file-read'; expiresAt: number }
export interface NativeSelectedCodeFile {
  resourceId: string; version: number; sourceRevision: string; path: string; readAuthority: SelectedFileReadAuthority;
}
export interface ApiFileProposalProvenance {
  providerId: 'openai-api-vela'; executionId: string; responseId: string; evidenceId: string;
  expectedModel: string; reportedModel: string; inspectionDigest: string; outputDigest: string;
}
function validOwner(owner: MissionFileEditOwner): boolean {
  if (!owner || typeof owner !== 'object') return false;
  return owner.kind === 'api-mission'
    ? Object.keys(owner).sort().join(',') === 'attemptId,kind,missionId,planRevision,taskId' && id(owner.missionId) && id(owner.taskId) && id(owner.attemptId) && version(owner.planRevision)
    : owner.kind === 'api-selected-file-intent' && Object.keys(owner).sort().join(',') === 'kind,requestId' && id(owner.requestId);
}
interface Inspection {
  kind: 'native-selected-file'; id: string; owner: MissionFileEditOwner; scope: MissionEditScope; source: NativeSelectedCodeFile;
  target: VelaFileEditTarget; before: string; digest: string; expiresAt: number;
}
interface Review { id: string; digest: string; expiresAt: number; purpose: 'patch' | 'check' }
interface Check { review: Review; plan: ReturnType<typeof planVelaProjectCheck>; digest: string; state: MissionFileEditView['verification']['state']; reason?: string }
interface Operation {
  id: string; inspection: Inspection; after: string; afterDigest: string; patchDigest: string;
  provenance: ApiFileProposalProvenance | { kind: 'native-compensation'; operationId: string };
  phase: MissionFileEditPhase; review?: Review; file: VelaFileEditItem;
  afterSource?: { resourceId: string; version: number; sourceRevision: string };
  check?: Check; compensationOf?: string; updatedAt: string; events: { kind: string; at: string }[];
}
/** Private host boundary. Implementations must resolve canonical state and consume
 * native UI decisions independently of renderer/model-supplied booleans. */
export interface MissionFileEditsHost {
  db: DatabaseSync; atomic<T>(work: () => T): T; privateRoot?: string; now?(): number;
  scope(): MissionEditScope;
  /** Resolves current mission attempt or explicit selected-file intent; never invents a chat turn. */
  ownerCurrent(owner: MissionFileEditOwner, scope: MissionEditScope): boolean;
  selected(resourceId: string): NativeSelectedCodeFile | null;
  readAuthorityCurrent(authority: SelectedFileReadAuthority, resourceId: string, scope: MissionEditScope): boolean;
  /** Must bind completed canonical API evidence to BOTH input and output digests. */
  apiProvenanceCurrent(proof: ApiFileProposalProvenance, owner: MissionFileEditOwner): boolean;
  /** Native Yes must have been recorded for this exact review/digest/purpose. Consumes the decision. */
  consumeNativeChoice(input: { choiceId: string; reviewId: string; reviewDigest: string; purpose: 'patch' | 'check' }): 'yes' | 'no' | undefined;
  /** Synchronous canonical CAS after confirmed filesystem replacement; no inferred versions. */
  rebindSource(input: { operationId: string; expected: NativeSelectedCodeFile; afterDigest: string }): { resourceId: string; version: number; sourceRevision: string } | null;
  /** Shares the existing mutation/check lease; no app writer may bypass it. */
  lease(root: string): (() => void) | null;
  /** Takes custody of a still-held GLOBAL lease and running-capacity claim after
   * local stop/transport uncertainty. Only an actual exit or owned runner-shutdown
   * receipt may release it; unknown completion and restart require reconciliation. */
  retainUnknownCheck(input: { operationId: string; root: string; completion: Promise<'exit-observed' | 'unknown'>; release(): void }): void;
  /** The unchanged reviewed restricted Codex command runner. No direct Node-test fallback. */
  verifier?: NonNullable<ProviderPort['projectChecks']>;
}
export interface NativeMissionPatchReview {
  operationId: string; reviewId: string; reviewDigest: string; expiresAt: number;
  path: string; before: string; after: string; beforeDigest: string; afterDigest: string;
}
export interface PrivateMissionEditInput {
  kind: 'native-selected-file'; inspectionId: string; inspectionDigest: string; owner: MissionFileEditOwner;
  source: { resourceId: string; version: number; sourceRevision: string; relativePath: string; beforeDigest: string; content: string };
}
/** Deliberately not an RPC: only the native broker receives this one-use value. */
export interface PrivateMissionEditAuthority { authority: string; expiresAt: number }

/** Detaches only the local wait. The unchanged restricted runner owns command
 * timeout/shutdown; a late completion is observed but can never verify a stopped check. */
function whileActive<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(Error('mission_edit_check_stopped')); };
    signal.addEventListener('abort', stop, { once: true });
    work.then(value => { signal.removeEventListener('abort', stop); if (signal.aborted) stop(); else resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
    if (signal.aborted) stop();
  });
}

export class MissionFileEdits {
  private readonly host: MissionFileEditsHost; private readonly now: () => number;
  private closed = false; private readonly checks = new Set<Promise<unknown>>(); private readonly stopping = new AbortController();
  private readonly ownedAuthorities = new Set<string>(); private readonly ownedOperations = new Set<string>();
  static migrate(db: DatabaseSync) {
    ensure(db.isTransaction, 'mission_edit_transaction_required');
    db.exec(`CREATE TABLE IF NOT EXISTS mission_file_inspections(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_file_operations(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mission_file_authorities(token_hash TEXT PRIMARY KEY,operation_id TEXT NOT NULL,
        purpose TEXT NOT NULL,review_digest TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL);`);
  }
  constructor(host: MissionFileEditsHost) {
    this.host = host; this.now = host.now ?? Date.now;
    // A new reader cannot infer that another host exited. Recovery is a safe
    // projection; persisted runner uncertainty is quarantined by the Core.
  }
  private active() { ensure(!this.closed, 'mission_edit_closed'); }
  private read<T>(table: 'mission_file_inspections' | 'mission_file_operations', key: string): T {
    ensure(id(key), 'invalid_mission_edit'); const row = this.host.db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(key);
    ensure(row && typeof row.json === 'string' && Buffer.byteLength(row.json) <= 65536, 'mission_edit_unavailable');
    return JSON.parse(row.json) as T;
  }
  private decode(raw: string, key: string): Operation {
    const op = JSON.parse(raw) as Operation;
    ensure(op?.id === key && hex(op.afterDigest) && sha(op.after) === op.afterDigest &&
      sha(op.inspection.before) === op.inspection.target.beforeDigest && Array.isArray(op.events) && op.events.length <= MISSION_FILE_EDIT_LIMITS.events,
    'mission_edit_unavailable'); this.validateInspection(op.inspection);
    ensure(op.patchDigest === digest({ inspection: op.inspection.digest, before: op.inspection.target.beforeDigest, after: op.afterDigest,
      owner: op.inspection.owner, compensationOf: op.compensationOf }) && digest(op.file.target) === digest(op.inspection.target) &&
      op.file.afterDigest === op.afterDigest, 'mission_edit_unavailable');
    if (op.file.stagedPath || op.file.backupPath) {
      const siblings = velaEditSiblings(op.inspection.target, op.id);
      ensure(op.file.stagedPath === siblings.stagedPath && op.file.backupPath === siblings.backupPath, 'mission_edit_unavailable');
    }
    return op;
  }
  private validateInspection(inspection: Inspection) {
    const { digest: expected, ...base } = inspection;
    ensure(inspection.kind === 'native-selected-file' && validOwner(inspection.owner) && expected === digest(base) && hex(inspection.source.sourceRevision) &&
      inspection.source.path === inspection.target.path && hex(inspection.target.beforeDigest) && sha(inspection.before) === inspection.target.beforeDigest,
    'mission_edit_unavailable');
  }
  private op(key: string) {
    this.active(); const op = this.decode(JSON.stringify(this.read<Operation>('mission_file_operations', key)), key);
    if (!this.ownedOperations.has(op.id)) {
      if (op.phase === 'applying') op.phase = 'unknown';
      if (op.phase === 'approved') { op.phase = 'awaiting-native-review'; delete op.review; }
      if (op.check?.state === 'approved') op.check.state = 'awaiting-native-review';
      if (op.check?.state === 'running') { op.check.state = 'unknown'; op.check.reason = 'runner-outcome-unconfirmed'; }
    }
    return op;
  }
  private save(op: Operation, kind: string) {
    ensure(this.host.db.isTransaction && op.events.length < MISSION_FILE_EDIT_LIMITS.events, 'mission_edit_storage_unavailable');
    op.updatedAt = new Date(this.now()).toISOString(); op.events.push({ kind, at: op.updatedAt });
    const json = JSON.stringify(op); ensure(Buffer.byteLength(json) <= 65536, 'mission_edit_storage_unavailable');
    this.host.db.prepare('INSERT INTO mission_file_operations(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(op.id, json);
  }
  private authorityScope(inspection: Inspection) {
    this.active(); this.validateInspection(inspection); ensure(digest(this.host.scope()) === digest(inspection.scope) &&
      inspection.source.readAuthority.expiresAt > this.now() && this.host.ownerCurrent(inspection.owner, inspection.scope) &&
      this.host.readAuthorityCurrent(inspection.source.readAuthority, inspection.source.resourceId, inspection.scope), 'mission_edit_scope_changed');
  }
  private beforeCurrent(inspection: Inspection) {
    this.authorityScope(inspection); ensure(this.now() < inspection.expiresAt, 'mission_edit_inspection_expired');
    const actual = this.host.selected(inspection.source.resourceId);
    ensure(actual && digest(actual) === digest(inspection.source) && mediaSourceRevision(lstatSync(actual.path, { bigint: true })) === actual.sourceRevision,
      'mission_edit_source_changed');
    validateVelaFileEditTarget(inspection.target, this.host.privateRoot);
  }
  private afterCurrent(op: Operation) {
    this.authorityScope(op.inspection); const actual = this.host.selected(op.inspection.source.resourceId);
    ensure(op.afterSource && actual && actual.resourceId === op.afterSource.resourceId && actual.version === op.afterSource.version &&
      actual.path === op.inspection.source.path && digest(actual.readAuthority) === digest(op.inspection.source.readAuthority) &&
      actual.sourceRevision === op.afterSource.sourceRevision && mediaSourceRevision(lstatSync(actual.path, { bigint: true })) === actual.sourceRevision,
    'mission_edit_source_changed');
    const current = readVelaFileEditTargets([actual.path], [], this.host.privateRoot)[0];
    ensure(current.target.beforeDigest === op.afterDigest && current.target.root === op.inspection.target.root && current.target.head === op.inspection.target.head,
      'mission_edit_source_changed');
  }
  /** Native host captures explicit selected-file READ authority; no write token is minted. */
  inspect(input: { resourceId: string; expectedVersion: number; owner: MissionFileEditOwner }): PrivateMissionEditInput {
    this.active(); ensure(id(input.resourceId) && version(input.expectedVersion) && validOwner(input.owner), 'invalid_mission_edit');
    const source = this.host.selected(input.resourceId), scope = this.host.scope();
    ensure(scope && id(scope.principalId) && typeof scope.policyVersion === 'string' && scope.policyVersion.length > 0 && scope.policyVersion.length <= 128 && !/[\x00-\x1f\x7f]/u.test(scope.policyVersion) &&
      (scope.projectId === null || id(scope.projectId)) && id(scope.workspaceId) && id(scope.stamp) && this.host.ownerCurrent(input.owner, scope), 'mission_edit_scope_changed');
    ensure(source && source.resourceId === input.resourceId && source.version === input.expectedVersion && source.readAuthority.purpose === 'selected-file-read' &&
      id(source.readAuthority.id) && version(source.readAuthority.version) && source.readAuthority.expiresAt > this.now() &&
      this.host.readAuthorityCurrent(source.readAuthority, source.resourceId, scope), 'mission_edit_read_authority_required');
    ensure(extname(source.path).toLowerCase() === '.mjs', 'mission_edit_unsupported');
    ensure(mediaSourceRevision(lstatSync(source.path, { bigint: true })) === source.sourceRevision, 'mission_edit_source_changed');
    const file = readVelaFileEditTargets([source.path], [], this.host.privateRoot)[0];
    ensure(file.body !== null && Buffer.byteLength(file.body) <= MISSION_FILE_EDIT_LIMITS.bytes, 'mission_edit_unsupported');
    const base = { kind: 'native-selected-file' as const, id: randomUUID(), owner: structuredClone(input.owner), scope: structuredClone(scope), source: structuredClone(source), target: file.target,
      before: file.body, expiresAt: Math.min(source.readAuthority.expiresAt, this.now() + MISSION_FILE_EDIT_LIMITS.leaseMs) };
    const inspection: Inspection = { ...base, digest: digest(base) };
    this.host.atomic(() => { ensure(Number(this.host.db.prepare('SELECT count(*) AS n FROM mission_file_inspections').get()!.n) < MISSION_FILE_EDIT_LIMITS.inspections, 'mission_edit_capacity');
      this.host.db.prepare('INSERT INTO mission_file_inspections VALUES(?,?)').run(inspection.id, JSON.stringify(inspection)); });
    return { kind: 'native-selected-file', inspectionId: inspection.id, inspectionDigest: inspection.digest, owner: structuredClone(input.owner), source: { resourceId: source.resourceId,
      version: source.version, sourceRevision: source.sourceRevision, relativePath: file.target.relativePath, beforeDigest: file.target.beforeDigest!, content: file.body } };
  }
  private create(inspection: Inspection, after: string, provenance: Operation['provenance'], compensationOf?: string) {
    this.beforeCurrent(inspection); verifyVelaReplacement(inspection.target.path, after);
    const op: Operation = { id: randomUUID(), inspection, after, afterDigest: sha(after), patchDigest: '', provenance, phase: 'awaiting-native-review',
      file: { target: inspection.target, afterDigest: sha(after) }, updatedAt: '', events: [], ...(compensationOf ? { compensationOf } : {}) };
    op.patchDigest = digest({ inspection: inspection.digest, before: inspection.target.beforeDigest, after: op.afterDigest, owner: inspection.owner, compensationOf });
    this.host.atomic(() => {
      ensure(!this.host.db.prepare("SELECT id FROM mission_file_operations WHERE json_extract(json,'$.inspection.id')=?").get(inspection.id), 'mission_edit_inspection_consumed');
      ensure(Number(this.host.db.prepare('SELECT count(*) AS n FROM mission_file_operations').get()!.n) < MISSION_FILE_EDIT_LIMITS.operations, 'mission_edit_capacity'); this.save(op, 'proposal-ready'); });
    this.ownedOperations.add(op.id);
    return this.view(op.id);
  }
  /** Only canonical completed API execution evidence may register a proposal. */
  assertInspectionCurrent(inspectionId:string):void {this.beforeCurrent(this.read<Inspection>('mission_file_inspections',inspectionId));}
  propose(input: { inspectionId: string; provenance: ApiFileProposalProvenance; output: string }): MissionFileEditView {
    const inspection = this.read<Inspection>('mission_file_inspections', input.inspectionId); this.beforeCurrent(inspection);
    const p = input.provenance;
    ensure(p.providerId === 'openai-api-vela' && id(p.responseId) && id(p.executionId) && id(p.evidenceId) && id(p.expectedModel) && p.expectedModel === p.reportedModel &&
      p.inspectionDigest === inspection.digest && p.outputDigest === sha(input.output) && this.host.apiProvenanceCurrent(p, inspection.owner), 'mission_edit_api_provenance_required');
    const edits = parseVelaFileEdit(input.output, [inspection.target]); ensure(edits.length === 1, 'mission_edit_invalid_proposal');
    return this.create(inspection, edits[0].replacement, structuredClone(p));
  }
  view(operationId: string): MissionFileEditView {
    const op = this.op(operationId); this.authorityScope(op.inspection);
    return { id: op.id, owner: structuredClone(op.inspection.owner), source: { resourceId: op.inspection.source.resourceId, version: op.afterSource?.version ?? op.inspection.source.version },
      title: basename(op.inspection.target.relativePath), phase: op.phase, patchDigest: op.patchDigest,
      ...('providerId' in op.provenance?{apiProvenance:{providerId:op.provenance.providerId,executionId:op.provenance.executionId,responseId:op.provenance.responseId,model:op.provenance.reportedModel}}:{}),
      verification: { state: op.check?.state ?? 'not-run', criterion: 'reviewed-selected-node-test', ...(op.check?.reason ? { reason: op.check.reason } : {}) },
      barrier: op.phase === 'awaiting-native-review' ? { kind: 'native-patch-review', operationId: op.id, patchDigest: op.patchDigest }
        : op.check?.state === 'awaiting-native-review' ? { kind: 'native-check-review', operationId: op.id, patchDigest: op.patchDigest, checkDigest: op.check.digest } : null,
      ...(op.compensationOf ? { compensationOf: op.compensationOf } : {}), updatedAt: op.updatedAt };
  }
  /** Private body-bearing review for the isolated native review surface only. */
  review(operationId: string): NativeMissionPatchReview {
    const op = this.op(operationId); ensure(op.phase === 'awaiting-native-review', 'mission_edit_not_reviewable'); this.beforeCurrent(op.inspection);
    const review: Review = { id: randomUUID(), digest: digest({ operationId, patchDigest: op.patchDigest, scope: op.inspection.scope }), expiresAt: this.now() + MISSION_FILE_EDIT_LIMITS.leaseMs, purpose: 'patch' };
    op.review = review; this.host.atomic(() => this.save(op, 'native-patch-review'));
    return { operationId, reviewId: review.id, reviewDigest: review.digest, expiresAt: review.expiresAt, path: op.inspection.target.path,
      before: op.inspection.before, after: op.after, beforeDigest: op.inspection.target.beforeDigest!, afterDigest: op.afterDigest };
  }
  private choose(op: Operation, review: Review, choiceId: string): PrivateMissionEditAuthority | null {
    ensure(op.events.length <= MISSION_FILE_EDIT_LIMITS.events - 4, 'mission_edit_storage_unavailable');
    ensure(id(choiceId) && review.expiresAt > this.now(), 'mission_edit_native_choice_required');
    const choice = this.host.consumeNativeChoice({ choiceId, reviewId: review.id, reviewDigest: review.digest, purpose: review.purpose });
    ensure(choice === 'yes' || choice === 'no', 'mission_edit_native_choice_required');
    if (choice === 'no') { if (review.purpose === 'patch') op.phase = 'cancelled'; else if (op.check) { op.check.state = 'blocked'; op.check.reason = 'native-check-denied'; }
      this.host.atomic(() => this.save(op, 'native-choice-no')); return null; }
    const authority = randomUUID(), expiresAt = Math.min(review.expiresAt, this.now() + MISSION_FILE_EDIT_LIMITS.leaseMs);
    this.host.atomic(() => { this.host.db.prepare("UPDATE mission_file_authorities SET state='revoked' WHERE operation_id=? AND purpose=? AND state='active'").run(op.id, review.purpose);
      this.host.db.prepare('INSERT INTO mission_file_authorities VALUES(?,?,?,?,?,?)').run(sha(authority), op.id, review.purpose, review.digest, expiresAt, 'active');
      if (review.purpose === 'patch') op.phase = 'approved'; else if (op.check) op.check.state = 'approved'; this.save(op, 'native-choice-yes'); });
    this.ownedAuthorities.add(sha(authority));
    this.ownedOperations.add(op.id);
    return { authority, expiresAt };
  }
  acceptNativePatchChoice(operationId: string, reviewId: string, nativeChoiceId: string): PrivateMissionEditAuthority | null {
    const op = this.op(operationId); this.beforeCurrent(op.inspection);
    ensure(op.phase === 'awaiting-native-review' && op.review?.id === reviewId, 'mission_edit_native_choice_required');
    return this.choose(op, op.review, nativeChoiceId);
  }
  private consume(op: Operation, authority: string, review: Review) {
    ensure(id(authority) && this.ownedAuthorities.has(sha(authority)), 'mission_edit_write_authority_required');
    const row = this.host.db.prepare('SELECT * FROM mission_file_authorities WHERE token_hash=?').get(sha(authority));
    ensure(row?.operation_id === op.id && row.purpose === review.purpose && row.review_digest === review.digest && row.state === 'active' && Number(row.expires_at) > this.now(), 'mission_edit_write_authority_required');
    ensure(this.host.db.isTransaction, 'mission_edit_transaction_required');
    this.host.db.prepare("UPDATE mission_file_authorities SET state='consumed' WHERE token_hash=? AND state='active'").run(sha(authority));
  }
  private finishObserved(op: Operation) {
    const observed = observeVelaFileEdit(op.file, this.host.privateRoot);
    if (observed.state === 'applied') {
      const actual = this.host.rebindSource({ operationId: op.id, expected: op.inspection.source, afterDigest: op.afterDigest });
      ensure(actual && actual.resourceId === op.inspection.source.resourceId && actual.version === op.inspection.source.version + 1 && hex(actual.sourceRevision), 'mission_edit_canonical_cas_failed');
      op.afterSource = actual; this.afterCurrent(op); op.phase = 'applied';
      if (op.compensationOf) { const prior = this.op(op.compensationOf); prior.phase = 'compensated'; this.save(prior, 'compensation-confirmed'); }
    } else op.phase = observed.state === 'unchanged' ? 'unchanged' : observed.state === 'conflict' ? 'conflict' : 'unknown';
    this.save(op, 'filesystem-observed');
  }
  apply(operationId: string, writeAuthority: string): MissionFileEditView {
    const op = this.op(operationId); ensure(op.phase === 'approved' && op.review, 'mission_edit_write_authority_required'); this.beforeCurrent(op.inspection);
    ensure(op.events.length <= MISSION_FILE_EDIT_LIMITS.events - 3, 'mission_edit_storage_unavailable');
    const release = this.host.lease(op.inspection.target.root); ensure(release, 'mission_edit_checkout_busy');
    try {
      verifyVelaReplacement(op.inspection.target.path, op.after); admitVelaFileEdit(op.inspection.target.path, this.host.privateRoot);
      this.host.atomic(() => { this.consume(op, writeAuthority, op.review!); Object.assign(op.file, velaEditSiblings(op.file.target, op.id)); op.phase = 'applying'; this.save(op, 'write-started'); });
      try { stageVelaFile(op.file, op.after); this.beforeCurrent(op.inspection); publishVelaFile(op.file); } catch { /* Reconcile observed bytes; never replay the write. */ }
      try { this.host.atomic(() => this.finishObserved(op)); }
      catch { op.phase = 'unknown'; delete op.afterSource; this.host.atomic(() => this.save(op, 'canonical-outcome-unconfirmed')); }
      return this.view(op.id);
    } finally { release(); }
  }
  reconcile(operationId: string): MissionFileEditView {
    const op = this.op(operationId); this.authorityScope(op.inspection); ensure(['applying', 'unknown'].includes(op.phase), 'mission_edit_not_reconcilable');
    const release = this.host.lease(op.inspection.target.root); ensure(release, 'mission_edit_checkout_busy');
    try { this.host.atomic(() => this.finishObserved(op)); return this.view(op.id); } finally { release(); }
  }
  /** Compensation is another immutable patch and requires another native Yes. */
  prepareCompensation(operationId: string): MissionFileEditView {
    const op = this.op(operationId); ensure(op.phase === 'applied', 'mission_edit_not_compensatable'); this.afterCurrent(op);
    const input = this.inspect({ resourceId: op.afterSource!.resourceId, expectedVersion: op.afterSource!.version, owner: op.inspection.owner });
    const inspection = this.read<Inspection>('mission_file_inspections', input.inspectionId);
    return this.create(inspection, op.inspection.before, { kind: 'native-compensation', operationId }, operationId);
  }
  private checkRecord(op: Operation): VelaFileEditRecord {
    // Shape adapter for the existing check planner only; no Vela/chat record is created.
    return { requestId: op.id, executionId: op.id, outputMessageId: op.id, scopeStamp: op.inspection.scope.stamp, state: 'applied', files: [op.file] };
  }
  reviewRequiredCheck(operationId: string, selectedTestPath: string) {
    const op = this.op(operationId); ensure(op.phase === 'applied', 'mission_edit_requires_applied'); this.afterCurrent(op);
    const plan = planVelaProjectCheck(this.checkRecord(op), 'node-test', [selectedTestPath], this.host.privateRoot);
    ensure(plan.targets.every(target => target.path.toLowerCase() !== op.inspection.target.path.toLowerCase()), 'mission_edit_verifier_must_be_independent');
    const review: Review = { id: randomUUID(), digest: digest({ operationId, patchDigest: op.patchDigest, afterSource: op.afterSource, plan }), expiresAt: this.now() + MISSION_FILE_EDIT_LIMITS.leaseMs, purpose: 'check' };
    op.check = { review, plan, digest: digest(plan), state: 'awaiting-native-review' }; this.host.atomic(() => this.save(op, 'native-check-review'));
    return { operationId, reviewId: review.id, reviewDigest: review.digest, expiresAt: review.expiresAt, cwd: plan.cwd, argv: [...plan.argv], inputs: [...plan.inputs] };
  }
  acceptNativeCheckChoice(operationId: string, reviewId: string, nativeChoiceId: string): PrivateMissionEditAuthority | null {
    const op = this.op(operationId); this.afterCurrent(op); ensure(op.check?.review.id === reviewId && op.check.state === 'awaiting-native-review', 'mission_edit_native_choice_required');
    return this.choose(op, op.check.review, nativeChoiceId);
  }
  runRequiredCheck(operationId: string, authority: string, signal?: AbortSignal): Promise<MissionFileEditView> {
    const task = this.performCheck(operationId, authority, signal); this.checks.add(task); void task.finally(() => this.checks.delete(task)).catch(() => {}); return task;
  }
  private async performCheck(operationId: string, authority: string, signal?: AbortSignal): Promise<MissionFileEditView> {
    const op = this.op(operationId); this.afterCurrent(op); ensure(op.check && op.check.state === 'approved', 'mission_edit_check_unavailable');
    ensure(op.events.length <= MISSION_FILE_EDIT_LIMITS.events - 3, 'mission_edit_storage_unavailable');
    const check = op.check; const releaseLease = this.host.lease(op.inspection.target.root); ensure(releaseLease, 'mission_edit_checkout_busy');
    let released = false; const release = () => { if (!released) { released = true; releaseLease(); } };
    let dispatched = false, started = false, exitObserved = false;
    let completion: Promise<'exit-observed' | 'unknown'> = Promise.resolve('unknown');
    const stop = signal ? AbortSignal.any([signal, this.stopping.signal]) : this.stopping.signal;
    try {
      this.host.atomic(() => { this.consume(op, authority, check.review); check.state = 'running'; this.save(op, 'check-started'); });
      started = true;
      if (stop.aborted || !this.host.verifier || !await whileActive(this.host.verifier.ready(), stop)) { check.state = 'blocked'; check.reason = 'restricted-check-runner-unavailable'; }
      else {
        stop.throwIfAborted(); this.afterCurrent(op);
        ensure(digest(planVelaProjectCheck(this.checkRecord(op), 'node-test', check.plan.targets.map(target => target.path), this.host.privateRoot)) === check.digest, 'mission_edit_check_changed');
        dispatched = true; const execution = this.host.verifier.execute([...check.plan.argv], check.plan.cwd);
        const knownExit = (result: { exitCode: number }) => Number.isSafeInteger(result.exitCode) && result.exitCode >= 0;
        completion = execution.then(result => knownExit(result) ? 'exit-observed' as const : 'unknown' as const, () => 'unknown' as const);
        const result = await whileActive(execution, stop); exitObserved = knownExit(result);
        ensure(exitObserved, 'mission_edit_check_exit_unconfirmed');
        stop.throwIfAborted(); this.afterCurrent(op);
        ensure(digest(planVelaProjectCheck(this.checkRecord(op), 'node-test', check.plan.targets.map(target => target.path), this.host.privateRoot)) === check.digest, 'mission_edit_check_changed');
        const observed = interpretVelaProjectCheck('node-test', result); check.state = observed.state === 'passed' ? 'passed' : observed.state === 'failed' ? 'failed' : 'unknown';
        check.reason = check.state === 'passed' ? undefined : 'reviewed-test-did-not-pass';
      }
    } catch (error) { if (!started) throw error; check.state = dispatched ? 'unknown' : 'blocked'; check.reason = dispatched ? 'check-outcome-unconfirmed' : 'check-scope-unavailable'; }
    finally {
      try { if (started) this.host.atomic(() => this.save(op, 'check-settled')); }
      finally {
        if (dispatched && !exitObserved) this.host.retainUnknownCheck({ operationId: op.id, root: op.inspection.target.root, completion, release });
        else release();
      }
    }
    return this.view(op.id);
  }
  cancel(operationId: string): MissionFileEditView {
    const op = this.op(operationId); this.authorityScope(op.inspection);
    ensure(op.phase === 'awaiting-native-review' || op.phase === 'approved', 'mission_edit_cannot_cancel_committed_effect');
    this.host.atomic(() => { this.host.db.prepare("UPDATE mission_file_authorities SET state='revoked' WHERE operation_id=?").run(op.id); op.phase = 'cancelled'; this.save(op, 'cancelled'); }); return this.view(op.id);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.stopping.abort();
    try {
      if (this.ownedAuthorities.size) this.host.atomic(() => {
        const revoke = this.host.db.prepare("UPDATE mission_file_authorities SET state='revoked' WHERE token_hash=? AND state='active'");
        for (const token of this.ownedAuthorities) revoke.run(token);
      });
    } finally { this.ownedAuthorities.clear(); await Promise.allSettled([...this.checks]); }
  }
}
