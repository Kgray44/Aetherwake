import { shapes, type Presentation, type Geometry, type Preset } from './contracts.mts';
export class WorkspaceError extends Error {
  code: string;
  constructor(code: string, message = code) { super(message); this.name = 'WorkspaceError'; this.code = code; }
}
export function ensure(value: unknown, code = 'INVALID'): asserts value { if (!value) throw new WorkspaceError(code); }
export const limits = { minWidth: 128, minHeight: 96, maxSize: 4096, coordinate: 1_000_000 } as const;
export const defaults: Presentation = { x: 32, y: 32, width: 320, height: 240, zIndex: 0, shape: 'rounded', rotation: 0, minimized: false, locked: false, materialVariant: 'default' };
export const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function presentation(patch: Partial<Presentation>, base = defaults): Presentation {
  ensure(patch && typeof patch === 'object' && !Array.isArray(patch));
  ensure(Object.keys(patch).every(k => Object.hasOwn(defaults, k)));
  const p = { ...base, ...patch };
  ensure([p.x, p.y, p.width, p.height, p.rotation, p.zIndex].every(finite));
  ensure(Math.abs(p.x) <= limits.coordinate && Math.abs(p.y) <= limits.coordinate);
  ensure(p.width > 0 && p.height > 0 && p.width <= limits.maxSize && p.height <= limits.maxSize);
  ensure(shapes.includes(p.shape) && Number.isInteger(p.zIndex) && Math.abs(p.zIndex) <= limits.coordinate);
  ensure(Math.abs(p.rotation) <= 360 && typeof p.locked === 'boolean' && typeof p.minimized === 'boolean');
  ensure(typeof p.materialVariant === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.materialVariant));
  p.width = Math.max(limits.minWidth, p.width); p.height = Math.max(limits.minHeight, p.height);
  if (p.shape === 'circle') p.height = p.width;
  return p;
}
export function snapValue(n: number, grid = 0) {
  ensure(finite(n) && finite(grid) && grid >= 0 && grid <= 1024);
  return grid ? Math.round(n / grid) * grid : n;
}
export function resize(p: Presentation, width: number, height: number, aspectRatio?: number, grid = 0): Presentation {
  ensure(finite(width) && finite(height) && width > 0 && height > 0);
  ensure(aspectRatio === undefined || (finite(aspectRatio) && aspectRatio >= 0.1 && aspectRatio <= 10));
  let w = clamp(snapValue(width, grid), limits.minWidth, limits.maxSize);
  let h = clamp(snapValue(height, grid), limits.minHeight, limits.maxSize);
  const ratio = p.shape === 'circle' ? 1 : aspectRatio;
  if (ratio) {
    w = clamp(w, Math.max(limits.minWidth, limits.minHeight * ratio), Math.min(limits.maxSize, limits.maxSize * ratio));
    h = w / ratio;
  }
  return presentation({ width: w, height: h }, p);
}
/** Window changes affect only the reachable view. Canonical manual positions never reflow. */
export function reachable<T extends Geometry>(p: T, width: number, height: number): T {
  ensure(finite(width) && finite(height) && width > 0 && height > 0);
  return { ...p, x: clamp(p.x, 0, Math.max(0, width - p.width)), y: clamp(p.y, 0, Math.max(0, height - p.height)) };
}
export function presetGeometry(preset: Preset, blocks: Presentation[], width: number, height: number): Presentation[] {
  ensure(['freeform', 'focus', 'columns', 'research', 'development'].includes(preset));
  ensure(finite(width) && finite(height) && width >= 128 && height >= 96);
  if (preset === 'freeform') return blocks.map(p => ({ ...p }));
  const cols = preset === 'columns' ? Math.max(1, Math.floor(width / 340)) : 3;
  return blocks.map((p, i) => {
    if (p.locked) return { ...p };
    const focus = preset === 'focus' && i === 0;
    const w = clamp(focus ? width * 0.6 - 32 : preset === 'focus' ? width * 0.4 - 48 : (width - 48) / cols - 16, 128, 900);
    const h = clamp(focus ? height - 64 : preset === 'development' ? 320 : 240, 96, 900);
    const x = preset === 'focus' ? focus ? 24 : width * 0.6 : 24 + (i % cols) * (w + 16);
    const y = preset === 'focus' ? focus ? 24 : 24 + (i - 1) * (h + 16) : 24 + Math.floor(i / cols) * (h + 16);
    return presentation({ x, y, width: w, height: h }, p);
  });
}
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
/** Opposite edge remains anchored when a west/north handle reaches its bounds. */
export function resizeFromHandle(p: Presentation, handle: Handle, dx: number, dy: number, ratio?: number, grid = 0): Presentation {
  ensure(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(handle) && finite(dx) && finite(dy));
  const west = handle.includes('w'), north = handle.includes('n');
  const rawW = p.width + (west ? -dx : handle.includes('e') ? dx : 0);
  const rawH = p.height + (north ? -dy : handle.includes('s') ? dy : 0);
  const effectiveRatio = p.shape === 'circle' ? 1 : ratio;
  const w = effectiveRatio && !/[ew]/.test(handle) ? Math.max(1, rawH) * effectiveRatio : Math.max(1, rawW);
  const next = resize(p, w, Math.max(1, rawH), effectiveRatio, grid);
  const cx = (next.width - p.width) / 2 * (west ? -1 : 1), cy = (next.height - p.height) / 2 * (north ? -1 : 1);
  const angle = p.rotation * Math.PI / 180;
  return presentation({ ...next,
    x: p.x + p.width / 2 + cx * Math.cos(angle) - cy * Math.sin(angle) - next.width / 2,
    y: p.y + p.height / 2 + cx * Math.sin(angle) + cy * Math.cos(angle) - next.height / 2,
  });
}
export function hitTest(p: Presentation, x: number, y: number): boolean {
  const angle = -p.rotation * Math.PI / 180;
  const dx = x - p.x - p.width / 2, dy = y - p.y - p.height / 2;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle), ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  if (p.shape === 'circle' || p.shape === 'lens') return (lx / (p.width / 2)) ** 2 + (ly / (p.height / 2)) ** 2 <= 1;
  return Math.abs(lx) <= p.width / 2 && Math.abs(ly) <= p.height / 2;
}
