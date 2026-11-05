const test = require("node:test");
const assert = require("node:assert/strict");
const { checkModelCatalog } = require("../native/model-catalog-check.cjs");
const { safeStatus } = require("../native/provider-connections.cjs");
const base = {
  contract: "aerynth.provider-connection@1",
  providerId: "chatgpt-plan-responses",
  billingRoute: "chatgpt-plan",
  state: "ready",
  storageAvailable: true,
  pending: false,
  registrationVersion: 4,
  planUsageEnabled: true,
  inferenceVerified: false,
  nativeAccountHistory: false,
  nativeAccountMemory: false,
  nativeAccountSync: false,
};
const catalog = {
  state: "unavailable",
  diagnostic: {
    contract: "aerynth.model-catalog-diagnostic@1",
    outcome: "http-error",
    httpStatus: 403,
    serverRequestId: "req_fixture",
    bodyShape: "error",
    remoteCode: "subscription_sharing_user_not_eligible",
    returnedCount: null,
    listedCount: null,
    observedAt: 1234,
  },
};
test("one explicit native managed model check preserves ready sign-in and safe HTTP evidence without retries or inference", async () => {
  const calls = [];
  let time = 0;
  const result = await checkModelCatalog({
    now: () => (time += 10),
    call: async (command, input) => {
      calls.push({ command, input });
      if (input.type === "refreshModels")
        throw Error("SYNTHETIC_SECRET_RAW_TRANSPORT");
      return {
        ...base,
        privateToken: "SYNTHETIC_SECRET",
        ...(calls.length > 1 ? { modelCatalog: catalog } : {}),
      };
    },
  });
  assert.deepEqual(
    calls.map((c) => c.command),
    ["providerConnection", "providerConnection", "providerConnection"],
  );
  assert.deepEqual(
    calls.map((c) => c.input.type),
    ["status", "refreshModels", "status"],
  );
  assert.equal(result.connectionState, "ready");
  assert.equal(result.requested, true);
  assert.equal(result.succeeded, false);
  assert.deepEqual(result.catalog, catalog);
  assert.equal(result.elapsedMs, 10);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
  assert.equal(result.modelInferenceAttempted, false);
  assert.equal(result.openedAuthorization, false);
});
test("disconnected, pending, identity-only and unavailable states never start network or OAuth", async () => {
  for (const state of [
    "disconnected",
    "identity-only",
    "unavailable",
    "ready",
  ]) {
    const calls = [];
    const result = await checkModelCatalog({
      call: async (_command, input) => {
        calls.push(input.type);
        return { ...base, state, pending: state === "ready" };
      },
    });
    assert.deepEqual(calls, ["status", "status"]);
    assert.equal(result.requested, false);
  }
});
test("safe catalog projection rejects raw fields, unknown codes, getters and false success claims", () => {
  assert.deepEqual(
    safeStatus({ ...base, modelCatalog: catalog }).modelCatalog,
    catalog,
  );
  assert.equal(
    safeStatus({
      ...base,
      modelCatalog: { ...catalog, failureCode: "response_capacity_exceeded" },
    }).modelCatalog.failureCode,
    "response_capacity_exceeded",
  );
  for (const invalid of [
    { ...catalog, token: "SYNTHETIC_SECRET" },
    { ...catalog, failureCode: "SYNTHETIC_SECRET" },
    {
      ...catalog,
      diagnostic: { ...catalog.diagnostic, body: "SYNTHETIC_SECRET" },
    },
    {
      ...catalog,
      diagnostic: { ...catalog.diagnostic, remoteCode: "SYNTHETIC_SECRET" },
    },
    {
      ...catalog,
      diagnostic: {
        ...catalog.diagnostic,
        serverRequestId: "Bearer SYNTHETIC_SECRET",
      },
    },
    { ...catalog, diagnostic: { ...catalog.diagnostic, returnedCount: 2049 } },
    { ...catalog, state: "ready" },
    {
      ...catalog,
      get diagnostic() {
        throw Error("getter must not run");
      },
    },
  ])
    assert.throws(
      () => safeStatus({ ...base, modelCatalog: invalid }),
      /invalid_provider_catalog_status/,
    );
});
