import { MISSION_LIMITS } from "../../../integrated-backend/src/mission-contracts.mts";
import type {
  MissionControl,
  MissionPreview,
  MissionProjection,
  MissionRequest,
  MissionResponse,
  MissionScope,
  MissionSummary,
  MissionWorkroomPreview,
} from "../../../integrated-backend/src/mission-contracts.mts";

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
const priorities = ["Lowest", "Lower", "Normal", "Higher", "Highest"];
const sameScope = (left: MissionScope | null, right: MissionScope | null) =>
  left?.workspaceId === right?.workspaceId &&
  left?.projectId === right?.projectId;

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
    refreshing = false,
    refreshQueued = false;
  let summaries: MissionSummary[] = [],
    mission: MissionProjection | null = null,
    selectedId: string | null = null;
  let review: {
    preview: MissionPreview;
    requestId: string;
    agentProfileId?: string;
    onStarted: () => void;
  } | null = null;
  let workroomReview: MissionWorkroomPreview | null = null;
  let commandPending = false;
  const staged = new Map<string, string>();

  function showError(cause: unknown) {
    const code = cause instanceof Error ? cause.message : "";
    const descriptions: Record<string, string> = {
      mission_revision_changed:
        "The mission changed. Review the current state and try again.",
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
      mission_project_check_unavailable:
        "The installed Codex read-only sandbox is unavailable.",
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
  function select(
    label: string,
    key: string,
    items: readonly (readonly [number, string])[],
    value: number,
  ) {
    const field = el("label", "vela-core-field"),
      control = el("select", "vela-core-input");
    for (const [id, title] of items) {
      const option = el("option", undefined, title);
      option.value = String(id);
      control.append(option);
    }
    control.value = staged.get(key) ?? String(value);
    control.dataset.missionFocus = key;
    control.addEventListener("change", () => {
      staged.set(key, control.value);
    });
    field.append(el("span", undefined, label), control);
    return { field, control };
  }
  function accepted(
    value: MissionResponse,
    expected: MissionScope | null,
  ): value is MissionProjection {
    return !!value && "contract" in value && (sameScope(value.scope, expected) ||
      value.workroom?.workspaceId === expected?.workspaceId && value.scope.projectId === expected?.projectId);
  }
  function refresh() {
    if (!visible || !scope || doc.hidden) return;
    refreshQueued = true;
    if (refreshing) return;
    refreshing = true;
    void (async () => {
      while (refreshQueued && visible && scope && !doc.hidden) {
        refreshQueued = false;
        const activeEpoch = epoch,
          id = selectedId,
          expected = scope;
        try {
          const [list, record] = await Promise.all([
            command({ name: "list", input: {} }),
            id ? command({ name: "read", input: { id } }) : null,
          ]);
          if (activeEpoch !== epoch || !visible || id !== selectedId) continue;
          if (!Array.isArray(list)) throw new Error("mission_list_unavailable");
          let changed = JSON.stringify(summaries) !== JSON.stringify(list);
          summaries = list;
          if (id && !list.some((item) => item.id === id)) {
            selectedId = null;
            mission = null;
            changed = true;
          } else if (
            accepted(record, expected) &&
            (!mission || record.revision > mission.revision)
          ) {
            mission = record;
            changed = true;
          }
          if (changed) render();
        } catch (cause) {
          if (activeEpoch === epoch && visible && id === selectedId) {
            summaries = [];
            mission = null;
            selectedId = null;
            render();
            showError(cause);
          }
        }
      }
    })().finally(() => {
      refreshing = false;
    });
  }
  function choose(id: string) {
    if (selectedId === id) return;
    review = null;
    workroomReview = null;
    selectedId = id;
    mission = null;
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
    finally { commandPending = false; if (epoch === generation) render(); }
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
    finally { commandPending = false; if (epoch === generation) { render(); refresh(); } }
  }
  async function mutate(
    request: Extract<MissionRequest, { name: "start" | "control" }>,
  ) {
    if (!visible || !scope || commandPending) return;
    const activeEpoch = epoch,
      expected = scope,
      selection = selectedId,
      pendingReview = review;
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
        pendingReview?.onStarted();
        if (review !== pendingReview) return;
        review = null;
        selectedId = response.id;
        mission = response;
        staged.clear();
      } else if (selectedId === selection) {
        const control = request.input.control;
        if (control.type === "concurrency") staged.delete("concurrency");
        if (control.type === "priority")
          staged.delete(`${control.taskId}-priority-value`);
        if (!mission || response.revision >= mission.revision)
          mission = response;
      }
    } catch (cause) {
      if (activeEpoch === epoch && visible) showError(cause);
    } finally {
      commandPending = false;
      body.removeAttribute("aria-busy");
      if (visible) {
        render();
        refresh();
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
    const { preview, requestId, agentProfileId } = review,
      { plan, executors, externalReview, localReview } = preview;
    const section = el("section", "vela-core-plan vela-mission-preview");
    section.append(
      el("h3", undefined, "Review mission"),
      el("p", undefined, plan.objective),
    );
    if (localReview) section.append(el("p", "vela-core-meta",
      "Start opens a native picker for up to four tracked Node tests. You will review the exact checkout and command before it runs."));
    section.append(
      externalReview
        ? el(
            "p",
            "vela-core-meta",
            `${plan.tasks.length} steps · ${externalReview.calls} separate requests to ${externalReview.provider} · ${externalReview.model}${externalReview.effort ? " · " + externalReview.effort : ""} · native review required`,
          )
        : el(
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
      if (task.specialist)
        entry.append(
          el(
            "p",
            "vela-core-meta",
            task.specialist.role +
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
        },
      });
    });
    start.classList.add("vela-core-primary");
    controls.append(
      start,
      button("Dismiss preview", "dismiss-preview", () => {
        if (!commandPending) {
          review = null;
          render();
        }
      }),
    );
    if (
      plan.tasks.some(
        (task) =>
          executors.find((item) => item.id === task.id)?.available !== true,
      )
    ) {
      start.disabled = !!externalReview;
      section.append(
        el(
          "p",
          "vela-core-meta",
          externalReview
            ? "All specialist mission executors must be available before starting."
            : "Unavailable executors can block their tasks and dependent steps.",
        ),
      );
    }
    section.append(tasks, controls);
    return section;
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
    if (current.workroom && scope?.workspaceId !== current.workroom.workspaceId && openWorkspace) {
      section.append(button("Open mission workroom", "open-workroom",
        () => { void openWorkspace(current.workroom!.workspaceId).catch(showError); }));
    } else if (current.workroom) {
      section.append(el("p", "vela-core-meta", "This workspace is linked to the recorded mission."));
    } else if (["verified", "failed", "blocked", "cancelled", "uncertain"].includes(current.outcome)) {
      const review = workroomReview?.missionId === current.id ? workroomReview : null;
      if (!review) section.append(button("Preview mission workroom", "preview-workroom", () => { void planWorkroom(current.id); }));
      else {
        const draft = el("div", "vela-core-plan"), cards = el("ul");
        for (const card of review.cards) cards.append(el("li", undefined, `${card.title} · ${card.mode === "reference" ? "Reuse" : "New"} ${card.kind}`));
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
    const titles = new Map(
      current.tasks.map((task) => [task.id, task.objective]),
    );
    const tasks = el("ol", "vela-missions-steps");
    for (const task of current.tasks) {
      const item = el("li");
      item.dataset.missionTask = task.id;
      item.dataset.taskState = task.state;
      item.append(
        el("strong", undefined, task.objective),
        el(
          "p",
          "vela-core-meta",
          `${stateLabel[task.state]} · ${task.executor}`,
        ),
      );
      if (task.specialist)
        item.append(
          el(
            "p",
            "vela-core-meta",
            `${task.specialist.role} · ${task.specialist.model} · agent-reported recommendations`,
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
        item.append(el("p", "vela-core-meta", task.detail.replace(/_/g, " ")));
      const available = missionTaskControls(current, task),
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
        if (attempt.evidence)
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
        if (attempt.context) {
          const { accounting, dependencies, sources } = attempt.context;
          receipt.append(
            el(
              "p",
              "vela-core-meta",
              `Context ${accounting.tokens}/${accounting.maxTokens} ${accounting.method === "tokenizer" ? "tokens" : "estimated tokens"} · ${dependencies.length} prerequisites · ${sources.length} sources`,
            ),
          );
        }
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
                  ? `${usage.inputTokens} input / ${usage.outputTokens} output / ${usage.totalTokens} total tokens reported by provider`
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
      tasks.append(item);
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
    section.append(tasks, timeline);
    return section;
  }
  function render() {
    const focus = body.contains(doc.activeElement)
      ? (doc.activeElement as HTMLElement).dataset.missionFocus
      : undefined;
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
        ? `Mission ${stateLabel[mission.outcome].toLowerCase()}`
        : "";
    if (status.textContent !== announcement) status.textContent = announcement;
    status.hidden = !announcement;
    body.replaceChildren(...next);
    for (const detail of body.querySelectorAll<HTMLDetailsElement>("details"))
      detail.open = open.has(detail.dataset.missionDisclosure);
    if (focus)
      (
        Array.from(
          body.querySelectorAll<HTMLElement>("[data-mission-focus]"),
        ).find((node) => node.dataset.missionFocus === focus) ?? body
      ).focus({ preventScroll: true });
  }

  return {
    element,
    async preview(objective: string, agentProfileId?: string) {
      if (!scope) return null;
      const expected = scope,
        activeEpoch = epoch;
      let response: MissionResponse;
      try {
        response = await command({
          name: "preview",
          input: { objective, ...(agentProfileId ? { agentProfileId } : {}) },
        });
      } catch (cause) {
        if (cause instanceof Error && cause.message === "unsupported_command")
          return null;
        throw cause;
      }
      if (activeEpoch !== epoch) throw new Error("mission_scope_denied");
      if (response === null) return null;
      if (!("plan" in response) || !sameScope(response.plan.scope, expected))
        throw new Error("mission_scope_denied");
      return response;
    },
    review(
      preview: MissionPreview,
      onStarted: () => void,
      agentProfileId?: string,
    ) {
      if (!sameScope(preview.plan.scope, scope)) return;
      review = {
        preview,
        requestId: crypto.randomUUID(),
        agentProfileId,
        onStarted,
      };
      error.hidden = true;
      render();
    },
    setVisible(next: boolean) {
      if (visible === next) return;
      visible = next;
      if (next) {
        render();
        refresh();
      } else {
        epoch++;
        refreshQueued = false;
        summaries = [];
        mission = null;
      }
    },
    setScope(next: MissionScope | null) {
      if (sameScope(scope, next)) return;
      scope = next;
      epoch++;
      review = null;
      workroomReview = null;
      selectedId = null;
      mission = null;
      summaries = [];
      staged.clear();
      error.hidden = true;
      render();
      refresh();
    },
    observe: refresh,
  };
}
