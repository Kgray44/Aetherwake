"use strict";

exports.experiencePolicyReview = function experiencePolicyReview({ trusted, hasGesture, call, show, canWrite }) {
  let reviewing = false;
  return async (event, input) => {
    if (!trusted(event) || !await hasGesture(event) || !trusted(event))
      throw Error("experience_policy_user_gesture_required");
    if (!input || Object.keys(input).length !== 4 ||
        typeof input.workspaceId !== "string" || !input.workspaceId ||
        (input.projectId !== null && typeof input.projectId !== "string") ||
        typeof input.experimentId !== "string" || !input.experimentId ||
        !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 1)
      throw Error("invalid_experience_policy_review");
    if (reviewing) throw Error("experience_policy_review_busy");
    reviewing = true;
    try {
      const { workspaceId, projectId, experimentId, policyVersion } = input;
      const request = { name: "rollback-reviewed", workspaceId, projectId, experimentId, policyVersion };
      const policy = await call("aepExperimentNative", { name: "inspect-policy" });
      if (!trusted(event) || policy.scope.workspaceId !== workspaceId || policy.scope.projectId !== projectId ||
          policy.experimentId !== experimentId || policy.version !== policyVersion)
        throw Error("aep_policy_review_changed");
      const { response } = await show({
        type: "question", title: "Execution policy", message: "Restore the baseline policy for native probes?",
        detail: `Workspace ${workspaceId}\nExperiment ${experimentId}\nPolicy version ${policyVersion}\nNew native probes will return to the serial baseline. Running probes keep their admission policy.`,
        buttons: ["Restore Baseline", "Cancel"], defaultId: 1, cancelId: 1,
      });
      if (response !== 0) return "cancelled";
      if (!trusted(event) || !await canWrite() || !trusted(event))
        throw Error("experience_policy_write_unavailable");
      const result = await call("aepExperimentNative", request);
      if (result.scope.workspaceId !== workspaceId || result.scope.projectId !== projectId ||
          result.experimentId !== null || result.version !== policyVersion + 1)
        throw Error("experience_policy_result_unavailable");
      return "restored";
    } finally {
      reviewing = false;
    }
  };
};
