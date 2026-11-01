import { installApplication, type Application } from "./application";
import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";
import type { Resource } from "./store";
import "./style.css";
import { motionPolicy } from "./policy";
import { deriveSceneState } from "./scene-state";
import { registerScene, retargetScene, sceneWeights } from "./scene-transition";
import { overlappingSurfaceIds } from "./material-occlusion";
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
app.innerHTML = `
  <canvas id="world" aria-hidden="true"></canvas>
  <div class="scene-vignette" aria-hidden="true"></div>
  <div class="window-drag" aria-hidden="true"><span>AERYNTH <i>·</i> THE QUIET ATELIER</span></div>
  <header class="topbar">
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
let selected: string | null = null,
  expanded: string | null = null,
  quiet = false;
let study: Study = "architecture",
  quality: Quality = "balanced",
  vela: VelaState = "idle";
let architectureConcept: ArchitectureConcept = "ring";
document.body.dataset.study = study;
let celestialStudy: CelestialStudy = "starlit";
let instrumentStudy: InstrumentStudy = "optical";
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
let manualReduced = false;
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
  $("#status").textContent = text;
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
function restAt(id: string, slot: number) {
  const block = application?.block(id);
  if (block) {
    const offset = application!.offset();
    return {
      x: block.x + offset.x,
      y: block.y + offset.y,
      w: block.width,
      h: block.height,
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
function layout(cause: string) {
  for (const id of order) {
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
    } else if (expanded) {
      p = {
        ...p,
        x: innerWidth >= 1100 ? 24 : 16,
        y:
          238 +
          order.filter((key) => key !== expanded).indexOf(id) *
            (innerWidth >= 1100 ? 100 : 88),
        w: innerWidth >= 1100 ? 176 : 56,
        h: innerWidth >= 1100 ? 76 : 64,
        lift: -4,
        yaw: 0,
        opacity: 0.8,
      };
    } else if (selected === id) {
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
    motion.target(id, p, cause);
    const el = elements.get(id)!;
    el.classList.toggle("selected", selected === id);
    el.classList.toggle("expanded", expanded === id);
    el.classList.toggle("receded", !!expanded && expanded !== id);
    el.classList.toggle("dragging", drag?.id === id);
    const receded = !!expanded && expanded !== id;
    (el.querySelector(".folio-inner") as HTMLElement).inert = receded;
    el.querySelector(".folio-inner")!.setAttribute(
      "aria-hidden",
      String(receded),
    );
    el.querySelector<HTMLButtonElement>(".resource-anchor")!.tabIndex = receded
      ? 0
      : -1;
    el.querySelector(".resource-anchor")!.setAttribute(
      "aria-hidden",
      String(!receded),
    );
    el.inert = false;
    el.querySelector(".unfold")!.textContent =
      expanded === id ? "Return to workspace ↙" : "Unfold ↗";
    el.querySelector(".unfold")!.setAttribute(
      "aria-expanded",
      String(expanded === id),
    );
  }
  document.body.classList.toggle("focused", !!expanded);
  $("#home").setAttribute("aria-current", expanded ? "false" : "page");
  document.body.classList.toggle("drag-active", !!drag);
  if (!nativeActive || document.hidden) {
    for (const id of order) motion.snap(id);
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
    `${resources.get(id)!.title} selected. Unfold to work; drag its grip to rearrange.`,
  );
}
function expand(id: string) {
  if (drag) return;
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
  article.innerHTML = `<button class="resource-anchor" aria-label="Open ${r.type}" title="${r.type}" tabindex="-1"><span class="anchor-glyph" aria-hidden="true">${r.type === "research" ? "◌" : r.type === "note" ? "⌁" : "≋"}</span><span class="anchor-label"><small>${r.type}</small><b></b></span></button><div class="folio-edge" aria-hidden="true"></div><div class="folio-inner"><div class="folio-top"><button class="grip" aria-label="Move ${r.type}. Alt plus arrow keys reorders; Escape cancels drag." title="Drag to move · Alt+←/→">⠿ <span>${r.type.toUpperCase()}</span></button><span class="folio-number">${String(order.indexOf(id) + 1).padStart(2, "0")}</span></div><button class="title-select"><h2></h2></button><div class="folio-subtitle"></div><div class="folio-preview"></div><div class="working-content"><p class="synthetic">SYNTHETIC EXAMPLE CONTENT · EDITS STAY LOCAL</p><label>Working draft<textarea spellcheck="false" aria-label="${r.type} working draft"></textarea></label><p class="saved">Saved locally on this device</p></div><div class="folio-actions"><button class="unfold" aria-expanded="false">Unfold ↗</button><div class="move-controls"><button class="earlier" aria-label="Move ${r.type} earlier">←</button><button class="later" aria-label="Move ${r.type} later">→</button></div></div></div>`;
  article.querySelector(".anchor-label b")!.textContent = r.title;
  article
    .querySelector(".resource-anchor")!
    .addEventListener("click", () => expand(id));
  article.querySelector("h2")!.textContent = r.title;
  article.querySelector(".folio-subtitle")!.textContent = r.subtitle;
  article.querySelector(".folio-preview")!.textContent =
    r.text.split("\n\n")[0];
  const editor = article.querySelector("textarea")!;
  editor.value = r.text;
  editor.maxLength = 100000;
  editor.addEventListener("input", () => {
    const oversized = editor.value.length > 100000;
    editor.value = editor.value.slice(0, 100000);
    r.text = editor.value;
    if (application) {
      application.saveContent(r.canonicalId!, r.text, article);
      article.querySelector(".folio-preview")!.textContent =
        r.text.split("\n\n")[0];
      interaction();
      return;
    }
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
  editor.addEventListener("focus", () => {
    quiet = true;
    document.body.classList.add("writing");
    wake();
  });
  editor.addEventListener("blur", () => {
    quiet = $<HTMLInputElement>("#quiet").checked;
    document.body.classList.remove("writing");
    wake();
  });
  if (r.type === "conversation" && !desktopMode) {
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
  motion.add(id, base(id));
}

for (const [id, r] of resources) mountResource(id, r);

function replaceWorkspace(state: DesktopSnapshot) {
  const alive = new Set(state.blocks.map((b) => b.id));
  if (expanded && !alive.has(expanded)) expanded = null;
  if (selected && !alive.has(selected)) selected = null;
  for (const [id, article] of elements)
    if (!alive.has(id)) {
      article.remove();
      elements.delete(id);
      resources.delete(id);
      motion.bodies.delete(id);
      poseStyleCache.delete(id);
    }
  order = state.blocks.map((b) => b.id);
  for (const block of state.blocks) {
    const resource = state.resources.find((r) => r.id === block.resource_id)!;
    const displayType: Resource["type"] =
      block.shape === "circle"
        ? "research"
        : resource.kind === "conversation"
          ? "conversation"
          : "note";
    let r = resources.get(block.id);
    const data = {
      id: block.id,
      canonicalId: resource.id,
      type: displayType,
      title: resource.title,
      subtitle: `${resource.kind} · ${resource.id.slice(0, 8)}`,
      text: resource.content,
    };
    if (!r) {
      r = data;
      resources.set(block.id, r);
      mountResource(block.id, r);
    } else {
      Object.assign(r, data);
      const article = elements.get(block.id)!;
      article.classList.remove("conversation", "research", "note");
      article.classList.add(displayType);
      article.querySelector("h2")!.textContent = resource.title;
      article.querySelector(".folio-preview")!.textContent =
        resource.content.split("\n\n")[0];
    }
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
    `Address Vela. ${labels[state]}, synthetic presence`,
  );
  $<HTMLSelectElement>("#vela-expression").value = state;
  document.body.dataset.vela = state;
  interaction();
}
function showDialog(id: string, button: string, show: boolean) {
  $(id).hidden = !show;
  $(button).setAttribute("aria-expanded", String(show));
  if (show)
    $(id)
      .querySelector<HTMLButtonElement>(".dialog-top button")
      ?.focus({ preventScroll: true });
  interaction();
}
$("#vela").addEventListener("click", () => {
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
  cancelDrag();
  layout("viewport retarget");
});
addEventListener("error", (e) => metrics.errors.push(e.message));
function lifecycle(active: boolean) {
  nativeActive = active;
  if (!active) {
    cancelAnimationFrame(raf);
    clearTimeout(schedulerTimer);
    schedulerTimer = 0;
    raf = 0;
    for (const id of order) motion.snap(id);
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
      onActive: (listener: (active: boolean) => void) => void;
      command?: (name: string, input: unknown) => Promise<unknown>;
      onEvent?: (listener: (event: unknown) => void) => void;
    };
    __aerynth: ReturnType<typeof controller>;
  }
}
window.aerynthHost?.onActive(lifecycle);

function renderDOM() {
  const projected = order.map((id) => ({ id, ...motion.pose(id) }));
  const overlaps = overlappingSurfaceIds(projected);
  for (const p of projected) {
    const id = p.id,
      el = elements.get(id)!;
    const materialOverlap = String(overlaps.has(id));
    if (el.dataset.materialOverlap !== materialOverlap)
      el.dataset.materialOverlap = materialOverlap;
    const rest = base(id);
    const openHeight = Math.max(250, innerHeight - 310);
    const unfold = clamp(
      (p.h - rest.h) / Math.max(1, openHeight - rest.h),
      0,
      1,
    );
    const dockWidth = innerWidth >= 1100 ? 176 : 56;
    // Width can lag its new resting value during an ordinary window resize.
    // Only an actual focused-work transition may reveal peripheral anchors.
    const dock = Math.min(
      clamp((rest.w - p.w) / Math.max(1, rest.w - dockWidth), 0, 1),
      clamp((focus - 0.13) / 0.87, 0, 1),
    );
    el.hidden =
      p.x + p.w < 0 ||
      p.y + p.h < 120 ||
      p.x > innerWidth ||
      p.y > innerHeight - 100;
    const style = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--lift:${p.lift};--opacity:${p.opacity};--unfold:${unfold};--dock:${dock};transform:perspective(1500px) translateZ(${p.lift}px) rotateY(${p.yaw}deg);z-index:${expanded === id ? 200000 : drag?.id === id ? 150000 : selected === id ? 100000 : desktopMode ? 20000 + (application?.block(id)?.z ?? 0) : 3};`;
    if (poseStyleCache.get(id) !== style) {
      el.style.cssText = style;
      poseStyleCache.set(id, style);
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
}
function tick(now: number) {
  raf = 0;
  if (!running || !nativeActive || document.hidden) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.12);
  const interval = now - lastFrame;
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
  const targetFocus = expanded ? 1 : selected ? 0.13 : 0;
  focus = motion.reduced
    ? targetFocus
    : focus + (targetFocus - focus) * (1 - Math.exp(-dt * 10));
  const targetAttention = vela === "idle" || vela === "unavailable" ? 0 : 1;
  attention = motion.reduced
    ? targetAttention
    : attention + (targetAttention - attention) * (1 - Math.exp(-dt * 7));
  renderDOM();
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
    (policy.continuous &&
      (now + 0.25 >= nextDraw || !Number.isFinite(nextDraw))) ||
    (pointerDirty && now - lastDraw >= pointerCadence - 0.25);
  if (shouldDraw) {
    if (environment && !graphicsFailed) {
      const surfaces = order
        .filter(
          (id) =>
            !elements.get(id)?.hidden &&
            application?.snapshot()?.navigation.kind !== "constellation",
        )
        .map((id) => {
          const p = motion.pose(id),
            rest = base(id);
          return {
            id,
            kind:
              innerWidth < 1000 && resources.get(id)!.type === "research"
                ? "conversation"
                : resources.get(id)!.type,
            ...p,
            selected: id === selected,
            unfold: clamp(
              (p.h - rest.h) /
                Math.max(1, Math.max(250, innerHeight - 310) - rest.h),
              0,
              1,
            ),
          };
        });
      const scene = deriveSceneState({
        selected,
        expanded,
        related: ["idle", "unavailable"].includes(vela)
          ? null
          : (document.body.dataset.related ?? null),
        dragging: !!drag,
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
        ambientStrength: scene.ambientStrength,
      });
      const presence = environment.presenceBounds();
      const presenceWidth = Math.max(44, presence.w),
        presenceHeight = Math.max(44, presence.h);
      Object.assign($("#vela").style, {
        left: `${clamp(presence.x, 4, innerWidth - presenceWidth - 4)}px`,
        top: `${Math.max(100, presence.y)}px`,
        width: `${presenceWidth}px`,
        height: `${presenceHeight}px`,
      });
      if (lastDraw && metrics.drawIntervals.length < 18000)
        metrics.drawIntervals.push(now - lastDraw);
      lastDraw = now;
      metrics.draws++;
      metrics.lastDraw = now;
    }
    nextDraw = !Number.isFinite(cadence)
      ? Infinity
      : dirty || !Number.isFinite(nextDraw) || now - nextDraw > cadence * 4
        ? now + cadence
        : nextDraw + cadence;
    dirty = false;
    pointerDirty = false;
  }
  if (inputAt) {
    metrics.inputFeedback.push(now - inputAt);
    if (metrics.inputFeedback.length > 1024) metrics.inputFeedback.shift();
    inputAt = 0;
  }
  metrics.policy = `${activeQuality} / ${motion.reduced ? "reduced" : quiet ? "quiet" : !ambient ? "ambient off" : idle ? "ambient idle" : "active"}`;
  $("#policy").textContent = metrics.policy;
  if (transitioning || policy.continuous || pointerDirty) {
    if (
      !transitioning &&
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
      metrics: { ...metrics },
      gpu: environment?.stats(),
    }),
    application: () => application?.snapshot(),
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
    replace: replaceWorkspace,
    status,
    layout: () => layout("application state"),
    home,
    focus: (id) => {
      if (expanded !== id) expand(id);
      else
        elements
          .get(id)
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus();
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
