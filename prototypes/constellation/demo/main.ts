import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { mountConstellation } from "../view.ts";
import type { Snapshot } from "../types.ts";
import "../style.css";
import "./style.css";

type Fixture = Omit<Snapshot, "resources" | "blocks"> & {
  resources: {
    id: string;
    title: string;
    kind: string;
    content: string;
    version: number;
  }[];
  blocks: (Snapshot["blocks"][number] & { shape: string; version: number })[];
};
const api = async (type: string, payload: unknown = {}) => {
  const response = await fetch("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Constellation-Demo": "1",
    },
    body: JSON.stringify({ type, payload }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "Fixture service unavailable");
  return data;
};
let snapshot: Fixture = await api("snapshot");
const motion = new MotionCoordinator(),
  workspace = document.querySelector<HTMLElement>("#workspace")!;
let frameId = 0,
  previous = performance.now();
function wake() {
  if (!frameId) frameId = requestAnimationFrame(tick);
}
function tick(now: number) {
  frameId = 0;
  const moving = motion.step((now - previous) / 1000);
  previous = now;
  view.frame(now);
  if (moving) wake();
}
const view = mountConstellation(document.querySelector("#navigation")!, {
  snapshot,
  motion,
  onDirty: () => wake(),
  navigate: async (target) => {
    snapshot = await api("navigate", target);
    view.update(snapshot);
  },
  persistence: { load: () => api("load"), save: (state) => api("save", state) },
  openResource: async (target) => {
    const editor = workspace.querySelector<HTMLTextAreaElement>(
      `[data-resource="${CSS.escape(target.resourceId)}"]`,
    );
    editor?.focus();
  },
  onTransition: ({ to, origin, camera }) => {
    renderWorkspace();
    if (to.kind === "surface")
      workspace
        .querySelector<HTMLTextAreaElement>(
          `[data-resource="${CSS.escape(to.resourceId)}"]`,
        )
        ?.focus();
    const x = innerWidth / 2 + (origin.x - camera.x) * camera.zoom,
      y = innerHeight / 2 + (origin.y - camera.y) * camera.zoom;
    workspace.style.transformOrigin = `${x}px ${y}px`;
    if (
      !view.controller.policy.reduced &&
      !view.controller.policy.quiet &&
      to.kind === "workspace"
    )
      workspace.animate(
        [
          { opacity: 0.25, transform: "scale(.82)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
  },
});
async function renderWorkspace() {
  const l = view.controller.location,
    visible = l.kind === "workspace" || l.kind === "surface";
  workspace.hidden = !visible;
  if (!visible) return;
  workspace.replaceChildren();
  for (const b of snapshot.blocks.filter(
    (b) => b.workspace_id === l.workspaceId,
  )) {
    const r = snapshot.resources.find((r) => r.id === b.resource_id);
    if (!r) continue;
    const panel = document.createElement("article");
    panel.className = `glass-panel shape-${b.shape}`;
    panel.dataset.block = b.id;
    panel.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;z-index:${b.z};`;
    const title = document.createElement("h2");
    title.textContent = r.title;
    const textarea = document.createElement("textarea");
    textarea.value = r.content;
    textarea.dataset.resource = r.id;
    textarea.setAttribute("aria-label", r.title);
    const save = document.createElement("button");
    save.textContent = "Save note";
    save.onclick = async () => {
      try {
        snapshot = await api("content", {
          id: r.id,
          content: textarea.value,
          version: r.version,
        });
        view.update(snapshot);
        save.textContent = "Saved";
        r.version = snapshot.resources.find((x) => x.id === r.id)!.version;
      } catch (e) {
        save.textContent = "Save failed";
      }
    };
    const move = document.createElement("button");
    move.textContent = "Move right";
    move.onclick = async () => {
      snapshot = await api("move", { blockId: b.id });
      view.update(snapshot);
      void renderWorkspace();
    };
    panel.append(title, textarea, save, move);
    workspace.append(panel);
  }
}
await view.ready;
renderWorkspace();
wake();
// Deliberately exposed only in this synthetic fixture, never in production shell.
Object.assign(window, {
  constellationDemo: {
    view,
    motion,
    api,
    get snapshot() {
      return snapshot;
    },
    refresh: async () => {
      snapshot = await api("snapshot");
      view.update(snapshot);
      renderWorkspace();
    },
    renderWorkspace,
    wake,
  },
});
window.addEventListener("beforeunload", () => {
  void view.controller.persist();
});
