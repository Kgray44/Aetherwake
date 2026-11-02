import type { BlockKind, DesktopSnapshot } from '../application-contract/contracts.ts';
import type { Presentation, OrganizationUpdate, WorkspaceOrganization, GridSpan } from '../workspace-engine/contracts.mts';

export type { BlockKind, Presentation };
export type Availability = { state: 'available' | 'disabled' | 'setup_required' | 'unsupported' | 'unknown'; reason?: string };
/** A live host snapshot. Absent capability entries are unavailable, never inferred. */
export type LibraryCapabilities = {
  revision: number;
  kinds: Partial<Record<BlockKind, Availability>>;
  providers: Partial<Record<'local' | 'codex', Availability>>;
  velaPlanning: Availability;
};
export type BlockCategory = 'conversation' | 'knowledge' | 'planning' | 'observability';
export type BlockDefinition = {
  kind: BlockKind; title: string; category: BlockCategory; description: string; keywords: readonly string[];
  controls: readonly string[]; providerRequirement: 'canonical-local' | 'conversation-provider' | 'recorded-events';
  preview: string; defaultPresentation: Presentation;
};
export type CreateBlockInput = {
  commandId: string; workspaceId: string; expectedLayoutVersion: number;
  kind: BlockKind; title: string; provider?: 'local' | 'codex'; presentation?: Partial<Presentation>;
};
export type CreatedBlock = { resourceId: string; placementId: string; workspaceId: string };
export interface BlockLibraryHostPort {
  capabilities(): Promise<LibraryCapabilities>;
  createBlock(input: CreateBlockInput): Promise<CreatedBlock>;
}

export type TemplateResourceRole = {
  key: string; label: string;
  source: { mode: 'new'; kind: BlockKind; title: string; provider?: 'local' | 'codex' }
    | { mode: 'reference'; kind: BlockKind; resourceId: string; expectedVersion: number };
};
export type TemplatePlacementRole = {
  key: string; resourceKey: string; presentation: Presentation; span?: GridSpan;
};
/** Contains no note text, transcripts, execution/session bindings, credentials or Vela placement. */
export type TemplateBody = {
  schemaVersion: 1;
  organization: Omit<WorkspaceOrganization, 'revision' | 'structured'> & {
    structured: Omit<WorkspaceOrganization['structured'], 'order' | 'spans'>;
  };
  resources: TemplateResourceRole[];
  placements: TemplatePlacementRole[];
  groups: { groupKey: string; taskKeys: string[] }[];
  viewport: { x: number; y: number; zoom: number };
};
export type TemplateDraft = { name: string; description: string; tags: string[]; body: TemplateBody };
export type WorkspaceTemplate = TemplateDraft & {
  id: string; version: number; state: 'active' | 'archived'; source: 'saved' | 'preset' | 'vela';
  createdAt: string; updatedAt: string;
  provenance?: { requestId: string; providerId: string; model?: string };
};
export type TemplateSummary = Omit<WorkspaceTemplate, 'body'> & {
  resourceCount: number; placementCount: number; mode: WorkspaceOrganization['mode'];
};
export type TemplateApplyInput = {
  commandId: string; templateId: string; expectedVersion: number; title: string;
  projectId: string | null; expectedProjectVersion?: number;
};
export type TemplatePreview = {
  templateId: string; version: number; title: string; projectId: string | null;
  newResourceCount: number; referenceCount: number; placementCount: number;
  resources: { key: string; label: string; kind: BlockKind; mode: 'new' | 'reference'; resourceId?: string }[];
  body: TemplateBody;
};
export type AppliedTemplate = {
  workspaceId: string; resourceIds: Record<string, string>; placementIds: Record<string, string>; templateId: string; templateVersion: number;
};
export type VelaTemplateRequest = { requestId: string; prompt: string; projectId: string | null };
export type VelaTemplatePlan = TemplateDraft & { provenance: { requestId: string; providerId: string; model?: string } };
export type SaveTemplateInput = TemplateDraft & { id?: string; expectedVersion?: number; source?: 'saved' | 'vela'; provenance?: VelaTemplatePlan['provenance'] };
export interface WorkspaceTemplatePort {
  capabilities(): Promise<LibraryCapabilities>;
  listTemplates(input?: { query?: string; includeArchived?: boolean }): Promise<TemplateSummary[]>;
  getTemplate(id: string): Promise<WorkspaceTemplate>;
  saveTemplate(input: SaveTemplateInput): Promise<WorkspaceTemplate>;
  renameTemplate(input: { id: string; expectedVersion: number; name: string }): Promise<WorkspaceTemplate>;
  archiveTemplate(input: { id: string; expectedVersion: number; archived: boolean }): Promise<WorkspaceTemplate>;
  previewTemplate(input: TemplateApplyInput): Promise<TemplatePreview>;
  applyTemplate(input: TemplateApplyInput): Promise<AppliedTemplate>;
  requestVelaTemplate(input: VelaTemplateRequest): Promise<VelaTemplatePlan>;
}
export type CaptureChoices = Record<string, 'reference' | 'new'>;
export type TemplateMountOptions = {
  projectId: string | null; expectedProjectVersion?: number;
  currentWorkspace?: () => DesktopSnapshot | null;
  onApplied(result: AppliedTemplate): void | Promise<void>; onClose(): void;
};
/** Trusted synchronous host seam. Its atomic callback must roll back SQLite AND any in-memory canonical state. */
export interface CanonicalTemplateHost<Database = unknown> {
  readonly db: Database;
  atomic<T>(operation: () => T): T;
  capabilities(): LibraryCapabilities;
  readProject(id: string): { id: string; version: number; state: string; authorized: boolean } | null;
  readResource(id: string): { id: string; kind: BlockKind; projectId: string | null; version: number; state: string; authorized: boolean } | null;
  readWorkspace(id: string): { id: string; projectId: string | null; layoutVersion: number; state: string; authorized: boolean } | null;
  createWorkspace(input: { title: string; projectId: string | null; organization: OrganizationUpdate; viewport: TemplateBody['viewport'] }): { id: string };
  /** Creates only a resource. Placement is a separate canonical operation. Never calls a provider execution. */
  createResource(input: { kind: BlockKind; title: string; provider?: 'local' | 'codex'; projectId: string | null }): { id: string };
  placeResource(input: { workspaceId: string; resourceId: string; presentation: Presentation }): { id: string };
  /** Apply once after placements, remapping role order/spans to actual placement IDs. Existing Vela presence is left to the engine. */
  setOrganization(input: { workspaceId: string; organization: OrganizationUpdate; viewport: TemplateBody['viewport'] }): void;
  setTaskGroupMembers(input: { groupId: string; taskIds: string[] }): void;
}
export interface VelaTemplatePlanner {
  plan(input: VelaTemplateRequest & { supportedKinds: BlockKind[] }): Promise<VelaTemplatePlan>;
}
