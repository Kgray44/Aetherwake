import type { Geometry, LayoutState, LayoutPreview } from './contracts.mts';
import { footprint, intersects, validateBounds, type CollisionPlacement } from './collisions.mts';
import { ensure, limits, snapValue } from './geometry.mts';

/** World anchored fine grid. Column/span recipes belong to explicit Arrange. */
export const STRUCTURED_GRID_SIZE = 16;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const entries = (state: LayoutState) => [...state.blocks.map(block => ({ ...block, id: block.blockId })), state.presence];
export function structuredGridGuides(bounds: Geometry = { x: 0, y: 0, width: 1280, height: 720 }): LayoutPreview['guides'] {
  validateBounds(bounds);
  const guides: LayoutPreview['guides'] = [];
  for (const axis of ['x', 'y'] as const) {
    const start = Math.ceil(bounds[axis] / STRUCTURED_GRID_SIZE) * STRUCTURED_GRID_SIZE;
    const extent = axis === 'x' ? bounds.width : bounds.height, other = axis === 'x' ? 'y' : 'x';
    for (let index = 0; index < 128 && start + index * STRUCTURED_GRID_SIZE <= bounds[axis] + extent; index++)
      guides.push({ axis, position: start + index * STRUCTURED_GRID_SIZE, from: bounds[other], to: bounds[other] + (other === 'x' ? bounds.width : bounds.height) });
  }
  return guides;
}

function snappedAxis(start: number, size: number, oldStart: number, oldSize: number, minimum: number, maximum: number = limits.maxSize) {
  if (same(size, oldSize)) return { start: same(start, oldStart) ? start : snapValue(start, STRUCTURED_GRID_SIZE), size };
  const end = start + size, oldEnd = oldStart + oldSize, startMoves = !same(start, oldStart), endMoves = !same(end, oldEnd);
  let nextStart = startMoves ? snapValue(start, STRUCTURED_GRID_SIZE) : start;
  const nextEnd = endMoves ? snapValue(end, STRUCTURED_GRID_SIZE) : oldEnd;
  const nextSize = clamp(nextEnd - nextStart, minimum, maximum);
  if (startMoves && !endMoves) nextStart = oldEnd - nextSize;
  return { start: nextStart, size: nextSize };
}

function snapped(p: CollisionPlacement, old: CollisionPlacement, shapeChanged: boolean): CollisionPlacement {
  if (shapeChanged || p.rotation !== old.rotation) return { ...p, x: same(p.x, old.x) ? p.x : snapValue(p.x, STRUCTURED_GRID_SIZE), y: same(p.y, old.y) ? p.y : snapValue(p.y, STRUCTURED_GRID_SIZE) };
  const resizing = !same(p.width, old.width) || !same(p.height, old.height), ratio = old.width / old.height;
  if (resizing && same(p.width / p.height, ratio)) {
    // Preserve circle/aspect constraints and the opposite fixed edges. When an
    // old aspect cannot align both moving edges, the horizontal edge owns snap.
    const horizontal = snappedAxis(p.x, p.width, old.x, old.width, Math.max(limits.minWidth, limits.minHeight * ratio), Math.min(limits.maxSize, limits.maxSize * ratio));
    const height = horizontal.size / ratio, bottomFixed = same(p.y + p.height, old.y + old.height);
    const y = bottomFixed ? old.y + old.height - height : same(p.y, old.y) ? p.y : snapValue(p.y, STRUCTURED_GRID_SIZE);
    return { ...p, x: horizontal.start, y, width: horizontal.size, height };
  }
  const horizontal = snappedAxis(p.x, p.width, old.x, old.width, limits.minWidth), vertical = snappedAxis(p.y, p.height, old.y, old.height, limits.minHeight);
  return { ...p, x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size };
}

/** Move only this target. Existing manual/legacy overlaps are occupied space,
 * never an instruction to normalize or move unrelated cards or Vela. */
export function findVacantGridPlacement(p: CollisionPlacement, anchors: readonly CollisionPlacement[], bounds?: Geometry, gap = 12): CollisionPlacement {
  if (bounds) validateBounds(bounds);
  ensure(Number.isFinite(gap) && gap >= 0 && gap <= 256);
  const box = footprint(p), occupied = anchors.map(footprint), dx = box.x - p.x, dy = box.y - p.y;
  const free = (candidate: Geometry) => !occupied.some(anchor => intersects(candidate, anchor, gap));
  const inside = (candidate: Geometry) => !bounds || candidate.x >= bounds.x && candidate.y >= bounds.y && candidate.x + candidate.width <= bounds.x + bounds.width && candidate.y + candidate.height <= bounds.y + bounds.height;
  if (free(box) && (!p.keepVisible || inside(box))) return { ...p };
  const xs = new Set([p.x, snapValue(p.x, STRUCTURED_GRID_SIZE)]), ys = new Set([p.y, snapValue(p.y, STRUCTURED_GRID_SIZE)]);
  const lower = (value: number) => Math.floor(value / STRUCTURED_GRID_SIZE) * STRUCTURED_GRID_SIZE, upper = (value: number) => Math.ceil(value / STRUCTURED_GRID_SIZE) * STRUCTURED_GRID_SIZE;
  for (const anchor of occupied) {
    xs.add(lower(anchor.x - box.width - gap - dx)); xs.add(upper(anchor.x + anchor.width + gap - dx));
    ys.add(lower(anchor.y - box.height - gap - dy)); ys.add(upper(anchor.y + anchor.height + gap - dy));
  }
  if (bounds) {
    xs.add(upper(bounds.x - dx)); xs.add(lower(bounds.x + bounds.width - box.width - dx));
    ys.add(upper(bounds.y - dy)); ys.add(lower(bounds.y + bounds.height - box.height - dy));
  }
  let best: { item: CollisionPlacement; distance: number; inside: boolean } | undefined;
  for (const x of xs) for (const y of ys) {
    if (Math.abs(x) > limits.coordinate || Math.abs(y) > limits.coordinate) continue;
    const candidate = { ...box, x: x + dx, y: y + dy }; if (!free(candidate)) continue;
    const value = { item: { ...p, x, y }, distance: (x - p.x) ** 2 + (y - p.y) ** 2, inside: inside(candidate) };
    if (!best) { best = value; continue; }
    if (bounds && value.inside !== best.inside) { if (value.inside) best = value; continue; }
    if (value.distance < best.distance || value.distance === best.distance && (y < best.item.y || y === best.item.y && x < best.item.x)) best = value;
  }
  ensure(best, 'LAYOUT_SPACE_EXHAUSTED'); return best.item;
}

export function snapStructuredTargets(state: LayoutState, input: CollisionPlacement[], before: LayoutState | undefined, targetIds: readonly string[], bounds?: Geometry): CollisionPlacement[] {
  const prior = new Map((before ? entries(before) : []).map(item => [item.id, item]));
  const targets = new Set(targetIds), result = new Map(input.map(item => [item.id, { ...item }]));
  const changing = [...targets].filter(id => {
    const item = result.get(id), old = prior.get(id);
    return item && old && !item.locked && (item.x !== old.x || item.y !== old.y || item.width !== old.width || item.height !== old.height || item.rotation !== ('rotation' in old ? old.rotation : undefined));
  });
  // A full-layout gesture payload may include unchanged cards after its active
  // target. Reserve every stationary card before resolving any moved target.
  const active = new Set(changing), anchors = input.filter(item => !active.has(item.id));
  for (const id of changing) {
    const item = result.get(id)!, old = prior.get(id)!;
    const block = state.blocks.find(block => block.blockId === id), previous = before?.blocks.find(block => block.blockId === id);
    const next = snapped(item, old, block?.shape !== previous?.shape);
    const placed = findVacantGridPlacement(next, anchors, bounds, state.organization.gap); result.set(id, placed); anchors.push(placed);
  }
  return input.map(item => result.get(item.id)!);
}
