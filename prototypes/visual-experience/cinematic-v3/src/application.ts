import { mountConstellation } from "../../../constellation/view.ts";
import "../../../constellation/style.css";
import type { Policy } from "../../../constellation/types.ts";
import type { MotionCoordinator } from "./motion";
import "./application.css";
import type {
  Block,
  BlockKind,
  DesktopCommand,
  DesktopSnapshot,
  Geometry,
  Resource,
  Shape,
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
  let state: DesktopSnapshot | null = null;
  let offset = { x: 0, y: 0 };
  let tail = Promise.resolve();
  const drafts = new Map<
    string,
    { content: string; timer?: ReturnType<typeof setTimeout> }
  >();
  const streaming = new Map<string, string>();
  const busy = new Set<string>();
  type Activity = {
    eventId?: string;
    cursor?: number;
    providerId?: string;
    type: string;
    classification: string;
    receivedAt: string;
  };
  const localEvents: Activity[] = [];
  const seenEvents = new Set<string>();
  let lastTrigger: HTMLElement | null = null;
  let constellation: ReturnType<typeof mountConstellation> | null = null;
  let policyKey = "";
  const arrivalId = "application:arrival";
  const arrivalPose = { x: 1, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
  hooks.motion.add(arrivalId, arrivalPose);
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
  document.body.append(universe);
  el(".brand small").textContent = "LIQUID INTELLIGENCE / WORKING REVIEW";
  el(".provenance").textContent = "LOCAL DATA · Codex connects only on request";
  el(".study-caption small").textContent = "Your resources. Your space.";
  el("#vela-state").textContent = "Idle · no background execution";
  el("#vela-dialog p").textContent =
    "Vela’s AI coordination is unavailable in this review. Use the workspace commands to organize locally; Codex conversations have their own explicit Send action.";
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
  const canvasTools = document.createElement("nav");
  canvasTools.className = "canvas-tools";
  canvasTools.setAttribute("aria-label", "Canvas navigation");
  canvasTools.innerHTML =
    '<button data-pan="left" aria-label="Pan left">←</button><button data-pan="up" aria-label="Pan up">↑</button><button data-pan="home" aria-label="Reset canvas view">⌑</button><button data-pan="down" aria-label="Pan down">↓</button><button data-pan="right" aria-label="Pan right">→</button>';
  document.body.append(canvasTools);
  canvasTools.addEventListener("click", (event) => {
    const direction = (event.target as HTMLElement).dataset.pan;
    if (!direction) return;
    if (direction === "home") offset = { x: 0, y: 0 };
    else {
      offset.x += direction === "left" ? 350 : direction === "right" ? -350 : 0;
      offset.y += direction === "up" ? 280 : direction === "down" ? -280 : 0;
    }
    hooks.layout();
  });
  function report(e: unknown) {
    hooks.status(
      `Action not saved: ${e instanceof Error ? e.message : "operation_failed"}. Your current data is retained.`,
    );
  }
  async function command(a: DesktopCommand): Promise<DesktopSnapshot> {
    const next = (await host.command!("desktop", a)) as DesktopSnapshot;
    apply(next);
    return next;
  }
  function enqueue(action: () => Promise<unknown>) {
    tail = tail.then(action).then(() => {}, report);
    return tail;
  }
  function apply(next: DesktopSnapshot) {
    const changed = state?.activeWorkspaceId !== next.activeWorkspaceId;
    state = next;
    if (changed) {
      offset = { x: 0, y: 0 };
      hooks.home();
    }
    hooks.replace(next);
    el("#workspace-manager").textContent =
      `${next.workspaces.find((w) => w.id === next.activeWorkspaceId)?.title ?? "Workspaces"} ↗`;
    el<HTMLButtonElement>("#undo").disabled = !next.canUndo;
    el("#undo span").textContent = "Undo layout";
    universe.hidden = false;
    const overview = next.navigation.kind === "constellation";
    universe.classList.toggle("overview", overview);
    el("#stage").inert = overview;
    el("#stage").style.visibility = overview ? "hidden" : "";
    const navigationSnapshot = {
      ...next,
      blocks: next.navigationBlocks ?? next.blocks,
    };
    if (!constellation) {
      constellation = mountConstellation(universe, {
        snapshot: navigationSnapshot,
        motion: hooks.motion,
        navigate: async (target) => {
          await flush();
          await command({ type: "navigate", target });
        },
        openResource: async (target) => {
          hooks.focus(target.blockId);
        },
        persistence: {
          load: () => host.command!("viewState", {}),
          save: async (state) => {
            await host.command!("viewState", { state });
          },
        },
        onDirty: hooks.wake,
        onTransition: (transition) => {
          if (
            transition.to.kind !== "workspace" ||
            ["workspace", "surface"].includes(transition.from.kind)
          )
            return;
          const bounds = (
              universe.querySelector(".aw-spatial-field") ?? universe
            ).getBoundingClientRect(),
            c = transition.camera;
          el("#stage").style.transformOrigin =
            `${bounds.left + bounds.width / 2 + (transition.origin.x - c.x) * c.zoom}px ${bounds.top + bounds.height / 2 + (transition.origin.y - c.y) * c.zoom}px`;
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
      });
      void constellation.ready.then(hooks.wake);
    } else constellation.update(navigationSnapshot);
    for (const block of next.blocks)
      decorate(el(`[data-block="${block.id}"]`), block.id);
    hooks.layout();
    document.body.classList.add("application-ready");
  }
  async function flush() {
    for (const [resourceId, draft] of [...drafts]) {
      clearTimeout(draft.timer);
      const r = state?.resources.find((r) => r.id === resourceId);
      if (!r) continue;
      await command({
        type: "content",
        resourceId,
        content: draft.content,
        expectedVersion: r.version,
      });
      if (drafts.get(resourceId) === draft) drafts.delete(resourceId);
    }
  }
  function run(a: DesktopCommand) {
    return enqueue(async () => {
      await flush();
      return command(a);
    });
  }
  function open(title: string, body: string) {
    lastTrigger = document.activeElement as HTMLElement;
    dialog.innerHTML = `<div class="command-heading"><h2>${title}</h2><button data-close aria-label="Close panel">×</button></div>${body}<p id="command-error" role="status"></p>`;
    el("[data-close]", dialog).onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    el<HTMLInputElement>("input,select,button", dialog)?.focus();
  }
  dialog.addEventListener(
    "close",
    () => lastTrigger?.isConnected && lastTrigger.focus(),
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
      `<div class="command-grid"><section><h3>Projects</h3>${state.projects.map((p) => `<p>${escape(p.title)}</p>`).join("")}<button id="new-project">＋ Create project</button></section><section><h3>Workspaces</h3>${state.workspaces.map((w) => `<div class="workspace-row"><button data-workspace="${w.id}">${escape(w.title)}<small>${escape(state!.projects.find((p) => p.id === w.project_id)?.title ?? "Independent workspace")}</small></button><button data-rename="${w.id}" aria-label="Rename ${escape(w.title)}">✎</button></div>`).join("") || "<p>No workspaces yet.</p>"}<button id="new-workspace">＋ Create workspace</button></section></div><button id="standalone-chat">New conversation without a project</button>`,
    );
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
    open(
      "Give an idea a place",
      '<form><label>Block type<select id="block-kind" name="kind"><option value="conversation">Conversation</option><option value="note">Note</option><option value="research">Research / document</option><option value="task">Task</option><option value="reference">Resource reference</option><option value="stream">Intelligence Stream</option></select></label><label>Title<input name="title" id="block-title" value="Untitled" required maxlength="200"></label><label>Conversation provider<select name="provider"><option value="local">Local conversation · no model response</option><option value="codex">Codex App Server · explicit authorization on Send</option></select></label><p>Notes, documents, tasks and references work locally. Task automation and file execution are unavailable.</p><button type="submit">Add block</button></form>',
    );
    form(async (f) => {
      const next = await command({
        type: "createResource",
        kind: String(f.get("kind")) as BlockKind,
        title: String(f.get("title")),
        provider: String(f.get("provider")) as "local" | "codex",
        workspaceId: state!.activeWorkspaceId,
      });
      const b = next.blocks.at(-1);
      if (b) reveal(b.id);
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
  function geometry(blockId: string) {
    const b = state!.blocks.find((b) => b.id === blockId);
    if (!b) return;
    open(
      "Shape and place",
      `<form><div class="geometry-grid">${(["x", "y", "width", "height", "z"] as const).map((k) => `<label>${k === "z" ? "Layer" : k}<input type="number" name="${k}" value="${b[k]}" required step="1"></label>`).join("")}<label>Shape<select name="shape">${["rectangle", "rounded", "circle"].map((s) => `<option ${s === b.shape ? "selected" : ""}>${s}</option>`).join("")}</select></label></div><p>Circle is a compact presentation. Opening always provides a rectangular reading surface.</p><button type="submit">Apply layout</button></form>`,
    );
    form(async (f) => {
      const placement = Object.fromEntries(
        ["x", "y", "width", "height", "z"].map((k) => [k, Number(f.get(k))]),
      ) as Geometry;
      if (f.get("shape") === "circle") placement.height = placement.width;
      await command({
        type: "geometry",
        blockId,
        expectedVersion: b.version,
        placement,
        shape: String(f.get("shape")) as Shape,
      });
    });
  }
  function layouts() {
    if (!state?.activeWorkspaceId) {
      manager();
      return;
    }
    open(
      "Layouts and blocks",
      `<div class="layout-actions"><button id="save-layout">Save layout checkpoint</button><button id="restore-layout" ${state.hasCheckpoint ? "" : "disabled"}>Restore checkpoint</button><button id="undo-layout" ${state.canUndo ? "" : "disabled"}>Undo layout</button></div><p>Checkpoints and undo restore placements, shapes and geometry. Resource text remains independent.</p>${state.blocks.map((b) => `<div class="workspace-row"><button data-locate="${b.id}">${escape(state!.resources.find((r) => r.id === b.resource_id)?.title ?? "Resource")}</button><button data-properties="${b.id}">Properties</button></div>`).join("")}`,
    );
    for (const [id, type] of [
      ["save-layout", "checkpoint"],
      ["restore-layout", "restore"],
      ["undo-layout", "undo"],
    ] as const)
      el("#" + id, dialog).onclick = () => {
        dialog.close();
        void run({ type });
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
    if (b.x + offset.x < 20 || b.x + b.width + offset.x > innerWidth - 20)
      offset.x = Math.min(0, innerWidth / 2 - b.x - b.width / 2);
    if (b.y + offset.y < 180 || b.y + b.height + offset.y > innerHeight - 170)
      offset.y = Math.min(0, innerHeight / 2 - b.y - b.height / 2);
    hooks.layout();
  }
  function decorate(article: HTMLElement, id: string) {
    if (!article) return;
    const b = state?.blocks.find((b) => b.id === id);
    if (!b) return;
    const r = state!.resources.find((r) => r.id === b.resource_id)!;
    if (!article.querySelector(".block-properties")) {
      const controls = document.createElement("div");
      controls.className = "block-tools";
      controls.innerHTML =
        '<button class="block-properties" title="Move, resize, shape and layer">⋯</button><button class="block-remove" title="Remove visual block, preserve resource">×</button><button class="resize-handle" aria-label="Resize block; use Properties for keyboard resizing">↘</button>';
      article.append(controls);
      el(".block-properties", controls).onclick = () => geometry(id);
      el(".block-remove", controls).onclick = () => {
        const current = state!.blocks.find((b) => b.id === id)!;
        void run({
          type: "detach",
          blockId: id,
          expectedVersion: current.version,
        });
      };
      let resizing: {
        width: number;
        height: number;
        x: number;
        y: number;
      } | null = null;
      const handle = el(".resize-handle", controls);
      handle.onpointerdown = (event) => {
        const current = state!.blocks.find((b) => b.id === id)!;
        resizing = {
          width: current.width,
          height: current.height,
          x: event.clientX,
          y: event.clientY,
        };
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointerup = (event) => {
        if (!resizing) return;
        const current = state!.blocks.find((b) => b.id === id)!;
        const width = Math.round(
            Math.max(
              240,
              Math.min(2400, resizing.width + event.clientX - resizing.x),
            ),
          ),
          height =
            current.shape === "circle"
              ? width
              : Math.round(
                  Math.max(
                    160,
                    Math.min(
                      1800,
                      resizing.height + event.clientY - resizing.y,
                    ),
                  ),
                );
        resizing = null;
        void run({
          type: "geometry",
          blockId: id,
          expectedVersion: current.version,
          placement: { ...current, width, height },
          shape: current.shape,
        });
      };
      handle.onpointercancel = () => {
        resizing = null;
      };
    }
    article.dataset.shape = b.shape;
    el(".grip span", article).textContent = r.kind.toUpperCase();
    if (r.kind === "conversation") {
      const surface = el(".working-content", article);
      if (!surface.querySelector(".conversation-compose")) {
        surface.innerHTML =
          '<p class="provider-label"></p><div class="conversation-transcript" role="log" aria-label="Conversation messages"></div><form class="conversation-compose"><label>Message<textarea rows="2" maxlength="16000" required aria-label="Conversation message"></textarea></label><div><button type="submit">Send</button><button type="button" class="cancel-turn">Cancel turn</button></div><p class="execution-state" role="status"></p></form>';
        el<HTMLFormElement>("form", surface).onsubmit = (event) => {
          event.preventDefault();
          const input = el<HTMLTextAreaElement>("textarea", surface);
          const current = state!.resources.find((r) => r.id === b.resource_id)!;
          if (busy.has(current.id)) return;
          const content = input.value;
          busy.add(current.id);
          hooks.vela("working");
          el(".execution-state", surface).textContent =
            current.provider === "codex"
              ? "Awaiting native authorization / provider response…"
              : "Saving local message…";
          void host.command!("send", {
            resourceId: current.id,
            content,
            expectedVersion: current.version,
          })
            .then(
              async (result) => {
                const execution = result as { state?: string };
                el(".execution-state", surface).textContent = execution.state
                  ? `${execution.state} · task verification is separate`
                  : "Saved locally. Model response unavailable.";
                if (
                  !execution.state ||
                  execution.state === "provider_completed"
                )
                  input.value = "";
                streaming.delete(current.id);
                await command({ type: "snapshot" });
                hooks.vela(
                  execution.state === "failed" || execution.state === "unknown"
                    ? "attention"
                    : "idle",
                );
              },
              (e) => {
                el(".execution-state", surface).textContent = (
                  e as Error
                ).message;
                hooks.vela("attention");
              },
            )
            .finally(() => busy.delete(current.id));
        };
        el(".cancel-turn", surface).onclick = () => {
          void host.command!("executionStatus", {})
            .then(async (result) => {
              const execution = (
                result as { id: string; resourceId: string; state: string }[]
              ).find(
                (e) =>
                  e.resourceId === r.id &&
                  ["dispatching", "running"].includes(e.state),
              );
              if (!execution) {
                el(".execution-state", surface).textContent =
                  "No interruptible turn observed.";
                return;
              }
              await host.command!("interrupt", { executionId: execution.id });
              el(".execution-state", surface).textContent =
                "Cancellation requested; waiting for provider confirmation.";
            })
            .catch(report);
        };
      }
      el(".provider-label", surface).textContent =
        r.provider === "codex"
          ? "Codex · native instructions/configuration · read-only review policy · authorization on Send"
          : "Local conversation · durable messages · model response and ChatGPT account history unavailable";
      const log = el(".conversation-transcript", surface);
      log.replaceChildren();
      for (const m of r.messages) {
        const message = document.createElement("p");
        const role = document.createElement("b");
        role.textContent = `${m.role} · `;
        message.append(role, document.createTextNode(m.content));
        log.append(message);
      }
      if (streaming.has(r.id)) {
        const p = document.createElement("p");
        p.textContent = `Codex (streaming): ${streaming.get(r.id)}`;
        log.append(p);
      }
    } else if (r.kind === "stream") {
      const content = el(".working-content", article);
      content.innerHTML =
        '<p>Observed events, reported output and inferred states remain distinct. Retention is bounded; raw reasoning is unavailable.</p><ol class="inline-events"></ol>';
      fillEvents(el(".inline-events", content));
    } else {
      el(".synthetic", article).textContent =
        r.kind === "task"
          ? "LOCAL TASK · AUTOMATED EXECUTION UNAVAILABLE"
          : r.kind === "reference"
            ? "LOCAL REFERENCE · NO FILE ACCESS OR NETWORK REQUESTS"
            : "DURABLE LOCAL RESOURCE";
      const editor = article.querySelector<HTMLTextAreaElement>("textarea");
      if (editor) editor.setAttribute("aria-label", `${r.title} content`);
      if (editor && document.activeElement !== editor)
        editor.value = drafts.get(r.id)?.content ?? r.content;
      if (r.kind === "task") {
        if (!article.querySelector(".task-completed")) {
          const label = document.createElement("label");
          label.className = "local-task-state";
          label.innerHTML =
            '<input class="task-completed" type="checkbox"> Completed locally';
          el(".working-content", article).prepend(label);
          el<HTMLInputElement>(".task-completed", article).onchange = (
            event,
          ) => {
            const current = state!.resources.find(
              (resource) => resource.id === r.id,
            )!;
            void run({
              type: "taskStatus",
              resourceId: r.id,
              expectedVersion: current.version,
              status: (event.target as HTMLInputElement).checked
                ? "done"
                : "open",
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
  function rememberEvent(e: Activity) {
    if (e.eventId && seenEvents.has(e.eventId)) return;
    if (e.eventId) seenEvents.add(e.eventId);
    localEvents.push(e);
    localEvents.sort(
      (a, b) =>
        (a.cursor ?? Number.MAX_SAFE_INTEGER) -
        (b.cursor ?? Number.MAX_SAFE_INTEGER),
    );
    if (localEvents.length > 250) {
      const expired = localEvents.shift();
      if (expired?.eventId) seenEvents.delete(expired.eventId);
    }
  }
  function fillEvents(list: HTMLElement) {
    list.replaceChildren();
    for (const e of localEvents.slice(-100).reverse()) {
      const li = document.createElement("li");
      if (e.eventId) li.dataset.eventId = e.eventId;
      li.textContent = `${e.classification} · ${e.providerId ?? "application host"} · ${e.type} · cursor ${e.cursor ?? "unavailable"} · ${e.receivedAt ?? "time unavailable"}`;
      list.append(li);
    }
  }
  host.onEvent?.((event) => {
    const e = event as Activity & {
      resourceId?: string;
      payload?: { delta?: string };
    };
    if (e.payload?.delta && e.resourceId) {
      streaming.set(
        e.resourceId,
        (streaming.get(e.resourceId) ?? "") + e.payload.delta,
      );
      for (const b of state?.blocks.filter(
        (b) => b.resource_id === e.resourceId,
      ) ?? [])
        decorate(el(`[data-block="${b.id}"]`), b.id);
      return;
    }
    rememberEvent(e);
    fillEvents(el("#events"));
    el("#event-count").textContent = String(localEvents.length);
    for (const b of state?.blocks.filter(
      (b) =>
        state!.resources.find((r) => r.id === b.resource_id)?.kind === "stream",
    ) ?? [])
      decorate(el(`[data-block="${b.id}"]`), b.id);
    if (e.type === "storage/reserve-admission-denied")
      hooks.status(
        "Storage reserve reached. Saving and new execution are stopped; data is retained. External applications are outside this guard.",
      );
    if (e.type === "backend/disconnected") {
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
    if (drafts.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const ready = command({ type: "snapshot" })
    .then(async () => {
      const replay = (await host.command!("replay", {})) as {
        events: typeof localEvents;
        truncated: boolean;
      };
      for (const e of replay.events) rememberEvent(e);
      if (replay.truncated)
        hooks.status(
          "Event history is partial: this view shows the latest 250 retained records.",
        );
      fillEvents(el("#events"));
    })
    .catch((e) => {
      hooks.status(
        `Application service unavailable: ${(e as Error).message}. Restart to recover; no data was reset.`,
      );
    });
  return {
    frame(now: number, policy: Policy) {
      const key = JSON.stringify(policy);
      if (key !== policyKey) {
        policyKey = key;
        constellation?.setPolicy(policy);
      }
      if (policy.reduced || policy.quiet || policy.hidden)
        hooks.motion.snap(arrivalId);
      const pose = hooks.motion.pose(arrivalId);
      el("#stage").style.transform = `scale(${pose.x})`;
      el("#stage").style.opacity = String(pose.opacity);
      constellation?.frame(now);
    },
    ready,
    snapshot: () => state,
    offset: () => offset,
    decorate,
    geometry,
    run,
    flush,
    manager,
    block: (id: string) => state?.blocks.find((b) => b.id === id),
    saveContent(resourceId: string, content: string, article: HTMLElement) {
      const previous = drafts.get(resourceId);
      clearTimeout(previous?.timer);
      const draft: { content: string; timer?: ReturnType<typeof setTimeout> } =
        { content };
      drafts.set(resourceId, draft);
      el(".saved", article).textContent = "Saving…";
      draft.timer = setTimeout(() => {
        void enqueue(async () => {
          await flush();
          el(".saved", article).textContent = "Saved in local SQLite";
        });
      }, 350);
    },
    move(id: string, dx: number, dy: number) {
      const b = state?.blocks.find((b) => b.id === id);
      if (b)
        return run({
          type: "geometry",
          blockId: b.id,
          expectedVersion: b.version,
          placement: { ...b, x: b.x + dx, y: b.y + dy },
          shape: b.shape,
        });
    },
  };
}
