import type { MissionProjection } from "../integrated-backend/src/mission-contracts.mts";
import { mountMissionFlow, missionFlowInScope } from "./mission-flow.ts";
import type { ExperienceMotionPort } from "../application-contract/motion.ts";
import { mountStreamGraph } from "./stream-view.ts";
import type { StreamEvent } from "../integrated-backend/src/contracts.mts";

export type EventWindow = {
  mission?: MissionProjection | null;
  events: readonly StreamEvent[];
  earliest: number | null;
  latest: number;
  disconnected: boolean;
  resources: readonly { id: string; projectId: string | null; title: string }[];
  workspaceResourceIds: readonly string[];
  workspaceId?: string | null;
  projectId: string | null;
};
export type EventFilters = {
  scope: "all" | "workspace" | "project";
  classification: string;
  source: string;
  resourceId: string;
  executionId: string;
  query: string;
  since?: number;
};
export type ReplayWindow = {
  events: StreamEvent[];
  earliest: number | null;
  latest: number;
  truncated: boolean;
};
/** A metadata read locates the end of retention; the second read requests a bounded recent window. */
export async function readRecentEvents(
  replay: (input: { after: number; limit: number }) => Promise<ReplayWindow>,
): Promise<ReplayWindow> {
  const metadata = await replay({ after: 0, limit: 1 });
  return replay({ after: Math.max(0, metadata.latest - 250), limit: 250 });
}
const missionOperations: Record<string, string> = {
  created: "Mission created",
  revised: "Mission plan revised",
  control: "Mission control recorded",
  started: "Attempt started",
  settled: "Attempt settled",
  recovered: "Attempt recovered",
  workroom: "Mission workroom created",
  "report-posted": "Mission report posted",
  "conversation-receipt": "Mission conversation handoff recorded",
};
const missionExecutors: Record<string, string> = {
  "sample.cpu": "CPU utilization",
  "sample.ram": "RAM utilization",
  "sample.gpu": "GPU utilization",
  "sample.backend": "Backend timing",
  "inspect.backend-source": "Backend source check",
  "inspect.workspace-notes": "Workspace notes review",
  "codex.project-check": "Codex project check",
  "chatgpt.specialist": "Specialist task",
  "join.samples": "Measurement report",
  "join.team": "Team report",
};
export function recordedEventTitle(event: StreamEvent): string {
  const mission = event.mission;
  if (!mission) return event.type;
  const operation = missionOperations[mission.kind] ?? event.type;
  const task = missionExecutors[mission.executor ?? ""] ?? mission.taskId;
  return task ? `${task} · ${operation}` : operation;
}
export function missionEventInScope(
  event: StreamEvent,
  scope: Pick<EventWindow, "workspaceId" | "projectId">,
): boolean {
  const mission = event.mission;
  if (!mission) return !event.type.startsWith("vela.mission/");
  return mission.scope.workspaceId === scope.workspaceId && mission.scope.projectId === scope.projectId;
}
export function filterRecordedEvents(
  window: EventWindow,
  filters: EventFilters,
): StreamEvent[] {
  const allowed = new Set(window.resources.map((r) => r.id)),
    workspace = new Set(window.workspaceResourceIds),
    project = new Set(
      window.resources
        .filter((r) => r.projectId === window.projectId)
        .map((r) => r.id),
    ),
    terms = filters.query
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  return window.events
    .filter((event) => {
      // Resource metadata may have become unavailable since capture. Do not expose its event details.
      if (event.resourceId && !allowed.has(event.resourceId)) return false;
      if (!missionEventInScope(event, window)) return false;
      if (
        filters.scope === "workspace" &&
        !event.mission &&
        (!event.resourceId || !workspace.has(event.resourceId))
      )
        return false;
      if (
        filters.scope === "project" &&
        (window.projectId === null ||
          (!event.mission && (!event.resourceId || !project.has(event.resourceId))))
      )
        return false;
      return (
        (!filters.classification ||
          event.classification === filters.classification) &&
        (!filters.source || event.providerId === filters.source) &&
        (!filters.resourceId || event.resourceId === filters.resourceId) &&
        (!filters.executionId ||
          event.executionId?.includes(filters.executionId)) &&
        (filters.since === undefined ||
          Date.parse(event.receivedAt) >= filters.since) &&
        terms.every((term) =>
          [
            event.type,
            event.eventId,
            event.status,
            event.providerId,
            event.resourceId,
            event.executionId,
            event.correlationId,
            event.mission?.taskId,
            event.mission?.attemptId,
            event.mission?.executor,
            recordedEventTitle(event),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
        )
      );
    })
    .sort((a, b) => b.cursor - a.cursor);
}

/** Explicit metadata allowlist. Assistant deltas, private tool data and reasoning never enter details. */
export function eventMetadata(event: StreamEvent): Record<string, string> {
  const mission = event.mission;
  const data: Record<string, string | number | null | undefined> = {
    "Event ID": event.eventId,
    Cursor: event.cursor,
    Type: event.type,
    "Evidence class": event.classification,
    "Recorded status": event.status,
    "Received at": event.receivedAt,
    "Mission recorded at": mission?.occurredAt,
    "Provider time": event.providerTime,
    "Provider time source": event.providerTimeSource,
    Provider: event.providerId,
    "Provider instance": event.providerInstanceId,
    Connection: event.connectionId,
    Resource: event.resourceId,
    Execution: event.executionId,
    "Native thread": event.threadId,
    "Native turn": event.turnId,
    "Native sequence": event.nativeSequence,
    "Native event": event.nativeEventId,
    Correlation: event.correlationId,
    Causation: event.causationId,
    "Recorded output bytes": event.payload?.textBytes,
    "Recorded item type": event.payload?.itemType,
    ...(mission ? {
      Mission: mission.id,
      "Mission journal sequence": mission.seq,
      "Mission task": mission.taskId,
      "Mission attempt": mission.attemptId,
      "Task executor": mission.executor,
    } : {}),
  };
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value === null || value === undefined ? "Unavailable" : String(value),
    ]),
  );
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};
const button = (label: string, run: () => void) => {
  const element = node("button", label);
  element.type = "button";
  element.onclick = run;
  return element;
};

export function mountEventExperience(
  root: HTMLElement,
  port: {
    snapshot(): EventWindow;
    refresh(): Promise<void>;
    openResource?(resourceId: string): void;
    openMission?(missionId: string): void;
  },
  options: { active?: boolean; presentation?: "workspace" | "focused"; motion?: ExperienceMotionPort; viewId?: string } = {},
) {
  const section = node("section"),
    filters = node("div"),
    status = node("p"),
    coverage = node("p"),
    list = node("ol"),
    query = node("input"),
    source = node("select"),
    classification = node("select"),
    scope = node("select"),
    resource = node("select"),
    execution = node("input"),
    since = node("input");
  section.className = "aw-event-view";
  section.dataset.presentation = options.presentation ?? "focused";
  filters.className = "aw-event-filters";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  section.setAttribute("aria-label", "Recorded Intelligence Stream");
  query.type = "search";
  query.maxLength = 500;
  query.placeholder = "Search recorded event metadata";
  query.setAttribute("aria-label", "Search event metadata");
  execution.maxLength = 200;
  execution.placeholder = "Execution ID";
  execution.setAttribute("aria-label", "Execution ID filter");
  since.type = "datetime-local";
  since.setAttribute("aria-label", "Received after local date and time");
  const label = (text: string, input: HTMLElement) => {
    const element = node("label", text);
    element.append(input);
    return element;
  };
  const choices = (
    element: HTMLSelectElement,
    values: [string, string][],
    all: string,
  ) => {
    const selected = element.value;
    const entries: [string, string][] = [["", all], ...values];
    if (selected && !entries.some(([value]) => value === selected))
      entries.push([selected, "Unavailable selected filter"]);
    if (
      element.options.length === entries.length &&
      entries.every(
        ([value, title], i) =>
          element.options[i].value === value &&
          element.options[i].textContent === title,
      )
    )
      return;
    element.replaceChildren();
    for (const [value, title] of entries) {
      const option = node("option", title);
      option.value = value;
      element.append(option);
    }
    element.value = selected;
  };
  choices(
    scope,
    [
      ["workspace", "Current workspace"],
      ["project", "Current project"],
    ],
    "All authorized local records",
  );
  choices(
    classification,
    [
      ["observed", "Observed"],
      ["reported", "Provider reported"],
      ["inferred", "Inferred"],
      ["simulated", "Simulated fixture"],
    ],
    "All evidence classes",
  );
  filters.append(
    label("Scope", scope),
    label("Evidence", classification),
    label("Source", source),
    label("Resource", resource),
    execution,
    label("Received after", since),
  );
  let active = options.active ?? true,
    disposed = false,
    busy = false;
  const refresh = button("Refresh retained events", () => {
    if (busy || disposed || !active) return;
    busy = true;
    refresh.disabled = true;
    status.textContent = "Reading the canonical retained event window…";
    void port
      .refresh()
      .then(update)
      .catch((error) => {
        if (!disposed && active)
          status.textContent =
            error instanceof Error
              ? error.message
              : "Event service unavailable. Existing records are retained.";
      })
      .finally(() => {
        busy = false;
        refresh.disabled = false;
      });
  });
  const tools = node("div"),
    advanced = node("details"),
    about = node("details");
  tools.className = "aw-event-tools";
  advanced.className = "aw-event-advanced";
  advanced.append(node("summary", "Filters"), filters);
  about.className = "aw-event-about";
  about.append(
    node("summary", "Evidence coverage"),
    node(
      "p",
      "Recorded local events. Evidence classes describe their source; receipt alone is not verification. Private reasoning and uncaptured activity are unavailable.",
    ),
    coverage,
    node(
      "p",
      "Resource activity uses current membership. Mission activity is shown in its originating workspace.",
    ),
  );
  tools.append(query, advanced, refresh);
  const modes = node("div");
  modes.className = "aw-stream-modes";
  modes.setAttribute("aria-label", "Stream representation");
  let streamMode = "flow";
  const modeButtons = ["glimpse", "flow", "forensic"].map(value => {
    const action = button(value[0].toUpperCase() + value.slice(1), () => changeMode(value));
    action.setAttribute("aria-pressed", String(value === "flow"));
    modes.append(action);
    return action;
  });
  function changeMode(value: string) {
    streamMode = value;
    graph.setMode(value);
    list.hidden = value !== "forensic";
    for (const mode of modeButtons) mode.setAttribute("aria-pressed", String(mode.textContent?.toLowerCase() === value));
    update();
  }
  section.append(modes, tools, status);
  const graph = mountStreamGraph(section, {
    motion: options.motion, viewId: options.viewId, active, presentation: options.presentation,
    title: recordedEventTitle, metadata: eventMetadata,
    inspectOlder: () => changeMode("forensic"),
    open(event) {
      if (disposed || !active) return;
      if (event.mission) port.openMission?.(event.mission.id);
      else if (event.resourceId) port.openResource?.(event.resourceId);
    },
  });
  const missionFlow = mountMissionFlow(section, { motion: options.motion, viewId: options.viewId, active, presentation: options.presentation, openMission: port.openMission });
  graph.setMode(streamMode);
  list.hidden = true;
  section.append(list, about);
  root.append(section);
  for (const input of [
    scope,
    query,
    classification,
    source,
    resource,
    execution,
    since,
  ])
    input.addEventListener(
      input.tagName === "SELECT" ? "change" : "input",
      () => update(),
    );
  const rows = new Map<string, {
    element: HTMLLIElement;
    syncDetails(): void;
    retire(): void;
  }>();
  function update() {
    if (disposed || !active) return;
    const raw = port.snapshot();
    const window: EventWindow = {
      ...raw,
      events: filterRecordedEvents(raw, {
        scope: "all",
        classification: "",
        source: "",
        resourceId: "",
        executionId: "",
        query: "",
      }),
    };
    choices(
      source,
      [...new Set(window.events.map((event) => event.providerId))]
        .sort()
        .map((id) => [id, id]),
      "All recorded sources",
    );
    choices(
      resource,
      window.resources.map((r) => [r.id, r.title + " · " + r.id.slice(0, 8)]),
      "All accessible resources",
    );
    const selectedSince = since.value ? Date.parse(since.value) : undefined;
    if (selectedSince !== undefined && !Number.isFinite(selectedSince)) {
      // An invalid filter must not retain previously authorized inspection data.
      graph.update([]); missionFlow.update(null); graph.setAvailable(true);
      for (const row of rows.values()) row.retire();
      rows.clear(); list.replaceChildren();
      status.textContent = "Choose a valid received-after time.";
      return;
    }
    const result = filterRecordedEvents(window, {
      scope: (scope.value || "all") as EventFilters["scope"],
      classification: classification.value,
      source: source.value,
      resourceId: resource.value,
      executionId: execution.value,
      query: query.value,
      ...(selectedSince !== undefined ? { since: selectedSince } : {}),
    });
    const mission = missionFlowInScope(raw.mission, raw) ? raw.mission : null;
    missionFlow.update(mission, streamMode);
    graph.setAvailable(!mission);
    graph.update(result);
    const first = window.events.length
      ? Math.min(...window.events.map((event) => event.cursor))
      : null;
    coverage.textContent = [
      window.disconnected
        ? "Live connection unavailable; this is retained evidence."
        : "Connected event window.",
      window.earliest !== null && window.earliest > 1
        ? "Earlier journal records are outside retention."
        : "Coverage before the first captured event is unknown.",
      first !== null && window.earliest !== null && first > window.earliest
        ? "This view holds only the latest bounded event window; older retained events are omitted."
        : "",
      window.events.some((event) => /gap|reorder|reopened/.test(event.type))
        ? "The captured window includes a recorded gap, reorder or reconnect marker."
        : "",
      `Journal cursors ${window.earliest ?? "unavailable"}–${window.latest}.`,
    ]
      .filter(Boolean)
      .join(" ");
    status.textContent = `${Math.min(result.length, 100)} of ${result.length} matching records · ${window.events.length} in retained window.`;
    const visible = result.slice(0, 100),
      ids = new Set(visible.map((event) => event.eventId));
    for (const [id, row] of rows)
      if (!ids.has(id)) {
        rows.delete(id);
        row.retire();
      }
    list.querySelector(".aw-event-empty")?.remove();
    visible.forEach((event, index) => {
      let row = rows.get(event.eventId);
      if (!row) {
        const element = node("li"), details = node("details"), summary = node("summary");
        summary.className = "aw-event-entry";
        const title = recordedEventTitle(event);
        const recordedState = event.mission && event.status
          ? event.status.replace(/^./, (initial) => initial.toUpperCase())
          : event.status ?? "Status unavailable";
        const received = node("time"), heading = node("span", title),
          evidence = node("span", event.classification),
          recorded = node("span", recordedState);
        received.className = "aw-event-time";
        received.setAttribute("datetime", event.receivedAt);
        received.title = "Received " + event.receivedAt;
        const date = new Date(event.receivedAt);
        received.textContent = Number.isFinite(date.getTime())
          ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Time unavailable";
        heading.className = "aw-event-type";
        evidence.className = "aw-event-evidence";
        recorded.className = "aw-event-recorded-status";
        summary.setAttribute("aria-label", `${title} · ${event.classification} · ${recordedState} · received ${event.receivedAt}`);
        summary.append(received, heading, evidence, recorded);
        element.dataset.eventId = event.eventId;
        element.dataset.evidenceClass = event.classification;
        if (event.mission) {
          heading.dataset.recordedType = event.type;
          heading.title = event.type;
          element.dataset.streamMissionId = event.mission.id;
          element.dataset.streamMissionEvent = event.mission.kind;
          if (event.mission.taskId) element.dataset.streamTaskId = event.mission.taskId;
          if (event.status) element.dataset.eventStatus = event.status;
        }
        details.append(summary);
        element.append(details);

        let metadata: HTMLDListElement | undefined;
        let related: HTMLButtonElement | undefined;
        const isOpen = () =>
          active && !disposed && details.open && rows.get(event.eventId)?.element === element;
        const clearDetails = () => {
          metadata?.remove();
          related?.remove();
          metadata = undefined;
          related = undefined;
        };
        const syncDetails = () => {
          if (!isOpen()) {
            clearDetails();
            return;
          }
          if (metadata) return;
          metadata = node("dl");
          for (const [key, value] of Object.entries(eventMetadata(event)))
            metadata.append(node("dt", key), node("dd", value));
          details.append(metadata);
          const resourceId = event.resourceId, missionId = event.mission?.id;
          if (missionId && port.openMission) {
            const action = button("Open mission evidence", () => {
              if (related === action && isOpen()) port.openMission?.(missionId);
            });
            related = action;
            details.append(action);
          } else if (resourceId && port.openResource) {
            const action = button("Open related resource", () => {
              if (related === action && isOpen()) port.openResource?.(resourceId);
            });
            related = action;
            details.append(action);
          }
        };
        details.addEventListener("toggle", syncDetails);
        row = {
          element,
          syncDetails,
          retire() {
            details.removeEventListener("toggle", syncDetails);
            clearDetails();
            element.remove();
          },
        };
        rows.set(event.eventId, row);
      }
      const current = list.children[index];
      if (current !== row.element) list.insertBefore(row.element, current ?? null);
    });
    if (!visible.length) {
      const empty = node("li", "No matching captured events in this window.");
      empty.className = "aw-event-empty";
      list.append(empty);
    }
  }
  update();
  return {
    update,
    frame() { graph.frame(); missionFlow.frame(); },
    setPresentation(value: "workspace" | "focused") {
      section.dataset.presentation = value;
      graph.setPresentation(value); missionFlow.setPresentation(value);
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      graph.setActive(value);
      missionFlow.setActive(value);
      if (active) update();
      for (const row of rows.values()) row.syncDetails();
    },
    dispose() {
      disposed = true;
      graph.dispose();
      missionFlow.dispose();
      for (const row of rows.values()) row.retire();
      rows.clear();
      section.remove();
    },
  };
}
