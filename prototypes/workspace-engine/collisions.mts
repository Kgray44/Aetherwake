import type { Geometry } from './contracts.mts';
import { ensure, limits } from './geometry.mts';

export type CollisionPlacement = Geometry & { id: string; rotation?: number; locked: boolean; keepVisible?: boolean };
export const collisionGap = 12;
const epsilon = 1e-7;
const byId = (a: CollisionPlacement, b: CollisionPlacement) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** Conservative rotated reading footprint. Optical decoration outside it is host-owned. */
export function footprint(p: CollisionPlacement): Geometry {
  const angle = (p.rotation ?? 0) * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const width = p.width * c + p.height * s, height = p.width * s + p.height * c;
  return { x: p.x + (p.width - width) / 2, y: p.y + (p.height - height) / 2, width, height };
}
export function intersects(a: Geometry, b: Geometry, gap = collisionGap): boolean {
  return a.x < b.x + b.width + gap - epsilon && a.x + a.width + gap > b.x + epsilon
    && a.y < b.y + b.height + gap - epsilon && a.y + a.height + gap > b.y + epsilon;
}
const fits = (p: Geometry, bounds: Geometry) => p.x >= bounds.x - epsilon && p.y >= bounds.y - epsilon
  && p.x + p.width <= bounds.x + bounds.width + epsilon && p.y + p.height <= bounds.y + bounds.height + epsilon;
export function validateBounds(bounds: Geometry) {
  ensure(bounds && Object.values(bounds).every(Number.isFinite));
  ensure(Math.abs(bounds.x) <= limits.coordinate && Math.abs(bounds.y) <= limits.coordinate && bounds.width > 0 && bounds.height > 0
    && bounds.width <= limits.coordinate * 2 && bounds.height <= limits.coordinate * 2);
}
/** Exact nearest candidate for axis-aligned reading footprints. If a finite viewport
 * cannot fit it, retain dimensions and search pannable overflow. No random reflow. */
function nearest(p: CollisionPlacement, occupied: Geometry[], bounds: Geometry | undefined, gap: number, protectedFootprints: Geometry[] = []): CollisionPlacement {
  const box = footprint(p), dx = box.x - p.x, dy = box.y - p.y;
  const free = (b: Geometry) => !occupied.some(other => intersects(b, other, gap));
  if (free(box) && (!bounds || fits(box, bounds))) return { ...p };
  const xs = new Set([box.x]), ys = new Set([box.y]);
  for (const b of occupied) {
    xs.add(b.x - box.width - gap); xs.add(b.x + b.width + gap);
    ys.add(b.y - box.height - gap); ys.add(b.y + b.height + gap);
  }
  if (bounds) {
    xs.add(bounds.x); xs.add(bounds.x + bounds.width - box.width);
    ys.add(bounds.y); ys.add(bounds.y + bounds.height - box.height);
  }
  for (const b of protectedFootprints) {
    xs.add(b.x - box.width - gap); xs.add(b.x + b.width + gap);
    ys.add(b.y - box.height - gap); ys.add(b.y + b.height + gap);
  }
  const candidates: { x: number; y: number; distance: number; inside: boolean; disruption: number }[] = [];
  for (const x of xs) for (const y of ys) {
    if (Math.abs(x - dx) > limits.coordinate || Math.abs(y - dy) > limits.coordinate) continue;
    const b = { ...box, x, y };
    candidates.push({ x, y, distance: (x - box.x) ** 2 + (y - box.y) ** 2, inside: !bounds || fits(b, bounds), disruption: protectedFootprints.filter(other => intersects(b, other, gap)).length });
  }
  candidates.sort((a, b) => a.disruption - b.disruption || Number(b.inside) - Number(a.inside) || a.distance - b.distance || a.y - b.y || a.x - b.x);
  const result = candidates.find(c => free({ ...box, x: c.x, y: c.y }));
  ensure(result, 'LAYOUT_SPACE_EXHAUSTED');
  return { ...p, x: result.x - dx, y: result.y - dy };
}
/** Fixed anchors first, explicit drop targets next, then stable existing placements.
 * Noncolliding neighbors keep their exact manual positions, including pannable ones. */
export function resolveCollisions(placements: CollisionPlacement[], targetIds: string[] = [], bounds?: Geometry, options: { gap?: number; yieldVisible?: boolean; protectNeighbors?: boolean } = {}): CollisionPlacement[] {
  if (bounds) validateBounds(bounds);
  const gap = options.gap ?? collisionGap; ensure(Number.isFinite(gap) && gap >= 0 && gap <= 256);
  const ids = new Set<string>();
  for (const p of placements) {
    ensure(p && typeof p.id === 'string' && !ids.has(p.id), 'DUPLICATE_ID'); ids.add(p.id);
    ensure([p.x, p.y, p.width, p.height, p.rotation ?? 0].every(Number.isFinite) && p.width > 0 && p.height > 0 && typeof p.locked === 'boolean');
  }
  const locked = placements.filter(p => p.locked).toSorted(byId), occupied: Geometry[] = [];
  const result = new Map<string, CollisionPlacement>();
  for (const p of locked) {
    const b = footprint(p); ensure(!occupied.some(other => intersects(b, other, gap)), 'LOCKED_COLLISION');
    result.set(p.id, { ...p }); occupied.push(b);
  }
  const priorities = new Map([...new Set(targetIds)].map((id, i) => [id, i]));
  const priority = (p: CollisionPlacement) => bounds && p.keepVisible ? options.yieldVisible ? priorities.get(p.id) ?? priorities.size : -1 : priorities.get(p.id) ?? Infinity;
  const movable = placements.filter(p => !p.locked).toSorted((a, b) => priority(a) - priority(b) || byId(a, b));
  for (const [index, p] of movable.entries()) {
    const original = footprint(p);
    const protectedFootprints = options.protectNeighbors ? movable.slice(index + 1).map(footprint) : [];
    const next = !priorities.has(p.id) && !(bounds && p.keepVisible) && !occupied.some(other => intersects(original, other, gap)) ? { ...p } : nearest(p, occupied, bounds, gap, protectedFootprints);
    result.set(p.id, next); occupied.push(footprint(next));
  }
  if (bounds && options.yieldVisible && placements.some(p => p.keepVisible && !p.locked && p.width <= bounds.width && p.height <= bounds.height && !fits(footprint(result.get(p.id)!), bounds)))
    return resolveCollisions(placements, targetIds, bounds, { ...options, yieldVisible: false });
  return placements.map(p => result.get(p.id)!);
}
