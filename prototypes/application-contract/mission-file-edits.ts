/** Renderer-safe metadata only. Native review bodies, paths and authorities are private. */
export type MissionFileEditPhase = 'awaiting-native-review' | 'approved' | 'applying' | 'applied' |
  'unchanged' | 'conflict' | 'unknown' | 'cancelled' | 'compensated';
export type MissionFileEditCheckState = 'not-run' | 'awaiting-native-review' | 'approved' | 'running' |
  'passed' | 'failed' | 'blocked' | 'unknown';
export type MissionFileEditOwner =
  | { kind: 'api-mission'; missionId: string; taskId: string; attemptId: string; planRevision: number }
  | { kind: 'api-selected-file-intent'; requestId: string };
export interface MissionFileEditView {
  id: string;
  owner: MissionFileEditOwner;
  source: { resourceId: string; version: number };
  title: string;
  phase: MissionFileEditPhase;
  patchDigest: string;
  apiProvenance?: {providerId:'openai-api-vela';executionId:string;responseId:string;model:string};
  verification: { state: MissionFileEditCheckState; criterion: 'reviewed-selected-node-test'; reason?: string };
  /** Pauses orchestration without consuming a provider/worker slot. IDs confer no authority. */
  barrier: { kind: 'native-patch-review'; operationId: string; patchDigest: string } |
    { kind: 'native-check-review'; operationId: string; patchDigest: string; checkDigest: string } | null;
  compensationOf?: string;
  updatedAt: string;
}
export type MissionFileEditRequest = { type: 'read'; operationId: string };
export type MissionFileEditResponse = MissionFileEditView;
