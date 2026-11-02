import {
  contourPoint,
  defaultSurfaceShape,
  type SurfaceShape,
} from "./surface-contour.ts";

export interface CompositeSurface {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lift: number;
  yaw: number;
  opacity: number;
  rotation?: number;
  zIndex?: number;
  shape?: SurfaceShape;
  kind?: string;
  unfold?: number;
}
interface Polygon {
  points: Float64Array;
  count: number;
}
interface Entry {
  id: string;
  pose: CompositeSurface;
  key: number[];
  shape: SurfaceShape;
  polygon: Polygon;
  left: number;
  top: number;
  right: number;
  bottom: number;
  valid: boolean;
  clipPath: string;
  covered: boolean;
  rank: number;
}
/** Reusable scratch storage, grown only on demand. No per-card render targets. */
class PolygonPool {
  items: Polygon[] = [];
  cursor = 0;
  take() {
    let p = this.items[this.cursor++];
    if (!p) {
      p = { points: new Float64Array(512), count: 0 };
      this.items.push(p);
    }
    p.count = 0;
    return p;
  }
}
const EPSILON = 1e-7;
function area(p: Polygon) {
  let sum = 0;
  for (let i = 0, j = p.count - 1; i < p.count; j = i++)
    sum +=
      p.points[j * 2] * p.points[i * 2 + 1] -
      p.points[i * 2] * p.points[j * 2 + 1];
  return sum * 0.5;
}
function push(p: Polygon, x: number, y: number) {
  if (p.count * 2 + 2 > p.points.length)
    throw new Error("Material clipping polygon capacity exceeded");
  p.points[p.count * 2] = x;
  p.points[p.count * 2 + 1] = y;
  p.count++;
}
/** Half-plane clipping; both outputs partition the input without overlapping holes. */
function split(
  p: Polygon,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  inside: Polygon,
  outside: Polygon,
) {
  if (!p.count) return;
  const dx = bx - ax,
    dy = by - ay;
  let px = p.points[(p.count - 1) * 2],
    py = p.points[(p.count - 1) * 2 + 1];
  let pd = dx * (py - ay) - dy * (px - ax);
  for (let i = 0; i < p.count; i++) {
    const x = p.points[i * 2],
      y = p.points[i * 2 + 1],
      d = dx * (y - ay) - dy * (x - ax);
    if (pd >= 0 !== d >= 0) {
      const t = pd / (pd - d),
        ix = px + (x - px) * t,
        iy = py + (y - py) * t;
      push(inside, ix, iy);
      push(outside, ix, iy);
    }
    push(d >= 0 ? inside : outside, x, y);
    px = x;
    py = y;
    pd = d;
  }
}
function intersects(a: Entry, b: Entry) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
/** Same transform as CSS perspective(1500) translateZ(lift) rotateZ(rotation)
 * rotateY(yaw), and the renderer's surfaceMatrix. No DOM layout reads. */
export function projectSurfacePoint(p: CompositeSurface, x: number, y: number) {
  const yaw = (p.yaw * Math.PI) / 180,
    r = ((p.rotation ?? 0) * Math.PI) / 180;
  const den = 1500 - p.lift + x * Math.sin(yaw),
    s = 1500 / den;
  const xx = x * Math.cos(yaw);
  return {
    x: p.x + p.w * 0.5 + (Math.cos(r) * xx - Math.sin(r) * y) * s,
    y: p.y + p.h * 0.5 + (Math.sin(r) * xx + Math.cos(r) * y) * s,
  };
}
function inversePoint(p: CompositeSurface, x: number, y: number) {
  const yaw = (p.yaw * Math.PI) / 180,
    r = ((p.rotation ?? 0) * Math.PI) / 180;
  const u = x - p.x - p.w * 0.5,
    v = y - p.y - p.h * 0.5;
  const a = Math.cos(r) * u + Math.sin(r) * v,
    b = -Math.sin(r) * u + Math.cos(r) * v;
  const localX =
    (a * (1500 - p.lift)) / (1500 * Math.cos(yaw) - a * Math.sin(yaw));
  return {
    x: localX + p.w * 0.5,
    y: (b * (1500 - p.lift + localX * Math.sin(yaw))) / 1500 + p.h * 0.5,
  };
}
/** The engine supplies z. Selection is deliberately absent from this ordering. */
export function compareSurfaceStack(
  a: Pick<CompositeSurface, "id" | "zIndex">,
  b: Pick<CompositeSurface, "id" | "zIndex">,
) {
  return (
    (a.zIndex ?? 0) - (b.zIndex ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** A frame-local derived projection cache, never an authoritative geometry store.
 * Front silhouettes subtract from REAR DOM paint/hit regions. Glass parameters,
 * full-card opacity, editor identity and canonical placement are never changed.
 * Convex differences produce disjoint paths: overlapping front masks cannot XOR
 * their shared region and accidentally expose a third resource's text. */
export class MaterialCompositor {
  private entries = new Map<string, Entry>();
  readonly ordered: Entry[] = [];
  private pool = new PolygonPool();
  private fragments: Polygon[] = [];
  private next: Polygon[] = [];
  private point = { x: 0, y: 0, nx: 0, ny: 0 };
  private activeIds = new Set<string>();
  private insideA: Polygon = { points: new Float64Array(512), count: 0 };
  private insideB: Polygon = { points: new Float64Array(512), count: 0 };
  private outside: Polygon = { points: new Float64Array(512), count: 0 };
  recomputations = 0;
  update(surfaces: readonly CompositeSurface[]) {
    let changed = this.ordered.length !== surfaces.length;
    this.activeIds.clear();
    this.ordered.length = 0;
    for (const p of surfaces) {
      this.activeIds.add(p.id);
      const shape = p.shape ?? defaultSurfaceShape(p.kind);
      let e = this.entries.get(p.id);
      if (!e) {
        e = {
          id: p.id,
          pose: p,
          key: [],
          shape,
          polygon: { points: new Float64Array(128), count: 0 },
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          valid: false,
          clipPath: "",
          covered: false,
          rank: 0,
        };
        this.entries.set(p.id, e);
        changed = true;
      }
      const values = [
        p.x,
        p.y,
        p.w,
        p.h,
        p.lift,
        p.yaw,
        p.rotation ?? 0,
        p.zIndex ?? 0,
        p.opacity,
        p.unfold ?? 0,
      ];
      let different = shape !== e.shape;
      for (let k = 0; k < values.length; k++)
        if (e.key[k] !== values[k]) different = true;
      if (different) {
        e.key = values;
        e.shape = shape;
        e.pose = p;
        this.project(e);
        changed = true;
      }
      this.ordered.push(e);
    }
    for (const id of this.entries.keys())
      if (!this.activeIds.has(id)) {
        this.entries.delete(id);
        changed = true;
      }
    this.ordered.sort((a, b) => compareSurfaceStack(a.pose, b.pose));
    if (!changed) return this.ordered;
    this.recomputations++;
    for (let i = 0; i < this.ordered.length; i++) {
      const rear = this.ordered[i];
      rear.rank = i;
      rear.covered = false;
      if (!rear.valid) {
        rear.clipPath = "inset(50%)";
        rear.covered = true;
        continue;
      }
      this.pool.cursor = 0;
      this.fragments.length = 0;
      const initial = this.pool.take();
      // Work in screen space; the final fragments are inversely projected into
      // the rear article's local coordinates before its own CSS transform.
      for (let k = 0; k < rear.polygon.count; k++)
        push(
          initial,
          rear.polygon.points[k * 2],
          rear.polygon.points[k * 2 + 1],
        );
      this.fragments.push(initial);
      let clipped = false;
      for (
        let j = this.ordered.length - 1;
        j > i && this.fragments.length;
        j--
      ) {
        const front = this.ordered[j];
        if (
          !front.valid ||
          front.pose.opacity <= 0.05 ||
          !intersects(rear, front)
        )
          continue;
        this.next.length = 0;
        for (const fragment of this.fragments) {
          let outsideEdge = false,
            fullyInside = true;
          for (let edge = 0; edge < front.polygon.count; edge++) {
            const nextEdge = (edge + 1) % front.polygon.count;
            const ax = front.polygon.points[edge * 2],
              ay = front.polygon.points[edge * 2 + 1],
              dx = front.polygon.points[nextEdge * 2] - ax,
              dy = front.polygon.points[nextEdge * 2 + 1] - ay;
            let allOutside = true;
            for (let v = 0; v < fragment.count; v++) {
              const distance =
                dx * (fragment.points[v * 2 + 1] - ay) -
                dy * (fragment.points[v * 2] - ax);
              if (distance >= -EPSILON) allOutside = false;
              if (distance < -EPSILON) fullyInside = false;
            }
            if (allOutside) {
              outsideEdge = true;
              break;
            }
          }
          if (outsideEdge) {
            this.next.push(fragment);
            continue;
          }
          if (fullyInside) {
            clipped = true;
            continue;
          }
          let current = fragment;
          for (let k = 0; k < front.polygon.count && current.count >= 3; k++) {
            const next = (k + 1) % front.polygon.count;
            const inside =
                current === this.insideA ? this.insideB : this.insideA,
              outside = this.outside;
            inside.count = 0;
            outside.count = 0;
            split(
              current,
              front.polygon.points[k * 2],
              front.polygon.points[k * 2 + 1],
              front.polygon.points[next * 2],
              front.polygon.points[next * 2 + 1],
              inside,
              outside,
            );
            if (outside.count >= 3 && Math.abs(area(outside)) > EPSILON) {
              const saved = this.pool.take();
              for (let t = 0; t < outside.count; t++)
                push(saved, outside.points[t * 2], outside.points[t * 2 + 1]);
              this.next.push(saved);
            }
            current = inside;
          }
          if (current.count >= 3 && Math.abs(area(current)) > EPSILON)
            clipped = true;
        }
        const swap = this.fragments;
        this.fragments = this.next;
        this.next = swap;
      }
      if (!clipped) {
        rear.clipPath = "";
        continue;
      }
      rear.covered = this.fragments.length === 0;
      if (rear.covered) {
        rear.clipPath = "inset(50%)";
        continue;
      }
      let path = "";
      for (const poly of this.fragments) {
        for (let k = 0; k < poly.count; k++) {
          const point = inversePoint(
            rear.pose,
            poly.points[k * 2],
            poly.points[k * 2 + 1],
          );
          path +=
            (k ? "L" : "M") + point.x.toFixed(3) + " " + point.y.toFixed(3);
        }
        path += "Z";
      }
      rear.clipPath = `path("${path}")`;
    }
    return this.ordered;
  }
  private project(e: Entry) {
    const p = e.pose;
    e.valid =
      e.key.every(Number.isFinite) &&
      p.w > 0 &&
      p.h > 0 &&
      p.opacity > 0.05 &&
      Math.abs(Math.cos((p.yaw * Math.PI) / 180)) > 0.01;
    e.polygon.count = 0;
    e.left = Infinity;
    e.top = Infinity;
    e.right = -Infinity;
    e.bottom = -Infinity;
    if (!e.valid) return;
    // Circumscribed adaptive outline includes the actual64-sample GPU edge.
    // Rounded corners need16 segments; large lenses use32. This avoids quadratic
    // fragment growth while the radial guard prevents text bleeding at chords.
    const radial = e.shape === "circle" || e.shape === "lens";
    const segments = radial && Math.max(p.w, p.h) > 450 ? 32 : 16;
    const radius = radial
      ? Math.max(p.w, p.h) * 0.5
      : e.shape === "pill"
        ? Math.min(p.w, p.h) * 0.5
        : 22;
    const guard = 4.3 + (radius + 4) * (1 / Math.cos(Math.PI / segments) - 1);
    for (let i = 0; i < segments; i++) {
      const v = contourPoint(
        p.w,
        p.h,
        e.shape,
        p.unfold ?? 0,
        i / segments,
        guard,
        this.point,
      );
      const den = 1500 - p.lift + v.x * Math.sin((p.yaw * Math.PI) / 180);
      if (den <= 0) {
        e.valid = false;
        return;
      }
      const q = projectSurfacePoint(p, v.x, -v.y);
      push(e.polygon, q.x, q.y);
      e.left = Math.min(e.left, q.x);
      e.top = Math.min(e.top, q.y);
      e.right = Math.max(e.right, q.x);
      e.bottom = Math.max(e.bottom, q.y);
    }
    // contourPoint is counterclockwise in Y-up; screen-space flipping reverses it.
    if (area(e.polygon) < 0) {
      for (let a = 0, b = e.polygon.count - 1; a < b; a++, b--) {
        const x = e.polygon.points[a * 2],
          y = e.polygon.points[a * 2 + 1];
        e.polygon.points[a * 2] = e.polygon.points[b * 2];
        e.polygon.points[a * 2 + 1] = e.polygon.points[b * 2 + 1];
        e.polygon.points[b * 2] = x;
        e.polygon.points[b * 2 + 1] = y;
      }
    }
  }
  diagnostics() {
    return {
      surfaces: this.entries.size,
      recomputations: this.recomputations,
      scratchPolygons: this.pool.items.length,
      covered: this.ordered.filter((e) => e.covered).length,
      clipped: this.ordered.filter((e) => !!e.clipPath).length,
    };
  }
}
