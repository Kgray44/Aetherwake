import type {
  OrganizationUpdate,
  WorkspaceOrganization,
  StructuredPreset,
} from "../workspace-engine/contracts.mts";
import type {
  BlockSubjectRef,
  NonResourceSubjectRef,
  SubjectState,
} from "../workspace-kernel/subjects.ts";
export type {
  BlockSubjectRef,
  NonResourceSubjectRef,
} from "../workspace-kernel/subjects.ts";
export type {
  OrganizationMode,
  OrganizationUpdate,
  WorkspaceOrganization,
  StructuredPreset,
} from "../workspace-engine/contracts.mts";
/** Renderer-safe contracts. Canonical resources and visual placements have separate IDs. */
export type BlockKind =
  | "conversation"
  | "note"
  | "research"
  | "task"
  | "task_group"
  | "reference"
  | "stream";
export type Shape =
  | "rectangle"
  | "rounded"
  | "circle"
  | "pill"
  | "folio"
  | "lens";
export type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};
export type Block = Geometry & {
  id: string;
  workspace_id: string;
  version: number;
  shape: Shape;
  /** Authoritative engine presentation; rotation is planar, not the renderer's 3D yaw. */
  rotation?: number;
  minimized?: boolean;
  locked?: boolean;
  materialVariant?: string;
  contentMode?: "summary" | "reading";
  subjectState?: SubjectState;
} & (
    | {
        resource_id: string;
        subject?: Extract<BlockSubjectRef, { kind: "resource" }>;
      }
    | { resource_id?: never; subject: NonResourceSubjectRef }
  );
export type Project = { id: string; title: string; version: number };
export type TaskPriority = "low" | "normal" | "high" | "urgent";
/** Public execution projection; private provider bindings and grants stay native. */
export type ConversationExecutionState =
  | "dispatching"
  | "running"
  | "provider_completed"
  | "failed"
  | "interrupted"
  | "unknown";
export type PublicConversationExecution = {
  id: string;
  resourceId: string;
  providerId: string;
  commandId: string;
  state: ConversationExecutionState;
  startedAt: string;
  endedAt: string | null;
  taskVerified: false;
  errorCode?: string;
};
/** Read-only, scoped to at most 64 requested conversations per call. Live text
 * is the existing ephemeral provider buffer, never a second transcript store. */
export type ConversationActivitySnapshot = {
  contract: "aerynth.conversation-activity@1";
  resources: { resourceId: string; available: boolean }[];
  /** Current active or latest retained execution per requested readable resource. */
  executions: PublicConversationExecution[];
  preview: {
    resourceId: string;
    executionId: string;
    providerId: string;
    cursor: number;
    text: string;
    classification: "reported" | "simulated";
  } | null;
};
export type Workspace = {
  id: string;
  project_id: string | null;
  title: string;
  version: number;
};
export type Resource = {
  id: string;
  title: string;
  kind: BlockKind;
  version: number;
  content: string;
  taskStatus?: "open" | "done";
  taskPriority?: TaskPriority;
  taskMembers?: { id: string; title: string; status: "open" | "done" }[];
  execution?: {
    id: string;
    state: string;
    errorCode?: string;
    taskVerified: false;
  };
  messageCount?: number;
  state?: "active" | "archived";
  visible?: boolean;
  available?: boolean;
  project_id?: string | null;
  providerId?: string;
  conversationRevision?: number;
  provider: "local" | "codex";
  messages: { id: string; role: string; content: string }[];
};
export type NavigationTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "constellation"; projectId: string | null };
export type WorkspacePresence = {
  id: "system:vela";
  kind: "vela";
  workspaceId: string;
  version: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: 0.65;
  locked: boolean;
};
export type DesktopSnapshot = {
  contract: "aerynth.desktop@1";
  revision: number;
  projects: Project[];
  workspaces: Workspace[];
  archivedWorkspaces?: Workspace[];
  resources: Resource[];
  blocks: Block[];
  relationships: {
    id: string;
    source_id: string;
    target_id: string;
    kind: string;
    provenance: string;
  }[];
  navigation: NavigationTarget;
  history: NavigationTarget[];
  activeWorkspaceId: string | null;
  layoutVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  hasCheckpoint: boolean;
  navigationBlocks?: Block[];
  viewport?: { x: number; y: number; zoom: number; displayId?: string };
  organization?: WorkspaceOrganization;
  presence?: WorkspacePresence;
  conversationBranches?: {
    id: string;
    parentResourceId: string;
    childResourceId: string;
    sourceMessageId: string;
    mode: string;
    createdAt?: string;
    provenance: string;
  }[];
  graphRevision?: number;
};
type DesktopAction =
  | { type: "snapshot" }
  | { type: "createProject"; title: string }
  | { type: "createWorkspace"; title: string; projectId: string | null }
  | {
      type: "renameWorkspace";
      workspaceId: string;
      title: string;
      expectedVersion: number;
    }
  | {
      type: "archiveWorkspace";
      workspaceId: string;
      expectedVersion: number;
      archived: boolean;
    }
  | {
      type: "archiveSubject";
      kind: "project" | "resource";
      id: string;
      expectedVersion: number;
      archived: boolean;
    }
  | { type: "relate"; sourceId: string; targetId: string; kind: string }
  | { type: "unrelate"; relationshipId: string }
  | {
      type: "setTaskGroupMembers";
      groupId: string;
      expectedVersion: number;
      taskIds: string[];
    }
  | { type: "navigate"; target: NavigationTarget }
  | { type: "back" }
  | {
      type: "setPresence";
      workspaceId: string;
      expectedVersion: number;
      placement: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        locked?: boolean;
      };
    }
  | { type: "resolveLayout"; workspaceId: string }
  | {
      type: "setOrganization";
      workspaceId: string;
      organization: OrganizationUpdate;
      expectedOrganizationRevision: number;
    }
  | {
      type: "applyStructuredPreset";
      workspaceId: string;
      preset: StructuredPreset;
    }
  | { type: "reorderPlacements"; workspaceId: string; order: string[] }
  | { type: "bringAllIntoView"; workspaceId: string }
  | {
      type: "layerBlock";
      blockId: string;
      direction: "front" | "back" | "raise" | "lower";
    }
  | {
      type: "setViewport";
      workspaceId: string;
      viewport: NonNullable<DesktopSnapshot["viewport"]>;
    }
  | {
      type: "createResource";
      kind: BlockKind;
      title: string;
      provider?: "local" | "codex";
      workspaceId: string | null;
    }
  | { type: "attach"; workspaceId: string; resourceId: string }
  | { type: "detach"; blockId: string; expectedVersion: number }
  | {
      type: "lockBlock";
      blockId: string;
      expectedVersion: number;
      locked: boolean;
    }
  | {
      type: "geometry";
      blockId: string;
      expectedVersion: number;
      placement: Geometry;
      shape: Shape;
      rotation?: number;
    }
  | {
      type: "content";
      resourceId: string;
      expectedVersion: number;
      content: string;
    }
  | {
      type: "taskStatus";
      resourceId: string;
      expectedVersion: number;
      status: "open" | "done";
    }
  | {
      type: "taskPriority";
      resourceId: string;
      expectedVersion: number;
      priority: TaskPriority;
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "checkpoint" }
  | { type: "restore" };
export type DesktopCommand = DesktopAction & {
  expectedLayoutVersion?: number;
  bounds?: { x: number; y: number; width: number; height: number };
};
