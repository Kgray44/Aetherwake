import type { ControllerOptions } from "../../../constellation/controller.ts";
import type {
  GraphActions,
  SpatialRenderLayer,
} from "../../../constellation/spatial-types.ts";
import { mountConstellation } from "../../../constellation/view.ts";
import "../../../constellation/style.css";
import type { Policy } from "../../../constellation/types.ts";
import type { MotionCoordinator } from "./motion";
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
import {
  mountDirectManipulation,
  mountWorkspaceLayoutControls,
} from "../../../block-library/direct-manipulation.ts";
import "../../../block-library/direct-manipulation.css";
import {
  sculptureRegion,
  overviewPresence,
  overviewChromeBottom,
} from "./presence-layout";
import {
  createManagerState,
  mountConversationManager,
} from "../../../conversation-product/src/ui.ts";
import {
  ConversationDraftSession,
  flushConversationDraftSessions,
} from "../../../conversation-product/src/draft-session.ts";
import type {
  ConversationProductPort,
  ProductCommandMap,
} from "../../../conversation-product/src/contracts.ts";
import "../../../conversation-product/src/style.css";
import { mountBlockChat } from "../../../block-library/chat-view.ts";
import { mountVelaPanel } from "../../../vela-core/src/panel.ts";
import "../../../vela-core/src/panel.css";
import { createVelaClient } from "./vela-client";
import { createVelaExperience } from "./vela-experience";
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
import { createNotesClient } from "./notes-client";
import { NoteSession } from "../../../block-library/note-session.ts";
import { mountNoteExperience } from "../../../block-library/note-view.ts";
import "../../../block-library/note-view.css";
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
import { REGISTERED_BLOCKS } from "../../../block-library/registry.ts";
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
} from "../../../application-contract/contracts.ts";
type Hooks = {
  motion: MotionCoordinator;
  wake(): void;
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
      top: 96,
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
  let velaOpen = false;
  let velaRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const velaContent = document.createElement("div");
  velaContent.className = "application-vela-content";
  const velaExperience = createVelaExperience({
    motion: hooks.motion,
    root: velaContent,
    wake: hooks.wake,
    resize: (size) => surfaces.resize("vela", size),
  });
  const velaClient = createVelaClient({
    command: (name, input) => host.command!(name, input),
    presentation: () =>
      state?.navigation.kind === "workspace" && state.activeWorkspaceId
        ? { workspaceId: state.activeWorkspaceId, bounds: viewBounds() }
        : null,
    changed: (name, result) =>
      enqueue(async () => {
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
      }),
    observed: (value) => {
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
  const libraryClient = createLibraryClient({
    command: (name, input) => host.command!(name, input),
    apply: (snapshot) => apply(snapshot),
  });
  const notesClient = createNotesClient({
    command: (name, input) => host.command!(name, input),
    apply: (snapshot) => apply(snapshot),
  });
  const noteSessions = new Map<string, NoteSession>();
  const noteViews = new Map<string, ReturnType<typeof mountNoteExperience>>();
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
  const identityModels = new Map<
    string,
    {
      key: string;
      content: string;
      projection?: SubjectIdentity;
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
  let state: DesktopSnapshot | null = null;
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
  const previewGuides = document.createElement("div");
  previewGuides.className = "layout-preview-guides";
  previewGuides.setAttribute("aria-hidden", "true");
  el("#stage").append(previewGuides);
  let tail = Promise.resolve();
  const drafts = new Map<
    string,
    { content: string; timer?: ReturnType<typeof setTimeout> }
  >();
  const composerSessions = new Map<string, ConversationDraftSession>();
  const chatViews = new Map<string, ReturnType<typeof mountBlockChat>>();
  const chatRefreshKeys = new Map<string, string>();
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
  type Activity = Partial<StreamEvent> & { type: string };
  const localEvents: StreamEvent[] = [];
  const eventViews = new Map<string, ReturnType<typeof mountEventExperience>>();
  let retainedEarliest: number | null = null,
    retainedLatest = 0,
    eventDisconnected = false;
  const seenEvents = new Set<string>();
  let lastTrigger: HTMLElement | null = null;
  const conversationView = createManagerState();
  let conversationManager: ReturnType<typeof mountConversationManager> | null =
    null;
  let conversationSurface: ContextualSurfaceRequest | null = null;
  let conversationDisposing: Promise<void> | null = null;
  let constellation: ReturnType<typeof mountConstellation> | null = null;
  let policyKey = "";
  const arrivalId = "application:arrival";
  let departingWorkspace = false;
  let arrivalOrigin = { x: innerWidth / 2, y: innerHeight / 2 };
  const arrivalPose = { x: 1, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
  hooks.motion.add(arrivalId, arrivalPose);
  const presenceId = "application:vela-presence";
  let presenceDrag: {
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
  el(".provenance").textContent = "LOCAL DATA · Codex connects only on request";
  el(".study-caption small").textContent = "Your resources. Your space.";
  el("#vela-state").textContent = "Idle · no background execution";
  el("#vela-dialog").setAttribute("aria-hidden", "true");
  el("#vela-expression")
    .closest("section")!
    .querySelector('label[for="vela-expression"]')!.textContent =
    "Visual expression preview (synthetic)";
  el("#demo").hidden = true;
  el("#stream .synthetic").textContent =
    "Observed application/provider activity · private reasoning unavailable";
  el("#status").textContent =
    "Open Workspaces to begin. Empty workspaces are ready for your ideas.";
  el(".place").innerHTML =
    '<button id="workspace-manager" title="Projects and workspaces (Ctrl+K)">Workspaces ↗</button>';
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
  function report(e: unknown) {
    hooks.status(
      `Action not saved: ${e instanceof Error ? e.message : "operation_failed"}. Your current data is retained.`,
    );
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
    const navigated =
      JSON.stringify(state?.navigation) !== JSON.stringify(next.navigation);
    if (navigated) {
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
    el("#stage").inert = overview;
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
    } else if (!overview) departingWorkspace = false;
    el("#stage").style.visibility =
      !overview || departingWorkspace ? "" : "hidden";
    const navigationSnapshot = {
      ...next,
      blocks: next.navigationBlocks ?? next.blocks,
    };
    if (!constellation) {
      const options: ControllerOptions & GraphActions = {
        snapshot: navigationSnapshot,
        motion: hooks.motion,
        navigate: async (target) => {
          await flush();
          await command({ type: "navigate", target });
        },
        openResource: async (target) => {
          const block = state?.blocks.find(
            (b) =>
              b.id === target.blockId &&
              b.resource_id === target.resourceId &&
              b.workspace_id === target.workspaceId,
          );
          const resource = state?.resources.find(
            (r) => r.id === target.resourceId,
          );
          if (!block || !resource || resource.available === false)
            throw new Error("resource_unavailable");
          hooks.focus(target.blockId);
        },
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
    for (;;) {
      await flushConversationDraftSessions(() => composerSessions.values());
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
  function run(a: DesktopCommand) {
    return enqueue(async () => {
      await flush();
      return command(a);
    });
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
      const guides = preview.guides.map(
        (g) =>
          `<i class="alignment-guide" style="left:${(g.axis === "x" ? g.position : g.from) * zoom + offset.x}px;top:${(g.axis === "y" ? g.position : g.from) * zoom + offset.y}px;width:${g.axis === "x" ? 1 : (g.to - g.from) * zoom}px;height:${g.axis === "y" ? 1 : (g.to - g.from) * zoom}px"></i>`,
      );
      const areas = preview.placementAreas.map(
        (a) =>
          `<i class="placement-area" style="left:${a.x * zoom + offset.x}px;top:${a.y * zoom + offset.y}px;width:${a.width * zoom}px;height:${a.height * zoom}px"></i>`,
      );
      previewGuides.innerHTML = [...guides, ...areas].join("");
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
    previewGuides.replaceChildren();
    delete document.body.dataset.layoutPreview;
    hooks.layout();
    hooks.wake();
  }
  function commitLayout(a: DesktopCommand) {
    paintPreview();
    const revision = previewBase?.revision;
    previewCommitting = true;
    return run({
      ...a,
      ...(revision === undefined ? {} : { expectedLayoutVersion: revision }),
    }).finally(() => {
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
    if (!p || !presenceCard() || p.locked || event.button !== 0) return;
    event.preventDefault();
    velaCard.focus();
    presenceDrag = {
      workspaceId: p.workspaceId,
      version: p.version,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...p },
      moved: false,
    };
    velaCard.setPointerCapture(event.pointerId);
  });
  velaCard.addEventListener("pointermove", (event) => {
    if (!presenceDrag) return;
    const d = presenceDrag,
      dx = event.clientX - d.startX,
      dy = event.clientY - d.startY;
    d.moved ||= Math.hypot(dx, dy) > 4;
    hooks.motion.target(
      presenceId,
      {
        x: d.origin.x * zoom + offset.x + dx,
        y: d.origin.y * zoom + offset.y + dy,
        w: d.origin.width * zoom,
        h: d.origin.height * zoom,
        lift: 8,
        yaw: 0,
        opacity: 1,
      },
      "Vela drag preview",
    );
    queuePreview({
      presence: {
        expectedVersion: d.version,
        presentation: {
          x: Math.round(d.origin.x + dx / zoom),
          y: Math.round(d.origin.y + dy / zoom),
        },
      },
      intent: "move",
    });
    hooks.wake();
  });
  velaCard.addEventListener("pointerup", (event) => {
    if (!presenceDrag) return;
    const d = presenceDrag;
    presenceDrag = null;
    document.body.classList.remove("vela-access");
    suppressPresenceClick = d.moved;
    if (d.moved)
      void commitLayout({
        type: "setPresence",
        workspaceId: d.workspaceId,
        expectedVersion: d.version,
        placement: {
          x: Math.round(d.origin.x + (event.clientX - d.startX) / zoom),
          y: Math.round(d.origin.y + (event.clientY - d.startY) / zoom),
        },
      });
    else {
      const target = presenceTarget();
      if (target)
        hooks.motion.target(presenceId, target, "Vela drag cancelled");
    }
  });
  velaCard.addEventListener("pointercancel", () => {
    presenceDrag = null;
    suppressPresenceClick = false;
    cancelPreview();
    const target = presenceTarget();
    if (target)
      hooks.motion.target(presenceId, target, "Vela pointer cancelled");
    hooks.wake();
  });
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
    void showConversations(resourceId).catch(report);
  }
  async function showConversations(resourceId?: string) {
    await conversationDisposing;
    dialog.close();
    cardConfiguration?.dispose();
    cardConfiguration = null;
    if (conversationManager && conversationSurface) {
      surfaces.open(conversationSurface).id = "conversation-surface";
      if (resourceId) await conversationManager.open(resourceId);
      else await conversationManager.refresh();
      return;
    }
    const content = document.createElement("div");
    content.id = "conversation-product";
    content.className = "application-conversation-content";
    let controller: ReturnType<typeof mountConversationManager> | undefined;
    const request: ContextualSurfaceRequest = {
      id: "conversations",
      anchor: el(".brand"),
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
              surfaces.open(request).id = "conversation-surface";
          })
          .finally(() => {
            if (conversationDisposing === disposal)
              conversationDisposing = null;
          });
        conversationDisposing = disposal;
      },
    };
    conversationSurface = request;
    const surface = surfaces.open(request);
    surface.id = "conversation-surface";
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
      execution: conversationExecution,
      draftSession: composerSession,
      state: conversationView,
      ...(resourceId ? { resourceId } : {}),
      onClose: () => surfaces.close("conversations"),
      onResource: (id, messageId) => {
        const resource = state?.resources.find((r) => r.id === id);
        if (resource?.kind === "conversation") {
          if (conversationView.selectedResourceId !== id)
            void controller?.open(id, messageId);
          else
            hooks.status(
              `${resource.title}${messageId ? " · canonical source message" : " · conversation history"}`,
            );
          return;
        }
        const placement = (state?.navigationBlocks ?? state?.blocks ?? []).find(
          (b) => b.resource_id === id,
        );
        if (!placement) {
          hooks.status(
            "This source has no workspace placement. It remains available in Resources.",
          );
          return;
        }
        surfaces.close("conversations");
        void enqueue(async () => {
          await flush();
          await command({
            type: "navigate",
            target: {
              kind: "workspace",
              workspaceId: placement.workspace_id,
            },
          });
          reveal(placement.id);
          hooks.focus(placement.id);
        });
      },
    });
    void controller.ready.catch(report);
  }
  function openVela() {
    if (velaOpen) {
      surfaces.close("vela", "close-button");
      return;
    }
    if (!velaPanel)
      velaPanel = mountVelaPanel(velaContent, velaClient, {
        onPresentation: (value) => velaExperience.observe(value),
        onConnectProvider: () => host.command!("capabilities", {}),
        onOpenSubject: (subject) => {
          surfaces.close("vela");
          if (subject.kind === "workspace") {
            void run({
              type: "navigate",
              target: { kind: "workspace", workspaceId: subject.id },
            });
          } else if (subject.kind === "project") {
            void run({
              type: "navigate",
              target: { kind: "constellation", projectId: subject.id },
            });
          } else if (
            state?.resources.find((r) => r.id === subject.id)?.kind ===
            "conversation"
          ) {
            conversations(subject.id);
          } else {
            const placement = (
              state?.navigationBlocks ??
              state?.blocks ??
              []
            ).find((b) => b.resource_id === subject.id);
            if (!placement) {
              hooks.status(
                "This resource is saved in Resources and has no workspace placement.",
              );
              return;
            }
            void enqueue(async () => {
              await flush();
              await command({
                type: "navigate",
                target: {
                  kind: "workspace",
                  workspaceId: placement.workspace_id,
                },
              });
              reveal(placement.id);
              hooks.focus(placement.id);
            });
          }
        },
      });
    velaOpen = true;
    const surface = surfaces.open({
      id: "vela",
      anchor: el("#vela"),
      content: velaContent,
      label: "Vela",
      placement: "left",
      minSize: { width: 280, height: 110 },
      maxSize: { width: 560, height: 640 },
      preferredSize: velaExperience.size(),
      initialFocus: ".vela-core-compose textarea",
      onClose: () => {
        velaOpen = false;
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
  function manager() {
    if (!state) return;
    open(
      "Your working environments",
      `<div class="command-grid"><section><h3>Projects</h3>${state.projects.map((p) => `<p>${escape(p.title)}</p>`).join("")}<button id="new-project">＋ Create project</button></section><section><h3>Workspaces</h3>${state.workspaces.map((w) => `<div class="workspace-row"><button data-workspace="${w.id}">${escape(w.title)}<small>${escape(state!.projects.find((p) => p.id === w.project_id)?.title ?? "Independent workspace")}</small></button><button data-rename="${w.id}" aria-label="Rename ${escape(w.title)}">✎</button><button data-archive="${w.id}" title="Archive workspace; retain resources and layout">Archive</button></div>`).join("") || "<p>No workspaces yet.</p>"}<button id="new-workspace">＋ Create workspace</button></section></div><button id="standalone-chat">New conversation without a project</button>${state.archivedWorkspaces?.length ? `<details><summary>Archived workspaces</summary>${state.archivedWorkspaces.map((w) => `<div class="workspace-row"><span>${escape(w.title)}</span><button data-restore-workspace="${w.id}">Restore</button></div>`).join("")}</details>` : ""}`,
    );
    el(".command-grid", dialog).insertAdjacentHTML(
      "beforebegin",
      '<button id="conversation-manager">Conversations and history</button>',
    );
    el("#conversation-manager", dialog).onclick = () => conversations();
    el("#new-project", dialog).onclick = () => {
      open(
        "Create project",
        '<form><label>Project name<input name="title" id="project-title" required maxlength="200" autofocus></label><button type="submit">Create project</button></form>',
      );
      form(async (f) => {
        await command({ type: "createProject", title: String(f.get("title")) });
      });
    };
    el("#new-workspace", dialog).onclick = () => {
      open(
        "Create workspace",
        `<form><label>Workspace name<input id="workspace-title" name="title" required maxlength="200"></label><label>Project<select name="projectId"><option value="">Independent</option>${state!.projects.map((p) => `<option value="${p.id}">${escape(p.title)}</option>`).join("")}</select></label><button type="submit">Create workspace</button></form>`,
      );
      form(async (f) => {
        await command({
          type: "createWorkspace",
          title: String(f.get("title")),
          projectId: String(f.get("projectId")) || null,
        });
      });
      dialog.insertAdjacentHTML(
        "beforeend",
        '<p>Start blank, reuse a saved template or preset, or ask Vela to help compose a workspace.</p><button id="workspace-templates">Browse templates and presets</button><button id="workspace-ask-vela">Ask Vela</button>',
      );
      el("#workspace-templates", dialog).onclick = () => {
        const projectId =
          el<HTMLSelectElement>('select[name="projectId"]', dialog).value ||
          null;
        dialog.close();
        templates(projectId);
      };
      el("#workspace-ask-vela", dialog).onclick = () => {
        const title = el<HTMLInputElement>(
          "#workspace-title",
          dialog,
        ).value.trim();
        const projectId =
          el<HTMLSelectElement>('select[name="projectId"]', dialog).value ||
          null;
        const project = state?.projects.find((p) => p.id === projectId);
        dialog.close();
        openVela();
        const composer = el<HTMLTextAreaElement>(
          ".vela-core-compose textarea",
          velaContent,
        );
        if (!composer.value.trim())
          composer.value = `Help me create ${title ? `a workspace named “${title}”` : "a workspace"}${project ? ` in project “${project.title}” (${project.id})` : ""} from available resources. Prepare a plan for my review.`;
        composer.focus();
      };
    };
    dialog.querySelectorAll<HTMLElement>("[data-workspace]").forEach(
      (b) =>
        (b.onclick = () => {
          dialog.close();
          void run({
            type: "navigate",
            target: { kind: "workspace", workspaceId: b.dataset.workspace! },
          });
        }),
    );
    dialog.querySelectorAll<HTMLElement>("[data-rename]").forEach(
      (b) =>
        (b.onclick = () => {
          const w = state!.workspaces.find((w) => w.id === b.dataset.rename)!;
          open(
            "Rename workspace",
            `<form><label>Name<input name="title" value="${escape(w.title)}" required maxlength="200"></label><button type="submit">Save name</button></form>`,
          );
          form(async (f) =>
            command({
              type: "renameWorkspace",
              workspaceId: w.id,
              expectedVersion: w.version,
              title: String(f.get("title")),
            }),
          );
        }),
    );
    for (const [selector, archived] of [
      ["[data-archive]", true],
      ["[data-restore-workspace]", false],
    ] as const)
      dialog.querySelectorAll<HTMLElement>(selector).forEach(
        (button) =>
          (button.onclick = () => {
            const workspaceId =
              button.dataset.archive ?? button.dataset.restoreWorkspace!;
            const workspace = [
              ...state!.workspaces,
              ...(state!.archivedWorkspaces ?? []),
            ].find((w) => w.id === workspaceId)!;
            void enqueue(async () => {
              await flush();
              await command({
                type: "archiveWorkspace",
                workspaceId,
                expectedVersion: workspace.version,
                archived,
              });
              manager();
            });
          }),
      );
    el("#standalone-chat", dialog).onclick = () => {
      open(
        "Start a conversation",
        '<p>No project or task is required. A local workspace holds the visual placement.</p><form><label>Title<input name="title" value="Conversation" required maxlength="200"></label><button type="submit">Open conversation</button></form>',
      );
      form(async (f) => {
        const w =
          state!.activeWorkspaceId ??
          (
            await command({
              type: "createWorkspace",
              title: "Personal",
              projectId: null,
            })
          ).activeWorkspaceId;
        await command({
          type: "createResource",
          kind: "conversation",
          title: String(f.get("title")),
          workspaceId: w,
          provider: "local",
        });
      });
    };
  }
  function add() {
    if (!state?.activeWorkspaceId) {
      manager();
      return;
    }
    const workspaceId = state.activeWorkspaceId;
    const content = document.createElement("div");
    content.className = "application-library-content";
    let controller: ReturnType<typeof mountBlockLibrary> | undefined;
    surfaces.open({
      id: "block-library",
      anchor: el(".aw-workspace-add"),
      content,
      label: "Add to workspace",
      minSize: { width: 480, height: 300 },
      maxSize: { width: 960, height: 740 },
      onClose: () => controller?.dispose(),
    });
    controller = mountBlockLibrary(content, libraryClient, {
      workspaceId,
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
        if (state?.activeWorkspaceId !== workspaceId)
          throw Error("workspace_changed");
        return state.layoutVersion;
      },
      onClose: () => surfaces.close("block-library"),
      onCreated: (result) => {
        surfaces.close("block-library");
        revealCreatedPlacement(result.placementId);
      },
      onSubjectCreated: (result) => {
        surfaces.close("block-library");
        revealCreatedPlacement(result.placementId);
      },
    });
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
  function picker() {
    if (!state) return;
    open(
      "Your canonical resources",
      '<label>Find a resource<input id="resource-search" type="search" placeholder="Search title or type"></label><div id="resource-results"></div><p>Attaching creates a placement of the same resource. Removing a block preserves its source.</p>',
    );
    const draw = () => {
      const q = el<HTMLInputElement>(
        "#resource-search",
        dialog,
      ).value.toLowerCase();
      el("#resource-results", dialog).innerHTML =
        state!.resources
          .filter((r) => r.visible !== false)
          .filter((r) => `${r.title} ${r.kind}`.toLowerCase().includes(q))
          .map(
            (r) =>
              `<button class="resource-result" data-attach="${r.id}">${escape(r.title)}<small>${r.kind} · ${r.id.slice(0, 8)}</small></button>`,
          )
          .join("") || "<p>No matching resources.</p>";
      dialog.querySelectorAll<HTMLElement>("[data-attach]").forEach(
        (b) =>
          (b.onclick = () => {
            if (!state!.activeWorkspaceId) {
              el("#command-error", dialog).textContent =
                "Create a workspace first.";
              return;
            }
            dialog.close();
            void run({
              type: "attach",
              workspaceId: state!.activeWorkspaceId,
              resourceId: b.dataset.attach!,
            });
          }),
      );
    };
    el("#resource-search", dialog).oninput = draw;
    draw();
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
      `<div class="layout-actions"><button id="focus-card">Open</button><button id="front-card">Bring to front</button><button id="detach-card">Remove from workspace</button></div><label><input type="checkbox" id="block-lock" ${block.locked ? "checked" : ""}> Lock placement</label><form><label>Presentation<select name="shape"><option value="rounded">Card</option><option value="lens">Lens</option><option value="circle">Circle</option><option value="pill">Pill</option></select></label><button type="submit">Save presentation</button></form>`,
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
    el("#detach-card", dialog).onclick = () => {
      dialog.close();
      void run({ type: "detach", blockId, expectedVersion: block.version });
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
  const modeDescriptions = {
    fluid: "Resources intelligently make room for one another.",
    freeform: "Position and overlap resources however you want.",
    structured: "Organize resources using grids and alignment.",
  } as const;
  function organizationControls() {
    if (!state?.organization || !state.activeWorkspaceId) return;
    const current = state.organization,
      workspaceId = state.activeWorkspaceId;
    open(
      "Workspace organization",
      `<form id="organization-form"><label>Organization<select id="organization-mode" name="mode">${(["fluid", "freeform", "structured"] as const).map((mode) => `<option value="${mode}" ${current.mode === mode ? "selected" : ""}>${mode[0].toUpperCase() + mode.slice(1)}</option>`).join("")}</select></label><p id="organization-description"></p><details id="structured-options"><summary>Grid and spacing</summary><div class="geometry-grid"><label>Minimum gap<input name="gap" type="number" min="0" max="256" value="${current.gap}"></label><label>Columns · blank for automatic<input name="columns" type="number" min="1" max="12" value="${current.structured.columnCount ?? ""}"></label><label>Row height<input name="rowHeight" type="number" min="32" max="512" value="${current.structured.rowHeight}"></label></div></details><p>Preview changes below. Apply records one undoable transformation. Saved checkpoints also retain the organization mode.</p><button type="submit">Apply organization</button><button id="cancel-organization" type="button">Cancel preview</button></form><details><summary>Structured arrangements</summary><div class="layout-actions">${(
        [
          ["balanced", "Balanced grid"],
          ["focus", "Focus and companions"],
          ["development", "Development"],
          ["research", "Research"],
        ] as const
      )
        .map(
          ([preset, title]) =>
            `<button type="button" data-grid-preset="${preset}">${title}</button>`,
        )
        .join("")}</div></details>`,
    );
    const read = (): OrganizationUpdate => {
      const data = new FormData(
        el<HTMLFormElement>("#organization-form", dialog),
      );
      return {
        mode: String(data.get("mode")) as OrganizationMode,
        gap: Number(data.get("gap")),
        structured: {
          columnCount: data.get("columns") ? Number(data.get("columns")) : null,
          rowHeight: Number(data.get("rowHeight")),
          rowGap: Number(data.get("rowGap")),
          columnGap: Number(data.get("columnGap")),
          margin: Number(data.get("margin")),
        },
      };
    };
    el("#structured-options .geometry-grid", dialog).insertAdjacentHTML(
      "beforeend",
      (["rowGap", "columnGap", "margin"] as const)
        .map(
          (name) =>
            `<label>${name === "rowGap" ? "Row spacing" : name === "columnGap" ? "Column spacing" : "Margin"}<input name="${name}" type="number" min="0" max="256" value="${current.structured[name]}"></label>`,
        )
        .join(""),
    );
    el<HTMLInputElement>(
      '[name="gap"]',
      dialog,
    ).parentElement!.firstChild!.textContent = "Fluid minimum gap";
    const update = () => {
      const organization = read();
      el("#organization-description", dialog).textContent =
        modeDescriptions[organization.mode!];
      queuePreview({ organization, intent: "mode" });
    };
    el<HTMLFormElement>("#organization-form", dialog).oninput = update;
    el<HTMLFormElement>("#organization-form", dialog).onchange = update;
    el("#organization-description", dialog).textContent =
      modeDescriptions[current.mode];
    el("#cancel-organization", dialog).onclick = () => dialog.close();
    form(async () =>
      commitLayout({
        type: "setOrganization",
        workspaceId,
        expectedOrganizationRevision: current.revision,
        organization: read(),
      }),
    );
    dialog.querySelectorAll<HTMLButtonElement>("[data-grid-preset]").forEach(
      (button) =>
        (button.onclick = () => {
          const preset = button.dataset.gridPreset as StructuredPreset;
          queuePreview({ structuredPreset: preset, intent: "mode" });
          void commitLayout({
            type: "applyStructuredPreset",
            workspaceId,
            preset,
          }).then(() => dialog.close());
        }),
    );
  }
  function layouts() {
    if (!state?.activeWorkspaceId) {
      manager();
      return;
    }
    open(
      "Workspace actions",
      `<div class="layout-actions"><button id="save-layout">Save layout checkpoint</button><button id="restore-layout" ${state.hasCheckpoint ? "" : "disabled"}>Restore checkpoint</button><button id="undo-layout" ${state.canUndo ? "" : "disabled"}>Undo layout</button><button id="redo-layout" ${state.canRedo ? "" : "disabled"}>Redo layout</button><button id="resolve-layout">Make room · undoable</button></div><p>Saved geometry remains unchanged until you edit or organize it. Checkpoints and history restore placements, shapes and geometry. Resource text remains independent.</p><button id="locate-vela">Locate Vela</button>${state.blocks.map((b) => `<div class="workspace-row"><button data-locate="${b.id}">${escape(state!.resources.find((r) => r.id === b.resource_id)?.title ?? "Resource")}</button></div>`).join("")}`,
    );
    dialog.insertAdjacentHTML(
      "afterbegin",
      `<div class="organization-summary"><button id="organization-settings">Organization · ${state.organization?.mode ?? "fluid"}</button><button id="bring-all">Bring All Into View</button></div>`,
    );
    el("#organization-settings", dialog).onclick = organizationControls;
    dialog.insertAdjacentHTML(
      "beforeend",
      '<div class="layout-actions"><button id="workspace-resources">Resources</button><button id="workspace-constellation">Constellation</button><button id="workspace-stream">Intelligence Stream</button><button id="workspace-connections">Connections</button></div>',
    );
    for (const [source, target] of [
      ["workspace-resources", "resource-picker"],
      ["workspace-constellation", "zoom-out"],
      ["workspace-stream", "stream-button"],
      ["workspace-connections", "connections"],
    ])
      el("#" + source, dialog).onclick = () => {
        dialog.close();
        el("#" + target).click();
      };
    dialog.insertAdjacentHTML(
      "beforeend",
      `<label><input id="presence-lock" type="checkbox" ${state.presence?.locked ? "checked" : ""}> Lock Vela placement</label>`,
    );
    el<HTMLInputElement>("#presence-lock", dialog).onchange = (event) => {
      const p = state?.presence;
      if (!p) return;
      const locked = (event.target as HTMLInputElement).checked;
      dialog.close();
      void run({
        type: "setPresence",
        workspaceId: p.workspaceId,
        expectedVersion: p.version,
        placement: { locked },
      });
    };
    el("#bring-all", dialog).onclick = () => {
      const workspaceId = state!.activeWorkspaceId!;
      queuePreview({ intent: "recover" });
      void commitLayout({ type: "bringAllIntoView", workspaceId }).then(() =>
        dialog.close(),
      );
    };
    for (const [id, type] of [
      ["save-layout", "checkpoint"],
      ["restore-layout", "restore"],
      ["undo-layout", "undo"],
      ["redo-layout", "redo"],
    ] as const)
      el("#" + id, dialog).onclick = () => {
        dialog.close();
        void run({ type });
      };
    el("#resolve-layout", dialog).onclick = () => {
      dialog.close();
      void run({
        type: "resolveLayout",
        workspaceId: state!.activeWorkspaceId!,
      });
    };
    el("#locate-vela", dialog).onclick = () => {
      dialog.close();
      const p = state?.presence;
      if (!p) return;
      hooks.home();
      zoom = 1;
      offset = {
        x: innerWidth / 2 - (p.x + p.width / 2) * zoom,
        y: innerHeight / 2 - (p.y + p.height / 2) * zoom,
      };
      presenceTarget();
      hooks.layout();
      hooks.wake();
      void saveView();
      document.body.classList.add("vela-access");
      velaCard.focus();
    };
    dialog
      .querySelectorAll<HTMLElement>("[data-properties]")
      .forEach((b) => (b.onclick = () => geometry(b.dataset.properties!)));
    dialog.querySelectorAll<HTMLElement>("[data-locate]").forEach(
      (b) =>
        (b.onclick = () => {
          dialog.close();
          reveal(b.dataset.locate!);
          hooks.focus(b.dataset.locate!);
        }),
    );
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
  function revealCreatedPlacement(id: string) {
    hooks.home();
    reveal(id);
    const article = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
    if (article) {
      article.tabIndex = -1;
      article.focus({ preventScroll: true });
    }
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
    const editor = article?.querySelector<HTMLTextAreaElement>("textarea");
    if (
      !article ||
      !editor ||
      !resource ||
      resource.available === false ||
      !["note", "research", "reference", "task", "task_group"].includes(
        resource.kind,
      )
    )
      return;
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
    const session = noteSession(resource.id),
      view = mountNoteExperience(documentRoot, editor, session, notesClient, {
        kind: resource.kind,
        active: true,
        presentation: blockPresentation(id),
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
  function openCanonicalResource(resourceId: string) {
    const resource = state?.resources.find((r) => r.id === resourceId);
    if (resource?.kind === "conversation") {
      conversations(resourceId);
      return;
    }
    const placement = (state?.navigationBlocks ?? state?.blocks ?? []).find(
      (b) => b.resource_id === resourceId,
    );
    if (placement) {
      void enqueue(async () => {
        await flush();
        await command({
          type: "navigate",
          target: { kind: "workspace", workspaceId: placement.workspace_id },
        });
        reveal(placement.id);
        hooks.focus(placement.id);
      });
      return;
    }
    if (
      !resource ||
      resource.available === false ||
      resource.kind === "stream"
    ) {
      hooks.status(
        "This canonical resource is unavailable here. Attach an available resource to inspect it in the workspace.",
      );
      return;
    }
    const content = document.createElement("div"),
      heading = document.createElement("h3"),
      editor = document.createElement("textarea"),
      saved = document.createElement("p");
    heading.textContent = resource.title;
    editor.value = resource.content;
    editor.maxLength = 100000;
    editor.rows = 12;
    editor.style.width = "100%";
    saved.className = "saved";
    content.append(heading, editor, saved);
    const session = noteSession(resourceId),
      view = mountNoteExperience(content, editor, session, notesClient, {
        kind: resource.kind,
      });
    editor.setAttribute("aria-label", resource.title + " content");
    editor.oninput = () => saveContent(resourceId, editor.value, content);
    surfaces.open({
      id: "canonical-resource",
      anchor: el(".aw-workspace-add"),
      content,
      label: resource.title,
      minSize: { width: 360, height: 300 },
      maxSize: { width: 720, height: 680 },
      onClose: () => view.dispose(),
    });
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
        copy: (value) => navigator.clipboard.writeText(value),
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
    ]);
    const cached = identityModels.get(id);
    const model =
      cached &&
      cached.key === key &&
      cached.content === content &&
      cached.projection === projection
        ? cached.model
        : blockIdentity({
            kind: knownKind,
            resource,
            content,
            subject: projection,
            events,
            disconnected: eventDisconnected,
          });
    identityModels.set(id, { key, content, projection, model });
    view.update(model);
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
            });
          },
          cancel: cancelPreview,
          failed: report,
          context: () => geometry(id),
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
      r.kind === "task_group" ? "TASK GROUP" : r.kind.toUpperCase();
    if (r.kind === "conversation") {
      const surface = el(".working-content", article);
      let view = chatViews.get(b.id);
      if (!view && activeBlocks.get(b.id)) {
        const session = composerSession(r.id);
        view = mountBlockChat(surface, {
          resourceId: r.id,
          port: composerPort,
          draftSession: session,
          execution: conversationExecution,
          active: true,
          presentation: blockPresentation(b.id),
          initialScroll: conversationView.scroll[r.id],
          initialOffset: conversationView.messageOffset[r.id],
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
    } else if (r.kind === "task_group") {
      const surface = el(".working-content", article);
      const members = r.taskMembers ?? [];
      let group = groupViews.get(id);
      if (!group) {
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
      group.update(members);
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
    } else if (r.kind === "stream") {
      const content = el(".working-content", article);
      if (!eventViews.has(id)) {
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
      } else eventViews.get(id)!.update();
      updateStreamSummaries();
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
  function updateStreamSummaries() {
    if (document.hidden || !document.hasFocus()) return;
    const events = filterRecordedEvents(eventWindow(), {
      scope: "all",
      classification: "",
      source: "",
      resourceId: "",
      executionId: "",
      query: "",
    });
    for (const block of state?.blocks ?? [])
      if (
        state!.resources.find((resource) => resource.id === block.resource_id)
          ?.kind === "stream"
      ) {
        const article = document.querySelector<HTMLElement>(
          `[data-block="${block.id}"]`,
        );
        if (article && blockPresentations.get(block.id)?.visible !== false) {
          el(".folio-preview", article).textContent =
            events
              .slice(0, 3)
              .map((event) => event.classification + " · " + event.type)
              .join(" · ") ||
            "No accessible captured events in this retained window.";
          refreshBlockIdentity(article, block.id);
        }
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
      return;
    if (seenEvents.has(e.eventId)) return;
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
    fillEvents(el("#events"));
    updateStreamSummaries();
    for (const view of eventViews.values()) view.update();
  }
  function fillEvents(list: HTMLElement) {
    if (document.hidden || list.closest("[hidden]")) return;
    list.replaceChildren();
    for (const e of localEvents.slice(-100).reverse()) {
      const li = document.createElement("li");
      if (e.eventId) li.dataset.eventId = e.eventId;
      li.textContent = `${e.classification} · ${e.providerId ?? "application host"} · ${e.type} · cursor ${e.cursor ?? "unavailable"} · ${e.receivedAt ?? "time unavailable"}`;
      list.append(li);
    }
  }
  el("#stream-button").addEventListener("click", () =>
    fillEvents(el("#events")),
  );
  host.onEvent?.((event) => {
    refreshVelaFromEvent();
    const e = event as Activity & {
      resourceId?: string;
      payload?: { delta?: string };
    };
    // Assistant text is handled by the one shared execution adapter. It is not
    // copied into a second transcript, activity payload cache or frame path.
    if (e.payload?.delta && e.resourceId) return;
    rememberEvent(e);
    fillEvents(el("#events"));
    el("#event-count").textContent = String(localEvents.length);
    updateStreamSummaries();
    for (const view of eventViews.values()) view.update();
    if (e.type === "storage/reserve-admission-denied")
      hooks.status(
        "Storage reserve reached. Saving and new execution are stopped; data is retained. External applications are outside this guard.",
      );
    if (e.type === "backend/disconnected") {
      eventDisconnected = true;
      updateStreamSummaries();
      for (const view of eventViews.values()) view.update();
      hooks.status(
        "Backend disconnected. Current surfaces are retained; restart to recover persisted data. Execution outcomes may be unknown.",
      );
      hooks.vela("unavailable");
    }
  });
  el("#workspace-manager").onclick = manager;
  el("#add-block").onclick = add;
  el("#resource-picker").onclick = picker;
  el("#layout-manager").onclick = layouts;
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
  el("#connections").onclick = () => {
    open(
      "Connections",
      '<p>Local notes, workspaces and conversations work offline.</p><p>Ordinary model inference and ChatGPT account history are unavailable. No subscription access is assumed.</p><button id="connect-codex">Check local Codex connection</button><p id="connection-result" role="status">Codex has not been probed. No turn starts during connection checks.</p>',
    );
    el("#connect-codex", dialog).onclick = () => {
      el("#connection-result", dialog).textContent =
        "Checking installed provider…";
      void host.command!("capabilities", {}).then(
        (result) => {
          const c = result as { authentication: string; models: string[] };
          el("#connection-result", dialog).textContent =
            `Codex authentication: ${c.authentication}. ${c.models.length} catalog entries (entitlement unverified). Approval requests are denied in this read-only review build.`;
        },
        (e) =>
          (el("#connection-result", dialog).textContent =
            `Codex unavailable: ${(e as Error).message}. Local work remains usable.`),
      );
    };
  };
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
        ["conversation", "task_group", "stream"].includes(resource?.kind ?? "")
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
    chatViews.get(id)?.setActive(active);
    noteViews.get(id)?.setActive(active);
    subjectViews.get(id)?.setActive(active);
    eventViews.get(id)?.setActive(active);
    groupViews.get(id)?.setActive(active);
  }
  return {
    frame(now: number, policy: Policy) {
      surfaces.frame(now);
      velaExperience.frame(policy);
      paintPreview();
      const target = presenceTarget();
      if (target && !presenceDrag)
        hooks.motion.target(presenceId, target, "Vela workspace view");
      if (
        hooks.motion.bodies.has(presenceId) &&
        (policy.reduced || policy.quiet || policy.hidden)
      )
        hooks.motion.snap(presenceId);
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
    workspaceSurfacesVisible: () =>
      state?.navigation.kind !== "constellation" ||
      (departingWorkspace && hooks.motion.pose(arrivalId).opacity > 0.003),
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
      policy: constellation?.controller.policy,
    }),
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
      await flush();
      await constellation?.controller.persist();
      await flush();
    },
    manager,
    conversations,
    block: (id: string) => state?.blocks.find((b) => b.id === id),
    saveContent,
    setBlockActive(id: string, active: boolean) {
      focusedBlocks.set(id, active);
      syncBlockActivity(id);
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
