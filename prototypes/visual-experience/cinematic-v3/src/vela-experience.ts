import type { VelaPanelPresentation } from "../../../vela-core/src/panel.ts";
import type { Policy } from "../../../constellation/types.ts";
import type { MotionCoordinator } from "./motion.ts";

const neutral = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
let instances = 0;
const energy: Record<VelaPanelPresentation["phase"], number> = {
  idle: 0,
  receiving: 0.18,
  planning: 0.6,
  review: 0.35,
  applying: 0.75,
  attention: 0.5,
  error: 0.2,
};

/** A transient projection of real Vela observations. It has no command port,
 * clock, scheduler, resource database or authority to start work. */
export function createVelaExperience(options: {
  motion: MotionCoordinator;
  root: HTMLElement;
  wake(): void;
  resize(size: { width: number; height: number }): void;
}) {
  const prefix = `vela-experience:${++instances}:`,
    phaseKey = prefix + "phase";
  const entries = new Map<
    string,
    { kind: "message" | "plan"; id: string; key: string }
  >();
  let active = false,
    baseline = false,
    latest: VelaPanelPresentation | null = null;
  const size = () => {
    const feedback = Math.min(
      160,
      [
        ...options.root.querySelectorAll<HTMLElement>(
          ".vela-core-status:not([hidden]),.vela-core-error:not([hidden])",
        ),
      ].reduce((sum, node) => sum + node.getBoundingClientRect().height, 0),
    );
    const composer = Math.max(
      150,
      Math.ceil(
        options.root
          .querySelector<HTMLElement>(".vela-core-compose")
          ?.getBoundingClientRect().height ?? 0,
      ) +
        feedback +
        28,
    );
    if (latest?.context) {
      const context =
        options.root.querySelector<HTMLElement>(".vela-core-contextual")
          ?.scrollHeight ?? 0;
      const history = latest.planIds.length
        ? 180
        : latest.messageIds.length
          ? 120
          : 0;
      return {
        width: 520,
        height:
          context > 0
            ? Math.max(240, Math.min(640, composer + context + history + 36))
            : 580,
      };
    }
    if (latest?.phase === "review" || latest?.phase === "applying")
      return { width: 520, height: 580 };
    if (latest?.messageIds.length)
      return { width: 480, height: Math.max(420, composer + 160) };
    return { width: 440, height: composer };
  };
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (active) options.resize(size());
        });
  function clear() {
    options.motion.bodies.delete(phaseKey);
    for (const entry of entries.values())
      options.motion.bodies.delete(entry.key);
    entries.clear();
    for (const node of options.root.querySelectorAll<HTMLElement>(
      "[data-vela-arrival]",
    )) {
      node.style.removeProperty("opacity");
      node.style.removeProperty("transform");
      delete node.dataset.velaArrival;
    }
  }
  function reconcile() {
    if (!active || !latest) return;
    const target = {
      ...neutral,
      x: energy[latest.phase],
      y: latest.context ? 1 : 0,
    };
    if (!options.motion.bodies.has(phaseKey))
      options.motion.add(phaseKey, target);
    else options.motion.target(phaseKey, target, "observed Vela phase/context");
    // Limit decorative ownership independently of canonical history length.
    const desired = [
      ...latest.messageIds
        .slice(-16)
        .map((id) => ({ kind: "message" as const, id })),
      ...latest.planIds.slice(-8).map((id) => ({ kind: "plan" as const, id })),
    ];
    const retained = new Set(desired.map((item) => item.kind + ":" + item.id));
    for (const [id, entry] of entries)
      if (!retained.has(id)) {
        options.motion.bodies.delete(entry.key);
        entries.delete(id);
      }
    for (const item of desired) {
      const id = item.kind + ":" + item.id;
      if (entries.has(id)) continue;
      const key = prefix + id;
      options.motion.add(
        key,
        baseline ? { ...neutral, opacity: 0, lift: 8 } : neutral,
      );
      if (baseline)
        options.motion.target(key, neutral, "new canonical Vela " + item.kind);
      entries.set(id, { ...item, key });
    }
    baseline = true;
    options.resize(size());
    options.wake();
  }
  return {
    size,
    observe(value: VelaPanelPresentation) {
      latest = {
        ...value,
        messageIds: [...value.messageIds],
        planIds: [...value.planIds],
      };
      reconcile();
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      baseline = false;
      if (active) {
        const composer = options.root.querySelector(".vela-core-compose");
        if (composer) resizeObserver?.observe(composer);
        const context = options.root.querySelector(".vela-core-contextual");
        if (context) resizeObserver?.observe(context);
        for (const feedback of options.root.querySelectorAll(
          ".vela-core-status,.vela-core-error",
        ))
          resizeObserver?.observe(feedback);
        reconcile();
      } else {
        resizeObserver?.disconnect();
        clear();
      }
    },
    frame(policy: Policy) {
      if (!active || !latest || !options.motion.bodies.has(phaseKey)) return;
      const snap =
        policy.reduced ||
        policy.quiet ||
        policy.hidden ||
        !policy.graphicsAvailable;
      if (snap) {
        options.motion.snap(phaseKey);
        for (const entry of entries.values()) options.motion.snap(entry.key);
      }
      const phase = options.motion.pose(phaseKey);
      options.root.style.setProperty("--vela-reveal", "1");
      options.root.style.setProperty(
        "--vela-activity",
        String(Math.max(0, Math.min(1, phase.x))),
      );
      options.root.style.setProperty(
        "--vela-context-reveal",
        String(Math.max(0, Math.min(1, phase.y))),
      );
      options.root.dataset.velaPhase = latest.phase;
      for (const node of options.root.querySelectorAll<HTMLElement>(
        "[data-message-id],[data-plan-id]",
      )) {
        const kind = node.dataset.messageId ? "message" : "plan",
          id = node.dataset.messageId ?? node.dataset.planId;
        const entry = entries.get(kind + ":" + id);
        if (!entry) {
          if (node.dataset.velaArrival) {
            node.style.removeProperty("opacity");
            node.style.removeProperty("transform");
            delete node.dataset.velaArrival;
          }
          continue;
        }
        // A user focusing an arriving action always takes priority over its reveal.
        if (node.contains(node.ownerDocument.activeElement))
          options.motion.snap(entry.key);
        const p = options.motion.pose(entry.key);
        node.dataset.velaArrival = "true";
        node.style.opacity = String(Math.max(0, Math.min(1, p.opacity)));
        node.style.transform = `translate3d(0,${p.lift.toFixed(3)}px,0)`;
      }
    },
    diagnostics() {
      return {
        active,
        phase: latest?.phase ?? "idle",
        context: latest?.context ?? null,
        entries: [...entries.values()].map((e) => ({
          kind: e.kind,
          id: e.id,
          pose: options.motion.pose(e.key),
        })),
        energy: options.motion.bodies.has(phaseKey)
          ? options.motion.pose(phaseKey).x
          : 0,
      };
    },
    dispose() {
      active = false;
      baseline = false;
      latest = null;
      resizeObserver?.disconnect();
      clear();
    },
  };
}
