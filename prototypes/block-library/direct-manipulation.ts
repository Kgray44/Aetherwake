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
  fromFocusedSide?: true;
}>;
export type DirectManipulationOptions = {
  blockId: string;
  state(): GestureState | null;
  preview(presentation: Presentation, intent: "move" | "resize"): void;
  commit(command: Command, intent: "move" | "resize"): Promise<void>;
  cancel(): void;
  failed(error: unknown): void;
  context?(event: MouseEvent): void;
  remove?(): Promise<void>;
  canRemove?(): boolean;
  /** The host resolves an eligible screen point to a world-space drop center. */
  focusedDrop?(clientX: number, clientY: number): { x: number; y: number } | null;
  onGestureChange?(state: DirectGesturePresentation | null): void;
};
const editor = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
export const cardInteractionTarget = `${editor},button,a,summary,[role="button"],[role="log"],pre,[data-no-card-drag],[data-resize-edge]`;
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
      capture: HTMLElement;
      fromFocusedSide: boolean;
    } | null = null,
    pending = false,
    suppressClick = false;
  let gesturePresentation: DirectGesturePresentation | null = null;
  const publishGesture = (phase: DirectGesturePresentation["phase"] | null, intent?: "move" | "resize", fromFocusedSide = false) => {
    if (phase === null && gesturePresentation === null) return;
    if (phase !== null && gesturePresentation?.phase === phase && gesturePresentation.intent === intent) return;
    gesturePresentation = phase === null ? null : Object.freeze({
      blockId: options.blockId, intent: intent!, phase, ...(fromFocusedSide ? { fromFocusedSide: true } : {}),
    });
    options.onGestureChange?.(gesturePresentation);
  };
  const release = () => {
    const current = gesture;
    if (!current) return;
    gesture = null;
    article.classList.remove("direct-manipulating");
    document.documentElement.style.userSelect = current.selection;
    if (current.capture.hasPointerCapture(current.pointerId))
      current.capture.releasePointerCapture(current.pointerId);
    return current;
  };
  const cancel = () => {
    const current = release();
    if (!current) return;
    if (current.active) suppressClick = true;
    publishGesture(null);
    options.cancel();
  };
  const commit = async (command: Command, intent: "move" | "resize", fromFocusedSide = false) => {
    if (pending) return;
    pending = true;
    article.setAttribute("aria-busy", "true");
    try {
      publishGesture("committing", intent, fromFocusedSide);
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
  const canRemove = () => {
    if (!options.remove || pending || gesture || options.canRemove?.() === false) return false;
    const block = options.state()?.blocks.find(block => block.blockId === options.blockId);
    return !!block && !block.locked;
  };
  const remove = async () => {
    if (!canRemove()) return;
    pending = true;
    article.setAttribute("aria-busy", "true");
    try { await options.remove!(); }
    catch (error) { options.failed(error); }
    finally { pending = false; article.removeAttribute("aria-busy"); }
  };
  const trash = options.remove ? document.createElement("button") : null;
  if (trash) {
    trash.type = "button";
    trash.className = "aw-placement-trash";
    trash.setAttribute("aria-label", "Remove from workspace");
    trash.title = "Remove from workspace";
    trash.dataset.aerynthMotionControl = "true";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5");
    icon.append(path);
    trash.append(icon);
    trash.addEventListener("click", event => { event.stopPropagation(); void remove(); }, { signal });
    article.append(trash);
  }
  const updateGesture = (current: NonNullable<typeof gesture>, event: PointerEvent) => {
    let dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.fromFocusedSide) {
      const point = options.focusedDrop?.(event.clientX, event.clientY);
      if (!point) return false;
      const { block, state } = current.value;
      dx = (point.x - block.width / 2 - block.x) * state.viewport.zoom;
      dy = (point.y - block.height / 2 - block.y) * state.viewport.zoom;
    }
    options.preview(current.value.update(dx, dy, 0, event.shiftKey), current.intent);
    return true;
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
      const sideAnchor = options.focusedDrop && article.classList.contains("receded")
        ? target.closest<HTMLElement>(".resource-anchor") : null;
      if (article.classList.contains("receded") && !sideAnchor) return;
      const handle = target.closest<HTMLElement>("[data-resize-edge]")?.dataset
        .resizeEdge as Handle | undefined;
      if (!sideAnchor && !handle && target.closest(cardInteractionTarget)) return;
      const state = options.state();
      if (!state) return;
      if (sideAnchor && state.blocks.find(block => block.blockId === options.blockId)?.locked) return;
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
          capture: sideAnchor ?? article,
          fromFocusedSide: !!sideAnchor,
        };
        gesture.capture.setPointerCapture(event.pointerId);
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
        if (updateGesture(current, event)) publishGesture("active", current.intent, current.fromFocusedSide);
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
          if (!updateGesture(gesture, event)) {
            suppressClick = true;
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          publishGesture("active", gesture.intent, gesture.fromFocusedSide);
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
        void commit(current.value.command(crypto.randomUUID()), current.intent, current.fromFocusedSide);
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
      if (event.key === "Delete" && !event.defaultPrevented && !event.repeat && !event.isComposing &&
          !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
          article.classList.contains("selected") &&
          !(event.target instanceof Element && event.target.closest(editor)) && canRemove()) {
        event.preventDefault();
        event.stopPropagation();
        void remove();
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
        if (pending || gesture || !(event.target instanceof Element) || event.target.closest(cardInteractionTarget)) return;
        event.preventDefault();
        event.stopPropagation();
        options.context!(event);
      },
      { signal },
    );
  return {
    cancel,
    remove,
    presentation: () => gesturePresentation,
    dispose() {
      cancel();
      publishGesture(null);
      abort.abort();
      edges.remove();
      trash?.remove();
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
