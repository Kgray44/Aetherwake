const assert = require("node:assert/strict");
const test = require("node:test");
const { resourcePolicyInspection } = require("../native/resource-policy-inspection.cjs");

test("resource inspection exposes reads and reviewed actions through separate authorization", async () => {
  let trusted = false, gesture = false;
  const calls = [];
  const dispatch = resourcePolicyInspection({
    trusted: () => trusted,
    hasGesture: async () => gesture,
    inspect: async () => { calls.push("inspect"); return { epoch: "source" }; },
    reviewMode: async () => { calls.push("mode"); },
    reviewRollback: async () => { calls.push("rollback"); },
  });
  await assert.rejects(dispatch({}, "inspect"), /unauthorized/);
  trusted = true;
  assert.deepEqual(await dispatch({}, "inspect"), { epoch: "source" });
  await assert.rejects(dispatch({}, "rollback"), /gesture/);
  await assert.rejects(dispatch({}, { name: "set-mode", mode: "max_throughput" }), /invalid/);
  gesture = true;
  await dispatch({}, "mode");
  await dispatch({}, "rollback");
  assert.deepEqual(calls, ["inspect", "mode", "rollback"]);
});
