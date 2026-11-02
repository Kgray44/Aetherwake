import {
  LayoutGesture,
  type GestureState,
} from "../workspace-engine/interaction.mts";
import type {
  Command,
  Presentation,
  OrganizationMode,
} from "../workspace-engine/contracts.mts";
import type { Handle } from "../workspace-engine/geometry.mts";

/** Transient presentation only. Geometry stays in the existing preview path;
 * the host's Motion Coordinator owns lift, spring following and settlement. */
export type DirectGesturePresentation = Readonly<{
  blockId: string;
  intent: "move" | "resize";
  phase: "active" | "committing";
}>;
export type DirectManipulationOptions = {
  blockId: string;
  state(): GestureState | null;
  preview(presentation: Presentation, intent: "move" | "resize"): void;
  commit(command: Command, intent: "move" | "resize"): Promise<void>;
  cancel(): void;
  failed(error: unknown): void;
  context?(event: MouseEvent): void;
  onGestureChange?(state: DirectGesturePresentation | null): void;
};
const interactive =
  "input,textarea,select,button,a,[contenteditable=true],[role=log],pre,[data-no-card-drag]";
/** Native-style surface dragging and invisible edge resizing, using the existing engine gesture math. */
export function mountDirectManipulation(
  article: HTMLElement,
  options: DirectManipulationOptions,
) {
  const abort = new AbortController(),
    signal = abort.signal,
    document = article.ownerDocument,
    oldTabIndex = article.getAttribute("tabindex"),
    oldDescription = article.getAttribute("aria-description");
  article.dataset.directManipulation = "true";
  if (oldTabIndex === null) article.tabIndex = 0;
  article.setAttribute(
    "aria-description",
    "Drag the card surface to move. Drag any edge or corner to resize. With the card focused, arrow keys move and Shift plus arrow keys resize. Escape cancels.",
  );
  // Remove old move widgets while leaving resource-specific controls and editors intact.
  article
    .querySelectorAll(".move-controls,.block-tools")
    .forEach((element) => element.remove());
  const oldGrip = article.querySelector<HTMLButtonElement>("button.grip");
  if (oldGrip) {
    const label = document.createElement("span");
    label.className = "grip card-kind-label";
    const kind = oldGrip.querySelector("span");
    if (kind) label.append(kind);
    oldGrip.replaceWith(label);
  }
  const edges = document.createElement("div");
  edges.className = "aw-card-edges";
  edges.setAttribute("aria-hidden", "true");
  for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const) {
    const edge = document.createElement("span");
    edge.className = "aw-card-edge aw-card-edge--" + handle;
    edge.dataset.resizeEdge = handle;
    edges.append(edge);
  }
  article.append(edges);
  let gesture: {
      value: LayoutGesture;
      x: number;
      y: number;
      pointerId: number;
      active: boolean;
      selection: string;
      intent: "move" | "resize";
    } | null = null,
    pending = false,
    suppressClick = false;
  let gesturePresentation: DirectGesturePresentation | null = null;
  const publishGesture = (phase: DirectGesturePresentation["phase"] | null, intent?: "move" | "resize") => {
    if (phase === null && gesturePresentation === null) return;
    if (phase !== null && gesturePresentation?.phase === phase && gesturePresentation.intent === intent) return;
    gesturePresentation = phase === null ? null : Object.freeze({ blockId: options.blockId, intent: intent!, phase });
    options.onGestureChange?.(gesturePresentation);
  };
  const release = () => {
    const current = gesture;
    if (!current) return;
    gesture = null;
    article.classList.remove("direct-manipulating");
    document.documentElement.style.userSelect = current.selection;
    if (article.hasPointerCapture(current.pointerId))
      article.releasePointerCapture(current.pointerId);
    return current;
  };
  const cancel = () => {
    if (!release()) return;
    publishGesture(null);
    options.cancel();
  };
  const commit = async (command: Command, intent: "move" | "resize") => {
    if (pending) return;
    pending = true;
    article.setAttribute("aria-busy", "true");
    try {
      publishGesture("committing", intent);
      await options.commit(command, intent);
    } catch (error) {
      options.failed(error);
      options.cancel();
    } finally {
      pending = false;
      article.removeAttribute("aria-busy");
      publishGesture(null);
    }
  };
  article.addEventListener(
    "pointerdown",
    (event) => {
      suppressClick = false;
      if (
        event.button !== 0 ||
        pending ||
        gesture ||
        article.classList.contains("expanded")
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const handle = target.closest<HTMLElement>("[data-resize-edge]")?.dataset
        .resizeEdge as Handle | undefined;
      if (!handle && target.closest(interactive)) return;
      const state = options.state();
      if (!state) return;
      try {
        const value = new LayoutGesture(
          state,
          options.blockId,
          handle ?? "move",
        );
        gesture = {
          value,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          active: !!handle,
          selection: document.documentElement.style.userSelect,
          intent: handle ? "resize" : "move",
        };
        article.setPointerCapture(event.pointerId);
        event.stopPropagation();
        if (handle) {
          event.preventDefault();
          document.documentElement.style.userSelect = "none";
          article.classList.add("direct-manipulating");
          publishGesture("active", "resize");
        }
      } catch (error) {
        options.failed(error);
      }
    },
    { capture: true, signal },
  );
  article.addEventListener(
    "pointermove",
    (event) => {
      const current = gesture;
      if (!current || current.pointerId !== event.pointerId) return;
      const state = options.state();
      if (
        !state ||
        state.workspaceId !== current.value.state.workspaceId ||
        state.revision !== current.value.state.revision
      ) {
        cancel();
        return;
      }
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      if (!current.active && Math.hypot(dx, dy) < 4) return;
      current.active = true;
      event.preventDefault();
      event.stopPropagation();
      document.documentElement.style.userSelect = "none";
      article.classList.add("direct-manipulating");
      try {
        publishGesture("active", current.intent);
        options.preview(
          current.value.update(dx, dy, 0, event.shiftKey),
          current.intent,
        );
      } catch (error) {
        options.failed(error);
        cancel();
      }
    },
    { capture: true, signal },
  );
  article.addEventListener(
    "pointerup",
    (event) => {
      if (gesture?.pointerId !== event.pointerId) return;
      const state = options.state();
      if (
        !state ||
        state.workspaceId !== gesture.value.state.workspaceId ||
        state.revision !== gesture.value.state.revision
      ) {
        cancel();
        return;
      }
      // A release can carry the last pointer position without a matching move
      // event. Commit that position through the same engine gesture, so fast
      // edge resizing does not spring back to the penultimate sample.
      try {
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (gesture.active || Math.hypot(dx, dy) >= 4) {
          gesture.active = true;
          publishGesture("active", gesture.intent);
          options.preview(gesture.value.update(dx, dy, 0, event.shiftKey), gesture.intent);
        }
      } catch (error) {
        options.failed(error);
        cancel();
        return;
      }
      const current = release()!;
      if (!current.active) {
        publishGesture(null);
        options.cancel();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      const before = current.value.block,
        after = current.value.current;
      const changed =
        after.x !== before.x ||
        after.y !== before.y ||
        after.width !== before.width ||
        after.height !== before.height;
      if (changed)
        void commit(current.value.command(crypto.randomUUID()), current.intent);
      else { publishGesture(null); options.cancel(); }
    },
    { capture: true, signal },
  );
  article.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal },
  );
  article.addEventListener("pointercancel", cancel, { signal });
  article.addEventListener("lostpointercapture", cancel, { signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && gesture) {
        event.preventDefault();
        cancel();
      }
    },
    { signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") cancel();
    },
    { signal },
  );
  article.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target !== article ||
        pending ||
        gesture ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const state = options.state();
      if (!state) return;
      try {
        const resize = event.shiftKey,
          value = new LayoutGesture(
            state,
            options.blockId,
            resize ? "se" : "move",
          ),
          step = (event.altKey ? 1 : 12) * state.viewport.zoom;
        value.update(
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
        );
        void commit(
          value.command(crypto.randomUUID()),
          resize ? "resize" : "move",
        );
      } catch (error) {
        options.failed(error);
      }
    },
    { signal },
  );
  if (options.context)
    article.addEventListener(
      "contextmenu",
      (event) => {
        if ((event.target as Element).closest(interactive)) return;
        event.preventDefault();
        options.context!(event);
      },
      { signal },
    );
  return {
    cancel,
    presentation: () => gesturePresentation,
    dispose() {
      cancel();
      publishGesture(null);
      abort.abort();
      edges.remove();
      delete article.dataset.directManipulation;
      if (oldTabIndex === null) article.removeAttribute("tabindex");
      else article.setAttribute("tabindex", oldTabIndex);
      if (oldDescription === null) article.removeAttribute("aria-description");
      else article.setAttribute("aria-description", oldDescription);
    },
  };
}

/** Small workspace-local mode control. Moving and resizing have no toolbar or setup step. */
export function mountWorkspaceLayoutControls(
  root: HTMLElement,
  options: {
    mode(): OrganizationMode;
    change(mode: OrganizationMode): Promise<void>;
    add(): void;
    more?(): void;
    failed(error: unknown): void;
  },
) {
  const section = document.createElement("nav");
  section.className = "aw-workspace-layout";
  section.setAttribute("aria-label", "Workspace layout");
  const buttons = new Map<OrganizationMode, HTMLButtonElement>();
  let pending = false,
    disposed = false;
  const refresh = () => {
    if (disposed) return;
    for (const [mode, button] of buttons) {
      button.setAttribute("aria-pressed", String(mode === options.mode()));
      button.disabled = pending;
    }
  };
  for (const mode of ["fluid", "freeform", "structured"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.organizationMode = mode;
    button.textContent = mode[0].toUpperCase() + mode.slice(1);
    button.title =
      mode === "fluid"
        ? "Cards make room for each other"
        : mode === "freeform"
          ? "Arrange and overlap cards freely"
          : "Align cards in a grid";
    button.onclick = () => {
      if (pending || options.mode() === mode) return;
      pending = true;
      refresh();
      void options
        .change(mode)
        .catch(options.failed)
        .finally(() => {
          pending = false;
          refresh();
        });
    };
    buttons.set(mode, button);
    section.append(button);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "aw-workspace-add";
  add.textContent = "＋";
  add.setAttribute("aria-label", "Add block");
  add.onclick = options.add;
  section.append(add);
  if (options.more) {
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = "⋯";
    more.setAttribute("aria-label", "Workspace actions");
    more.onclick = options.more;
    section.append(more);
  }
  root.append(section);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      section.remove();
    },
  };
}
