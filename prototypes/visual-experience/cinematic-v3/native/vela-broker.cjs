const {
  validateReview,
  validateFileEditReview,
  showVelaReview,
  isReviewOwnerAlive,
} = require("./vela-review.cjs");
const publicNames = new Set([
  "state",
  "open",
  "search",
  "native",
  "request",
  "routingOptions",
  "saveRoutingSettings",
  "rateRoutingResponse",
  "applyFileEdit",
  "verifyFileEdit",
  "reconcileFileEdit",
  "reconcileProviderTurn",
  "presentation",
  "review",
  "apply",
  "cancel",
  "preferences",
  "reviewAttention",
  "adaptationPolicy",
  "explicitPreference",
  "reviewPreference",
  "resetPreferences",
]);
exports.isVelaRead = (input) =>
  input && ["state", "search"].includes(input.name);

/** Transient canvas bounds carry no provider grant or model-action authority. */
function presentationContext(value) {
  if (value === undefined) return undefined;
  const valid =
    value &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    typeof value.workspaceId === "string" &&
    value.workspaceId.length > 0 &&
    value.workspaceId.length <= 200 &&
    !/[\x00-\x1f]/.test(value.workspaceId) &&
    value.bounds &&
    !Array.isArray(value.bounds) &&
    Object.keys(value.bounds).length === 4 &&
    ["x", "y", "width", "height"].every(
      (key) =>
        typeof value.bounds[key] === "number" &&
        Number.isFinite(value.bounds[key]) &&
        Math.abs(value.bounds[key]) <= 1000000,
    ) &&
    value.bounds.width > 0 &&
    value.bounds.height > 0;
  if (!valid) throw Error("invalid_vela_presentation");
  return {
    workspaceId: value.workspaceId,
    bounds: {
      x: value.bounds.x,
      y: value.bounds.y,
      width: value.bounds.width,
      height: value.bounds.height,
    },
  };
}

async function reviewProjectCheck({ win, dialog, call, requestId, kind, intent, settings }) {
  if (!["node-test", "typescript", "node-benchmark", "node-build"].includes(kind)) throw Error("invalid_vela_project_check");
  if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
  const standalone = requestId === null, nodeTest = kind === "node-test", benchmark = kind === "node-benchmark", build = kind === "node-build";
  if (build && !standalone) throw Error("vela_build_destination_required");
  const selected = await dialog.showOpenDialog(win, {
    title: nodeTest ? "Select up to four tracked Node test files" : benchmark ? "Select a tracked Node .bench script"
      : build ? "Select a tracked Node .build script" : "Select a tracked TypeScript project configuration",
    properties: nodeTest ? ["openFile", "multiSelections", "dontAddToRecent"] : ["openFile", "dontAddToRecent"],
    filters: [{ name: nodeTest ? "JavaScript and TypeScript" : benchmark || build ? "JavaScript" : "JSON", extensions: nodeTest ? ["js", "cjs", "mjs", "ts", "mts"] : benchmark || build ? ["js", "cjs", "mjs"] : ["json"] }],
  });
  if (selected.canceled || !selected.filePaths.length) throw Error("authorization_cancelled");
  if (selected.filePaths.length > (nodeTest ? 4 : 1)) throw Error("invalid_vela_project_check");
  if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
  let artifactPath;
  if (build) {
    const output = await dialog.showSaveDialog(win, { title: "Choose an unused filename for the build output", buttonLabel: "Select destination",
      properties: ["dontAddToRecent"] });
    if (output.canceled || !output.filePath) throw Error("authorization_cancelled");
    if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
    artifactPath = output.filePath;
  }
  const paths = selected.filePaths;
  const review = standalone ? await call("velaStandaloneCheckReview", { intent, ...(settings ? { settings } : {}), paths, ...(artifactPath ? { artifactPath } : {}) })
    : await call("velaProjectCheckReview", { requestId, kind, paths });
  if (!review || review.requestId !== requestId || review.kind !== kind ||
      typeof review.reviewId !== "string" || !/^[a-f0-9-]{36}$/.test(review.reviewId) ||
      !(Date.parse(review.expiresAt) > Date.now()) || typeof review.cwd !== "string" || !/^[CD]:[\\/]/i.test(review.cwd) ||
      review.artifactPath !== artifactPath || !Array.isArray(review.argv) || review.argv.length < 2 || review.argv.length > 16 ||
      ![review.cwd, ...review.argv, ...(artifactPath ? [artifactPath] : [])].every(part => typeof part === "string" && part.length > 0 && part.length <= 512 && !/[\x00-\x1f]|\p{Bidi_Control}/u.test(part)))
    throw Error("invalid_vela_project_check_review");
  if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
  const result = await dialog.showMessageBox(win, {
    type: "question", title: "Vela · Review project check",
    message: nodeTest ? "Run the selected Node tests?" : benchmark ? "Run the selected benchmark script?"
      : build ? "Run the selected build script?" : "Type-check the selected TypeScript project?",
    detail: "Working directory\n" + review.cwd + "\n\nCommand arguments\n" + review.argv.map(part => JSON.stringify(part)).join(" ") +
      (artifactPath ? "\n\nProposed output file\n" + artifactPath + "\nSaving up to 8 KiB of build output requires a separate review." : "") +
      "\n\nUses the local Codex read-only sandbox with network access disabled. Time limit 20 seconds. Output above 64 KiB cannot produce a verified result.",
    buttons: ["Run check", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (result.response !== 0) throw Error("authorization_cancelled");
  if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
  return standalone ? call("velaStandaloneCheckRun", { reviewId: review.reviewId })
    : call("velaProjectCheckRun", { requestId, reviewId: review.reviewId });
}

/** Called only after the host verifies its exact local main frame. Grants never enter IPC results. */
exports.velaCommand = async ({
  win,
  dialog,
  call,
  input,
  reviewProvider = showVelaReview,
  offerPlanningByDefault = false,
  directMessageSend = false,
  routeNative = directMessageSend,
  observeNativeRequest,
}) => {
  const observe = (event) => {
    try {
      observeNativeRequest?.(Object.freeze(event));
    } catch {
      // Native diagnostics have no command, consent or failure authority.
    }
  };
  const stage = async (name, work) => {
    observe({ stage: name, state: "started" });
    try {
      const result = await work();
      observe({ stage: name, state: "completed" });
      return result;
    } catch (error) {
      const candidate = error?.code ?? error?.message;
      const code =
        typeof candidate === "string" &&
        /^[a-z][a-z0-9_]{0,95}$/.test(candidate)
          ? candidate
          : "operation_failed";
      observe({ stage: name, state: "failed", code });
      throw error;
    }
  };
  if (!input || !publicNames.has(input.name))
    throw Error("invalid_vela_command");
  const presentation =
    input.name === "apply"
      ? presentationContext(input.presentation)
      : undefined;
  if (input.name !== "apply" && input.presentation !== undefined)
    throw Error("invalid_vela_presentation");
  if (input.name === "request") {
    const value = input.input;
    if (
      !value ||
      typeof value.intent !== "string" ||
      !Array.isArray(value.resourceIds) ||
      typeof value.authorizeProvider !== "boolean" ||
      (value.providerId !== undefined && !["codex-app-server", "chatgpt-plan-responses"].includes(value.providerId)) ||
      (value.mode !== undefined && !["auto", "fast", "deep", "codex", "custom"].includes(value.mode)) ||
      (value.allowEscalation !== undefined && value.allowEscalation !== true) ||
      (value.includeRecentHistory !== undefined && value.includeRecentHistory !== true) ||
      (value.handoffSourceRequestId !== undefined && (!directMessageSend ||
        typeof value.handoffSourceRequestId !== "string" || !/^[a-f0-9-]{36}$/.test(value.handoffSourceRequestId))) ||
      (value.routingAgentId !== undefined && (!directMessageSend ||
        typeof value.routingAgentId !== "string" || !/^[a-f0-9-]{36}$/.test(value.routingAgentId))) ||
      (value.overrideDefaults !== undefined && value.overrideDefaults !== true) ||
      (value.budgetLimit !== undefined && (!Number.isSafeInteger(value.budgetLimit) || value.budgetLimit < 0)) ||
      (value.model !== undefined && (typeof value.model !== "string" || !value.model.trim() || value.model.length > 200)) ||
      (value.reasoningEffort !== undefined && !["none", "low", "medium", "high", "xhigh", "max"].includes(value.reasoningEffort))
    )
      throw Error("invalid_vela_request");
    // Renderer intent carries no grant. The host binds the exact prompt below.
    const request = {
      intent: value.intent,
      resourceIds: value.resourceIds,
      authorizeProvider: value.authorizeProvider,
      ...(value.handoffSourceRequestId === undefined ? {} : { handoffSourceRequestId: value.handoffSourceRequestId }),
      ...(value.routingAgentId === undefined ? {} : { routingAgentId: value.routingAgentId }),
    };
    const { providerId, model, reasoningEffort, mode, budgetLimit, allowEscalation, includeRecentHistory, overrideDefaults } = value;
    if (routeNative && !request.handoffSourceRequestId && !request.routingAgentId && !request.resourceIds.length && (directMessageSend || mode !== "codex" && !providerId && !model && !reasoningEffort)) {
      const settings = directMessageSend
        ? Object.fromEntries(Object.entries({ providerId, mode, model, reasoningEffort, overrideDefaults, budgetLimit }).filter(([, option]) => option !== undefined))
        : {};
      const local = await stage("native-route", () => call("velaRouteNative", {
        intent: request.intent,
        ...(Object.keys(settings).length ? { settings } : {}),
      }));
      if (local?.matched === true) return local.request;
      if (directMessageSend && local?.projectCheck) {
        return stage("project-check", () => reviewProjectCheck({ win, dialog, call, requestId: null,
          kind: local.projectCheck, intent: request.intent, settings: Object.keys(settings).length ? settings : undefined }));
      }
    }
    if (offerPlanningByDefault && !directMessageSend) {
      // Observing a connection does not start a model turn.
      await stage("connection", async () => {
        if (providerId === "chatgpt-plan-responses") {
          const status = await call("ordinaryProviderStatus", {});
          if (status?.state !== "ready" || !status.planUsageEnabled)
            throw Error("vela_chatgpt_sign_in_required");
          return;
        }
        const status = await call("capabilities", {}).catch((error) => {
          throw Error(error?.message === "execution_busy" ? "vela_planner_busy" : "vela_planner_unavailable");
        });
        if (status?.providerId !== "codex-app-server" || status.mock !== false)
          throw Error("vela_planner_unavailable");
        if (status.authentication === "required")
          throw Error("vela_planner_sign_in_required");
        if (status.authentication !== "available")
          throw Error("vela_planner_unavailable");
      });
    }
    if (offerPlanningByDefault) request.authorizeProvider = true;
    if ((request.handoffSourceRequestId || request.routingAgentId) && !request.authorizeProvider) throw Error("native_vela_review_required");
    if (!request.authorizeProvider)
      return call("vela", { name: "request", input: request });
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const previewInput = {
        intent: request.intent,
        resourceIds: request.resourceIds,
        ...(providerId === undefined ? {} : { providerId }),
        ...(directMessageSend ? { adaptive: true, model, reasoningEffort, mode, budgetLimit, allowEscalation, includeRecentHistory, overrideDefaults } : {}),
        ...(request.handoffSourceRequestId ? { handoffSourceRequestId: request.handoffSourceRequestId } : {}),
        ...(request.routingAgentId ? { routingAgentId: request.routingAgentId } : {}),
        ...(value.activeCard === undefined ? {} : { activeCard: value.activeCard }),
    };
    const preview = await stage("preview", async () => {
      try { return await call("velaRequestPreview", previewInput); }
      catch (error) {
        const code = error?.code ?? error?.message;
        const mixed = code === "vela_codex_mixed_targets_required";
        const replace = mixed || code === "vela_codex_edit_target_required";
        const create = mixed || code === "vela_codex_create_target_required";
        if (!directMessageSend || !(replace || create)) throw error;
        if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
        const paths = {};
        if (replace) {
          const selected = await dialog.showOpenDialog(win, {
            title: mixed ? "Select up to three tracked files from one repository" : "Select up to four tracked files from one repository",
            properties: ["openFile", "multiSelections"],
          });
          if (selected.canceled || !selected.filePaths.length) throw Error("authorization_cancelled");
          if (selected.filePaths.length > (mixed ? 3 : 4)) throw Error("vela_edit_file_limit");
          paths.editTargetPaths = selected.filePaths;
        }
        if (create) {
          if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
          const selected = await dialog.showSaveDialog(win, {
            title: "Choose an unused filename inside the repository",
            buttonLabel: "Select destination",
            properties: ["dontAddToRecent"],
          });
          if (selected.canceled || !selected.filePath) throw Error("authorization_cancelled");
          paths.editCreatePaths = [selected.filePath];
        }
        if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
        return call("velaRequestPreview", { ...previewInput, ...paths });
      }
    });
    if (preview.handoff?.sourceRequestId !== request.handoffSourceRequestId) throw Error("invalid_native_vela_review");
    if (preview.routingAgent?.resourceId !== request.routingAgentId) throw Error("invalid_native_vela_review");
    const review = await stage("review", async () =>
      validateReview(
        preview,
        await call("velaNativeReview", {
          previewId: preview.id,
          signature: preview.signature,
        }),
      ),
    );
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const direct = directMessageSend && (!preview.route || preview.route.kind === "conversational") &&
      !preview.route?.nativeMetric && !preview.route?.nativeLog &&
      preview.resourceIds?.length === 0 &&
      !review.context.included.length && !review.history?.messages.length && !review.handoff && !review.routingAgent;
    const approved = direct || await reviewProvider({
      parent: win,
      review,
      intent: preview.intent,
      expiresAt: preview.expiresAt,
    });
    if (approved !== true) throw Error("authorization_cancelled");
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const grant = await stage("grant", () =>
      call("authorizeVelaRequest", {
        previewId: preview.id,
        signature: preview.signature,
        reviewDigest: review.reviewDigest,
        ...(direct ? { directSend: true } : {}),
      }),
    );
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const result = await stage("request", () =>
      call("vela", {
        name: "request",
        input: {
          ...request,
          previewId: preview.id,
          grantId: grant.grantId,
        },
      }),
    );
    if (!directMessageSend || result?.state !== "responded" || !(preview.route?.nativeMetric || preview.route?.nativeLog)) return result;
    const next = await call("velaNextWorkflowStage", { requestId: result.id });
    if (!next) return result;
    try {
      return await exports.velaCommand({ win, dialog, call, reviewProvider, offerPlanningByDefault, directMessageSend, routeNative,
        observeNativeRequest, input: { name: "request", input: { intent: next.intent, resourceIds: [], authorizeProvider: true,
          mode: "codex", providerId: "codex-app-server", handoffSourceRequestId: result.id } } });
    } catch (error) {
      if (error?.message !== "authorization_cancelled") throw error;
      return result;
    }
  }
  if (input.name === "applyFileEdit") {
    const requestId = input.input?.requestId;
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
      throw Error("invalid_vela_edit_request");
    if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
    const review = validateFileEditReview(requestId, await call("velaFileEditReview", { requestId }));
    const approved = await reviewProvider({
      parent: win, review, expiresAt: review.expiresAt, experience: "file-edit",
    });
    if (approved !== true) throw Error("authorization_cancelled");
    if (!isReviewOwnerAlive(win)) throw Error("native_review_owner_unavailable");
    const applied = await call("velaFileEditApply", { requestId, reviewId: review.reviewId });
    if (applied?.state !== "applied" || applied.projectChecksAvailable !== true || !applied.followUpCheck || applied.followUpCheck === "node-build") return applied;
    try {
      return await reviewProjectCheck({ win, dialog, call, requestId, kind: applied.followUpCheck });
    } catch (error) {
      if (error?.message !== "authorization_cancelled") throw error;
      return applied;
    }
  }
  if (input.name === "verifyFileEdit") {
    const { requestId, kind } = input.input ?? {};
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId))
      throw Error("invalid_vela_project_check");
    return reviewProjectCheck({ win, dialog, call, requestId, kind });
  }
  if (input.name === "apply") {
    if (typeof input.input !== "string") throw Error("invalid_vela_plan");
    const state = await call("vela", { name: "state", input: {} });
    const plan = state.plans.find((p) => p.id === input.input);
    if (!plan) throw Error("plan_not_found");
    const delegated = plan.steps.filter(
      (s) => s.action.type === "delegateTask",
    );
    if (delegated.length && plan.state === "approved") {
      const request = state.requests.find((r) => r.id === plan.requestId);
      if (!request) throw Error("request_not_found");
      const choice = await dialog.showMessageBox(win, {
        type: "question",
        title: "Authorize delegated provider work",
        message: "Start the reviewed delegated tasks?",
        detail: `Vela will coordinate these separate provider tasks. The provider retains its own identity and native instructions. Approval is bound to this plan and its reviewed context; provider completion does not establish task verification.\n\n${JSON.stringify({ summary: plan.summary, steps: delegated, context: request.context }, null, 2)}`,
        buttons: ["Cancel", "Start reviewed tasks"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response !== 1) throw Error("authorization_cancelled");
      for (const step of delegated)
        await call("authorizeVelaDelegation", {
          planId: plan.id,
          stepId: step.id,
          fingerprint: plan.fingerprint,
        });
    }
  }
  // Backend uses an explicit method switch and validates context/version/policy again.
  return call("vela", {
    name: input.name,
    input: input.input,
    ...(presentation ? { presentation } : {}),
  });
};
