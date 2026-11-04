/** Canonical workspace recovery changes visibility only and preserves current content and layout. */
export const WORKSPACE_RECOVERY_SCOPE = 'preserve-current-content' as const;
export type WorkspaceRecoveryAction = 'undo-creation' | 'restore';
export interface WorkspaceRecoverySnapshot {
  workspaceId: string;
  title: string;
  projectId: string | null;
  projectVersion: number | null;
  policyVersion: string;
  state: 'active' | 'archived';
  version: number;
  layoutVersion: number;
  placementCount: number;
  resourceCount: number;
}
export type WorkspaceRecoveryInfo = Omit<WorkspaceRecoverySnapshot, 'projectVersion' | 'policyVersion'> & {
  creationEventId: string;
  createdAt: string;
  scope: typeof WORKSPACE_RECOVERY_SCOPE;
};
export type WorkspaceRecoveryState =
  | ({ kind: 'state'; available: true; action: WorkspaceRecoveryAction } & WorkspaceRecoveryInfo)
  | { kind: 'state'; available: false; workspaceId: string; scope: typeof WORKSPACE_RECOVERY_SCOPE;
      reason: 'workspace_unavailable' | 'creation_record_missing' | 'creation_record_ambiguous' };
export interface WorkspaceRecoveryPreviewInput {
  workspaceId: string;
  action: WorkspaceRecoveryAction;
  creationEventId: string;
  expectedVersion: number;
  expectedLayoutVersion: number;
}
export type WorkspaceRecoveryPreview = WorkspaceRecoveryInfo & {
  kind: 'preview';
  action: WorkspaceRecoveryAction;
  previewId: string;
  fingerprint: string;
  expiresAt: string;
};
/** The resulting metadata is recorded at apply time. A replay returns that historical receipt. */
export type WorkspaceRecoveryReceipt = WorkspaceRecoveryInfo & {
  kind: 'receipt';
  action: WorkspaceRecoveryAction;
  commandId: string;
  appliedAt: string;
  replayed: boolean;
};
export type WorkspaceRecoveryRequest =
  | { name: 'state'; input: { workspaceId: string } }
  | { name: 'preview'; input: WorkspaceRecoveryPreviewInput }
  | { name: 'apply'; input: { previewId: string; fingerprint: string; commandId: string } };
export type WorkspaceRecoveryResponse = WorkspaceRecoveryState | WorkspaceRecoveryPreview | WorkspaceRecoveryReceipt;
