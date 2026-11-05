const { safeStatus } = require("./provider-connections.cjs");
const request = (type) => ({ type, providerId: "chatgpt-plan-responses" });

/** Explicit native support check. One managed GET, no sign-in, inference,
 * retry, secret export, alternate billing path or renderer authority. */
async function checkModelCatalog({ call, now = () => performance.now() }) {
  const started = now();
  const before = safeStatus(
    await call("providerConnection", request("status")),
  );
  let requested = false,
    succeeded = false;
  if (before.state === "ready" && before.planUsageEnabled && !before.pending) {
    requested = true;
    try {
      const checked = safeStatus(
        await call("providerConnection", request("refreshModels")),
      );
      succeeded = checked.modelCatalog?.state === "ready";
    } catch {
      /* Raw transport errors are never diagnostic output. */
    }
  }
  const after = safeStatus(await call("providerConnection", request("status")));
  return {
    contract: "aerynth.native-model-catalog-check@1",
    requested,
    succeeded: succeeded && after.modelCatalog?.state === "ready",
    connectionState: after.state,
    planUsageEnabled: after.planUsageEnabled,
    catalog: after.modelCatalog ?? null,
    elapsedMs: Math.max(0, now() - started),
    modelInferenceAttempted: false,
    openedAuthorization: false,
    billingFallbackUsed: false,
    credentialsExported: false,
  };
}
module.exports = { checkModelCatalog };
