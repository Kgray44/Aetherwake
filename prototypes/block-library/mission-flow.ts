import type { MissionProjection, MissionTask } from "../integrated-backend/src/mission-contracts.mts";
import type { ExperienceMotionPort } from "../application-contract/motion.ts";
import { streamPath, type StreamEdge } from "./stream-layout.ts";
import { compactFlowGeometry, downwardFlowPath } from './flow-geometry.ts';

export function missionFlowInScope(mission: MissionProjection | null | undefined, scope: {
  workspaceId?: string | null; projectId: string | null; resources: readonly { id: string }[];
}): mission is MissionProjection {
  return !!mission && mission.contract === "aerynth.vela-mission@1" &&
    mission.scope.workspaceId === scope.workspaceId && mission.scope.projectId === scope.projectId &&
    (!mission.originConversationId || scope.resources.some(r => r.id === mission.originConversationId));
}
export function layoutMissionFlow(mission: MissionProjection, limit = 80) {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(80, Math.floor(limit))) : 80;
  const tasks = mission.tasks.slice(0, cap), ids = new Set(tasks.map(t => t.id));
  const edges: StreamEdge[] = [], depths = new Map<string, number>();
  let unavailable = 0;
  for (const task of tasks) for (const dependency of new Set(task.dependencies)) {
    if (ids.has(dependency) && dependency !== task.id) edges.push({ from: dependency, to: task.id });
    else unavailable++;
  }
  // Kahn-style level assignment preserves real parallel work and bounds malformed cycles.
  const remaining = new Set(ids);
  for (let pass = 0; pass < tasks.length && remaining.size; pass++) {
    let changed = false;
    for (const task of tasks) if (remaining.has(task.id)) {
      const parents = edges.filter(e => e.to === task.id).map(e => e.from);
      if (parents.every(id => depths.has(id))) {
        depths.set(task.id, parents.length ? Math.max(...parents.map(id => depths.get(id)!)) + 1 : 0);
        remaining.delete(task.id); changed = true;
      }
    }
    if (!changed) break;
  }
  const positions = compactFlowGeometry(tasks.map(task => task.id), edges);
  const nodes = tasks.map(task => {
    return { task, ...positions.get(task.id)!, join: task.dependencies.length > 1 };
  });
  return { nodes, edges, omitted: mission.tasks.length - tasks.length, unavailable, cycles: remaining.size };
}
/** Explicit safe task/attempt metadata, never evidence values or specialist/private context. */
export function missionTaskMetadata(mission: MissionProjection, task: MissionTask): Record<string, string> {
  const result: Record<string, string> = {
    Mission: mission.id, "Mission revision": String(mission.revision), "Plan revision": String(mission.planRevision),
    Workspace: mission.scope.workspaceId, Project: mission.scope.projectId ?? "Unassigned", "Task ID": task.id,
    Objective: task.objective, Executor: task.executor, "Recorded task state": task.state,
    "Current wait": mission.waits[task.id] ?? "None recorded", Criterion: task.criterion,
    Dependencies: task.dependencies.join(", ") || "None", "Queued at": task.queuedAt,
  };
  for (const [index, attempt] of task.attempts.slice(-3).entries()) {
    const key = `Attempt ${index + 1}`;
    result[key] = attempt.id;
    result[`${key} outcome`] = attempt.outcome ?? "Not settled";
    result[`${key} admitted at`] = attempt.admittedAt;
    result[`${key} finished at`] = attempt.finishedAt ?? "Unavailable";
    if (attempt.evidence) {
      result[`${key} evidence ID`] = attempt.evidence.id;
      result[`${key} source`] = attempt.evidence.source;
      result[`${key} observed at`] = attempt.evidence.observedAt;
    }
    if (attempt.verification) {
      result[`${key} verification`] = `${attempt.verification.passed ? "Passed" : "Failed"}: ${attempt.verification.criterion}`;
      result[`${key} verification detail`] = attempt.verification.detail;
      result[`${key} verification evidence`] = attempt.verification.evidenceIds.join(", ") || "None recorded";
    }
  }
  return result;
}
const make = (tag: string, text = "") => { const element = document.createElement(tag); element.textContent = text; return element; };
let serial = 0;
export function mountMissionFlow(root: HTMLElement, options: {
  motion?: ExperienceMotionPort; viewId?: string; active?: boolean; openMission?(id: string): void;
}) {
  const prefix = `mission-flow:${options.viewId ?? ++serial}:`;
  const host = make("section"), title = make("h3"), coverage = make("p"), tools = make("div"),
    viewport = make("div"), scene = make("div"), inspector = make("section"), details = make("dl");
  host.className = "aw-mission-flow aw-stream"; host.setAttribute("aria-label", "Current mission dependency projection"); host.hidden = true;
  tools.className = "aw-stream-controls"; viewport.className = "aw-stream-viewport"; scene.className = "aw-stream-scene";
  coverage.className = "aw-stream-coverage"; inspector.className = "aw-stream-inspector"; inspector.hidden = true;
  inspector.setAttribute("aria-label", "Selected canonical mission task"); viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Current mission tasks and dependencies. Tab selects tasks. Arrow keys pan; plus and minus zoom; Home resets.");
  let active = options.active ?? true, current: MissionProjection | null = null, selected = "", mode = "flow", zoom = 1, px = 20, py = 20;
  let layout: ReturnType<typeof layoutMissionFlow> | null = null;
  const keys = new Set<string>(), elements = new Map<string, HTMLButtonElement>();
  const transform = () => { scene.style.transform = `translate(${px}px, ${py}px) scale(${zoom})`; };
  const changeZoom = (factor: number) => { zoom = Math.max(.3, Math.min(2, zoom * factor)); transform(); };
  const action = (label: string, run: () => void) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => { if (active) run(); }; tools.append(b); return b;
  };
  action("Zoom mission in", () => changeZoom(1.2)); action("Zoom mission out", () => changeZoom(1 / 1.2));
  action("Pan mission left", () => { px -= 120; transform(); }); action("Pan mission right", () => { px += 120; transform(); });
  action("Pan mission up", () => { py -= 104; transform(); }); action("Pan mission down", () => { py += 104; transform(); });
  action("Reset mission view", () => { px = py = 20; zoom = 1; transform(); });
  viewport.onkeydown = event => {
    if (!active || event.target !== viewport) return;
    const actions: Record<string, () => void> = { ArrowLeft: () => { px += 120; }, ArrowRight: () => { px -= 120; }, ArrowUp: () => { py += 104; }, ArrowDown: () => { py -= 104; },
      '+': () => changeZoom(1.2), '=': () => changeZoom(1.2), '-': () => changeZoom(1 / 1.2), Home: () => { px = py = 20; zoom = 1; } };
    if (actions[event.key]) { event.preventDefault(); actions[event.key](); transform(); }
  };
  const open = document.createElement("button"); open.type = "button"; open.textContent = "Open canonical mission evidence";
  open.onclick = () => { if (active && current && selected && layout?.nodes.some(n => n.task.id === selected)) options.openMission?.(current.id); };
  inspector.append(details, open); viewport.append(scene); host.append(title, coverage, tools, viewport, inspector); root.append(host);
  const inspect = () => {
    details.replaceChildren();
    const task = active && current ? layout?.nodes.find(n => n.task.id === selected)?.task : undefined;
    inspector.hidden = !task; open.hidden = !task || !options.openMission;
    if (task && current) for (const [key, value] of Object.entries(missionTaskMetadata(current, task))) details.append(make("dt", key), make("dd", value));
    const path = task ? streamPath(layout!.edges, task.id) : new Set<string>();
    for (const [id, element] of elements) { element.dataset.path = String(path.has(id)); element.setAttribute("aria-pressed", String(task?.id === id)); }
    for (const edge of Array.from(scene.querySelectorAll(".aw-mission-edge"))) {
      const p = edge as SVGElement; p.dataset.path = String(path.has(p.dataset.from!) && path.has(p.dataset.to!));
    }
  };
  const clear = () => {
    for (const key of keys) options.motion?.remove(key);
    keys.clear(); elements.clear(); scene.replaceChildren(); details.replaceChildren(); inspector.hidden = true; open.hidden = true; selected = ""; layout = null; title.textContent = coverage.textContent = "";
  };
  return {
    update(mission: MissionProjection | null, nextMode = "flow") {
      const previousId = current?.id; current = mission; mode = nextMode;
      if (!mission || previousId !== mission.id) clear();
      host.hidden = !mission || mode === "forensic"; host.dataset.mode = mode;
      if (!mission) return;
      layout = layoutMissionFlow(mission, mode === "glimpse" ? 24 : 80);
      if (!layout.nodes.some(n => n.task.id === selected)) selected = "";
      title.textContent = mission.objective;
      coverage.textContent = `Current plan / execution projection · mission ${mission.id} · revision ${mission.revision}, plan ${mission.planRevision} · outcome ${mission.outcome}. ${layout.nodes.length} tasks, ${layout.edges.length} declared dependencies. ${layout.omitted ? `${layout.omitted} tasks omitted from this bounded view. ` : ""}${layout.unavailable ? `${layout.unavailable} dependencies outside this view or invalid. ` : ""}${layout.cycles ? `${layout.cycles} tasks have unresolved cyclic layout. ` : ""}Independent roots sit alongside one another; unconnected groups are spatial grouping only. These links are current task dependencies, not historical event causality. Event filters apply to retained events.`;
      const previous = new Map(elements); elements.clear(); scene.querySelector("svg")?.remove();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("aw-stream-links"); svg.setAttribute("aria-hidden", "true");
      const width = Math.max(600, ...layout.nodes.map(n => n.x + 210)), height = Math.max(280, ...layout.nodes.map(n => n.y + 90));
      svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height)); scene.style.width = `${width}px`; scene.style.height = `${height}px`;
      const positions = new Map(layout.nodes.map(n => [n.task.id, n]));
      for (const edge of layout.edges) {
        const a = positions.get(edge.from)!, b = positions.get(edge.to)!;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.classList.add("aw-stream-edge", "aw-mission-edge"); p.dataset.from = edge.from; p.dataset.to = edge.to;
        p.setAttribute("d", downwardFlowPath(a, b, 190, 70)); svg.append(p);
      }
      scene.append(svg); const nextKeys = new Set<string>();
      for (const item of layout.nodes) {
        const task = item.task, key = prefix + mission.id + ":" + task.id;
        const b = previous.get(task.id) ?? document.createElement("button"), fresh = !previous.has(task.id);
        b.type = "button"; b.className = "aw-stream-node aw-mission-task"; b.dataset.missionTaskId = task.id; b.dataset.taskState = task.state; b.dataset.join = String(item.join);
        const wait = mission.waits[task.id], label = `${item.join ? "Join · " : ""}${task.objective}`, state = `${task.state}${wait ? ` · waiting: ${wait}` : ""}`;
        b.setAttribute("aria-label", `${label} · ${state} · ${task.dependencies.length} declared dependencies`);
        if (fresh) b.append(make("strong"), make("small"));
        b.children[0]!.textContent = label; b.children[1]!.textContent = state;
        b.onclick = () => { if (!active || !current || current.id !== mission.id || !elements.has(task.id)) return; selected = task.id; inspect(); };
        b.style.left = `${item.x}px`; b.style.top = `${item.y}px`; if (fresh) scene.append(b); elements.set(task.id, b);
        if (options.motion && active && mode !== "forensic") { const pose = { x: item.x, y: item.y, w: 190, h: 70, lift: 0, yaw: 0, opacity: 1 }; if (!keys.has(key)) options.motion.add(key, { ...pose, opacity: options.motion.reduced ? 1 : .3 }); options.motion.target(key, pose, "canonical-mission-projection"); nextKeys.add(key); }
      }
      for (const [id, element] of previous) if (!elements.has(id)) element.remove();
      for (const key of keys) if (!nextKeys.has(key)) options.motion?.remove(key);
      keys.clear(); for (const key of nextKeys) keys.add(key); options.motion?.wake(); inspect(); transform();
    },
    setActive(value: boolean) { active = value; inspect(); },
    frame() {
      if (!active || !current || !options.motion || !layout || mode === "forensic") return;
      for (const [id, element] of elements) { const pose = options.motion.pose(prefix + current.id + ":" + id); element.style.left = `${pose.x}px`; element.style.top = `${pose.y}px`; element.style.opacity = String(pose.opacity); }
      for (const edge of Array.from(scene.querySelectorAll(".aw-mission-edge"))) { const p = edge as SVGElement;
        const a = options.motion.pose(prefix + current.id + ":" + p.dataset.from), b = options.motion.pose(prefix + current.id + ":" + p.dataset.to);
        p.setAttribute("d", downwardFlowPath(a, b, 190, 70));
      }
    },
    dispose() { active = false; current = null; clear(); host.remove(); },
  };
}
