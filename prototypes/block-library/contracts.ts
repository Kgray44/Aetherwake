import type {
  BlockKind,
  DesktopSnapshot,
} from "../application-contract/contracts.ts";
import type {
  Presentation,
  OrganizationUpdate,
  WorkspaceOrganization,
  GridSpan,
} from "../workspace-engine/contracts.mts";
import type {
  NonResourceSubjectRef,
  SubjectState,
} from "../workspace-kernel/subjects.ts";

export type { BlockKind, Presentation };
export type Availability = {
  state:
    | "available"
    | "disabled"
    | "setup_required"
    | "unsupported"
    | "unknown";
  reason?: string;
};
/** A live host snapshot. Absent capability entries are unavailable, never inferred. */
export type LibraryCapabilities = {
  revision: number;
  kinds: Partial<Record<BlockKind, Availability>>;
  providers: Partial<Record<"local" | "codex", Availability>>;
  velaPlanning: Availability;
  subjects?: Partial<Record<SubjectBlockKind, Availability>>;
};
export type BlockCategory =
  | "conversation"
  | "knowledge"
  | "planning"
  | "observability"
  | "organization";
export type SubjectBlockKind =
  | "project_overview"
  | "resource_browser"
  | "collection_browser";
export type BlockInstanceKind = BlockKind | SubjectBlockKind;
export type BlockDefinition<K extends BlockInstanceKind = BlockKind> = {
  id: string;
  version: 1;
  iconId: string;
  kind: K;
  title: string;
  category: BlockCategory;
  description: string;
  keywords: readonly string[];
  controls: readonly string[];
  providerRequirement:
    | "canonical-local"
    | "conversation-provider"
    | "recorded-events";
  preview: string;
  defaultPresentation: Presentation;
  compatibleResourceKinds: readonly BlockKind[];
  minimumSize: { width: number; height: number };
  supportedShapes: readonly Presentation["shape"][];
  requiredServices: readonly string[];
  configurationSchema: { version: 1; fields: readonly string[] };
  defaultConfiguration: BlockConfiguration;
  compatibleSubjectKinds?: readonly NonResourceSubjectRef["kind"][];
};
/** Presentation preferences only. Canonical text, messages, credentials and provider settings are excluded. */
export type BlockConfiguration = {
  schemaVersion: 1;
  textScale: number;
  contentMode: "auto" | "compact" | "reading";
};
export type BlockCapabilityState = { id: string; availability: Availability };
export type LibraryPreferences = {
  version: number;
  favorites: BlockInstanceKind[];
  recent: BlockInstanceKind[];
};
export type ResourceDiscoveryInput = {
  workspaceId: string;
  kind: BlockKind;
  query?: string;
  afterId?: string;
  limit?: number;
};
export type ResourceCandidate = {
  id: string;
  title: string;
  kind: BlockKind;
  projectId: string | null;
  version: number;
};
export type ResourceDiscoveryPage = {
  resources: ResourceCandidate[];
  nextCursor: string | null;
};
export type AttachBlockInput = {
  commandId: string;
  workspaceId: string;
  expectedLayoutVersion: number;
  kind: BlockKind;
  resourceId: string;
  expectedResourceVersion: number;
  presentation?: Partial<Presentation>;
  configuration?: BlockConfiguration;
};
export type BlockInstanceSettings = {
  placementId: string;
  manifestVersion: number;
  version: number;
  configuration: BlockConfiguration;
} & (
  | { resourceId: string; kind: BlockKind; subject?: never }
  | {
      resourceId?: never;
      kind: SubjectBlockKind;
      subject: NonResourceSubjectRef;
    }
);
export type CreateBlockInput = {
  commandId: string;
  workspaceId: string;
  expectedLayoutVersion: number;
  kind: BlockKind;
  title: string;
  provider?: "local" | "codex";
  presentation?: Partial<Presentation>;
  configuration?: BlockConfiguration;
};
export type CreatedBlock = {
  resourceId: string;
  placementId: string;
  workspaceId: string;
};
export interface BlockLibraryHostPort {
  capabilities(): Promise<LibraryCapabilities>;
  createBlock(input: CreateBlockInput): Promise<CreatedBlock>;
  /** Optional while older hosts upgrade. The UI reports unavailable functionality explicitly. */
  findResources?(input: ResourceDiscoveryInput): Promise<ResourceDiscoveryPage>;
  attachBlock?(input: AttachBlockInput): Promise<CreatedBlock>;
  preferences?(): Promise<LibraryPreferences>;
  setFavorite?(input: {
    kind: BlockInstanceKind;
    favorite: boolean;
    expectedVersion: number;
  }): Promise<LibraryPreferences>;
  getBlockSettings?(placementId: string): Promise<BlockInstanceSettings>;
  configureBlock?(input: {
    placementId: string;
    expectedVersion: number;
    configuration: BlockConfiguration;
  }): Promise<BlockInstanceSettings>;
  subjectTargets?(workspaceId: string): Promise<SubjectTargets>;
  createSubjectBlock?(
    input: CreateSubjectBlockInput,
  ): Promise<CreatedSubjectBlock>;
}
export type SubjectTargets = {
  projectId: string | null;
  projects: { id: string; title: string; version: number }[];
  collections: {
    id: string;
    title: string;
    projectId: string | null;
    version: number;
  }[];
  globalQueryAllowed: boolean;
  truncated: boolean;
};
export type CreateSubjectBlockInput = {
  commandId: string;
  workspaceId: string;
  expectedLayoutVersion: number;
  kind: SubjectBlockKind;
  subject: NonResourceSubjectRef;
  presentation?: Partial<Presentation>;
  configuration?: BlockConfiguration;
};
export type CreatedSubjectBlock = {
  workspaceId: string;
  placementId: string;
  subject: NonResourceSubjectRef;
};
export type BrowseResourcesInput = {
  subject: NonResourceSubjectRef;
  query?: string;
  kind?: BlockKind;
  unplacedOnly?: boolean;
  afterId?: string;
  limit?: number;
};
export type BrowseResourcesPage = {
  resources: (ResourceCandidate & {
    placementCount: number;
    placementCountComplete: boolean;
  })[];
  nextCursor: string | null;
};
export type ProjectOverview = {
  project: { id: string; title: string; version: number };
  workspaces: { id: string; title: string; version: number }[];
  workspaceListComplete: boolean;
  resourcesByKind: Partial<Record<BlockKind, number>>;
  tasks: { open: number; done: number };
  resourceCountsComplete: boolean;
  recentEvents: {
    id: string;
    type: string;
    occurredAt: string;
    entityKind: string;
    entityId: string;
  }[];
};
export interface SubjectExperiencePort {
  projectOverview(projectId: string): Promise<ProjectOverview>;
  browseResources(input: BrowseResourcesInput): Promise<BrowseResourcesPage>;
}

export type TemplateResourceRole = {
  key: string;
  label: string;
  source:
    | {
        mode: "new";
        kind: BlockKind;
        title: string;
        provider?: "local" | "codex";
      }
    | {
        mode: "reference";
        kind: BlockKind;
        resourceId: string;
        expectedVersion: number;
      };
};
export type TemplateSubjectBinding =
  | { mode: "reference"; subject: NonResourceSubjectRef }
  | {
      mode: "project-context";
      view: "project" | "resource-query";
      query?: string;
      kinds?: string[];
    };
export type TemplatePlacementRole = {
  key: string;
  presentation: Presentation;
  span?: GridSpan;
  configuration?: BlockConfiguration;
} & (
  | { resourceKey: string; subjectBinding?: never }
  | { resourceKey?: never; subjectBinding: TemplateSubjectBinding }
);
/** Contains no note text, transcripts, execution/session bindings, credentials or Vela placement. */
export type TemplateBody = {
  schemaVersion: 1 | 2;
  organization: Omit<WorkspaceOrganization, "revision" | "structured"> & {
    structured: Omit<WorkspaceOrganization["structured"], "order" | "spans">;
  };
  resources: TemplateResourceRole[];
  placements: TemplatePlacementRole[];
  groups: { groupKey: string; taskKeys: string[] }[];
  viewport: { x: number; y: number; zoom: number };
};
export type TemplateDraft = {
  name: string;
  description: string;
  tags: string[];
  body: TemplateBody;
};
export type WorkspaceTemplate = TemplateDraft & {
  id: string;
  version: number;
  state: "active" | "archived";
  source: "saved" | "preset" | "vela";
  createdAt: string;
  updatedAt: string;
  provenance?: { requestId: string; providerId: string; model?: string };
};
export type TemplateSummary = Omit<WorkspaceTemplate, "body"> & {
  resourceCount: number;
  placementCount: number;
  mode: WorkspaceOrganization["mode"];
};
export type TemplateApplyInput = {
  commandId: string;
  templateId: string;
  expectedVersion: number;
  title: string;
  projectId: string | null;
  expectedProjectVersion?: number;
};
export type TemplatePreview = {
  templateId: string;
  version: number;
  title: string;
  projectId: string | null;
  newResourceCount: number;
  referenceCount: number;
  placementCount: number;
  resources: {
    key: string;
    label: string;
    kind: BlockKind;
    mode: "new" | "reference";
    resourceId?: string;
  }[];
  body: TemplateBody;
};
export type AppliedTemplate = {
  workspaceId: string;
  resourceIds: Record<string, string>;
  placementIds: Record<string, string>;
  templateId: string;
  templateVersion: number;
};
export type VelaTemplateRequest = {
  requestId: string;
  prompt: string;
  projectId: string | null;
};
export type VelaTemplatePlan = TemplateDraft & {
  provenance: { requestId: string; providerId: string; model?: string };
};
export type SaveTemplateInput = TemplateDraft & {
  id?: string;
  expectedVersion?: number;
  source?: "saved" | "vela";
  provenance?: VelaTemplatePlan["provenance"];
};
export interface WorkspaceTemplatePort {
  capabilities(): Promise<LibraryCapabilities>;
  listTemplates(input?: {
    query?: string;
    includeArchived?: boolean;
  }): Promise<TemplateSummary[]>;
  getTemplate(id: string): Promise<WorkspaceTemplate>;
  saveTemplate(input: SaveTemplateInput): Promise<WorkspaceTemplate>;
  renameTemplate(input: {
    id: string;
    expectedVersion: number;
    name: string;
  }): Promise<WorkspaceTemplate>;
  archiveTemplate(input: {
    id: string;
    expectedVersion: number;
    archived: boolean;
  }): Promise<WorkspaceTemplate>;
  previewTemplate(input: TemplateApplyInput): Promise<TemplatePreview>;
  applyTemplate(input: TemplateApplyInput): Promise<AppliedTemplate>;
  requestVelaTemplate(input: VelaTemplateRequest): Promise<VelaTemplatePlan>;
}
export type CaptureChoices = Record<string, "reference" | "new">;
export type SubjectCaptureChoices = Record<
  string,
  "reference" | "project-context"
>;
export type WorkspaceFromResourcesInput = {
  commandId: string;
  title: string;
  projectId: string | null;
  expectedProjectVersion?: number;
  resources: { resourceId: string; expectedVersion: number }[];
  organization?: OrganizationUpdate;
};
export type WorkspaceConstructionPreview = {
  title: string;
  projectId: string | null;
  body: TemplateBody;
  resourceIds: string[];
};
export type ConstructedWorkspace = {
  createdWorkspaceId: string;
  resourceIds: string[];
  placementIds: string[];
  receipt: {
    commandId: string;
    operation: "workspaceFromResources";
    workspaceId: string;
  };
};
export type TemplateMountOptions = {
  projectId: string | null;
  expectedProjectVersion?: number;
  currentWorkspace?: () => DesktopSnapshot | null;
  currentConfigurations?: () => Record<string, BlockConfiguration>;
  onApplied(result: AppliedTemplate): void | Promise<void>;
  onClose(): void;
};
/** Trusted synchronous host seam. Its atomic callback must roll back SQLite AND any in-memory canonical state. */
export interface CanonicalTemplateHost<Database = unknown> {
  readonly db: Database;
  atomic<T>(operation: () => T): T;
  capabilities(): LibraryCapabilities;
  readProject(
    id: string,
  ): { id: string; version: number; state: string; authorized: boolean } | null;
  readResource(id: string): {
    id: string;
    kind: BlockKind;
    projectId: string | null;
    version: number;
    state: string;
    authorized: boolean;
  } | null;
  readWorkspace(id: string): {
    id: string;
    projectId: string | null;
    layoutVersion: number;
    state: string;
    authorized: boolean;
  } | null;
  findResources?(input: ResourceDiscoveryInput): ResourceDiscoveryPage;
  readPlacement?(id: string): {
    id: string;
    resourceId?: string;
    subject?: NonResourceSubjectRef;
    workspaceId: string;
    authorized: boolean;
  } | null;
  readSubject?(subject: NonResourceSubjectRef): {
    authorized: boolean;
    state: SubjectState;
  };
  placeSubject?(input: {
    workspaceId: string;
    subject: NonResourceSubjectRef;
    presentation: Presentation;
  }): { id: string };
  subjectTargets?(workspaceId: string): SubjectTargets;
  createWorkspace(input: {
    title: string;
    projectId: string | null;
    organization: OrganizationUpdate;
    viewport: TemplateBody["viewport"];
  }): { id: string };
  /** Creates only a resource. Placement is a separate canonical operation. Never calls a provider execution. */
  createResource(input: {
    kind: BlockKind;
    title: string;
    provider?: "local" | "codex";
    projectId: string | null;
  }): { id: string };
  placeResource(input: {
    workspaceId: string;
    resourceId: string;
    presentation: Presentation;
  }): { id: string };
  /** Apply once after placements, remapping role order/spans to actual placement IDs. Existing Vela presence is left to the engine. */
  setOrganization(input: {
    workspaceId: string;
    organization: OrganizationUpdate;
    viewport: TemplateBody["viewport"];
  }): void;
  setTaskGroupMembers(input: { groupId: string; taskIds: string[] }): void;
}
export interface VelaTemplatePlanner {
  plan(
    input: VelaTemplateRequest & { supportedKinds: BlockKind[] },
  ): Promise<VelaTemplatePlan>;
}
