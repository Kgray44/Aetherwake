export type Pose = {
  x: number;
  y: number;
  w: number;
  h: number;
  lift: number;
  yaw: number;
  opacity: number;
};
export type Channel = { value: number; target: number; velocity: number };
export const channels = ["x", "y", "w", "h", "lift", "yaw", "opacity"] as const;
export const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x));

/** Exact critically damped spring; retargeting preserves position and velocity. */
export function advance(c: Channel, seconds: number, frequency = 13): void {
  const t = clamp(seconds, 0, 0.12);
  advanceWithDecay(c, t, frequency, Math.exp(-frequency * t));
}

function advanceWithDecay(c: Channel, t: number, frequency: number, decay: number) {
  const offset = c.value - c.target;
  const j = c.velocity + frequency * offset;
  c.value = c.target + (offset + j * t) * decay;
  c.velocity = (c.velocity - frequency * j * t) * decay;
  if (Math.abs(c.value - c.target) < 0.015 && Math.abs(c.velocity) < 0.05) {
    c.value = c.target;
    c.velocity = 0;
  }
}
export type Receipt = {
  transition: number;
  resource: string;
  cause: string;
  status: "started" | "retargeted" | "settled" | "cancelled";
  at: number;
};
type Body = {
  channels: Record<keyof Pose, Channel>;
  transitioning: boolean;
  transition: number;
};
export class MotionCoordinator {
  bodies = new Map<string, Body>();
  receipts: Receipt[] = [];
  reduced = false;
  serial = 0;
  add(id: string, pose: Pose) {
    if (this.bodies.has(id)) throw new Error("Duplicate visual identity");
    this.bodies.set(id, {
      channels: Object.fromEntries(
        channels.map((k) => [
          k,
          { value: pose[k], target: pose[k], velocity: 0 },
        ]),
      ) as Body["channels"],
      transitioning: false,
      transition: 0,
    });
  }
  record(
    resource: string,
    cause: string,
    status: Receipt["status"],
    transition: number,
  ) {
    this.receipts.push({
      resource,
      cause,
      status,
      transition,
      at: performance.now(),
    });
    if (this.receipts.length > 256) this.receipts.shift();
  }
  target(id: string, pose: Pose, cause: string, force = false) {
    const b = this.bodies.get(id);
    if (!b) throw new Error("Unknown resource");
    if (!force && channels.every((k) => b.channels[k].target === pose[k]))
      return;
    const was = b.transitioning;
    b.transition = ++this.serial;
    b.transitioning = true;
    for (const k of channels) b.channels[k].target = pose[k];
    this.record(id, cause, was ? "retargeted" : "started", b.transition);
    if (this.reduced) this.snap(id);
  }
  snap(id: string) {
    const b = this.bodies.get(id)!;
    for (const key of channels) {
      const c = b.channels[key];
      c.value = c.target;
      c.velocity = 0;
    }
    if (b.transitioning)
      this.record(id, "reconciliation", "settled", b.transition);
    b.transitioning = false;
  }
  cancel(id: string, destination: Pose) {
    const b = this.bodies.get(id)!;
    this.record(id, "cancel", "cancelled", b.transition);
    b.transitioning = false;
    this.target(id, destination, "cancel reconciliation", true);
  }
  step(dt: number): boolean {
    let active = false;
    const t = clamp(dt, 0, 0.12);
    const decay = Math.exp(-13 * t);
    for (const [id, b] of this.bodies) {
      if (this.reduced) {
        this.snap(id);
        active ||= channels.some((key) => {
          const c = b.channels[key];
          return c.value !== c.target;
        });
        continue;
      }
      let moving = false;
      for (const key of channels) {
        const c = b.channels[key];
        advanceWithDecay(c, t, 13, decay);
        if (c.value !== c.target || c.velocity !== 0) moving = true;
      }
      if (!moving && b.transitioning) {
        this.record(id, "reconciliation", "settled", b.transition);
        b.transitioning = false;
      }
      active ||= moving;
    }
    return active;
  }
  pose(id: string): Pose {
    const { x, y, w, h, lift, yaw, opacity } = this.bodies.get(id)!.channels;
    return {
      x: x.value,
      y: y.value,
      w: w.value,
      h: h.value,
      lift: lift.value,
      yaw: yaw.value,
      opacity: opacity.value,
    };
  }
}

/** Canonical layout references IDs; visual slots never own document contents. */
export function reorder(
  ids: string[],
  id: string,
  destination: number,
): string[] {
  if (!ids.includes(id)) throw new Error("Unknown resource");
  const next = ids.filter((x) => x !== id);
  next.splice(clamp(destination, 0, next.length), 0, id);
  return next;
}
export function slotPose(slot: number, width: number, height: number): Pose {
  const compact = width < 1000;
  const usable = Math.max(260, width - 64);
  if (compact) {
    const w = Math.min(usable - 18, 560),
      h = clamp((height - 310) / 3, 105, 175);
    return {
      x: 32 + (slot % 2) * 18,
      y: 155 + slot * (h + 14),
      w,
      h,
      lift: slot === 0 ? 12 : 0,
      yaw: 0,
      opacity: 1,
    };
  }
  const scale = clamp(width / 1500, 0.7, 1.5);
  const poses = [
    {
      x: width * 0.065,
      y: height * 0.37,
      w: 410 * scale,
      h: 255 * scale,
      lift: 16,
      yaw: -5,
      opacity: 1,
    },
    {
      x: width * 0.6,
      y: height * 0.56,
      w: 355 * scale,
      h: 225 * scale,
      lift: 0,
      yaw: 7,
      opacity: 1,
    },
    {
      x: width * 0.34,
      y: height * 0.72,
      w: 340 * scale,
      h: 175 * scale,
      lift: 0,
      yaw: -2,
      opacity: 1,
    },
  ];
  const p = poses[slot % 3];
  p.y = Math.min(p.y, height - p.h - 150);
  return p;
}
