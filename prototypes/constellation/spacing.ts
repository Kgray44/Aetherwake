import type { Vector3 } from "./spatial-types.ts";
import { BODY_GAP } from "./body-metrics.ts";
import { hash } from "./identity.ts";

export type SpaceBody = { key: string; point: Vector3; radius: number };
const cell = 256,
  epsilon = 0.04;
const rounded = (p: Vector3): Vector3 => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
  z: Math.round(p.z * 1000) / 1000,
});
const valid = (p: Vector3) =>
  [p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 1e7);

/** Bounded spatial broad phase. Presentation metadata only; no domain ownership. */
export class BodySpace {
  readonly bodies = new Map<string, SpaceBody>();
  private buckets = new Map<string, Set<string>>();
  private cells(a: Vector3, b: Vector3, r: number) {
    const low = [
        Math.floor((Math.min(a.x, b.x) - r) / cell),
        Math.floor((Math.min(a.y, b.y) - r) / cell),
        Math.floor((Math.min(a.z, b.z) - r) / cell),
      ],
      high = [
        Math.floor((Math.max(a.x, b.x) + r) / cell),
        Math.floor((Math.max(a.y, b.y) + r) / cell),
        Math.floor((Math.max(a.z, b.z) + r) / cell),
      ];
    if (
      (high[0] - low[0] + 1) * (high[1] - low[1] + 1) * (high[2] - low[2] + 1) >
      4096
    )
      return null;
    const result: string[] = [];
    for (let x = low[0]; x <= high[0]; x++)
      for (let y = low[1]; y <= high[1]; y++)
        for (let z = low[2]; z <= high[2]; z++) result.push(`${x}:${y}:${z}`);
    return result;
  }
  clear() {
    this.bodies.clear();
    this.buckets.clear();
  }
  remove(key: string) {
    const old = this.bodies.get(key);
    if (!old) return;
    for (const c of this.cells(old.point, old.point, old.radius) ?? []) {
      const list = this.buckets.get(c);
      list?.delete(key);
      if (!list?.size) this.buckets.delete(c);
    }
    this.bodies.delete(key);
  }
  set(body: SpaceBody) {
    this.remove(body.key);
    const entry = { ...body, point: { ...body.point } };
    this.bodies.set(body.key, entry);
    for (const c of this.cells(entry.point, entry.point, entry.radius) ?? []) {
      const list = this.buckets.get(c) ?? new Set<string>();
      list.add(entry.key);
      this.buckets.set(c, list);
    }
  }
  private near(a: Vector3, b: Vector3, r: number, ignore: ReadonlySet<string>) {
    const cells = this.cells(a, b, r + BODY_GAP + epsilon);
    if (!cells)
      return [...this.bodies.values()].filter((e) => !ignore.has(e.key));
    const found = new Set<string>();
    for (const c of cells)
      for (const key of this.buckets.get(c) ?? [])
        if (!ignore.has(key)) found.add(key);
    return [...found].map((key) => this.bodies.get(key)!);
  }
  free(
    key: string,
    point: Vector3,
    radius: number,
    ignore: ReadonlySet<string> = new Set([key]),
  ) {
    if (!valid(point)) return false;
    return this.near(point, point, radius, ignore).every((other) => {
      const d =
        (point.x - other.point.x) ** 2 +
        (point.y - other.point.y) ** 2 +
        (point.z - other.point.z) ** 2;
      return d >= (radius + other.radius + BODY_GAP + 0.002) ** 2;
    });
  }
  find(key: string, preferred: Vector3, radius: number) {
    let point = rounded(preferred);
    if (this.free(key, point, radius)) return point;
    const step = Math.max(32, radius * 0.7 + BODY_GAP);
    for (let i = 0; i < 384; i++) {
      const y = hash(key + ":height:" + i) * 2 - 1,
        angle = hash(key + ":scatter") * Math.PI * 2 + i * 2.399963229728653,
        r = step * (1 + Math.floor(i / 24)),
        flat = Math.sqrt(1 - y * y);
      point = rounded({
        x: preferred.x + Math.cos(angle) * flat * r,
        y: preferred.y + y * r,
        z: preferred.z + Math.sin(angle) * flat * r,
      });
      if (this.free(key, point, radius)) return point;
    }
    const extent = {
      xMin: preferred.x,
      xMax: preferred.x,
      yMin: preferred.y,
      yMax: preferred.y,
      zMin: preferred.z,
      zMax: preferred.z,
    };
    for (const b of this.bodies.values())
      for (const axis of ["x", "y", "z"] as const) {
        extent[`${axis}Min`] = Math.min(
          extent[`${axis}Min`],
          b.point[axis] - b.radius,
        );
        extent[`${axis}Max`] = Math.max(
          extent[`${axis}Max`],
          b.point[axis] + b.radius,
        );
      }
    for (const axis of ["x", "y", "z"] as const)
      for (const sign of [-1, 1]) {
        point = rounded({
          ...preferred,
          [axis]:
            extent[`${axis}${sign < 0 ? "Min" : "Max"}`] +
            sign * (radius + BODY_GAP + 1),
        });
        if (this.free(key, point, radius)) return point;
      }
    throw Error("No clear position is available in this area.");
  }
  /** Sweep a rigid unpinned cluster; stop before any fixed body, including pins. */
  fraction(moving: SpaceBody[], delta: Vector3) {
    const ignore = new Set(moving.map((b) => b.key)),
      a = delta.x ** 2 + delta.y ** 2 + delta.z ** 2;
    if (a < 1e-12) return 1;
    let fraction = 1;
    for (const body of moving) {
      const to = {
        x: body.point.x + delta.x,
        y: body.point.y + delta.y,
        z: body.point.z + delta.z,
      };
      for (const other of this.near(body.point, to, body.radius, ignore)) {
        const x = body.point.x - other.point.x,
          y = body.point.y - other.point.y,
          z = body.point.z - other.point.z,
          b = x * delta.x + y * delta.y + z * delta.z,
          c =
            x * x +
            y * y +
            z * z -
            (body.radius + other.radius + BODY_GAP + epsilon) ** 2;
        if (c <= 0) {
          if (b < 0) fraction = 0;
          continue;
        }
        const discriminant = b * b - a * c;
        if (discriminant < 0) continue;
        const at = (-b - Math.sqrt(discriminant)) / a;
        if (at >= 0 && at <= fraction) fraction = Math.max(0, at - 1e-5);
      }
    }
    return fraction;
  }
}
