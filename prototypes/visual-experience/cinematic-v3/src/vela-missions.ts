import { MISSION_CONTRACT, MISSION_LIMITS } from "../../../integrated-backend/src/mission-contracts.mts";
import type {
  MissionAdmission,
  MissionAdmissionReason,
  MissionControl,
  MissionPlanningOffer,
  MissionPreview,
  MissionProjection,
  MissionRequest,
  MissionResponse,
  MissionRevisionChange,
  MissionRevisionPreview,
  MissionScope,
  MissionSummary,
  MissionTeamBinding,
  MissionTeamLibrary,
  MissionWorkroomPreview,
} from "../../../integrated-backend/src/mission-contracts.mts";
import type { MissionTeam, MissionTeamSave } from "../../../integrated-backend/src/mission-teams.mts";

const stateLabel: Record<MissionProjection["outcome"], string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  cancelling: "Stopping",
  cancelled: "Cancelled",
  blocked: "Blocked",
  failed: "Failed",
  uncertain: "Outcome uncertain",
  verified: "Verified",
};
const waitLabel: Record<MissionProjection["waits"][string], string> = {
  dependencies: "Waiting for verified prerequisites",
  capacity: "Waiting for a worker",
  "resource-conflict": "Waiting for a resource claim",
  "resource-pressure": "Waiting for host capacity",
};
const eventLabel = {
  created: "Mission created",
  revised: "Plan revised",
  control: "Control recorded",
  started: "Attempt started",
  settled: "Attempt settled",
  recovered: "Recovered from journal",
  workroom: "Workroom created",
} as const;
export { eventLabel as missionEventLabel, stateLabel as missionStateLabel };

const admissionReasonLabel: Record<MissionAdmissionReason, string> = {
  "physical-memory": "Low available memory",
  "os-memory-pressure": "Windows reports low memory",
  "windows-commit-pressure": "Low Windows commit headroom",
  "storage-reserve": "Storage reserve",
  "cpu-load": "High CPU load",
  "gpu-load": "High GPU load",
  "gpu-load-unavailable": "Waiting for a GPU load reading after contention",
  "gpu-thermal-throttling": "GPU driver reports thermal slowdown",
  "disk-io": "High disk I/O load",
  "active-input": "Recent Aerynth activity",
  "external-desktop-activity": "Recent desktop activity during contention",
  "renderer-latency": "Slow renderer frames",
  "battery-power": "Battery power",
  suspended: "System suspended",
  "cpu-speed-limit": "OS CPU speed limit",
};
const admissionNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const missionAdmissionRefreshMs = 2000;

export function missionAdmissionDetails(
  doc: Document,
  admission: MissionAdmission,
  phase: "current" | "attempt",
  focusKey?: string,
) {
  const disclosure = doc.createElement("details"), summary = doc.createElement("summary");
  disclosure.dataset.missionAdmission = phase;
  if (focusKey) {
    disclosure.dataset.missionDisclosure = focusKey;
    summary.dataset.missionFocus = focusKey;
  }
  const effective = admission.effectiveLimits;
  const headline = effective
    ? [phase === "current" ? "Resource admission" : "Resource admission at start", `CPU ${effective.cpu}`, `Remote ${effective.remote}`]
    : [phase === "current" ? "Scheduler limit" : "Scheduler limit at admission",
      `${admission.workerLimit} ${admission.workerLimit === 1 ? "worker" : "workers"}`];
  summary.textContent = [
    ...headline,
    ...admission.reasons.map(reason => admissionReasonLabel[reason]),
  ].join(" · ");
  const description = doc.createElement("small");
  description.textContent = effective
    ? `Build limit ${effective.build} · Host I/O limit ${effective.host_io} · GPU limit ${effective.gpu}`
    : "The limit applies to new starts across missions.";
  disclosure.append(summary, description);
  const readings = [
    ["cpuPercent", "CPU usage", "%"],
    ["availableMemoryBytes", "Available physical memory", " MiB"],
    ["windowsCommitHeadroomBytes", "Windows commit headroom", " MiB"],
    ["gpuEnginePercent", "Busiest GPU engine", "%"],
    ["diskQueueLength", "Disk queue length", ""],
    ["rendererFrameP95Ms", "Renderer frame interval p95", " ms"],
  ] as const;
  for (const [key, label, unit] of readings) {
    const row = doc.createElement("small"), reading = admission.readings[key];
    row.dataset.admissionMetric = key;
    if (reading) {
      const value = unit === " MiB" ? reading.value / (1024 * 1024) : reading.value;
      const time = doc.createElement("time");
      time.dateTime = reading.observedAt;
      time.textContent = reading.observedAt;
      row.textContent = `${label} · ${admissionNumber.format(value)}${unit} · Observed `;
      row.append(time);
    } else row.textContent = `${label} · Unavailable`;
    disclosure.append(row);
  }
  return disclosure;
}

const contextDetail: Record<string, string> = {
  mission_source_changed_since_verification: "A source changed after verification. The previous result needs a new review.",
  mission_context_changed_during_execution: "The sources changed during execution. Review the current sources before trying again.",
};
const priorities = ["Lowest", "Lower", "Normal", "Higher", "Highest"];
const sameScope = (left: MissionScope | null, right: MissionScope | null) =>
  left?.workspaceId === right?.workspaceId &&
  left?.projectId === right?.projectId;
type RevisionTask = MissionProjection["tasks"][number];
const revisionLabels: Record<MissionRevisionChange["type"], string> = {
  replace: "Replace task",
  dependencies: "Change prerequisites",
  retire: "Retire duplicate task",
  reassign: "Reassign specialist",
};
const nativeRevisionTask = (task: RevisionTask) => !task.projectCheck && !task.specialist && !task.teamMember &&
  (task.executor.startsWith("sample.") ||
    ["inspect.backend-source", "inspect.workspace-notes", "join.samples", "join.team"].includes(task.executor));
const unattempted = (task: RevisionTask) => task.state === "queued" && !task.attempts.length;
const canRevise = (mission: MissionProjection, scope: MissionScope | null) => sameScope(mission.scope, scope) &&
  mission.disposition === "paused" && !mission.tasks.some((task) => task.state === "running" || task.state === "cancelling") &&
  mission.events.filter((event) => event.kind === "revised").length < MISSION_LIMITS.revisions;

export function missionTaskControls(
  mission: MissionProjection,
  task: MissionProjection["tasks"][number],
) {
  const active =
    mission.disposition !== "cancelled" && mission.outcome !== "verified";
  return {
    retry:
      active &&
      task.executor !== "chatgpt.specialist" &&
      task.executor !== "api.specialist" &&
      (task.state === "failed" || task.state === "blocked") &&
      task.attempts.length < task.maxAttempts,
    priority: active && task.state === "queued",
    cancel:
      active &&
      (task.state === "queued" ||
        task.state === "running" ||
        task.state === "blocked"),
  };
}

/** Renderer-only view. All execution and state transitions go through the canonical mission command. */
export function createVelaMissionView(
  doc: Document,
  command: (request: MissionRequest) => Promise<MissionResponse>,
  openWorkspace?: (id: string) => Promise<void>,
) {
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const element = el("div", "vela-missions"),
    body = el("div", "vela-missions-body");
  body.tabIndex = -1;
  const status = el("p", "vela-core-meta"),
    error = el("p", "vela-core-error");
  status.setAttribute("role", "status");
  error.setAttribute("role", "alert");
  error.hidden = true;
  element.append(status, error, body);
  let scope: MissionScope | null = null,
    visible = false,
    epoch = 0,
    readEpoch = 0,
    refreshing = false,
    refreshQueued = false;
  let summaries: MissionSummary[] = [],
    mission: MissionProjection | null = null,
    selectedId: string | null = null;
  let admissionRefresh: ReturnType<typeof setTimeout> | undefined;
  let review: {
    preview: MissionPreview | MissionPlanningOffer;
    requestId: string;
    agentProfileId?: string;
    onStarted: (missionId: string) => void;
  } | null = null;
  let workroomReview: MissionWorkroomPreview | null = null;
  let revisionReview: { preview: MissionRevisionPreview; change: MissionRevisionChange; reason?: string } | null = null;
  let executiveAdvisory: string | null = null;
  const revisionDrafts = new Map<string, MissionRevisionChange>();
  let revisionProfilesRequested = false;
  let commandPending = false;
  const staged = new Map<string, string>();
  let teamLibrary: MissionTeamLibrary | null = null;
  let teamLibraryPending: number | null = null;
  let teamLibraryOpen = false;
  let teamDraft: MissionTeamSave | null = null;
  let teamObjective = "";
  let postedReport: string | null = null;
  let shownAnswer: string | null = null;
  const bytes = new TextEncoder();
  const fits = (value: string, max: number) => !!value.trim() && bytes.encode(value).length <= max;

  function showError(cause: unknown) {
    const code = cause instanceof Error ? cause.message : "";
    const descriptions: Record<string, string> = {
      mission_revision_changed:
        "The mission changed. Review the current state and try again.",
      mission_revision_denied:
        "This revision is no longer available. Check the paused plan and choose another change.",
      mission_revision_preview_changed:
        "The plan revision changed. Request a new preview before applying.",
      mission_revision_task_denied:
        "This task no longer qualifies for the selected change. Review the paused mission.",
      mission_revision_dependency_denied:
        "This prerequisite change would affect a task that has already started or a required dependency.",
      mission_revision_reassignment_unavailable:
        "This specialist profile is unavailable or incompatible with the task’s reviewed capability.",
      mission_native_revision_review_required:
        "Review the plan revision in the native approval window before applying.",
      mission_scope_denied: "Missions are unavailable in this workspace.",
      mission_preview_changed:
        "The reviewed plan changed. Submit the objective again to review it.",
      mission_retry_denied: "This task cannot be retried.",
      mission_user_gesture_required:
        "Use the mission control in the active app window.",
      mission_specialist_unavailable:
        "A specialist is unavailable. Check Connections and submit the objective again.",
      mission_native_review_or_connection_required:
        "The specialist connection or reviewed scope changed. Submit the objective again.",
      mission_review_declined:
        "The review was cancelled. Your draft is still here.",
      mission_executive_review_changed:
        "The mission checkpoint changed. Review the latest task results.",
      mission_executive_already_attempted:
        "Vela already attempted a review for this checkpoint.",
      mission_executive_unavailable:
        "Vela could not review this checkpoint. Check the dedicated API connection and the mission’s current state.",
      mission_project_check_unavailable:
        "The installed Codex read-only sandbox is unavailable.",
      mission_planner_unavailable:
        "A planning model is unavailable. Check the selected provider connection, API usage authorization and request limits.",
      mission_proposal_unsupported_objective:
        "The planner reported that available capabilities cannot cover the whole objective. No mission was started.",
      invalid_mission_temporary_role:
        "The planner returned an invalid specialist assignment. Review the objective and request a new plan.",
      mission_planning_already_attempted:
        "This planning request was already admitted. Submit the objective again for a fresh review.",
      mission_planning_context_changed:
        "A reviewed note changed. Request a new plan before starting the mission.",
      mission_planning_context_unavailable:
        "Vela could not assess the selected notes. No mission was started.",
      mission_team_not_found: "This team is no longer available. Refresh the team library.",
      mission_team_scope_denied: "Team templates are unavailable in this workspace.",
      mission_team_version_conflict: "This team changed. Reload its saved version before continuing.",
      mission_team_profile_unavailable: "A team profile is no longer available in this workspace. Refresh the library and choose an available profile.",
      mission_team_title_conflict: "A saved team already uses that name. Choose another name.",
      invalid_mission_team: "Enter a team name and two to four distinct profiles with responsibilities within the limits shown.",
      mission_team_capacity: "The team library has reached its capacity.",
      mission_team_library_unavailable: "The team library could not be loaded. Refresh to try again.",
      invalid_mission_team_objective: "Enter a mission objective within the limit shown.",
      mission_report_unavailable: "The mission report link could not be posted. Check the Vela chat before trying again.",
    };
    error.textContent =
      descriptions[code] ??
      "The mission command could not be confirmed. Check its recorded state.";
    error.hidden = false;
  }
  function button(label: string, key: string, action: () => void) {
    const node = el("button", "vela-core-button", label);
    node.type = "button";
    node.dataset.missionFocus = key;
    node.addEventListener("click", action);
    return node;
  }
  function details(label: string, key: string) {
    const node = el("details"),
      summary = el("summary", undefined, label);
    node.dataset.missionDisclosure = key;
    summary.dataset.missionFocus = key;
    node.append(summary);
    return node;
  }
  function actions() {
    return el("div", "vela-missions-actions");
  }
  function field(label: string, key: string, control: HTMLElement) {
    const node = el("label", "vela-core-field");
    control.dataset.missionFocus = key;
    node.append(el("span", undefined, label), control);
    return node;
  }
  function option(value: string, title: string) {
    const node = el("option", undefined, title);
    node.value = value;
    return node;
  }
  function select(
    label: string,
    key: string,
    items: readonly (readonly [number, string])[],
    value: number,
  ) {
    const control = el("select", "vela-core-input");
    for (const [id, title] of items) control.append(option(String(id), title));
    control.value = staged.get(key) ?? String(value);
    control.addEventListener("change", () => {
      staged.set(key, control.value);
    });
    return { field: field(label, key, control), control };
  }

  async function loadTeams(forRevision = false) {
    if (!visible || !scope || (!teamLibraryOpen && !forRevision) || doc.hidden || commandPending || teamLibraryPending === epoch) return;
    const generation = epoch;
    teamLibraryPending = generation;
    render();
    try {
      const result = await command({ name: "team-library", input: {} });
      if (generation !== epoch) return;
      if (!result || !("kind" in result) || result.kind !== "team-library")
        throw new Error("mission_team_library_unavailable");
      teamLibrary = result;
      if (review && "plan" in review.preview && review.preview.plan.team) {
        const { id, version } = review.preview.plan.team;
        if (!result.teams.some((team) => team.id === id && team.version === version)) review = null;
      }
    } catch (cause) {
      if (generation === epoch) showError(cause);
    } finally {
      if (teamLibraryPending === generation) teamLibraryPending = null;
      if (generation === epoch) render();
    }
  }
  function clearTeamReview() {
    if (!review || !("plan" in review.preview) || !review.preview.plan.team) return false;
    review = null;
    return true;
  }
  function emptyRole() {
    return { profileId: "", responsibility: "" };
  }
  function editTeam(saved?: MissionTeam) {
    if (commandPending) return;
    clearTeamReview();
    teamObjective = "";
    teamDraft = saved ? {
      id: saved.id,
      expectedVersion: saved.version,
      title: saved.title,
      members: saved.members.map((member) => ({ ...member })),
    } : { title: "", members: [emptyRole(), emptyRole()] };
    error.hidden = true;
    render();
  }
  async function scopedCommand<T>(request: MissionRequest, apply: (value: MissionResponse) => T) {
    if (commandPending || !visible || !scope) return;
    const generation = epoch;
    const focused = (doc.activeElement as HTMLElement | null)?.dataset.missionFocus;
    let refreshLibrary = false;
    commandPending = true;
    error.hidden = true;
    body.setAttribute("aria-busy", "true");
    clearTeamReview();
    render();
    try {
      const value = await command(request);
      if (generation !== epoch) return;
      return apply(value);
    } catch (cause) {
      if (generation === epoch) {
        showError(cause);
        refreshLibrary = cause instanceof Error && ["mission_team_version_conflict", "mission_team_not_found", "mission_team_profile_unavailable", "mission_preview_changed"].includes(cause.message);
      }
    } finally {
      commandPending = false;
      body.removeAttribute("aria-busy");
      if (visible) render(generation === epoch ? focused : undefined);
      if (refreshLibrary || !teamLibrary) void loadTeams();
    }
  }
  async function saveTeam(draft: MissionTeamSave) {
    await scopedCommand({ name: "team-save", input: draft }, (value) => {
      if (!value || !("members" in value) || !teamLibrary) throw new Error("invalid_mission_team");
      teamLibrary.teams = [...teamLibrary.teams.filter((team) => team.id !== value.id), value];
      teamDraft = {
        id: value.id, expectedVersion: value.version, title: value.title,
        members: value.members.map((member) => ({ ...member })),
      };
    });
  }
  async function archiveTeam(saved: MissionTeam) {
    await scopedCommand({ name: "team-archive", input: { id: saved.id, expectedVersion: saved.version } }, (value) => {
      if (!value || !("members" in value) || !teamLibrary || value.id !== saved.id)
        throw new Error("mission_team_not_found");
      teamLibrary.teams = teamLibrary.teams.filter((team) => team.id !== value.id);
      teamDraft = null;
      teamObjective = "";
    });
  }
  async function previewTeam(saved: MissionTeam) {
    const result = await scopedCommand({ name: "preview", input: { objective: teamObjective.trim(), teamId: saved.id } }, (value) => {
      if (!value || !("plan" in value) || !sameScope(value.plan.scope, scope) ||
        value.plan.team?.id !== saved.id || value.plan.team.version !== saved.version)
        throw new Error("mission_preview_changed");
      review = { preview: value, requestId: crypto.randomUUID(), onStarted: () => { teamObjective = ""; } };
      return review;
    });
    if (result && result === review)
      body.querySelector<HTMLElement>('[data-mission-focus="team-review-heading"]')?.focus();
  }

  function renderTeams() {
    const disclosure = details("Team library", "team-library");
    disclosure.open = teamLibraryOpen;
    disclosure.addEventListener("toggle", () => {
      if (!disclosure.isConnected || teamLibraryOpen === disclosure.open) return;
      teamLibraryOpen = disclosure.open;
      if (teamLibraryOpen) void loadTeams();
    });
    const section = el("section", "vela-core-plan");
    disclosure.append(section);
    if (!teamLibrary) {
      const loading = teamLibraryPending === epoch;
      section.append(loading
        ? el("p", "vela-core-meta", "Loading team library…")
        : button("Refresh team library", "refresh-teams", () => { void loadTeams(); }));
      return disclosure;
    }

    const draft = teamDraft;
    const { teams, profiles } = teamLibrary;
    const saved = teams.find((team) => team.id === draft?.id);
    const stale = !!draft?.id && saved?.version !== draft.expectedVersion;
    const busy = commandPending || teamLibraryPending === epoch;
    const controls = actions();
    const picker = el("select", "vela-core-input");
    picker.append(option("", "Choose a team"));
    for (const team of teams) picker.append(option(team.id, `${team.title} · v${team.version}`));
    picker.value = saved?.id ?? "";
    picker.disabled = busy || !teams.length;
    picker.addEventListener("change", () => {
      const team = teams.find((item) => item.id === picker.value);
      if (team) editTeam(team);
      else { clearTeamReview(); teamDraft = null; teamObjective = ""; render(); }
    });
    const create = button("New team", "new-team", () => {
      editTeam();
      body.querySelector<HTMLInputElement>('[data-mission-focus="team-title"]')?.focus();
    });
    create.disabled = busy || profiles.length < 2;
    const refreshTeams = button("Refresh team library", "refresh-teams", () => { error.hidden = true; void loadTeams(); });
    refreshTeams.disabled = busy;
    controls.append(create, refreshTeams);
    section.append(
      el("p", "vela-core-meta", "Reuse two to four agent profiles with defined responsibilities. A team runs only when you review and start a mission."),
      field("Saved team", "team-select", picker),
      controls,
    );
    if (profiles.length < 2)
      section.append(el("p", "vela-core-meta", "Add at least two available agent profiles before creating a team."));
    if (!draft) return disclosure;
    if (stale) {
      section.append(el("p", "vela-core-meta", "The saved team changed. Reload its current version to edit or reuse it."));
      const reload = button(saved ? "Reload saved version" : "Close team draft", "reload-team-draft", () => {
        if (saved) editTeam(saved);
        else { clearTeamReview(); teamDraft = null; teamObjective = ""; render(); }
      });
      reload.disabled = busy;
      section.append(reload);
      return disclosure;
    }

    const title = el("input", "vela-core-input");
    title.type = "text";
    title.value = draft.title;
    title.maxLength = 120;
    title.disabled = busy;
    section.append(field("Team name (up to 120 bytes)", "team-title", title));
    const roles = el("ol", "vela-missions-steps");
    for (const [index, member] of draft.members.entries()) {
      const number = index + 1;
      const row = el("li");
      const profile = el("select", "vela-core-input");
      const responsibility = el("input", "vela-core-input");
      profile.append(option("", "Choose a profile"));
      for (const entry of profiles) profile.append(option(entry.id, entry.title));
      if (member.profileId && !profiles.some((entry) => entry.id === member.profileId))
        profile.append(option(member.profileId, "Unavailable profile"));
      profile.value = member.profileId;
      profile.disabled = busy;
      responsibility.type = "text";
      responsibility.value = member.responsibility;
      responsibility.maxLength = 512;
      responsibility.disabled = busy;
      profile.addEventListener("change", () => { member.profileId = profile.value; update(); });
      responsibility.addEventListener("input", () => { member.responsibility = responsibility.value; update(); });
      row.append(field(`Role ${number} profile`, `team-profile-${number}`, profile),
        field(`Role ${number} responsibility (up to 512 bytes)`, `team-responsibility-${number}`, responsibility));
      if (draft.members.length > 2) {
        const remove = button(`Remove role ${number}`, `remove-team-role-${number}`, () => {
          draft.members.splice(index, 1);
          clearTeamReview();
          render("add-team-role");
        });
        remove.disabled = busy;
        row.append(remove);
      }
      roles.append(row);
    }
    section.append(roles);

    const editorControls = actions();
    const add = button("Add role", "add-team-role", () => {
      draft.members.push(emptyRole());
      clearTeamReview();
      render();
      body.querySelector<HTMLSelectElement>(`[data-mission-focus="team-profile-${draft.members.length}"]`)?.focus();
    });
    add.disabled = busy || draft.members.length >= Math.min(4, profiles.length);
    const save = button("Save team", "save-team", () => { void saveTeam(draft); });
    save.classList.add("vela-core-primary");
    editorControls.append(add, save);
    if (saved) {
      const archive = button("Archive team", "archive-team", () => { void archiveTeam(saved); });
      archive.disabled = busy;
      editorControls.append(archive);
    }
    section.append(editorControls);

    const objective = el("textarea", "vela-core-input");
    objective.value = teamObjective;
    objective.maxLength = 2048;
    objective.rows = 2;
    objective.disabled = busy;
    const preview = button("Preview team mission", "preview-team-mission", () => {
      if (saved) void previewTeam(saved);
    });
    preview.classList.add("vela-core-primary");
    const guidance = el("p", "vela-core-meta");
    if (saved) section.append(field("Mission objective (up to 2048 bytes)", "team-objective", objective), preview);
    section.append(guidance);
    const syncControls = () => {
      const members = draft.members;
      const validTitle = fits(draft.title, 120);
      const validRoles = members.every((member) => profiles.some((profile) => profile.id === member.profileId)) &&
        new Set(members.map((member) => member.profileId)).size === members.length;
      const validResponsibilities = members.every((member) => fits(member.responsibility, 512));
      const dirty = !saved || saved.title !== draft.title.trim() || saved.members.length !== members.length ||
        saved.members.some((member, index) => member.profileId !== members[index].profileId ||
          member.responsibility !== members[index].responsibility.trim());
      save.disabled = busy || !validTitle || !validRoles || !validResponsibilities || !dirty;
      preview.disabled = busy || dirty || !fits(teamObjective.trim(), 2048);
      guidance.textContent = !validTitle ? "Enter a team name within the limit shown." :
        !validRoles ? "Choose a different available profile for each role." :
        !validResponsibilities ? "Enter a responsibility within the limit shown for every role." :
        dirty ? "Save the team to preview a mission with these roles." :
        teamObjective && !fits(teamObjective.trim(), 2048) ? "Enter a mission objective within the limit shown." : "";
      guidance.hidden = !guidance.textContent;
    };
    function update() {
      if (clearTeamReview()) render();
      else syncControls();
    }
    title.addEventListener("input", () => { draft.title = title.value; update(); });
    objective.addEventListener("input", () => { teamObjective = objective.value; update(); });
    syncControls();
    return disclosure;
  }
  function accepted(
    value: MissionResponse,
    expected: MissionScope | null,
  ): value is MissionProjection {
    return !!value && "contract" in value && value.contract === MISSION_CONTRACT && (sameScope(value.scope, expected) ||
      value.workroom?.workspaceId === expected?.workspaceId && value.scope.projectId === expected?.projectId);
  }
  function clearRevision() {
    revisionDrafts.clear();
    revisionReview = null;
    executiveAdvisory = null;
    revisionProfilesRequested = false;
  }
  function requestRevisionProfiles() {
    if (revisionProfilesRequested || teamLibrary || commandPending) return;
    revisionProfilesRequested = true;
    void loadTeams(true);
  }
  function setMission(next: MissionProjection | null) {
    if (!next || mission?.id !== next.id || mission.revision !== next.revision || !canRevise(next, scope) ||
      ((revisionReview || executiveAdvisory) && JSON.stringify(mission.tasks) !== JSON.stringify(next.tasks))) clearRevision();
    mission = next;
    syncAdmissionRefresh();
  }
  function syncAdmissionRefresh() {
    const shouldRefresh = visible && !doc.hidden && !review && mission &&
      (mission.outcome === "queued" || mission.outcome === "running");
    if (!shouldRefresh) {
      clearTimeout(admissionRefresh);
      admissionRefresh = undefined;
    } else if (!refreshing && admissionRefresh === undefined) {
      admissionRefresh = setTimeout(() => {
        admissionRefresh = undefined;
        refresh();
      }, missionAdmissionRefreshMs);
    }
  }
  function refresh() {
    if (!visible || !scope || doc.hidden) { syncAdmissionRefresh(); return; }
    refreshQueued = true;
    if (refreshing) return;
    refreshing = true;
    void (async () => {
      while (refreshQueued && visible && scope && !doc.hidden) {
        refreshQueued = false;
        const activeEpoch = epoch,
          activeReadEpoch = readEpoch,
          id = selectedId,
          expected = scope;
        try {
          const [list, record] = await Promise.all([
            command({ name: "list", input: {} }),
            id ? command({ name: "read", input: { id } }) : null,
          ]);
          if (activeEpoch !== epoch || activeReadEpoch !== readEpoch || !visible || id !== selectedId) continue;
          if (!Array.isArray(list)) throw new Error("mission_list_unavailable");
          let changed = JSON.stringify(summaries) !== JSON.stringify(list);
          summaries = list;
          if (id && !list.some((item) => item.id === id)) {
            selectedId = null;
            setMission(null);
            changed = true;
          } else if (
            accepted(record, expected) &&
            (!mission || record.revision > mission.revision ||
              (record.revision === mission.revision && JSON.stringify(record) !== JSON.stringify(mission)))
          ) {
            setMission(record);
            changed = true;
          }
          if (changed) render();
        } catch (cause) {
          if (activeEpoch === epoch && activeReadEpoch === readEpoch && visible && id === selectedId) {
            summaries = [];
            setMission(null);
            selectedId = null;
            render();
            showError(cause);
          }
        }
      }
    })().finally(() => {
      refreshing = false;
      syncAdmissionRefresh();
    });
  }
  function choose(id: string) {
    if (selectedId === id) return;
    review = null;
    workroomReview = null;
    selectedId = id;
    setMission(null);
    staged.clear();
    error.hidden = true;
    render();
    refresh();
  }
  async function planWorkroom(id: string) {
    if (commandPending || !visible || id !== selectedId) return;
    const generation = epoch;
    commandPending = true;
    try {
      const value = await command({ name: "workroom-preview", input: { id } });
      if (epoch !== generation || id !== selectedId) return;
      if (!value || !("kind" in value) || value.kind !== "workroom-preview") throw Error("mission_workroom_unavailable");
      workroomReview = value;
      error.hidden = true;
    } catch (cause) { if (epoch === generation) showError(cause); }
    finally { commandPending = false; if (visible) render(); }
  }
  async function applyWorkroom(review: MissionWorkroomPreview) {
    if (commandPending || !visible || review.missionId !== selectedId) return;
    const generation = epoch;
    commandPending = true;
    try {
      const value = await command({ name: "workroom-apply", input: { id: review.missionId, reviewId: review.reviewId } });
      if (epoch !== generation || review.missionId !== selectedId) return;
      if (!value || !("kind" in value) || value.kind !== "workroom") throw Error("mission_workroom_unavailable");
      workroomReview = null;
      error.hidden = true;
      await openWorkspace?.(value.workspaceId);
    } catch (cause) { if (epoch === generation) showError(cause); }
    finally { commandPending = false; if (visible) { render(); refresh(); } }
  }
  async function mutate(
    request: Extract<MissionRequest, { name: "start" | "control" }>,
  ) {
    if (!visible || !scope || commandPending) return;
    const activeEpoch = epoch,
      expected = scope,
      selection = selectedId,
      pendingReview = review;
    let refreshLibrary = false;
    commandPending = true;
    body.setAttribute("aria-busy", "true");
    error.hidden = true;
    try {
      // Invoke during the trusted click. The preload checks transient user activation.
      const response = await command(request);
      if (activeEpoch !== epoch || !visible) return;
      if (!accepted(response, expected))
        throw new Error("mission_scope_denied");
      if (request.name === "start") {
        pendingReview?.onStarted(response.id);
        if (review !== pendingReview) return;
        review = null;
        selectedId = response.id;
        setMission(response);
        staged.clear();
      } else if (selectedId === selection) {
        const control = request.input.control;
        if (control.type === "concurrency") staged.delete("concurrency");
        if (control.type === "priority")
          staged.delete(`${control.taskId}-priority-value`);
        if (!mission || response.revision >= mission.revision)
          setMission(response);
      }
    } catch (cause) {
      if (activeEpoch === epoch && visible) {
        showError(cause);
        if (request.name === "start" && request.input.teamId && review === pendingReview &&
          cause instanceof Error && ["mission_preview_changed", "mission_team_not_found", "mission_team_profile_unavailable"].includes(cause.message)) {
          clearTeamReview();
          refreshLibrary = true;
        }
      }
    } finally {
      commandPending = false;
      body.removeAttribute("aria-busy");
      if (visible) {
        render();
        refresh();
        if (refreshLibrary || !teamLibrary) void loadTeams();
      }
    }
  }
  function control(
    label: string,
    key: string,
    current: MissionProjection,
    value: () => MissionControl,
  ) {
    return button(label, key, () => {
      void mutate({
        name: "control",
        input: { id: current.id, revision: current.revision, control: value() },
      });
    });
  }
  function renderPreview() {
    if (!review) return null;
    const { preview, requestId, agentProfileId } = review;
    if ("kind" in preview) return renderPlanningOffer(preview);
    const { plan, executors, externalReview, localReview } = preview;
    const section = el("section", "vela-core-plan vela-mission-preview");
    const heading = el("h3", undefined, "Review mission");
    if (plan.team) {
      heading.tabIndex = -1;
      heading.dataset.missionFocus = "team-review-heading";
    }
    section.append(heading, el("p", undefined, plan.objective));
    if(plan.coverage)section.append(el("p","vela-core-meta","Partial investigation: "+plan.coverage.limitations.join(' ')+' The original objective will remain blocked until the missing evidence is available.'));
    if (plan.team) section.append(teamLabel(plan.team));
    if (localReview) section.append(el("p", "vela-core-meta",
      "Start opens a native picker for up to four tracked Node tests. You will review the exact checkout and command before it runs."));
    if (plan.planning) section.append(el("p", "vela-core-meta",
      `Proposed by ${plan.planning.model}. Review the tasks and dependencies before starting.`));
    section.append(
      externalReview
        ? el(
            "p",
            "vela-core-meta",
            `${plan.tasks.length} steps · ${externalReview.calls} separate requests to ${externalReview.provider}${plan.team ? "" : ` · ${externalReview.model}${externalReview.effort ? " · " + externalReview.effort : ""}`} · native review required`,
          )
        : plan.team ? el("p", "vela-core-meta", "Specialist availability is checked before starting.") : el(
            "p",
            "vela-core-meta",
            "Local read-only tasks · " + plan.tasks.length + " steps",
          ),
    );
    const tasks = el("ol", "vela-missions-steps");
    for (const task of plan.tasks) {
      const entry = el("li"),
        available =
          executors.find((item) => item.id === task.id)?.available === true;
      entry.append(
        el("strong", undefined, task.objective),
        el(
          "p",
          "vela-core-meta",
          `${task.executor} · ${available ? "Available" : "Unavailable"}`,
        ),
        el(
          "p",
          "vela-core-meta",
          `Criterion ${task.criterion} · ${task.timeoutMs / 1000}s per attempt · up to ${task.maxAttempts} attempts`,
        ),
      );
      if (task.teamMember) entry.append(el("p", "vela-core-meta", task.teamMember.title));
      if (task.specialist)
        entry.append(
          el(
            "p",
            "vela-core-meta",
            (task.teamMember ? [task.specialist.model, task.specialist.effort].filter(Boolean).join(" · ") : task.specialist.role) +
              (task.specialist.profile
                ? ` · profile v${task.specialist.profile.profileVersion}`
                : ""),
          ),
        );
      if (task.dependencies.length)
        entry.append(
          el(
            "p",
            "vela-core-meta",
            "After " +
              task.dependencies
                .map(
                  (id) =>
                    plan.tasks.find((item) => item.id === id)?.objective ?? id,
                )
                .join(", "),
          ),
        );
      if (task.claims.length)
        entry.append(
          el(
            "p",
            "vela-core-meta",
            task.claims
              .map((claim) => `${claim.mode} ${claim.resource}`)
              .join(" · "),
          ),
        );
      tasks.append(entry);
    }
    const controls = actions();
    const start = button("Start mission", "start-mission", () => {
      void mutate({
        name: "start",
        input: {
          objective: plan.objective,
          fingerprint: preview.fingerprint,
          requestId,
          ...(agentProfileId ? { agentProfileId } : {}),
          ...(preview.proposalId ? { proposalId: preview.proposalId } : {}),
          ...(plan.team ? { teamId: plan.team.id } : {}),
        },
      });
    });
    start.classList.add("vela-core-primary");
    start.disabled = commandPending || (!!plan.team && teamLibraryPending === epoch);
    controls.append(
      start,
      button("Dismiss preview", "dismiss-preview", () => {
        if (!commandPending) {
          review = null;
          render(plan.team ? "preview-team-mission" : undefined);
        }
      }),
    );
    if (
      plan.tasks.some(
        (task) =>
          executors.find((item) => item.id === task.id)?.available !== true,
      )
    ) {
      start.disabled ||= !!externalReview || !!plan.team;
      section.append(
        el(
          "p",
          "vela-core-meta",
          externalReview || plan.team
            ? "All specialist mission executors must be available before starting."
            : "Unavailable executors can block their tasks and dependent steps.",
        ),
      );
    }
    section.append(tasks, controls);
    return section;
  }
  function renderPlanningOffer(offer: MissionPlanningOffer) {
    const section = el("section", "vela-core-plan vela-mission-preview");
    section.append(el("h3", undefined, "Plan a mission"), el("p", undefined, offer.objective),
      el("p", "vela-core-meta", offer.planner
        ? `${offer.notes ? 'Investigate the selected notes and request a plan' : 'Request a plan'} using ${offer.planner.model}${offer.planner.provider==='openai-api-vela'?' through Vela’s dedicated API':''}. You’ll review the resulting tasks separately.`
        : "A planning model is unavailable for this workspace. Check Connections and request limits."));
    const controls = actions();
    const plan = button("Review planning request", "plan-mission", () => { void preparePlan(offer); });
    plan.classList.add("vela-core-primary");
    plan.disabled = commandPending || !offer.planner;
    controls.append(plan, button("Dismiss preview", "dismiss-preview", () => {
      if (!commandPending) { review = null; render(); }
    }));
    section.append(controls);
    return section;
  }
  async function preparePlan(offer: MissionPlanningOffer) {
    const pending = review;
    if (commandPending || !visible || pending?.preview !== offer || !offer.planner) return;
    const generation = epoch;
    commandPending = true;
    error.hidden = true;
    body.setAttribute("aria-busy", "true");
    try {
      const result = await command({ name: "plan",
        input: { objective: offer.objective, fingerprint: offer.fingerprint, requestId: pending.requestId,
          ...(offer.notes ? { noteIds: offer.notes.map(note => note.id) } : {}) } });
      if (generation !== epoch || review !== pending) return;
      if (!result || !("plan" in result) || !sameScope(result.plan.scope, scope) || result.proposalId !== pending.requestId)
        throw new Error("mission_preview_changed");
      review = { ...pending, preview: result };
    } catch (cause) {
      if (generation === epoch) showError(cause);
    } finally {
      commandPending = false;
      body.removeAttribute("aria-busy");
      if (visible) render();
    }
  }
  function teamLabel(team: MissionTeamBinding) {
    const label = el("p", "vela-core-meta", `Team ${team.title} · v${team.version}`);
    label.dataset.missionTeam = team.id;
    label.dataset.teamVersion = String(team.version);
    return label;
  }
  function renderTeamEvidence(task: MissionProjection["tasks"][number], evidence: NonNullable<MissionProjection["tasks"][number]["attempts"][number]["evidence"]>) {
    const value = evidence.value;
    if (!value || typeof value !== "object") return null;
    if (task.teamMember && evidence.source === "chatgpt-plan-responses:reported" &&
      "observations" in value && Array.isArray(value.observations)) {
      const findings = value.observations.filter((item): item is string => typeof item === "string");
      if (!findings.length) return null;
      const list = el("ul", "vela-missions-steps");
      list.dataset.teamFindings = task.teamMember.profileId;
      list.setAttribute("aria-label", `Reported findings from ${task.teamMember.title}`);
      for (const finding of findings) list.append(el("li", undefined, finding));
      const block = el("div");
      block.append(el("strong", undefined, "Reported findings"), list);
      return block;
    }
    if (task.executor === "join.team" && "reports" in value && Array.isArray(value.reports) &&
      "distinctFindingCount" in value && typeof value.distinctFindingCount === "number" &&
      "repeatedFindings" in value && Array.isArray(value.repeatedFindings)) {
      const block = el("div");
      block.append(el("p", "vela-core-meta", `${value.reports.length} attributed role reports · ${value.distinctFindingCount} distinct findings · ${value.repeatedFindings.length} groups of repeated findings`));
      if ("conflictingAssessments" in value && Array.isArray(value.conflictingAssessments))
        block.append(el("p", "vela-core-meta", `${value.conflictingAssessments.length} claims with opposing reported assessments`));
      if ("assessment" in value && typeof value.assessment === "string") block.append(el("p", "vela-core-meta", value.assessment));
      return block;
    }
    return null;
  }
  function currentRevision(current: MissionProjection) {
    return selectedId === current.id && mission?.id === current.id && mission.revision === current.revision &&
      canRevise(mission, scope);
  }
  async function previewRevision(current: MissionProjection, change: MissionRevisionChange) {
    if (!currentRevision(current) || commandPending) return;
    const readGeneration = readEpoch;
    revisionReview = null;
    const result = await scopedCommand({ name: "revision-preview", input: { id: current.id, revision: current.revision, change } }, (value) => {
      if (readGeneration !== readEpoch || !currentRevision(current)) return;
      if (!value || !("kind" in value) || value.kind !== "revision-preview" ||
        value.missionId !== current.id || value.revision !== current.revision)
        throw Error("mission_revision_preview_changed");
      revisionReview = { preview: value, change };
      return revisionReview;
    });
    if (result && result === revisionReview)
      body.querySelector<HTMLElement>('[data-mission-focus="revision-review-heading"]')?.focus();
    refresh();
  }
  async function requestExecutiveReview(current: MissionProjection, triggerSeq: number) {
    if (!currentRevision(current) || commandPending) return;
    await scopedCommand({ name: "executive-review", input: { id: current.id, revision: current.revision, triggerSeq } }, value => {
      if (!currentRevision(current) || JSON.stringify(current.tasks) !== JSON.stringify(mission?.tasks)) return;
      if (!value || !("kind" in value) || value.kind !== "executive-result") throw Error("mission_executive_unavailable");
      const { result } = value;
      if (result.state === "advisory") {
        executiveAdvisory = result.reason;
      } else if (result.state === "reviewable" && result.preview.missionId === current.id && result.preview.revision === current.revision) {
        revisionReview = { preview: result.preview, change: result.change, reason: result.reason };
      } else if (result.state === "rejected") {
        executiveAdvisory = "Vela’s suggestion could not be applied to this checkpoint.";
      } else throw Error(result.state === "stale" ? "mission_executive_review_changed" : "mission_executive_unavailable");
    });
  }
  async function applyRevision(current: MissionProjection, reviewed: NonNullable<typeof revisionReview>) {
    if (!currentRevision(current) || revisionReview !== reviewed || commandPending) return;
    const readGeneration = readEpoch;
    const { preview, change } = reviewed;
    await scopedCommand({ name: "revision-apply", input: {
      id: current.id, revision: current.revision, change, fingerprint: preview.fingerprint,
    } }, (value) => {
      if (readGeneration !== readEpoch || selectedId !== current.id) return;
      if (!accepted(value, scope) || value.id !== current.id || value.revision <= current.revision)
        throw Error("mission_revision_changed");
      if (!mission || value.revision >= mission.revision) setMission(value);
    });
    refresh();
  }
  function renderRevisionReview(current: MissionProjection) {
    const reviewed = revisionReview;
    if (!reviewed || !currentRevision(current) || reviewed.preview.missionId !== current.id ||
      reviewed.preview.revision !== current.revision) return null;
    const section = el("section", "vela-core-plan");
    const heading = el("h4", undefined, "Review plan revision");
    heading.tabIndex = -1;
    heading.dataset.missionFocus = "revision-review-heading";
    section.append(heading, el("p", undefined, reviewed.preview.summary));
    if (reviewed.reason) section.append(el("p", "vela-core-meta", reviewed.reason));
    const external = reviewed.preview.externalReview;
    if (external) section.append(el("p", "vela-core-meta",
      `${external.provider} · ${external.model}${external.effort ? ` · ${external.effort}` : ""} · Native review required before reassignment`));
    const controls = actions();
    const apply = button("Apply plan revision", "revision-apply", () => { void applyRevision(current, reviewed); });
    apply.classList.add("vela-core-primary");
    apply.disabled = commandPending;
    const dismiss = button("Dismiss revision preview", "revision-dismiss", () => {
      revisionReview = null;
      render(`${reviewed.change.taskId}-revision-preview`);
    });
    dismiss.disabled = commandPending;
    controls.append(apply, dismiss);
    section.append(controls);
    return section;
  }
  function renderRevisionEditor(current: MissionProjection, task: RevisionTask) {
    if (!canRevise(current, scope)) return null;
    const dependents = new Set([task.id]);
    for (const id of dependents) {
      for (const candidate of current.tasks)
        if (candidate.dependencies.includes(id)) dependents.add(candidate.id);
    }
    const candidates = current.tasks.filter((candidate) => !dependents.has(candidate.id));
    const canRetire = nativeRevisionTask(task) && task.detail !== "mission_source_changed_since_verification" &&
      ["queued", "failed", "blocked", "cancelled"].includes(task.state) &&
      task.attempts.every((attempt) => attempt.finishedAt && attempt.outcome && attempt.outcome !== "uncertain") &&
      current.tasks.every((candidate) => !candidate.dependencies.includes(task.id) || unattempted(candidate));
    const successors = canRetire ? candidates.filter((other) => nativeRevisionTask(other) &&
      other.executor === task.executor && other.criterion === task.criterion && other.objective === task.objective &&
      JSON.stringify(other.claims) === JSON.stringify(task.claims) && task.dependencies.every((id) => other.dependencies.includes(id)) &&
      (unattempted(other) || other.state === "verified" && other.attempts.at(-1)?.verification?.passed)) : [];
    const kinds: MissionRevisionChange["type"][] = [];
    if (canRetire && task.attempts.length < task.maxAttempts) kinds.push("replace");
    if (nativeRevisionTask(task) && unattempted(task) && candidates.some((candidate) =>
      task.executor.startsWith("sample.") || !task.dependencies.includes(candidate.id))) kinds.push("dependencies");
    if (successors.length) kinds.push("retire");
    if ((task.executor === "chatgpt.specialist" || task.executor === "api.specialist") && !task.attempts.length && !task.dependencies.length &&
      (task.state === "queued" || task.state === "blocked")) kinds.push("reassign");
    if (!kinds.length) return null;
    const emptyChange = (type: MissionRevisionChange["type"]): MissionRevisionChange => {
      if (type === "dependencies") return { type, taskId: task.id, dependencies: [...task.dependencies] };
      if (type === "retire") return { type, taskId: task.id, successorId: successors[0]?.id ?? "" };
      if (type === "reassign") return { type, taskId: task.id, agentProfileId: "" };
      return { type, taskId: task.id };
    };
    const stagedChange = revisionDrafts.get(task.id);
    const change = stagedChange && kinds.includes(stagedChange.type) ? stagedChange : emptyChange(kinds[0]);
    const key = `${task.id}-revision`;
    const section = details("Revise task", key);
    const editor = el("div", "vela-core-plan");
    const action = el("select", "vela-core-input");
    for (const type of kinds) action.append(option(type, revisionLabels[type]));
    action.value = change.type;
    action.disabled = commandPending;
    const stage = (next: MissionRevisionChange) => {
      revisionDrafts.set(task.id, next);
      revisionReview = null;
      error.hidden = true;
      render();
    };
    action.addEventListener("change", () => {
      const type = kinds.find((item) => item === action.value);
      if (type) stage(emptyChange(type));
      if (type === "reassign") requestRevisionProfiles();
    });
    editor.append(field("Plan change", `${key}-action`, action));
    let ready = true;
    if (change.type === "replace") {
      editor.append(el("p", "vela-core-meta", "Review a fresh task for this objective. The previous task and its receipts stay in history."));
    } else if (change.type === "dependencies") {
      const selected = new Set(change.dependencies);
      const list = el("div", "vela-core-plan");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", "Verified prerequisites");
      for (const candidate of candidates) {
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(candidate.id);
        checkbox.disabled = commandPending || (task.dependencies.includes(candidate.id) && !task.executor.startsWith("sample."));
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(candidate.id);
          else selected.delete(candidate.id);
          stage({ ...change, dependencies: [...selected] });
        });
        list.append(field(candidate.objective, `${key}-dependency-${candidate.id}`, checkbox));
      }
      ready = candidates.length > 0 && (selected.size !== task.dependencies.length || task.dependencies.some((id) => !selected.has(id)));
      editor.append(el("p", "vela-core-meta", candidates.length ? "Choose the tasks that must verify before this task starts." : "No eligible prerequisites are available."), list);
    } else if (change.type === "retire") {
      const successor = el("select", "vela-core-input");
      for (const candidate of successors) successor.append(option(candidate.id, `${candidate.objective} · ${candidate.id}`));
      successor.value = change.successorId;
      successor.disabled = commandPending;
      successor.addEventListener("change", () => { stage({ ...change, successorId: successor.value }); });
      ready = successors.some((candidate) => candidate.id === change.successorId);
      editor.append(field("Keep equivalent task", `${key}-successor`, successor));
    } else {
      const profile = el("select", "vela-core-input");
      profile.append(option("", "Choose a profile"));
      const taken = new Set(current.tasks.filter((item) => item.id !== task.id).map((item) => item.teamMember?.profileId));
      const profiles = (teamLibrary?.profiles ?? []).filter((item) => item.id !== task.specialist?.profile?.id &&
        (!task.teamMember || !taken.has(item.id)));
      for (const item of profiles) profile.append(option(item.id, item.title));
      profile.value = change.agentProfileId;
      profile.disabled = commandPending || !profiles.length;
      profile.addEventListener("change", () => { stage({ ...change, agentProfileId: profile.value }); });
      ready = profiles.some((item) => item.id === change.agentProfileId);
      const load = button("Refresh agent profiles", `${key}-profiles`, () => { void loadTeams(true); });
      load.disabled = commandPending || teamLibraryPending === epoch;
      editor.append(field("Available agent profile", `${key}-profile`, profile), load);
      if (!profiles.length) editor.append(el("p", "vela-core-meta", teamLibraryPending === epoch
        ? "Loading available profiles…" : "No alternate profile is currently listed."));
      section.addEventListener("toggle", () => {
        if (section.open && section.isConnected) requestRevisionProfiles();
      });
    }
    const preview = button("Preview revision", `${key}-preview`, () => { void previewRevision(current, change); });
    preview.disabled = commandPending || !ready;
    editor.append(preview);
    section.append(editor);
    return section;
  }
  function postReport(id: string) {
    void scopedCommand({ name: "post-report", input: { id } }, (value) => {
      if (!value || !("kind" in value) || value.kind !== "mission-report" || value.missionId !== id)
        throw new Error("mission_report_unavailable");
      postedReport = id;
    });
  }
  function renderMission(current: MissionProjection) {
    const section = el("section", "vela-core-plan vela-mission-record");
    section.dataset.missionId = current.id;
    section.dataset.missionOutcome = current.outcome;
    section.append(
      el("h3", undefined, current.objective),
      el(
        "p",
        "vela-core-meta",
        `${stateLabel[current.outcome]} · plan v${current.planRevision} · journal revision ${current.revision}`,
      ),
    );
    if (current.answer?.length) {
      const answer = el("section", "vela-mission-answer");
      answer.dataset.missionAnswer = current.id;
      answer.setAttribute("aria-label", "Measured results");
      answer.append(el("strong", undefined, "Measured results"), ...current.answer.map(line => el("p", undefined, line)));
      section.append(answer);
    }
    if (current.team) section.append(teamLabel(current.team));
    if (current.streamPending) section.append(el("p", "vela-core-meta", "Some mission activity is waiting to reach Intelligence Stream."));
    if (current.reportPending) section.append(el("p", "vela-core-meta", "Vela’s verified result is waiting to appear in chat."));
    if (current.conversationPending) section.append(el("p", "vela-core-meta", "The verified handoff is waiting to reach the mission conversation."));
    const revision = renderRevisionReview(current);
    if (revision) section.append(revision);
    const checkpoint = current.events.findLast(event => event.kind === "settled" || event.kind === "recovered");
    if (checkpoint && canRevise(current, scope) && current.tasks.some(task => ["failed", "blocked", "uncertain"].includes(task.state))) {
      if (executiveAdvisory) section.append(el("p", "vela-core-meta", executiveAdvisory));
      if (!revision && !executiveAdvisory) {
        const ask = button("Ask Vela to review this checkpoint", "executive-review", () => { void requestExecutiveReview(current, checkpoint.seq); });
        ask.disabled = commandPending;
        section.append(ask);
      }
    }
    if(current.coverage)section.append(el("p","vela-core-meta","Investigation incomplete: "+current.coverage.limitations.join(' ')));
    if (sameScope(current.scope, scope) && (current.outcome === "verified" || current.outcome==='blocked'&&current.coverage&&current.tasks.every(task=>task.state==='verified'))) {
      const post = button("Post evidence link to Vela chat", "post-report", () => { postReport(current.id); });
      post.disabled = commandPending || postedReport === current.id;
      section.append(post);
      if (postedReport === current.id) section.append(el("p", "vela-core-meta", "Evidence link posted to Vela chat."));
    }
    if (current.planning) section.append(el("p", "vela-core-meta",
      `Planning · ${current.planning.model} · ${Math.round(current.planning.durationMs)} ms · ${current.planning.usage?.totalTokens ?? "Unknown"} reported tokens`));
    if (current.admission) section.append(missionAdmissionDetails(doc, current.admission, "current", `${current.id}-admission`));
    if (current.workroom && scope?.workspaceId !== current.workroom.workspaceId && openWorkspace) {
      section.append(button("Open mission workroom", "open-workroom",
        () => { void openWorkspace(current.workroom!.workspaceId).catch(showError); }));
    } else if (current.workroom) {
      section.append(el("p", "vela-core-meta", "This workspace is linked to the recorded mission."));
    } else if (sameScope(current.scope, scope)) {
      const review = workroomReview?.missionId === current.id ? workroomReview : null;
      if (!review) section.append(button("Preview mission workroom", "preview-workroom", () => { void planWorkroom(current.id); }));
      else {
        const draft = el("div", "vela-core-plan"), cards = el("ul");
        for (const card of review.cards) cards.append(el("li", undefined, `${card.title} · ${card.mode === "reference" ? "Reuse" : "New"} ${card.kind}`));
        section.append(el("p", "vela-core-meta", "The local mission conversation will receive its verified result and evidence links. You can review selected context before continuing in another provider."));
        draft.append(el("strong", undefined, review.title), cards,
          el("p", "vela-core-meta", "Creates a workspace in the same project and saves its reusable template."),
          button("Create linked workroom", "apply-workroom", () => { void applyWorkroom(review); }),
          button("Discard preview", "discard-workroom", () => { workroomReview = null; render(); }));
        section.append(draft);
      }
    }
    const terminal =
      current.disposition === "cancelled" || current.outcome === "verified";
    if (!terminal) {
      const controls = actions(),
        paused = current.disposition === "paused";
      controls.append(
        control(
          paused ? "Resume mission" : "Pause mission",
          "pause-resume",
          current,
          () => ({ type: paused ? "resume" : "pause" }),
        ),
        control("Cancel mission", "cancel-mission", current, () => ({
          type: "cancel",
        })),
      );
      const cap = select(
        "Parallel tasks",
        "concurrency",
        Array.from(
          { length: MISSION_LIMITS.workers },
          (_, index) => [index + 1, String(index + 1)] as const,
        ),
        current.concurrency,
      );
      controls.append(
        cap.field,
        control("Set parallelism", "set-concurrency", current, () => ({
          type: "concurrency",
          concurrency: Number(cap.control.value),
        })),
      );
      section.append(controls);
    }
    const retiredTasks = current.retiredTasks ?? [];
    const titles = new Map([...current.tasks, ...retiredTasks].map((task) => [task.id, task.objective]));
    const tasks = el("ol", "vela-missions-steps");
    const renderTask = (task: RevisionTask, retired = false) => {
      const item = el("li");
      if (retired) item.dataset.retiredMissionTask = task.id;
      else item.dataset.missionTask = task.id;
      item.dataset.taskState = task.state;
      item.append(
        el("strong", undefined, task.objective),
        el(
          "p",
          "vela-core-meta",
          `${retired ? "Retired · " : ""}${stateLabel[task.state]} · ${task.executor}`,
        ),
      );
      if (task.teamMember) {
        item.dataset.teamProfile = task.teamMember.profileId;
        item.append(el("p", "vela-core-meta", task.teamMember.title));
      }
      if (task.specialist)
        item.append(
          el(
            "p",
            "vela-core-meta",
            `${task.teamMember ? "" : `${task.specialist.role} · `}${task.specialist.model} · agent-reported recommendations`,
          ),
        );
      if (task.dependencies.length)
        item.append(
          el(
            "p",
            "vela-core-meta",
            "Requires " +
              task.dependencies.map((id) => titles.get(id) ?? id).join(", "),
          ),
        );
      if (current.waits[task.id])
        item.append(
          el("p", "vela-core-meta", waitLabel[current.waits[task.id]]),
        );
      if (task.detail)
        item.append(el("p", "vela-core-meta", contextDetail[task.detail] ?? task.detail.replace(/_/g, " ")));
      const available = retired ? { priority: false, retry: false, cancel: false } : missionTaskControls(current, task),
        controls = actions();
      if (available.priority) {
        const priority = select(
          "Queue priority",
          `${task.id}-priority-value`,
          priorities.map((title, index) => [index - 2, title] as const),
          task.priority,
        );
        controls.append(
          priority.field,
          control("Set priority", `${task.id}-priority`, current, () => ({
            type: "priority",
            taskId: task.id,
            priority: Number(priority.control.value),
          })),
        );
      }
      if (available.retry)
        controls.append(
          control("Retry task", `${task.id}-retry`, current, () => ({
            type: "retry",
            taskId: task.id,
          })),
        );
      if (available.cancel)
        controls.append(
          control("Cancel branch", `${task.id}-cancel`, current, () => ({
            type: "cancel-branch",
            taskId: task.id,
          })),
        );
      if (controls.childElementCount) item.append(controls);
      const edit = retired ? null : renderRevisionEditor(current, task);
      if (edit) item.append(edit);
      for (const [index, attempt] of task.attempts.entries()) {
        const receipt = details(
          `Attempt ${index + 1} · ${attempt.outcome ? stateLabel[attempt.outcome] : stateLabel[task.state]}`,
          attempt.id,
        );
        receipt.append(
          el("p", "vela-core-meta", `Started ${attempt.admittedAt}`),
        );
        if (attempt.finishedAt)
          receipt.append(
            el("p", "vela-core-meta", `Ended ${attempt.finishedAt}`),
          );
        if (attempt.verification)
          receipt.append(
            el(
              "p",
              undefined,
              `${attempt.verification.passed ? "Passed" : "Failed"} · ${attempt.verification.criterion} · ${attempt.verification.detail}`,
            ),
          );
        if (attempt.evidence) {
          if (current.team) {
            const finding = renderTeamEvidence(task, attempt.evidence);
            if (finding) item.append(finding);
          }
          receipt.append(
            el(
              "p",
              "vela-core-meta",
              `Evidence ${attempt.evidence.id} · ${attempt.evidence.source} · ${attempt.evidence.observedAt}`,
            ),
            el(
              "pre",
              undefined,
              JSON.stringify(attempt.evidence.value, null, 2),
            ),
          );
        }
        if (attempt.context) {
          const { accounting, dependencies, sources, omissions, compaction } = attempt.context;
          receipt.append(
            el(
              "p",
              "vela-core-meta",
              `Context ${accounting.tokens}/${accounting.maxTokens} ${accounting.method === "tokenizer" ? "tokens" : "estimated tokens"} · ${dependencies.length} prerequisites · ${sources.length} sources`,
            ),
          );
          const budgetOmissions = omissions.find((omission) => omission.reason === "budget")?.count ?? 0;
          if (budgetOmissions || compaction) {
            receipt.append(el("p", "vela-core-meta",
              `${budgetOmissions} sources omitted within the context budget · ${compaction?.deferred.length ?? 0} deferred references kept · ${compaction?.untracked ?? 0} without retained references`));
          }
          if (sources.length || compaction?.deferred.length) {
            const references = details("Context source references", `${attempt.id}-context-sources`);
            const list = el("ul");
            for (const source of sources) list.append(el("li", undefined, `Retained · ${source.ref.id} · ${source.locator}`));
            for (const source of compaction?.deferred ?? []) list.append(el("li", undefined, `Deferred · ${source.ref.id}`));
            references.append(list);
            receipt.append(references);
          }
        }
        if (attempt.timing) {
          const { queueMs, contextPreparationMs, executionMs, verificationMs } = attempt.timing;
          receipt.append(el("p", "vela-core-meta", [
            `Queue ${Math.round(queueMs)} ms`,
            `Context preparation ${Math.round(contextPreparationMs)} ms`,
            ...(executionMs === undefined ? [] : [`Executor ${Math.round(executionMs)} ms`]),
            ...(verificationMs === undefined ? [] : [`Verification ${Math.round(verificationMs)} ms`]),
          ].join(" · ")));
        }
        if (attempt.admission) receipt.append(missionAdmissionDetails(doc, attempt.admission, "attempt", `${attempt.id}-admission`));
        if (attempt.telemetry) {
          const {
            durationMs,
            providerCalls,
            usage,
            responseId,
            reportedModel,
          } = attempt.telemetry;
          receipt.append(
            el(
              "p",
              "vela-core-meta",
              `${Math.round(durationMs)} ms · ${providerCalls} provider ${providerCalls === 1 ? "call" : "calls"} · ${
                usage
                  ? `${usage.inputTokens} input / ${usage.outputTokens} output / ${usage.totalTokens} total tokens reported by provider${usage.cachedInputTokens === undefined ? "" : ` · ${usage.cachedInputTokens} cached input tokens`}`
                  : "provider usage unavailable"
              }`,
            ),
          );
          if (responseId || reportedModel)
            receipt.append(
              el(
                "p",
                "vela-core-meta",
                [reportedModel, responseId].filter(Boolean).join(" · "),
              ),
            );
        }
        item.append(receipt);
      }
      return item;
    };
    tasks.append(...current.tasks.map((task) => renderTask(task)));
    section.append(tasks);
    if (retiredTasks.length) {
      const retired = details(`Retired tasks · ${retiredTasks.length}`, `${current.id}-retired-tasks`);
      const history = el("ol", "vela-missions-steps");
      history.append(...retiredTasks.map((task) => renderTask(task, true)));
      retired.append(history);
      section.append(retired);
    }
    const timeline = details(
        "Observed mission timeline",
        `${current.id}-timeline`,
      ),
      events = el("ol", "vela-missions-timeline");
    for (const event of current.events) {
      const entry = el("li"),
        time = el("time", undefined, event.time);
      time.dateTime = event.time;
      entry.append(
        el(
          "span",
          undefined,
          `#${event.seq} ${eventLabel[event.kind]}${event.taskId ? " · " + (titles.get(event.taskId) ?? event.taskId) : ""}${event.detail ? " · " + event.detail : ""}`,
        ),
        time,
      );
      events.append(entry);
    }
    timeline.append(events);
    section.append(timeline);
    return section;
  }
  function render(focusFallback?: string) {
    syncAdmissionRefresh();
    const active = doc.activeElement as HTMLElement | null;
    const focus = body.contains(active) ? active?.dataset.missionFocus : undefined;
    const textField = focus && active?.matches("input[type=text],textarea")
      ? active as HTMLInputElement | HTMLTextAreaElement : null;
    const open = new Set(
      Array.from(
        body.querySelectorAll<HTMLDetailsElement>("details[open]"),
        (node) => node.dataset.missionDisclosure,
      ),
    );
    const next: HTMLElement[] = [];
    if (!scope)
      next.push(
        el("p", "vela-core-meta", "Open a workspace to view its missions."),
      );
    else {
      const preview = renderPreview();
      if (preview) next.push(preview);
      if (mission && !review) next.push(renderMission(mission));
      next.push(renderTeams());
      const list = el("nav", "vela-missions-list");
      list.setAttribute("aria-label", "Saved workspace missions");
      list.append(el("h3", undefined, "Workspace missions"));
      for (const item of summaries) {
        const entry = button(
          `${item.objective} · ${stateLabel[item.outcome]}`,
          item.id,
          () => choose(item.id),
        );
        if (item.id === selectedId) entry.setAttribute("aria-current", "true");
        list.append(entry);
      }
      if (!summaries.length)
        list.append(
          el("p", "vela-core-meta", "Try “Measure CPU and RAM in parallel”."),
        );
      next.push(list);
    }
    const announcement =
      mission && !review
        ? `Mission ${stateLabel[mission.outcome].toLowerCase()}${postedReport === mission.id ? " · Evidence link posted to Vela chat" : ""}`
        : "";
    if (status.textContent !== announcement) status.textContent = announcement;
    status.hidden = !announcement;
    body.replaceChildren(...next);
    for (const detail of body.querySelectorAll<HTMLDetailsElement>("details"))
      if (detail.dataset.missionDisclosure !== "team-library")
        detail.open = open.has(detail.dataset.missionDisclosure);
    if (focus || (focusFallback && (!active || active === doc.body || active === body))) {
      const nodes = Array.from(body.querySelectorAll<HTMLElement>("[data-mission-focus]:not(:disabled)"));
      const target = nodes.find((node) => node.dataset.missionFocus === focus)
        ?? nodes.find((node) => node.dataset.missionFocus === focusFallback) ?? body;
      target.focus({ preventScroll: true });
      if (textField && target.matches("input[type=text],textarea"))
        (target as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(textField.selectionStart, textField.selectionEnd, textField.selectionDirection ?? undefined);
    }
    if (visible && mission?.outcome === "verified" && shownAnswer !== mission.id) {
      const answer = body.querySelector<HTMLElement>("[data-mission-answer]");
      if (answer) {
        shownAnswer = mission.id;
        answer.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  }

  return {
    element,
    async preview(objective: string, agentProfileId?: string, noteIds?: string[]) {
      if (!scope) return null;
      const expected = scope,
        activeEpoch = epoch;
      let response: MissionResponse;
      try {
        response = await command({
          name: "preview",
          input: { objective, ...(agentProfileId ? { agentProfileId } : {}), ...(noteIds ? { noteIds } : {}) },
        });
      } catch (cause) {
        if (cause instanceof Error && cause.message === "unsupported_command")
          return null;
        throw cause;
      }
      if (activeEpoch !== epoch) throw new Error("mission_scope_denied");
      if (response === null) return null;
      if ("kind" in response && response.kind === "planning-offer" && sameScope(response.scope, expected)) return response;
      if (!("plan" in response) || !sameScope(response.plan.scope, expected))
        throw new Error("mission_scope_denied");
      return response;
    },
    review(
      preview: MissionPreview | MissionPlanningOffer,
      onStarted: (missionId: string) => void,
      agentProfileId?: string,
    ) {
      if (!sameScope("plan" in preview ? preview.plan.scope : preview.scope, scope)) return;
      review = {
        preview,
        requestId: crypto.randomUUID(),
        agentProfileId,
        onStarted,
      };
      error.hidden = true;
      render();
    },
    openReport(id: string) {
      if (!scope) return;
      if (selectedId !== id) choose(id);
      else { review = null; render(); refresh(); }
    },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (next) {
        render();
        refresh();
        if (teamLibraryOpen) void loadTeams();
      } else {
        epoch++;
        refreshQueued = false;
        summaries = [];
        setMission(null);
        teamLibrary = null;
        clearTeamReview();
      }
    },
    setScope(next: MissionScope | null) {
      if (sameScope(scope, next)) return;
      scope = next;
      epoch++;
      review = null;
      workroomReview = null;
      selectedId = null;
      setMission(null);
      summaries = [];
      teamLibrary = null;
      teamDraft = null;
      teamObjective = "";
      postedReport = null;
      shownAnswer = null;
      staged.clear();
      error.hidden = true;
      render();
      refresh();
      if (teamLibraryOpen) void loadTeams();
    },
    observe() {
      refresh();
      if (teamLibraryOpen && !teamLibrary) void loadTeams();
    },
    invalidateEvidence() {
      readEpoch++;
      if (mission) { setMission(null); render(); }
      refresh();
    },
  };
}
