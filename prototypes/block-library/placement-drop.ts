import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export type LibraryDropOptions = {
  motion: ExperienceMotionPort;
  viewId: string;
  /** The host rejects points outside the workspace and converts eligible points to world coordinates. */
  point(clientX: number, clientY: number): { x: number; y: number } | null;
};

type DropSource = {
  label: string;
  place(point: { x: number; y: number }): void;
};

/** An optional pointer shortcut to the same typed placement actions as click.
 * The carried preview has one borrowed motion key and never writes layout. */
export function mountLibraryDrop(root: HTMLElement, options: LibraryDropOptions, revision: () => number, failed: (error: unknown) => void) {
  const document = root.ownerDocument;
  const abort = new AbortController();
  const { signal } = abort;
  const sources = new WeakMap<HTMLButtonElement, DropSource>();
  const key = 'library-placement:' + options.viewId;
  let grab: { button: HTMLButtonElement; source: DropSource; pointerId: number; x: number; y: number; revision: number } | null = null;
  let ghost: HTMLElement | null = null;
  let suppressClick: HTMLButtonElement | null = null;
  const pose = (x: number, y: number): ExperiencePose => ({ x: x - 78, y: y - 22, w: 156, h: 44, lift: 0, yaw: 0, opacity: 1 });

  function release() {
    const current = grab;
    grab = null;
    if (current?.button.hasPointerCapture(current.pointerId)) current.button.releasePointerCapture(current.pointerId);
    if (ghost) {
      ghost.remove();
      ghost = null;
      options.motion.remove(key);
      options.motion.wake();
    }
  }

  function update(event: PointerEvent) {
    if (!grab || grab.pointerId !== event.pointerId) return;
    if (!ghost && Math.hypot(event.clientX - grab.x, event.clientY - grab.y) < 5) return;
    event.preventDefault();
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'aw-library__carried';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = grab.source.label;
      document.body.append(ghost);
      options.motion.add(key, pose(grab.x, grab.y));
    }
    try { ghost.dataset.dropAllowed = String(!!options.point(event.clientX, event.clientY)); }
    catch (error) { suppressClick = grab.button; release(); failed(error); return; }
    options.motion.target(key, pose(event.clientX, event.clientY), 'Block Library placement');
    options.motion.wake();
  }

  root.addEventListener('pointerdown', event => {
    suppressClick = null;
    if (event.button !== 0 || grab || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button');
    const source = button && sources.get(button);
    if (!button || button.disabled || !source) return;
    try {
      grab = { button, source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, revision: revision() };
      button.setPointerCapture(event.pointerId);
    } catch (error) { release(); failed(error); }
  }, { signal });
  root.addEventListener('pointermove', update, { signal });
  root.addEventListener('pointerup', event => {
    const current = grab;
    if (!current || current.pointerId !== event.pointerId) return;
    const carried = !!ghost || Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 5;
    release();
    if (!carried) return;
    suppressClick = current.button;
    event.preventDefault();
    try {
      if (!current.button.isConnected || current.button.disabled) return;
      const point = options.point(event.clientX, event.clientY);
      if (!point) return;
      if (revision() !== current.revision) throw new Error('layout_version_conflict');
      current.source.place(point);
    } catch (error) { failed(error); }
  }, { signal });
  root.addEventListener('click', event => {
    if (suppressClick && event.target instanceof Element && suppressClick.contains(event.target)) {
      suppressClick = null;
      event.preventDefault();
      event.stopPropagation();
    }
  }, { capture: true, signal });
  for (const type of ['lostpointercapture', 'pointercancel'] as const) {
    root.addEventListener(type, event => { if (grab?.pointerId === event.pointerId) release(); }, { signal });
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !grab) return;
    suppressClick = grab.button;
    release();
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); }, { signal });
  return {
    bind(button: HTMLButtonElement, source: DropSource) {
      sources.set(button, source);
      button.dataset.libraryGrab = 'true';
    },
    frame() {
      if (!ghost) return;
      const value = options.motion.pose(key);
      ghost.style.transform = `translate(${value.x}px, ${value.y}px)`;
      ghost.style.opacity = String(value.opacity);
    },
    dispose() { release(); abort.abort(); },
  };
}
