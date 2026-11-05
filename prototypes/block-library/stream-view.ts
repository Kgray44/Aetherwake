import { mountFlowGestures, flowOptions } from "./flow-gesture.ts";
import type { StreamEvent } from "../integrated-backend/src/contracts.mts";
import type { ExperienceMotionPort } from "../application-contract/motion.ts";
import { layoutStream, streamPath, type StreamLayout } from "./stream-layout.ts";
import { downwardFlowPath, compactFlowGeometry, flowGeometryProfile, shortFlowLabel } from './flow-geometry.ts';

const make = (tag: string, text = "") => { const e = document.createElement(tag); e.textContent = text; return e; };
const glyphs: Record<string,string> = { failure: "×", uncertain: "?", gate: "◇", verification: "▣", tool: "⚒", evidence: "◈", outcome: "◎", recovery: "↻", activity: "●" };
let serial = 0;
export function mountStreamGraph(root: HTMLElement, options: {
  motion?: ExperienceMotionPort; viewId?: string; active?: boolean; presentation?: "workspace" | "focused";
  title(event: StreamEvent): string;
  metadata(event: StreamEvent): Record<string, string>;
  open(event: StreamEvent): void;
  inspectOlder?(): void;
}) {
  const prefix = `stream:${options.viewId ?? ++serial}:`;
  const host = make("div"), controls = make("div"), viewport = make("div"), scene = make("div"),
    note = make("p"), inspector = make("section"), inspectorTitle = make("h3", "Select a recorded node"), detail = make("dl");
  host.className = "aw-stream"; controls.className = "aw-stream-controls";
  viewport.className = "aw-stream-viewport"; scene.className = "aw-stream-scene";
  inspector.className = "aw-stream-inspector"; inspector.hidden = true; inspector.setAttribute("aria-label", "Selected event evidence");
  note.className = "aw-stream-coverage"; note.setAttribute("role", "status");
  viewport.tabIndex = 0; viewport.setAttribute("aria-label", "Causal graph. Arrow keys pan, plus and minus zoom, Home resets. Tab selects recorded nodes.");
  let available = true, presentation = options.presentation ?? "focused";
  let profile = flowGeometryProfile("event", presentation, "flow");
  let mode = "flow", zoom = 1, panX = profile.inset, panY = profile.inset, selected = "", active = options.active ?? true;
  let layout: StreamLayout = { nodes: [], edges: [], omitted: 0, unresolved: 0 };
  const keys = new Set<string>();
  const elements = new Map<string, HTMLElement>();
  const tool = (label: string, action: () => void) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => { if (active && available && mode !== "forensic") action(); }; controls.append(b); return b;
  };
  const transform = () => { scene.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; };
  const scale = (factor: number) => { zoom = Math.min(2, Math.max(.3, zoom * factor)); transform(); };
  tool("Zoom in", () => scale(1.2)); tool("Zoom out", () => scale(1/1.2));
  tool("Pan left", () => { panX -= 120; transform(); }); tool("Pan right", () => { panX += 120; transform(); });
  tool("Pan up", () => { panY -= 94; transform(); }); tool("Pan down", () => { panY += 94; transform(); });
  tool("Reset view", () => { zoom = 1; panX = panY = profile.inset; transform(); });
  tool("Follow selected branch", () => {
    const point = layout.nodes.find(n => n.event.eventId === selected);
    if (point) { panX = 30 - point.x * zoom; panY = 30 - point.y * zoom; transform(); }
  });
  const older = tool("Inspect older event cluster", () => options.inspectOlder?.());
  older.hidden = true;
  const menu = flowOptions(controls);
  const gestures = mountFlowGestures(viewport, {
    enabled: () => active && available && mode !== "forensic",
    read: () => ({ x: panX, y: panY, zoom }),
    write: camera => { panX = camera.x; panY = camera.y; zoom = camera.zoom; transform(); },
  });
  viewport.onkeydown = e => {
    if (gestures.keydown(e)) return;
    if (!active || !available || mode === "forensic" || e.target !== viewport) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => { panX += 100; }, ArrowRight: () => { panX -= 100; },
      ArrowUp: () => { panY += 94; }, ArrowDown: () => { panY -= 94; },
      "+": () => scale(1.2), "=": () => scale(1.2), "-": () => scale(1/1.2),
      Home: () => { zoom = 1; panX = panY = profile.inset; },
    };
    if (actions[e.key]) { e.preventDefault(); actions[e.key](); transform(); }
  };
  const open = document.createElement("button"); open.type = "button"; open.textContent = "Open source evidence";
  open.onclick = () => { const event = layout.nodes.find(n => n.event.eventId === selected)?.event; if (active && event) options.open(event); };
  inspector.append(inspectorTitle, detail, open); viewport.append(scene); host.append(menu, viewport, note, inspector); root.append(host);
  function inspect() {
    if (!active) {
      detail.replaceChildren(); inspector.hidden = true;
      inspectorTitle.textContent = "Select a recorded node"; open.hidden = true;
      return;
    }
    const current = layout.nodes.find(n => n.event.eventId === selected)?.event;
    inspector.hidden = !current;
    detail.replaceChildren();
    inspectorTitle.textContent = current ? options.title(current) : "Select a recorded node";
    open.hidden = !current || (!current.resourceId && !current.mission);
    if (current) {
      for (const [key, value] of Object.entries(options.metadata(current))) detail.append(make("dt", key), make("dd", value));
      open.hidden = !current.resourceId && !current.mission;
    }
    const path = streamPath(layout.edges, selected);
    for (const [id, element] of elements) {
      element.dataset.path = String(path.has(id)); element.setAttribute("aria-pressed", String(id === selected));
    }
    for (const edge of Array.from(scene.querySelectorAll(".aw-stream-edge"))) {
      const el = edge as SVGElement; el.dataset.path = String(path.has(el.dataset.from!) && path.has(el.dataset.to!));
    }
  }
  function render() {
    const oldInset = profile.inset; profile = flowGeometryProfile("event", presentation, mode, viewport.clientWidth);
    if (zoom === 1 && panX === oldInset && panY === oldInset) panX = panY = profile.inset;
    host.dataset.presentation = presentation; host.dataset.geometry = profile.compact ? "compact" : "expanded";
    if (profile.compact) controls.append(note); else host.append(note);
    const geometry = compactFlowGeometry(layout.nodes.map(n => n.event.eventId), layout.edges, profile.width, profile.height, profile.gapX, profile.gapY);
    layout = { ...layout, nodes: layout.nodes.map(n => ({ ...n, ...geometry.get(n.event.eventId)! })) };
    const previous = new Map(elements); elements.clear();
    scene.querySelector(".aw-stream-links")?.remove();
    const positions = new Map(layout.nodes.map(n => [n.event.eventId, n]));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("aw-stream-links"); svg.setAttribute("aria-hidden", "true");
    const width = Math.max(profile.width, ...layout.nodes.map(n => n.x + profile.width)), height = Math.max(profile.height, ...layout.nodes.map(n => n.y + profile.height));
    svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height));
    scene.style.width = `${width}px`; scene.style.height = `${height}px`;
    for (const edge of layout.edges) {
      const a = positions.get(edge.from)!, b = positions.get(edge.to)!;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.classList.add("aw-stream-edge"); p.dataset.from = edge.from; p.dataset.to = edge.to;
      p.setAttribute("d", downwardFlowPath(a, b, profile.width, profile.height)); svg.append(p);
    }
    scene.append(svg);
    const nextKeys = new Set<string>();
    for (const item of layout.nodes) {
      const { event, x, y, family } = item, key = prefix + event.eventId;
      const b = (previous.get(event.eventId) ?? document.createElement("button")) as HTMLButtonElement;
      const fresh = !previous.has(event.eventId);
      b.type = "button"; b.className = "aw-stream-node";
      b.dataset.streamEventId = event.eventId; b.dataset.family = family; b.dataset.evidenceClass = event.classification;
      b.setAttribute("aria-label", `${options.title(event)} · ${event.status ?? "status unavailable"} · ${event.classification}`);
      if (fresh) b.append(make("span", glyphs[family]), make("strong", options.title(event)), make("small", `${event.classification} · ${event.status ?? "unavailable"}`));
      b.children[1]!.textContent = profile.compact ? shortFlowLabel(options.title(event)) : options.title(event);
      b.style.width = `${profile.width}px`; b.style.height = `${profile.height}px`;
      b.onclick = () => { if (!active) return; selected = event.eventId; inspect(); };
      b.style.left = `${x}px`; b.style.top = `${y}px`; if (fresh) scene.append(b); elements.set(event.eventId, b);
      if (options.motion && active && available && mode !== "forensic") {
        const pose = { x, y, w: profile.width, h: profile.height, lift: 0, yaw: 0, opacity: 1 };
        if (!keys.has(key)) options.motion.add(key, { ...pose, opacity: options.motion.reduced ? 1 : .3 });
        options.motion.target(key, pose, "canonical-stream-event"); nextKeys.add(key);
      }
    }
    for (const [id, element] of previous) if (!elements.has(id)) element.remove();
    for (const key of keys) if (!nextKeys.has(key)) options.motion?.remove(key);
    keys.clear(); for (const key of nextKeys) keys.add(key);
    older.hidden = !layout.omitted;
    older.textContent = `${layout.omitted} older recorded events · inspect in Forensic`;
    options.motion?.wake(); inspect(); transform();
    const linked = new Set(layout.edges.flatMap(edge => [edge.from, edge.to]));
    note.textContent = `${layout.nodes.length} recorded nodes · ${layout.edges.length} explicit causal links. ${layout.nodes.filter(node => !linked.has(node.event.eventId)).length} unlinked records are compact spatial tiles, not a causal sequence. ${layout.omitted ? `${layout.omitted} older matching events omitted from this bounded view; use Forensic search. ` : ""}${layout.unresolved ? `${layout.unresolved} parent references unavailable or ambiguous. ` : ""}Correlation groups do not prove causation. Mission dependency joins are unavailable in this source.`;
  }
  return {
    update(events: readonly StreamEvent[]) { if (layout.nodes.some(n => !events.some(e => e.eventId === n.event.eventId))) gestures.cancel(); layout = layoutStream(events, mode === "glimpse" ? 24 : 80); if (!layout.nodes.some(n => n.event.eventId === selected)) selected = ""; render(); },
    setMode(value: string) { if (value === "forensic") { gestures.cancel(); menu.open = false; } mode = value; host.dataset.mode = value; host.hidden = !available || value === "forensic"; },
    setAvailable(value: boolean) { if (!value) { gestures.cancel(); menu.open = false; } available = value; host.hidden = !value || mode === "forensic"; },
    reflow() { render(); },
    setPresentation(value: "workspace" | "focused") { if (presentation === value) return; gestures.cancel(); presentation = value; render(); },
    setActive(value: boolean) { if (!value) { gestures.cancel(); menu.open = false; } active = value; inspect(); },
    frame() {
      if (!active || !available || mode === "forensic" || !options.motion) return;
      for (const [id, element] of elements) { const pose = options.motion.pose(prefix + id); element.style.left = `${pose.x}px`; element.style.top = `${pose.y}px`; element.style.opacity = String(pose.opacity); element.style.width = `${pose.w}px`; element.style.height = `${pose.h}px`; }
      for (const edge of Array.from(scene.querySelectorAll(".aw-stream-edge"))) {
        const el = edge as SVGElement;
        const a = options.motion.pose(prefix + el.dataset.from), b = options.motion.pose(prefix + el.dataset.to);
        el.setAttribute("d", downwardFlowPath(a, b, profile.width, profile.height));
      }
    },
    dispose() { gestures.dispose(); menu.open = false; active = false; inspect(); for (const key of keys) options.motion?.remove(key); keys.clear(); elements.clear(); layout = { nodes: [], edges: [], omitted: 0, unresolved: 0 }; scene.replaceChildren(); host.remove(); },
  };
}
