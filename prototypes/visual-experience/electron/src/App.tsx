import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import fixtureJson from "./fixture.json";
import { Atmosphere } from "./atmosphere";
import { MotionCoordinator } from "./motion";
import { sampleFrames } from "./benchmark";
import type {
  ActivityEvent,
  Fixture,
  Message,
  Quality,
  VelaState,
} from "./types";
import "./style.css";

const fixture = fixtureJson as Fixture;
const blocks = [
  {
    id: "overview",
    name: "Focus field",
    category: "OVERVIEW",
    icon: "✦",
    size: "wide",
  },
  {
    id: "conversation",
    name: "Conversation",
    category: "DIALOGUE",
    icon: "◉",
    size: "wide",
  },
  {
    id: "activity",
    name: "Intelligence stream",
    category: "ACTIVITY",
    icon: "≋",
    size: "normal",
  },
  {
    id: "projects",
    name: "Projects",
    category: "SPACES",
    icon: "◫",
    size: "normal",
  },
  {
    id: "notes",
    name: "Thoughts",
    category: "NOTES",
    icon: "▤",
    size: "normal",
  },
  {
    id: "timeline",
    name: "Timeline",
    category: "TIME",
    icon: "⌁",
    size: "normal",
  },
  {
    id: "metrics",
    name: "System profile",
    category: "METRICS",
    icon: "▥",
    size: "normal",
  },
  {
    id: "files",
    name: "Resources",
    category: "FILES",
    icon: "⌘",
    size: "normal",
  },
  {
    id: "agents",
    name: "Agent constellation",
    category: "AGENTS",
    icon: "◎",
    size: "normal",
  },
  {
    id: "tasks",
    name: "Work queue",
    category: "TASKS",
    icon: "☷",
    size: "normal",
  },
  {
    id: "signal",
    name: "Signal study",
    category: "SIGNAL",
    icon: "∿",
    size: "normal",
  },
  {
    id: "calendar",
    name: "Schedule",
    category: "CALENDAR",
    icon: "▦",
    size: "normal",
  },
] as const;
type BlockId = (typeof blocks)[number]["id"];
const initialOrder = blocks.map((b) => b.id);
const param = new URLSearchParams(location.search);
const detached = param.get("detached");
const benchmarkMode = param.get("benchmark") === "1";
const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const stored = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

function VirtualMessages({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null),
    [top, setTop] = useState(0),
    [height, setHeight] = useState(390),
    [selected, setSelected] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(() =>
      setHeight(ref.current?.clientHeight || 390),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const row = 84,
    start = Math.max(0, Math.floor(top / row) - 4),
    end = Math.min(messages.length, start + Math.ceil(height / row) + 9);
  return (
    <div
      className="virtual-list conversation-list"
      ref={ref}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      data-chat-scroll="true"
    >
      <div style={{ height: messages.length * row, position: "relative" }}>
        {messages.slice(start, end).map((m, i) => (
          <article
            className={"message " + (selected === m.id ? "selected" : "")}
            key={m.id}
            style={{ top: (start + i) * row, height: row - 4 }}
            onClick={() => setSelected(m.id)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSelected(m.id);
            }}
            aria-label={`${m.author} message ${start + i + 1}`}
          >
            <span className="avatar">{m.author === "You" ? "Y" : "V"}</span>
            <div>
              <div className="message-meta">
                <strong>{m.author}</strong>
                <span>
                  {formatTime(m.time)} · {m.topic}
                </span>
              </div>
              <p>{m.text}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
function EventList({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="event-list">
      {events
        .slice(-24)
        .reverse()
        .map((e) => (
          <div className="event" key={e.id}>
            <span className="event-light" />
            <div>
              <span className="event-kind">{e.kind}</span>
              <p>{e.text}</p>
            </div>
            <time>{formatTime(e.time)}</time>
          </div>
        ))}
    </div>
  );
}

export default function App() {
  const [order, setOrder] = useState<BlockId[]>(() =>
    benchmarkMode ? [...initialOrder] : stored("order", initialOrder),
  );
  const [quality, setQuality] = useState<Quality>(() =>
    stored("quality", "cinematic"),
  );
  const [reduced, setReduced] = useState(() => stored("reduced", false));
  const [vela, setVela] = useState<VelaState>("idle");
  const [events, setEvents] = useState<ActivityEvent[]>(fixture.events);
  const burstCounter = useRef(0);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState(() =>
    stored("note", "A place to gather the shape of a thought."),
  );
  const [checked, setChecked] = useState<string[]>(() => stored("checked", []));
  const [activeResource, setActiveResource] = useState("Orion workspace");
  const [selectedTimeline, setSelectedTimeline] = useState(
    "Motion review queued",
  );
  const [agentFocus, setAgentFocus] = useState("Vela");
  const [signalMode, setSignalMode] = useState<"ambient" | "focused" | "quiet">(
    "ambient",
  );
  const [selectedDay, setSelectedDay] = useState(1);
  const [expanded, setExpanded] = useState<BlockId | null>(null);
  const [benchStatus, setBenchStatus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    atmosphere = useRef<Atmosphere | null>(null);
  const expandedRef = useRef<BlockId | null>(null),
    motion = useRef(new MotionCoordinator());
  const dragId = useRef<BlockId | null>(null);
  const previousRects = useRef<Map<string, DOMRect>>(new Map());
  const filtered = useMemo(
    () =>
      order.filter((id) =>
        blocks
          .find((b) => b.id === id)
          ?.name.toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [order, query],
  );
  useEffect(() => {
    if (canvas.current) {
      try {
        atmosphere.current = new Atmosphere(canvas.current);
      } catch {
        canvas.current.style.display = "none";
      }
      return () => atmosphere.current?.dispose();
    }
  }, []);
  useEffect(() => {
    atmosphere.current?.setMode(quality, reduced);
    motion.current.setPolicy(quality, reduced);
    motion.current.note("atmospheric", "field", "quality policy");
  }, [quality, reduced]);
  useEffect(() => {
    motion.current.note("semantic", "vela", vela);
  }, [vela]);
  useEffect(() => () => motion.current.dispose(), []);
  useEffect(() => {
    localStorage.setItem("order", JSON.stringify(order));
  }, [order]);
  useEffect(() => {
    localStorage.setItem("quality", JSON.stringify(quality));
  }, [quality]);
  useEffect(() => {
    localStorage.setItem("reduced", JSON.stringify(reduced));
  }, [reduced]);
  useEffect(() => {
    localStorage.setItem("note", JSON.stringify(note));
  }, [note]);
  useEffect(() => {
    localStorage.setItem("checked", JSON.stringify(checked));
  }, [checked]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) setReduced(true);
  }, []);
  useLayoutEffect(() => {
    for (const holder of document.querySelectorAll<HTMLElement>(
      ".workspace-grid .block-holder",
    )) {
      const id =
        holder.querySelector<HTMLElement>("[data-block]")?.dataset.block;
      if (!id) continue;
      const old = previousRects.current.get(id);
      if (!old) continue;
      const now = holder.getBoundingClientRect(),
        dx = old.left - now.left,
        dy = old.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) > 2)
        motion.current.animate(
          "spatial",
          `layout:${id}`,
          "rearrange",
          holder,
          [
            { transform: `translate(${dx}px,${dy}px)` },
            { transform: "translate(0,0)" },
          ],
          430,
          () => {},
        );
    }
    previousRects.current.clear();
  }, [order]);

  function captureRects() {
    previousRects.current.clear();
    for (const holder of document.querySelectorAll<HTMLElement>(
      ".workspace-grid .block-holder",
    )) {
      const id =
        holder.querySelector<HTMLElement>("[data-block]")?.dataset.block;
      if (id) previousRects.current.set(id, holder.getBoundingClientRect());
    }
  }
  function reorder(source: BlockId, target: BlockId) {
    if (source === target) return;
    motion.current.note("interaction", source, `move before ${target}`);
    captureRects();
    setOrder((old) => {
      const next = old.filter((x) => x !== source);
      next.splice(next.indexOf(target), 0, source);
      return next;
    });
  }
  function nudge(id: BlockId, delta: number) {
    const index = order.indexOf(id),
      target = order[index + delta];
    if (!target) return;
    motion.current.note("interaction", id, `nudge ${delta}`);
    captureRects();
    setOrder((old) => {
      const next = [...old],
        at = next.indexOf(id),
        other = at + delta;
      if (other < 0 || other >= next.length) return old;
      [next[at], next[other]] = [next[other], next[at]];
      return next;
    });
  }
  function animateBlock(id: BlockId, open: boolean) {
    const element = document.querySelector<HTMLElement>(`[data-block="${id}"]`),
      holder = element?.parentElement;
    if (!element || !holder) return;
    const start = element.getBoundingClientRect();
    const main = document
      .querySelector<HTMLElement>(".app-main")
      ?.getBoundingClientRect();
    const end = open
      ? {
          left: (main?.left || 70) + 45,
          top: 78,
          width: (main?.width || innerWidth - 300) - 90,
          height: innerHeight - 106,
        }
      : (() => {
          const r = holder.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        })();
    element.style.position = "fixed";
    element.style.left = `${start.left}px`;
    element.style.top = `${start.top}px`;
    element.style.width = `${start.width}px`;
    element.style.height = `${start.height}px`;
    element.style.zIndex = "50";
    if (open) {
      expandedRef.current = id;
      setExpanded(id);
    } else {
      expandedRef.current = null;
      setExpanded(null);
    }
    const finish = () => {
      if (open) {
        element.style.left = `${end.left}px`;
        element.style.top = `${end.top}px`;
        element.style.width = `${end.width}px`;
        element.style.height = `${end.height}px`;
      } else {
        element.style.position = "";
        element.style.left = "";
        element.style.top = "";
        element.style.width = "";
        element.style.height = "";
        element.style.zIndex = "";
      }
    };
    motion.current.note("material", id, open ? "elevate" : "settle");
    motion.current.animate(
      "spatial",
      id,
      open ? "expand" : "collapse",
      element,
      [
        {
          left: `${start.left}px`,
          top: `${start.top}px`,
          width: `${start.width}px`,
          height: `${start.height}px`,
          opacity: 1,
        },
        {
          left: `${end.left}px`,
          top: `${end.top}px`,
          width: `${end.width}px`,
          height: `${end.height}px`,
          opacity: 1,
        },
      ],
      open ? 460 : 390,
      finish,
    );
  }
  function toggleExpand(id: BlockId) {
    const current = expandedRef.current;
    if (current && current !== id) {
      animateBlock(current, false);
      setTimeout(() => animateBlock(id, true), reduced ? 0 : 200);
    } else animateBlock(id, current !== id);
  }
  function eventBurst() {
    const next = ++burstCounter.current;
    motion.current.note("semantic", "activity", `synthetic burst ${next}`);
    const base = Date.UTC(2026, 10, 1, 18, 0, 0) + next * 60000;
    setEvents((old) => [
      ...old,
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `burst-${next}-${i}`,
        kind: i % 9 === 0 ? "Attention fixture" : "Observed fixture",
        time: new Date(base + i * 120).toISOString(),
        text: `Reproducible synthetic burst ${next} · event ${i + 1}`,
      })),
    ]);
    setVela("working");
  }
  const toggleTask = (id: string) =>
    setChecked((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );

  async function runBenchmark() {
    if (benchStatus === "Running benchmark…") return;
    setBenchStatus("Running benchmark…");
    const samples: Record<string, unknown> = {};
    const saved = { quality, reduced };
    try {
      setQuality("cinematic");
      setReduced(false);
      await new Promise((r) => setTimeout(r, 300));
      const idleDraws = atmosphere.current?.getDrawCount() || 0;
      samples.idle = await sampleFrames(2400);
      samples.idleCanvasDraws =
        (atmosphere.current?.getDrawCount() || 0) - idleDraws;
      setVela("working");
      samples.activeAnimation = await sampleFrames(2400);
      const timer = setInterval(() => {
        captureRects();
        setOrder((old) => [old[1], old[0], ...old.slice(2)]);
      }, 250);
      samples.rearrangement = await sampleFrames(2400);
      clearInterval(timer);
      const chat = document.querySelector<HTMLElement>("[data-chat-scroll]");
      chat?.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 180));
      let scroll = 0;
      samples.largeChatScroll = await sampleFrames(2400, () => {
        if (chat) {
          scroll += 52;
          chat.scrollTop = scroll;
        }
      });
      const stream = setInterval(eventBurst, 350);
      samples.eventBurst = await sampleFrames(2400);
      clearInterval(stream);
      await window.aerynthLab.detachBlock("overview");
      samples.secondaryWindow = await sampleFrames(2400);
      setQuality("efficient");
      setReduced(true);
      await new Promise((r) => setTimeout(r, 150));
      const efficientDraws = atmosphere.current?.getDrawCount() || 0;
      samples.reducedEfficient = await sampleFrames(2400);
      samples.reducedEfficientCanvasDraws =
        (atmosphere.current?.getDrawCount() || 0) - efficientDraws;
      setQuality("cinematic");
      setReduced(false);
      await new Promise((r) => setTimeout(r, 150));
      const expandButton = document.querySelector<HTMLButtonElement>(
        '[aria-label="Expand Focus field"]',
      );
      expandButton?.click();
      await new Promise((r) => setTimeout(r, 550));
      const expandedRect = document
        .querySelector<HTMLElement>('[data-block="overview"]')
        ?.getBoundingClientRect();
      const expandedCapture = await window.aerynthLab.capture("expanded");
      document
        .querySelector<HTMLButtonElement>('[aria-label="Collapse Focus field"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 450));
      document
        .querySelector<HTMLButtonElement>('[aria-label="Expand Focus field"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 85));
      document
        .querySelector<HTMLButtonElement>('[aria-label="Collapse Focus field"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 450));
      const interruptedExpansionSettled =
        document.querySelector<HTMLElement>('[data-block="overview"]')?.style
          .position !== "fixed";
      [...document.querySelectorAll<HTMLButtonElement>(".vela-controls button")]
        .find((x) => x.textContent === "attention required")
        ?.click();
      await new Promise((r) => setTimeout(r, 50));
      const attentionText =
        document.querySelector(".vela-heading h2")?.textContent;
      [...document.querySelectorAll<HTMLButtonElement>(".vela-controls button")]
        .find((x) => x.textContent === "unavailable")
        ?.click();
      await new Promise((r) => setTimeout(r, 50));
      const unavailableText =
        document.querySelector(".vela-heading h2")?.textContent;
      const blockIndex = () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            ".workspace-grid [data-block]",
          ),
        ].findIndex((x) => x.dataset.block === "overview");
      const beforeNudge = blockIndex();
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Move Focus field later"]',
        )
        ?.click();
      await new Promise((r) => setTimeout(r, 80));
      const reorderedByButton = blockIndex() === beforeNudge + 1;
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Move Focus field earlier"]',
        )
        ?.click();
      await new Promise((r) => setTimeout(r, 80));
      const rejectedInvalidDetach =
        !(await window.aerynthLab.detachBlock("../../unsafe"));
      const beforeHide = atmosphere.current?.getDrawCount() || 0;
      const background = await window.aerynthLab.backgroundProbe();
      const hiddenDraws =
        (atmosphere.current?.getDrawCount() || 0) - beforeHide;
      const smoke = {
        blockCount: document.querySelectorAll(".workspace-grid [data-block]")
          .length,
        expandButtonPresent: !!expandButton,
        expandedRect: expandedRect && {
          left: expandedRect.left,
          top: expandedRect.top,
          width: expandedRect.width,
          height: expandedRect.height,
        },
        expandedCapture,
        interruptedExpansionSettled,
        attentionText,
        unavailableText,
        reorderedByButton,
        rejectedInvalidDetach,
        background,
        canvasDrawsAcrossHideAndShow: hiddenDraws,
        rendererNodeRequireType: typeof (
          window as unknown as { require?: unknown }
        ).require,
      };
      const environment = await window.aerynthLab.environment();
      const report = {
        kind: "Electron visual lab benchmark",
        fixtureSeed: fixture.seed,
        synthetic: true,
        scenarios: samples,
        smoke,
        motionRecords: motion.current.snapshot(),
        environment,
        notes: [
          "Frame intervals sampled with renderer requestAnimationFrame; these are not GPU presentation timestamps.",
          "Secondary-window scenario samples the main renderer while a second native window is open.",
          "CPU and memory data are instantaneous Electron app process metrics, not workload averages.",
          "Rearrangement is a programmed block swap, not pointer latency.",
          "One display was present; topology changes and GPU device failure were not exercised.",
        ],
      };
      const savedReport = await window.aerynthLab.benchmarkReport(report);
      setBenchStatus(
        savedReport
          ? "Benchmark saved in evidence/benchmark-local.json"
          : "Benchmark complete; save unavailable",
      );
      return report;
    } finally {
      setQuality(saved.quality);
      setReduced(saved.reduced);
    }
  }
  useEffect(() => {
    window.__lab = { runBenchmark };
    if (benchmarkMode) {
      const timer = setTimeout(() => void runBenchmark(), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  function content(id: BlockId) {
    switch (id) {
      case "overview":
        return (
          <div className="focus-content">
            <div>
              <div className="small-label">
                CURRENT FOCUS · LOCAL DEMONSTRATION
              </div>
              <h2>
                Ideas take shape
                <br />
                <em>in motion.</em>
              </h2>
              <p>
                A place for conversation, projects and active intelligence to
                share one continuous space.
              </p>
              <div className="focus-actions">
                <button
                  className="primary-button"
                  onClick={() => toggleExpand("conversation")}
                >
                  Open conversation <span>↗</span>
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setActiveResource("Glass material study")}
                >
                  Explore material study
                </button>
              </div>
            </div>
            <div className="focus-art">
              <div className="focus-halo" />
              <img
                src="./aerynth-mark-master.png"
                alt="Official Aerynth mark"
              />
            </div>
          </div>
        );
      case "conversation":
        return (
          <>
            <div className="block-intro">
              <span className="pill">2,000 selectable messages</span>
              <span>Orion · design dialogue</span>
            </div>
            <VirtualMessages messages={fixture.messages} />
          </>
        );
      case "activity":
        return (
          <>
            <div className="block-intro">
              <span className="pill warning">SYNTHETIC ACTIVITY</span>
              <button className="text-button" onClick={eventBurst}>
                Run burst +60 ↗
              </button>
            </div>
            <EventList events={events} />
          </>
        );
      case "projects":
        return (
          <div className="project-stack">
            {["Orion workspace", "Glass material study", "CIE research"].map(
              (p, i) => (
                <button
                  className={
                    "project-row " + (activeResource === p ? "active" : "")
                  }
                  key={p}
                  onClick={() => setActiveResource(p)}
                >
                  <span className="project-symbol">{["◈", "◇", "⌘"][i]}</span>
                  <span>
                    <strong>{p}</strong>
                    <small>
                      {
                        [
                          "18 resources · active",
                          "Material & motion",
                          "Evidence and retrieval",
                        ][i]
                      }
                    </small>
                  </span>
                  <span>↗</span>
                </button>
              ),
            )}
          </div>
        );
      case "notes":
        return (
          <>
            <p className="muted">
              A local draft that stays available across launches.
            </p>
            <textarea
              className="note-editor"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Thoughts draft"
            />
            <div className="note-footer">
              AUTOSAVED LOCALLY <span>✦</span>
            </div>
          </>
        );
      case "timeline":
        return (
          <div className="timeline">
            {[
              ["08:40", "Scene initialized"],
              ["09:12", "Visual baseline prepared"],
              ["10:05", "Motion review queued"],
              ["11:30", "Desktop study continues"],
            ].map(([time, label]) => (
              <button
                className="timeline-row"
                key={time}
                onClick={() => setSelectedTimeline(label)}
              >
                <time>{time}</time>
                <i className={selectedTimeline === label ? "accent" : ""} />
                <span>{label}</span>
              </button>
            ))}
            <small className="selection-caption">
              SELECTED · {selectedTimeline}
            </small>
          </div>
        );
      case "metrics":
        return (
          <div className="metrics">
            <div>
              <small>FRAME TARGET</small>
              <strong>
                60 <span>Hz</span>
              </strong>
              <div className="meter">
                <i style={{ width: "78%" }} />
              </div>
            </div>
            <div>
              <small>RENDER MODE</small>
              <strong>{quality}</strong>
              <div className="meter">
                <i
                  style={{
                    width:
                      quality === "cinematic"
                        ? "90%"
                        : quality === "balanced"
                          ? "62%"
                          : "34%",
                  }}
                />
              </div>
            </div>
            <p>
              Illustrative UI only. Actual measurements appear in benchmark
              evidence.
            </p>
            <button
              className="text-button metric-action"
              onClick={() =>
                setQuality(
                  quality === "cinematic"
                    ? "balanced"
                    : quality === "balanced"
                      ? "efficient"
                      : "cinematic",
                )
              }
            >
              Cycle quality ↗
            </button>
          </div>
        );
      case "files":
        return (
          <div className="file-tree">
            {[
              "▾  Orion workspace",
              "  ▸  Interface studies",
              "  ▸  Research notes",
              "  ◇  Liquid Intelligence.md",
              "  ◇  Window handoff.ts",
              "  ◇  Evidence plan.md",
            ].map((file, i) => (
              <button key={i} onClick={() => setActiveResource(file.trim())}>
                {file}
                <span>↗</span>
              </button>
            ))}
          </div>
        );
      case "agents":
        return (
          <div className="agent-view">
            <div className="agent-map">
              <button
                className="agent-node main"
                onClick={() => setAgentFocus("Vela")}
                aria-label="Select Vela"
              >
                V
              </button>
              <button
                className="agent-node a"
                onClick={() => setAgentFocus("Fixture agent 01")}
                aria-label="Select fixture agent 01"
              >
                01
              </button>
              <button
                className="agent-node b"
                onClick={() => setAgentFocus("Fixture agent 02")}
                aria-label="Select fixture agent 02"
              >
                02
              </button>
              <button
                className="agent-node c"
                onClick={() => setAgentFocus("Fixture agent 03")}
                aria-label="Select fixture agent 03"
              >
                03
              </button>
            </div>
            <p>
              <strong>{agentFocus}</strong> · {vela}
            </p>
            <small>Fixture state only; no live agent execution.</small>
          </div>
        );
      case "tasks":
        return (
          <div className="task-list">
            {[
              "Inspect motion continuity",
              "Review transparent window",
              "Capture benchmark trace",
              "Document decision gaps",
            ].map((task, i) => (
              <label key={task}>
                <input
                  type="checkbox"
                  checked={checked.includes(task)}
                  onChange={() => toggleTask(task)}
                />
                <span>
                  <strong>{task}</strong>
                  <small>
                    {
                      [
                        "Visual system",
                        "Native shell",
                        "Performance",
                        "Architecture",
                      ][i]
                    }
                  </small>
                </span>
              </label>
            ))}
          </div>
        );
      case "signal":
        return (
          <div className="signal-view">
            <button
              className="signal-rings"
              onClick={() =>
                setSignalMode(
                  signalMode === "ambient"
                    ? "focused"
                    : signalMode === "focused"
                      ? "quiet"
                      : "ambient",
                )
              }
              aria-label="Cycle signal mode"
            >
              <span />
              <span />
              <span />
              <b>∿</b>
            </button>
            <strong>{signalMode} field</strong>
            <p>Eight filaments · 200 seeded particles</p>
            <small>Select the field to cycle a fixture mode.</small>
          </div>
        );
      case "calendar":
        return (
          <div className="calendar">
            <div className="calendar-title">
              NOVEMBER <strong>2026</strong>
              <span> DAY {selectedDay}</span>
            </div>
            <div className="calendar-grid">
              {"SMTWTFS".split("").map((x, i) => (
                <small key={i}>{x}</small>
              ))}
              {Array.from({ length: 35 }, (_, i) => (
                <button
                  key={i}
                  className={i + 1 === selectedDay ? "today" : ""}
                  onClick={() => i < 30 && setSelectedDay(i + 1)}
                  disabled={i >= 30}
                >
                  {i + 1 <= 30 ? i + 1 : ""}
                </button>
              ))}
            </div>
          </div>
        );
    }
  }
  const renderBlock = (id: BlockId) => {
    const meta = blocks.find((x) => x.id === id)!;
    return (
      <div
        className={"block-holder " + (meta.size === "wide" ? "wide" : "")}
        key={id}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId.current) reorder(dragId.current, id);
        }}
      >
        <section
          className={"block " + (expanded === id ? "is-expanded" : "")}
          data-block={id}
          aria-label={meta.name}
        >
          <header
            className="block-header"
            draggable
            onDragStart={(e) => {
              dragId.current = id;
              e.dataTransfer.setData("text/plain", id);
            }}
            onDragEnd={() => (dragId.current = null)}
          >
            <span className="block-icon">{meta.icon}</span>
            <div>
              <small>{meta.category}</small>
              <h3>{meta.name}</h3>
            </div>
            <div className="block-tools">
              <button
                title="Move earlier"
                aria-label={`Move ${meta.name} earlier`}
                onClick={() => nudge(id, -1)}
              >
                ←
              </button>
              <button
                title="Move later"
                aria-label={`Move ${meta.name} later`}
                onClick={() => nudge(id, 1)}
              >
                →
              </button>
              <button
                title="Detach into native window"
                aria-label={`Detach ${meta.name}`}
                onClick={() => void window.aerynthLab.detachBlock(id)}
              >
                ⧉
              </button>
              <button
                title={expanded === id ? "Collapse" : "Expand"}
                aria-label={`${expanded === id ? "Collapse" : "Expand"} ${meta.name}`}
                onClick={() => toggleExpand(id)}
              >
                {expanded === id ? "↙" : "⤢"}
              </button>
            </div>
          </header>
          <div className="block-body">{content(id)}</div>
        </section>
      </div>
    );
  };
  return (
    <div
      className={
        "app " +
        (reduced ? "reduced" : "") +
        " quality-" +
        quality +
        (detached ? " detached" : "")
      }
    >
      <canvas className="atmosphere" ref={canvas} aria-hidden="true" />
      {!detached && (
        <>
          <aside className="rail">
            <div className="rail-logo">A</div>
            <button className="rail-active" title="Home">
              ⌂
            </button>
            <button
              title="Spaces"
              onClick={() =>
                document.getElementById("workspace")?.scrollIntoView()
              }
            >
              ◫
            </button>
            <button
              title="Conversation"
              onClick={() => toggleExpand("conversation")}
            >
              ◉
            </button>
            <button title="Activity" onClick={() => toggleExpand("activity")}>
              ≋
            </button>
            <div className="rail-spacer" />
            <button
              title="Settings"
              onClick={() =>
                document.getElementById("settings")?.scrollIntoView()
              }
            >
              ⚙
            </button>
          </aside>
          <div className="app-main">
            <header className="topbar">
              <div className="brand-word">
                AERYNTH <span>/</span> <small>VISUAL LAB</small>
              </div>
              <div className="top-center">
                HOME <span>·</span> ORION SPACE
              </div>
              <div className="top-actions">
                <span className="synthetic-tag">SYNTHETIC FIXTURES</span>
                <span className="top-dot" /> LOCAL PROTOTYPE
              </div>
            </header>
            <main className="main-scroll" id="workspace">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    SUNDAY, NOVEMBER 1, 2026 <span> / </span> YOUR ENVIRONMENT
                  </div>
                  <h1>
                    Good to see you <em>here.</em>
                  </h1>
                  <p>Everything in motion, all in one place.</p>
                </div>
                <div className="page-count">
                  <span>12</span>
                  <small>ACTIVE SURFACES</small>
                </div>
              </div>
              <div className="workspace-top">
                <div className="section-heading">
                  <span className="section-index">01 /</span>
                  <h2>Your space</h2>
                  <span className="section-rule" />
                </div>
                <label className="search">
                  ⌕{" "}
                  <input
                    placeholder="Find a block"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Find a block"
                  />
                  <kbd>⌘ K</kbd>
                </label>
              </div>
              <div className="workspace-grid">{filtered.map(renderBlock)}</div>
              <section className="controls-panel" id="settings">
                <div>
                  <div className="small-label">ENVIRONMENT CONTROL</div>
                  <h2>Shape the atmosphere</h2>
                  <p>
                    Changes apply immediately. All activity in this lab is
                    simulated.
                  </p>
                </div>
                <div className="controls">
                  <label>
                    Graphics quality
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as Quality)}
                    >
                      <option value="cinematic">Cinematic</option>
                      <option value="balanced">Balanced</option>
                      <option value="efficient">Efficient</option>
                    </select>
                  </label>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={reduced}
                      onChange={(e) => setReduced(e.target.checked)}
                    />{" "}
                    Reduced motion
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() => void runBenchmark()}
                  >
                    Run benchmark ↗
                  </button>
                  {benchStatus && <small>{benchStatus}</small>}
                </div>
              </section>
              <footer>
                AERYNTH / ELECTRON CANDIDATE <span>·</span> SEED 20261101{" "}
                <span>·</span> NOT A PRODUCT RELEASE
              </footer>
            </main>
          </div>
          <aside className="side-panel">
            <div className="side-top">
              <span className="small-label">INTELLIGENCE PRESENCE</span>
              <span className="status-dot" />
            </div>
            <div
              className={"vela-orb " + vela.replace(" ", "-")}
              aria-hidden="true"
            >
              <div className="orb-core">✦</div>
              <div className="orbit orbit-a" />
              <div className="orbit orbit-b" />
            </div>
            <div className="vela-heading">
              <small>VELA / STATE FIXTURE</small>
              <h2>
                {vela === "attention required"
                  ? "A moment for you."
                  : vela === "unavailable"
                    ? "Quiet for now."
                    : vela === "working"
                      ? "In motion."
                      : "Here with you."}
              </h2>
              <p>
                {vela === "attention required"
                  ? "A simulated item needs review."
                  : vela === "unavailable"
                    ? "The simulated assistant is unavailable."
                    : vela === "working"
                      ? "Synthetic work is in progress."
                      : "Ready when you are."}
              </p>
            </div>
            <div className="vela-controls">
              <span className="small-label">SIMULATE STATE</span>
              <div>
                {(
                  [
                    "idle",
                    "working",
                    "attention required",
                    "unavailable",
                  ] as VelaState[]
                ).map((s) => (
                  <button
                    key={s}
                    className={vela === s ? "active" : ""}
                    onClick={() => setVela(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="side-bottom">
              <div>
                <span>SELECTED RESOURCE</span>
                <strong>{activeResource}</strong>
              </div>
              <button onClick={() => toggleExpand("activity")}>
                View stream ↗
              </button>
            </div>
          </aside>
        </>
      )}
      {detached && (
        <div className="detached-shell">
          <div className="detached-title">
            <span>AERYNTH / DETACHED SURFACE</span>
            <button
              onClick={() => void window.aerynthLab.closeDetached()}
              aria-label="Close detached window"
            >
              ×
            </button>
          </div>
          {blocks.some((b) => b.id === detached) &&
            renderBlock(detached as BlockId)}
          <div className="detached-note">
            Native transparent window · shared resource identity: {detached}
          </div>
        </div>
      )}
    </div>
  );
}
