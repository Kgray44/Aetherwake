import {
  registerResourceMaterial,
  targetResourceMaterial,
  resourceUnfold,
  resourceDock,
  resourceSelection,
  materialMotionKey,
} from "./resource-material-motion.ts";
import { installApplication, type Application } from "./application";
import type { ResourceOpeningInput } from "../../../application-contract/resource-opening.ts";
import { targetDirectCard, directCardLayer } from "./direct-card-motion.ts";
import { groupFocusedSideCards } from "../../../block-library/focused-rail.ts";
import type {
  DesktopSnapshot,
  DesktopCommand,
} from "../../../application-contract/contracts.ts";
import type { Resource } from "./store";
import "./style.css";
import "./card-selection.css";
import {
  motionPolicy,
  nextDrawDeadline,
  DRAW_EARLY_TOLERANCE_MS,
} from "./policy";
import { deriveSceneState } from "./scene-state";
import { registerScene, retargetScene, sceneWeights } from "./scene-transition";
import {
  MaterialCompositor,
  normalizeSurfaceView,
  type SurfaceView,
} from "./material-compositing";
import { defaultSurfaceShape, surfaceBorderRadius } from "./surface-contour";
import { applyBlockPoseStyle } from "../../../block-library/pose-style.ts";
import { placeStatus, type StatusObstacle } from "./status-placement.ts";
import { createWorkingFootprints } from "./working-footprints";
import { minimizedCardSize } from "./minimized-card";
import type { ArchitectureConcept } from "./orbital-architecture";
import type { CelestialStudy } from "./celestial-environment";
import type { InstrumentStudy } from "./instrument-materials";
import { installConversation } from "./conversation";
import {
  Environment,
  type Study,
  type Quality,
  type VelaState,
} from "./renderer";
import {
  MotionCoordinator,
  clamp,
  slotPose,
  reorder,
  type Pose,
} from "./motion";
import {
  seed,
  validateSaved,
  validateDemoPrefix,
  demoSteps,
  type StreamEvent,
} from "./store";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const app = $("#app");
const renderWhileVisible = window.aerynthHost?.renderWhileVisible ?? false;
const observeGeometry = window.aerynthHost?.geometryObservation ?? false;
let dragGlideFrame: Record<string, unknown> | null = null;
app.innerHTML = `
  <canvas id="world" aria-hidden="true"></canvas>
  <div class="scene-vignette" aria-hidden="true"></div>
  <div class="window-drag" aria-hidden="true"><span>AERYNTH <i>·</i> THE QUIET ATELIER</span></div>
  <header class="topbar">
    <svg width="0" height="0" aria-hidden="true" class="logo-filter"><defs><filter id="logo-clear-background" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 4 4 4 0 -0.32"/></filter></defs></svg>
    <div class="brand"><img src="./aerynth-mark-master.png" alt="Approved Aerynth mark"><span>AERYNTH<small>LIQUID INTELLIGENCE / V3.5</small></span></div>
    <div class="place"><span class="tiny">WORKSPACE</span><span>The quiet atelier</span></div>
    <nav class="scene-navigation" aria-label="Environment"><button data-scene="architecture" aria-pressed="true">Architecture</button><button data-scene="living" aria-pressed="false">Living field</button></nav>
    <button id="settings-button" aria-expanded="false" aria-controls="settings">Scene controls <span>⌘</span></button>
  </header>
  <div class="study-caption"><span id="study-index">01 / LUMINOUS ARCHITECTURE</span><small>Celestial architecture · cinematic V3.5</small></div>
  <div class="provenance">SYNTHETIC CONTENT <span>·</span> No AI backend connected</div>
  <main id="stage" aria-label="Spatial workspace"></main>
  <svg id="relationships" aria-hidden="true"><defs><linearGradient id="link-light"><stop stop-color="#a68dcc" stop-opacity="0"/><stop offset=".6" stop-color="#cbb3eb"/><stop offset="1" stop-color="#e1cff4" stop-opacity=".2"/></linearGradient></defs><path fill="none" stroke="url(#link-light)" stroke-width="1" stroke-dasharray="2 6"/></svg>
  <div id="destinations" aria-hidden="true"></div>
  <button id="vela" aria-label="Address Vela. Idle, synthetic presence" aria-expanded="false" aria-controls="vela-dialog"><span class="presence-target" aria-hidden="true"></span><span class="vela-label"><b>Vela</b><small id="vela-state">Idle · synthetic presence</small><span>Address Vela ↗</span></span></button>
  <section id="vela-dialog" class="floating-dialog" aria-label="Vela local interaction" hidden>
    <div class="dialog-top"><span class="tiny">VELA / LOCAL INTERACTION</span><button id="vela-close" aria-label="Close Vela">×</button></div>
    <h2>A thought, given space.</h2><p>No model or microphone is connected. This surface demonstrates receiving typed input locally.</p>
    <label for="vela-input">Your message</label><textarea id="vela-input" rows="3" placeholder="What would you like to explore?"></textarea>
    <button id="vela-send" class="accent">Receive locally ↗</button><p id="vela-answer" role="status"></p>
    <label for="vela-expression">Synthetic expression study</label><select id="vela-expression"><option value="idle">Idle</option><option value="receiving">Receiving typed input</option><option value="working">Working</option><option value="coordinating">Coordinating</option><option value="attention">Attention required</option><option value="reported">Reported complete — unverified</option><option value="verified">Fixture check passed</option><option value="unavailable">Unavailable</option></select>
  </section>
  <aside id="settings" class="floating-dialog settings" aria-label="Scene controls" hidden>
    <div class="dialog-top"><span class="tiny">EXPERIMENT CONTROLS</span><button id="settings-close" aria-label="Close scene controls">×</button></div>
    <label for="study">Spatial study</label><select id="study"><option value="architecture">01 · Luminous Architecture</option><option value="living">02 · Living Intelligence</option><option value="observatory">03 · Aetheric Observatory</option></select>
    <label for="architecture-concept">Orbital composition study</label><select id="architecture-concept"><option value="ring">A · Monumental arc</option><option value="aperture">B · Celestial aperture</option><option value="observatory">C · Suspended observatory</option></select>
    <label for="celestial-study">Celestial lighting study</label><select id="celestial-study"><option value="starlit">A · Starlit Ring</option><option value="shadow">B · Shadow Reveal</option><option value="deep">C · Deep Observatory</option></select>
    <label for="instrument-study">Instrument material study</label><select id="instrument-study"><option value="optical">A · Optical Glass</option><option value="engineered">B · Engineered Instrument</option><option value="composite">C · Luminous Composite</option></select>
    <label for="quality">Graphics</label><select id="quality"><option value="cinematic">Cinematic</option><option value="balanced" selected>Balanced</option><option value="efficient">Efficient</option></select>
    <label class="check"><input id="ambient" type="checkbox" checked> Ambient motion</label>
    <label for="ambient-strength">Vela's ambient presence</label><select id="ambient-strength"><option value="1" selected>Expressive</option><option value="0.4">Subtle</option></select>
    <label class="check"><input id="reduced" type="checkbox"> Reduce motion</label>
    <label class="check"><input id="quiet" type="checkbox"> Quiet / GPU-intensive work</label>
    <p id="policy">Balanced · ambient presence</p><p>Visible idle keeps a slower ambient rhythm. Unfocused windows pause graphics. Quiet mode stills the environment; no other apps are monitored.</p>
  </aside>
  <aside id="stream" class="stream" aria-label="Intelligence Stream" hidden>
    <div class="dialog-top"><span class="tiny">INTELLIGENCE STREAM</span><button id="stream-close" aria-label="Close Intelligence Stream">×</button></div>
    <h2>Observable, by design.</h2><p class="synthetic">SYNTHETIC SEQUENCE · No agents execute</p><ol id="events" aria-label="Recorded events"></ol>
  </aside>
  <div id="status" class="status" role="status" aria-live="polite">Select a folio. Unfold it. Keep your place.</div>
  <nav class="dock" aria-label="Workspace actions"><button id="home" title="Return to workspace (Escape)">⌑ <span>Workspace</span></button><i></i><button id="demo">◈ <span>Run synthetic sequence</span></button><button id="stream-button" aria-expanded="false" aria-controls="stream">≋ <span>Intelligence Stream</span><b id="event-count">0</b></button><i></i><button id="undo" disabled>↶ <span>Undo move</span></button></nav>
  <div class="keys">TAB to explore <span>·</span> ENTER to activate <span>·</span> ESC to return</div>
`;

const desktopMode = !!window.aerynthHost?.command;
let application: Application | null = null;
const storageKey = "aerynth-cinematic-v3-v1";
let saved: ReturnType<typeof validateSaved> = null;
try {
  saved = validateSaved(JSON.parse(localStorage.getItem(storageKey) || "null"));
} catch {}
let order = desktopMode ? [] : saved?.order || seed.map((r) => r.id);
const resources = new Map<string, Resource>(
  (desktopMode ? [] : seed).map((r) => [
    r.id,
    { ...r, text: saved?.drafts[r.id] ?? r.text },
  ]),
);
const motion = new MotionCoordinator();
registerScene(motion, "architecture");
const elements = new Map<string, HTMLElement>();
const poseStyleCache = new Map<string, string>();
const workingFootprints = desktopMode
  ? createWorkingFootprints(() => wake(false))
  : null;
addEventListener("pagehide", () => workingFootprints?.dispose(), {
  once: true,
});
const materialCompositor = new MaterialCompositor();
let surfaceView: SurfaceView = { scale: 1, originX: 0, originY: 0 };
let statusMetricsDirty = true;
let statusChrome: StatusObstacle[] = [];
let statusWidth = 128;
let lastStatusPlacement = "";
const statusNode = $("#status");
const statusChromeObserver = new ResizeObserver(() => {
  statusMetricsDirty = true;
  wake(false);
});
for (const node of document.querySelectorAll(".keys,.provenance"))
  statusChromeObserver.observe(node);
let selected: string | null = null,
  expanded: string | null = null,
  quiet = false;
let focusedRailOffset = 0, focusedRailMax = 0;
const focusedRailHeadings = new Map<string, HTMLElement>();
let study: Study = "architecture",
  quality: Quality = "balanced",
  vela: VelaState = "idle";
let architectureConcept: ArchitectureConcept = "ring";
document.body.dataset.study = study;
let celestialStudy: CelestialStudy = "starlit";
let instrumentStudy: InstrumentStudy = "optical";
let presenceReviewScale: number | null = null;
let presenceReviewPhase: number | null = null;
document.body.dataset.instrumentStudy = instrumentStudy;
// Explicit native evidence hook. Null means the ordinary autonomous clock.
let environmentPhase: number | null = null;
let pointer = { x: 0, y: 0 },
  focus = 0,
  attention = 0,
  lastInteraction = performance.now();
let sceneState: ReturnType<typeof deriveSceneState> | null = null;
let nativeActive = true,
  running = true,
  graphicsFailed = false;
let environment: Environment | null = null;
let ambient = true,
  ambientStrength = 1,
  visualClock = 0,
  pointerDirty = false;
const events: StreamEvent[] = [];
const undoStack: string[][] = [];
const metrics = {
  draws: 0,
  callbacks: 0,
  intervals: [] as number[],
  drawIntervals: [] as number[],
  inputFeedback: [] as number[],
  errors: [] as string[],
  policy: "",
  lastDraw: 0,
};
const osReduced = matchMedia("(prefers-reduced-motion: reduce)");
const forcedColors = matchMedia("(forced-colors: active)");
let manualReduced = false;
let frameRunning = false,
  wakeRequested = false;
let dirty = true,
  raf = 0,
  schedulerTimer = 0,
  lastFrame = performance.now(),
  lastDraw = 0,
  nextDraw = 0,
  inputAt = 0;
let demoTimer: ReturnType<typeof setInterval> | null = null,
  demoIndex = 0,
  runId = "";
let drag: {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  origin: Pose;
  before: string[];
  slot: number;
  moved: boolean;
} | null = null;

function status(text: string) {
  statusNode.textContent = text;
  statusMetricsDirty = true;
  wake();
}
function persist() {
  if (desktopMode) return true;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        order,
        drafts: Object.fromEntries(
          [...resources].map(([id, r]) => [id, r.text]),
        ),
      }),
    );
    return true;
  } catch {
    status(
      "Local storage is unavailable. Your draft remains in this open window.",
    );
    return false;
  }
}
function event(
  source: string,
  resource: string,
  kind: string,
  detail: string,
  evidence: StreamEvent["evidence"] = "local-observed",
  correlation?: string,
) {
  const e: StreamEvent = {
    id: `event-${events.length ? events.at(-1)!.sequence + 1 : 1}`,
    sequence: events.length ? events.at(-1)!.sequence + 1 : 1,
    run:
      correlation ?? (evidence === "synthetic" ? runId : "local-interaction"),
    source,
    resource,
    kind,
    evidence,
    time: new Date().toISOString(),
    detail,
  };
  events.push(e);
  if (events.length > 120) events.shift();
  if (desktopMode) return;
  const li = document.createElement("li");
  li.dataset.evidence = evidence;
  const top = document.createElement("small");
  top.textContent = `${String(e.sequence).padStart(2, "0")} / ${evidence.toUpperCase()} / ${e.time.slice(11, 19)} UTC`;
  const name = document.createElement("b");
  name.textContent = kind;
  const p = document.createElement("p");
  p.textContent = detail;
  const meta = document.createElement("small");
  meta.textContent = `${source} → ${resource} · ${e.run}`;
  li.append(top, name, p, meta);
  $("#events").prepend(li);
  while ($("#events").children.length > 120)
    $("#events").lastElementChild?.remove();
  $("#event-count").textContent = String(events.length);
}
function wake(invalidate = true) {
  lastInteraction = performance.now();
  dirty ||= invalidate;
  if (frameRunning) {
    wakeRequested = true;
    return;
  }
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = 0;
  }
  if (!raf && nativeActive && !document.hidden) {
    lastFrame = performance.now();
    raf = requestAnimationFrame(tick);
  }
}
function interaction() {
  inputAt = performance.now();
  wake();
}
function base(id: string) {
  return restAt(id, order.indexOf(id));
}
function presentationBlock(id: string) {
  return (
    (
      application as
        | (Application & {
            previewBlock?: (id: string) => ReturnType<Application["block"]>;
          })
        | null
    )?.previewBlock?.(id) ?? application?.block(id)
  );
}
function workspaceSurfacesVisible() {
  return (
    (
      application as
        | (Application & { workspaceSurfacesVisible?: () => boolean })
        | null
    )?.workspaceSurfacesVisible?.() ??
    application?.snapshot()?.navigation.kind !== "constellation"
  );
}
function restAt(id: string, slot: number) {
  const block = presentationBlock(id);
  if (block) {
    const offset = application!.offset();
    const value =
      (application as Application & { zoom?: () => number }).zoom?.() ?? 1;
    const zoom = Number.isFinite(value) && value > 0 ? value : 1;
    const size = minimizedCardSize(
      block,
      application?.blockMinimized(id) ?? false,
      zoom,
    );
    return {
      x: block.x * zoom + offset.x,
      y: block.y * zoom + offset.y,
      w: size.width * zoom,
      h: size.height * zoom,
      lift: 0,
      yaw: 0,
      opacity: 1,
    };
  }
  const pose = slotPose(slot, innerWidth, innerHeight);
  if (innerWidth >= 1000) {
    const scale = clamp(innerWidth / 1500, 0.7, 1.5);
    const kind = resources.get(id)!.type;
    if (kind === "research") {
      pose.w = 260 * scale;
      pose.h = 260 * scale;
      pose.x += innerWidth * 0.035;
    } else if (kind === "note") {
      pose.w = 340 * scale;
      pose.h = 156 * scale;
    } else {
      pose.w = 430 * scale;
      pose.h = 225 * scale;
    }
    pose.y = Math.min(pose.y, innerHeight - pose.h - 165);
  }
  return pose;
}
function focusedRail() {
  const slots = new Map<string, { y: number; heading?: string }>();
  if (!desktopMode || !expanded) {
    focusedRailOffset = focusedRailMax = 0;
    return slots;
  }
  const groups = groupFocusedSideCards(order.filter(id => id !== expanded), id => {
    const article = elements.get(id);
    const kind = article?.dataset.blockKind ?? resources.get(id)?.type ?? "resource";
    return { kind, label: article?.querySelector(".grip span")?.textContent?.trim() || kind.replaceAll("_", " ") };
  });
  const row = innerWidth >= 1100 ? 94 : 82;
  let y = 190;
  for (const group of groups) {
    y += 19;
    for (const [index, id] of group.cards.entries()) {
      slots.set(id, { y, ...(index === 0 ? { heading: group.label } : {}) });
      y += row;
    }
  }
  focusedRailMax = Math.max(0, y - (innerHeight - 100));
  focusedRailOffset = Math.min(focusedRailOffset, focusedRailMax);
  return slots;
}
function layout(cause: string) {
  const rail = focusedRail();
  for (const id of order) {
    const directGesture = application?.directGesture(id);
    const side = rail.get(id);
    let p = base(id);
    if (expanded === id) {
      p = {
        x: innerWidth >= 1100 ? 232 : 96,
        y: 152,
        w: Math.max(
          240,
          Math.min(1000, innerWidth - (innerWidth >= 1100 ? 360 : 184)),
        ),
        h: Math.max(250, innerHeight - 310),
        lift: 35,
        yaw: 0,
        opacity: 1,
      };
    } else if (expanded && !directGesture?.fromFocusedSide) {
      p = {
        ...p,
        x: innerWidth >= 1100 ? 24 : 16,
        y: side ? side.y - focusedRailOffset : 238 +
          order.filter((key) => key !== expanded).indexOf(id) *
            (innerWidth >= 1100 ? 100 : 88),
        w: innerWidth >= 1100 ? 176 : 56,
        h: innerWidth >= 1100 ? 76 : 64,
        lift: -4,
        yaw: 0,
        opacity: 0.8,
      };
    } else if (selected === id && directGesture?.intent !== "move") {
      p = { ...p, y: p.y - 12, lift: 30, yaw: 0 };
    }
    if (drag) {
      if (id === drag.id) {
        p = {
          ...drag.origin,
          x: drag.origin.x + drag.x - drag.startX,
          y: drag.origin.y + drag.y - drag.startY,
          lift: 55,
          yaw: 0,
        };
      } else if (!application) {
        const next = reorder(drag.before, drag.id, drag.slot);
        p = {
          ...restAt(id, next.indexOf(id)),
          lift: -3,
        };
      }
    }
    targetDirectCard(motion, id, p, cause, directGesture);
    targetResourceMaterial(
      motion,
      id,
      expanded === id,
      cause,
      !!expanded && expanded !== id,
      selected === id,
    );
    const el = elements.get(id)!;
    const label = side?.heading && !directGesture?.fromFocusedSide ? side.heading : undefined;
    if (label) {
      el.dataset.focusedRailHeading = label;
      let heading = focusedRailHeadings.get(id);
      if (!heading) {
        heading = document.createElement("span");
        heading.className = "application-focused-rail-heading";
        heading.setAttribute("aria-hidden", "true");
        $("#stage").append(heading);
        focusedRailHeadings.set(id, heading);
      }
      if (heading.textContent !== label) heading.textContent = label;
    } else {
      delete el.dataset.focusedRailHeading;
      if (expanded) {
        focusedRailHeadings.get(id)?.remove();
        focusedRailHeadings.delete(id);
      }
    }
    const isExpanded = expanded === id;
    if (el.classList.contains("expanded") !== isExpanded)
      application?.captureChatPresentation(id, isExpanded);
    el.toggleAttribute("data-focused-side-carried", directGesture?.fromFocusedSide === true);
    el.classList.toggle("selected", selected === id);
    el.classList.toggle("expanded", isExpanded);
    el.classList.toggle("receded", !!expanded && expanded !== id);
    el.classList.toggle(
      "dragging",
      drag?.id === id || directGesture?.intent === "move",
    );
    const receded = !!expanded && expanded !== id;
    const inner = el.querySelector<HTMLElement>(".folio-inner")!;
    if (inner.inert !== receded) inner.inert = receded;
    if (inner.getAttribute("aria-hidden") !== String(receded))
      inner.setAttribute("aria-hidden", String(receded));
    const anchor = el.querySelector<HTMLButtonElement>(".resource-anchor")!;
    const tabIndex = receded ? 0 : -1;
    if (anchor.tabIndex !== tabIndex) anchor.tabIndex = tabIndex;
    if (anchor.getAttribute("aria-hidden") !== String(!receded))
      anchor.setAttribute("aria-hidden", String(!receded));
    if (el.inert) el.inert = false;
    const unfold = el.querySelector(".unfold")!;
    const labelText = isExpanded ? "Back ↙" : "Open ↗";
    if (unfold.textContent !== labelText) unfold.textContent = labelText;
    if (unfold.getAttribute("aria-expanded") !== String(isExpanded))
      unfold.setAttribute("aria-expanded", String(isExpanded));
    application?.setBlockActive(
      id,
      nativeActive && !document.hidden && expanded === id,
    );
  }
  document.body.classList.toggle("focused", !!expanded);
  $("#home").setAttribute("aria-current", expanded ? "false" : "page");
  document.body.classList.toggle(
    "drag-active",
    !!drag || !!application?.directDragging(),
  );
  if (!nativeActive || document.hidden) {
    for (const id of order) {
      motion.snap(id);
      motion.snap(materialMotionKey(id));
    }
    renderDOM();
  }
  dirty = true;
  wake();
}
function select(id: string) {
  if (expanded && expanded !== id) {
    expand(id);
    return;
  }
  selected = id;
  interaction();
  layout("select");
  status(
    `${resources.get(id)!.title} selected. Open to work, drag its surface to move, or resize from an edge.`,
  );
}
function expand(id: string) {
  if (drag) return;
  if (expanded !== id && application?.block(id)?.minimized === true) {
    const workspaceId = application.snapshot()?.activeWorkspaceId;
    const requestedAt = inputAt;
    void application
      .setBlockMinimized(id, false)
      .then(() => {
        if (
          elements.has(id) &&
          application?.snapshot()?.activeWorkspaceId === workspaceId &&
          inputAt === requestedAt
        )
          expand(id);
      })
      .catch((error) => status(String(error.message ?? error)));
    return;
  }
  const closing = expanded === id;
  expanded = closing ? null : id;
  selected = id;
  interaction();
  layout(closing ? "reverse / collapse" : "expand");
  event(
    "Workspace",
    id,
    closing ? "resource.collapsed" : "resource.expanded",
    "Persistent resource and draft retained.",
  );
  status(
    closing
      ? "Back in the workspace. Your draft is kept."
      : "Focused working surface. Escape returns to the workspace.",
  );
  if (closing)
    elements.get(id)!.querySelector<HTMLButtonElement>(".unfold")!.focus();
  else
    elements
      .get(id)!
      .querySelector<HTMLButtonElement>(".title-select")!
      .focus({ preventScroll: true });
}
function home() {
  if (drag) {
    cancelDrag();
    return;
  }
  const id = expanded;
  expanded = null;
  selected = null;
  interaction();
  layout("return to calm");
  if (id)
    elements.get(id)!.querySelector<HTMLButtonElement>(".unfold")!.focus();
  status("Workspace restored.");
}
if (desktopMode) {
  $("#stage").addEventListener("wheel", event => {
    if (!expanded || !focusedRailMax || event.ctrlKey || event.metaKey ||
        !(event.target instanceof Element) || !event.target.closest(".receded .resource-anchor") ||
        application?.directDragging()) return;
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? innerHeight : 1;
    const next = clamp(focusedRailOffset + event.deltaY * scale, 0, focusedRailMax);
    if (next === focusedRailOffset) return;
    event.preventDefault();
    focusedRailOffset = next;
    layout("scroll focused cards");
  }, { passive: false });
  document.addEventListener("click", (event) => {
    if (!expanded || event.defaultPrevented || event.button !== 0) return;
    if (event.target === document.body || event.target === $("#world") || event.target === $("#stage"))
      home();
  });
}
function move(id: string, to: number) {
  const block = application?.block(id);
  if (block) {
    void application!.run({
      type: "geometry",
      blockId: id,
      expectedVersion: block.version,
      placement: { ...block, z: to },
      shape: block.shape,
    });
    return;
  }
  undoStack.push([...order]);
  if (undoStack.length > 32) undoStack.shift();
  order = reorder(order, id, to);
  persist();
  $("#undo").removeAttribute("disabled");
  interaction();
  layout("rearrange");
  event(
    "Workspace",
    id,
    "layout.reordered",
    `Moved to position ${order.indexOf(id) + 1}. Undo is available.`,
  );
  status(`Moved to position ${order.indexOf(id) + 1}.`);
}
function cancelDrag() {
  if (!drag) return;
  (
    application as (Application & { cancelPreview?: () => void }) | null
  )?.cancelPreview?.();
  drag = null;
  $("#destinations").replaceChildren();
  layout("drag cancellation");
  status("Move cancelled. Original arrangement retained.");
}

function mountResource(id: string, r: Resource) {
  const article = document.createElement("article");
  article.className = `folio ${r.type}`;
  article.dataset.resource = r.canonicalId ?? id;
  article.dataset.block = id;
  article.setAttribute("aria-label", r.title);
  article.innerHTML = `<button class="resource-anchor" aria-label="Open ${r.type}" title="${r.type}" tabindex="-1"><span class="anchor-glyph" aria-hidden="true">${r.type === "research" ? "◌" : r.type === "note" ? "⌁" : "≋"}</span><span class="anchor-label"><small>${r.type}</small><b></b></span></button><div class="folio-edge" aria-hidden="true"></div><div class="folio-inner"><div class="folio-top"><button class="grip" aria-label="Move ${r.type}. Alt plus arrow keys reorders; Escape cancels drag." title="Drag to move · Alt+←/→">⠿ <span>${r.type.toUpperCase()}</span></button><span class="folio-number">${String(order.indexOf(id) + 1).padStart(2, "0")}</span></div><button class="title-select"><h2></h2></button><div class="folio-subtitle"></div><div class="folio-preview"></div><div class="working-content"><p class="synthetic">SYNTHETIC EXAMPLE CONTENT · EDITS STAY LOCAL</p>${desktopMode ? "" : `<label>Working draft<textarea spellcheck="false" aria-label="${r.type} working draft"></textarea></label>`}<p class="saved">Saved locally on this device</p></div><div class="folio-actions"><button class="unfold" aria-expanded="false">Unfold ↗</button><div class="move-controls"><button class="earlier" aria-label="Move ${r.type} earlier">←</button><button class="later" aria-label="Move ${r.type} later">→</button></div></div></div>`;
  const presentation = document.createElement("div");
  presentation.className = "resource-presentation";
  while (article.firstChild) presentation.append(article.firstChild);
  const selectionRim = document.createElement("div");
  selectionRim.className = "card-selection-rim";
  selectionRim.setAttribute("aria-hidden", "true");
  presentation.append(selectionRim);
  article.append(presentation);
  article.querySelector(".anchor-label b")!.textContent = r.title;
  article
    .querySelector(".resource-anchor")!
    .addEventListener("click", () => expand(id));
  article.querySelector("h2")!.textContent = r.title;
  article.querySelector(".folio-subtitle")!.textContent = r.subtitle;
  article.querySelector(".folio-preview")!.textContent =
    r.text.split("\n\n")[0];
  const editor = article.querySelector("textarea");
  if (editor) {
    editor.value = r.text;
    editor.maxLength = 100000;
    editor.addEventListener("input", () => {
      const oversized = editor.value.length > 100000;
      editor.value = editor.value.slice(0, 100000);
      r.text = editor.value;
      const ok = persist();
      article.querySelector(".saved")!.textContent = ok
        ? "Saved locally on this device"
        : "Storage unavailable · kept in this open window";
      if (oversized)
        status("Draft limit is 100,000 characters. Excess input was not saved.");
      article.querySelector(".folio-preview")!.textContent =
        r.text.split("\n\n")[0];
      interaction();
    });
  }
  // Delegate to the card so lazily mounted editors share the writing motion policy.
  article.addEventListener("focusin", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    quiet = true;
    document.body.classList.add("writing");
    wake();
  });
  article.addEventListener("focusout", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    if (
      event.relatedTarget instanceof HTMLTextAreaElement &&
      article.contains(event.relatedTarget)
    )
      return;
    quiet = $<HTMLInputElement>("#quiet").checked;
    document.body.classList.remove("writing");
    wake();
  });
  if (r.type === "conversation" && editor) {
    installConversation(
      article.querySelector<HTMLElement>(".working-content")!,
      editor,
      status,
      () => {
        document.body.dataset.related = id;
        showDialog("#vela-dialog", "#vela", true);
        setVela("receiving");
        $("#vela-answer").textContent =
          `Context: ${r.type}. Input stays local; no model is connected.`;
        $("#vela-input").focus();
      },
      () => expand("research-material"),
    );
  }
  article
    .querySelector(".title-select")!
    .addEventListener("click", () => select(id));
  article.querySelector(".unfold")!.addEventListener("click", () => expand(id));
  article
    .querySelector(".earlier")!
    .addEventListener("click", () => move(id, order.indexOf(id) - 1));
  article
    .querySelector(".later")!
    .addEventListener("click", () => move(id, order.indexOf(id) + 1));
  const grip = article.querySelector<HTMLButtonElement>(".grip")!;
  grip.addEventListener("keydown", (e) => {
    if (
      e.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      if (application) {
        void application.move(
          id,
          e.key === "ArrowLeft" ? -24 : e.key === "ArrowRight" ? 24 : 0,
          e.key === "ArrowUp" ? -24 : e.key === "ArrowDown" ? 24 : 0,
        );
        return;
      }
      move(
        id,
        order.indexOf(id) + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1),
      );
    }
  });
  grip.addEventListener("pointerdown", (e) => {
    if (expanded || e.button !== 0) return;
    if (application?.block(id)?.locked) {
      status("This block is locked. Unlock it in Properties to move it.");
      return;
    }
    interaction();
    selected = id;
    const p = motion.pose(id);
    drag = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      origin: p,
      before: [...order],
      slot: order.indexOf(id),
      moved: false,
    };
    grip.setPointerCapture(e.pointerId);
    if (application) {
      layout("drag pickup");
      return;
    }
    $("#destinations").innerHTML = order
      .map((_, i) => {
        const s = slotPose(i, innerWidth, innerHeight);
        return `<span style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px">${i + 1} / RELEASE HERE</span>`;
      })
      .join("");
    layout("drag pickup");
  });
  grip.addEventListener("pointermove", (e) => {
    if (drag?.id !== id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved ||=
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6;
    if (application) {
      (
        application as Application & {
          previewMove?: (id: string, dx: number, dy: number) => void;
        }
      ).previewMove?.(
        id,
        Math.round(drag.x - drag.startX),
        Math.round(drag.y - drag.startY),
      );
      layout("free drag");
      return;
    }
    const distances = order.map((_, i) => {
      const p = slotPose(i, innerWidth, innerHeight);
      return Math.hypot(e.clientX - p.x - p.w / 2, e.clientY - p.y - p.h / 2);
    });
    drag.slot = distances.indexOf(Math.min(...distances));
    [...$("#destinations").children].forEach((el, i) =>
      el.classList.toggle("destination", i === drag!.slot),
    );
    layout("drag retarget");
  });
  grip.addEventListener("pointerup", () => {
    if (drag?.id !== id) return;
    const d = drag;
    drag = null;
    $("#destinations").replaceChildren();
    if (d.moved && application)
      void application.move(
        id,
        Math.round(d.x - d.startX),
        Math.round(d.y - d.startY),
      );
    else if (d.moved) move(id, d.slot);
    else {
      select(id);
    }
    layout("drag settle");
  });
  grip.addEventListener("pointercancel", cancelDrag);
  $("#stage").append(article);
  elements.set(id, article);
  const working = article.querySelector(".working-content");
  if (working) workingFootprints?.track(id, working);
  motion.add(id, base(id));
  registerResourceMaterial(motion, id);
}

for (const [id, r] of resources) mountResource(id, r);

function replaceWorkspace(state: DesktopSnapshot) {
  const alive = new Set(state.blocks.map((b) => b.id));
  if (expanded && !alive.has(expanded)) expanded = null;
  if (selected && !alive.has(selected)) selected = null;
  for (const [id, article] of elements)
    if (!alive.has(id)) {
      workingFootprints?.release(id);
      article.remove();
      elements.delete(id);
      resources.delete(id);
      motion.bodies.delete(id);
      motion.bodies.delete(materialMotionKey(id));
      poseStyleCache.delete(id);
      focusedRailHeadings.get(id)?.remove();
      focusedRailHeadings.delete(id);
    }
  order = state.blocks.map((b) => b.id);
  for (const block of state.blocks) {
    const subject =
      block.subject && block.subject.kind !== "resource" ? block.subject : null;
    const resource = block.resource_id
      ? state.resources.find((r) => r.id === block.resource_id)
      : undefined;
    const subjectKind =
      subject?.kind === "project"
        ? "Project Overview"
        : subject?.kind === "collection"
          ? "Collection Browser"
          : "Resource Browser";
    const title =
      resource?.title ??
      (subject?.kind === "project"
        ? state.projects.find((p) => p.id === subject.projectId)?.title
        : undefined) ??
      (subject ? subjectKind : "Unavailable resource");
    const summary =
      resource?.content ??
      (subject?.kind === "resource-query"
        ? subject.query || "Browse canonical local resources"
        : subject?.kind === "collection"
          ? "Collection " + subject.collectionId.slice(0, 8)
          : "Canonical project workspaces, resources and local activity");
    const displayType: Resource["type"] =
      resource?.kind === "research"
        ? "research"
        : resource?.kind === "conversation"
          ? "conversation"
          : "note";
    let r = resources.get(block.id);
    const data = {
      id: block.id,
      canonicalId: resource?.id,
      type: displayType,
      title,
      subtitle: resource
        ? `${resource.kind} · ${resource.id.slice(0, 8)}`
        : subjectKind,
      text: summary,
    };
    const anchorChanged = !r || r.title !== title ||
      r.subtitle !== data.subtitle || r.canonicalId !== data.canonicalId;
    if (!r) {
      r = data;
      resources.set(block.id, r);
      mountResource(block.id, r);
    } else {
      const article = elements.get(block.id)!;
      if (r.type !== displayType) {
        article.classList.remove(r.type);
        article.classList.add(displayType);
      }
      if (r.title !== title) article.querySelector("h2")!.textContent = title;
      if (r.text !== summary)
        article.querySelector(".folio-preview")!.textContent = summary.split("\n\n")[0];
      Object.assign(r, data);
    }
    // Surface material classes are intentionally broader than resource kinds.
    // The accessible peripheral label always describes the canonical resource.
    if (!anchorChanged) continue;
    const article = elements.get(block.id)!;
    const anchor =
      article.querySelector<HTMLButtonElement>(".resource-anchor")!;
    const kind = resource?.kind.replaceAll("_", " ") ?? subjectKind;
    article.querySelector(".anchor-label small")!.textContent = kind;
    article.querySelector(".anchor-label b")!.textContent = title;
    anchor.setAttribute("aria-label", `Open ${kind}: ${title}`);
    anchor.title = `${kind}: ${title}`;
  }
}

function setVela(state: VelaState) {
  vela = state;
  const labels: Record<VelaState, string> = {
    idle: "Idle",
    receiving: "Receiving typed input",
    working: "Working",
    coordinating: "Coordinating fixture agents",
    attention: "Attention required",
    reported: "Reported complete · unverified",
    verified: "Fixture sequence check passed",
    unavailable: "Unavailable",
  };
  $("#vela-state").textContent =
    `${labels[state]} · ${desktopMode ? "application activity" : "synthetic"}`;
  $("#vela").setAttribute(
    "aria-label",
    `Address Vela. ${labels[state]}, ${desktopMode ? "application assistant" : "synthetic presence"}`,
  );
  $<HTMLSelectElement>("#vela-expression").value = state;
  document.body.dataset.vela = state;
  interaction();
}
function showDialog(id: string, button: string, show: boolean) {
  $(id).hidden = !show;
  if (id === "#stream") $("#vela").toggleAttribute("data-demo-stream-visible", show);
  $(button).setAttribute("aria-expanded", String(show));
  if (show)
    $(id)
      .querySelector<HTMLButtonElement>(".dialog-top button")
      ?.focus({ preventScroll: true });
  interaction();
}
$("#vela").addEventListener("click", () => {
  if (application) {
    application.openVela();
    return;
  }
  const open = $("#vela-dialog").hidden;
  showDialog("#vela-dialog", "#vela", open);
  if (open) {
    setVela("receiving");
    $<HTMLTextAreaElement>("#vela-input").focus();
  } else setVela("idle");
});
$("#vela-close").addEventListener("click", () => {
  showDialog("#vela-dialog", "#vela", false);
  setVela("idle");
  $("#vela").focus();
});
$("#vela-send").addEventListener("click", () => {
  const input = $<HTMLTextAreaElement>("#vela-input");
  if (!input.value.trim()) return;
  $("#vela-answer").textContent =
    "Received locally. An AI response is unavailable in this visual experiment.";
  event(
    "Local input",
    "Vela",
    "input.received",
    "Typed input received locally. Its text is not copied into the event stream.",
  );
  setVela("receiving");
});
$("#vela-expression").addEventListener("change", (e) =>
  setVela((e.target as HTMLSelectElement).value as VelaState),
);
$("#settings-button").addEventListener("click", () =>
  showDialog("#settings", "#settings-button", $("#settings").hidden),
);
$("#settings-close").addEventListener("click", () => {
  showDialog("#settings", "#settings-button", false);
  $("#settings-button").focus();
});
if (!desktopMode)
  $("#stream-button").addEventListener("click", () =>
    showDialog("#stream", "#stream-button", $("#stream").hidden),
  );
$("#stream-close").addEventListener("click", () => {
  showDialog("#stream", "#stream-button", false);
  $("#stream-button").focus();
});
$("#home").addEventListener("click", home);
$("#undo").addEventListener("click", () => {
  if (application) {
    void application.run({ type: "undo" });
    return;
  }
  const previous = undoStack.pop();
  if (previous) {
    order = previous;
    persist();
    layout("undo");
    event(
      "Workspace",
      "layout",
      "layout.undo",
      "Previous ID arrangement restored.",
    );
  }
  if (!undoStack.length) $("#undo").setAttribute("disabled", "");
});
$("#study").addEventListener("change", (e) => {
  study = (e.target as HTMLSelectElement).value as Study;
  retargetScene(motion, study);
  $("#study-index").textContent = {
    architecture: "01 / LUMINOUS ARCHITECTURE",
    living: "02 / LIVING INTELLIGENCE",
    observatory: "03 / AETHERIC OBSERVATORY",
  }[study];
  document.body.dataset.study = study;
  document
    .querySelectorAll<HTMLButtonElement>("[data-scene]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scene === study),
      ),
    );
  wake();
});
document
  .querySelectorAll<HTMLButtonElement>("[data-scene]")
  .forEach((button) => {
    button.addEventListener("click", () =>
      window.__aerynth.setStudy(button.dataset.scene as Study),
    );
  });
$("#architecture-concept").addEventListener("change", (e) => {
  architectureConcept = (e.target as HTMLSelectElement)
    .value as ArchitectureConcept;
  wake();
});
$("#quality").addEventListener("change", (e) => {
  quality = (e.target as HTMLSelectElement).value as Quality;
  wake();
});
$("#celestial-study").addEventListener("change", (e) => {
  celestialStudy = (e.target as HTMLSelectElement).value as CelestialStudy;
  wake();
});
$("#instrument-study").addEventListener("change", (e) => {
  instrumentStudy = (e.target as HTMLSelectElement).value as InstrumentStudy;
  document.body.dataset.instrumentStudy = instrumentStudy;
  wake();
});
$("#ambient").addEventListener("change", (e) => {
  ambient = (e.target as HTMLInputElement).checked;
  wake();
});
$("#ambient-strength").addEventListener("change", (e) => {
  ambientStrength = Number((e.target as HTMLSelectElement).value);
  wake();
});
function reducedPolicy() {
  motion.reduced = manualReduced || osReduced.matches;
  document.body.classList.toggle("reduced", motion.reduced);
  $<HTMLInputElement>("#reduced").checked = motion.reduced;
  wake();
}
$("#reduced").addEventListener("change", (e) => {
  manualReduced = (e.target as HTMLInputElement).checked;
  reducedPolicy();
});
osReduced.addEventListener("change", reducedPolicy);
forcedColors.addEventListener("change", () => wake());
reducedPolicy();
$("#quiet").addEventListener("change", (e) => {
  quiet = (e.target as HTMLInputElement).checked;
  wake();
});
function stopDemo(cancelled = false) {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = null;
  $("#demo span").textContent = "Run synthetic sequence";
  if (cancelled) {
    event(
      "Demo controller",
      "workspace",
      "execution.cancelled",
      "Synthetic sequence cancelled; no work executed.",
      "synthetic",
    );
    setVela("idle");
  }
  delete document.body.dataset.related;
  for (const el of elements.values()) el.classList.remove("related");
  wake();
}
function demoStep() {
  const step = demoSteps[demoIndex++];
  if (!step) {
    stopDemo();
    return;
  }
  if (step.state === "verified") {
    if (!validateDemoPrefix(events, runId)) {
      setVela("attention");
      event(
        "Local demo validator",
        "workspace",
        "fixture.check.failed",
        "Recorded fixture sequence did not match its expected ordered prefix. No result verified.",
        "local-observed",
        runId,
      );
      stopDemo();
      status("Fixture sequence validation failed.");
      return;
    }
    setVela("verified");
    event(
      step.source,
      step.resource,
      step.kind,
      step.detail,
      "local-observed",
      runId,
    );
  } else {
    setVela(step.state);
    event(step.source, step.resource, step.kind, step.detail, "synthetic");
  }
  document.body.dataset.related = step.resource;
  for (const [id, el] of elements)
    el.classList.toggle(
      "related",
      id === step.resource && step.state !== "idle",
    );
  if (step.state === "verified")
    status(
      "Synthetic event sequence checked. No artistic or agent result is verified.",
    );
}
$("#demo").addEventListener("click", () => {
  if (demoTimer) {
    stopDemo(true);
    return;
  }
  runId = `synthetic-${Date.now().toString(36)}`;
  demoIndex = 0;
  $("#demo span").textContent = "Stop synthetic sequence";
  showDialog("#stream", "#stream-button", true);
  demoStep();
  demoTimer = setInterval(demoStep, 1600);
});
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (e.key === "Escape") {
    if (!$("#settings").hidden) {
      showDialog("#settings", "#settings-button", false);
      $("#settings-button").focus();
    } else if (!$("#vela-dialog").hidden) {
      showDialog("#vela-dialog", "#vela", false);
      setVela("idle");
      $("#vela").focus();
    } else if (!$("#stream").hidden) {
      showDialog("#stream", "#stream-button", false);
      $("#stream-button").focus();
    } else home();
  }
  if (e.altKey && e.key.toLowerCase() === "v") {
    e.preventDefault();
    $("#vela").click();
  }
});
addEventListener("pointermove", (e) => {
  const nextPointer = {
    x: (e.clientX / innerWidth) * 2 - 1,
    y: 1 - (e.clientY / innerHeight) * 2,
  };
  // Layout can synthesize hover movement under a stationary pointer. It is not user activity.
  if (
    Math.abs(nextPointer.x - pointer.x) < 1 / innerWidth &&
    Math.abs(nextPointer.y - pointer.y) < 1 / innerHeight
  )
    return;
  pointer = nextPointer;
  if (!quiet && !motion.reduced) {
    pointerDirty = true;
    wake(false);
  }
});
addEventListener("resize", () => {
  statusMetricsDirty = true;
  cancelDrag();
  layout("viewport retarget");
});
addEventListener("error", (e) => metrics.errors.push(e.message));
function lifecycle(active: boolean) {
  nativeActive = active;
  for (const id of order) {
    if (!active) application?.setBlockPresentation(id, false, false);
    application?.setBlockActive(
      id,
      active && !document.hidden && expanded === id,
    );
  }
  if (!active) {
    cancelAnimationFrame(raf);
    clearTimeout(schedulerTimer);
    schedulerTimer = 0;
    raf = 0;
    for (const id of order) {
      motion.snap(id);
      motion.snap(materialMotionKey(id));
    }
    renderDOM();
  } else wake();
}
document.addEventListener("visibilitychange", () => {
  if (!renderWhileVisible) lifecycle(!document.hidden);
});
addEventListener("blur", () => {
  if (!renderWhileVisible) lifecycle(false);
});
addEventListener("focus", () => {
  if (!renderWhileVisible) lifecycle(true);
});
declare global {
  interface Window {
    aerynthHost?: {
      renderWhileVisible?: boolean;
      geometryObservation?: boolean;
      copyText?: (text: string) => Promise<unknown>;
      onActive: (listener: (active: boolean) => void) => void;
      command?: (name: string, input: unknown) => Promise<unknown>;
      onEvent?: (listener: (event: unknown) => void) => () => void;
    };
    __aerynth: ReturnType<typeof controller>;
  }
}
window.aerynthHost?.onActive(lifecycle);

function velaPlacementClip({ x, y, w, h }: Pick<ReturnType<typeof motion.pose>, "x" | "y" | "w" | "h">) {
  return materialCompositor.clipOverlay({
    id: "vela-dom-presentation", x, y, w, h, lift: 0, yaw: 0, opacity: 1,
  });
}
function velaPlacementUnclipped(pose: ReturnType<typeof motion.pose>) {
  return !velaPlacementClip(pose);
}
function renderDOM() {
  surfaceView = (
    application as (Application & { surfaceView?: () => SurfaceView }) | null
  )?.surfaceView?.() ?? { scale: 1, originX: 0, originY: 0 };
  const workspaceVisible = workspaceSurfacesVisible();
  const compactViewport = innerWidth < 1000;
  const projected = order.map((id) => {
    const p = motion.pose(id), block = presentationBlock(id);
    const gesture = application?.directGesture(id);
    const unfold = resourceUnfold(motion, id);
    const type = resources.get(id)!.type;
    const kind: Resource["type"] = compactViewport && type === "research" ? "conversation" : type;
    return {
      id,
      ...p,
      kind,
      unfold,
      selected: id === selected,
      selection: resourceSelection(motion, id),
      shape: block?.shape ?? defaultSurfaceShape(type),
      rotation: (block?.rotation ?? 0) * (1 - unfold),
      presentationLayer: gesture?.fromFocusedSide ? 2 :
        expanded === id || unfold > 0.001 ? 1 : 0,
      zIndex:
        expanded === id
          ? 200000
          : desktopMode
            ? directCardLayer(block?.z ?? 0, gesture)
            : drag?.id === id
              ? 150000
              : selected === id
                ? 100000
                : 3,
    };
  });
  const composite = materialCompositor.update(projected, surfaceView);
  application?.completeWorkspaceArrival(velaPlacementUnclipped);
  for (const p of projected) {
    const id = p.id,
      el = elements.get(id)!;
    // Keep every host-added control in the same full-size paint clip. Move
    // existing nodes only; article/editor identities and their state persist.
    const presentation = el.querySelector<HTMLElement>(
      ".resource-presentation",
    )!;
    if (el.childElementCount > 1)
      for (let child = el.firstElementChild; child; ) {
        const next = child.nextElementSibling;
        if (child !== presentation) presentation.append(child);
        child = next;
      }
    const compositing = materialCompositor.get(id)!;
    if (el.dataset.materialCovered !== String(compositing.covered))
      el.dataset.materialCovered = String(compositing.covered);
    const unfold = p.unfold;
    const dock = resourceDock(motion, id);
    const heading = focusedRailHeadings.get(id);
    if (heading) {
      if (!expanded && dock <= .001) {
        heading.remove();
        focusedRailHeadings.delete(id);
      } else {
        heading.hidden = p.y < 152 || p.y > innerHeight - 100;
        heading.style.transform = `translate(${p.x}px, ${p.y - 18}px)`;
        heading.style.width = `${p.w}px`;
        heading.style.opacity = String(dock);
      }
    }
    const hidden =
      p.x + p.w < 0 ||
      p.y + p.h < 120 ||
      p.x > innerWidth ||
      p.y > innerHeight - 100;
    if (el.hidden !== hidden) el.hidden = hidden;
    const visible =
      nativeActive &&
      !document.hidden &&
      workspaceVisible &&
      !hidden &&
      !el.classList.contains("receded") &&
      p.opacity > 0.01;
    const target = motion.bodies.get(id)!.channels;
    const usable = visible && (application?.blockWorkingEligible(
      id, el, p, { w: target.w.target, h: target.h.target },
    ) ?? true);
    // Readable cards are working surfaces even when partly outside the window.
    application?.setBlockPresentation(
      id,
      visible,
      usable,
      expanded === id ? "focused" : "workspace",
    );
    workingFootprints?.setVisible(id, visible);
    // Keep the mounted editor and its view state while offscreen. Paint its
    // latest pose on re-entry, without updating invisible CSS on each frame.
    if (hidden || !workspaceVisible) continue;
    const selection = String(p.selection);
    if (presentation.style.getPropertyValue("--card-selection") !== selection)
      presentation.style.setProperty("--card-selection", selection);
    const body = visible ? workingFootprints?.read(id) : undefined;
    if (body)
      application?.setBlockFootprint(id, {
        width: p.w,
        height: p.h,
        bodyWidth: body.width,
        bodyHeight: body.height,
      });
    const radius = surfaceBorderRadius(p.shape, p.w, p.h, unfold);
    const style = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--lift:${p.lift};--opacity:${p.opacity};--unfold:${unfold};--dock:${dock};transform:perspective(1500px) translateZ(${p.lift}px) rotateZ(${p.rotation}deg) rotateY(${p.yaw}deg);z-index:${compositing.rank + 3};border-radius:${radius};clip-path:inset(0 round ${radius});--resource-content-clip:${compositing.clipPath || "none"};`;
    if (poseStyleCache.get(id) !== style) {
      applyBlockPoseStyle(el.style, style);
      poseStyleCache.set(id, style);
    }
  }
  if (desktopMode && statusNode.textContent) {
    if (statusMetricsDirty) {
      statusWidth = Math.max(128, statusNode.scrollWidth);
      statusChrome = [
        ...document.querySelectorAll<HTMLElement>(".keys,.provenance"),
      ]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      statusMetricsDirty = false;
    }
    const obstacles = [...statusChrome];
    const presence = (
      application as
        | (Application & {
            presenceCard?: () =>
              | { x: number; y: number; w: number; h: number }
              | undefined;
          })
        | null
    )?.presenceCard?.();
    if (presence)
      obstacles.push({
        left: presence.x,
        top: presence.y,
        right: presence.x + presence.w,
        bottom: presence.y + presence.h,
      });
    if (workspaceVisible)
      for (const entry of composite) {
        const node = elements.get(entry.id);
        if (
          entry.valid &&
          !entry.covered &&
          entry.pose.opacity > 0.01 &&
          node &&
          !node.hidden &&
          !node.classList.contains("receded")
        )
          obstacles.push(entry);
      }
    const placement = placeStatus({
      width: innerWidth,
      height: innerHeight,
      desiredWidth: statusWidth,
      obstacles,
    });
    const signature = `${placement.left}:${placement.width}:${placement.bottom}:${placement.placement}`;
    if (signature !== lastStatusPlacement) {
      statusNode.style.setProperty("--status-left", `${placement.left}px`);
      statusNode.style.setProperty(
        "--status-max-width",
        `${placement.width}px`,
      );
      statusNode.style.setProperty("--status-bottom", `${placement.bottom}px`);
      document.body.dataset.statusPlacement = placement.placement;
      lastStatusPlacement = signature;
    }
  }
  const target = document.body.dataset.related;
  const visible =
    !!target && elements.has(target) && !["idle", "unavailable"].includes(vela);
  const path = $<SVGPathElement & HTMLElement>("#relationships path");
  if (visible) {
    const p = motion.pose(target!);
    const start = {
      x: innerWidth * (expanded ? 0.88 : 0.63),
      y: innerHeight * (expanded ? 0.32 : 0.4),
    };
    const end = { x: p.x + p.w * 0.5, y: p.y + 8 };
    path.setAttribute(
      "d",
      `M${start.x},${start.y} C${start.x},${end.y} ${end.x},${start.y} ${end.x},${end.y}`,
    );
    path.style.opacity = String(0.2 + attention * 0.55);
  } else path.style.opacity = "0";
  return { workspaceVisible, projected };
}
function tick(now: number) {
  raf = 0;
  if (!running || !nativeActive || document.hidden) return;
  // Synchronous host/layer invalidation requests the next existing frame;
  // it cannot start a second RAF chain while the current frame is executing.
  frameRunning = true;
  wakeRequested = false;
  try {
    const interval = Math.max(0, now - lastFrame);
    const dt = Math.min(interval / 1000, 0.12);
    lastFrame = now;
    visualClock += dt * 1000;
    metrics.callbacks++;
    if (metrics.intervals.length < 18000) metrics.intervals.push(interval);
    const moving = motion.step(dt);
    application?.frame(now, {
      tier: quality,
      reduced: motion.reduced,
      quiet,
      hidden: !nativeActive || document.hidden,
      graphicsAvailable: !graphicsFailed,
    });
    const targetFocus = expanded ? 1 : 0;
    focus = motion.reduced
      ? targetFocus
      : focus + (targetFocus - focus) * (1 - Math.exp(-dt * 10));
    const targetAttention = vela === "idle" || vela === "unavailable" ? 0 : 1;
    attention = motion.reduced
      ? targetAttention
      : attention + (targetAttention - attention) * (1 - Math.exp(-dt * 7));
    const { workspaceVisible, projected } = renderDOM();
    document.body.style.setProperty("--scene-focus", String(focus));
    const idle = now - lastInteraction > 12000;
    const activeQuality: Quality = quiet ? "efficient" : quality;
    const transitioning =
      moving ||
      Math.abs(focus - targetFocus) > 0.001 ||
      Math.abs(attention - targetAttention) > 0.001;
    const policy = motionPolicy({
      tier: activeQuality,
      idle,
      quiet,
      reduced: motion.reduced,
      ambient,
      unavailable: vela === "unavailable",
      transitioning,
    });
    const cadence = policy.cadenceMs;
    const pointerCadence =
      activeQuality === "cinematic"
        ? 0
        : activeQuality === "balanced"
          ? 1000 / 60
          : 1000 / 15;
    const shouldDraw =
      dirty ||
      (transitioning && activeQuality !== "efficient") ||
      (policy.continuous &&
        (now + DRAW_EARLY_TOLERANCE_MS >= nextDraw ||
          !Number.isFinite(nextDraw))) ||
      (pointerDirty &&
        now - lastDraw >= pointerCadence - DRAW_EARLY_TOLERANCE_MS);
    if (shouldDraw) {
      if (environment && !graphicsFailed) {
        // DOM, compositing and WebGL use the same projected pose for this frame.
        const surfaces = workspaceVisible
          ? projected.filter(({ id }) => !elements.get(id)?.hidden)
          : [];
        const scene = deriveSceneState({
          selected,
          expanded,
          related: ["idle", "unavailable"].includes(vela)
            ? null
            : (document.body.dataset.related ?? null),
          dragging: !!drag || !!application?.directDragging(),
          focus,
          attention,
          ambient,
          ambientStrength,
          quiet,
          visible: nativeActive && !document.hidden,
          reduced: motion.reduced,
          vela,
          pointer,
          surfaces,
          width: innerWidth,
          height: innerHeight,
        });
        sceneState = scene;
        environment.setSpatialLayer(
          (
            application as
              | (Application & {
                  spatialLayer?: () =>
                    | import("../../../constellation/spatial-types.ts").SpatialRenderLayer
                    | null;
                })
              | null
          )?.spatialLayer?.() ?? null,
        );
        environment.render({
          time: motion.reduced ? 0 : visualClock,
          focus: scene.focus,
          attention: scene.attention,
          pointer: scene.pointer,
          inputPointer: motion.reduced ? { x: 0, y: 0 } : pointer,
          interaction: scene.interaction,
          vela,
          study,
          sceneWeights: sceneWeights(motion),
          architectureConcept,
          celestialStudy,
          instrumentStudy,
          architecturePhase: environmentPhase,
          quality: activeQuality,
          reduced: motion.reduced,
          width: innerWidth,
          height: innerHeight,
          surfaces,
          surfaceView,
          quiet,
          workspaceGrid: forcedColors.matches
            ? null
            : application?.workspaceGrid(),
          presencePlacement:
            presenceReviewScale !== null
              ? undefined
              : (
                  application as
                    | (Application & {
                        presence?: () => {
                          x: number;
                          y: number;
                          w: number;
                          h: number;
                        };
                      })
                    | null
                )?.presence?.(),
          presenceScale: presenceReviewScale ?? (desktopMode ? 0.65 : 1),
          presencePhase: presenceReviewPhase ?? undefined,
          ambientStrength: scene.ambientStrength,
        });
        const actualVela = environment.presenceBounds();
        application?.manifestationAfterRender({
          x: actualVela.x,
          y: actualVela.y,
          width: actualVela.w,
          height: actualVela.h,
        });
        const presenceCard = (
          application as
            | (Application & {
                presenceCard?: () => {
                  x: number;
                  y: number;
                  w: number;
                  h: number;
                };
              })
            | null
        )?.presenceCard?.();
        const presence = presenceCard ?? environment.presenceBounds();
        // Engine-owned cards use the exact same rectangle as GPU placement.
        // Independent DOM clamping/minimum sizes would detach the drag target.
        const presenceWidth = Math.max(presenceCard ? 1 : 44, presence.w),
          presenceHeight = Math.max(presenceCard ? 1 : 44, presence.h);
        const presenceX = presenceCard
            ? presence.x
            : clamp(presence.x, 4, innerWidth - presenceWidth - 4),
          presenceY = presenceCard ? presence.y : Math.max(100, presence.y);
        Object.assign($("#vela").style, {
          left: `${presenceX}px`,
          top: `${presenceY}px`,
          width: `${presenceWidth}px`,
          height: `${presenceHeight}px`,
          clipPath:
            document.body.classList.contains("vela-access") ||
            !workspaceSurfacesVisible()
              ? "none"
              : velaPlacementClip({ x: presenceX, y: presenceY, w: presenceWidth, h: presenceHeight }) || "none",
        });
        if (lastDraw && metrics.drawIntervals.length < 18000)
          metrics.drawIntervals.push(now - lastDraw);
        lastDraw = now;
        metrics.draws++;
        metrics.lastDraw = now;
        if (observeGeometry) {
          const submitted = new Map(
            environment
              .surfaceSubmissionGeometry()
              .map((item) => [item.id, item]),
          );
          dragGlideFrame = {
            drawSequence: metrics.draws,
            rendererNowMs: now,
            reduced: motion.reduced,
            cards: surfaces.slice(0, 50).map((surface) => {
              const node = elements.get(surface.id)!,
                rect = node.getBoundingClientRect(),
                body = motion.bodies.get(surface.id)!;
              return {
                id: surface.id,
                gesture: application?.directGesture(surface.id) ?? null,
                selection: resourceSelection(motion, surface.id),
                pose: motion.pose(surface.id),
                target: Object.fromEntries(
                  Object.entries(body.channels).map(([key, channel]) => [
                    key,
                    channel.target,
                  ]),
                ),
                outline: application?.directOutline(surface.id) ?? null,
                gpuProjection: submitted.get(surface.id) ?? null,
                domRect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
                domTransform: getComputedStyle(node).transform,
              };
            }),
            grid: application?.workspaceGrid() ?? null,
          };
        }
      }
      nextDraw = nextDrawDeadline(now, nextDraw, cadence, dirty);
      dirty = false;
      pointerDirty = false;
    }
    if (inputAt) {
      metrics.inputFeedback.push(now - inputAt);
      if (metrics.inputFeedback.length > 1024) metrics.inputFeedback.shift();
      inputAt = 0;
    }
    metrics.policy = `${activeQuality} / ${motion.reduced ? "reduced" : quiet ? "quiet" : !ambient ? "ambient off" : idle ? "ambient idle" : "active"}`;
    const policyLabel = $("#policy");
    if (policyLabel.textContent !== metrics.policy)
      policyLabel.textContent = metrics.policy;
    if (transitioning || policy.continuous || pointerDirty || wakeRequested) {
      if (
        !transitioning &&
        !wakeRequested &&
        policy.continuous &&
        (idle || activeQuality === "efficient")
      )
        schedulerTimer = window.setTimeout(
          () => {
            schedulerTimer = 0;
            raf = requestAnimationFrame(tick);
          },
          Math.max(1, nextDraw - performance.now() - 1),
        );
      else raf = requestAnimationFrame(tick);
    }
  } finally {
    frameRunning = false;
  }
}
function controller() {
  return {
    snapshot: () => ({
      order: [...order],
      selected,
      expanded,
      study,
      architectureConcept,
      celestialStudy,
      instrumentStudy,
      environmentPhase,
      presenceReviewPhase,
      sceneWeights: sceneWeights(motion),
      quality,
      vela,
      ambient,
      ambientStrength,
      visualClock,
      scene: sceneState,
      reduced: motion.reduced,
      active: nativeActive,
      graphicsFailed,
      resources: [...resources.values()].map((r) => ({
        id: r.id,
        text: r.text,
      })),
      events: [...events],
      receipts: [...motion.receipts],
      poses: Object.fromEntries(order.map((id) => [id, motion.pose(id)])),
      dragGlideFrame:
        observeGeometry && dragGlideFrame
          ? structuredClone(dragGlideFrame)
          : null,
      materialUnfold: Object.fromEntries(
        order.map((id) => [id, resourceUnfold(motion, id)]),
      ),
      metrics: { ...metrics },
      gpu: environment?.stats(),
      compositing: materialCompositor.diagnostics(),
      spatial: (
        application as
          | (Application & { spatialDiagnostics?: () => unknown })
          | null
      )?.spatialDiagnostics?.(),
    }),
    // Native synthetic review only: transient poses stay in the existing
    // coordinator and never write or compete with canonical engine geometry.
    previewForReview: (
      updates: { id: string; pose: Partial<Pose> }[],
      snap = false,
    ) => {
      for (const update of updates)
        if (elements.has(update.id)) {
          motion.target(
            update.id,
            { ...motion.pose(update.id), ...update.pose },
            "synthetic material review",
          );
          if (snap) motion.snap(update.id);
        }
      wake();
    },
    application: () => application?.snapshot(),
    openResource: (input: ResourceOpeningInput) =>
      application?.openResource(input),
    setPresenceScaleForReview: (scale: number | null) => {
      if (
        scale !== null &&
        (!Number.isFinite(scale) || scale < 0.2 || scale > 2)
      )
        return;
      presenceReviewScale = scale;
      wake();
    },
    setPresencePhaseForReview: (seconds: number | null) => {
      if (
        seconds !== null &&
        (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
      )
        return;
      presenceReviewPhase = seconds;
      wake();
    },
    presenceMaskForReview: () => environment?.capturePresenceMaskForReview(),
    execute: (command: DesktopCommand) => application?.run(command),
    flush: () => application?.flush(),
    select,
    expand,
    home,
    move,
    setVela,
    setAmbient: (value: boolean) => {
      $<HTMLInputElement>("#ambient").checked = value;
      $("#ambient").dispatchEvent(new Event("change"));
    },
    setStudy: (s: Study) => {
      if (!["architecture", "living", "observatory"].includes(s)) return;
      $<HTMLSelectElement>("#study").value = s;
      $("#study").dispatchEvent(new Event("change"));
    },
    setArchitectureConcept: (concept: ArchitectureConcept) => {
      if (!["ring", "aperture", "observatory"].includes(concept)) return;
      $<HTMLSelectElement>("#architecture-concept").value = concept;
      $("#architecture-concept").dispatchEvent(new Event("change"));
    },
    setCelestialStudy: (value: CelestialStudy) => {
      if (!["starlit", "shadow", "deep"].includes(value)) return;
      $<HTMLSelectElement>("#celestial-study").value = value;
      $("#celestial-study").dispatchEvent(new Event("change"));
    },
    setEnvironmentPhase: (seconds: number | null) => {
      if (
        seconds !== null &&
        (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
      )
        return;
      environmentPhase = seconds;
      wake();
    },
    setInstrumentStudy: (value: InstrumentStudy) => {
      if (!["optical", "engineered", "composite"].includes(value)) return;
      $<HTMLSelectElement>("#instrument-study").value = value;
      $("#instrument-study").dispatchEvent(new Event("change"));
    },
    setQuality: (q: Quality) => {
      quality = q;
      $<HTMLSelectElement>("#quality").value = q;
      wake();
    },
    setReduced: (value: boolean) => {
      manualReduced = value;
      reducedPolicy();
    },
    resetMetrics: () => {
      metrics.draws = 0;
      metrics.callbacks = 0;
      metrics.intervals = [];
      metrics.drawIntervals = [];
      metrics.inputFeedback = [];
    },
    setActive: lifecycle,
    demo: () => $("#demo").click(),
    stopDemo,
    simulateContextLoss: () => {
      environment?.loseContextForTest();
    },
    restoreContext: () => {
      environment?.restoreContextForTest();
    },
  };
}
window.__aerynth = controller();
if (desktopMode)
  application = installApplication({
    motion,
    wake,
    workingBodyWidth: (id) => workingFootprints?.read(id)?.width,
    selectedCard: () => selected,
    replace: replaceWorkspace,
    status,
    layout: () => layout("application state"),
    home,
    focus: (id) => {
      const focus = () => {
        if (!elements.has(id)) return;
        if (expanded !== id) expand(id);
        else
          elements
            .get(id)
            ?.querySelector<HTMLTextAreaElement>("textarea")
            ?.focus();
      };
      // Opening expresses Restore even while IME still defers physical shrink.
      if (application?.block(id)?.minimized === true)
        void application
          .setBlockMinimized(id, false)
          .then(focus)
          .catch((error) => status(String(error.message ?? error)));
      else focus();
    },
    vela: setVela,
  });
try {
  environment = new Environment($<HTMLCanvasElement>("#world"));
} catch (error) {
  graphicsFailed = true;
  metrics.errors.push(String(error));
  status(
    "Graphics unavailable. The workspace remains usable in a simplified view.",
  );
  document.body.classList.add("graphics-fallback");
}
$("#world").addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  graphicsFailed = true;
  document.body.classList.add("graphics-fallback");
  status("Graphics interrupted. Your resources and drafts remain available.");
});
$("#world").addEventListener("webglcontextrestored", () => {
  try {
    environment?.dispose();
    environment = new Environment($<HTMLCanvasElement>("#world"));
    graphicsFailed = false;
    document.body.classList.remove("graphics-fallback");
    status("Graphics restored. Workspace state retained.");
    wake();
  } catch (error) {
    metrics.errors.push(String(error));
  }
});
renderDOM();
layout("initial");
