import type { TimelineExperience } from "../../../block-library/timeline-view.ts";
import type { MissionProjection, MissionTaskState, MissionWorkroomDashboard, MissionWorkroomResource } from "../../../integrated-backend/src/mission-contracts.mts";
import { missionEventLabel, missionStateLabel } from "./vela-missions.ts";

export interface MissionWorkroomView extends TimelineExperience {
  setScope(scope: string | null): void;
  observe(accessChanged?: boolean): void;
}

const waitLabel: Record<MissionProjection["waits"][string], string> = {
  dependencies: "Waiting for verified prerequisites",
  capacity: "Waiting for a worker",
  "resource-conflict": "Waiting for a resource claim",
  "resource-pressure": "Waiting for host capacity",
};
const dashboardTitle = {
  graph: "Mission graph",
  team: "Agent team",
  evidence: "Verification evidence",
  performance: "Mission performance",
  stream: "Mission Intelligence Stream",
};
const evidenceClass = new Map([
  ["observed", "Observed"], ["reported", "Provider reported"],
  ["inferred", "Inferred"], ["simulated", "Simulated"],
]);
const streamLabel = new Map(Object.entries({ ...missionEventLabel, "report-posted": "Mission report posted" }));

/** Resolves the canonical card binding before mounting either presentation. */
export function mountMissionWorkroomView(
  root: HTMLElement,
  kind: "checklist" | "timeline" | "dashboard" | "stream",
  initialScope: string | null,
  read: () => Promise<MissionWorkroomResource | null>,
  mountManual: ((container: HTMLElement) => TimelineExperience) | undefined,
  openMission: (id: string) => void,
): MissionWorkroomView {
  const doc = root.ownerDocument;
  const section = doc.createElement("section");
  section.className = "aw-mission-workroom";
  section.dataset.noCardDrag = "true";
  const heading = doc.createElement("h3");
  const initialTitle = {
    checklist: "Mission checklist", timeline: "Observed mission timeline",
    dashboard: "Mission card", stream: dashboardTitle.stream,
  }[kind];
  heading.textContent = initialTitle;
  const status = doc.createElement("p");
  status.setAttribute("role", "status");
  const intro = doc.createElement("p");
  intro.hidden = true;
  const list = doc.createElement("ol");
  const open = doc.createElement("button");
  open.type = "button";
  open.textContent = kind === "checklist" || kind === "timeline" ? "Open mission evidence" : "Open mission plan";
  open.dataset.aerynthMotionControl = "true";
  section.append(heading, status, intro, open, list);
  const manualDetails = doc.createElement("details");
  manualDetails.className = "aw-mission-workroom-controls";
  manualDetails.dataset.noCardDrag = "true";
  const manualSummary = doc.createElement("summary");
  manualSummary.textContent = {
    checklist: "Manual checklist", timeline: "Timeline settings and activity",
    dashboard: "Edit the associated note", stream: "Workspace Intelligence Stream",
  }[kind];
  const manualHost = doc.createElement("div");
  manualHost.style.display = "contents";
  manualDetails.append(manualSummary);

  let scope = initialScope, generation = 0, active = true, disposed = false;
  let presentation: "workspace" | "focused" = "workspace";
  let manual: TimelineExperience | undefined, resolvedManual = false;
  let projection: MissionWorkroomResource | null = null;
  let projectionStamp: string | null = null;
  let pending: Promise<void> | null = null, queued = false;

  const statusOnly = (message: string) => {
    projection = null;
    projectionStamp = null;
    delete section.dataset.missionWorkroomCard;
    delete section.dataset.missionId;
    delete section.dataset.missionRevision;
    heading.textContent = initialTitle;
    status.textContent = message;
    intro.textContent = "";
    intro.hidden = true;
    open.hidden = true;
    list.replaceChildren();
    if (section.parentElement !== root || root.children.length !== 1) root.replaceChildren(section);
  };
  const syncManual = () => {
    const show = active && (resolvedManual || (projection !== null && manualDetails.open));
    if (show && !manual && mountManual) {
      manual = mountManual(manualHost);
      manual.setPresentation(presentation);
    }
    manual?.setActive(show);
  };
  manualDetails.addEventListener("toggle", syncManual);

  function note(parent: HTMLElement, text: string) {
    const node = doc.createElement("small");
    node.textContent = text;
    parent.append(node);
  }

  function taskRow(id: string, title: string, state: MissionTaskState) {
    const row = doc.createElement("li");
    row.dataset.missionTask = id;
    row.dataset.taskState = state;
    row.append(doc.createTextNode(title));
    note(row, missionStateLabel[state]);
    return row;
  }

  function stampTime(parent: HTMLElement, value: string) {
    const time = doc.createElement("time");
    time.dateTime = value;
    time.textContent = value;
    parent.append(time);
  }

  function dashboardRows(value: MissionWorkroomDashboard): { rows: HTMLLIElement[]; coverage: string; intro?: string } {
    switch (value.kind) {
      case "graph": {
        const titles = new Map(value.tasks.map(({ id, title }) => [id, title]));
        const rows = value.tasks.map(task => {
          const row = taskRow(task.id, task.title, task.state);
          row.dataset.taskDependencies = JSON.stringify(task.dependencies);
          note(row, task.role ? `${task.role} · ${task.executor}` : task.executor);
          note(row, task.dependencies.length
            ? `Requires ${task.dependencies.map(id => titles.get(id) ?? id).join(", ")}`
            : "No prerequisites");
          if (task.wait) note(row, waitLabel[task.wait]);
          return row;
        });
        return { rows, coverage: `Plan v${value.planRevision} · ${rows.length} tasks`, intro: value.objective };
      }
      case "team": {
        const rows = value.members.map(member => {
          const row = taskRow(member.taskId, member.role, member.state);
          note(row, member.responsibility);
          if (member.provider || member.model) note(row, [member.provider, member.model].filter(Boolean).join(" · "));
          note(row, `${member.attempts} ${member.attempts === 1 ? "attempt" : "attempts"}`);
          return row;
        });
        return { rows, coverage: `${rows.length} specialist assignments`, intro: value.title };
      }
      case "evidence": {
        const previous = Array.from(list.querySelectorAll<HTMLDetailsElement>("details[data-evidence-task]"));
        const opened = new Set(previous.filter(node => node.open).map(node => node.dataset.evidenceTask));
        const rows = value.rows.map(item => {
          const row = taskRow(item.taskId, item.title, item.state);
          if (item.evidenceId) row.dataset.missionEvidenceId = item.evidenceId;
          note(row, `Criterion · ${item.criterion}`);
          if (item.passed === undefined) note(row, "Current verification unavailable");
          else note(row, item.passed ? "Evidence check passed" : "Evidence check failed");
          if (item.evidenceId || item.verification || item.findings?.length || item.citations?.length) {
            const details = doc.createElement("details");
            details.dataset.evidenceTask = item.taskId;
            details.open = opened.has(item.taskId);
            const summary = doc.createElement("summary");
            summary.textContent = "Inspect evidence";
            details.append(summary);
            if (item.verification) note(details, item.verification);
            if (item.source) note(details, `Source · ${item.source}`);
            if (item.observedAt) stampTime(details, item.observedAt);
            if (item.evidenceId) note(details, `Evidence ID · ${item.evidenceId}`);
            if (item.findings?.length) {
              note(details, item.source === "chatgpt-plan-responses:reported" ? "Provider-reported findings" : "Measured results");
              for (const finding of item.findings) note(details, finding);
            }
            for (const citation of item.citations ?? []) note(details, `Provider citation · ${citation}`);
            row.append(details);
          }
          return row;
        });
        return { rows, coverage: `${value.rows.filter(item => item.state === "verified").length} of ${rows.length} tasks verified`,
          intro: `Acceptance criteria · ${value.criteria.join(", ")}` };
      }
      case "performance": {
        const { profile } = value;
        const number = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 });
        const metrics = [
          ["elapsedMs", "Elapsed time", `${number.format(profile.elapsedMs)} ms`],
          ["peakWorkers", "Peak workers", number.format(profile.peakWorkers)],
          ["attempts", "Attempts", number.format(profile.attempts)],
          ["retries", "Retries", number.format(profile.retries)],
          ["providerCalls", "Provider calls", profile.providerCalls === null ? "Unavailable" : number.format(profile.providerCalls)],
          ["usageReports", "Usage reports", number.format(profile.usageReports)],
          ["reportedTotalTokens", "Reported tokens", profile.reportedTotalTokens === null ? "Unavailable" : number.format(profile.reportedTotalTokens)],
          ["verifiedObjectivesPerReportedToken", "Verified objectives per reported token", profile.verifiedObjectivesPerReportedToken === null
            ? "Unavailable" : number.format(profile.verifiedObjectivesPerReportedToken)],
        ];
        const rows = metrics.map(([key, label, reading]) => {
          const row = doc.createElement("li");
          row.dataset.missionMetric = key;
          const field = doc.createElement("strong");
          field.textContent = reading;
          row.append(doc.createTextNode(label), field);
          return row;
        });
        return { rows, coverage: "Recorded mission telemetry" };
      }
      case "stream": {
        const rows = value.events.map(event => {
          const row = doc.createElement("li");
          row.dataset.streamEventId = event.eventId;
          row.dataset.streamCursor = String(event.cursor);
          const action = event.type.replace(/^vela\.mission\//u, "");
          row.append(doc.createTextNode(streamLabel.get(action) ?? event.type));
          note(row, [evidenceClass.get(event.classification) ?? "Evidence class unavailable", event.status, event.taskId,
            event.executor].filter(Boolean).join(" · "));
          stampTime(row, event.receivedAt);
          return row;
        });
        return { rows, coverage: rows.length ? `${rows.length} recent retained events` : "No retained mission events" };
      }
    }
  }

  const render = (value: MissionWorkroomResource) => {
    const stamp = JSON.stringify(value);
    if (projectionStamp === stamp) return;
    projection = value;
    projectionStamp = stamp;
    section.dataset.missionWorkroomCard = value.dashboard?.kind ?? kind;
    section.dataset.missionId = value.missionId;
    section.dataset.missionRevision = String(value.revision);
    heading.textContent = value.dashboard ? dashboardTitle[value.dashboard.kind] : initialTitle;
    heading.hidden = !!value.dashboard;
    section.setAttribute("aria-label", heading.textContent);
    open.hidden = false;
    const displayed = value.dashboard ? dashboardRows(value.dashboard) : value.checklist ? {
      coverage: `${value.checklist.filter((task) => task.state === "verified").length} of ${value.checklist.length} tasks verified`,
      rows: value.checklist.map(task => taskRow(task.taskId, task.title, task.state)),
    } : {
      coverage: `${value.timeline.length} recorded events`,
      rows: value.timeline.map(event => {
        const row = doc.createElement("li");
        row.dataset.missionSequence = String(event.seq);
        const label = [`#${event.seq} ${missionEventLabel[event.kind]}`, event.taskId, event.detail].filter(Boolean).join(" · ");
        row.append(doc.createTextNode(label));
        stampTime(row, event.time);
        return row;
      }),
    };
    status.textContent = `${missionStateLabel[value.outcome]} · ${displayed.coverage} · Journal revision ${value.revision}`;
    intro.textContent = "intro" in displayed ? displayed.intro ?? "" : "";
    intro.hidden = !intro.textContent;
    const activeDisclosure = list.contains(doc.activeElement)
      ? doc.activeElement?.closest<HTMLDetailsElement>("details[data-evidence-task]")?.dataset.evidenceTask : undefined;
    list.replaceChildren(...displayed.rows);
    if (activeDisclosure) {
      const replacement = Array.from(list.querySelectorAll<HTMLDetailsElement>("details[data-evidence-task]"))
        .find(node => node.dataset.evidenceTask === activeDisclosure)?.querySelector("summary");
      (replacement ?? open).focus({ preventScroll: true });
    }
    if (mountManual && manualDetails.parentElement !== root) {
      manualDetails.append(manualHost);
      root.replaceChildren(section, manualDetails);
    } else if (!mountManual && section.parentElement !== root) root.replaceChildren(section);
    syncManual();
  };
  open.onclick = () => {
    if (active && projection && !disposed) openMission(projection.missionId);
  };

  function refreshProjection() {
    if (!active || disposed || doc.hidden) return Promise.resolve();
    queued = true;
    if (pending) return pending;
    pending = (async () => {
      while (queued && active && !disposed && !doc.hidden) {
        queued = false;
        const stamp = generation;
        try {
          const value = scope ? await read() : null;
          if (stamp !== generation || disposed || !active || doc.hidden) continue;
          if (value === null) {
            if (!mountManual) {
              statusOnly("Mission card unavailable in this workspace.");
              continue;
            }
            projection = null;
            projectionStamp = null;
            resolvedManual = true;
            if (manualHost.parentElement !== root) root.replaceChildren(manualHost);
            syncManual();
          } else {
            const matched = kind === "dashboard" ? value.dashboard && value.dashboard.kind !== "stream" : kind === "stream"
              ? value.dashboard?.kind === "stream" : Array.isArray(value[kind]);
            if (!matched) throw new Error("mission_workroom_card_kind_changed");
            resolvedManual = false;
            render(value);
          }
        } catch {
          if (stamp === generation && active && !disposed)
            statusOnly("The mission card could not be refreshed.");
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  statusOnly("Checking the mission card…");
  void refreshProjection();
  return {
    setScope(next) {
      if (scope === next) return;
      scope = next;
      generation++;
      resolvedManual = false;
      manualDetails.open = false;
      manual?.setActive(false);
      statusOnly("Checking the mission card…");
      void refreshProjection();
    },
    observe(accessChanged) {
      if (resolvedManual && !accessChanged) return;
      if (accessChanged) {
        generation++;
        resolvedManual = false;
        statusOnly("Checking mission card access…");
        syncManual();
      }
      void refreshProjection();
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      section.inert = !next;
      manualDetails.inert = !next;
      syncManual();
      if (next && !resolvedManual) void refreshProjection();
    },
    setPresentation(next) {
      presentation = next;
      manual?.setPresentation(next);
    },
    async refresh() {
      if (!resolvedManual) await refreshProjection();
      if (active && (resolvedManual || manualDetails.open)) await manual?.refresh();
    },
    async flush() { await manual?.flush(); },
    frame() { manual?.frame(); },
    reflow() { manual?.reflow(); },
    dispose() {
      disposed = true;
      manual?.dispose();
      section.remove();
      manualDetails.remove();
      manualHost.remove();
    },
  };
}
