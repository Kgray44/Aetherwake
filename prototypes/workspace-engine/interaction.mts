import type { BlockProjection, Presentation, WorkspaceProjection, WorkspacePort, Command, Geometry } from './contracts.mts';
import { presentation, resizeFromHandle, snapValue, type Handle, ensure, reachable, defaults } from './geometry.mts';
import { MotionCoordinator, type Pose } from '../visual-experience/cinematic-v3/src/motion.ts';

export function asPresentation(b: BlockProjection): Presentation {
  return { x: b.x, y: b.y, width: b.width, height: b.height, zIndex: b.zIndex, rotation: b.rotation, shape: b.shape, locked: b.locked, minimized: b.minimized, materialVariant: b.materialVariant };
}
export const pose = (p: Presentation): Pose => ({ x: p.x, y: p.y, w: p.width, h: p.height, yaw: 0, lift: 0, opacity: p.minimized ? 0.8 : 1 });
export type GestureState=Pick<WorkspaceProjection,'blocks'|'viewport'|'workspaceId'|'revision'>;
/** One gesture = one atomic history entry. No pointermove writes or resource edits. */
export class LayoutGesture {
  readonly block: BlockProjection;
  readonly state: GestureState;
  readonly handle: Handle | 'move';
  current: Presentation;
  constructor(state: GestureState, blockId: string, handle: Handle | 'move') {
    const b = state.blocks.find(b => b.blockId === blockId); ensure(b, 'NOT_FOUND'); ensure(!b.locked, 'LOCKED');
    this.state = state; this.block = b; this.handle = handle; this.current = asPresentation(b);
  }
  update(screenDx: number, screenDy: number, grid = 0, keepAspect = false): Presentation {
    const p = asPresentation(this.block), dx = screenDx / this.state.viewport.zoom, dy = screenDy / this.state.viewport.zoom;
    if (this.handle === 'move') this.current = presentation({ x: snapValue(p.x + dx, grid), y: snapValue(p.y + dy, grid) }, p);
    else {
      const angle = -p.rotation * Math.PI / 180;
      this.current = resizeFromHandle(p, this.handle, dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle), keepAspect ? p.width / p.height : undefined, grid);
    }
    return this.current;
  }
  command(commandId: string): Command {
    return { type: 'saveLayout', commandId, workspaceId: this.state.workspaceId, expectedRevision: this.state.revision,
      placements: [{ blockId: this.block.blockId, expectedVersion: this.block.version, presentation: this.current }] };
  }
}
/** Presence uses the same geometry math but keeps its separate system identity. */
export class PresenceGesture {
  readonly state: WorkspaceProjection;
  readonly handle: Handle | 'move';
  readonly bounds?: Geometry;
  current: Geometry;
  constructor(state: WorkspaceProjection, handle: Handle | 'move' = 'move', bounds?: Geometry) {
    ensure(!state.presence.locked, 'LOCKED');
    this.state = state; this.handle = handle; this.bounds = bounds;
    const p = state.presence; this.current = { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  update(screenDx: number, screenDy: number, grid = 0, keepAspect = false): Geometry {
    const p = this.state.presence, dx = screenDx / this.state.viewport.zoom, dy = screenDy / this.state.viewport.zoom;
    const next = this.handle === 'move'
      ? presentation({ x: snapValue(p.x + dx, grid), y: snapValue(p.y + dy, grid), width: p.width, height: p.height })
      : resizeFromHandle({ ...defaults, ...p, shape: 'rectangle', rotation: 0 }, this.handle, dx, dy, keepAspect ? p.width / p.height : undefined, grid);
    this.current = { x: next.x, y: next.y, width: next.width, height: next.height }; return this.current;
  }
  command(commandId: string): Command {
    return { type: 'setPresence', commandId, workspaceId: this.state.workspaceId, expectedRevision: this.state.revision,
      expectedVersion: this.state.presence.version, presentation: this.current, ...(this.bounds ? { bounds: this.bounds } : {}) };
  }
}
/** Uses the same coordinator instance as the host. Keys are block IDs, never resource IDs. */
export class BlockMotionBridge {
  motion: MotionCoordinator;
  private owned = new Set<string>();
  constructor(motion: MotionCoordinator) { this.motion = motion; }
  sync(blocks: BlockProjection[], cause = 'workspace reconciliation') {
    const ids = new Set(blocks.map(b => b.blockId));
    for (const id of this.owned) if (!ids.has(id)) { this.motion.bodies.delete(id); this.owned.delete(id); }
    for (const b of blocks) {
      if (!this.owned.has(b.blockId)) { this.motion.add(b.blockId, pose(b)); this.owned.add(b.blockId); }
      this.motion.target(b.blockId, pose(b), cause);
    }
  }
  preview(blockId: string, p: Presentation) { this.motion.target(blockId, pose(p), 'direct manipulation'); }
  /** Compact shapes unfold into a rectangular reader; canonical geometry stays unchanged. */
  unfold(b: BlockProjection, width: number, height: number) {
    this.motion.target(b.blockId, pose(reachable({ ...b, width: Math.min(720, width), height: Math.min(640, height) }, width, height)), 'open reading surface');
  }
  dispose() { for (const id of this.owned) this.motion.bodies.delete(id); this.owned.clear(); }
}
export type BindingOptions = {
  element: HTMLElement; grip: HTMLElement; handles: Partial<Record<Handle, HTMLElement>>; blockId: string;
  state: () => WorkspaceProjection; port: WorkspacePort; motion: BlockMotionBridge;
  changed: (state: WorkspaceProjection) => void; failed: (error: unknown, attempted?: Command) => void;
  preview?: (p: Presentation | null) => void; grid?: () => number;
};
/** Reusable binding only. Host retains editor nodes, focus, content and rendering. */
export function bindBlock(o: BindingOptions): () => void {
  const abort = new AbortController(), signal = abort.signal;
  let drag: { gesture: LayoutGesture; x: number; y: number; pointerId: number; capture: HTMLElement; selection: string } | null = null;
  let pending = false;
  const read = () => { const b = o.state().blocks.find(b => b.blockId === o.blockId); ensure(b, 'NOT_FOUND'); return b; };
  const reconcile = () => { o.preview?.(null); const b = o.state().blocks.find(b => b.blockId === o.blockId); if (b) o.motion.preview(b.blockId, b); };
  const send = async (command: Command) => {
    pending = true;
    try { o.changed(await o.port.execute(command)); }
    catch (e) { o.failed(e, command); }
    finally { pending = false; reconcile(); }
  };
  const end = (commit: boolean) => {
    const d = drag; if (!d) return; drag = null;
    o.element.ownerDocument.documentElement.style.userSelect = d.selection;
    if (d.capture.hasPointerCapture(d.pointerId)) d.capture.releasePointerCapture(d.pointerId);
    const changed = Object.entries(d.gesture.current).some(([key, value]) => value !== d.gesture.block[key as keyof BlockProjection]);
    if (commit && changed) void send(d.gesture.command(crypto.randomUUID())); else reconcile();
  };
  const bind = (el: HTMLElement, handle: Handle | 'move') => {
    const oldTouch = el.style.touchAction; el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || pending || drag) return;
      try {
        const gesture = new LayoutGesture(o.state(), o.blockId, handle); e.preventDefault();
        drag = { gesture, x: e.clientX, y: e.clientY, pointerId: e.pointerId, capture: el, selection: o.element.ownerDocument.documentElement.style.userSelect };
        o.element.ownerDocument.documentElement.style.userSelect = 'none'; el.setPointerCapture(e.pointerId);
      } catch (e) { o.failed(e); }
    }, { signal });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      try { const p = drag.gesture.update(e.clientX - drag.x, e.clientY - drag.y, o.grid?.() ?? 0, e.shiftKey); o.motion.preview(o.blockId, p); o.preview?.(p); }
      catch (e) { o.failed(e); end(false); }
    }, { signal });
    el.addEventListener('pointerup', e => { if (drag?.pointerId === e.pointerId) end(true); }, { signal });
    el.addEventListener('pointercancel', e => { if (drag?.pointerId === e.pointerId) end(false); }, { signal });
    el.addEventListener('lostpointercapture', () => end(false), { signal });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { end(false); return; }
      if (pending || drag || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (handle === 'move' && !e.altKey) return;
      e.preventDefault();
      try {
        const b = read(); ensure(!b.locked, 'LOCKED'); const amount = e.shiftKey ? 32 : 8;
        const dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
        const dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
        const gesture = new LayoutGesture(o.state(), o.blockId, handle);
        gesture.update(dx * o.state().viewport.zoom, dy * o.state().viewport.zoom, o.grid?.() ?? 0, false);
        void send(gesture.command(crypto.randomUUID()));
      } catch (e) { o.failed(e); }
    }, { signal });
    signal.addEventListener('abort', () => { el.style.touchAction = oldTouch; }, { once: true });
  };
  bind(o.grip, 'move');
  for (const [handle, el] of Object.entries(o.handles)) if (el) bind(el, handle as Handle);
  o.element.ownerDocument.addEventListener('keydown', e => { if (e.key === 'Escape') end(false); }, { signal });
  return () => { end(false); abort.abort(); };
}
