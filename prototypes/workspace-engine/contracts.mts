export const CONTRACT = 'aetherwake.workspace/1' as const;
import type { BlockSubjectRef, NonResourceSubjectRef, SubjectState } from '../workspace-kernel/subjects.ts';
export type { BlockSubjectRef, NonResourceSubjectRef, SubjectState } from '../workspace-kernel/subjects.ts';
export const shapes = ['rectangle', 'rounded', 'circle', 'pill', 'folio', 'lens'] as const;
export type Shape = typeof shapes[number];
export type Geometry = { x: number; y: number; width: number; height: number };
export type Presentation = Geometry & {
  zIndex: number; shape: Shape; rotation: number; minimized: boolean; locked: boolean;
  materialVariant: string;
};
export type Viewport = { x: number; y: number; zoom: number; displayId?: string };
export type OrganizationMode = 'fluid' | 'freeform' | 'structured';
export type StructuredPreset = 'balanced' | 'focus' | 'development' | 'research';
export type GridSpan = { columns: number; rows: number };
export type StructuredOrganization = {
  columnCount?: number; rowHeight: number; rowGap: number; columnGap: number; margin: number;
  preset: StructuredPreset; order: string[]; spans: Record<string, GridSpan>;
};
export type WorkspaceOrganization = {
  schemaVersion: 1; mode: OrganizationMode; gap: number; revision: number; structured: StructuredOrganization;
};
export type OrganizationUpdate = { mode?: OrganizationMode; gap?: number; structured?: Omit<Partial<StructuredOrganization>, 'columnCount'> & { columnCount?: number | null } };
/** System presence is a layout participant, never a duplicate assistant resource. */
export type PresencePlacement = Geometry & {
  id: 'system:vela'; kind: 'vela'; workspaceId: string; version: number; scale: 0.65; locked: boolean;
};
export type BlockProjection = Presentation & {
  blockId: string; workspaceId: string; version: number;
  /** Legacy status field; subjectState also names it explicitly for every family. */
  resourceState: SubjectState; subjectState?: SubjectState; contentMode: 'summary' | 'reading';
} & ({ resourceId: string; subject?: Extract<BlockSubjectRef,{kind:'resource'}> } | { resourceId?: never; subject: NonResourceSubjectRef });
export type WorkspaceProjection = {
  contract: typeof CONTRACT; workspaceId: string; projectId: string | null; title: string;
  workspaceVersion: number; layoutId: string; revision: number; viewport: Viewport;
  blocks: BlockProjection[]; presence: PresencePlacement; organization: WorkspaceOrganization; canUndo: boolean; canRedo: boolean;
};
export type WorkspaceSummary = { workspaceId: string; projectId: string | null; title: string; version: number; state: string };
export type Preset = 'freeform' | 'focus' | 'columns' | 'research' | 'development';
export type NewResource = { kind: 'note'; title: string; content: string } | { kind: 'conversation'; title: string };
export type BlockTemplate = { id: string; title: string; presentation: Partial<Presentation> };
export type PlacementUpdate = { blockId: string; expectedVersion: number; presentation: Partial<Presentation> };
export const LAYOUT_OPTIMIZATION_LIMITS = { movable: 16, visibleObstacles: 64 } as const;
type Action =
  | { type: 'attachResource'; resourceId: string; presentation?: Partial<Presentation>; templateId?: string; placement?: 'nearest-free' }
  | { type: 'attachSubject'; subject: NonResourceSubjectRef; presentation?: Partial<Presentation>; templateId?: string; placement?: 'nearest-free' }
  | { type: 'createBlock'; resource: NewResource; presentation?: Partial<Presentation>; templateId?: string; placement?: 'nearest-free' }
  | { type: 'duplicateBlock'; blockId: string }
  | { type: 'detachBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; x: number; y: number; snap?: number }
  | { type: 'resizeBlock'; blockId: string; width: number; height: number; aspectRatio?: number; snap?: number }
  | { type: 'setBlockShape'; blockId: string; shape: Shape }
  | { type: 'setBlockLayer'; blockId: string; zIndex: number }
  | { type: 'setBlockLock'; blockId: string; locked: boolean }
  | { type: 'setBlockMinimized'; blockId: string; expectedVersion: number; minimized: boolean }
  | { type: 'setBlockPresentation'; blockId: string; patch: Partial<Presentation> }
  | { type: 'setPresence'; expectedVersion: number; presentation: Partial<Geometry & { locked: boolean }> }
  | { type: 'resolveLayout' }
  | { type: 'optimizeLayout'; movableBlockIds: string[] }
  | { type: 'setOrganization'; organization: OrganizationUpdate; expectedOrganizationRevision?: number }
  | { type: 'applyStructuredPreset'; preset: StructuredPreset }
  | { type: 'reorderPlacements'; order: string[] }
  | { type: 'bringAllIntoView' }
  | { type: 'layerBlock'; blockId: string; direction: 'front' | 'back' | 'raise' | 'lower' }
  | { type: 'saveLayout'; placements: PlacementUpdate[]; viewport?: Viewport }
  | { type: 'applyPreset'; preset: Preset; width: number; height: number }
  | { type: 'undoLayout' | 'redoLayout' }
  | { type: 'checkpoint'; name: string; uniqueName?: true }
  | { type: 'restoreCheckpoint'; checkpointId: string; exact?: true };
export type Command = Action & { commandId: string; workspaceId: string; expectedRevision: number; bounds?: Geometry };
export type CommandResult = WorkspaceProjection & { checkpointId?: string; unresolvedPlacementIds?: string[] };
export type LayoutIntent = 'move' | 'resize' | 'reorder' | 'mode' | 'resolve' | 'recover' | 'view' | 'optimize';
export type LayoutState = Pick<WorkspaceProjection, 'revision' | 'blocks' | 'presence' | 'organization' | 'viewport'>;
export type LayoutPreviewRequest = {
  expectedRevision?: number; placements?: PlacementUpdate[];
  presence?: { expectedVersion: number; presentation: Partial<Geometry & { locked: boolean }> };
  organization?: OrganizationUpdate; bounds?: Geometry; viewport?: Viewport; intent?: LayoutIntent;
  order?: string[]; structuredPreset?: StructuredPreset; movableBlockIds?: string[];
};
export type LayoutPreview = {
  canonical: false; baseRevision: number; blocks: BlockProjection[]; presence: PresencePlacement;
  organization: WorkspaceOrganization; viewport: Viewport; affectedPlacementIds: string[];
  unresolvedPlacementIds?: string[];
  guides: { axis: 'x' | 'y'; position: number; from: number; to: number }[]; placementAreas: Geometry[];
};
export interface WorkspacePort {
  project(workspaceId: string): Promise<WorkspaceProjection>;
  execute(command: Command): Promise<CommandResult>;
}
/** Optional production read transport, separate from navigation/lazy project.
 * The canonical host rechecks current authorization before every call. */
export interface WorkspaceInspectionPort {
  inspectWorkspace(workspaceId: string): Promise<WorkspaceProjection>;
}
