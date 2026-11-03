import type { MotionCoordinator, Pose } from "./motion";
import type { WorkspacePanelPreference } from "../../../application-contract/contracts.ts";

export type SurfaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SurfaceSize = Pick<SurfaceRect, "width" | "height">;
export type SurfaceInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type SurfaceSide = "bottom" | "top" | "right" | "left";
export type SurfaceCloseReason =
  | "escape"
  | "outside-pointer"
  | "close-button"
  | "programmatic"
  | "anchor-removed"
  | "native-close"
  | "disposed";
export type SurfaceAnchor = HTMLElement | SurfaceRect | (() => SurfaceRect);
export type ContextualSurfaceRequest = {
  id: string;
  anchor: SurfaceAnchor;
  content: HTMLElement;
  label?: string;
  role?: "dialog" | "region" | "menu";
  minSize?: SurfaceSize;
  maxSize?: SurfaceSize;
  /** Semantic content size, projected through the existing motion channels. */
  preferredSize?: SurfaceSize;
  placement?: SurfaceSide;
  modal?: boolean;
  dismissOnOutside?: boolean;
  initialFocus?: HTMLElement | string | false;
  workspacePanel?: {
    preference: WorkspacePanelPreference;
    save: (preference: WorkspacePanelPreference) => Promise<void>;
  };
  beforeClose?: (reason: SurfaceCloseReason) => boolean | Promise<boolean>;
  onClose?: (reason: SurfaceCloseReason) => void;
};
export type ContextualSurfaceOptions = {
  motion: MotionCoordinator;
  wake: () => void;
  viewport: () => SurfaceRect | SurfaceSize;
  safeInsets?: Partial<SurfaceInsets> | (() => Partial<SurfaceInsets>);
  root?: HTMLElement;
  restoreFocus?: (target: HTMLElement | null) => void;
  onFrame?: (id: string, rect: SurfaceRect, constrained: boolean) => void;
};
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const finite = (n: number) => Number.isFinite(n);
function rectangle(value: SurfaceRect | SurfaceSize): SurfaceRect {
  const r = {
    x: "x" in value ? value.x : 0,
    y: "y" in value ? value.y : 0,
    ...value,
  };
  if (
    ![r.x, r.y, r.width, r.height].every(finite) ||
    r.width <= 0 ||
    r.height <= 0
  )
    throw new Error("Contextual surface requires a positive finite viewport");
  return r;
}
function usableArea(
  viewport: SurfaceRect | SurfaceSize,
  insets: Partial<SurfaceInsets> = {},
): SurfaceRect {
  const r = rectangle(viewport);
  for (const n of Object.values(insets))
    if (!finite(n) || n < 0) throw new Error("Invalid surface safe inset");
  const unitX = Math.min(1, r.width),
    unitY = Math.min(1, r.height);
  const left = Math.min(insets.left ?? 0, r.width - unitX);
  const right = Math.min(insets.right ?? 0, r.width - left - unitX);
  const top = Math.min(insets.top ?? 0, r.height - unitY);
  const bottom = Math.min(insets.bottom ?? 0, r.height - top - unitY);
  return {
    x: r.x + left,
    y: r.y + top,
    width: r.width - left - right,
    height: r.height - top - bottom,
  };
}

/** Paint the current spring dimensions, including a retarget interrupted by a
 * viewport change. Text reflows at its real size; no scale transform is used. */
export function presentContextualSurface(input: {
  pose: Pose;
  viewport: SurfaceRect | SurfaceSize;
  safeInsets?: Partial<SurfaceInsets>;
}): SurfaceRect {
  const area = usableArea(input.viewport, input.safeInsets),
    p = input.pose;
  if (![p.x, p.y, p.w, p.h, p.lift].every(finite))
    throw new Error("Invalid contextual presentation pose");
  const width = clamp(p.w, Math.min(1, area.width), area.width),
    height = clamp(p.h, Math.min(1, area.height), area.height);
  return {
    x: clamp(p.x, area.x, area.x + area.width - width),
    y: clamp(p.y + p.lift, area.y, area.y + area.height - height),
    width,
    height,
  };
}

/** Finite screen-space layout. Content reflows/scrolls at the returned size;
 * there is no scale transform or mutation of its canonical source object. */
export function placeContextualSurface(input: {
  anchor: SurfaceRect;
  size: SurfaceSize;
  viewport: SurfaceRect | SurfaceSize;
  safeInsets?: Partial<SurfaceInsets>;
  preferred?: SurfaceSide;
  gap?: number;
}): SurfaceRect & { side: SurfaceSide; constrained: boolean } {
  const area = usableArea(input.viewport, input.safeInsets);
  const a = input.anchor;
  if (
    ![a.x, a.y, a.width, a.height].every(finite) ||
    a.width < 0 ||
    a.height < 0 ||
    ![input.size.width, input.size.height].every((n) => finite(n) && n > 0)
  )
    throw new Error("Invalid contextual surface geometry");
  const width = Math.min(input.size.width, area.width),
    height = Math.min(input.size.height, area.height);
  const gap = input.gap ?? 12;
  if (!finite(gap) || gap < 0)
    throw new Error("Invalid contextual surface gap");
  const positions = {
    bottom: { x: a.x, y: a.y + a.height + gap },
    top: { x: a.x, y: a.y - height - gap },
    right: { x: a.x + a.width + gap, y: a.y },
    left: { x: a.x - width - gap, y: a.y },
  };
  const preferred = input.preferred ?? "bottom";
  if (!["bottom", "top", "right", "left"].includes(preferred))
    throw new Error("Invalid contextual surface placement");
  const opposite = {
    bottom: "top",
    top: "bottom",
    left: "right",
    right: "left",
  } as const;
  const order = [
    ...new Set<SurfaceSide>([
      preferred,
      opposite[preferred],
      "bottom",
      "top",
      "right",
      "left",
    ]),
  ];
  const overflow = (r: { x: number; y: number }) =>
    Math.max(0, area.x - r.x) +
    Math.max(0, area.y - r.y) +
    Math.max(0, r.x + width - area.x - area.width) +
    Math.max(0, r.y + height - area.y - area.height);
  const side = order.reduce((best, candidate) =>
    overflow(positions[candidate]) < overflow(positions[best])
      ? candidate
      : best,
  );
  const p = positions[side];
  return {
    x: clamp(p.x, area.x, area.x + area.width - width),
    y: clamp(p.y, area.y, area.y + area.height - height),
    width,
    height,
    side,
    constrained: width < input.size.width || height < input.size.height,
  };
}

let instance = 0;
type Entry = {
  request: ContextualSurfaceRequest;
  node: HTMLDialogElement;
  body: HTMLDivElement;
  title: HTMLSpanElement;
  key: string;
  previousFocus: HTMLElement | null;
  placeholder: Comment | null;
  observer: ResizeObserver;
  dirty: boolean;
  closing: SurfaceCloseReason | null;
  pendingClose: object | null;
  destroyed: boolean;
  target: SurfaceRect;
  constrained: boolean;
  lastStyle: string;
  updatePanelControls?: () => void;
};
const focusableSelector =
  'button,input,select,textarea,a[href],summary,[tabindex],[contenteditable="true"],audio[controls],video[controls]';
function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (e) =>
      !e.closest('[inert],[aria-hidden="true"]') &&
      !e.matches(":disabled") &&
      (e.tabIndex >= 0 ||
        (e.isContentEditable && !e.hasAttribute("tabindex"))) &&
      !e.hidden &&
      getComputedStyle(e).visibility !== "hidden" &&
      e.getClientRects().length > 0,
  );
}
function anchorRect(anchor: SurfaceAnchor): SurfaceRect {
  return typeof anchor === "function"
    ? anchor()
    : "getBoundingClientRect" in anchor
      ? anchor.getBoundingClientRect()
      : anchor;
}
function sizeLimits(request: ContextualSurfaceRequest) {
  const min = request.minSize ?? { width: 240, height: 120 };
  const max = request.maxSize ?? { width: 520, height: 680 };
  if (
    ![min.width, min.height, max.width, max.height].every(
      (n) => finite(n) && n > 0,
    ) ||
    min.width > max.width ||
    min.height > max.height
  )
    throw new Error("Invalid contextual surface size limits");
  return { min, max };
}

/** Caller imports contextual-surfaces.css and invokes frame() after the SAME
 * MotionCoordinator.step() used by its app. No RAF, timers, store or provider. */
export function createContextualSurfaces(options: ContextualSurfaceOptions) {
  const entries = new Map<string, Entry>();
  const prefix = `contextual:${++instance}:`;
  const layer = document.createElement("div");
  layer.className = "aw-contextual-layer";
  (options.root ?? document.body).append(layer);
  let disposed = false;
  const insets = () =>
    typeof options.safeInsets === "function"
      ? options.safeInsets()
      : options.safeInsets;
  const top = () =>
    [...entries.values()].findLast((e) => !e.closing && !e.destroyed);
  const pose = (r: SurfaceRect, opacity = 1, lift = 0): Pose => ({
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
    lift,
    yaw: 0,
    opacity,
  });
  function restoreContent(e: Entry) {
    e.observer.disconnect();
    if (e.placeholder?.parentNode) e.placeholder.replaceWith(e.request.content);
    else e.request.content.remove();
    e.placeholder = null;
  }
  function destroy(e: Entry, reason: SurfaceCloseReason) {
    if (e.destroyed) return;
    e.destroyed = true;
    e.pendingClose = null;
    const focused = document.activeElement;
    const returnFocus =
      reason !== "outside-pointer" &&
      reason !== "anchor-removed" &&
      (e.node.contains(focused) || focused === document.body);
    entries.delete(e.request.id);
    e.observer.disconnect();
    if (e.node.open) e.node.close();
    restoreContent(e);
    e.node.remove();
    options.motion.bodies.delete(e.key);
    if (returnFocus) {
      const target = e.previousFocus?.isConnected
        ? e.previousFocus
        : typeof e.request.anchor !== "function" &&
            "focus" in e.request.anchor &&
            e.request.anchor.isConnected
          ? e.request.anchor
          : null;
      if (options.restoreFocus) options.restoreFocus(target);
      else target?.focus({ preventScroll: true });
    }
    e.request.onClose?.(reason);
  }
  function beginClose(e: Entry, reason: SurfaceCloseReason) {
    e.closing = reason;
    e.node.inert = true;
    options.motion.target(
      e.key,
      pose(e.target, 0, 8),
      `contextual surface close: ${reason}`,
    );
    options.wake();
    if (options.motion.reduced) destroy(e, reason);
  }
  function close(id: string, reason: SurfaceCloseReason = "programmatic") {
    const e = entries.get(id);
    if (!e || e.destroyed) return;
    if (!e.node.open) {
      destroy(e, "native-close");
      return;
    }
    // Teardown cannot wait on persistence owned by an outer lifecycle.
    if (
      reason === "anchor-removed" ||
      reason === "native-close" ||
      reason === "disposed"
    ) {
      destroy(e, reason);
      return;
    }
    if (e.closing || e.pendingClose) return;
    const guard = e.request.beforeClose;
    if (!guard) {
      beginClose(e, reason);
      return;
    }
    const token = {};
    e.pendingClose = token;
    const decide = (allowed: boolean) => {
      if (e.destroyed || entries.get(id) !== e || e.pendingClose !== token)
        return;
      if (!e.node.open) {
        destroy(e, "native-close");
        return;
      }
      e.pendingClose = null;
      if (allowed === true) beginClose(e, reason);
    };
    let result: boolean | Promise<boolean>;
    try {
      result = guard(reason);
    } catch {
      decide(false);
      return;
    }
    if (typeof result === "boolean") decide(result);
    else
      void Promise.resolve(result)
        .then(decide, () => decide(false))
        .catch(() => {
          // Contain a guard/thenable failure; caller owns visible save errors.
          if (e.pendingClose === token) e.pendingClose = null;
        });
  }
  function measure(e: Entry) {
    const area = usableArea(options.viewport(), insets());
    const { min, max } = sizeLimits(e.request);
    e.node.style.minWidth = `${Math.min(min.width, area.width)}px`;
    e.node.style.maxWidth = `${Math.min(max.width, area.width)}px`;
    e.node.style.maxHeight = `${Math.min(max.height, area.height)}px`;
    e.node.style.width = "fit-content";
    e.node.style.height = "auto";
    const preferred = e.request.preferredSize;
    if (
      preferred &&
      ![preferred.width, preferred.height].every((n) => finite(n) && n > 0)
    )
      throw new Error("Invalid preferred contextual size");
    const rect = e.node.getBoundingClientRect();
    const width = clamp(
      preferred?.width ?? Math.ceil(rect.width),
      Math.min(min.width, area.width),
      Math.min(max.width, area.width),
    );
    e.node.style.width = `${width}px`;
    const height = clamp(
      preferred?.height ?? Math.ceil(e.node.scrollHeight + 2),
      Math.min(min.height, area.height),
      Math.min(max.height, area.height),
    );
    e.node.style.height = `${height}px`;
    e.target = { x: e.target.x, y: e.target.y, width, height };
    e.constrained =
      min.width > area.width ||
      min.height > area.height ||
      e.node.scrollHeight > height;
    e.dirty = false;
  }
  function retarget(e: Entry) {
    if (e.dirty) measure(e);
    const target = placeContextualSurface({
      anchor: anchorRect(e.request.anchor),
      size: e.target,
      viewport: options.viewport(),
      safeInsets: insets(),
      preferred: e.request.placement,
    });
    e.target = target;
    e.constrained ||= target.constrained;
    const body = options.motion.bodies.get(e.key);
    if (body) {
      const next = pose(target);
      const changed = Object.entries(next).some(
        ([key, value]) => body.channels[key as keyof Pose].target !== value,
      );
      options.motion.target(e.key, pose(target), "contextual anchor/viewport");
      if (changed) options.wake();
    }
    e.node.dataset.side = target.side;
  }
  function frame(_now: number) {
    if (disposed) return;
    for (const e of [...entries.values()]) {
      if (e.destroyed) continue;
      if (!e.node.open) {
        destroy(e, "native-close");
        continue;
      }
      if (
        typeof e.request.anchor !== "function" &&
        "isConnected" in e.request.anchor &&
        !e.request.anchor.isConnected
      ) {
        destroy(e, "anchor-removed");
        continue;
      }
      if (!e.closing) retarget(e);
      else if (e.dirty) measure(e);
      const p = options.motion.pose(e.key);
      if (e.closing && p.opacity <= 0.001) {
        destroy(e, e.closing);
        continue;
      }
      const { x, y, width, height } = presentContextualSurface({
        pose: p,
        viewport: options.viewport(),
        safeInsets: insets(),
      });
      const style = `translate3d(${x.toFixed(3)}px,${y.toFixed(3)}px,0)`;
      const signature = `${style}/${p.opacity.toFixed(4)}/${width}/${height}`;
      e.node.style.width = `${width}px`;
      e.node.style.height = `${height}px`;
      e.node.style.transform = style;
      e.node.style.opacity = String(clamp(p.opacity, 0, 1));
      if (e.lastStyle !== signature) {
        e.lastStyle = signature;
        options.onFrame?.(e.request.id, { x, y, width, height }, e.constrained);
      }
    }
  }
  function initialFocus(e: Entry) {
    const request = e.request;
    if (request.initialFocus === false) {
      if (!request.modal) e.previousFocus?.focus({ preventScroll: true });
      return;
    }
    const requested =
      typeof request.initialFocus === "string"
        ? request.content.querySelector<HTMLElement>(request.initialFocus)
        : request.initialFocus;
    const target = requested && e.node.contains(requested) ? requested : null;
    (
      target ??
      request.content.querySelector<HTMLElement>("[autofocus]") ??
      focusables(request.content)[0] ??
      e.node
    ).focus({ preventScroll: true });
  }
  function panelControls(e: Entry, header: HTMLElement, dismiss: HTMLElement) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "aw-contextual-pin";
    pin.dataset.aerynthMotionControl = "true";
    pin.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8m-7 0v6l-3 4h12l-3-4V4m-3 10v6"/></svg>';
    const grip = document.createElement("div");
    grip.className = "aw-contextual-resize";
    grip.dataset.aerynthMotionControl = "true";
    grip.tabIndex = 0;
    grip.setAttribute("role", "group");
    grip.setAttribute("aria-label", "Resize panel with arrow keys");
    grip.title = "Drag to resize · Arrow keys when focused";
    grip.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7m-5 10 5-5"/></svg>';
    header.insertBefore(pin, dismiss);
    e.node.append(grip);
    let saving = false;
    let drag:
      | {
          id: number;
          x: number;
          y: number;
          size: SurfaceSize;
          previous?: SurfaceSize;
          panel: ContextualSurfaceRequest["workspacePanel"];
        }
      | undefined;
    const sync = () => {
      const panel = e.request.workspacePanel;
      if (drag && drag.panel !== panel) {
        const { id } = drag;
        drag = undefined;
        if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
      }
      pin.hidden = grip.hidden = !panel;
      const pinned = panel?.preference.pinned ?? false;
      pin.setAttribute("aria-pressed", String(pinned));
      pin.setAttribute(
        "aria-label",
        pinned ? "Unpin from workspace" : "Pin to workspace",
      );
      pin.title = pin.getAttribute("aria-label")!;
    };
    const changeSize = (size: SurfaceSize | undefined) => {
      e.request.preferredSize = size;
      e.dirty = true;
      retarget(e);
      options.wake();
    };
    const dimensions = (width: number, height: number) => {
      const area = usableArea(options.viewport(), insets());
      const { min, max } = sizeLimits(e.request);
      return {
        width: Math.max(
          1,
          Math.round(
            clamp(
              width,
              Math.min(area.width, min.width),
              Math.min(area.width, max.width),
            ),
          ),
        ),
        height: Math.max(
          1,
          Math.round(
            clamp(
              height,
              Math.min(area.height, min.height),
              Math.min(area.height, max.height),
            ),
          ),
        ),
      };
    };
    const save = async (
      change: Partial<WorkspacePanelPreference>,
      previous?: SurfaceSize,
    ) => {
      const panel = e.request.workspacePanel;
      if (!panel || saving) return;
      const preference = { ...panel.preference, ...change };
      saving = true;
      pin.disabled = true;
      try {
        await panel.save(preference);
        if (e.request.workspacePanel === panel) panel.preference = preference;
      } catch {
        if (!e.destroyed && e.request.workspacePanel === panel && change.size)
          changeSize(previous);
      } finally {
        pin.disabled = false;
        saving = false;
        sync();
      }
    };
    pin.onclick = () => {
      const preference = e.request.workspacePanel?.preference;
      if (preference && !drag) void save({ pinned: !preference.pinned });
    };
    grip.onpointerdown = (event) => {
      if (event.button !== 0 || drag || saving || !e.request.workspacePanel)
        return;
      event.preventDefault();
      grip.focus({ preventScroll: true });
      grip.setPointerCapture(event.pointerId);
      const rect = e.node.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        size: rect,
        previous: e.request.preferredSize,
        panel: e.request.workspacePanel,
      };
    };
    grip.onpointermove = (event) => {
      if (event.pointerId !== drag?.id) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (dx || dy)
        changeSize(dimensions(drag.size.width + dx, drag.size.height + dy));
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== drag?.id) return;
      const { previous } = drag;
      drag = undefined;
      if (event.type === "pointerup") {
        const size = e.request.preferredSize;
        if (size && size !== previous) void save({ size }, previous);
      } else if (!e.destroyed && !e.closing) changeSize(previous);
    };
    grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = end;
    grip.onkeydown = (event) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        grip.releasePointerCapture(drag.id);
        return;
      }
      const direction = directions[event.key];
      if (!direction || drag || saving || !e.request.workspacePanel) return;
      event.preventDefault();
      const previous = e.request.preferredSize;
      const step = event.shiftKey ? 48 : 16;
      const size = dimensions(
        e.target.width + step * direction[0],
        e.target.height + step * direction[1],
      );
      changeSize(size);
      void save({ size }, previous);
    };
    sync();
    return sync;
  }
  function open(request: ContextualSurfaceRequest): HTMLDialogElement {
    if (disposed) throw new Error("Contextual surfaces disposed");
    if (
      typeof request.id !== "string" ||
      !request.id.trim() ||
      request.id.length > 512
    )
      throw new Error("Contextual surface requires an id");
    sizeLimits(request);
    if (request.modal && request.role && request.role !== "dialog")
      throw new Error("Modal surface must have dialog semantics");
    placeContextualSurface({
      anchor: anchorRect(request.anchor),
      size: request.minSize ?? { width: 240, height: 120 },
      viewport: options.viewport(),
      safeInsets: insets(),
      preferred: request.placement,
    });
    const existing = entries.get(request.id);
    if (
      existing &&
      existing.node.open &&
      existing.request.content === request.content &&
      !!existing.request.modal === !!request.modal
    ) {
      existing.pendingClose = null;
      existing.request = request;
      existing.closing = null;
      existing.node.inert = false;
      existing.dirty = true;
      existing.title.textContent = request.label ?? "";
      if (request.workspacePanel && !existing.updatePanelControls) {
        const header = existing.title.parentElement!;
        existing.updatePanelControls = panelControls(
          existing,
          header,
          header.lastElementChild as HTMLElement,
        );
      } else existing.updatePanelControls?.();
      existing.node.setAttribute(
        "aria-label",
        request.label ?? "Contextual panel",
      );
      existing.node.setAttribute("role", request.role ?? "dialog");
      entries.delete(request.id);
      entries.set(request.id, existing);
      layer.append(existing.node);
      retarget(existing);
      options.wake();
      if (!existing.node.contains(document.activeElement))
        initialFocus(existing);
      return existing.node;
    }
    // A synchronous explicit replacement is forced UI cleanup, not close().
    // Its caller must flush before swapping content/modality; old decisions
    // are invalidated by destroy() and cannot affect the replacement.
    if (existing)
      destroy(existing, existing.node.open ? "programmatic" : "native-close");
    if (
      [...entries.values()].some((e) => e.request.content === request.content)
    )
      throw new Error(
        "Content is already mounted in another contextual surface",
      );
    const node = document.createElement("dialog"),
      header = document.createElement("header"),
      title = document.createElement("span"),
      dismiss = document.createElement("button"),
      body = document.createElement("div");
    node.className = "aw-contextual-surface";
    node.dataset.surfaceId = request.id;
    node.tabIndex = -1;
    node.setAttribute("role", request.role ?? "dialog");
    node.setAttribute("aria-label", request.label ?? "Contextual panel");
    if (request.modal) node.setAttribute("aria-modal", "true");
    header.className = "aw-contextual-heading";
    title.textContent = request.label ?? "";
    dismiss.type = "button";
    dismiss.className = "aw-contextual-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", "Close panel");
    header.append(title, dismiss);
    body.className = "aw-contextual-content";
    node.append(header, body);
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const placeholder = request.content.parentNode
      ? document.createComment("contextual surface content")
      : null;
    if (placeholder) request.content.before(placeholder);
    body.append(request.content);
    layer.append(node);
    const e: Entry = {
      request,
      node,
      body,
      title,
      key: prefix + request.id,
      previousFocus,
      placeholder,
      observer: new ResizeObserver(() => {
        if (!e.destroyed && !e.closing) {
          e.dirty = true;
          options.wake();
        }
      }),
      dirty: true,
      closing: null,
      pendingClose: null,
      destroyed: false,
      target: { x: 0, y: 0, width: 1, height: 1 },
      constrained: false,
      lastStyle: "",
    };
    if (request.workspacePanel)
      e.updatePanelControls = panelControls(e, header, dismiss);
    node.style.visibility = "hidden";
    if (request.modal) node.showModal();
    else node.show();
    retarget(e);
    // Start at the actual target; only depth/opacity arrive on opening.
    options.motion.add(e.key, pose(e.target, 0, 8));
    entries.set(request.id, e);
    options.motion.target(e.key, pose(e.target), "contextual surface open");
    e.observer.observe(request.content);
    dismiss.onclick = () => close(request.id, "close-button");
    node.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(request.id, "escape");
    });
    node.addEventListener("close", () => {
      if (!e.destroyed) destroy(e, "native-close");
    });
    node.style.visibility = "visible";
    frame(0);
    options.wake();
    initialFocus(e);
    return node;
  }
  const pointer = (event: PointerEvent) => {
    const e = top();
    if (
      !e ||
      e.request.workspacePanel?.preference.pinned ||
      !(e.request.dismissOnOutside ?? !e.request.modal)
    )
      return;
    const path = event.composedPath(),
      r = e.node.getBoundingClientRect();
    if (
      (path.includes(e.node) && event.target !== e.node) ||
      (typeof e.request.anchor !== "function" &&
        "nodeType" in e.request.anchor &&
        path.includes(e.request.anchor))
    )
      return;
    if (
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    )
      return;
    close(e.request.id, "outside-pointer");
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const e = top();
    if (!e) return;
    if (
      e.request.workspacePanel?.preference.pinned &&
      !e.node.contains(document.activeElement)
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(e.request.id, "escape");
    } else if (event.key === "Tab" && e.request.modal) {
      const items = focusables(e.node),
        active = document.activeElement;
      if (!items.length) {
        event.preventDefault();
        e.node.focus();
      } else if (
        event.shiftKey &&
        (active === items[0] || !e.node.contains(active))
      ) {
        event.preventDefault();
        items.at(-1)!.focus();
      } else if (
        !event.shiftKey &&
        (active === items.at(-1) || !e.node.contains(active))
      ) {
        event.preventDefault();
        items[0].focus();
      }
    }
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard);
  return {
    open,
    close,
    frame,
    resize(id: string, preferredSize: SurfaceSize) {
      if (
        ![preferredSize.width, preferredSize.height].every(
          (n) => finite(n) && n > 0,
        )
      )
        throw new Error("Invalid preferred contextual size");
      const e = entries.get(id);
      if (!e || e.destroyed || e.closing) return;
      if (
        e.request.preferredSize?.width === preferredSize.width &&
        e.request.preferredSize?.height === preferredSize.height
      )
        return;
      e.request = { ...e.request, preferredSize: { ...preferredSize } };
      e.dirty = true;
      retarget(e);
      options.wake();
    },
    viewportChanged() {
      for (const e of entries.values()) e.dirty = true;
      frame(0);
      options.wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard);
      for (const e of [...entries.values()]) destroy(e, "disposed");
      layer.remove();
    },
  };
}
