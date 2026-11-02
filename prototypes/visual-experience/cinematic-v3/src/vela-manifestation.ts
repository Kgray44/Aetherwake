import type { VelaPanelManifestation } from "../../../vela-core/src/panel.ts";
import { manifestationGeometry, type ManifestationBridgeGeometry, type ManifestationRect } from "../../../vela-core/src/manifestation-geometry.ts";
import type { Policy } from "../../../constellation/types.ts";
import type { MotionCoordinator } from "./motion.ts";

export interface VelaManifestationOptions {
  motion: MotionCoordinator;
  /** Existing real contextual content host, never a replacement editor/surface. */
  root: HTMLElement;
  wake(): void;
  resize(size: { width: number; height: number }): void;
}
const neutral = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const valid = (rect: ManifestationRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
let sequence = 0;

/** Observational host adapter. Only its SVG is animated; ready content is never
 * faded, hidden, transformed or delayed. Caller owns the sole existing frame loop. */
export function createVelaManifestation(options: VelaManifestationOptions) {
  const doc = options.root.ownerDocument, view = doc.defaultView;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg"), ribbon = doc.createElementNS("http://www.w3.org/2000/svg", "path"), spine = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.classList.add("vela-manifestation-bridge"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("hidden", "");
  svg.style.cssText = "position:fixed;z-index:999999;pointer-events:none;margin:0;overflow:hidden";
  spine.classList.add("vela-manifestation-bridge-line"); svg.append(ribbon, spine); doc.body.append(svg);
  const key = "vela-manifestation:" + ++sequence;
  let latest: VelaPanelManifestation | null = null, closing = false, disposed = false, dirty = false;
  let geometry: ManifestationBridgeGeometry | null = null, lastInputs: { actualVelaRect: ManifestationRect; hostRect: ManifestationRect; viewport: { width: number; height: number } } | null = null;
  let wanted = { width: 360, height: 150 }, applied = "", painted = "";
  let policy: Policy = { tier: "balanced", reduced: false, quiet: false, hidden: false, graphicsAvailable: true };
  let measurements = 0, resizes = 0, resizeFailures = 0, submissions = 0, rejectedGeometry = 0;
  const wake = () => { try { options.wake(); } catch { /* No optical observer can fail a canonical action. */ } };
  const viewport = () => ({ width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 });
  const immediate = () => policy.reduced || policy.quiet;
  const unavailable = () => policy.hidden || !policy.graphicsAvailable;
  const retire = () => { options.motion.bodies.delete(key); geometry = null; lastInputs = null; closing = false; painted = ""; svg.setAttribute("hidden", ""); ribbon.removeAttribute("d"); spine.removeAttribute("d"); };
  const Observer = view?.ResizeObserver ?? (typeof ResizeObserver === "undefined" ? null : ResizeObserver);
  const observer = Observer ? new Observer(() => {
    // NO layout reads or writes during observer delivery. A repeated notification
    // requests at most one existing frame, not a competing animation timebase.
    if (!disposed && latest && !dirty) { dirty = true; wake(); }
  }) : null;
  const style = (node: Element) => view?.getComputedStyle(node);
  const numeric = (value: string | undefined) => { const number = Number.parseFloat(value ?? "0"); return Number.isFinite(number) ? number : 0; };
  const vertical = (node: Element) => { const css = style(node); return numeric(css?.paddingTop) + numeric(css?.paddingBottom) + numeric(css?.borderTopWidth) + numeric(css?.borderBottomWidth); };
  const horizontal = (node: Element) => { const css = style(node); return numeric(css?.paddingLeft) + numeric(css?.paddingRight) + numeric(css?.borderLeftWidth) + numeric(css?.borderRightWidth); };
  function visible(node: HTMLElement) { return !node.hidden && !node.closest("[hidden]") && style(node)?.display !== "none"; }
  function measure() {
    if (!latest || !latest.elements.shell.isConnected || !options.root.isConnected) return;
    measurements++;
    const { shell, reading, composer } = latest.elements;
    // Reading viewport scrollHeight includes its artificially stretched client
    // height. Measure its nonshrinking direct groups instead, so a short Whisper
    // can shrink a previously tall Action/history without changing scroll state.
    const groups = visible(reading) ? [...reading.children].filter((node): node is HTMLElement => node instanceof (view?.HTMLElement ?? HTMLElement) && visible(node)).map(node => node.getBoundingClientRect()).filter(valid) : [];
    const readingHeight = groups.length ? Math.max(...groups.map(rect => rect.y + rect.height)) - Math.min(...groups.map(rect => rect.y)) + vertical(reading) : 0;
    const fixed = [...shell.children].filter((node): node is HTMLElement => node !== reading && node instanceof (view?.HTMLElement ?? HTMLElement) && visible(node));
    const fixedHeight = fixed.reduce((sum, node) => sum + Math.max(node.getBoundingClientRect().height, node.scrollHeight) + numeric(style(node)?.marginTop) + numeric(style(node)?.marginBottom), 0);
    const count = fixed.length + (readingHeight > 0 ? 1 : 0), gap = Math.max(0, count - 1) * numeric(style(shell)?.rowGap);
    const context = shell.dataset.context && shell.dataset.context !== "none", broad = latest.view === "history" || latest.projection.kind === "action" || context;
    const contentWidth = broad ? 520 : latest.projection.kind === "insight" ? 480 : 360;
    // Width families stop a width↔line-wrap resize feedback loop. Actual measured
    // contents determine height; contextual host independently clamps viewport.
    const width = clamp(Math.ceil(contentWidth + horizontal(options.root)), 280, 560);
    const measured = Math.ceil(fixedHeight + readingHeight + vertical(shell) + (options.root === shell ? 0 : vertical(options.root)) + gap);
    if (!Number.isFinite(measured) || measured <= 0 || !valid(composer.getBoundingClientRect())) return;
    wanted = { width, height: clamp(measured, 110, 640) };
    const signature = JSON.stringify(wanted); if (signature === applied) return;
    try { options.resize({ ...wanted }); applied = signature; resizes++; } catch { resizeFailures++; }
  }
  function paint() {
    if (!geometry || !options.motion.bodies.has(key)) { svg.setAttribute("hidden", ""); return; }
    const area = viewport(), bounds = geometry.bounds;
    if (!(area.width > 0 && area.height > 0) || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > area.width || bounds.y + bounds.height > area.height) { retire(); return; }
    const opacity = clamp(options.motion.pose(key).opacity, 0, 1), signature = JSON.stringify([geometry, opacity]);
    if (signature === painted) return; painted = signature;
    svg.style.left = bounds.x + "px"; svg.style.top = bounds.y + "px"; svg.style.width = bounds.width + "px"; svg.style.height = bounds.height + "px";
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`); svg.setAttribute("width", String(bounds.width)); svg.setAttribute("height", String(bounds.height));
    svg.style.setProperty("--vela-bridge-opacity", String(opacity * 0.6)); ribbon.setAttribute("d", geometry.path); spine.setAttribute("d", geometry.spine);
    if (opacity > 0) svg.removeAttribute("hidden"); else svg.setAttribute("hidden", "");
  }
  return {
    observe(value: VelaPanelManifestation | null) {
      if (disposed) return;
      observer?.disconnect(); latest = value; dirty = !!value;
      if (value) {
        closing = false;
        for (const node of new Set([options.root, value.elements.shell, value.elements.reading, value.elements.manifestation, value.elements.composer])) observer?.observe(node);
        if (options.motion.bodies.has(key)) options.motion.target(key, { ...neutral, opacity: 1 }, "Vela bridge reopened");
      } else if (geometry && options.motion.bodies.has(key) && !immediate() && !unavailable()) { closing = true; options.motion.target(key, neutral, "Vela bridge closing"); }
      else retire();
      wake();
    },
    frame(value: Policy) {
      if (disposed) return; policy = { ...value };
      if (latest && dirty && !policy.hidden) { dirty = false; measure(); }
      if (unavailable()) { retire(); return; }
      if (closing && immediate()) { retire(); return; }
      if (options.motion.bodies.has(key) && immediate()) options.motion.snap(key);
      if (closing && (!options.motion.bodies.has(key) || options.motion.pose(key).opacity === 0)) { retire(); return; }
      if (closing) paint();
    },
    /** Call ONLY after the production GPU draw, using its actual presence bounds.
     * These are CSS pixel observations, not proof of GPU/monitor completion. */
    afterRender(actualVelaRect: ManifestationRect) {
      if (disposed || unavailable()) return;
      if (!latest) { if (closing) paint(); return; }
      submissions++;
      if (!actualVelaRect || !valid(actualVelaRect)) { rejectedGeometry++; retire(); return; }
      const hostRect = options.root.getBoundingClientRect(), area = viewport();
      if (!options.root.isConnected || !latest.elements.shell.isConnected || !visible(latest.elements.shell)) { rejectedGeometry++; retire(); return; }
      const next = manifestationGeometry({ actualVelaRect, hostRect, viewport: area });
      if (!next) { rejectedGeometry++; retire(); return; }
      geometry = next; lastInputs = { actualVelaRect: { x: actualVelaRect.x, y: actualVelaRect.y, width: actualVelaRect.width, height: actualVelaRect.height }, hostRect: { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height }, viewport: area };
      if (!options.motion.bodies.has(key)) {
        const reveal = latest.baseline || immediate() ? 1 : 0;
        options.motion.add(key, { ...neutral, opacity: reveal });
        if (reveal === 0) { options.motion.target(key, { ...neutral, opacity: 1 }, "Vela bridge observed"); wake(); }
      }
      if (immediate()) options.motion.snap(key); paint();
    },
    size: () => ({ ...wanted }),
    diagnostics: () => ({ active: !!latest, closing, dirty, kind: latest?.projection.kind ?? "none", view: latest?.view ?? "current", wanted: { ...wanted }, opacity: options.motion.bodies.has(key) ? options.motion.pose(key).opacity : 0, ownedBodies: options.motion.bodies.has(key) ? 1 : 0, measurements, resizes, resizeFailures, submissions, rejectedGeometry, geometry: geometry ? structuredClone(geometry) : null, inputs: lastInputs ? structuredClone(lastInputs) : null, disposed }),
    dispose() { if (disposed) return; disposed = true; latest = null; dirty = false; observer?.disconnect(); retire(); svg.remove(); },
  };
}
