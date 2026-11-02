const {
  validateReview,
  showVelaReview,
  isReviewOwnerAlive,
} = require("./vela-review.cjs");
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

/** Called only after the host verifies its exact local main frame. Grants never enter IPC results. */
exports.velaCommand = async ({
  win,
  dialog,
  call,
  input,
  reviewProvider = showVelaReview,
}) => {
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
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const preview = await call("velaRequestPreview", {
      intent: request.intent,
      resourceIds: request.resourceIds,
    });
    const review = validateReview(
      preview,
      await call("velaNativeReview", {
        previewId: preview.id,
        signature: preview.signature,
      }),
    );
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const approved = await reviewProvider({
      parent: win,
      review,
      intent: preview.intent,
      expiresAt: preview.expiresAt,
    });
    if (approved !== true) throw Error("authorization_cancelled");
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
    const grant = await call("authorizeVelaRequest", {
      previewId: preview.id,
      signature: preview.signature,
      reviewDigest: review.reviewDigest,
    });
    if (!isReviewOwnerAlive(win))
      throw Error("native_review_owner_unavailable");
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
  return call("vela", {
    name: input.name,
    input: input.input,
    ...(presentation ? { presentation } : {}),
  });
};
