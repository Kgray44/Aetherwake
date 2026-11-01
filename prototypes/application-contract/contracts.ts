/** Renderer-safe contracts. Canonical resources and visual placements have separate IDs. */
export type BlockKind = 'conversation' | 'note' | 'research' | 'task' | 'reference' | 'stream';
export type Shape = 'rectangle' | 'rounded' | 'circle';
export type Geometry = { x: number; y: number; width: number; height: number; z: number };
export type Block = Geometry & { id: string; resource_id: string; workspace_id: string; version: number; shape: Shape };
export type Project = { id: string; title: string; version: number };
export type Workspace = { id: string; project_id: string | null; title: string; version: number };
export type Resource = { id: string; title: string; kind: BlockKind; version: number; content: string; provider: 'local' | 'codex'; messages: { id: string; role: string; content: string }[] };
export type NavigationTarget = { kind: 'workspace'; workspaceId: string } | { kind: 'constellation'; projectId: string | null };
export type DesktopSnapshot = {
  contract: 'aerynth.desktop@1'; revision: number;
  projects: Project[]; workspaces: Workspace[]; resources: Resource[]; blocks: Block[];
  relationships: { id: string; source_id: string; target_id: string; kind: string; provenance: string }[];
  navigation: NavigationTarget; history: NavigationTarget[]; activeWorkspaceId: string | null;
  layoutVersion: number; canUndo: boolean; hasCheckpoint: boolean;
};
export type DesktopCommand =
  | { type: 'snapshot' }
  | { type: 'createProject'; title: string }
  | { type: 'createWorkspace'; title: string; projectId: string | null }
  | { type: 'renameWorkspace'; workspaceId: string; title: string; expectedVersion: number }
  | { type: 'navigate'; target: NavigationTarget }
  | { type: 'back' }
  | { type: 'createResource'; kind: BlockKind; title: string; provider?: 'local' | 'codex'; workspaceId: string | null }
  | { type: 'attach'; workspaceId: string; resourceId: string }
  | { type: 'detach'; blockId: string; expectedVersion: number }
  | { type: 'geometry'; blockId: string; expectedVersion: number; placement: Geometry; shape: Shape }
  | { type: 'content'; resourceId: string; expectedVersion: number; content: string }
  | { type: 'undo' } | { type: 'checkpoint' } | { type: 'restore' };
