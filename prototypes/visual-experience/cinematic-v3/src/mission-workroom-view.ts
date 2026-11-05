import type { TimelineExperience } from "../../../block-library/timeline-view.ts";
import type { MissionProjection, MissionTaskState, MissionWorkroomDashboard, MissionWorkroomResource } from "../../../integrated-backend/src/mission-contracts.mts";
import { missionAdmissionDetails, missionAdmissionRefreshMs, missionEventLabel, missionStateLabel } from "./vela-missions.ts";
import type { ExperienceMotionPort } from '../../../application-contract/motion.ts';
import { mountMissionFlow } from '../../../block-library/mission-flow.ts';

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
  agent: "Specialist assignment",
  evidence: "Verification evidence",
  performance: "Mission performance",
  stream: "Mission Intelligence Stream",
};
const evidenceClass = new Map([
  ["observed", "Observed"], ["reported", "Provider reported"],
  ["inferred", "Inferred"], ["simulated", "Simulated"],
]);
const streamLabel = new Map(Object.entries({ ...missionEventLabel, "report-posted": "Mission report posted",
  "conversation-receipt": "Mission conversation handoff recorded" }));

/** Resolves the canonical card binding before mounting either presentation. */
export function mountMissionWorkroomView(
  root: HTMLElement,
  kind: "checklist" | "timeline" | "dashboard" | "stream",
  initialScope: string | null,
  read: () => Promise<MissionWorkroomResource | null>,
  mountManual: ((container: HTMLElement) => TimelineExperience) | undefined,
  openMission: (id: string) => void,
  openResource?: (id: string) => void,
  options?: { motion: ExperienceMotionPort; viewId: string; readMission(id: string): Promise<MissionProjection | null> },
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
  const journalDetails = doc.createElement('details'), journalSummary = doc.createElement('summary');
  journalDetails.className = 'aw-mission-workroom-controls'; journalDetails.dataset.noCardDrag = 'true';
  journalSummary.textContent = 'Forensic mission journal · recorded events'; journalDetails.append(journalSummary);
  const flowHost = doc.createElement('div'), flowControls = doc.createElement('div'), flowStatus = doc.createElement('p');
  flowControls.className = 'aw-stream-controls'; flowControls.setAttribute('role', 'group'); flowControls.setAttribute('aria-label', 'Mission presentation');
  flowStatus.className = 'aw-stream-coverage'; flowStatus.setAttribute('role', 'status');
  flowControls.hidden = flowHost.hidden = flowStatus.hidden = true;
  section.insertBefore(flowControls, list); section.insertBefore(flowStatus, list); section.insertBefore(flowHost, list);

  let scope = initialScope, generation = 0, active = true, disposed = false;
  let presentation: "workspace" | "focused" = "workspace";
  let manual: TimelineExperience | undefined, resolvedManual = false;
  let projection: MissionWorkroomResource | null = null;
  let projectionStamp: string | null = null;
  let pending: Promise<void> | null = null, queued = false;
  let admissionRefresh: ReturnType<typeof setTimeout> | undefined;
  let primaryTimeline = false, flowMode = 'flow', flowEpoch = 0;
  let flow: ReturnType<typeof mountMissionFlow> | undefined, fullMission: MissionProjection | null = null;
  const modeButtons = new Map<string, HTMLButtonElement>();
  const eligibleFlow = (value: MissionWorkroomResource | null) => value?.dashboard?.kind === 'graph' || value?.dashboard?.kind === 'stream';
  function clearFlow() {
    flowEpoch++; flow?.dispose(); flow = undefined; fullMission = null;
    flowHost.hidden = true; flowControls.hidden = true; flowStatus.hidden = true; flowStatus.textContent = ''; list.hidden = false;
  }
  function displayFlowMode() {
    for (const [mode, button] of modeButtons) { button.disabled = !active || !fullMission; button.setAttribute('aria-pressed', String(mode === flowMode)); }
    list.hidden = !!fullMission && flowMode !== 'forensic';
    flowHost.hidden = !fullMission || flowMode === 'forensic';
    if (flow && fullMission) { flow.setActive(active && flowMode !== 'forensic'); flow.update(fullMission, flowMode); }
  }
  for (const mode of ['flow', 'glimpse', 'forensic']) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = mode[0].toUpperCase() + mode.slice(1); button.dataset.workroomMode = mode;
    button.dataset.aerynthMotionControl = 'true'; button.onclick = () => { if (!disposed && active && fullMission) { flowMode = mode; displayFlowMode(); } };
    modeButtons.set(mode, button); flowControls.append(button);
  }
  async function readFlow(value: MissionWorkroomResource, sourceGeneration: number) {
    if (!eligibleFlow(value)) { clearFlow(); return; }
    if (!options) { clearFlow(); flowStatus.hidden = false; flowStatus.textContent = 'Dependency Flow is unavailable in this surface. Recorded rows are shown as a forensic fallback.'; return; }
    if (fullMission && (fullMission.id !== value.missionId || fullMission.revision < value.revision)) clearFlow();
    const token = ++flowEpoch, requestedScope = scope, minimumRevision = Math.max(value.revision, fullMission?.revision ?? 0);
    flowStatus.hidden = false; flowStatus.textContent = 'Reading authorized mission dependencies…';
    try {
      const mission = await options.readMission(value.missionId);
      if (disposed || !active || doc.hidden || token !== flowEpoch || sourceGeneration !== generation || scope !== requestedScope) return;
      if (!mission || mission.contract !== 'aerynth.vela-mission@1' || mission.id !== value.missionId || mission.revision < minimumRevision || projection?.missionId !== mission.id)
        throw new Error('mission_flow_projection_unavailable');
      fullMission = mission;
      flow ??= mountMissionFlow(flowHost, { motion: options.motion, viewId: `${options.viewId}:${generation}:${flowEpoch}`, active, openMission });
      flowControls.hidden = false; flowStatus.textContent = 'Current authorized task dependencies · retained event rows remain available in Forensic.';
      displayFlowMode();
    } catch {
      if (disposed || token !== flowEpoch || sourceGeneration !== generation || scope !== requestedScope) return;
      clearFlow(); list.hidden = true; flowStatus.hidden = false; flowStatus.textContent = 'Mission dependency access could not be confirmed. Refresh or reopen this card.';
    }
  }
  const visibilityChanged = () => {
    if (doc.hidden) { generation++; clearFlow(); manual?.setActive(false); }
    else if (active && !disposed) { syncManual(); void refreshProjection(); }
  };
  doc.addEventListener?.('visibilitychange', visibilityChanged);

  function syncAdmissionRefresh() {
    const shouldRefresh = active && !disposed && !doc.hidden && projection?.dashboard?.kind === "performance" &&
      (projection.outcome === "queued" || projection.outcome === "running");
    if (!shouldRefresh) {
      clearTimeout(admissionRefresh);
      admissionRefresh = undefined;
    } else if (!pending && admissionRefresh === undefined) {
      admissionRefresh = setTimeout(() => {
        admissionRefresh = undefined;
        void refreshProjection();
      }, missionAdmissionRefreshMs);
    }
  }

  const statusOnly = (message: string) => {
    clearFlow(); primaryTimeline = false; resolvedManual = false; manual?.setActive(false);
    projection = null;
    projectionStamp = null;
    syncAdmissionRefresh();
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
    const show = active && (resolvedManual || primaryTimeline || (projection !== null && manualDetails.open));
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
      case "agent": {
        const assignment = taskRow(value.taskId, value.role, value.state);
        assignment.dataset.missionAgentTask = value.taskId;
        note(assignment, value.title);
        note(assignment, `${value.provider} · ${value.model}`);
        note(assignment, `Criterion · ${value.criterion}`);
        if (value.retired) note(assignment, "Retired assignment · retained history");
        note(assignment, `${value.maxAttempts} permitted attempts · ${value.timeoutMs} ms timeout per attempt`);
        note(assignment, value.webSearch ? "Hosted web search permitted for this assignment" : "No hosted tools permitted");
        if (value.wait) note(assignment, waitLabel[value.wait]);
        if (value.dependencies.length) note(assignment, `Requires ${value.dependencies.join(", ")}`);
        if (!value.attempts.length) note(assignment, "Assigned · execution has not started");
        if (value.state === "verified") note(assignment, "Report contract verified · recommendations remain provider-reported");
        if (value.profile) {
          const profile = value.profile;
          note(assignment, `${profile.title} · assigned profile v${profile.profileVersion}`);
          if (openResource) {
            const button = doc.createElement("button");
            button.type = "button";
            button.textContent = "Open source profile";
            button.dataset.missionAgentProfile = profile.id;
            button.onclick = () => {
              if (active && !disposed && projection?.dashboard?.kind === "agent" &&
                projection.dashboard.profile?.id === profile.id) openResource(profile.id);
            };
            assignment.append(button);
          }
        }
        const rows = [assignment, ...value.attempts.map((attempt, index) => {
          const row = doc.createElement("li"), details = doc.createElement("details"), summary = doc.createElement("summary");
          row.dataset.agentAttempt = attempt.id;
          details.dataset.workroomDisclosure = `agent:${value.taskId}:${attempt.id}`;
          const progress = index === value.attempts.length - 1 && ["running", "cancelling"].includes(value.state)
            ? missionStateLabel[value.state] : "Outcome unavailable";
          summary.textContent = `Attempt ${index + 1} · ${attempt.outcome ? missionStateLabel[attempt.outcome] : progress}`;
          details.append(summary);
          note(details, `Attempt ID · ${attempt.id}`);
          stampTime(details, attempt.admittedAt);
          if (attempt.finishedAt) stampTime(details, attempt.finishedAt);
          if (attempt.passed !== undefined) note(details, attempt.passed ? "Report contract passed" : "Report contract failed");
          if (attempt.verification) note(details, attempt.verification);
          if (attempt.detail) note(details, attempt.detail);
          if (attempt.evidenceId) note(details, `Evidence ID · ${attempt.evidenceId}`);
          if (attempt.source) note(details, `Source · ${attempt.source}`);
          if (attempt.observedAt) stampTime(details, attempt.observedAt);
          if (attempt.timing) {
            const labels = { queueMs: "Queue", contextPreparationMs: "Context preparation", executionMs: "Execution", verificationMs: "Verification" };
            for (const [field, label] of Object.entries(labels)) {
              const duration = attempt.timing[field as keyof typeof labels];
              if (duration !== undefined) note(details, `${label} · ${Math.round(duration)} ms`);
            }
          }
          if (attempt.findings?.length) {
            note(details, "Provider-reported findings · factual confirmation is separate");
            for (const finding of attempt.findings) note(details, finding);
          }
          for (const citation of attempt.citations ?? []) note(details, `Provider citation · ${citation}`);
          if (attempt.telemetry) {
            const { durationMs, providerCalls, usage, responseId, reportedModel } = attempt.telemetry;
            note(details, `Recorded duration · ${Math.round(durationMs)} ms · ${providerCalls} provider calls`);
            note(details, usage ? `Provider-reported tokens · ${usage.inputTokens} input / ${usage.outputTokens} output / ${usage.totalTokens} total`
              : "Provider usage unavailable");
            if (responseId) note(details, `Response ID · ${responseId}`);
            if (reportedModel) note(details, `Provider-reported model · ${reportedModel}`);
          } else note(details, "Provider usage unavailable");
          if (attempt.context) {
            const context = attempt.context;
            note(details, `Context manifest · ${context.digest}`);
            note(details, `${context.accounting.method === "tokenizer" ? "Tokenizer count" : "Estimated context tokens"} · ${context.accounting.tokens} / ${context.accounting.maxTokens}`);
            for (const source of context.sources) note(details, `Source ${source.ref.id} · version ${source.version} · ${source.digest}`);
            for (const dependency of context.dependencies) note(details, `Dependency ${dependency.taskId} · evidence ${dependency.evidenceId}`);
          }
          row.append(details);
          return row;
        })];
        return { rows, coverage: `${value.attempts.length} recorded ${value.attempts.length === 1 ? "attempt" : "attempts"}`,
          intro: value.responsibility };
      }
      case "evidence": {
        const rows = value.rows.map(item => {
          const row = taskRow(item.taskId, item.title, item.state);
          if (item.evidenceId) row.dataset.missionEvidenceId = item.evidenceId;
          note(row, `Criterion · ${item.criterion}`);
          if (item.passed === undefined) note(row, "Current verification unavailable");
          else note(row, item.passed ? "Evidence check passed" : "Evidence check failed");
          if (item.evidenceId || item.verification || item.findings?.length || item.citations?.length) {
            const details = doc.createElement("details");
            details.dataset.evidenceTask = item.taskId;
            details.dataset.workroomDisclosure = `evidence:${item.taskId}`;
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
        if (value.admission) {
          const row = doc.createElement("li"), details = missionAdmissionDetails(doc, value.admission, "current");
          details.dataset.workroomDisclosure = "admission";
          row.append(details);
          rows.unshift(row);
        }
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
          if (event.occurredAt && Date.parse(event.receivedAt) - Date.parse(event.occurredAt) >= 1000)
            note(row, `Recorded in the mission journal at ${event.occurredAt}`);
          return row;
        });
        const coverage = rows.length ? `${rows.length} recent retained events` : "No retained mission events";
        return { rows, coverage: value.publicationPending ? `${coverage} · More activity waiting to publish` : coverage };
      }
    }
  }

  const render = (value: MissionWorkroomResource) => {
    const stamp = JSON.stringify(value);
    if (projectionStamp === stamp) return;
    projection = value;
    projectionStamp = stamp;
    syncAdmissionRefresh();
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
    const nextStatus = `${missionStateLabel[value.outcome]} · ${displayed.coverage} · Journal revision ${value.revision}`;
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
    intro.textContent = "intro" in displayed ? displayed.intro ?? "" : "";
    intro.hidden = !intro.textContent;
    const selector = "details[data-workroom-disclosure]";
    const opened = new Set(Array.from(list.querySelectorAll<HTMLDetailsElement>(selector))
      .filter(node => node.open).map(node => node.dataset.workroomDisclosure));
    const activeDisclosure = list.contains(doc.activeElement)
      ? doc.activeElement?.closest<HTMLDetailsElement>(selector)?.dataset.workroomDisclosure : undefined;
    list.replaceChildren(...displayed.rows);
    const disclosures = Array.from(list.querySelectorAll<HTMLDetailsElement>(selector));
    for (const detail of disclosures) detail.open = opened.has(detail.dataset.workroomDisclosure);
    if (activeDisclosure) {
      const replacement = disclosures.find(node => node.dataset.workroomDisclosure === activeDisclosure)?.querySelector("summary");
      (replacement ?? open).focus({ preventScroll: true });
    }
    primaryTimeline = kind === 'timeline' && !!value.timeline && !!mountManual;
    if (primaryTimeline) {
      if (section.parentElement !== journalDetails) journalDetails.append(section);
      if (manualHost.parentElement !== root || journalDetails.parentElement !== root) root.replaceChildren(manualHost, journalDetails);
    } else if (mountManual && manualDetails.parentElement !== root) {
      manualDetails.append(manualHost);
      root.replaceChildren(section, manualDetails);
    } else if (!mountManual && section.parentElement !== root) root.replaceChildren(section);
    syncManual();
  };
  open.onclick = () => {
    if (active && projection && !disposed) openMission(projection.missionId);
  };

  function refreshProjection() {
    if (!active || disposed || doc.hidden) { syncAdmissionRefresh(); return Promise.resolve(); }
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
            clearFlow(); primaryTimeline = false;
            syncAdmissionRefresh();
            resolvedManual = true;
            if (manualHost.parentElement !== root) root.replaceChildren(manualHost);
            syncManual();
          } else {
            const matched = kind === "dashboard" ? value.dashboard && value.dashboard.kind !== "stream" : kind === "stream"
              ? value.dashboard?.kind === "stream" : Array.isArray(value[kind]);
            if (!matched) throw new Error("mission_workroom_card_kind_changed");
            resolvedManual = false;
            render(value);
            await readFlow(value, stamp);
          }
        } catch {
          if (stamp === generation && active && !disposed)
            statusOnly("The mission card could not be refreshed.");
        }
      }
    })().finally(() => { pending = null; syncAdmissionRefresh(); });
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
      if (!next) { generation++; clearFlow(); } else flow?.setActive(true);
      syncAdmissionRefresh();
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
      if (active && (resolvedManual || primaryTimeline || manualDetails.open)) await manual?.refresh();
    },
    async flush() { await manual?.flush(); },
    frame() { if (active && !disposed && !doc.hidden) { manual?.frame(); flow?.frame(); } },
    reflow() { manual?.reflow(); },
    dispose() {
      disposed = true;
      generation++; clearFlow();
      syncAdmissionRefresh();
      manual?.dispose();
      section.remove();
      manualDetails.remove();
      manualHost.remove();
      journalDetails.remove();
      doc.removeEventListener?.('visibilitychange', visibilityChanged);
    },
  };
}
