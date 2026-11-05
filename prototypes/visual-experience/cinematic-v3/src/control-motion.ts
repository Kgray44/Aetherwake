import type { MotionCoordinator, Pose } from "./motion.ts";

export interface ControlMotionOptions {
  motion: MotionCoordinator;
  wake(): void;
  root: HTMLElement;
  /** Explicit host-feedback controls only; tag before insertion. Never a blanket button selector. */
  selector?: string;
}
const variables = [
  "--control-hover",
  "--control-focus",
  "--control-press",
  "--control-disabled",
  "--control-toggled",
] as const;
const materialClass = "aw-control-motion";
const owners = new WeakMap<HTMLElement, object>();
let instance = 0;
type Entry = {
  key: string;
  hover: boolean;
  focus: boolean;
  press: boolean;
  disabled: boolean;
  toggled: boolean;
  signature: string;
  hadClass: boolean;
  restore: { value: string; priority: string }[];
  listeners: (() => void)[];
};
const disabled = (node: HTMLElement) =>
  (node as HTMLButtonElement).disabled === true || node.matches(":disabled");
const pose = (
  entry: Pick<Entry, "hover" | "focus" | "press" | "disabled" | "toggled">,
): Pose => ({
  x: Number(entry.hover),
  y: Number(entry.focus),
  w: Number(entry.toggled),
  h: Number(entry.press && !entry.disabled),
  lift: Number(entry.disabled),
  yaw: 0,
  opacity: 1,
});

/** Visual feedback only. Host calls frame() after its shared coordinator step.
 * No click/clipboard handlers, event cancellation, semantic attributes, focus
 * changes, scheduler, geometry reads, canonical state or per-frame DOM scan. */
export function createControlMotion({
  motion,
  wake,
  root,
  selector = "[data-native-copy-control],[data-aerynth-motion-control]",
}: ControlMotionOptions) {
  const prefix = `control-motion:${++instance}:`,
    owner = {},
    ids = new WeakMap<HTMLElement, string>(),
    entries = new Map<HTMLElement, Entry>();
  let serial = 0,
    disposed = false;
  const Observer =
    root.ownerDocument.defaultView?.MutationObserver ??
    globalThis.MutationObserver;
  if (!Observer) throw Error("control_motion_observer_unavailable");
  const signature = (entry: Entry) =>
    [entry.hover, entry.focus, entry.press && !entry.disabled, entry.disabled, entry.toggled]
      .map(Number)
      .join(":");
  function paint(node: HTMLElement, entry: Entry) {
    const p = motion.pose(entry.key),
      values = [p.x, p.y, p.h, p.lift, p.w];
    variables.forEach((name, index) => {
      const value = String(Math.max(0, Math.min(1, values[index])));
      if (node.style.getPropertyValue(name) !== value)
        node.style.setProperty(name, value);
    });
  }
  function retarget(entry: Entry, cause: string) {
    const next = signature(entry);
    if (entry.signature === next) return;
    entry.signature = next;
    motion.target(entry.key, pose(entry), `control feedback: ${cause}`);
    wake();
  }
  function retire(node: HTMLElement, entry: Entry) {
    for (const remove of entry.listeners) remove();
    motion.bodies.delete(entry.key);
    entries.delete(node);
    if (owners.get(node) === owner) owners.delete(node);
    if (!entry.hadClass) node.classList.remove(materialClass);
    variables.forEach((name, index) => {
      const saved = entry.restore[index];
      if (saved.value)
        node.style.setProperty(name, saved.value, saved.priority);
      else node.style.removeProperty(name);
    });
  }
  function register(node: HTMLElement) {
    if (owners.has(node)) return;
    const key = ids.get(node) ?? prefix + ++serial;
    ids.set(node, key);
    const entry: Entry = {
      key,
      hover: node.matches(":hover"),
      focus: node.contains(node.ownerDocument.activeElement),
      press: false,
      disabled: disabled(node),
      toggled: node.getAttribute("aria-pressed") === "true",
      signature: "",
      hadClass: node.classList.contains(materialClass),
      restore: variables.map((name) => ({
        value: node.style.getPropertyValue(name),
        priority: node.style.getPropertyPriority(name),
      })),
      listeners: [],
    };
    entry.signature = signature(entry);
    motion.add(key, pose(entry));
    owners.set(node, owner);
    entries.set(node, entry);
    node.classList.add(materialClass);
    const listen = (name: string, handler: (event: Event) => void) => {
      const fn = (event: Event) => {
        if (!disposed && entries.get(node) === entry) handler(event);
      };
      node.addEventListener(name, fn);
      entry.listeners.push(() => node.removeEventListener(name, fn));
    };
    const set = (cause: string, change: () => void) => {
      entry.disabled = disabled(node);
      change();
      if (entry.disabled) entry.press = false;
      retarget(entry, cause);
    };
    listen("pointerenter", () =>
      set("pointer enter", () => {
        entry.hover = true;
      }),
    );
    listen("pointerleave", () =>
      set("pointer leave", () => {
        entry.hover = entry.press = false;
      }),
    );
    listen("pointerdown", (event) => {
      if ((event as PointerEvent).button === 0)
        set("pointer press", () => {
          entry.press = !entry.disabled;
        });
    });
    listen("pointerup", () =>
      set("pointer release", () => {
        entry.press = false;
      }),
    );
    listen("pointercancel", () =>
      set("pointer cancellation", () => {
        entry.press = false;
      }),
    );
    listen("focusin", () =>
      set("focus", () => {
        entry.focus = true;
      }),
    );
    listen("focusout", (event) =>
      set("blur", () => {
        const related = (event as FocusEvent).relatedTarget;
        entry.focus =
          !!related && "nodeType" in related && node.contains(related as Node);
        entry.press = false;
      }),
    );
    listen("keydown", (event) => {
      if ([" ", "Enter"].includes((event as KeyboardEvent).key))
        set("key press", () => {
          entry.press = !entry.disabled;
        });
    });
    listen("keyup", (event) => {
      if ([" ", "Enter"].includes((event as KeyboardEvent).key))
        set("key release", () => {
          entry.press = false;
        });
    });
    paint(node, entry);
  }
  function candidates(scope: HTMLElement) {
    const found = [...scope.querySelectorAll<HTMLElement>(selector)];
    if (scope.matches(selector)) found.push(scope);
    return found.filter(
      (node) =>
        node.matches("[data-native-copy-control]") ||
        node.matches("[data-aerynth-motion-control]"),
    );
  }
  const observer = new Observer((records) => {
    if (disposed) return;
    const added = new Set<HTMLElement>(),
      toggled = new Set<Node>(),
      disabledScopes: Node[] = [];
    let removed = false;
    for (const record of records) {
      if (record.type === "attributes" && record.attributeName === "disabled")
        disabledScopes.push(record.target);
      if (record.type === "attributes" && record.attributeName === "aria-pressed")
        toggled.add(record.target);
      if (record.type !== "childList") continue;
      // Text deltas/Copy feedback labels never trigger a body-wide selector scan.
      for (const node of record.addedNodes)
        if (node.nodeType === 1 && root.contains(node))
          for (const control of candidates(node as HTMLElement))
            added.add(control);
      for (const node of record.removedNodes)
        if (node.nodeType === 1) removed = true;
    }
    if (removed)
      for (const [node, entry] of entries)
        if (!root.contains(node)) retire(node, entry);
    for (const node of added)
      if (!entries.has(node) && root.contains(node)) register(node);
    for (const [node, entry] of entries) {
      if (toggled.has(node)) {
        entry.toggled = node.getAttribute("aria-pressed") === "true";
        retarget(entry, "toggle state");
      }
      if (
        disabledScopes.some((scope) => scope === node || scope.contains(node))
      ) {
        entry.disabled = disabled(node);
        if (entry.disabled) entry.press = false;
        retarget(entry, "disabled state");
      }
    }
  });
  // Validate selector and bind the baseline before observing our own additions.
  for (const node of candidates(root)) register(node);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-pressed"],
  });
  return {
    frame() {
      if (disposed) return;
      for (const [node, entry] of entries)
        if (!root.contains(node)) retire(node, entry);
        else paint(node, entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      for (const [node, entry] of entries) retire(node, entry);
    },
  };
}
