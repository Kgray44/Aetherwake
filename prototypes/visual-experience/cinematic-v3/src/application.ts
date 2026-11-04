import type {
  GraphActions,
  SpatialRenderLayer,
} from "../../../constellation/spatial-types.ts";
import {
  mountConstellation,
  type ConstellationViewOptions,
} from "../../../constellation/view.ts";
import "../../../constellation/style.css";
import type { Policy } from "../../../constellation/types.ts";
import type { MotionCoordinator } from "./motion";
import { footprint } from "../../../workspace-engine/collisions.mts";
import { previewLayout } from "../../../workspace-engine/organization.mts";
import type {
  LayoutState,
  LayoutPreview,
  LayoutPreviewRequest,
} from "../../../workspace-engine/contracts.mts";
import {
  layoutState,
  previewBlock as desktopPreviewBlock,
} from "./organization-preview";
import "./application.css";
import "./workspace-grid.css";
import { createWorkspaceGrid } from "./workspace-grid.ts";
import {
  mountDirectManipulation,
  mountWorkspaceLayoutControls,
  type DirectGesturePresentation,
} from "../../../block-library/direct-manipulation.ts";
import "../../../block-library/direct-manipulation.css";
import {
  sculptureRegion,
  overviewPresence,
  overviewChromeBottom,
  presenceTravelOccludes,
} from "./presence-layout";
import {
  createManagerState,
  mountConversationManager,
} from "../../../conversation-product/src/ui.ts";
import {
  ConversationDraftSession,
  flushConversationDraftSessions,
} from "../../../conversation-product/src/draft-session.ts";
import { ConversationViewPersistence } from "../../../conversation-product/src/view-persistence.ts";
import type {
  ConversationProductPort,
  ProductCommandMap,
} from "../../../conversation-product/src/contracts.ts";
import "../../../conversation-product/src/style.css";
import "./optical-controls.css";
import "../../../conversation-product/src/picker.css";
import { conversationDisclosures, enhanceConversationSelect } from "../../../conversation-product/src/picker.ts";
import { mountContextualResources, mountContextualStream } from "./workspace-context-views.ts";
import "./workspace-context-views.css";
import { mountBlockChat } from "../../../block-library/chat-view.ts";
import { mountVelaPanel } from "../../../vela-core/src/panel.ts";
import "../../../vela-core/src/panel.css";
import { createVelaClient } from "./vela-client";
import type { VelaPlan, VelaRequest, VelaState } from "../../../vela-core/src/contracts.ts";
import { createVelaExperience } from "./vela-experience";
import { createVelaManifestation } from "./vela-manifestation.ts";
import { createVelaMissionView } from "./vela-missions.ts";
import type { MissionResponse } from "../../../integrated-backend/src/mission-contracts.mts";
import { createConversationExecutionPort } from "./conversation-execution";
import { workspaceWheelFactor } from "./workspace-wheel";
import { returnFocusAfterDialogClose } from "./focus-return";
import {
  createContextualSurfaces,
  type ContextualSurfaceRequest,
} from "./contextual-surfaces";
import "./contextual-surfaces.css";
import {
  mountBlockLibrary,
  mountWorkspaceTemplates,
} from "../../../block-library/view.ts";
import "../../../block-library/style.css";
import { createLibraryClient } from "./library-client";
import { createMediaClient } from "./media-client";
import {
  canonicalMediaUrl,
  mediaDefaultGeometry,
} from "../../../block-library/media-policy.ts";
import {
  mountMediaExperience,
  type MediaExperience,
} from "../../../block-library/media-view.ts";
import { createNotesClient } from "./notes-client";
import { NoteSession } from "../../../block-library/note-session.ts";
import { mountNoteExperience } from "../../../block-library/note-view.ts";
import "../../../block-library/note-view.css";
import { mountResourceLinks } from "../../../block-library/resource-links-view.ts";
import "../../../block-library/resource-links-view.css";
import { createRelatedResourcesPort } from "./related-resources";
import { createResourceOpener } from "./resource-opening.ts";
import { createResourceSurface } from "./resource-surface.ts";
import { mountProviderConnections } from "./provider-connections.ts";
import { mountEnvironmentNavigator } from "./environment-navigator.ts";
import "./environment-navigator.css";
import { mountWorkspaceActions } from "./workspace-actions.ts";
import "./workspace-actions.css";
import { createClipboardClient } from "../../../application-contract/clipboard.ts";
import { createControlMotion } from "./control-motion.ts";
import "./control-motion.css";
import { createProductClients } from "./product-clients.ts";
import { mountAgentLibrary } from "../../../agent-product/view.ts";
import "../../../agent-product/view.css";
import type { ExperienceMotionPort } from "../../../application-contract/motion.ts";
import type { ChecklistReference } from "../../../application-contract/checklist.ts";
import { mountChecklistExperience } from "../../../checklist-product/view.ts";
import { mountChecklistCreator } from "../../../checklist-product/creator.ts";
import "../../../checklist-product/view.css";
import "../../../checklist-product/creator.css";
import {
  mountAgentBlockExperience,
  type AgentBlockProjection,
} from "../../../block-library/agent-view.ts";
import "../../../block-library/agent-view.css";
import { mountTimelineExperience } from "../../../block-library/timeline-view.ts";
import type { TimelineExternalOpen } from "../../../block-library/timeline-presentation.ts";
import { mountTaskTrackerExperience } from "../../../block-library/task-tracker-view.ts";
import { mountTaskObjectiveCreator } from "../../../block-library/task-objective-creator.ts";
import type { TaskObjectiveDocument } from "../../../task-product/contracts.ts";
import type {
  TaskTargetKind,
  TaskReferenceTarget,
} from "../../../application-contract/task-targets.ts";
import "../../../block-library/task-tracker-view.css";
import "../../../block-library/task-objective-creator.css";
import "../../../block-library/timeline-view.css";
import { CHATGPT_PLAN_PROVIDER, type ProviderConnectionStatus } from "../../../application-contract/provider-connections.ts";
import { mountDirectResourceExperience } from "../../../block-library/direct-resource-view.ts";
import "../../../block-library/direct-resource-view.css";
import type {
  ResourceOpeningInput,
  ResourceOpeningResult,
} from "../../../application-contract/resource-opening.ts";
import {
  unavailableBlock,
  showUnavailableBlock,
} from "../../../block-library/availability-view.ts";
import "../../../block-library/availability-view.css";
import {
  blockIdentity,
  type SubjectIdentity,
  type BlockIdentityModel,
} from "../../../block-library/identity-model.ts";
import { mountBlockIdentity } from "../../../block-library/identity-view.ts";
import type {
  BlockFootprint,
  BlockApproachTarget,
} from "../../../block-library/presentation-policy.ts";
import {
  approachWorkspaceCard,
  type WorkspaceView,
} from "./workspace-approach";
import { workspaceBodyEligible } from "./working-footprints.ts";
import {
  BUILTIN_BLOCKS,
  REGISTERED_BLOCKS,
} from "../../../block-library/registry.ts";
import "../../../block-library/identity-view.css";
import { mountSubjectExperience } from "../../../block-library/subject-view.ts";
import "../../../block-library/subject-view.css";
import { mountTaskGroupExperience } from "../../../block-library/task-group-view.ts";
import "../../../block-library/task-group-view.css";
import {
  mountEventExperience,
  readRecentEvents,
  type ReplayWindow,
  filterRecordedEvents,
  type EventWindow,
} from "../../../block-library/event-view.ts";
import "../../../block-library/event-view.css";
import type { StreamEvent } from "../../../integrated-backend/src/contracts.mts";
import type { SubjectExperiencePort } from "../../../block-library/contracts.ts";
import type { BlockInstanceSettings } from "../../../block-library/contracts.ts";
import { subjectBlockKind } from "../../../block-library/registry.ts";
import type { BlockInstanceKind } from "../../../block-library/contracts.ts";
import {
  applyBlockConfiguration,
  mountBlockConfiguration,
} from "../../../block-library/configuration-view.ts";
import type {
  Block,
  BlockKind,
  DesktopCommand,
  DesktopSnapshot,
  Geometry,
  OrganizationMode,
  OrganizationUpdate,
  StructuredPreset,
  Resource,
  Shape,
  WorkspacePresence,
  WorkspacePanelId,
  WorkspacePanelPreferences,
} from "../../../application-contract/contracts.ts";
import { WORKSPACE_PANELS } from "../../../application-contract/contracts.ts";
type Hooks = {
  motion: MotionCoordinator;
  wake(): void;
  workingBodyWidth(id: string): number | undefined;
  selectedCard(): string | null;
  replace(s: DesktopSnapshot): void;
  status(s: string): void;
  layout(): void;
  home(): void;
  focus(id: string): void;
  vela(s: "idle" | "working" | "attention" | "unavailable"): void;
};
export type Application = ReturnType<typeof installApplication>;
const el = <T extends HTMLElement = HTMLElement>(
  q: string,
  parent: ParentNode = document,
) => parent.querySelector<T>(q)!;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function installApplication(hooks: Hooks) {
  const host = window.aerynthHost!;
  const controlMotion = createControlMotion({
    motion: hooks.motion,
    wake: hooks.wake,
    root: document.body,
  });
  const clipboardClient = createClipboardClient(
    host.copyText ? { copyText: (text) => host.copyText!(text) } : null,
  );
  const copyText = async (text: string) => {
    const result = await clipboardClient.copyText(text);
    if (result.status !== "copied")
      throw Error(
        result.status === "unknown"
          ? "Copy could not be confirmed."
          : result.status === "denied"
            ? "Use Copy from the active application window."
            : "Copy is unavailable right now.",
      );
  };
  const conversationExecution = createConversationExecutionPort({
    command: (name, input) => host.command!(name, input),
    onEvent: (listener) => host.onEvent?.(listener) ?? (() => {}),
    visible: () => !document.hidden && document.hasFocus(),
    onError: (error) =>
      hooks.status(`Conversation activity: ${(error as Error).message}`),
  });
  const surfaces = createContextualSurfaces({
    motion: hooks.motion,
    wake: hooks.wake,
    viewport: () => ({ width: innerWidth, height: innerHeight }),
    safeInsets: () => ({
      top:
        Math.max(
          el(".topbar").getBoundingClientRect().bottom,
          el(".brand").getBoundingClientRect().bottom,
        ) + 12,
      left: 16,
      right: 16,
      bottom: Math.max(
        24,
        innerHeight - el(".provenance").getBoundingClientRect().top + 12,
      ),
    }),
  });
  addEventListener("resize", surfaces.viewportChanged);
  let velaPanel: ReturnType<typeof mountVelaPanel> | null = null;
  const velaMissions = createVelaMissionView(document, async (request) =>
    (await host.command!("missions", request)) as MissionResponse,
    async workspaceId => { await run({ type: "navigate", target: { kind: "workspace", workspaceId } }); },
  );
  document.addEventListener("visibilitychange", velaMissions.observe);
  let velaOpen = false;
  let velaOpening = 0;
  let velaRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const velaContent = document.createElement("div");
  velaContent.className = "application-vela-content";
  const velaManifestation = createVelaManifestation({
    motion: hooks.motion,
    root: velaContent,
    wake: hooks.wake,
    resize: (size) => surfaces.resize("vela", size),
  });
  const velaExperience = createVelaExperience({
    motion: hooks.motion,
    root: velaContent,
    anchor: el("#vela"),
    wake: hooks.wake,
    resize: (size) => surfaces.resize("vela", size),
    phaseOnly: true,
  });
  addEventListener(
    "pagehide",
    () => {
      velaManifestation.dispose();
      velaExperience.dispose();
    },
    { once: true },
  );
  const velaClient = createVelaClient({
    command: (name, input) => host.command!(name, input),
    activeCard: () => {
      const blockId = hooks.selectedCard();
      return blockId && state?.navigation.kind === "workspace"
        ? { workspaceId: state.navigation.workspaceId, blockId }
        : undefined;
    },
    presentation: () =>
      state?.navigation.kind === "workspace" && state.activeWorkspaceId
        ? { workspaceId: state.activeWorkspaceId, bounds: viewBounds() }
        : null,
    presentationFence: () => {
      const current = resourceOpener.capture();
      const opening = velaOpening;
      return () => velaOpen && velaOpening === opening && current();
    },
    changed: async (name, result, mayPresent) => {
      await enqueue(async () => {
        const previousWorkspaceId = state?.activeWorkspaceId;
        const next = (await host.command!("desktop", {
          type: "snapshot",
        })) as DesktopSnapshot;
        apply(next);
        if (
          name === "apply" &&
          next.activeWorkspaceId &&
          next.activeWorkspaceId !== previousWorkspaceId
        ) {
          const planId = (result as { id?: string })?.id;
          const observed = (await host.command!("vela", {
            name: "state",
            input: {},
          })) as {
            receipts: {
              planId: string;
              state: string;
              createdWorkspaceId?: string;
            }[];
          };
          if (
            observed.receipts.some(
              (receipt) =>
                receipt.planId === planId &&
                receipt.state === "applied" &&
                receipt.createdWorkspaceId === next.activeWorkspaceId,
            )
          )
            await command({
              type: "bringAllIntoView",
              workspaceId: next.activeWorkspaceId,
            });
        }
      });
      const request = name === "request" ? (result as VelaRequest) : undefined;
      const applied = name === "apply" ? (result as VelaPlan) : undefined;
      const planId =
        request?.state === "completed"
          ? request.planId
          : applied?.state === "applied" &&
              applied.steps.at(-1)?.action.type === "openResource"
            ? applied.id
            : undefined;
      if (!planId || !mayPresent?.()) return;
      try {
        const observed = (await host.command!("vela", {
          name: "state",
          input: {},
        })) as VelaState;
        const receipt = observed.receipts.find(
          (item) => item.planId === planId && item.state === "applied" && item.openResourceId,
        );
        if (!receipt?.openResourceId || !mayPresent()) return;
        const opened = await resourceOpener.open({
          resourceId: receipt.openResourceId,
          origin: { source: "vela" },
        });
        if (opened.status === "ready") surfaces.close("vela");
      } catch (error) {
        report(error);
      }
    },
    observed: (value) => {
      if (velaOpen) velaPanel?.observeLiveAnswer(value.activeAnswer);
      if (
        value.requests.some((r) => r.state === "planning") ||
        value.receipts.some((r) => r.state === "started")
      )
        hooks.vela("working");
      else if (
        value.preferences.mode !== "quiet" &&
        value.attention.some(
          (e) =>
            e.disposition === "interrupt" && !e.reviewedAt && !e.dismissedAt,
        )
      )
        hooks.vela("attention");
      else hooks.vela("idle");
    },
  });
  const mediaClient = createMediaClient({
    command: (name, input) => host.command!(name, input),
    apply: (snapshot) => apply(snapshot),
  });
  const libraryClient = {
    ...createLibraryClient({
      command: (name, input) => host.command!(name, input),
      apply: (snapshot) => apply(snapshot),
    }),
    mediaImport: mediaClient,
  };
  const notesClient = createNotesClient({
    command: (name, input) => host.command!(name, input),
    apply: (snapshot) => apply(snapshot),
  });
  const productClients = createProductClients({
    command: (name, input) => host.command!(name, input),
    apply: (snapshot) => apply(snapshot),
  });
  const experienceMotion: ExperienceMotionPort = {
    get reduced() {
      return hooks.motion.reduced;
    },
    add: (key, pose) => hooks.motion.add(key, pose),
    target: (key, pose, cause) => hooks.motion.target(key, pose, cause),
    pose: (key) => hooks.motion.pose(key),
    remove: (key) => {
      hooks.motion.bodies.delete(key);
    },
    wake: hooks.wake,
  };
  let agentLibrary: ReturnType<typeof mountAgentLibrary> | null = null;
  let agentSurface: (ContextualSurfaceRequest & { id: "agents" }) | null = null;
  let checklistCreator: ReturnType<typeof mountChecklistCreator> | null = null;
  let checklistCreatorSurface: ContextualSurfaceRequest | null = null;
  let checklistCreatorSerial = 0;
  let taskCreator: ReturnType<typeof mountTaskObjectiveCreator> | null = null;
  let taskCreatorSurface: ContextualSurfaceRequest | null = null;
  let taskCreatorSerial = 0;
  const taskTrackerViews = new Map<
    string,
    {
      view: ReturnType<typeof mountTaskTrackerExperience>;
      version: number;
      width?: number;
    }
  >();
  const taskProjections = new Map<string, TaskObjectiveDocument | null>();
  let taskRefreshPending = false;
  let taskResourceRevisionStamp = "";
  let activityTimelineAttempt: {
    request: Parameters<typeof productClients.timelines.create>[0];
    pending: boolean;
    resourceId?: string;
  } | null = null;
  const checklistViews = new Map<
    string,
    {
      view: ReturnType<typeof mountChecklistExperience>;
      version: number;
      width?: number;
    }
  >();
  const agentBlockViews = new Map<
    string,
    {
      view: ReturnType<typeof mountAgentBlockExperience>;
      version: number;
      width?: number;
    }
  >();
  const agentProjections = new Map<string, AgentBlockProjection>();
  const timelineViews = new Map<
    string,
    {
      view: ReturnType<typeof mountTimelineExperience>;
      version: number;
      width?: number;
    }
  >();
  const timelineProjections = new Map<string, NonNullable<Parameters<typeof blockIdentity>[0]["timeline"]>>();
  const noteSessions = new Map<string, NoteSession>();
  const noteViews = new Map<string, ReturnType<typeof mountNoteExperience>>();
  const mediaViews = new Map<string, MediaExperience>();
  const groupViews = new Map<
    string,
    ReturnType<typeof mountTaskGroupExperience>
  >();
  const subjectViews = new Map<
    string,
    ReturnType<typeof mountSubjectExperience>
  >();
  const blockSettings = new Map<string, BlockInstanceSettings>();
  const settingsReads = new Map<string, Promise<void>>();
  const settingsFailures = new Map<string, unknown>();
  const unavailableBlocks = new Set<string>();
  const identityViews = new Map<
    string,
    ReturnType<typeof mountBlockIdentity>
  >();
  const blockFootprints = new Map<string, BlockFootprint>();
  const footprintFocus = new Map<string, boolean>();
  let approachReturn: {
    workspaceId: string;
    blockId: string;
    view: WorkspaceView;
    button: HTMLButtonElement;
  } | null = null;
  let approachFocus: {
    workspaceId: string;
    blockId: string;
    deadline: number;
  } | null = null;
  let approachInputRevision = 0;
  const cancelApproachFocus = () => {
    approachInputRevision++;
    approachFocus = null;
  };
  addEventListener("pointerdown", cancelApproachFocus, true);
  addEventListener("keydown", cancelApproachFocus, true);
  addEventListener("blur", cancelApproachFocus);
  document.addEventListener("visibilitychange", cancelApproachFocus);
  const identityModels = new Map<
    string,
    {
      key: string;
      content: string;
      projection?: SubjectIdentity;
      taskObjective?: TaskObjectiveDocument | null;
      timeline?: NonNullable<Parameters<typeof blockIdentity>[0]["timeline"]>;
      model: BlockIdentityModel;
    }
  >();
  const subjectProjections = new Map<string, SubjectIdentity>();
  const subjectRefreshKeys = new Map<string, string>();
  const blockPresentations = new Map<
    string,
    { visible: boolean; usable: boolean; presentation: "workspace" | "focused" }
  >();
  const focusedBlocks = new Map<string, boolean>();
  let subjectDataKey = "";
  let subjectDataEpoch = 0;
  let cardConfiguration: ReturnType<typeof mountBlockConfiguration> | null =
    null;
  let blockLibrary: {
    workspaceId: string;
    request: ContextualSurfaceRequest;
    view: ReturnType<typeof mountBlockLibrary>;
  } | undefined;
  let state: DesktopSnapshot | null = null;
  let panelScope: { workspaceId: string; preferences: WorkspacePanelPreferences } | null = null;
  let resourcesView: ReturnType<typeof mountContextualResources> | null = null;
  let resourcesMotion: ReturnType<typeof conversationDisclosures> | null = null;
  let streamView: ReturnType<typeof mountContextualStream> | null = null;
  let streamMotion: ReturnType<typeof conversationDisclosures> | null = null;
  let streamPickers: ReturnType<typeof enhanceConversationSelect>[] = [];
  let streamSerial = 0;
  let environmentNavigator: ReturnType<
    typeof mountEnvironmentNavigator
  > | null = null;
  let environmentSurface: (ContextualSurfaceRequest & { id: "environments" }) | null = null;
  let environmentPresentation = 0;
  let workspaceActions: ReturnType<typeof mountWorkspaceActions> | null = null;
  let workspaceActionsSurface: (ContextualSurfaceRequest & { id: "workspace-actions" }) | null = null;
  let offset = { x: 0, y: 0 };
  let zoom = 1;
  let previewBase: LayoutState | undefined;
  let preview: LayoutPreview | undefined;
  let previewRequest: LayoutPreviewRequest | undefined;
  let previewCommitting = false;
  let cancelResize: (() => void) | undefined;
  const activeBlocks = new Map<string, boolean>();
  const directBindings = new Map<
    string,
    ReturnType<typeof mountDirectManipulation>
  >();
  const directGestures = new Map<string, DirectGesturePresentation>();
  const previewGuides = document.createElement("div");
  previewGuides.className = "layout-preview-guides";
  previewGuides.setAttribute("aria-hidden", "true");
  el("#stage").append(previewGuides);
  const previewGuideId = "application:preview-guides";
  const previewGuidePose = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    lift: 0,
    yaw: 0,
    opacity: 0,
  };
  hooks.motion.add(previewGuideId, previewGuidePose);
  previewGuides.style.opacity = "0";
  const gridRoot = document.createElement("div");
  gridRoot.className = "workspace-grid-host";
  el("#stage").prepend(gridRoot);
  const workspaceGrid = createWorkspaceGrid({
    root: gridRoot,
    motion: hooks.motion,
    wake: hooks.wake,
    paintInScene: true,
  });
  let tail = Promise.resolve();
  const drafts = new Map<
    string,
    { content: string; timer?: ReturnType<typeof setTimeout> }
  >();
  const composerSessions = new Map<string, ConversationDraftSession>();
  const chatViews = new Map<string, ReturnType<typeof mountBlockChat>>();
  const chatRefreshKeys = new Map<string, string>();
  const ordinaryModelControls = {
    selections: new Map<string, { id: string; label: string }>(),
    async refresh() {
      const status = (await host.command!("providerConnection", {
        type: "refreshModels",
        providerId: CHATGPT_PLAN_PROVIDER,
      })) as ProviderConnectionStatus;
      if (status.state !== "ready" || status.modelCatalog?.state === "unavailable") {
        throw new Error("ordinary_model_catalog_unavailable");
      }
    },
  };
  const composerPort: ConversationProductPort = {
    async command<K extends keyof ProductCommandMap>(
      name: K,
      input: ProductCommandMap[K]["input"],
    ): Promise<ProductCommandMap[K]["output"]> {
      return (await host.command!("conversation", {
        name,
        input,
      })) as ProductCommandMap[K]["output"];
    },
  };
  const chatViewPersistence = new ConversationViewPersistence({
    port: composerPort,
    onError: (error) => report(error),
  });
  type Activity = Partial<StreamEvent> & { type: string };
  const localEvents: StreamEvent[] = [];
  const eventViews = new Map<string, ReturnType<typeof mountEventExperience>>();
  let streamBlockIds: string[] = [];
  let streamRefreshPending = false;
  let retainedEarliest: number | null = null,
    retainedLatest = 0,
    eventDisconnected = false;
  const seenEvents = new Set<string>();
  let lastTrigger: HTMLElement | null = null;
  const conversationView = createManagerState();
  let conversationManager: ReturnType<typeof mountConversationManager> | null =
    null;
  let conversationSurface: (ContextualSurfaceRequest & { id: "conversations" }) | null = null;
  let conversationDisposing: Promise<void> | null = null;
  let connectionsView: ReturnType<typeof mountProviderConnections> | null =
    null;
  let constellation: ReturnType<typeof mountConstellation> | null = null;
  const directResources = createResourceSurface({
    surfaces,
    anchor: () => ({
      x: Math.min(innerWidth - 16, innerWidth / 2 + 300),
      y: Math.max(120, innerHeight / 5),
      width: 16,
      height: 16,
    }),
    failed: report,
    mount: (root, resource) =>
      mountDirectResourceExperience(root, resource, {
        notes: notesClient,
        media: mediaClient,
        checklists: {
          port: productClients.checklists,
          motion: experienceMotion,
          viewId: "direct:" + resource.id,
          chooseReference: () => chooseChecklistReference(root),
          openReference: openChecklistReference,
        },
        timelines: {
          port: productClients.timelines,
          onOpenExternalSource: openGitHubCommit,
          motion: experienceMotion,
          viewId: "direct:" + resource.id,
          resourceTitle: (id) =>
            state?.resources.find(
              (item) =>
                item.id === id &&
                item.available !== false &&
                item.visible !== false,
            )?.title,
        },
        taskObjectives: {
          port: productClients.taskObjectives,
          ...taskTrackerOptions(root, "direct:" + resource.id),
        },
        copyText,
        noteSession,
        saveContent,
        readResource: (id) =>
          state?.resources.find(
            (item) =>
              item.id === id &&
              item.available !== false &&
              item.visible !== false &&
              item.state !== "archived",
          ),
        setTaskStatus: (input) =>
          enqueueResult(async () => {
            await flush();
            await command({ type: "taskStatus", ...input });
          }),
        setTaskPriority: (input) =>
          enqueueResult(async () => {
            await flush();
            await command({ type: "taskPriority", ...input });
          }),
        manageMembers: taskGroupMembers,
        openResource: openCanonicalResource,
        openRelated: openRelatedResources,
        events: {
          snapshot: eventWindow,
          refresh: refreshEvents,
          openResource: openCanonicalResource,
        },
      }),
  });
  const resourceOpener = createResourceOpener({
    resolve: async (input) => {
      await flush();
      return (await host.command!(
        "openResource",
        input,
      )) as ResourceOpeningResult;
    },
    present: async (result, input, current) => {
      if (!current()) return;
      const resource = result.resource;
      const projection = input.origin?.nodeKey
        ? constellation?.layer.screenBodyProjection?.(input.origin.nodeKey)
        : null;
      const body =
        projection?.resourceId === resource.id
          ? projection.clippedBounds
          : null;
      const anchor =
        body && body.right > body.left && body.bottom > body.top
          ? {
              x: body.left,
              y: body.top,
              width: body.right - body.left,
              height: body.bottom - body.top,
            }
          : undefined;
      if (state)
        state = {
          ...state,
          resources: state.resources.some((item) => item.id === resource.id)
            ? state.resources.map((item) =>
                item.id === resource.id ? resource : item,
              )
            : [...state.resources, resource],
        };
      if (
        result.presentation.mode === "existing-placement" &&
        result.placement
      ) {
        const placement = result.placement;
        await enqueueResult(async () => {
          if (!current()) return;
          await command({
            type: "navigate",
            target: { kind: "workspace", workspaceId: placement.workspaceId },
          });
          if (!current()) return;
          surfaces.close("canonical-resource");
          surfaces.close("conversations");
          reveal(placement.blockId);
          hooks.focus(placement.blockId);
        });
      } else if (result.presentation.kind === "agent") {
        await showAgents(resource.id);
      } else if (result.presentation.kind === "conversation") {
        surfaces.close("canonical-resource");
        await showConversations(
          resource.id,
          result.selection?.messageId,
          current,
          anchor,
        );
      } else {
        surfaces.close("conversations");
        directResources.show(resource, anchor);
      }
    },
    unavailable: (result) => {
      directResources.unavailable(result.resourceId);
      hooks.status(
        result.status === "unsupported"
          ? "This resource has no supported viewer yet."
          : "This resource is unavailable or access has been revoked.",
      );
    },
  });
  addEventListener(
    "pagehide",
    () => {
      environmentNavigator?.dispose();
      workspaceActions?.dispose();
      agentLibrary?.dispose();
      checklistCreator?.dispose();
      taskCreator?.dispose();
      resourcesMotion?.dispose();
      resourcesView?.dispose();
      streamMotion?.dispose();
      for (const picker of streamPickers) picker.dispose();
      streamView?.dispose();
      for (const entry of taskTrackerViews.values()) entry.view.dispose();
      taskTrackerViews.clear();
      taskProjections.clear();
      for (const entry of checklistViews.values()) entry.view.dispose();
      checklistViews.clear();
      for (const entry of agentBlockViews.values()) entry.view.dispose();
      agentBlockViews.clear();
      agentProjections.clear();
      for (const entry of timelineViews.values()) entry.view.dispose();
      timelineViews.clear();
      timelineProjections.clear();
      controlMotion.dispose();
      resourceOpener.cancel();
      directResources.dispose();
    },
    { once: true },
  );
  let policyKey = "";
  const arrivalId = "application:arrival";
  let departingWorkspace = false;
  let waitingForVela = false;
  let arrivalOrigin = { x: innerWidth / 2, y: innerHeight / 2 };
  const arrivalPose = { x: 1, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
  hooks.motion.add(arrivalId, arrivalPose);
  const presenceId = "application:vela-presence";
  let presenceDrag: {
    pointerId: number;
    workspaceId: string;
    version: number;
    startX: number;
    startY: number;
    origin: WorkspacePresence;
    moved: boolean;
  } | null = null;
  let suppressPresenceClick = false;
  let overviewBarBottom = 201;
  function camera() {
    const viewport = preview?.viewport;
    return viewport
      ? {
          zoom: viewport.zoom,
          offset: {
            x: -viewport.x * viewport.zoom,
            y: -viewport.y * viewport.zoom,
          },
        }
      : { zoom, offset };
  }
  function presenceTarget() {
    if (state?.navigation.kind === "constellation")
      return {
        ...overviewPresence(innerWidth, innerHeight, overviewBarBottom),
        lift: 0,
        yaw: 0,
        opacity: 1,
      };
    const p = preview?.presence ?? state?.presence;
    if (!p) return;
    const { zoom, offset } = camera();
    return {
      x: p.x * zoom + offset.x,
      y: p.y * zoom + offset.y,
      w: p.width * zoom,
      h: p.height * zoom,
      lift: 0,
      yaw: 0,
      opacity: 1,
    };
  }
  function velaCrossesWorkspace(target: NonNullable<ReturnType<typeof presenceTarget>>) {
    const current = hooks.motion.pose(presenceId);
    const { zoom, offset } = camera();
    const stage = {
      scale: hooks.motion.pose(arrivalId).x,
      originX: arrivalOrigin.x,
      originY: arrivalOrigin.y,
    };
    return state?.blocks.some((block) => {
      const box = footprint({ ...block, locked: !!block.locked });
      return presenceTravelOccludes(current, target, {
        x: box.x * zoom + offset.x,
        y: box.y * zoom + offset.y,
        width: box.width * zoom,
        height: box.height * zoom,
      }, stage);
    });
  }
  function revealWorkspace() {
    waitingForVela = false;
    el("#stage").inert = false;
    hooks.motion.target(arrivalId, arrivalPose, "Vela cleared the workspace arrival");
    hooks.wake();
  }
  function presenceCard() {
    if (
      state?.navigation.kind !== "workspace" ||
      document.body.classList.contains("focused") ||
      !hooks.motion.bodies.has(presenceId)
    )
      return undefined;
    const p = hooks.motion.pose(presenceId);
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  }
  function viewBounds() {
    return {
      x: (20 - offset.x) / zoom,
      y: (170 - offset.y) / zoom,
      width: Math.max(240, innerWidth - 40) / zoom,
      height: Math.max(260, innerHeight - 320) / zoom,
    };
  }
  function workspaceDropPoint(clientX: number, clientY: number) {
    if (state?.navigation.kind !== "workspace" || !state.activeWorkspaceId)
      return null;
    const bounds = viewBounds(), point = {
      x: (clientX - offset.x) / zoom,
      y: (clientY - offset.y) / zoom,
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < bounds.x || point.x > bounds.x + bounds.width ||
        point.y < bounds.y || point.y > bounds.y + bounds.height) return null;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target || target.closest("[data-surface-id],dialog,#vela") ||
        !(target === document.body || target.id === "world" ||
          target.id === "app" || target.closest("#stage"))) return null;
    return point;
  }
  const dialog = document.createElement("dialog");
  dialog.id = "command-surface";
  dialog.className = "command-surface";
  dialog.setAttribute("aria-label", "Aerynth commands");
  document.body.append(dialog);
  const universe = document.createElement("section");
  universe.id = "constellation-view";
  universe.className = "constellation-host";
  universe.hidden = true;
  universe.setAttribute("aria-label", "Constellation navigation");
  // Share the existing isolated application stack with scene controls and Vela.
  el("#app").append(universe);
  el(".brand small").textContent = "LIQUID INTELLIGENCE / WORKING REVIEW";
  el(".brand img").setAttribute("alt", "Aerynth");
  el("#settings-button").setAttribute("aria-label", "Scene controls");
  el("#settings-button").setAttribute("title", "Scene controls");
  el(".provenance").textContent = "LOCAL DATA · Codex connects only on request";
  el(".study-caption small").textContent = "Your resources. Your space.";
  el("#vela-state").textContent = "Idle · no background execution";
  el("#vela-dialog").setAttribute("aria-hidden", "true");
  el("#vela-expression")
    .closest("section")!
    .querySelector('label[for="vela-expression"]')!.textContent =
    "Visual expression preview (synthetic)";
  el("#demo").hidden = true;
  el("#status").textContent = "Ready.";
  el(".place").innerHTML =
    '<button id="workspace-manager" title="Projects and workspaces (Ctrl+K)">Workspaces ↗</button><button id="application-new-chat">＋ Chat</button><button id="application-agents" data-aerynth-motion-control="true">Agents</button><button id="application-resources" data-aerynth-motion-control="true">Resources</button><button id="application-stream" data-aerynth-motion-control="true" aria-label="Intelligence Stream" aria-expanded="false" title="Intelligence Stream"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.6"><path d="M3 12h4l3-6 4 12 3-6h4"/></svg></button><button id="application-connections" aria-label="Connections" title="Connections">⌁</button>';
  const dock = el(".dock");
  dock.insertAdjacentHTML(
    "afterbegin",
    '<button id="add-block">＋ <span>Add</span></button><button id="resource-picker">◌ <span>Resources</span></button><button id="layout-manager">▣ <span>Layout</span></button><button id="zoom-out">⤢ <span>Constellation</span></button><button id="nav-back">↶ <span>Back</span></button>',
  );
  dock.insertAdjacentHTML(
    "beforeend",
    '<button id="connections">⌁ <span>Connections</span></button>',
  );
  const layoutControls = mountWorkspaceLayoutControls(el(".place"), {
    mode: () => state?.organization?.mode ?? "fluid",
    change: async (mode) => {
      if (!state?.activeWorkspaceId || !state.organization) return;
      queuePreview({ organization: { mode }, intent: "mode" });
      await commitLayout({
        type: "setOrganization",
        workspaceId: state.activeWorkspaceId,
        expectedOrganizationRevision: state.organization.revision,
        organization: { mode },
      });
    },
    add: () => el("#add-block").click(),
    more: () => layouts(),
    failed: report,
  });
  const layoutBar = el(".aw-workspace-layout");
  layoutBar.classList.add("aw-optical-controls");
  layoutBar.dataset.awOptics = "workspace";
  for (const button of layoutBar.querySelectorAll("button"))
    button.dataset.aerynthMotionControl = "true";
  function report(e: unknown) {
    const message = e instanceof Error ? e.message : "operation_failed";
    hooks.status(message === "storage_reserve_admission_denied"
      ? "Storage check paused saving. Your data is retained."
      : `Action not saved: ${message}. Your current data is retained.`);
  }
  async function command(a: DesktopCommand): Promise<DesktopSnapshot> {
    const knownWorkspaces = new Set(
      state?.workspaces.map((workspace) => workspace.id),
    );
    const next = (await host.command!("desktop", {
      ...a,
      bounds: a.bounds ?? viewBounds(),
    })) as DesktopSnapshot;
    apply(next);
    if (
      a.type === "createWorkspace" &&
      next.activeWorkspaceId &&
      !knownWorkspaces.has(next.activeWorkspaceId)
    )
      return command({
        type: "bringAllIntoView",
        workspaceId: next.activeWorkspaceId,
      });
    return next;
  }
  function enqueue(action: () => Promise<unknown>) {
    tail = tail.then(action).then(() => {}, report);
    return tail;
  }
  function enqueueResult<T>(action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      void enqueue(async () => {
        try {
          const result = await action();
          resolve(result);
        } catch (error) {
          reject(error);
          throw error;
        }
      });
    });
  }
  function apply(next: DesktopSnapshot) {
    const changed = state?.activeWorkspaceId !== next.activeWorkspaceId;
    const leavingWorkspace =
      state?.navigation.kind === "workspace" &&
      next.navigation.kind === "constellation";
    const arrivingWorkspace =
      state?.navigation.kind === "constellation" &&
      next.navigation.kind === "workspace";
    const navigated =
      JSON.stringify(state?.navigation) !== JSON.stringify(next.navigation);
    if (
      changed ||
      navigated ||
      (approachReturn &&
        !next.blocks.some((block) => block.id === approachReturn!.blockId))
    )
      clearApproachReturn();
    if (navigated) {
      surfaces.close("card-actions");
      surfaces.close("block-library");
      presenceDrag = null;
      cancelResize?.();
      cancelResize = undefined;
      document.body.classList.remove("vela-access");
    }
    if (
      changed ||
      navigated ||
      (previewBase && previewBase.revision !== next.layoutVersion)
    )
      cancelPreview();
    state = next;
    const missionWorkspace = next.navigation.kind === "workspace"
      ? next.workspaces.find((item) => item.id === next.activeWorkspaceId) : undefined;
    velaMissions.setScope(missionWorkspace ? { workspaceId: missionWorkspace.id, projectId: missionWorkspace.project_id } : null);
    const streamResources = new Set(
      next.resources.filter((resource) =>
        resource.kind === "stream" && resource.available !== false && resource.visible !== false,
      ).map((resource) => resource.id),
    );
    streamBlockIds = next.blocks
      .filter((block) => block.resource_id && streamResources.has(block.resource_id))
      .map((block) => block.id);
    scheduleStreamRefresh();
    const taskStamp = JSON.stringify(
      next.resources.map((resource) => [
        resource.id,
        resource.version,
        resource.conversationRevision,
        resource.available,
        resource.visible,
      ]),
    );
    if (taskStamp !== taskResourceRevisionStamp) {
      taskResourceRevisionStamp = taskStamp;
      refreshTaskProjections();
    }
    environmentNavigator?.update(next);
    workspaceActions?.update(next);
    subjectDataKey = JSON.stringify([
      next.revision,
      subjectDataEpoch,
      next.resources.map((resource) => [
        resource.id,
        resource.version,
        resource.state,
        resource.visible,
        resource.conversationRevision,
      ]),
      next.projects.map((project) => [project.id, project.version]),
      next.workspaces.map((workspace) => [workspace.id, workspace.version]),
    ]);
    for (const [id, view] of identityViews)
      if (!next.blocks.some((block) => block.id === id)) {
        view.dispose();
        identityViews.delete(id);
      }
    for (const map of [
      identityModels,
      subjectProjections,
      subjectRefreshKeys,
      blockPresentations,
      focusedBlocks,
      blockFootprints,
      footprintFocus,
      directGestures,
    ])
      for (const id of map.keys())
        if (!next.blocks.some((block) => block.id === id)) map.delete(id);
    for (const [id, view] of chatViews)
      if (!next.blocks.some((block) => block.id === id)) {
        chatViews.delete(id);
        chatRefreshKeys.delete(id);
        void view.dispose().catch(report);
      }
    // Sessions belong to canonical resources for this native-window lifetime,
    // including sends that outlive a departed block or a closed manager. View
    // disposal releases DOM/execution observers, never the in-flight draft owner.
    for (const id of activeBlocks.keys())
      if (!next.blocks.some((block) => block.id === id))
        activeBlocks.delete(id);
    for (const [id, view] of noteViews)
      if (!next.blocks.some((b) => b.id === id)) {
        view.dispose();
        noteViews.delete(id);
      }
    for (const [id, entry] of checklistViews)
      if (!next.blocks.some((block) => block.id === id)) {
        entry.view.dispose();
        checklistViews.delete(id);
      }
    for (const [id, entry] of agentBlockViews)
      if (!next.blocks.some((block) => block.id === id)) {
        entry.view.dispose();
        agentBlockViews.delete(id);
        agentProjections.delete(id);
      }
    for (const [id, entry] of timelineViews)
      if (!next.blocks.some((block) => block.id === id)) {
        entry.view.dispose();
        timelineViews.delete(id);
        timelineProjections.delete(id);
      }
    for (const [id, entry] of taskTrackerViews)
      if (!next.blocks.some((block) => block.id === id)) {
        entry.view.dispose();
        taskTrackerViews.delete(id);
        taskProjections.delete(id);
      }
    for (const [id, view] of groupViews)
      if (!next.blocks.some((b) => b.id === id)) {
        view.dispose();
        groupViews.delete(id);
      }
    for (const [id, view] of subjectViews)
      if (!next.blocks.some((b) => b.id === id)) {
        view.dispose();
        subjectViews.delete(id);
      }
    for (const [id, view] of eventViews)
      if (!next.blocks.some((block) => block.id === id)) {
        view.dispose();
        eventViews.delete(id);
      }
    for (const [id, view] of mediaViews) {
      const block = next.blocks.find((item) => item.id === id);
      const resource =
        block && next.resources.find((item) => item.id === block.resource_id);
      if (
        !resource ||
        resource.available === false ||
        resource.visible === false
      ) {
        view.dispose();
        mediaViews.delete(id);
      }
    }
    for (const id of blockSettings.keys())
      if (!next.blocks.some((block) => block.id === id))
        blockSettings.delete(id);
    for (const id of settingsFailures.keys())
      if (!next.blocks.some((block) => block.id === id))
        settingsFailures.delete(id);
    for (const id of unavailableBlocks)
      if (!next.blocks.some((block) => block.id === id))
        unavailableBlocks.delete(id);
    for (const [id, binding] of directBindings)
      if (!next.blocks.some((block) => block.id === id)) {
        binding.dispose();
        directBindings.delete(id);
      }
    for (const [id, session] of noteSessions)
      if (
        !session.hasObservers &&
        !session.snapshot().dirty &&
        !next.blocks.some((block) => block.resource_id === id)
      )
        noteSessions.delete(id);
    directResources.reconcile(next.resources);
    layoutControls.refresh();
    zoom = next.viewport?.zoom ?? 1;
    offset = {
      x: -(next.viewport?.x ?? 0) * zoom,
      y: -(next.viewport?.y ?? 0) * zoom,
    };
    if (changed) {
      hooks.home();
    }
    const presence = presenceTarget();
    if (presence) {
      if (!hooks.motion.bodies.has(presenceId))
        hooks.motion.add(presenceId, presence);
      else if (!presenceDrag)
        hooks.motion.target(presenceId, presence, "saved Vela placement");
    }
    hooks.replace(next);
    el("#workspace-manager").textContent =
      `${next.workspaces.find((w) => w.id === next.activeWorkspaceId)?.title ?? "Workspaces"} ↗`;
    el<HTMLButtonElement>("#undo").disabled = !next.canUndo;
    el("#undo span").textContent = "Undo layout";
    el("#layout-manager").innerHTML =
      `▣ <span>${next.organization?.mode ? next.organization.mode[0].toUpperCase() + next.organization.mode.slice(1) : "Layout"}</span>`;
    el("#layout-manager").title =
      "Organization mode, layout history and block access";
    universe.hidden = false;
    const overview = next.navigation.kind === "constellation";
    document.body.classList.toggle("constellation-overview", overview);
    universe.classList.toggle("overview", overview);
    if (navigated) {
      waitingForVela = arrivingWorkspace &&
        hooks.motion.pose(arrivalId).opacity <= 0.003 &&
        !hooks.motion.reduced &&
        !constellation?.controller.policy.quiet &&
        !!presence && !!velaCrossesWorkspace(presence);
    }
    el("#stage").inert = overview || waitingForVela;
    if (leavingWorkspace) {
      departingWorkspace = true;
      arrivalOrigin = { x: innerWidth / 2, y: innerHeight / 2 };
      el("#stage").style.transformOrigin =
        `${arrivalOrigin.x}px ${arrivalOrigin.y}px`;
      hooks.motion.target(
        arrivalId,
        { ...arrivalPose, x: 0.78, opacity: 0 },
        "workspace departure to celestial overview",
      );
      if (hooks.motion.reduced || constellation?.controller.policy.quiet)
        hooks.motion.snap(arrivalId);
    } else if (!overview) {
      departingWorkspace = false;
      // Direct navigation and interrupted graph travel still apply a canonical
      // workspace. The graph callback can refine the origin when it has one.
      if (arrivingWorkspace) {
        hooks.motion.target(
          arrivalId,
          waitingForVela ? { ...arrivalPose, opacity: 0 } : arrivalPose,
          "canonical workspace arrival",
          true,
        );
        hooks.wake();
      }
    }
    el("#stage").style.visibility =
      !overview || departingWorkspace ? "" : "hidden";
    const navigationSnapshot = {
      ...next,
      blocks: next.navigationBlocks ?? next.blocks,
    };
    if (!constellation) {
      const options: ConstellationViewOptions & GraphActions = {
        hostUiElements: () =>
          [
            ...document.querySelectorAll<HTMLElement>(
              ".topbar,.brand,.place,.aw-workspace-layout,.scene-navigation,#settings-button,.dock,.canvas-tools,#status,.keys,.provenance,.window-drag,#vela",
            ),
          ].slice(0, 32),
        snapshot: navigationSnapshot,
        motion: hooks.motion,
        onNavigationIntent: () => resourceOpener.cancel(),
        navigate: (target) =>
          enqueueResult(async () => {
            await flush();
            return command({ type: "navigate", target });
          }),
        openResource: (target) => resourceOpener.open(target),
        persistence: {
          load: () => host.command!("viewState", {}),
          save: async (state) => {
            await host.command!("viewState", { state });
          },
        },
        graphAction: async (action) => {
          const knownWorkspaces = new Set(
            state?.workspaces.map((workspace) => workspace.id),
          );
          await tail;
          await flush();
          const next = (await host.command!("graphAction", {
            ...action,
            bounds: viewBounds(),
          })) as DesktopSnapshot;
          apply(next);
          const framed =
            action.type === "createWorkspace" &&
            next.activeWorkspaceId &&
            !knownWorkspaces.has(next.activeWorkspaceId)
              ? await command({
                  type: "bringAllIntoView",
                  workspaceId: next.activeWorkspaceId,
                })
              : next;
          return {
            ...framed,
            blocks: framed.navigationBlocks ?? framed.blocks,
          };
        },
        capabilities: {
          createProject: true,
          createWorkspace: true,
          createResource: true,
          archive: true,
          detach: true,
          attach: true,
          relate: true,
          unrelate: true,
          branch: true,
        },
        onDirty: hooks.wake,
        onTransition: (transition) => {
          if (
            !["workspace", "surface"].includes(transition.to.kind) ||
            ["workspace", "surface"].includes(transition.from.kind)
          )
            return;
          const bounds = (
              universe.querySelector(".aw-spatial-field") ?? universe
            ).getBoundingClientRect(),
            c = transition.camera;
          arrivalOrigin = transition.screenOrigin ?? {
            x:
              bounds.left +
              bounds.width / 2 +
              (transition.origin.x - c.x) * c.zoom,
            y:
              bounds.top +
              bounds.height / 2 +
              (transition.origin.y - c.y) * c.zoom,
          };
          el("#stage").style.transformOrigin =
            `${arrivalOrigin.x}px ${arrivalOrigin.y}px`;
          if (waitingForVela) return;
          const body = hooks.motion.bodies.get(arrivalId)!;
          if (
            !body.transitioning &&
            !hooks.motion.reduced &&
            !constellation?.controller.policy.quiet
          ) {
            body.channels.x.value = 0.92;
            body.channels.opacity.value = 0.45;
          }
          hooks.motion.target(
            arrivalId,
            arrivalPose,
            "workspace arrival from canonical anchor",
            true,
          );
          hooks.wake();
        },
      };
      constellation = mountConstellation(universe, options);
      const bar = universe.querySelector<HTMLElement>(".aw-constellation-bar")!;
      const updateOverviewChrome = () => {
        const r = bar.getBoundingClientRect();
        if (r.height > 0) {
          overviewBarBottom = overviewChromeBottom(innerWidth, innerHeight, r);
          hooks.wake();
        }
      };
      new ResizeObserver(updateOverviewChrome).observe(bar);
      addEventListener("resize", updateOverviewChrome);
      void constellation.ready.then(hooks.wake);
    } else constellation.update(navigationSnapshot);
    for (const block of next.blocks)
      decorate(el(`[data-block="${block.id}"]`), block.id);
    hooks.layout();
    document.body.classList.add("application-ready");
    syncWorkspacePanels(
      next.navigation.kind === "workspace" ? next.activeWorkspaceId : null,
    );
    resourcesView?.update();
    streamView?.update();
  }
  function openWorkspacePanel(
    request: ContextualSurfaceRequest & { id: WorkspacePanelId },
    restoring = false,
  ) {
    const scope = panelScope;
    if (!scope) return surfaces.open(request);
    const preference = scope.preferences[request.id] ?? { pinned: false };
    return surfaces.open({
      ...request,
      preferredSize: preference.size ?? request.preferredSize,
      initialFocus: restoring ? false : request.initialFocus,
      workspacePanel: {
        preference,
        async save(preference) {
          try {
            await host.command!("viewState", {
              panels: {
                workspaceId: scope.workspaceId,
                update: { panel: request.id, preference },
              },
            });
            scope.preferences[request.id] = preference;
          } catch (error) {
            report(error);
            throw error;
          }
        },
      },
    });
  }
  function syncWorkspacePanels(workspaceId: string | null) {
    if ((panelScope?.workspaceId ?? null) === workspaceId) return;
    for (const panel of WORKSPACE_PANELS) surfaces.close(panel);
    const scope = workspaceId ? { workspaceId, preferences: {} as WorkspacePanelPreferences } : null;
    panelScope = scope;
    if (!scope) return;
    void (async () => {
      const saved = await host.command!("viewState", { panels: { workspaceId: scope.workspaceId } });
      if (panelScope !== scope) return;
      scope.preferences = (saved ?? {}) as WorkspacePanelPreferences;
      if (scope.preferences.environments?.pinned) manager(true);
      if (scope.preferences["workspace-actions"]?.pinned) layouts(true);
      if (scope.preferences.agents?.pinned) void showAgents(undefined, true).catch(report);
      if (scope.preferences.conversations?.pinned)
        void showConversations(undefined, undefined, () => panelScope === scope, undefined, true).catch(report);
      if (scope.preferences.resources?.pinned) picker(true);
      if (scope.preferences["intelligence-stream"]?.pinned) showStream(true);
    })().catch(report);
  }
  function closeUnpinned(panel: WorkspacePanelId) {
    if (!panelScope?.preferences[panel]?.pinned) surfaces.close(panel);
  }
  let flushInFlight: Promise<void> | null = null;
  function flush(): Promise<void> {
    if (flushInFlight) return flushInFlight;
    flushInFlight = flushDrafts().finally(() => {
      flushInFlight = null;
    });
    return flushInFlight;
  }
  async function flushDrafts() {
    await conversationDisposing;
    await checklistCreator?.flush();
    await taskCreator?.flush();
    for (const entry of taskTrackerViews.values()) await entry.view.flush();
    for (const entry of checklistViews.values()) await entry.view.flush();
    for (const entry of timelineViews.values()) await entry.view.flush();
    await directResources.flush();
    for (;;) {
      await flushConversationDraftSessions(() => composerSessions.values());
      await chatViewPersistence.flush();
      await conversationManager?.flush();
      const ids = new Set([
        ...drafts.keys(),
        ...[...noteSessions]
          .filter(([, session]) => session.hasPendingEdits)
          .map(([id]) => id),
      ]);
      if (!ids.size) {
        if (
          [...composerSessions.values()].every(
            (session) => session.snapshot().phase === "clean",
          )
        )
          break;
        continue;
      }
      for (const resourceId of ids) {
        const draft = drafts.get(resourceId);
        clearTimeout(draft?.timer);
        const session = noteSessions.get(resourceId);
        if (!session) throw new Error("draft_resource_unavailable");
        await session.flushEdits();
        if (drafts.get(resourceId) === draft) drafts.delete(resourceId);
      }
    }
  }
  function queueDesktop(a: DesktopCommand) {
    // Navigation cancels older reads when requested, before flushing drafts or
    // waiting for other commands. Dispatch must not cancel a newer open.
    if (a.type === "navigate" || a.type === "back") resourceOpener.cancel();
    return enqueueResult(async () => {
      await flush();
      return command(a);
    });
  }
  function run(a: DesktopCommand) {
    return queueDesktop(a).then(() => {}, () => {});
  }
  function queuePreview(request: LayoutPreviewRequest) {
    if (!state || previewCommitting) return;
    previewBase ??= layoutState(state);
    if (!previewBase) return;
    previewRequest = {
      ...request,
      expectedRevision: previewBase.revision,
      bounds: request.bounds ?? viewBounds(),
    };
    hooks.wake();
  }
  function paintPreview() {
    if (!previewRequest || !previewBase) return;
    const request = previewRequest;
    previewRequest = undefined;
    try {
      preview = previewLayout(previewBase, request);
      const { zoom, offset } = camera();
      const gridOnly =
        preview.organization.mode === "structured" &&
        ["mode", "move", "resize"].includes(request.intent ?? "");
      const guides = (gridOnly ? [] : preview.guides).map(
        (g) =>
          `<i class="alignment-guide" style="left:${(g.axis === "x" ? g.position : g.from) * zoom + offset.x}px;top:${(g.axis === "y" ? g.position : g.from) * zoom + offset.y}px;width:${g.axis === "x" ? 1 : (g.to - g.from) * zoom}px;height:${g.axis === "y" ? 1 : (g.to - g.from) * zoom}px"></i>`,
      );
      const areas = preview.placementAreas.map(
        (a) =>
          `<i class="placement-area" style="left:${a.x * zoom + offset.x}px;top:${a.y * zoom + offset.y}px;width:${a.width * zoom}px;height:${a.height * zoom}px"></i>`,
      );
      previewGuides.innerHTML = [...guides, ...areas].join("");
      hooks.motion.target(
        previewGuideId,
        { ...previewGuidePose, opacity: guides.length || areas.length ? 1 : 0 },
        "placement guide reveal",
      );
      document.body.dataset.layoutPreview = preview.organization.mode;
      hooks.layout();
    } catch (error) {
      hooks.status(
        `Placement preview unavailable: ${(error as Error).message}. Saved layout retained.`,
      );
    }
  }
  function cancelPreview() {
    previewRequest = undefined;
    preview = undefined;
    previewBase = undefined;
    hooks.motion.target(
      previewGuideId,
      previewGuidePose,
      "placement guide dismissal",
    );
    delete document.body.dataset.layoutPreview;
    hooks.layout();
    hooks.wake();
  }
  function commitLayout(a: DesktopCommand, requireAcknowledgement = false) {
    paintPreview();
    const revision = previewBase?.revision;
    previewCommitting = true;
    const action = {
      ...a,
      ...(revision === undefined ? {} : { expectedLayoutVersion: revision }),
    };
    const saving = requireAcknowledgement
      ? queueDesktop(action)
      : run(action);
    return saving.finally(() => {
      previewCommitting = false;
      cancelPreview();
    });
  }
  dialog.addEventListener("close", () => {
    if (!previewCommitting) cancelPreview();
    cardConfiguration?.dispose();
    cardConfiguration = null;
    for (const session of composerSessions.values())
      void session.reload().catch(report);
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (!presenceDrag && !cancelResize)) return;
    event.preventDefault();
    suppressPresenceClick = !!presenceDrag;
    presenceDrag = null;
    cancelResize?.();
    cancelResize = undefined;
    cancelPreview();
  });
  const velaCard = el<HTMLButtonElement>("#vela");
  velaCard.addEventListener("focusout", () =>
    document.body.classList.remove("vela-access"),
  );
  velaCard.title =
    "Drag Vela directly, or use Alt+arrow keys. Click or Enter opens Vela.";
  velaCard.addEventListener(
    "click",
    (event) => {
      if (suppressPresenceClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressPresenceClick = false;
      }
    },
    true,
  );
  velaCard.addEventListener("pointerdown", (event) => {
    const p = state?.presence;
    if (
      !p ||
      !presenceCard() ||
      p.locked ||
      presenceDrag ||
      previewCommitting ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    velaCard.focus();
    presenceDrag = {
      pointerId: event.pointerId,
      workspaceId: p.workspaceId,
      version: p.version,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...p },
      moved: false,
    };
    velaCard.setPointerCapture(event.pointerId);
  });
  function queuePresencePoint(
    drag: NonNullable<typeof presenceDrag>,
    event: PointerEvent,
  ) {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) <= 4) return;
    drag.moved = true;
    const placement = {
      x: Math.round(drag.origin.x + dx / zoom),
      y: Math.round(drag.origin.y + dy / zoom),
    };
    const bounds = viewBounds();
    queuePreview({
      presence: { expectedVersion: drag.version, presentation: placement },
      intent: "move",
      bounds,
    });
    return { placement, bounds };
  }
  velaCard.addEventListener("pointermove", (event) => {
    const drag = presenceDrag;
    if (drag?.pointerId === event.pointerId) queuePresencePoint(drag, event);
  });
  velaCard.addEventListener("pointerup", (event) => {
    const d = presenceDrag;
    if (!d || d.pointerId !== event.pointerId) return;
    const release = queuePresencePoint(d, event);
    presenceDrag = null;
    document.body.classList.remove("vela-access");
    suppressPresenceClick = !!release;
    if (release)
      void commitLayout({
        type: "setPresence",
        workspaceId: d.workspaceId,
        expectedVersion: d.version,
        placement: release.placement,
        bounds: release.bounds,
      });
  });
  const cancelPresenceDrag = (event: PointerEvent) => {
    if (presenceDrag?.pointerId !== event.pointerId) return;
    presenceDrag = null;
    suppressPresenceClick = false;
    cancelPreview();
    const target = presenceTarget();
    if (target)
      hooks.motion.target(presenceId, target, "Vela pointer cancelled");
    hooks.wake();
  };
  velaCard.addEventListener("pointercancel", cancelPresenceDrag);
  velaCard.addEventListener("lostpointercapture", cancelPresenceDrag);
  velaCard.addEventListener("keydown", (event) => {
    const p = state?.presence;
    if (
      !p ||
      !event.altKey ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    void run({
      type: "setPresence",
      workspaceId: p.workspaceId,
      expectedVersion: p.version,
      placement: {
        x:
          p.x +
          (event.key === "ArrowLeft"
            ? -24
            : event.key === "ArrowRight"
              ? 24
              : 0),
        y:
          p.y +
          (event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0),
      },
    });
  });
  function open(title: string, body: string) {
    cardConfiguration?.dispose();
    cardConfiguration = null;
    surfaces.close("conversations");
    dialog.classList.remove("conversation-surface");
    lastTrigger = document.activeElement as HTMLElement;
    dialog.innerHTML = `<div class="command-heading"><h2>${title}</h2><button data-close aria-label="Close panel">×</button></div>${body}<p id="command-error" role="status"></p>`;
    el("[data-close]", dialog).onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    el<HTMLInputElement>("input,select,button", dialog)?.focus();
  }
  function conversations(resourceId?: string) {
    if (resourceId) openCanonicalResource(resourceId);
    else void showConversations().catch(report);
  }
  function openChecklistReference(reference: ChecklistReference) {
    if (reference.kind === "project") {
      void run({
        type: "navigate",
        target: { kind: "constellation", projectId: reference.projectId },
      });
    } else if (
      reference.kind === "resource" ||
      reference.kind === "conversation"
    ) {
      openCanonicalResource(
        reference.resourceId,
        reference.kind === "conversation" ? reference.messageId : undefined,
      );
    } else if (reference.kind === "agent")
      openCanonicalResource(reference.agentId);
    else if (reference.kind === "task") openCanonicalResource(reference.taskId);
    else hooks.status("This linked source has no available viewer yet.");
  }
  function chooseChecklistReference(
    anchor: HTMLElement,
  ): Promise<ChecklistReference | null> {
    return new Promise((resolve) => {
      const content = document.createElement("div");
      content.className = "application-source-choice";
      const search = document.createElement("input"),
        results = document.createElement("div"),
        summary = document.createElement("small");
      search.type = "search";
      search.placeholder = "Find a source";
      search.setAttribute("aria-label", "Find a checklist source");
      search.dataset.aerynthMotionControl = "true";
      content.append(search, results, summary);
      const choices: { title: string; reference: ChecklistReference }[] = [];
      let settled = false;
      const finish = (value: ChecklistReference | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const add = (title: string, reference: ChecklistReference) => {
        choices.push({ title, reference });
      };
      for (const resource of state?.resources ?? []) {
        if (
          resource.available === false ||
          resource.visible === false ||
          resource.state === "archived"
        )
          continue;
        add(
          resource.title,
          resource.kind === "conversation"
            ? { kind: "conversation", resourceId: resource.id }
            : resource.kind === "agent"
              ? { kind: "agent", agentId: resource.id }
              : { kind: "resource", resourceId: resource.id },
        );
      }
      for (const project of state?.projects ?? [])
        add(project.title, { kind: "project", projectId: project.id });
      const draw = () => {
        const matches = choices.filter((choice) =>
          choice.title.toLowerCase().includes(search.value.toLowerCase()),
        );
        results.replaceChildren();
        for (const choice of matches.slice(0, 100)) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = choice.title;
          button.dataset.aerynthMotionControl = "true";
          button.onclick = () => {
            finish(choice.reference);
            surfaces.close("checklist-sources");
          };
          results.append(button);
        }
        summary.textContent =
          matches.length > 100
            ? "100 matches · refine your search"
            : matches.length
              ? ""
              : "No matching authorized sources.";
      };
      search.oninput = draw;
      draw();
      surfaces.open({
        id: "checklist-sources",
        anchor,
        content,
        label: "Link a source",
        placement: "right",
        minSize: { width: 260, height: 140 },
        maxSize: { width: 420, height: 480 },
        initialFocus: search,
        onClose: () => finish(null),
      });
    });
  }
  async function newChecklist(
    conversationId?: string,
    anchor: HTMLElement = el("#application-resources"),
  ) {
    await flush();
    if (checklistCreator && checklistCreatorSurface) {
      surfaces.open(checklistCreatorSurface);
      return;
    }
    const content = document.createElement("div");
    const projectId = conversationId
      ? (state?.resources.find((r) => r.id === conversationId)?.project_id ??
        null)
      : creationProjectId();
    const controller = mountChecklistCreator(content, {
      port: productClients.checklists,
      motion: experienceMotion,
      projectId,
      conversationId,
      viewId: "creator:" + ++checklistCreatorSerial,
      onCreated: async (resourceId) => {
        const result = await resourceOpener.open({
          resourceId,
          origin: { source: "application" },
        });
        if (result.status !== "ready")
          throw Error("Created checklist is not available to open.");
        if (checklistCreator === controller) surfaces.close("checklist-create");
      },
    });
    checklistCreator = controller;
    checklistCreatorSurface = {
      id: "checklist-create",
      anchor,
      content,
      label: "Checklist",
      placement: "bottom",
      minSize: { width: 300, height: 190 },
      maxSize: { width: 460, height: 320 },
      initialFocus: "input",
      beforeClose: async () => {
        try {
          await controller.flush();
          return true;
        } catch (error) {
          report(error);
          return false;
        }
      },
      onClose: () => {
        controller.dispose();
        if (checklistCreator === controller) {
          checklistCreator = null;
          checklistCreatorSurface = null;
        }
      },
    };
    surfaces.open(checklistCreatorSurface);
  }
  async function chooseTaskReference(
    kind: TaskTargetKind,
    anchor: HTMLElement,
  ): Promise<TaskReferenceTarget | null> {
    return new Promise((resolve) => {
      const content = document.createElement("div"),
        search = document.createElement("input"),
        list = document.createElement("div"),
        status = document.createElement("p");
      content.className =
        "application-task-reference-picker aw-optical-controls";
      search.type = "search";
      search.maxLength = 100;
      search.placeholder = "Find a resource";
      search.setAttribute("aria-label", "Find a task reference");
      search.dataset.aerynthMotionControl = "true";
      status.setAttribute("role", "status");
      list.setAttribute("aria-label", "Available task references");
      content.append(search, list, status);
      let generation = 0,
        settled = false;
      const finish = (target: TaskReferenceTarget | null) => {
        if (settled) return;
        settled = true;
        generation++;
        resolve(target);
        surfaces.close("task-reference-picker");
      };
      const load = async () => {
        const revision = ++generation;
        status.textContent = "Finding resources…";
        list.replaceChildren();
        try {
          const page = await productClients.taskObjectives.targets({
            kind,
            query: search.value,
            limit: 24,
          });
          if (settled || revision !== generation) return;
          for (const target of page.items) {
            if (target.kind !== kind) continue;
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = target.label;
            button.dataset.taskTargetKey = target.key;
            button.dataset.aerynthMotionControl = "true";
            button.onclick = () => finish(target);
            list.append(button);
          }
          status.textContent =
            page.coverage === "bounded"
              ? "More resources may be available. Refine your search."
              : page.items.length
                ? ""
                : "No matching resources.";
        } catch {
          if (!settled && revision === generation)
            status.textContent =
              "References are unavailable. Your task is unchanged.";
        }
      };
      search.oninput = () => {
        void load();
      };
      surfaces.open({
        id: "task-reference-picker",
        anchor,
        content,
        label:
          kind === "execution"
            ? "Link recorded work"
            : kind === "assignee"
              ? "Assign responsibility"
              : kind === "dependency"
                ? "Choose a dependency"
                : "Link a source",
        placement: "right",
        minSize: { width: 280, height: 160 },
        maxSize: { width: 440, height: 520 },
        preferredSize: { width: 380, height: 360 },
        initialFocus: search,
        onClose: () => finish(null),
      });
      void load();
    });
  }
  function taskTrackerOptions(
    root: HTMLElement,
    viewId: string,
  ): Parameters<typeof mountTaskTrackerExperience>[3] {
    return {
      viewId,
      motion: experienceMotion,
      chooseSource: async () => {
        const target = await chooseTaskReference("source", root);
        return target?.kind === "source" ? target.reference : null;
      },
      chooseAssignee: async () => {
        const target = await chooseTaskReference("assignee", root);
        return target?.kind === "assignee" ? target.reference : null;
      },
      chooseDependency: async () => {
        const target = await chooseTaskReference("dependency", root);
        return target?.kind === "dependency" ? target.reference : null;
      },
      chooseExistingExecution: async () => {
        const target = await chooseTaskReference("execution", root);
        return target?.kind === "execution" ? target.reference : null;
      },
      resourceTitle: (id) =>
        state?.resources.find(
          (resource) =>
            resource.id === id &&
            resource.available !== false &&
            resource.visible !== false,
        )?.title,
    };
  }
  async function newTaskObjective() {
    await flush();
    if (taskCreator && taskCreatorSurface) {
      taskCreator.setActive(true);
      surfaces.open(taskCreatorSurface);
      return;
    }
    const content = document.createElement("div");
    let opened = false;
    const controller = mountTaskObjectiveCreator(content, {
      port: productClients.taskObjectives,
      motion: experienceMotion,
      viewId: "task-creator:" + ++taskCreatorSerial,
      projectId: creationProjectId(),
      showTitle: false,
      onCreated: async (resourceId) => {
        const result = await resourceOpener.open({
          resourceId,
          origin: { source: "application" },
        });
        if (result.status !== "ready")
          throw Error("Created objective is not available to open.");
        opened = true;
        if (taskCreator === controller) surfaces.close("task-objective-create");
      },
    });
    taskCreator = controller;
    taskCreatorSurface = {
      id: "task-objective-create",
      anchor: el("#application-resources"),
      content,
      label: "New task",
      placement: "bottom",
      minSize: { width: 340, height: 260 },
      maxSize: { width: 520, height: 640 },
      preferredSize: { width: 460, height: 420 },
      initialFocus: "input",
      beforeClose: async () => {
        try {
          await controller.flush();
          return true;
        } catch (error) {
          report(error);
          return false;
        }
      },
      onClose: () => {
        if (opened) {
          controller.dispose();
          if (taskCreator === controller) {
            taskCreator = null;
            taskCreatorSurface = null;
          }
        } else controller.setActive(false);
      },
    };
    surfaces.open(taskCreatorSurface);
  }
  function creationProjectId(): string | null {
    const navigation = state?.navigation;
    if (navigation?.kind === "workspace")
      return (
        state?.workspaces.find(
          (workspace) => workspace.id === navigation.workspaceId,
        )?.project_id ?? null
      );
    return navigation?.kind === "constellation" ? navigation.projectId : null;
  }
  async function openGitHubCommit(input: TimelineExternalOpen) {
    await host.command!("githubTimeline", { name: "openCommit", input });
  }
  async function newActivityTimeline() {
    await flush();
    let attempt = activityTimelineAttempt;
    if (!attempt) {
      const projectId = creationProjectId();
      const capturedAt = Date.now();
      attempt = {
        pending: false,
        request: {
          commandId: "activity-timeline:" + crypto.randomUUID(),
          title: projectId ? "Project activity" : "Recent activity",
          projectId,
          view: {
            schemaVersion: 1,
            mode: "activity",
            scope: { projectId, resourceIds: [] },
            sources: {
              providerIds: [],
              eventTypes: [],
              classifications: ["observed", "reported", "inferred"],
            },
            viewport: {
              from: new Date(capturedAt - 86400000).toISOString(),
              to: new Date(capturedAt + 60000).toISOString(),
              displayTimeZone:
                Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            },
            selection: null,
          },
        },
      };
      activityTimelineAttempt = attempt;
    }
    if (attempt.pending) return;
    attempt.pending = true;
    try {
      if (!attempt.resourceId)
        attempt.resourceId = (
          await productClients.timelines.create(attempt.request)
        ).resourceId;
      const opened = await resourceOpener.open({
        resourceId: attempt.resourceId,
        origin: { source: "application" },
      });
      if (opened.status !== "ready")
        throw Error("Timeline created. Reopen it from Resources.");
      if (activityTimelineAttempt === attempt) activityTimelineAttempt = null;
    } catch {
      hooks.status(
        attempt.resourceId
          ? "Timeline created. Reopen it from Resources."
          : "Timeline creation could not be confirmed. Activity timeline will retry the same attempt.",
      );
    } finally {
      attempt.pending = false;
    }
  }
  async function showAgents(resourceId?: string, restoring = false): Promise<void> {
    if (!agentLibrary || !agentSurface) {
      const content = document.createElement("div");
      content.className = "application-agent-content";
      agentLibrary = mountAgentLibrary(content, {
        client: productClients.agents,
        motion: experienceMotion,
        onOpenResource: openCanonicalResource,
      });
      agentSurface = {
        id: "agents",
        anchor: el("#application-agents"),
        content,
        label: "Agents",
        placement: "bottom",
        minSize: { width: 520, height: 360 },
        maxSize: { width: 900, height: 720 },
        preferredSize: { width: 760, height: 560 },
        initialFocus: ".agent-search",
        beforeClose: () => {
          if (!agentLibrary?.hasUnsavedChanges()) return true;
          hooks.status(
            "Save or discard the agent profile changes before closing.",
          );
          return false;
        },
      };
    }
    openWorkspacePanel(agentSurface, restoring).classList.add("application-agents");
    if (resourceId) {
      const opened = await agentLibrary.open(resourceId);
      if (opened === "unavailable") hooks.status("This agent is unavailable.");
    } else await agentLibrary.refresh();
  }
  async function showConversations(
    resourceId?: string,
    messageId?: string,
    current: () => boolean = () => true,
    anchor?: { x: number; y: number; width: number; height: number },
    restoring = false,
  ) {
    await conversationDisposing;
    if (!current()) return;
    dialog.close();
    cardConfiguration?.dispose();
    cardConfiguration = null;
    if (conversationManager && conversationSurface) {
      if (anchor) conversationSurface.anchor = anchor;
      openWorkspacePanel(conversationSurface, restoring).id = "conversation-surface";
      if (resourceId) await conversationManager.open(resourceId, messageId);
      else await conversationManager.refresh();
      return;
    }
    const content = document.createElement("div");
    content.id = "conversation-product";
    content.className = "application-conversation-content";
    let controller: ReturnType<typeof mountConversationManager> | undefined;
    const request: ContextualSurfaceRequest & { id: "conversations" } = {
      id: "conversations",
      anchor: anchor ?? el(".brand"),
      content,
      label: "Conversations",
      minSize: { width: 560, height: 560 },
      maxSize: { width: 1100, height: 760 },
      initialFocus: '.cp-toolbar input[type="search"]',
      beforeClose: async () => {
        try {
          await controller?.flush();
          return true;
        } catch (error) {
          report(error);
          return false;
        }
      },
      onClose: () => {
        if (!controller) return;
        const closing = controller;
        const disposal = closing
          .dispose()
          .then(() => {
            if (conversationManager === closing) {
              conversationManager = null;
              conversationSurface = null;
            }
          })
          .catch((error) => {
            report(error);
            // A failed recovery save keeps the same editor and its draft usable.
            if (conversationManager === closing)
              openWorkspacePanel(request).id = "conversation-surface";
          })
          .finally(() => {
            if (conversationDisposing === disposal)
              conversationDisposing = null;
          });
        conversationDisposing = disposal;
      },
    };
    conversationSurface = request;
    const surface = openWorkspacePanel(request, restoring);
    surface.id = "conversation-surface";
    surface.classList.add("aw-optical-controls");
    surface.dataset.awOptics = "workspace";
    const port: ConversationProductPort = {
      async command<K extends keyof ProductCommandMap>(
        name: K,
        input: ProductCommandMap[K]["input"],
      ): Promise<ProductCommandMap[K]["output"]> {
        const result = (await host.command!("conversation", {
          name,
          input,
        })) as ProductCommandMap[K]["output"];
        if (
          [
            "create",
            "organize",
            "archive",
            "send",
            "branch",
            "selectProvider",
          ].includes(name)
        )
          apply(
            (await host.command!("desktop", {
              type: "snapshot",
            })) as DesktopSnapshot,
          );
        return result;
      },
    };
    controller = conversationManager = mountConversationManager(content, port, {
      embedded: true,
      motion: experienceMotion,
      viewId: "conversation-manager",
      models: ordinaryModelControls,
      viewPersistence: chatViewPersistence,
      copy: copyText,
      onCreateChecklist: (resourceId) => newChecklist(resourceId),
      onOpenChatGPT: async (reference) => {
        const receipt = (await host.command!(
          "firstPartyChat",
          reference
            ? {
                target: "chatgpt-documentation",
                url: reference,
              }
            : {
                target: "chatgpt-home",
              },
        )) as { status?: string } | null;
        return {
          status:
            receipt?.status === "requested" || receipt?.status === "unavailable"
              ? receipt.status
              : "unknown",
        };
      },
      execution: conversationExecution,
      draftSession: composerSession,
      state: conversationView,
      ...(resourceId ? { resourceId, initialMessageId: messageId } : {}),
      onClose: () => surfaces.close("conversations"),
      onResource: (id, selectedMessageId) => {
        // Manager selection also emits this callback. Its own canonical chat
        // is already open; source links still use the shared dispatch below.
        if (conversationView.selectedResourceId === id) return;
        openCanonicalResource(id, selectedMessageId);
      },
    });
    await controller.ready;
  }
  function openVela() {
    if (velaOpen) {
      surfaces.close("vela", "close-button");
      return;
    }
    if (!velaPanel)
      velaPanel = mountVelaPanel(velaContent, velaClient, {
        missions: velaMissions,
        onPresentation: (value) => velaExperience.observe(value),
        onManifestation: (value) => velaManifestation.observe(value),
        onConnectProvider: () => host.command!("capabilities", {}),
        onOpenConnections: () => { surfaces.close("vela"); connections(); },
        listTimelineRepositories: async () => {
          const { repositories } = await host.command!("githubTimeline", { name: "sources", input: {} }) as { repositories: string[] };
          return repositories;
        },
        onOpenSubject: (subject) => {
          surfaces.close("vela");
          if (subject.kind === "collection") {
            void showConversations()
              .then(() => conversationManager?.openCollection(subject.id))
              .catch(report);
          } else if (subject.kind === "workspace") {
            void run({
              type: "navigate",
              target: { kind: "workspace", workspaceId: subject.id },
            });
          } else if (subject.kind === "project") {
            void run({
              type: "navigate",
              target: { kind: "constellation", projectId: subject.id },
            });
          } else {
            const timeline = state?.resources.find((resource) => resource.id === subject.id && resource.kind === "timeline");
            const placement = timeline && state?.blocks.find((block) => block.resource_id === timeline.id);
            void resourceOpener
              .open({
                resourceId: subject.id,
                origin: { source: "vela" },
                ...(placement ? {
                  preferredPresentation: "existing-placement",
                  preferredPlacement: { workspaceId: placement.workspace_id, blockId: placement.id },
                } : {}),
              })
              .catch(report);
          }
        },
      });
    velaOpen = true;
    velaOpening++;
    const surface = surfaces.open({
      id: "vela",
      anchor: el("#vela"),
      content: velaContent,
      label: "Vela",
      placement: "left",
      minSize: { width: 280, height: 110 },
      maxSize: { width: 560, height: 640 },
      preferredSize: velaManifestation.size(),
      initialFocus: ".vela-core-compose textarea",
      onClose: () => {
        velaOpen = false;
        velaPanel?.close();
        velaExperience.setActive(false);
        el("#vela").setAttribute("aria-expanded", "false");
      },
    });
    surface.id = "vela-assistant-surface";
    velaExperience.setActive(true);
    el("#vela").setAttribute("aria-controls", surface.id);
    el("#vela").setAttribute("aria-expanded", "true");
    void velaPanel.open().catch(report);
  }
  function refreshVelaFromEvent() {
    if (!velaPanel || velaRefreshTimer) return;
    velaRefreshTimer = setTimeout(() => {
      velaRefreshTimer = undefined;
      // Keep an in-progress settings edit intact while still observing real presence.
      const editing =
        velaContent.contains(document.activeElement) &&
        document.activeElement?.matches("input,textarea,select");
      void (
        velaOpen && !editing ? velaPanel!.refresh() : velaClient.state()
      ).catch(report);
    }, 150);
  }
  dialog.addEventListener("close", () =>
    returnFocusAfterDialogClose(dialog, lastTrigger),
  );
  function form(action: (data: FormData) => Promise<unknown>) {
    el<HTMLFormElement>("form", dialog).onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const button = el<HTMLButtonElement>('button[type="submit"]', dialog);
      button.disabled = true;
      try {
        await flush();
        await action(data);
        dialog.close();
      } catch (e) {
        el("#command-error", dialog).textContent = (e as Error).message;
        button.disabled = false;
      }
    };
  }
  function manager(restoring = false) {
    if (!state) return;
    environmentPresentation++;
    dialog.close();
    if (environmentNavigator && environmentSurface) {
      environmentNavigator.update(state);
      openWorkspacePanel(environmentSurface, restoring)
        .classList.add("application-environments");
      if (!restoring) environmentNavigator.focusSearch();
      return;
    }
    const content = document.createElement("div");
    const mutate = queueDesktop;
    environmentNavigator = mountEnvironmentNavigator(content, {
      snapshot: state,
      motion: hooks.motion,
      wake: hooks.wake,
      openWorkspace: async (workspaceId) => {
        const presentation = environmentPresentation;
        await mutate({
          type: "navigate",
          target: { kind: "workspace", workspaceId },
        });
        if (presentation === environmentPresentation)
          surfaces.close("environments");
      },
      openProject: async (projectId) => {
        const presentation = environmentPresentation;
        await mutate({
          type: "navigate",
          target: { kind: "constellation", projectId },
        });
        if (presentation === environmentPresentation)
          surfaces.close("environments");
      },
      createProject: (title) => mutate({ type: "createProject", title }),
      createWorkspace: async ({ title, projectId }) => {
        const presentation = environmentPresentation;
        const next = await mutate({
          type: "createWorkspace",
          title,
          projectId,
        });
        if (presentation === environmentPresentation)
          surfaces.close("environments");
        return next;
      },
      renameWorkspace: ({ id, title, expectedVersion }) =>
        mutate({
          type: "renameWorkspace",
          workspaceId: id,
          title,
          expectedVersion,
        }),
      archiveWorkspace: ({ id, expectedVersion, archived }) =>
        mutate({
          type: "archiveWorkspace",
          workspaceId: id,
          expectedVersion,
          archived,
        }),
      templates: async (projectId) => {
        surfaces.close("environments");
        templates(projectId);
      },
      askVela: async (projectId) => {
        surfaces.close("environments");
        openVela();
        const project = state?.projects.find((p) => p.id === projectId);
        const composer = el<HTMLTextAreaElement>(
          ".vela-core-compose textarea",
          velaContent,
        );
        if (!composer.value.trim())
          composer.value = `Help me create a workspace${project ? ` in project “${project.title}” (${project.id})` : ""} from available resources. Prepare a plan for my review.`;
        composer.focus();
      },
      newConversation: async () => {
        const presentation = environmentPresentation;
        await newConversation();
        if (presentation === environmentPresentation)
          surfaces.close("environments");
      },
      conversations: async () => {
        const presentation = environmentPresentation;
        await showConversations();
        if (presentation === environmentPresentation)
          surfaces.close("environments");
      },
      resources: async () => {
        surfaces.close("environments");
        picker();
      },
    });
    environmentSurface = {
      id: "environments",
      anchor: el("#workspace-manager"),
      content,
      label: "Environments",
      minSize: { width: 340, height: 240 },
      maxSize: { width: 520, height: 700 },
      placement: "right",
      initialFocus: 'input[type="search"]',
    };
    openWorkspacePanel(environmentSurface, restoring).classList.add("application-environments");
  }
  async function newConversation() {
    const created = await composerPort.command("create", {
      title: "",
      commandId: crypto.randomUUID(),
    });
    await resourceOpener.open({
      resourceId: created.resourceId,
      origin: { source: "application" },
    });
  }
  function add() {
    if (state?.navigation.kind !== "workspace" || !state.activeWorkspaceId) {
      manager();
      return;
    }
    const workspaceId = state.activeWorkspaceId;
    if (blockLibrary?.workspaceId === workspaceId) {
      surfaces.open(blockLibrary.request);
      return;
    }
    const content = document.createElement("div");
    content.className = "application-library-content";
    let controller: ReturnType<typeof mountBlockLibrary> | undefined;
    const request: ContextualSurfaceRequest = {
      id: "block-library",
      anchor: el(".aw-workspace-add"),
      content,
      label: "Add to workspace",
      minSize: { width: 480, height: 300 },
      maxSize: { width: 960, height: 740 },
      onClose: () => {
        controller?.dispose();
        if (blockLibrary?.view === controller) blockLibrary = undefined;
      },
    };
    surfaces.open(request);
    controller = mountBlockLibrary(content, libraryClient, {
      workspaceId,
      showHeader: false,
      drop: {
        motion: experienceMotion,
        viewId: workspaceId,
        point: (x, y) => state?.activeWorkspaceId === workspaceId ? workspaceDropPoint(x, y) : null,
      },
      bounds: () =>
        state?.navigation.kind === "workspace" &&
        state.activeWorkspaceId === workspaceId
          ? viewBounds()
          : undefined,
      context: () =>
        state?.activeWorkspaceId === workspaceId
          ? {
              projectId:
                state.workspaces.find(
                  (workspace) => workspace.id === workspaceId,
                )?.project_id ?? null,
              presentKinds: state.blocks
                .map((block) =>
                  block.resource_id
                    ? state!.resources.find(
                        (resource) =>
                          resource.id === block.resource_id &&
                          resource.available !== false &&
                          resource.visible !== false,
                      )?.kind
                    : block.subject &&
                        block.subject.kind !== "resource" &&
                        (!block.subjectState || block.subjectState === "active")
                      ? subjectBlockKind(block.subject)
                      : undefined,
                )
                .filter((kind): kind is BlockInstanceKind => !!kind),
            }
          : null,
      expectedLayoutVersion: () => {
        if (state?.navigation.kind !== "workspace" || state.activeWorkspaceId !== workspaceId)
          throw Error("workspace_changed");
        return state.layoutVersion;
      },
      onClose: () => {
        if (blockLibrary?.view === controller) surfaces.close("block-library");
      },
      onCreated: (result, origin) => {
        if (blockLibrary?.view !== controller || state?.activeWorkspaceId !== workspaceId) return;
        surfaces.close("block-library");
        if (origin === "drop") {
          if (document.body.classList.contains("focused")) hooks.home();
        } else revealCreatedPlacement(result.placementId);
      },
      onMediaCreated: (result) => {
        if (
          blockLibrary?.view !== controller ||
          state?.activeWorkspaceId !== workspaceId ||
          !result.placementId
        )
          return;
        surfaces.close("block-library");
        revealCreatedPlacement(result.placementId);
      },
      onSubjectCreated: (result, origin) => {
        if (blockLibrary?.view !== controller || state?.activeWorkspaceId !== workspaceId) return;
        surfaces.close("block-library");
        if (origin === "drop") {
          if (document.body.classList.contains("focused")) hooks.home();
        } else revealCreatedPlacement(result.placementId);
      },
    });
    blockLibrary = { workspaceId, request, view: controller };
  }
  function templates(projectId: string | null) {
    const content = document.createElement("div");
    content.className = "application-library-content";
    let controller: ReturnType<typeof mountWorkspaceTemplates> | undefined;
    surfaces.open({
      id: "workspace-templates",
      anchor: el("#workspace-manager"),
      content,
      label: "Workspace templates",
      minSize: { width: 480, height: 300 },
      maxSize: { width: 980, height: 760 },
      onClose: () => controller?.dispose(),
    });
    controller = mountWorkspaceTemplates(content, libraryClient, {
      projectId,
      expectedProjectVersion: state?.projects.find((p) => p.id === projectId)
        ?.version,
      currentWorkspace: () => state,
      currentConfigurations: () => {
        const blocks = state?.blocks ?? [];
        if (blocks.some((block) => !blockSettings.has(block.id)))
          throw new Error(
            "Block presentation preferences are still loading or unavailable. Reopen the card settings to retry before saving this template.",
          );
        return Object.fromEntries(
          blocks.map((block) => [
            block.id,
            blockSettings.get(block.id)!.configuration,
          ]),
        );
      },
      onApplied: async (result) => {
        // applyTemplate creates a new workspace. Frame it once using the existing
        // camera command; reopening/restoring saved workspaces never enters here.
        if (state?.activeWorkspaceId === result.workspaceId)
          await command({
            type: "bringAllIntoView",
            workspaceId: result.workspaceId,
          });
        surfaces.close("workspace-templates");
        hooks.home();
      },
      onClose: () => surfaces.close("workspace-templates"),
    });
  }
  function picker(restoring = false) {
    if (!state) return;
    const content = document.createElement("div");
    const anchor = el("#application-resources");
    const workspaceId = panelScope?.workspaceId ?? null;
    const view = mountContextualResources(content, {
      snapshot: () => ({
        workspaceId,
        resources: (state?.resources ?? []).map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          title: resource.title,
          available: resource.available,
          visible: resource.visible,
          canAttach: workspaceId === panelScope?.workspaceId &&
            BUILTIN_BLOCKS.some((definition) => definition.kind === resource.kind),
        })),
      }),
      async open(resourceId) {
        const opened = await resourceOpener.open({ resourceId, origin: { source: "library" } });
        if (opened.status !== "ready") throw Error("resource_unavailable");
        closeUnpinned("resources");
      },
      attach(resourceId) {
        return enqueueResult(async () => {
          await flush();
          if (!workspaceId || state?.activeWorkspaceId !== workspaceId || state.navigation.kind !== "workspace")
            throw Error("workspace_changed");
          const resource = state.resources.find((candidate) =>
            candidate.id === resourceId && candidate.visible !== false && candidate.available !== false);
          const definition = resource && BUILTIN_BLOCKS.find((item) => item.kind === resource.kind);
          if (!resource || !definition || !libraryClient.attachBlock)
            throw Error("resource_attachment_unavailable");
          const geometry = resource.media && mediaDefaultGeometry(resource.media);
          await libraryClient.attachBlock({
            commandId: crypto.randomUUID(),
            workspaceId,
            expectedLayoutVersion: state.layoutVersion,
            bounds: viewBounds(),
            resourceId,
            expectedResourceVersion: resource.version,
            kind: definition.kind,
            ...(geometry
              ? { presentation: { width: geometry.width, height: geometry.height, shape: geometry.shape } }
              : {}),
          });
          closeUnpinned("resources");
        });
      },
      actions: [
        {
          id: "standalone-note",
          label: "Note",
          run: () => enqueueResult(async () => {
            const known = new Set(state?.resources.map((resource) => resource.id));
            const next = await command({ type: "createResource", kind: "note", title: "Untitled note", workspaceId: null });
            const note = next.resources.find((resource) => !known.has(resource.id) && resource.kind === "note");
            if (!note) throw Error("created_resource_unavailable");
            await resourceOpener.open({ resourceId: note.id, origin: { source: "library" } });
            closeUnpinned("resources");
          }),
        },
        { id: "standalone-checklist", label: "Checklist", run: async () => { await newChecklist(); closeUnpinned("resources"); } },
        { id: "standalone-task-objective", label: "Task objective", run: async () => { await newTaskObjective(); closeUnpinned("resources"); } },
        { id: "new-activity-timeline", label: "Activity timeline", run: async () => { await newActivityTimeline(); closeUnpinned("resources"); } },
        {
          id: "standalone-file",
          label: "Import file",
          run: async () => {
            const imported = await mediaClient.chooseMediaForAdd({
              kind: "file",
              variant: "any",
            });
            if (imported) await showImportedResource(imported.resource.id);
          },
        },
        {
          id: "standalone-link",
          label: "Save web link",
          run: () => {
            content.querySelector<HTMLDetailsElement>(".aw-context-create")!.open = false;
            importResourceLink(anchor);
          },
        },
      ],
    });
    content.querySelector<HTMLElement>(".aw-context-search")!.id = "resource-search";
    content.querySelector<HTMLElement>(".aw-context-resource-list")!.id = "resource-results";
    for (const action of content.querySelectorAll<HTMLElement>("[data-resource-action]"))
      action.id = action.dataset.resourceAction!;
    const motion = conversationDisclosures(content, { motion: experienceMotion, viewId: "context-resources" });
    openWorkspacePanel({
      id: "resources",
      anchor,
      content,
      label: "Resources",
      placement: "bottom",
      minSize: { width: 360, height: 310 },
      maxSize: { width: 790, height: 730 },
      preferredSize: { width: 500, height: 520 },
      initialFocus: "#resource-search",
      onClose: () => {
        motion.dispose();
        view.dispose();
        if (resourcesView === view) {
          resourcesView = null;
          resourcesMotion = null;
        }
        anchor.setAttribute("aria-expanded", "false");
      },
    }, restoring).classList.add("application-resources");
    resourcesView = view;
    resourcesMotion = motion;
    motion.sync();
    anchor.setAttribute("aria-expanded", "true");
  }
  async function showImportedResource(resourceId: string) {
    try {
      const opened = await resourceOpener.open({
        resourceId,
        origin: { source: "library" },
      });
      if (opened.status === "ready") closeUnpinned("resources");
      else if (opened.status !== "superseded")
        hooks.status("Saved. Open it again from Resources.");
    } catch {
      hooks.status("Saved. Open it again from Resources.");
    }
  }
  function importResourceLink(anchor: HTMLElement) {
    const content = document.createElement("div");
    content.className = "aw-contextual-resources aw-optical-controls";
    content.dataset.awOptics = "workspace";
    const form = document.createElement("form");
    form.className = "aw-context-toolbar";
    const address = document.createElement("input");
    address.type = "url";
    address.required = true;
    address.maxLength = 8192;
    address.className = "aw-context-search";
    address.placeholder = "https://…";
    address.setAttribute("aria-label", "Web address");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "aw-context-control";
    submit.textContent = "Save link";
    for (const control of [address, submit])
      control.dataset.aerynthMotionControl = "true";
    const failure = document.createElement("p");
    failure.className = "aw-context-error";
    failure.setAttribute("role", "alert");
    failure.hidden = true;
    form.append(address, submit);
    content.append(form, failure);
    const surface = surfaces.open({
      id: "resource-link-import",
      anchor,
      label: "Save a web link",
      content,
      placement: "bottom",
      preferredSize: { width: 390, height: 148 },
      initialFocus: 'input[type="url"]',
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      failure.hidden = true;
      let url: string;
      try {
        url = canonicalMediaUrl(address.value).href;
      } catch {
        failure.textContent = "Enter a web address starting with https:// or http://.";
        failure.hidden = false;
        address.focus();
        return;
      }
      submit.disabled = true;
      address.readOnly = true;
      try {
        const imported = await mediaClient.chooseMediaForAdd({
          kind: "link",
          url,
        });
        if (imported && surface.isConnected && surface.open && !surface.inert) {
          surfaces.close("resource-link-import");
          await showImportedResource(imported.resource.id);
        }
      } catch {
        failure.textContent = "Could not save the link. The address is still here.";
        failure.hidden = false;
      } finally {
        submit.disabled = false;
        address.readOnly = false;
      }
    });
  }
  function taskGroupMembers(groupId: string) {
    const group = state?.resources.find((r) => r.id === groupId);
    if (!group || group.kind !== "task_group") return;
    const selected = new Set(group.taskMembers?.map((t) => t.id));
    open(
      "Tasks in " + escape(group.title),
      `<form id="task-group-members"><p>Choose existing local tasks. Membership references the same tasks and never starts an execution.</p>${
        state!.resources
          .filter((r) => r.kind === "task" && r.available !== false)
          .map(
            (task) =>
              `<label class="task-member-choice"><input type="checkbox" name="taskId" value="${task.id}" ${selected.has(task.id) ? "checked" : ""}>${escape(task.title)}</label>`,
          )
          .join("") || "<p>Create a task first, then add it here.</p>"
      }<button type="submit">Save task membership</button></form>`,
    );
    form(async (data) =>
      command({
        type: "setTaskGroupMembers",
        groupId,
        expectedVersion: group.version,
        taskIds: data.getAll("taskId").map(String),
      }),
    );
  }
  function geometry(blockId: string) {
    const block = state?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    open(
      "Card",
      `<div class="layout-actions"><button id="focus-card">Open</button><button id="minimize-card" ${block.locked ? "disabled" : ""}>${block.minimized ? "Restore" : "Minimize"}</button><button id="front-card">Bring to front</button><button id="detach-card">Remove from workspace</button></div><label><input type="checkbox" id="block-lock" ${block.locked ? "checked" : ""}> Lock placement</label><form><label>Presentation<select name="shape"><option value="rounded">Card</option><option value="lens">Lens</option><option value="circle">Circle</option><option value="pill">Pill</option></select></label><button type="submit">Save presentation</button></form>`,
    );
    const configurationRoot = document.createElement("section");
    configurationRoot.className = "card-content-preferences";
    dialog.append(configurationRoot);
    cardConfiguration = mountBlockConfiguration(
      configurationRoot,
      {
        ...libraryClient,
        getBlockSettings: async (id) => {
          if (!libraryClient.getBlockSettings)
            throw new Error("block_configuration_unavailable");
          const settings = await libraryClient.getBlockSettings(id);
          rememberBlockSettings(settings);
          return settings;
        },
        configureBlock: async (input) => {
          if (!libraryClient.configureBlock)
            throw new Error("block_configuration_unavailable");
          const settings = await libraryClient.configureBlock(input);
          rememberBlockSettings(settings);
          return settings;
        },
      },
      blockId,
      (configuration) => {
        const article = document.querySelector<HTMLElement>(
          `[data-block="${blockId}"]`,
        );
        if (article) applyBlockConfiguration(article, configuration);
      },
    );
    el<HTMLSelectElement>('[name="shape"]', dialog).value = [
      "rectangle",
      "folio",
    ].includes(block.shape)
      ? "rounded"
      : block.shape;
    el("#focus-card", dialog).onclick = () => {
      dialog.close();
      reveal(blockId);
      hooks.focus(blockId);
    };
    el("#front-card", dialog).onclick = () => {
      dialog.close();
      void run({ type: "layerBlock", blockId, direction: "front" });
    };
    el("#minimize-card", dialog).onclick = () => {
      dialog.close();
      void changeBlockMinimized(blockId, !block.minimized, block.version).catch(
        report,
      );
    };
    el("#detach-card", dialog).onclick = () => {
      dialog.close();
      void removeBlockPlacement(blockId).catch(report);
    };
    el<HTMLInputElement>("#block-lock", dialog).onchange = (event) => {
      dialog.close();
      void run({
        type: "lockBlock",
        blockId,
        expectedVersion: block.version,
        locked: (event.target as HTMLInputElement).checked,
      });
    };
    form(async (data) =>
      command({
        type: "geometry",
        blockId,
        expectedVersion: block.version,
        placement: {
          x: block.x,
          y: block.y,
          width: block.width,
          height:
            String(data.get("shape")) === "circle" ? block.width : block.height,
          z: block.z,
        },
        shape: String(data.get("shape")) as Shape,
        rotation: block.rotation ?? 0,
      }),
    );
  }
  function removablePlacement(blockId: string) {
    const workspaceId = state?.activeWorkspaceId;
    const block = state?.blocks.find(item => item.id === blockId);
    return state?.navigation.kind === "workspace" && workspaceId &&
      block?.workspace_id === workspaceId && !block.locked ? block : null;
  }
  async function removeBlockPlacement(blockId: string) {
    const before = removablePlacement(blockId);
    if (!before || !state) throw Error("placement_unavailable");
    const layoutVersion = state.layoutVersion;
    await enqueueResult(async () => {
      await flush();
      const current = removablePlacement(blockId);
      if (!current || current.workspace_id !== before.workspace_id ||
          current.version !== before.version || state?.layoutVersion !== layoutVersion)
        throw Error("stale_placement");
      await command({ type: "detach", blockId, expectedVersion: before.version, expectedLayoutVersion: layoutVersion });
    });
  }
  function openCardActions(blockId: string, event: MouseEvent) {
    const block = state?.blocks.find(item => item.id === blockId);
    if (state?.navigation.kind !== "workspace" || !block) return;
    const content = document.createElement("div");
    content.className = "application-card-actions aw-optical-controls";
    content.dataset.awOptics = "workspace";
    const action = (label: string, invoke: () => void, disabled = false) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      control.dataset.aerynthMotionControl = "true";
      control.disabled = disabled;
      control.onclick = () => {
        surfaces.close("card-actions");
        invoke();
      };
      content.append(control);
    };
    action("Open", () => { reveal(blockId); hooks.focus(blockId); });
    action("Bring to front", () => { void run({ type: "layerBlock", blockId, direction: "front" }); });
    action(block.minimized ? "Restore" : "Minimize", () => {
      void changeBlockMinimized(blockId, !block.minimized, block.version).catch(report);
    }, block.locked);
    action("Card settings", () => geometry(blockId));
    action("Remove from workspace", () => { void directBindings.get(blockId)?.remove(); }, !removablePlacement(blockId));
    const article = document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`);
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    surfaces.open({
      id: "card-actions",
      anchor: fromKeyboard && article ? article : { x: event.clientX, y: event.clientY, width: 1, height: 1 },
      content,
      label: "Card actions",
      minSize: { width: 210, height: 220 },
      maxSize: { width: 260, height: 300 },
      preferredSize: { width: 220, height: 240 },
      placement: "bottom",
      initialFocus: "button",
    });
  }
  function layouts(restoring = false) {
    if (!state?.activeWorkspaceId || state.navigation.kind !== "workspace") {
      manager();
      return;
    }
    dialog.close();
    if (workspaceActions && workspaceActionsSurface) {
      workspaceActions.update(state);
      openWorkspacePanel(workspaceActionsSurface, restoring)
        .classList.add("application-workspace-actions");
      return;
    }
    const content = document.createElement("section");
    const mutate = (action: DesktopCommand) => {
      const workspaceId = state?.activeWorkspaceId;
      const expectedLayoutVersion = state?.layoutVersion;
      return enqueueResult(async () => {
        await flush();
        if (
          !workspaceId ||
          state?.activeWorkspaceId !== workspaceId ||
          state.navigation.kind !== "workspace"
        )
          throw Error("workspace_changed");
        return command({ ...action, expectedLayoutVersion });
      });
    };
    const organize = (
      organization: OrganizationUpdate,
      expectedRevision: number,
    ) => {
      if (!state?.activeWorkspaceId)
        return Promise.reject(Error("workspace_unavailable"));
      const workspaceId = state.activeWorkspaceId;
      queuePreview({ organization, intent: "mode" });
      paintPreview();
      previewCommitting = true;
      return mutate({
        type: "setOrganization",
        workspaceId,
        organization,
        expectedOrganizationRevision: expectedRevision,
      }).finally(() => {
        previewCommitting = false;
        cancelPreview();
      });
    };
    workspaceActions = mountWorkspaceActions(content, {
      snapshot: state,
      motion: hooks.motion,
      wake: hooks.wake,
      act: async (action) => {
        if (!state?.activeWorkspaceId) throw Error("workspace_unavailable");
        const workspaceId = state.activeWorkspaceId;
        if (action === "bring-all")
          return mutate({ type: "bringAllIntoView", workspaceId });
        if (action === "resolve")
          return mutate({ type: "resolveLayout", workspaceId });
        return mutate({ type: action });
      },
      changeMode: async (mode) => {
        if (!state?.organization) throw Error("organization_unavailable");
        return organize({ mode }, state.organization.revision);
      },
      configureOrganization: ({ organization, expectedRevision }) =>
        organize(organization, expectedRevision),
      applyStructuredPreset: (preset) => {
        if (!state?.activeWorkspaceId)
          return Promise.reject(Error("workspace_unavailable"));
        const workspaceId = state.activeWorkspaceId;
        queuePreview({ structuredPreset: preset, intent: "mode" });
        paintPreview();
        previewCommitting = true;
        return mutate({
          type: "applyStructuredPreset",
          workspaceId,
          preset,
        }).finally(() => {
          previewCommitting = false;
          cancelPreview();
        });
      },
      locateBlock: async (id) => {
        if (!state?.blocks.some((block) => block.id === id))
          throw Error("block_unavailable");
        surfaces.close("workspace-actions");
        reveal(id);
        hooks.focus(id);
      },
      locateVela: async () => {
        const p = state?.presence;
        if (!p) throw Error("vela_placement_unavailable");
        surfaces.close("workspace-actions");
        hooks.home();
        zoom = 1;
        offset = {
          x: innerWidth / 2 - (p.x + p.width / 2),
          y: innerHeight / 2 - (p.y + p.height / 2),
        };
        presenceTarget();
        hooks.layout();
        hooks.wake();
        await saveView();
        document.body.classList.add("vela-access");
        velaCard.focus();
      },
      lockVela: ({ expectedVersion, locked }) => {
        const p = state?.presence;
        if (!p) return Promise.reject(Error("vela_placement_unavailable"));
        return mutate({
          type: "setPresence",
          workspaceId: p.workspaceId,
          expectedVersion,
          placement: { locked },
        });
      },
      resources: async () => {
        surfaces.close("workspace-actions");
        picker();
      },
      constellation: async () => {
        await constellation?.controller.zoomOut();
        surfaces.close("workspace-actions");
      },
      stream: async () => {
        closeUnpinned("workspace-actions");
        showStream();
      },
      connections: async () => {
        surfaces.close("workspace-actions");
        connections();
      },
    });
    workspaceActionsSurface = {
      id: "workspace-actions",
      anchor:
        document.querySelector<HTMLElement>(
          '.aw-workspace-layout button[aria-label="Workspace actions"]',
        ) ?? el("#layout-manager"),
      content,
      label: "Workspace",
      minSize: { width: 340, height: 240 },
      maxSize: { width: 520, height: 700 },
      placement: "bottom",
    };
    openWorkspacePanel(workspaceActionsSurface, restoring)
      .classList.add("application-workspace-actions");
  }
  function reveal(id: string) {
    const b = state?.blocks.find((b) => b.id === id);
    if (!b) return;
    if (
      b.x * zoom + offset.x < 20 ||
      (b.x + b.width) * zoom + offset.x > innerWidth - 20
    )
      offset.x = innerWidth / 2 - (b.x + b.width / 2) * zoom;
    if (
      b.y * zoom + offset.y < 180 ||
      (b.y + b.height) * zoom + offset.y > innerHeight - 170
    )
      offset.y = innerHeight / 2 - (b.y + b.height / 2) * zoom;
    hooks.layout();
    void saveView();
  }
  function clearApproachReturn() {
    approachReturn?.button.remove();
    approachReturn = null;
    approachFocus = null;
  }
  function changeBlockMinimized(
    id: string,
    minimized: boolean,
    expectedVersion?: number,
  ) {
    return enqueueResult(async () => {
      await flush();
      const block = state?.blocks.find((item) => item.id === id);
      if (
        !block ||
        state?.navigation.kind !== "workspace" ||
        state.activeWorkspaceId !== block.workspace_id
      )
        throw Error("stale_workspace_context");
      if (expectedVersion !== undefined && expectedVersion !== block.version)
        throw Error("block_version_conflict");
      return command({
        type: "setBlockMinimized",
        workspaceId: block.workspace_id,
        blockId: id,
        expectedVersion: block.version,
        minimized,
        expectedLayoutVersion: state.layoutVersion,
      });
    });
  }
  function approachBlock(id: string, minimum: BlockApproachTarget) {
    const inputRevision = approachInputRevision;
    return enqueueResult(async () => {
      const workspaceId = state?.activeWorkspaceId;
      await flush();
      const block = state?.blocks.find((block) => block.id === id);
      const body = blockFootprints.get(id);
      if (
        !workspaceId ||
        state?.activeWorkspaceId !== workspaceId ||
        state.navigation.kind !== "workspace" ||
        !block ||
        !body ||
        preview ||
        unavailableBlocks.has(id) ||
        !blockPresentations.get(id)?.visible
      )
        throw Error("card_approach_unavailable");
      // Keep the canonical camera verbatim. Inverting its pixel transform can
      // round fractional origins, changing the view saved by Return.
      const previous = { ...(state.viewport ?? { x: 0, y: 0, zoom: 1 }) };
      const framed = approachWorkspaceCard({
        block,
        view: previous,
        body,
        minimum,
        safe: {
          x: 20,
          y: 170,
          width: Math.max(1, innerWidth - 40),
          height: Math.max(1, innerHeight - 320),
        },
      });
      if (framed.constrained && framed.viewport.zoom <= previous.zoom + 1e-8)
        throw Error("card_approach_needs_more_room");
      await command({
        type: "setViewport",
        workspaceId,
        viewport: framed.viewport,
      });
      if (
        state?.activeWorkspaceId !== workspaceId ||
        state.navigation.kind !== "workspace"
      )
        return;
      if (!approachReturn || approachReturn.blockId !== id) {
        clearApproachReturn();
        const article = document.querySelector<HTMLElement>(
          `[data-block="${id}"]`,
        );
        const actions = article?.querySelector(".folio-actions");
        if (!actions) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "aw-block-approach";
        button.textContent = "↶";
        button.title = "Return to previous view";
        button.setAttribute("aria-label", "Return to previous view");
        button.setAttribute("data-no-card-drag", "");
        approachReturn = { workspaceId, blockId: id, view: previous, button };
        button.onclick = () => {
          const saved = approachReturn;
          if (!saved || saved.button !== button) return;
          button.disabled = true;
          void enqueueResult(async () => {
            await flush();
            if (
              state?.activeWorkspaceId !== saved.workspaceId ||
              state.navigation.kind !== "workspace"
            )
              throw Error("workspace_changed");
            await command({
              type: "setViewport",
              workspaceId: saved.workspaceId,
              viewport: saved.view,
            });
            if (approachReturn === saved) clearApproachReturn();
          }).catch((error) => {
            button.disabled = false;
            report(error);
          });
        };
        actions.append(button);
      }
      if (inputRevision === approachInputRevision)
        approachFocus = {
          workspaceId,
          blockId: id,
          deadline: performance.now() + 5000,
        };
      hooks.wake();
    });
  }
  function revealCreatedPlacement(id: string) {
    hooks.home();
    const workspaceId = state?.activeWorkspaceId;
    void enqueue(async () => {
      if (!workspaceId || state?.activeWorkspaceId !== workspaceId ||
          state.navigation.kind !== "workspace") return;
      const added = state.blocks.find((block) => block.id === id);
      if (!added) return;
      const bounds = viewBounds();
      const isInView = (block: Block) => {
        const box = footprint({ ...block, locked: !!block.locked });
        return box.x >= bounds.x && box.y >= bounds.y &&
          box.x + box.width <= bounds.x + bounds.width &&
          box.y + box.height <= bounds.y + bounds.height;
      };
      if (!isInView(added)) {
        if (state.blocks.every((block) => block.id === id || isInView(block)))
          await command({ type: "bringAllIntoView", workspaceId });
        else
          reveal(id);
      }
      if (state?.activeWorkspaceId !== workspaceId || state.navigation.kind !== "workspace") return;
      const article = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
      if (article) {
        article.tabIndex = -1;
        article.focus({ preventScroll: true });
      }
    });
  }
  function saveView() {
    return state?.activeWorkspaceId
      ? run({
          type: "setViewport",
          workspaceId: state.activeWorkspaceId,
          viewport: { x: -offset.x / zoom, y: -offset.y / zoom, zoom },
        })
      : Promise.resolve();
  }
  function composerSession(resourceId: string) {
    let session = composerSessions.get(resourceId);
    if (!session) {
      if (
        !state?.resources.some(
          (resource) =>
            resource.id === resourceId &&
            resource.kind === "conversation" &&
            resource.available !== false,
        )
      )
        throw new Error("conversation_unavailable");
      session = new ConversationDraftSession({
        resourceId,
        port: composerPort,
        onChange: () => {
          for (const block of state?.blocks.filter(
            (block) => block.resource_id === resourceId,
          ) ?? []) {
            const article = document.querySelector<HTMLElement>(
              `[data-block="${block.id}"]`,
            );
            if (article) refreshBlockIdentity(article, block.id);
          }
        },
      });
      composerSessions.set(resourceId, session);
    }
    return session;
  }
  function noteSession(resourceId: string) {
    let session = noteSessions.get(resourceId);
    if (!session) {
      const resource = state?.resources.find((r) => r.id === resourceId);
      if (
        !resource ||
        resource.available === false ||
        !["note", "research", "reference", "task", "task_group"].includes(
          resource.kind,
        )
      )
        throw new Error("note_resource_unavailable");
      session = new NoteSession(resourceId, notesClient, resource);
      noteSessions.set(resourceId, session);
    }
    return session;
  }
  function ensureNoteView(id: string) {
    if (noteViews.has(id)) return;
    const block = state?.blocks.find((b) => b.id === id),
      article = document.querySelector<HTMLElement>(`[data-block="${id}"]`),
      resource = block?.resource_id
        ? state?.resources.find((r) => r.id === block.resource_id)
        : undefined;
    if (
      !article ||
      !resource ||
      resource.available === false ||
      !["note", "research", "reference", "task", "task_group"].includes(
        resource.kind,
      )
    )
      return;
    const editor = document.createElement("textarea");
    editor.spellcheck = false;
    editor.maxLength = 100000;
    editor.setAttribute("aria-label", resource.title + " content");
    editor.addEventListener("input", () => {
      if (editor.value.length > editor.maxLength)
        editor.value = editor.value.slice(0, editor.maxLength);
      saveContent(resource.id, editor.value, article);
      el(".folio-preview", article).textContent = editor.value.split("\n\n")[0];
      hooks.wake();
    });
    editor.placeholder =
      resource.kind === "note"
        ? "Start writing…"
        : resource.kind === "task"
          ? "Describe this task…"
          : resource.kind === "research"
            ? "Questions, findings and sources…"
            : "Add your notes…";
    let documentRoot = el(".working-content", article);
    if (resource.kind === "task_group") {
      let body = documentRoot.querySelector<HTMLElement>(
        ".task-group-description-body",
      );
      if (!body) {
        const disclosure = document.createElement("details"),
          summary = document.createElement("summary");
        disclosure.className = "task-group-description";
        disclosure.style.cssText =
          "flex:0 1 auto;min-height:0;max-height:45%;overflow:auto";
        summary.textContent = "Description";
        body = document.createElement("div");
        body.className = "task-group-description-body";
        for (const child of [...documentRoot.children])
          if (!child.classList.contains("task-group-primary"))
            body.append(child);
        disclosure.append(summary, body);
        documentRoot.append(disclosure);
      }
      documentRoot = body;
    }
    const label = document.createElement("label");
    label.textContent = "Working draft";
    label.append(editor);
    documentRoot.append(label);
    const session = noteSession(resource.id),
      view = mountNoteExperience(documentRoot, editor, session, notesClient, {
        copyText,
        kind: resource.kind,
        active: true,
        presentation: blockPresentation(id),
        openRelated: openRelatedResources,
        initialMode: ["research", "reference"].includes(resource.kind)
          ? "read"
          : "write",
      });
    noteViews.set(id, view);
  }
  function saveContent(
    resourceId: string,
    content: string,
    article: HTMLElement,
  ) {
    const previous = drafts.get(resourceId);
    clearTimeout(previous?.timer);
    const draft: { content: string; timer?: ReturnType<typeof setTimeout> } = {
      content,
    };
    drafts.set(resourceId, draft);
    const session = noteSession(resourceId);
    el(".saved", article).textContent = "Saving recovery draft…";
    void session.edit(content).catch(report);
    const blockId = article.dataset.block;
    if (blockId) refreshBlockIdentity(article, blockId);
    draft.timer = setTimeout(() => {
      void enqueue(async () => {
        await flush();
        el(".saved", article).textContent = "Saved in local SQLite";
      });
    }, 350);
  }
  function openRelatedResources(resourceId: string, trigger: HTMLElement) {
    const available = () =>
      state?.resources.some(
        (resource) =>
          resource.id === resourceId &&
          resource.available !== false &&
          resource.visible !== false &&
          resource.state !== "archived",
      );
    if (!trigger.isConnected || !available())
      throw Error("resource_unavailable");
    // Document actions close their details before this callback. Anchor to the
    // still-visible summary rather than its now-hidden menu item.
    const anchor =
      trigger
        .closest(".aw-note-actions")
        ?.querySelector<HTMLElement>("summary") ?? trigger;
    const content = document.createElement("div");
    let closed = false;
    let view: ReturnType<typeof mountResourceLinks> | undefined;
    view = mountResourceLinks(
      content,
      resourceId,
      createRelatedResourcesPort({
        active: () => !closed && anchor.isConnected && !!available(),
        enqueue: enqueueResult,
        flush,
        read: () => command({ type: "snapshot" }),
        change: async (action) => {
          const next = (await host.command!(
            "graphAction",
            action,
          )) as DesktopSnapshot;
          apply(next);
          return next;
        },
        openResource: (id) => {
          surfaces.close("related-resources");
          openCanonicalResource(id);
        },
      }),
    );
    try {
      surfaces.open({
        id: "related-resources",
        anchor,
        content,
        label: "Related resources",
        minSize: { width: 440, height: 240 },
        maxSize: { width: 440, height: 520 },
        initialFocus: 'input[type="search"]',
        onClose: () => {
          closed = true;
          view?.dispose();
        },
      });
    } catch (error) {
      closed = true;
      view.dispose();
      throw error;
    }
  }
  function openCanonicalResource(resourceId: string, messageId?: string) {
    void resourceOpener
      .open({
        resourceId,
        origin: { source: "application" },
        ...(messageId ? { selection: { messageId } } : {}),
      })
      .catch(report);
  }
  function decorateSubject(article: HTMLElement, block: Block) {
    if (!block.subject || block.subject.kind === "resource") return;
    article.dataset.shape = block.shape;
    const surface = el(".working-content", article);
    el(".grip span", article).textContent =
      block.subject.kind === "project"
        ? "PROJECT"
        : block.subject.kind === "collection"
          ? "COLLECTION"
          : "RESOURCES";
    if (block.subjectState && block.subjectState !== "active") {
      subjectViews.get(block.id)?.dispose();
      subjectViews.delete(block.id);
      subjectRefreshKeys.delete(block.id);
      subjectProjections.set(block.id, {
        phase: "unavailable",
        message:
          "This project or collection is archived or unavailable. Your card layout is retained.",
      });
      surface.textContent =
        "This canonical subject is archived or unavailable. Its view placement is retained.";
      return;
    }
    if (subjectViews.has(block.id)) {
      const key =
        JSON.stringify(block.subject) +
        "/" +
        subjectDataKey +
        "/" +
        subjectDataEpoch;
      if (subjectRefreshKeys.get(block.id) !== key) {
        subjectRefreshKeys.set(block.id, key);
        void subjectViews.get(block.id)!.refresh();
      }
      return;
    }
    surface.replaceChildren();
    const client = libraryClient as typeof libraryClient &
      Partial<SubjectExperiencePort>;
    const unavailable = () =>
      Promise.reject(new Error("subject_view_native_service_unavailable"));
    const view = mountSubjectExperience(
      surface,
      block.subject,
      {
        projectOverview: client.projectOverview?.bind(client) ?? unavailable,
        browseResources: client.browseResources?.bind(client) ?? unavailable,
      },
      {
        active: activeBlocks.get(block.id) ?? false,
        presentation: blockPresentation(block.id),
        visible: blockPresentations.get(block.id)?.visible ?? false,
        onProjection: (projection) => {
          if (
            !state?.blocks.some(
              (current) =>
                current.id === block.id &&
                JSON.stringify(current.subject) ===
                  JSON.stringify(block.subject),
            )
          )
            return;
          subjectProjections.set(block.id, projection);
          refreshBlockIdentity(article, block.id);
        },
        openWorkspace: (workspaceId) => {
          void run({
            type: "navigate",
            target: { kind: "workspace", workspaceId },
          });
        },
        openResource: openCanonicalResource,
        openRelated: openRelatedResources,
        attachResource: (resource) => {
          const workspaceId = block.workspace_id;
          return enqueueResult(async () => {
            await flush();
            if (
              state?.navigation.kind !== "workspace" ||
              state.activeWorkspaceId !== workspaceId
            )
              throw new Error("workspace_changed");
            if (!libraryClient.attachBlock)
              throw new Error("attachment_unavailable");
            await libraryClient.attachBlock({
              commandId: crypto.randomUUID(),
              workspaceId,
              expectedLayoutVersion: state.layoutVersion,
              bounds: viewBounds(),
              resourceId: resource.id,
              kind: resource.kind,
              expectedResourceVersion: resource.version,
            });
          });
        },
      },
    );
    subjectViews.set(block.id, view);
    subjectRefreshKeys.set(
      block.id,
      JSON.stringify(block.subject) +
        "/" +
        subjectDataKey +
        "/" +
        subjectDataEpoch,
    );
  }
  function refreshBlockIdentity(article: HTMLElement, id: string) {
    const block = state?.blocks.find((block) => block.id === id);
    if (!block) return;
    const resource = block.resource_id
      ? state?.resources.find((resource) => resource.id === block.resource_id)
      : undefined;
    const kind =
      block.subject && block.subject.kind !== "resource"
        ? subjectBlockKind(block.subject)
        : resource?.kind;
    if (!REGISTERED_BLOCKS.some((definition) => definition.kind === kind))
      return;
    const knownKind = kind as BlockInstanceKind;
    let view = identityViews.get(id);
    if (!view) {
      view = mountBlockIdentity(article, {
        approach: (minimum) => approachBlock(id, minimum),
        restore: async () => {
          await changeBlockMinimized(id, false);
        },
        onMinimizedPresentationChange: (observation) => {
          syncBlockActivity(id);
          if (observation.effectiveMinimized && focusedBlocks.get(id))
            hooks.home();
          else hooks.layout();
        },
        toggleTask: (resourceId, done) =>
          enqueueResult(async () => {
            await flush();
            const task = state?.resources.find(
              (resource) =>
                resource.id === resourceId &&
                resource.kind === "task" &&
                resource.available !== false &&
                resource.visible !== false,
            );
            if (!task) throw Error("task_unavailable");
            await command({
              type: "taskStatus",
              resourceId,
              expectedVersion: task.version,
              status: done ? "done" : "open",
            });
          }),
        openResource: openCanonicalResource,
        openWorkspace: (workspaceId) => {
          void run({
            type: "navigate",
            target: { kind: "workspace", workspaceId },
          });
        },
        search: (query) => subjectViews.get(id)?.search(query),
        attachResource: async (resourceId) => {
          const subject = subjectViews.get(id);
          if (!subject) throw Error("resource_view_unavailable");
          await subject.attach(resourceId);
        },
        copy: copyText,
      });
      identityViews.set(id, view);
    }
    const events =
      knownKind === "stream"
        ? filterRecordedEvents(eventWindow(), {
            scope: "all",
            classification: "",
            source: "",
            resourceId: "",
            executionId: "",
            query: "",
          })
            .slice(0, 4)
            .reverse()
            .map((event) => ({
              id: event.eventId,
              type: event.type,
              source: event.providerId,
              classification: event.classification,
              receivedAt: event.receivedAt,
            }))
        : undefined;
    const content =
      resource && resource.available !== false
        ? (noteSessions.get(resource.id)?.snapshot().content ??
          resource.content)
        : "";
    const projection = subjectProjections.get(id);
    const key = JSON.stringify([
      knownKind,
      resource?.id,
      resource?.version,
      resource?.title,
      resource?.available,
      resource?.visible,
      resource?.taskStatus,
      resource?.taskPriority,
      resource?.taskMembers,
      resource?.provider,
      resource?.conversationRevision,
      resource?.execution,
      resource?.messages.slice(-2),
      events,
      eventDisconnected,
      agentProjections.get(id),
    ]);
    const cached = identityModels.get(id);
    const timeline = timelineProjections.get(id);
    const model =
      cached &&
      cached.key === key &&
      cached.content === content &&
      cached.projection === projection &&
      cached.taskObjective === taskProjections.get(id) &&
      cached.timeline === timeline
        ? cached.model
        : blockIdentity({
            kind: knownKind,
            resource,
            content,
            subject: projection,
            events,
            disconnected: eventDisconnected,
            agent: agentProjections.get(id),
            taskObjective: taskProjections.get(id),
            timeline,
          });
    identityModels.set(id, {
      key,
      content,
      projection,
      model,
      taskObjective: taskProjections.get(id),
      timeline,
    });
    view.update(model);
    view.setMinimized(block.minimized === true);
    const footprint = blockFootprints.get(id);
    if (footprint) view.setFootprint(footprint);
  }
  function paintBlockAvailability(article: HTMLElement, block: Block) {
    const subject =
      block.subject && block.subject.kind !== "resource" ? block.subject : null;
    const resource = block.resource_id
      ? state?.resources.find((resource) => resource.id === block.resource_id)
      : undefined;
    const kind = subject ? subjectBlockKind(subject) : resource?.kind;
    const reason =
      resource?.available === false
        ? null
        : unavailableBlock({
            kind,
            settingsError: settingsFailures.get(block.id),
            missingResource: !subject && !resource,
          });
    if (reason) unavailableBlocks.add(block.id);
    else unavailableBlocks.delete(block.id);
    const changed = showUnavailableBlock(article, reason, {
      kind,
      referenceId: resource?.id ?? block.resource_id ?? block.id,
      preview:
        resource?.content.split("\n\n")[0] ??
        "Canonical project and resource view",
      subtitle: resource
        ? `${resource.kind} · ${resource.id.slice(0, 8)}`
        : subject
          ? subjectBlockKind(subject).replaceAll("_", " ")
          : "Unavailable resource",
      retry: () => {
        settingsFailures.delete(block.id);
        loadBlockSettings(block.id);
      },
    });
    if (changed) {
      subjectViews
        .get(block.id)
        ?.setVisible(
          (blockPresentations.get(block.id)?.visible ?? false) && !reason,
        );
      syncBlockActivity(block.id);
      hooks.wake();
    }
    return !!reason;
  }
  function rememberBlockSettings(settings: BlockInstanceSettings) {
    if (!state?.blocks.some((block) => block.id === settings.placementId))
      return;
    blockSettings.set(settings.placementId, settings);
    settingsFailures.delete(settings.placementId);
    const article = document.querySelector<HTMLElement>(
      `[data-block="${settings.placementId}"]`,
    );
    if (article) {
      applyBlockConfiguration(article, settings.configuration);
      article.dataset.configurationState = "ready";
      const block = state?.blocks.find(
        (block) => block.id === settings.placementId,
      );
      if (block) paintBlockAvailability(article, block);
      hooks.wake();
    }
  }
  function loadBlockSettings(id: string) {
    const cached = blockSettings.get(id);
    if (cached) {
      rememberBlockSettings(cached);
      return;
    }
    if (
      settingsReads.has(id) ||
      settingsFailures.has(id) ||
      !libraryClient.getBlockSettings
    )
      return;
    const read = libraryClient
      .getBlockSettings(id)
      .then(rememberBlockSettings)
      .catch((error) => {
        if (!state?.blocks.some((block) => block.id === id)) return;
        settingsFailures.set(id, error);
        const article = document.querySelector<HTMLElement>(
          `[data-block="${id}"]`,
        );
        if (article) {
          article.dataset.configurationState = "unavailable";
          const block = state?.blocks.find((block) => block.id === id);
          if (block) paintBlockAvailability(article, block);
        }
      })
      .finally(() => settingsReads.delete(id));
    settingsReads.set(id, read);
  }
  function decorate(article: HTMLElement, id: string) {
    article
      ?.querySelector(".working-content")
      ?.setAttribute("data-no-card-drag", "");
    decorateFunctional(article, id);
    if (!article) return;
    refreshBlockIdentity(article, id);
    const block = state?.blocks.find((block) => block.id === id);
    if (block) paintBlockAvailability(article, block);
  }
  function decorateFunctional(article: HTMLElement, id: string) {
    if (!article) return;
    const b = state?.blocks.find((b) => b.id === id);
    if (!b) return;
    loadBlockSettings(id);
    article.dataset.locked = String(!!b.locked);
    if (!directBindings.has(id))
      directBindings.set(
        id,
        mountDirectManipulation(article, {
          blockId: id,
          focusedDrop: workspaceDropPoint,
          canRemove: () => !!removablePlacement(id) &&
            !document.querySelector('dialog[open]:not([data-surface-id="card-actions"])'),
          remove: () => removeBlockPlacement(id),
          onGestureChange: (gesture) => {
            if (gesture) directGestures.set(id, gesture);
            else directGestures.delete(id);
            hooks.layout();
            hooks.wake();
          },
          state: () => {
            const current = state && layoutState(state);
            return current && state?.activeWorkspaceId
              ? { ...current, workspaceId: state.activeWorkspaceId }
              : null;
          },
          preview: (presentation, intent) => {
            const current = state?.blocks.find((block) => block.id === id);
            if (current)
              queuePreview({
                placements: [
                  {
                    blockId: id,
                    expectedVersion: current.version,
                    presentation,
                  },
                ],
                intent,
              });
          },
          commit: async (action) => {
            if (action.type !== "saveLayout" || action.placements.length !== 1)
              throw new Error("invalid_direct_gesture");
            const current = state?.blocks.find((block) => block.id === id);
            if (
              !current ||
              state?.activeWorkspaceId !== action.workspaceId ||
              state.layoutVersion !== action.expectedRevision
            )
              throw new Error("layout_version_conflict");
            const patch = action.placements[0].presentation;
            const fromFocusedSide = directGestures.get(id)?.fromFocusedSide;
            await commitLayout({
              type: "geometry",
              blockId: id,
              expectedVersion: action.placements[0].expectedVersion,
              expectedLayoutVersion: action.expectedRevision,
              placement: {
                x: patch.x ?? current.x,
                y: patch.y ?? current.y,
                width: patch.width ?? current.width,
                height: patch.height ?? current.height,
                z: patch.zIndex ?? current.z,
              },
              shape: patch.shape ?? current.shape,
              rotation: patch.rotation ?? current.rotation ?? 0,
            }, true);
            if (fromFocusedSide && state?.activeWorkspaceId === action.workspaceId &&
                document.body.classList.contains("focused")) hooks.home();
          },
          cancel: cancelPreview,
          failed: report,
          context: (event) => openCardActions(id, event),
        }),
      );
    if (paintBlockAvailability(article, b)) return;
    if (b.subject && b.subject.kind !== "resource") {
      decorateSubject(article, b);
      return;
    }
    const r = state!.resources.find((r) => r.id === b.resource_id);
    if (!r) return;
    if (r.available === false) {
      article.querySelector(".task-group-summary")?.remove();
      article.querySelector(".conversation-transcript")?.replaceChildren();
      if (!article.querySelector(".resource-unavailable")) {
        const notice = document.createElement("p");
        notice.className = "resource-unavailable";
        notice.textContent =
          "Archived or unavailable resource. Its canonical data is retained. Detach this visual block if no longer needed.";
        el(".working-content", article).prepend(notice);
      }
      const editor = article.querySelector<HTMLTextAreaElement>("textarea");
      if (editor && !drafts.has(r.id)) {
        editor.value = "";
        editor.disabled = true;
      }
      return;
    }
    article.querySelector(".resource-unavailable")?.remove();
    const session = noteSessions.get(r.id),
      loaded = session?.snapshot();
    if (
      loaded?.document &&
      !loaded.dirty &&
      loaded.document.resource.version !== r.version
    )
      void session!.refresh().catch(report);

    const restoredEditor =
      article.querySelector<HTMLTextAreaElement>("textarea");
    if (restoredEditor) restoredEditor.disabled = false;
    article.dataset.shape = b.shape;
    el(".grip span", article).textContent =
      r.kind === "task_group"
        ? "TASK GROUP"
        : r.kind === "task_objective"
          ? "TASK TRACKER"
          : r.kind.toUpperCase();
    if (r.kind === "conversation") {
      const surface = el(".working-content", article);
      let view = chatViews.get(b.id);
      if (!view && activeBlocks.get(b.id)) {
        const session = composerSession(r.id);
        view = mountBlockChat(surface, {
          copy: copyText,
          motion: experienceMotion,
          viewId: "block:" + b.id + ":conversation",
          models: ordinaryModelControls,
          viewPersistence: chatViewPersistence,
          onProviderChange: async (change) => {
            if (change.mode === "continuation") {
              await showConversations(change.resourceId);
              await conversationManager?.beginProviderContinuation(
                change.targetProviderId,
              );
            } else {
              await composerPort.command("selectProvider", {
                resourceId: change.resourceId,
                providerId: change.targetProviderId,
                expectedRevision: change.expectedRevision,
              });
              await command({ type: "snapshot" });
              await view?.refresh({ latest: false });
            }
          },
          resourceId: r.id,
          port: composerPort,
          draftSession: session,
          execution: conversationExecution,
          active: true,
          layoutActive: () => activeBlocks.get(b.id) === true,
          deferHostResize: () =>
            !directGestures.has(b.id) &&
            !surface.contains(document.activeElement) &&
            hooks.motion.bodies.get(b.id)?.transitioning === true,
          presentation: blockPresentation(b.id),
          onChanged: async () => {
            await command({ type: "snapshot" });
          },
          onViewState: (value) => {
            conversationView.drafts[value.resourceId] = value.content;
            conversationView.scroll[value.resourceId] = value.scroll;
            conversationView.messageOffset[value.resourceId] = value.offset;
          },
          openHistory: () => {
            conversations(r.id);
          },
          failed: report,
        });
        chatViews.set(b.id, view);
        chatRefreshKeys.set(b.id, String(r.conversationRevision ?? r.version));
      }
      const key = String(r.conversationRevision ?? r.version);
      if (view && activeBlocks.get(b.id) && chatRefreshKeys.get(b.id) !== key) {
        chatRefreshKeys.set(b.id, key);
        void view.refresh({ latest: true }).catch(report);
      }
      view?.setActive(activeBlocks.get(b.id) ?? false);
    } else if (r.kind === "task_objective") {
      const content = el(".working-content", article);
      let entry = taskTrackerViews.get(id);
      if (!entry && activeBlocks.get(id)) {
        content.replaceChildren();
        entry = {
          view: mountTaskTrackerExperience(
            content,
            r.id,
            productClients.taskObjectives,
            {
              ...taskTrackerOptions(content, "block:" + id),
              active: true,
              presentation: blockPresentation(id),
              showTitle: false,
              openResource: openCanonicalResource,
              resourceTitle: (resourceId) =>
                state?.resources.find(
                  (resource) =>
                    resource.id === resourceId &&
                    resource.available !== false &&
                    resource.visible !== false,
                )?.title,
              onProjection: (projection) => {
                taskProjections.set(id, projection);
                const target = document.querySelector<HTMLElement>(
                  `[data-block="${id}"]`,
                );
                if (target) decorate(target, id);
              },
            },
          ),
          version: r.version,
        };
        taskTrackerViews.set(id, entry);
      } else if (entry && entry.version !== r.version) {
        entry.version = r.version;
        void entry.view.refresh().catch(report);
      }
    } else if (r.kind === "timeline") {
      const content = el(".working-content", article);
      let entry = timelineViews.get(id);
      if (!entry && activeBlocks.get(id)) {
        content.replaceChildren();
        entry = {
          view: mountTimelineExperience(
            content,
            r.id,
            productClients.timelines,
            {
              viewId: "block:" + id,
              motion: experienceMotion,
              active: true,
              showTitle: false,
              presentation: blockPresentation(id),
              onOpenResource: openCanonicalResource,
              onOpenExternalSource: openGitHubCommit,
              onProjection: (document, window) => {
                timelineProjections.set(id, { document, window });
                if (article.isConnected) refreshBlockIdentity(article, id);
              },
              resourceTitle: (resourceId) =>
                state?.resources.find(
                  (resource) =>
                    resource.id === resourceId &&
                    resource.available !== false &&
                    resource.visible !== false,
                )?.title,
            },
          ),
          version: r.version,
        };
        timelineViews.set(id, entry);
      } else if (entry && entry.version !== r.version) {
        entry.version = r.version;
        void entry.view.refresh().catch(report);
      }
    } else if (r.kind === "agent") {
      const content = el(".working-content", article);
      let entry = agentBlockViews.get(id);
      if (!entry && activeBlocks.get(id)) {
        content.replaceChildren();
        entry = {
          view: mountAgentBlockExperience(content, r.id, {
            client: productClients.agents,
            motion: experienceMotion,
            viewId: "block:" + id,
            active: true,
            presentation: blockPresentation(id),
            onOpenAgent: showAgents,
            onOpenResource: openCanonicalResource,
            resourceTitle: (resourceId) =>
              state?.resources.find(
                (resource) =>
                  resource.id === resourceId &&
                  resource.available !== false &&
                  resource.visible !== false,
              )?.title,
            onProjection: (projection) => {
              agentProjections.set(id, projection);
              identityModels.delete(id);
              if (article.isConnected) refreshBlockIdentity(article, id);
            },
          }),
          version: r.version,
        };
        agentBlockViews.set(id, entry);
      } else if (entry && entry.version !== r.version) {
        entry.version = r.version;
        void entry.view.refresh().catch(report);
      }
    } else if (r.kind === "checklist") {
      const content = el(".working-content", article);
      let entry = checklistViews.get(id);
      if (!entry && activeBlocks.get(id)) {
        content.replaceChildren();
        entry = {
          view: mountChecklistExperience(
            content,
            r.id,
            productClients.checklists,
            {
              viewId: "block:" + id,
              motion: experienceMotion,
              active: true,
              presentation: blockPresentation(id),
              chooseReference: () => chooseChecklistReference(content),
              openReference: openChecklistReference,
            },
          ),
          version: r.version,
        };
        checklistViews.set(id, entry);
      } else if (entry && entry.version !== r.version) {
        entry.version = r.version;
        void entry.view.refresh().catch(report);
      }
    } else if (r.kind === "task_group") {
      const surface = el(".working-content", article);
      const members = r.taskMembers ?? [];
      let group = groupViews.get(id);
      if (!group && activeBlocks.get(id)) {
        const primary = document.createElement("div");
        primary.className = "task-group-primary";
        primary.style.display = "contents";
        surface.prepend(primary);
        group = mountTaskGroupExperience(primary, {
          members,
          active: activeBlocks.get(id) ?? false,
          presentation: blockPresentation(id),
          setStatus: ({ resourceId, status }) =>
            enqueueResult(async () => {
              await flush();
              const current = state?.resources.find(
                (resource) => resource.id === resourceId,
              );
              if (!current || current.available === false)
                throw new Error("task_unavailable");
              await command({
                type: "taskStatus",
                resourceId,
                expectedVersion: current.version,
                status,
              });
            }),
          manageMembers: () =>
            enqueueResult(async () => {
              await flush();
              taskGroupMembers(r.id);
            }),
          openTask: openCanonicalResource,
        });
        groupViews.set(id, group);
      }
      group?.update(members);
      el(".folio-preview", article).textContent = members.length
        ? members
            .map((t) => `${t.status === "done" ? "✓" : "○"} ${t.title}`)
            .join(" · ")
        : "Add existing local tasks with Manage tasks.";
      el(".folio-subtitle", article).textContent =
        `${members.filter((t) => t.status === "done").length}/${members.length} completed locally`;
      el(".synthetic", article).textContent =
        "LOCAL TASK GROUP · NO AUTOMATIC EXECUTION";
      const editor = article.querySelector<HTMLTextAreaElement>("textarea");
      if (editor && document.activeElement !== editor) {
        const content =
          noteSessions.get(r.id)?.snapshot().content ??
          drafts.get(r.id)?.content ??
          r.content;
        if (editor.value !== content) editor.value = content;
      }
    } else if (r.kind === "file" || r.kind === "link") {
      const view = mediaViews.get(id);
      const media = { ...r, kind: r.kind };
      if (view) view.update(media);
      else if (activeBlocks.get(id)) {
        const content = el(".working-content", article);
        content.inert = false;
        mediaViews.set(
          id,
          mountMediaExperience(content, media, mediaClient),
        );
      }
    } else if (r.kind === "stream") {
      const content = el(".working-content", article);
      if (!eventViews.has(id) && activeBlocks.get(id)) {
        content.replaceChildren();
        eventViews.set(
          id,
          mountEventExperience(
            content,
            {
              snapshot: eventWindow,
              refresh: refreshEvents,
              openResource: openCanonicalResource,
            },
            {
              active: activeBlocks.get(id) ?? false,
              presentation: blockPresentation(id),
            },
          ),
        );
      }
    } else {
      el(".synthetic", article).textContent =
        r.kind === "task"
          ? "LOCAL TASK · AUTOMATED EXECUTION UNAVAILABLE"
          : r.kind === "reference"
            ? "LOCAL REFERENCE · NO FILE ACCESS OR NETWORK REQUESTS"
            : "DURABLE LOCAL RESOURCE";
      const editor = article.querySelector<HTMLTextAreaElement>("textarea");
      if (editor) editor.setAttribute("aria-label", `${r.title} content`);
      if (editor && document.activeElement !== editor) {
        const content =
          noteSessions.get(r.id)?.snapshot().content ??
          drafts.get(r.id)?.content ??
          r.content;
        if (editor.value !== content) editor.value = content;
      }
      if (r.kind === "task") {
        if (!article.querySelector(".task-priority")) {
          const label = document.createElement("label");
          label.textContent = "Priority";
          const priority = document.createElement("select");
          priority.className = "task-priority";
          priority.setAttribute("aria-label", "Task priority");
          for (const value of ["low", "normal", "high", "urgent"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value[0].toUpperCase() + value.slice(1);
            priority.append(option);
          }
          label.append(priority);
          el(".working-content", article).prepend(label);
          priority.onchange = () => {
            const selectedPriority = priority.value as NonNullable<
              Resource["taskPriority"]
            >;
            priority.disabled = true;
            void enqueue(async () => {
              await flush();
              const current = state!.resources.find(
                (resource) => resource.id === r.id,
              )!;
              await command({
                type: "taskPriority",
                resourceId: r.id,
                expectedVersion: current.version,
                priority: selectedPriority,
              });
            }).finally(() => {
              priority.disabled = false;
              priority.value =
                state!.resources.find((resource) => resource.id === r.id)
                  ?.taskPriority ?? "normal";
            });
          };
        }
        el<HTMLSelectElement>(".task-priority", article).value =
          r.taskPriority ?? "normal";
        if (!article.querySelector(".task-completed")) {
          const label = document.createElement("label");
          label.className = "local-task-state";
          label.innerHTML =
            '<input class="task-completed" type="checkbox"> Completed locally';
          el(".working-content", article).prepend(label);
          el<HTMLInputElement>(".task-completed", article).onchange = (
            event,
          ) => {
            const checkbox = event.target as HTMLInputElement;
            if (checkbox.disabled) return;
            const status = checkbox.checked ? "done" : "open";
            checkbox.disabled = true;
            checkbox.setAttribute("aria-busy", "true");
            void enqueue(async () => {
              await flush();
              const current = state?.resources.find(
                (resource) => resource.id === r.id,
              );
              if (!current || current.available === false)
                throw new Error("task_unavailable");
              await command({
                type: "taskStatus",
                resourceId: r.id,
                expectedVersion: current.version,
                status,
              });
            }).finally(() => {
              const current = state?.resources.find(
                (resource) => resource.id === r.id,
              );
              checkbox.checked = current?.taskStatus === "done";
              checkbox.disabled = !current || current.available === false;
              checkbox.removeAttribute("aria-busy");
            });
          };
        }
        el<HTMLInputElement>(".task-completed", article).checked =
          r.taskStatus === "done";
        el(".folio-subtitle", article).textContent =
          `Local task · ${r.taskStatus ?? "open"} · ${r.id.slice(0, 8)}`;
      }
    }
  }
  function eventWindow(): EventWindow {
    return {
      events: localEvents,
      earliest: retainedEarliest,
      latest: retainedLatest,
      disconnected: eventDisconnected,
      resources: (state?.resources ?? [])
        .filter(
          (resource) =>
            resource.available !== false && resource.visible !== false,
        )
        .map((resource) => ({
          id: resource.id,
          title: resource.title,
          projectId: resource.project_id ?? null,
        })),
      workspaceResourceIds: (state?.blocks ?? []).flatMap((block) =>
        block.resource_id ? [block.resource_id] : [],
      ),
      projectId:
        state?.workspaces.find(
          (workspace) => workspace.id === state?.activeWorkspaceId,
        )?.project_id ?? null,
    };
  }
  function scheduleStreamRefresh() {
    if (streamRefreshPending || (!streamView && !streamBlockIds.length)) return;
    streamRefreshPending = true;
    hooks.wake();
  }
  function paintStreamRefresh() {
    if (!streamRefreshPending) return;
    streamRefreshPending = false;
    streamView?.update();
    for (const view of eventViews.values()) view.update();
    if (!streamBlockIds.length) return;
    const events = filterRecordedEvents(eventWindow(), {
      scope: "all",
      classification: "",
      source: "",
      resourceId: "",
      executionId: "",
      query: "",
    });
    const summary = events.slice(0, 3)
      .map((event) => event.classification + " · " + event.type).join(" · ") ||
      "No accessible captured events in this retained window.";
    for (const id of streamBlockIds) {
      const article = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
      if (!article || blockPresentations.get(id)?.visible === false) continue;
      const preview = el(".folio-preview", article);
      if (preview.textContent === summary) continue;
      preview.textContent = summary;
      refreshBlockIdentity(article, id);
    }
  }
  function rememberEvent(e: Activity) {
    if (
      e.schemaVersion !== 1 ||
      !e.eventId ||
      !Number.isSafeInteger(e.cursor) ||
      e.cursor! < 1 ||
      typeof e.receivedAt !== "string" ||
      !e.providerId ||
      !["observed", "reported", "inferred", "simulated"].includes(
        e.classification ?? "",
      )
    )
      return false;
    if (seenEvents.has(e.eventId)) return false;
    seenEvents.add(e.eventId);
    if (e.type.toLocaleLowerCase().includes("collection")) {
      subjectDataEpoch++;
      for (const view of subjectViews.values()) void view.refresh();
    }
    localEvents.push(e as StreamEvent);
    localEvents.sort((a, b) => a.cursor - b.cursor);
    retainedLatest = Math.max(retainedLatest, e.cursor!);
    if (localEvents.length > 250) {
      const expired = localEvents.shift();
      if (expired) seenEvents.delete(expired.eventId);
    }
    return true;
  }
  async function refreshEvents() {
    const replay = await readRecentEvents(
      async (input) => (await host.command!("replay", input)) as ReplayWindow,
    );
    const newer = localEvents.filter((event) => event.cursor > replay.latest);
    localEvents.length = 0;
    seenEvents.clear();
    retainedEarliest = replay.earliest;
    retainedLatest = replay.latest;
    eventDisconnected = false;
    for (const event of [...replay.events, ...newer]) rememberEvent(event);
    scheduleStreamRefresh();
  }
  function showStream(restoring = false) {
    const content = document.createElement("div");
    const anchor = el("#application-stream");
    const view = mountContextualStream(content, {
      snapshot: eventWindow,
      refresh: refreshEvents,
      openResource: openCanonicalResource,
    });
    const viewId = "context-stream:" + ++streamSerial;
    const motion = conversationDisclosures(content, { motion: experienceMotion, viewId });
    const pickers = [...content.querySelectorAll<HTMLSelectElement>("select")]
      .map((select, i) => enhanceConversationSelect(select, {
        motion: experienceMotion,
        viewId: viewId + ":filter:" + i,
      }));
    openWorkspacePanel({
      id: "intelligence-stream",
      anchor,
      content,
      label: "Intelligence Stream",
      placement: "bottom",
      minSize: { width: 360, height: 320 },
      maxSize: { width: 810, height: 760 },
      preferredSize: { width: 600, height: 555 },
      initialFocus: 'input[type="search"]',
      onClose: () => {
        for (const picker of pickers) picker.dispose();
        motion.dispose();
        view.dispose();
        if (streamView === view) {
          streamView = null;
          streamMotion = null;
          streamPickers = [];
        }
        anchor.setAttribute("aria-expanded", "false");
      },
    }, restoring).classList.add("application-stream");
    streamView = view;
    streamMotion = motion;
    streamPickers = pickers;
    motion.sync();
    anchor.setAttribute("aria-expanded", "true");
  }
  function refreshTaskProjections() {
    if (taskRefreshPending) return;
    taskRefreshPending = true;
    queueMicrotask(() => {
      taskRefreshPending = false;
      void Promise.all([
        ...(state?.resources
          .filter((resource) => resource.kind === "task_objective")
          .map((resource) => directResources.refresh(resource.id)) ?? []),
        ...[...taskTrackerViews.values()].map((entry) => entry.view.refresh()),
      ]).catch(report);
    });
  }
  host.onEvent?.((event) => {
    refreshVelaFromEvent();
    const e = event as Activity & {
      resourceId?: string;
      payload?: { delta?: string };
    };
    if (e.type.startsWith("vela.mission/") || /^policy[./]/.test(e.type)) velaMissions.observe();
    if (e.type === "storage/reserve-admission-denied") {
      hooks.status("Storage check paused saving and new runs. Your data is retained.");
      return;
    }
    if (e.type === "storage/reserve-admission-restored") {
      hooks.status("Storage check passed. Saving is available again.");
      void enqueue(async () => {
        for (const session of composerSessions.values()) {
          if (session.snapshot().error !== "storage_reserve_admission_denied") continue;
          // Re-read before retrying so an intervening draft becomes a conflict,
          // while the retained local text and the canonical version stay intact.
          try {
            await session.reload();
            if (session.snapshot().phase === "dirty") await session.flush();
          } catch (error) {
            report(error);
          }
        }
      });
      return;
    }
    // Assistant text is handled by the one shared execution adapter. It is not
    // copied into a second transcript, activity payload cache or frame path.
    if (e.payload?.delta && e.resourceId) return;
    if (
      /^(execution\/|resource[./]|note[./]|conversation[./]|agent[./]|task-objective[./]|policy[./]|source[./])/.test(
        e.type,
      )
    )
      refreshTaskProjections();
    if (rememberEvent(e)) scheduleStreamRefresh();
    if (e.type === "provider/connection") {
      void connectionsView?.refresh();
      void conversationManager?.refresh().catch(report);
      for (const view of chatViews.values())
        void view.refresh({ latest: false }).catch(report);
    }
    if (e.type === "backend/disconnected") {
      eventDisconnected = true;
      scheduleStreamRefresh();
      hooks.status(
        "Backend disconnected. Current surfaces are retained; restart to recover persisted data. Execution outcomes may be unknown.",
      );
      hooks.vela("unavailable");
    }
  });
  el("#workspace-manager").onclick = () => manager();
  el("#application-resources").onclick = () => picker();
  el("#application-stream").onclick = () => {
    if (streamView) surfaces.close("intelligence-stream", "close-button");
    else showStream();
  };
  el("#stream-button").onclick = () => showStream();
  el("#application-agents").onclick = () => {
    void showAgents().catch(report);
  };
  el("#application-new-chat").onclick = () => {
    void newConversation().catch(report);
  };
  el("#application-connections").onclick = connections;
  el("#add-block").onclick = add;
  el("#resource-picker").onclick = () => picker();
  el("#layout-manager").onclick = () => layouts();
  el("#zoom-out").onclick = () => {
    if (constellation) void constellation.controller.zoomOut().catch(report);
  };
  el("#nav-back").onclick = () => {
    if (constellation?.controller.state.history.length)
      void constellation.controller.back().catch(report);
    else void run({ type: "back" });
  };
  el("#app").addEventListener(
    "wheel",
    (event) => {
      if (!constellation) return;
      const target = event.target;
      const active = document.activeElement;
      const factor = workspaceWheelFactor(event, {
        workspace: state?.navigation.kind === "workspace",
        background: [el("#world"), el("#stage"), el("#app")].includes(
          target as HTMLElement,
        ),
        blocked:
          !!preview ||
          previewCommitting ||
          !!presenceDrag ||
          !!cancelResize ||
          !!document.querySelector(
            ".aw-contextual-surface, dialog[open], .floating-dialog:not([hidden]), .folio.dragging",
          ) ||
          (active instanceof HTMLElement &&
            !!active.closest(
              'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
            )),
        hidden: document.hidden || !document.hasFocus(),
        pageHeight: innerHeight,
      });
      if (factor === null) return;
      event.preventDefault();
      try {
        void Promise.resolve(constellation.controller.zoom(factor)).catch(
          report,
        );
      } catch (error) {
        report(error);
      }
    },
    { passive: false },
  );
  function connections() {
    dialog.close();
    connectionsView?.dispose();
    const content = document.createElement("section");
    const controller = mountProviderConnections(content, {
      command: async (input) =>
        (await host.command!(
          "providerConnection",
          input,
        )) as ProviderConnectionStatus,
      newConversation: async () => {
        surfaces.close("connections");
        await newConversation();
      },
      codex: async () =>
        (await host.command!("capabilities", {})) as {
          authentication: string;
          models: string[];
        },
      changed: async () => {
        await conversationManager?.refresh();
        await Promise.all(
          [...chatViews.values()].map((view) =>
            view.refresh({ latest: false }),
          ),
        );
      },
    });
    connectionsView = controller;
    surfaces.open({
      id: "connections",
      anchor: el("#application-connections"),
      content,
      label: "Connections",
      minSize: { width: 340, height: 240 },
      maxSize: { width: 540, height: 680 },
      onClose: () => {
        controller.dispose();
        if (connectionsView === controller) connectionsView = null;
      },
    });
  }
  el("#connections").onclick = connections;
  addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      if (event.defaultPrevented || state?.navigation.kind === "constellation")
        return;
      event.preventDefault();
      manager();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "z" &&
      !["TEXTAREA", "INPUT"].includes((event.target as HTMLElement).tagName)
    ) {
      event.preventDefault();
      void run({ type: "undo" });
    }
  });
  addEventListener("beforeunload", (event) => {
    if (
      drafts.size ||
      [...noteSessions.values()].some((session) => session.hasPendingEdits) ||
      [...composerSessions.values()].some(
        (session) =>
          ["dirty", "saving", "conflict"].includes(session.snapshot().phase) ||
          (session.snapshot().phase === "error" &&
            session.snapshot().editRevision > 0),
      )
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const ready = command({ type: "snapshot" })
    .then(async () => {
      await constellation?.ready;
      await refreshEvents();
      await tail;
      document.body.dataset.applicationHydrated = "true";
    })
    .catch((e) => {
      hooks.status(
        `Application service unavailable: ${(e as Error).message}. Restart to recover; no data was reset.`,
      );
    });
  function blockPresentation(id: string): "workspace" | "focused" {
    return focusedBlocks.get(id)
      ? "focused"
      : (blockPresentations.get(id)?.presentation ?? "workspace");
  }
  function syncBlockActivity(id: string) {
    const block = state?.blocks.find((block) => block.id === id);
    const resource = block?.resource_id
      ? state?.resources.find((resource) => resource.id === block.resource_id)
      : undefined;
    const active =
      !unavailableBlocks.has(id) &&
      !(
        identityViews.get(id)?.minimizedPresentation().effectiveMinimized ??
        false
      ) &&
      resource?.available !== false &&
      resource?.visible !== false &&
      ((focusedBlocks.get(id) ?? false) ||
        (blockPresentations.get(id)?.usable ?? false));
    const previous = activeBlocks.get(id) ?? false;
    activeBlocks.set(id, active);
    if (active && previous !== active) {
      ensureNoteView(id);
      const block = state?.blocks.find((block) => block.id === id);
      if (
        block?.resource_id &&
        state?.resources.find(
          (resource) => resource.id === block.resource_id,
        ) &&
        [
          "conversation",
          "task_group",
          "stream",
          "checklist",
          "agent",
          "timeline",
          "task_objective",
          "file",
          "link",
        ].includes(resource?.kind ?? "")
      ) {
        const article = document.querySelector<HTMLElement>(
          `[data-block="${id}"]`,
        );
        if (article) decorate(article, id);
      }
    }
    const presentation = blockPresentation(id);
    chatViews.get(id)?.setPresentation(presentation);
    noteViews.get(id)?.setPresentation(presentation);
    subjectViews.get(id)?.setPresentation(presentation);
    eventViews.get(id)?.setPresentation(presentation);
    groupViews.get(id)?.setPresentation(presentation);
    checklistViews.get(id)?.view.setPresentation(presentation);
    agentBlockViews.get(id)?.view.setPresentation(presentation);
    timelineViews.get(id)?.view.setPresentation(presentation);
    taskTrackerViews.get(id)?.view.setPresentation(presentation);
    chatViews.get(id)?.setActive(active);
    noteViews.get(id)?.setActive(active);
    const media = mediaViews.get(id);
    media?.setActive(active);
    if (media && previous && !active) {
      // Keep recently used reading positions. Older offscreen readers release
      // their decoders and canvases while their canonical placements stay put.
      mediaViews.delete(id);
      mediaViews.set(id, media);
      const inactive = [...mediaViews].filter(([key]) => !activeBlocks.get(key));
      for (const [key, view] of inactive.slice(0, -3)) {
        view.dispose();
        mediaViews.delete(key);
      }
    }
    subjectViews.get(id)?.setActive(active);
    eventViews.get(id)?.setActive(active);
    groupViews.get(id)?.setActive(active);
    checklistViews.get(id)?.view.setActive(active);
    agentBlockViews.get(id)?.view.setActive(active);
    timelineViews.get(id)?.view.setActive(active);
    taskTrackerViews.get(id)?.view.setActive(active);
  }
  function frameBlockViews(
    entries: ReadonlyMap<string, { width?: number; view: { reflow(): void; frame(): void } }>,
  ) {
    for (const [id, entry] of entries) {
      if (!blockPresentations.get(id)?.visible) continue;
      if (activeBlocks.get(id)) {
        // The shared observer supplies the last measured content box without
        // forcing layout after the coordinator paints card geometry.
        const measured = hooks.workingBodyWidth(id);
        if (measured !== undefined) {
          const width = Math.round(measured);
          if (width !== entry.width) {
            entry.width = width;
            entry.view.reflow();
          }
        }
      }
      // Retained previews still need to finish their exit motion.
      entry.view.frame();
    }
  }
  return {
    ribbonThinking: velaExperience.ribbonThinking,
    frame(now: number, policy: Policy) {
      paintStreamRefresh();
      if (
        approachFocus &&
        (now > approachFocus.deadline ||
          !document.hasFocus() ||
          document.hidden ||
          state?.activeWorkspaceId !== approachFocus.workspaceId ||
          state.navigation.kind !== "workspace")
      )
        approachFocus = null;
      if (
        approachFocus &&
        hooks.motion.bodies.get(approachFocus.blockId)?.transitioning === false
      ) {
        const article = document.querySelector<HTMLElement>(
          `[data-block="${approachFocus.blockId}"]`,
        );
        if (article?.dataset.blockComposition === "working") {
          const control = [
            ...article.querySelectorAll<HTMLElement>(
              '.working-content textarea:not([disabled]), .working-content input:not([disabled]), .working-content [contenteditable="true"], .working-content button:not([disabled])',
            ),
          ].find(
            (control) =>
              !control.closest("[inert],[hidden]") &&
              control.getClientRects().length > 0,
          );
          control?.focus({ preventScroll: true });
          approachFocus = null;
        }
      }
      surfaces.frame(now);
      resourcesMotion?.frame();
      streamMotion?.frame();
      for (const picker of streamPickers) picker.frame();
      blockLibrary?.view.frame();
      environmentNavigator?.frame();
      workspaceActions?.frame();
      agentLibrary?.frame();
      conversationManager?.frame();
      // Retain editors and their drafts when their cards are outside the view.
      // The coordinator still advances their poses without repainting hidden DOM.
      for (const [id, view] of chatViews)
        if (blockPresentations.get(id)?.visible) view.frame();
      frameBlockViews(timelineViews);
      frameBlockViews(agentBlockViews);
      checklistCreator?.frame();
      taskCreator?.frame();
      frameBlockViews(taskTrackerViews);
      directResources.frame();
      frameBlockViews(checklistViews);
      controlMotion.frame();
      velaExperience.frame(policy);
      velaManifestation.frame(policy);
      paintPreview();
      const gridCamera = camera();
      workspaceGrid.update({
        visible:
          state?.navigation.kind === "workspace" &&
          (preview?.organization ?? state?.organization)?.mode === "structured",
        zoom: gridCamera.zoom,
        offset: gridCamera.offset,
      });
      workspaceGrid.frame(policy);
      if (
        policy.reduced ||
        policy.quiet ||
        policy.hidden ||
        !policy.graphicsAvailable
      )
        hooks.motion.snap(previewGuideId);
      const guideReveal = Math.max(
        0,
        Math.min(1, hooks.motion.pose(previewGuideId).opacity),
      );
      if (previewGuides.style.opacity !== String(guideReveal))
        previewGuides.style.opacity = String(guideReveal);
      if (
        !preview &&
        !previewRequest &&
        guideReveal === 0 &&
        previewGuides.childElementCount
      )
        previewGuides.replaceChildren();
      const target = presenceTarget();
      if (target) {
        const dragging = presenceDrag?.moved === true && !!preview;
        hooks.motion.target(
          presenceId,
          dragging ? { ...target, lift: 8 } : target,
          dragging ? "Vela placement preview" : "Vela workspace view",
        );
      }
      if (
        hooks.motion.bodies.has(presenceId) &&
        (policy.reduced || policy.quiet || policy.hidden)
      )
        hooks.motion.snap(presenceId);
      if (waitingForVela && (policy.reduced || policy.quiet || policy.hidden || !target))
        revealWorkspace();
      velaCard.classList.toggle("vela-card", !!presenceCard());
      const card = presenceCard();
      if (card) {
        const scale = Math.min(1, card.w / 208, card.h / 260);
        velaCard.style.setProperty("--vela-ui-scale", String(scale));
        velaCard.style.setProperty("--vela-ui-inset", `${28 * scale}px`);
      }
      const key = JSON.stringify(policy);
      if (key !== policyKey) {
        policyKey = key;
        constellation?.setPolicy(policy);
      }
      if (policy.reduced || policy.quiet || policy.hidden)
        hooks.motion.snap(arrivalId);
      const pose = hooks.motion.pose(arrivalId);
      el("#stage").style.visibility =
        state?.navigation.kind !== "constellation" ||
        (departingWorkspace && pose.opacity > 0.003)
          ? ""
          : "hidden";
      el("#stage").style.transform = `scale(${pose.x})`;
      el("#stage").style.opacity = String(pose.opacity);
      constellation?.frame(now);
    },
    ready,
    completeWorkspaceArrival: (unclipped: (pose: ReturnType<MotionCoordinator["pose"]>) => boolean) => {
      if (!waitingForVela) return;
      const target = presenceTarget();
      // A previously saved overlap must still be reachable after travel settles.
      if (!target || !hooks.motion.bodies.get(presenceId)?.transitioning ||
          (!velaCrossesWorkspace(target) && unclipped(hooks.motion.pose(presenceId))))
        revealWorkspace();
    },
    workspaceSurfacesVisible: () =>
      !waitingForVela &&
      (state?.navigation.kind !== "constellation" ||
        (departingWorkspace && hooks.motion.pose(arrivalId).opacity > 0.003)),
    surfaceView: () => ({
      scale: hooks.motion.pose(arrivalId).x,
      opacity: hooks.motion.pose(arrivalId).opacity,
      originX: arrivalOrigin.x,
      originY: arrivalOrigin.y,
    }),
    spatialLayer: () =>
      (
        constellation as
          | (ReturnType<typeof mountConstellation> & {
              layer?: SpatialRenderLayer;
            })
          | null
      )?.layer ?? null,
    spatialDiagnostics: () => ({
      location: constellation?.controller.location,
      selected: constellation?.controller.selected,
      anchors: constellation?.controller.state.anchors,
      camera: constellation?.controller.spatial?.camera,
      bookmark: constellation?.controller.spatial?.bookmark(),
      renderer: constellation?.layer.diagnostics,
      uiExclusions: constellation?.uiExclusions(),
      policy: constellation?.controller.policy,
    }),
    manifestationAfterRender: velaManifestation.afterRender,
    manifestationDiagnostics: velaManifestation.diagnostics,
    presenceCard,
    presence: () => {
      const p =
        state?.navigation.kind === "constellation" &&
        hooks.motion.bodies.has(presenceId)
          ? hooks.motion.pose(presenceId)
          : presenceCard();
      return p ? sculptureRegion(p) : undefined;
    },
    snapshot: () => state,
    openResource: (input: ResourceOpeningInput) => resourceOpener.open(input),
    openVela,
    offset: () => camera().offset,
    zoom: () => camera().zoom,
    previewBlock: (id: string) => {
      const b = preview?.blocks.find((b) => b.blockId === id);
      return b ? desktopPreviewBlock(b) : undefined;
    },
    previewMove(id: string, dx: number, dy: number) {
      const b = state?.blocks.find((b) => b.id === id);
      if (!b || b.locked) return;
      queuePreview({
        placements: [
          {
            blockId: id,
            expectedVersion: b.version,
            presentation: {
              x: Math.round(b.x + dx / zoom),
              y: Math.round(b.y + dy / zoom),
            },
          },
        ],
        intent: "move",
      });
    },
    cancelPreview,
    decorate,
    geometry,
    run,
    flush: async () => {
      if (agentLibrary?.hasUnsavedChanges())
        throw Error(
          "Save or discard the agent profile changes before closing.",
        );
      await flush();
      await constellation?.controller.persist();
      await flush();
    },
    manager,
    conversations,
    block: (id: string) => state?.blocks.find((b) => b.id === id),
    directGesture: (id: string) => directGestures.get(id) ?? null,
    directOutline: (id: string) => {
      if (!directGestures.has(id) || preview?.placementAreas.length !== 1)
        return null;
      const area = previewGuides.querySelector<HTMLElement>(".placement-area");
      const opacity =
        area && area.getClientRects().length
          ? Number(getComputedStyle(previewGuides).opacity) *
            Number(getComputedStyle(area).opacity) *
            Number(getComputedStyle(el("#stage")).opacity)
          : 0;
      return { ...preview.placementAreas[0], opacity };
    },
    workspaceGrid: () => workspaceGrid.diagnostics(),
    directDragging: () =>
      [...directGestures.values()].some((gesture) => gesture.intent === "move"),
    saveContent,
    blockMinimized: (id: string) =>
      identityViews.get(id)?.minimizedPresentation().effectiveMinimized ??
      false,
    setBlockMinimized: changeBlockMinimized,
    captureChatPresentation(id: string, expanded: boolean) {
      chatViews.get(id)?.setPresentation(expanded ? "focused" : "workspace", {
        captureOnly: true,
      });
    },
    setBlockActive(id: string, active: boolean) {
      if (focusedBlocks.get(id) === active) return;
      focusedBlocks.set(id, active);
      syncBlockActivity(id);
    },
    blockWorkingEligible(
      id: string,
      article: HTMLElement,
      projected: { w: number; h: number },
      target: { w: number; h: number },
    ) {
      const kind = identityModels.get(id)?.model.kind;
      if (
        !kind ||
        focusedBlocks.get(id) ||
        (article.contains(document.activeElement) &&
          document.activeElement?.closest(".working-content"))
      ) return true;
      return workspaceBodyEligible(
        kind,
        blockSettings.get(id)?.configuration.textScale ?? 1,
        projected,
        target,
        activeBlocks.get(id) ?? false,
      );
    },
    setBlockFootprint(id: string, measured: Omit<BlockFootprint, "textScale">) {
      if (!state?.blocks.some((block) => block.id === id)) return;
      const value = {
        ...measured,
        textScale: blockSettings.get(id)?.configuration.textScale ?? 1,
      };
      const prior = blockFootprints.get(id);
      const focused = focusedBlocks.get(id) ?? false;
      if (
        prior &&
        footprintFocus.get(id) === focused &&
        Object.keys(value).every(
          (key) =>
            prior[key as keyof BlockFootprint] ===
            value[key as keyof BlockFootprint],
        )
      )
        return;
      blockFootprints.set(id, value);
      footprintFocus.set(id, focused);
      identityViews.get(id)?.setFootprint(value);
    },
    setBlockPresentation(
      id: string,
      visible: boolean,
      usable: boolean,
      presentation: "workspace" | "focused" = "workspace",
    ) {
      const previous = blockPresentations.get(id);
      if (
        previous?.visible === visible &&
        previous.usable === usable &&
        previous.presentation === presentation
      )
        return;
      blockPresentations.set(id, { visible, usable, presentation });
      if (visible && !previous?.visible && streamBlockIds.includes(id))
        scheduleStreamRefresh();
      const article = document.querySelector<HTMLElement>(
        `[data-block="${id}"]`,
      );
      if (article) {
        article.dataset.workspacePresentation = usable ? "usable" : "preview";
        if (visible && !previous?.visible) refreshBlockIdentity(article, id);
      }
      subjectViews.get(id)?.setVisible(visible && !unavailableBlocks.has(id));
      syncBlockActivity(id);
    },
    move(id: string, dx: number, dy: number) {
      const b = state?.blocks.find((b) => b.id === id);
      if (b)
        return commitLayout({
          type: "geometry",
          blockId: b.id,
          expectedVersion: b.version,
          placement: {
            ...b,
            x: Math.round(b.x + dx / zoom),
            y: Math.round(b.y + dy / zoom),
          },
          shape: b.shape,
        });
    },
  };
}
