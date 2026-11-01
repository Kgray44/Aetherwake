export const CONTRACT = 'aetherwake.workspace/1' as const;
export const shapes = ['rectangle', 'rounded', 'circle', 'pill', 'folio', 'lens'] as const;
export type Shape = typeof shapes[number];
export type Geometry = { x: number; y: number; width: number; height: number };
export type Presentation = Geometry & {
  zIndex: number; shape: Shape; rotation: number; minimized: boolean; locked: boolean;
  materialVariant: string;
};
export type Viewport = { x: number; y: number; zoom: number; displayId?: string };
export type BlockProjection = Presentation & {
  blockId: string; resourceId: string; workspaceId: string; version: number;
  resourceState: 'active' | 'archived'; contentMode: 'summary' | 'reading';
};
export type WorkspaceProjection = {
  contract: typeof CONTRACT; workspaceId: string; projectId: string | null; title: string;
  workspaceVersion: number; layoutId: string; revision: number; viewport: Viewport;
  blocks: BlockProjection[]; canUndo: boolean; canRedo: boolean;
};
export type WorkspaceSummary = { workspaceId: string; projectId: string | null; title: string; version: number; state: string };
export type Preset = 'freeform' | 'focus' | 'columns' | 'research' | 'development';
export type NewResource = { kind: 'note'; title: string; content: string } | { kind: 'conversation'; title: string };
export type BlockTemplate = { id: string; title: string; presentation: Partial<Presentation> };
export type PlacementUpdate = { blockId: string; expectedVersion: number; presentation: Partial<Presentation> };
type Action =
  | { type: 'attachResource'; resourceId: string; presentation?: Partial<Presentation>; templateId?: string }
  | { type: 'createBlock'; resource: NewResource; presentation?: Partial<Presentation>; templateId?: string }
  | { type: 'duplicateBlock'; blockId: string }
  | { type: 'detachBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; x: number; y: number; snap?: number }
  | { type: 'resizeBlock'; blockId: string; width: number; height: number; aspectRatio?: number; snap?: number }
  | { type: 'setBlockShape'; blockId: string; shape: Shape }
  | { type: 'setBlockLayer'; blockId: string; zIndex: number }
  | { type: 'setBlockLock'; blockId: string; locked: boolean }
  | { type: 'setBlockPresentation'; blockId: string; patch: Partial<Presentation> }
  | { type: 'saveLayout'; placements: PlacementUpdate[]; viewport?: Viewport }
  | { type: 'applyPreset'; preset: Preset; width: number; height: number }
  | { type: 'undoLayout' | 'redoLayout' }
  | { type: 'checkpoint'; name: string }
  | { type: 'restoreCheckpoint'; checkpointId: string };
export type Command = Action & { commandId: string; workspaceId: string; expectedRevision: number };
export type CommandResult = WorkspaceProjection & { checkpointId?: string };
export interface WorkspacePort {
  project(workspaceId: string): Promise<WorkspaceProjection>;
  execute(command: Command): Promise<CommandResult>;
}
