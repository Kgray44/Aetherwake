const publicNames = new Set([
  "state",
  "open",
  "search",
  "native",
  "request",
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
  const valid = value && !Array.isArray(value) && Object.keys(value).length === 2 &&
    typeof value.workspaceId === "string" && value.workspaceId.length > 0 && value.workspaceId.length <= 200 &&
    !/[\x00-\x1f]/.test(value.workspaceId) && value.bounds && !Array.isArray(value.bounds) &&
    Object.keys(value.bounds).length === 4 && ["x", "y", "width", "height"].every(key =>
      typeof value.bounds[key] === "number" && Number.isFinite(value.bounds[key]) && Math.abs(value.bounds[key]) <= 1000000) &&
    value.bounds.width > 0 && value.bounds.height > 0;
  if (!valid) throw Error("invalid_vela_presentation");
  return { workspaceId: value.workspaceId, bounds: { x: value.bounds.x, y: value.bounds.y,
    width: value.bounds.width, height: value.bounds.height } };
}

/** Called only after the host verifies its exact local main frame. Grants never enter IPC results. */
exports.velaCommand = async ({ win, dialog, call, input }) => {
  if (!input || !publicNames.has(input.name))
    throw Error("invalid_vela_command");
  const presentation = input.name === "apply" ? presentationContext(input.presentation) : undefined;
  if (input.name !== "apply" && input.presentation !== undefined) throw Error("invalid_vela_presentation");
  if (input.name === "request") {
    const value = input.input;
    if (
      !value ||
      typeof value.intent !== "string" ||
      !Array.isArray(value.resourceIds) ||
      typeof value.authorizeProvider !== "boolean"
    )
      throw Error("invalid_vela_request");
    // A checkbox expresses intent to review egress. It cannot carry authorization.
    const request = {
      intent: value.intent,
      resourceIds: value.resourceIds,
      authorizeProvider: value.authorizeProvider,
    };
    if (!request.authorizeProvider)
      return call("vela", { name: "request", input: request });
    const preview = await call("velaRequestPreview", {
      intent: request.intent,
      resourceIds: request.resourceIds,
    });
    const choice = await dialog.showMessageBox(win, {
      type: "question",
      title: "Authorize Vela planning",
      message: `Ask ${preview.providerId} to propose an Aerynth plan for Vela?`,
      detail: `Vela coordinates Aerynth. The identified provider contributes a proposal; proposed application actions require review. This permission covers this planning request only and does not authorize a delegated task. Source excerpts are untrusted data.\n\nRequest:\n${preview.intent}\n\nExact context manifest:\n${JSON.stringify(preview.context, null, 2)}`,
      buttons: ["Cancel", "Plan once"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice.response !== 1) throw Error("authorization_cancelled");
    const grant = await call("authorizeVelaRequest", {
      previewId: preview.id,
      signature: preview.signature,
    });
    return call("vela", {
      name: "request",
      input: {
        ...request,
        previewId: preview.id,
        grantId: grant.grantId,
      },
    });
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
  return call("vela", { name: input.name, input: input.input,
    ...(presentation ? { presentation } : {}) });
};
