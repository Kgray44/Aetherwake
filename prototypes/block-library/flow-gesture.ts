export type FlowCamera = { x: number; y: number; zoom: number };
/** Local presentation gestures only. The caller owns geometry and the shared frame loop. */
export function mountFlowGestures(viewport: HTMLElement, options: {
  enabled(): boolean; read(): FlowCamera; write(value: FlowCamera): void;
}) {
  let drag: { id: number; clientX: number; clientY: number; before: FlowCamera } | null = null;
  const release = () => {
    const previous = drag; drag = null; delete viewport.dataset.dragging;
    if (previous) try { viewport.releasePointerCapture?.(previous.id); } catch { /* Capture may already be lost. */ }
  };
  const cancel = () => { const before = drag?.before; release(); if (before) options.write(before); };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!options.enabled()) { cancel(); return; }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    options.write({ ...drag.before, x: drag.before.x + event.clientX - drag.clientX, y: drag.before.y + event.clientY - drag.clientY });
    event.preventDefault(); event.stopPropagation();
  };
  const down = (event: PointerEvent) => {
    if (!options.enabled() || drag || event.button !== 0 || event.isPrimary === false || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const target = event.target as Element | null;
    if (['button', 'input', 'select', 'a', 'summary', 'details', '[data-no-pan]'].some(selector => { const interactive = target?.closest?.(selector); return interactive && viewport.contains(interactive); })) return;
    viewport.focus({ preventScroll: true });
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, before: { ...options.read() } };
    try { viewport.setPointerCapture?.(event.pointerId); } catch { drag = null; return; }
    viewport.dataset.dragging = 'true'; event.preventDefault(); event.stopPropagation();
  };
  const up = (event: PointerEvent) => { if (!drag || event.pointerId !== drag.id) return; move(event); release(); };
  const interrupted = (event: PointerEvent) => { if (drag?.id === event.pointerId) cancel(); };
  const wheel = (event: WheelEvent) => {
    if (!options.enabled() || !Number.isFinite(event.deltaY) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    cancel();
    const rect = viewport.getBoundingClientRect(), before = options.read(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, rect.height) : 1;
    const delta = Math.max(-2400, Math.min(2400, event.deltaY * units));
    const zoom = Math.max(.3, Math.min(2, before.zoom * Math.exp(-delta / 500)));
    options.write({ x: x - (x - before.x) * zoom / before.zoom, y: y - (y - before.y) * zoom / before.zoom, zoom });
    event.preventDefault(); event.stopPropagation();
  };
  const bindings = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', interrupted], ['lostpointercapture', interrupted], ['wheel', wheel]] as const;
  for (const [name, listener] of bindings) viewport.addEventListener(name, listener as EventListener, { passive: false });
  return {
    cancel,
    keydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !drag) return false;
      cancel(); event.preventDefault(); event.stopPropagation(); return true;
    },
    dispose() { cancel(); for (const [name, listener] of bindings) viewport.removeEventListener(name, listener as EventListener); },
  };
}
export function flowOptions(panel: HTMLElement) {
  const menu = document.createElement('details'), summary = document.createElement('summary');
  menu.className = 'aw-flow-options'; panel.classList.add('aw-flow-options-panel');
  summary.dataset.aerynthMotionControl = 'true'; summary.textContent = '⋯'; summary.setAttribute('aria-label', 'Flow options'); summary.title = 'Flow navigation options';
  menu.append(summary, panel); return menu;
}
