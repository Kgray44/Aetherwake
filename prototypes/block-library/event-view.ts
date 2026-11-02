import type { StreamEvent } from "../integrated-backend/src/contracts.mts";

export type EventWindow = {
  events: readonly StreamEvent[];
  earliest: number | null;
  latest: number;
  disconnected: boolean;
  resources: readonly { id: string; projectId: string | null; title: string }[];
  workspaceResourceIds: readonly string[];
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
      if (
        filters.scope === "workspace" &&
        (!event.resourceId || !workspace.has(event.resourceId))
      )
        return false;
      if (
        filters.scope === "project" &&
        (window.projectId === null ||
          !event.resourceId ||
          !project.has(event.resourceId))
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
  const data: Record<string, string | number | null | undefined> = {
    "Event ID": event.eventId,
    Cursor: event.cursor,
    Type: event.type,
    "Evidence class": event.classification,
    "Recorded status": event.status,
    "Received at": event.receivedAt,
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
  },
  options: { active?: boolean; presentation?: "workspace" | "focused" } = {},
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
      ["workspace", "Current workspace resource membership"],
      ["project", "Current project resource membership"],
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
      "Workspace and project scopes use current membership, not membership at event time.",
    ),
  );
  tools.append(query, advanced, refresh);
  section.append(tools, status, list, about);
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
  const rows = new Map<string, HTMLLIElement>();
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
        row.remove();
        rows.delete(id);
      }
    list.querySelector(".aw-event-empty")?.remove();
    visible.forEach((event, index) => {
      let row = rows.get(event.eventId);
      if (!row) {
        row = node("li");
        const details = node("details"),
          summary = node(
            "summary",
            `${event.classification} · ${event.type} · ${event.status ?? "status unavailable"} · ${event.receivedAt}`,
          ),
          metadata = node("dl");
        row.dataset.eventId = event.eventId;
        for (const [key, value] of Object.entries(eventMetadata(event)))
          metadata.append(node("dt", key), node("dd", value));
        details.append(summary, metadata);
        if (event.resourceId && port.openResource)
          details.append(
            button("Open related resource", () => {
              if (active && !disposed && rows.has(event.eventId))
                port.openResource!(event.resourceId!);
            }),
          );
        row.append(details);
        rows.set(event.eventId, row);
      }
      const current = list.children[index];
      if (current !== row) list.insertBefore(row, current ?? null);
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
    setPresentation(value: "workspace" | "focused") {
      section.dataset.presentation = value;
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      if (active) update();
    },
    dispose() {
      disposed = true;
      section.remove();
    },
  };
}
