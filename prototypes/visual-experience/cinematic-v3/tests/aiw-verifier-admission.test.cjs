const test = require("node:test");
const assert = require("node:assert/strict");
const { aiwVerificationMode, verify } = require("../native/integration-vela-missions.cjs");

const inspection = [
  "--integration-vela-missions",
  "--missions-aep-presentation-only",
  "--missions-aiw-inspection",
];

test("AIW experience uses the offline inspection mode and excludes other journeys", () => {
  assert.equal(aiwVerificationMode([]), null);
  assert.equal(aiwVerificationMode(inspection), "inspection");
  assert.equal(aiwVerificationMode([...inspection, "--missions-aiw-experience"]), "experience");
  for (const args of [
    ["--missions-aiw-experience"],
    inspection.slice(1),
    [...inspection, "--verify-restore"],
    [...inspection, "--bootstrap-vela-api"],
    [...inspection, "--integration-expanded"],
    [...inspection, "--missions-api-live-only"],
  ]) assert.throws(() => aiwVerificationMode(args), /owned_offline_aiw_verification_required/);
});

test("shared admission refusal stops the mission verifier before touching the window or backend", async () => {
  const untouched = new Proxy({}, {
    get() { assert.fail("native window or app accessed before admission"); },
  });
  const receipt = await verify({
    win: untouched, app: untouched,
    privateRoot: "C:\\review-vela-missions-123",
    call: () => assert.fail("backend accessed before admission"),
    moduleStartedMonotonicMs: performance.now(),
    checkDesktopTest() { throw Error("native_test_desktop_slot_closed"); },
  });
  assert.equal(receipt.passed, false);
  assert.equal(receipt.error.message, "native_test_desktop_slot_closed");
  assert.deepEqual(receipt.captures, []);
});
