import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { WORKSPACE_RECOVERY_SCOPE, type WorkspaceRecoveryAction, type WorkspaceRecoveryInfo,
  type WorkspaceRecoveryPreview, type WorkspaceRecoveryReceipt, type WorkspaceRecoveryRequest,
  type WorkspaceRecoveryResponse, type WorkspaceRecoverySnapshot, type WorkspaceRecoveryState } from '../../application-contract/workspace-recovery.ts';
import { ensure, ServiceError } from './contracts.mts';

export interface WorkspaceRecoveryHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  /** Management authority over this exact workspace, including archived state, and its current active project. */
  snapshot(workspaceId: string): WorkspaceRecoverySnapshot | null;
  archive(workspaceId: string, archived: boolean, expectedVersion: number): void;
  record(event: { workspaceId: string; action: WorkspaceRecoveryAction; commandId: string;
    creationEventId: string; workspaceVersion: number }): void;
}
type Creation = Record<string, unknown> & { id: string; occurred_at: string };
interface Review {
  snapshot: WorkspaceRecoverySnapshot;
  creation: Creation;
  creationDigest: string;
  preview: WorkspaceRecoveryPreview;
  expires: number;
}
const maxReviews = 16, reviewMs = 120_000, maxActions = 4096;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value &&
  typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const action = (value: unknown): value is WorkspaceRecoveryAction => value === 'undo-creation' || value === 'restore';
const actionFor = (snapshot: WorkspaceRecoverySnapshot): WorkspaceRecoveryAction => snapshot.state === 'active' ? 'undo-creation' : 'restore';
const info = (snapshot: WorkspaceRecoverySnapshot, creation: Creation): WorkspaceRecoveryInfo => ({
  workspaceId: snapshot.workspaceId, title: snapshot.title, projectId: snapshot.projectId, state: snapshot.state,
  version: snapshot.version, layoutVersion: snapshot.layoutVersion, placementCount: snapshot.placementCount,
  resourceCount: snapshot.resourceCount, creationEventId: creation.id, createdAt: creation.occurred_at,
  scope: WORKSPACE_RECOVERY_SCOPE,
});

/** Reversible visibility changes around exact canonical creation evidence. Never restores old content or geometry. */
export class WorkspaceRecoveryService {
  private readonly host: WorkspaceRecoveryHost;
  private readonly reviews = new Map<string, Review>();

  constructor(host: WorkspaceRecoveryHost) {
    this.host = host;
    host.atomic(() => host.db.exec(`CREATE TABLE IF NOT EXISTS recovery_actions (
      command_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, workspace_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    ) STRICT;`));
  }

  private snapshot(workspaceId: string): WorkspaceRecoverySnapshot | null {
    const row = this.host.snapshot(workspaceId);
    if (!row) return null;
    ensure(row.workspaceId === workspaceId && typeof row.title === 'string' && !!row.title.trim() &&
      (row.projectId === null || id(row.projectId)) &&
      (row.projectId === null ? row.projectVersion === null : positive(row.projectVersion)) &&
      typeof row.policyVersion === 'string' && !!row.policyVersion && ['active', 'archived'].includes(row.state) &&
      positive(row.version) && positive(row.layoutVersion) && nonnegative(row.placementCount) &&
      nonnegative(row.resourceCount) && row.resourceCount <= row.placementCount, 'workspace_recovery_invalid_snapshot');
    // Normalize field order and retain no host-owned object references in a review.
    return { workspaceId, title: row.title, projectId: row.projectId, projectVersion: row.projectVersion,
      policyVersion: row.policyVersion, state: row.state, version: row.version, layoutVersion: row.layoutVersion,
      placementCount: row.placementCount, resourceCount: row.resourceCount };
  }

  private creation(workspaceId: string): Creation | 'creation_record_missing' | 'creation_record_ambiguous' {
    const rows = this.host.db.prepare(`SELECT * FROM change_events WHERE entity_kind='workspace' AND entity_id=?
      AND type='workspace.created' AND resource_version=1 LIMIT 2`).all(workspaceId);
    if (!rows.length) return 'creation_record_missing';
    if (rows.length !== 1) return 'creation_record_ambiguous';
    return structuredClone(rows[0]) as Creation;
  }

  dispatch(request: WorkspaceRecoveryRequest): WorkspaceRecoveryResponse {
    ensure(exactKeys(request, ['name', 'input']), 'invalid_workspace_recovery_request');
    switch (request.name) {
      case 'state': {
        const input = request.input;
        ensure(exactKeys(input, ['workspaceId']) && id(input.workspaceId), 'invalid_workspace_recovery_request');
        const snapshot = this.snapshot(input.workspaceId);
        const unavailable = (reason: Extract<WorkspaceRecoveryState, { available: false }>['reason']): WorkspaceRecoveryState =>
          ({ kind: 'state', available: false, workspaceId: input.workspaceId, scope: WORKSPACE_RECOVERY_SCOPE, reason });
        if (!snapshot) return unavailable('workspace_unavailable');
        const creation = this.creation(input.workspaceId);
        if (typeof creation === 'string') return unavailable(creation);
        return { kind: 'state', available: true, action: actionFor(snapshot), ...info(snapshot, creation) };
      }
      case 'preview': {
        const input = request.input;
        ensure(exactKeys(input, ['workspaceId', 'action', 'creationEventId', 'expectedVersion', 'expectedLayoutVersion']) &&
          id(input.workspaceId) && id(input.creationEventId) && action(input.action) && positive(input.expectedVersion) &&
          positive(input.expectedLayoutVersion), 'invalid_workspace_recovery_request');
        const snapshot = this.snapshot(input.workspaceId);
        ensure(snapshot, 'workspace_recovery_unavailable');
        const creation = this.creation(input.workspaceId);
        ensure(typeof creation !== 'string' && creation.id === input.creationEventId, 'workspace_recovery_creation_unavailable');
        ensure(snapshot.version === input.expectedVersion && snapshot.layoutVersion === input.expectedLayoutVersion,
          'workspace_recovery_stale_snapshot');
        ensure(actionFor(snapshot) === input.action, 'workspace_recovery_wrong_state');
        const now = Date.now();
        for (const [key, review] of this.reviews) if (review.expires <= now) this.reviews.delete(key);
        ensure(this.reviews.size < maxReviews, 'workspace_recovery_review_busy');
        const previewId = randomUUID(), expires = now + reviewMs, expiresAt = new Date(expires).toISOString();
        const creationDigest = hash(creation);
        const fingerprint = hash({ previewId, snapshot, creationDigest, action: input.action, expiresAt });
        const preview: WorkspaceRecoveryPreview = { kind: 'preview', action: input.action, previewId, fingerprint,
          expiresAt, ...info(snapshot, creation) };
        this.reviews.set(previewId, { snapshot, creation, creationDigest, preview, expires });
        return structuredClone(preview);
      }
      case 'apply': {
        const input = request.input;
        ensure(exactKeys(input, ['previewId', 'fingerprint', 'commandId']) && id(input.previewId) && id(input.commandId) &&
          typeof input.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.fingerprint), 'invalid_workspace_recovery_request');
        const requestDigest = hash({ previewId: input.previewId, fingerprint: input.fingerprint });
        const receipt = this.host.atomic((): WorkspaceRecoveryReceipt => {
          const previous = this.host.db.prepare('SELECT * FROM recovery_actions WHERE command_id=?').get(input.commandId);
          if (previous) {
            ensure(this.snapshot(String(previous.workspace_id)), 'workspace_recovery_unavailable');
            ensure(previous.fingerprint === requestDigest, 'workspace_recovery_idempotency_conflict');
            return { ...JSON.parse(String(previous.receipt_json)), replayed: true };
          }
          const review = this.reviews.get(input.previewId);
          ensure(review, 'workspace_recovery_review_required');
          ensure(review.expires > Date.now(), 'workspace_recovery_review_expired');
          ensure(review.preview.fingerprint === input.fingerprint, 'workspace_recovery_fingerprint_mismatch');
          const before = this.snapshot(review.snapshot.workspaceId);
          ensure(before, 'workspace_recovery_unavailable');
          ensure(hash(before) === hash(review.snapshot), 'workspace_recovery_stale_snapshot');
          const creation = this.creation(before.workspaceId);
          ensure(typeof creation !== 'string' && hash(creation) === review.creationDigest,
            'workspace_recovery_creation_changed');
          ensure(actionFor(before) === review.preview.action, 'workspace_recovery_wrong_state');
          ensure(Number(this.host.db.prepare('SELECT count(*) AS total FROM recovery_actions').get()!.total) < maxActions,
            'workspace_recovery_receipt_capacity');
          this.host.archive(before.workspaceId, review.preview.action === 'undo-creation', before.version);
          const after = this.snapshot(before.workspaceId);
          ensure(after && after.state !== before.state && after.version === before.version + 1 &&
            hash({ ...after, state: before.state, version: before.version }) === hash(before),
            'workspace_recovery_preservation_failed');
          const result: WorkspaceRecoveryReceipt = { kind: 'receipt', action: review.preview.action, commandId: input.commandId,
            appliedAt: new Date().toISOString(), replayed: false, ...info(after, creation) };
          this.host.record({ workspaceId: before.workspaceId, action: result.action, commandId: input.commandId,
            creationEventId: creation.id, workspaceVersion: after.version });
          this.host.db.prepare('INSERT INTO recovery_actions VALUES(?,?,?,?)')
            .run(input.commandId, requestDigest, before.workspaceId, JSON.stringify(result));
          return result;
        });
        this.reviews.delete(input.previewId);
        return receipt;
      }
      default: throw new ServiceError('invalid_workspace_recovery_request');
    }
  }
}
