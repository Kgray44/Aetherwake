const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { createAdmission } = require("../native/native-test-admission.cjs");
const { superviseMemoryFixture } = require("../native/memory-fixture-supervisor.cjs");

function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-supervisor-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profileRoot = join(root, "memory-witness-synthetic");
  const slot = join(root, "slot");
  mkdirSync(profileRoot);
  let clock = Date.now();
  const now = () => clock;
  const admission = createAdmission(slot, now);
  admission.resume(clock);
  const permit = admission.open("memory-witness", 1);
  const allocation = {
    contract: "aerynth.memory-fixture-allocation@1",
    owner: permit.owner, availabilityId: permit.availabilityId, token: permit.token, profileRoot, expiresAt: clock + 40_000,
  };
  const options = {
    allocation, profileRoot, token: permit.token, now,
    locateDesktop: () => slot, openAdmission: () => admission, allowWrite: () => true,
    startFixture: () => assert.fail("fixture must not start"),
  };
  return { options, admission, profileRoot, advance: ms => { clock += ms; } };
}

test("missing, foreign, expired and occupied admission cannot reach fixture spawn", t => {
  const { options, admission, profileRoot, advance } = setup(t);
  for (const token of [undefined, "other-permit"])
    assert.throws(() => superviseMemoryFixture({ ...options, token }), /slot_closed/);
  const lease = admission.claim(options.token, 123);
  assert.throws(() => superviseMemoryFixture(options), /slot_busy/);
  lease.release();
  for (const patch of [{ owner: "other" }, { availabilityId: "other" }, { expiresAt: options.now() + 46_000 }])
    assert.throws(() => superviseMemoryFixture({ ...options, allocation: { ...options.allocation, ...patch } }), /allocation_invalid/);
  advance(41_000);
  assert.throws(() => superviseMemoryFixture(options), /allocation_invalid/);
  advance(20_000);
  assert.throws(() => superviseMemoryFixture(options), /slot_closed/);
  assert.deepEqual(readdirSync(profileRoot), []);
});

test("wrong, occupied and reserve-denied profiles cannot reach fixture spawn", t => {
  const { options, profileRoot } = setup(t);
  assert.throws(() => superviseMemoryFixture({ ...options, profileRoot: "foreign" }), /profile_mismatch/);
  assert.throws(() => superviseMemoryFixture({ ...options, allowWrite: () => false }), /storage_reserve_admission_denied/);
  assert.throws(() => superviseMemoryFixture({ ...options, startFixture: undefined }), /fixture_host_unavailable/);
  assert.deepEqual(readdirSync(profileRoot), []);
  writeFileSync(join(profileRoot, "existing.sqlite"), "");
  assert.throws(() => superviseMemoryFixture(options), /profile_not_fresh/);
});

test("rechecks revoked admission and consumes an exact profile before an uncertain handoff", t => {
  const { options, admission, profileRoot } = setup(t);
  assert.throws(() => superviseMemoryFixture({
    ...options, allowWrite() { admission.close(); return true; },
  }), /slot_closed/);
  assert.deepEqual(readdirSync(profileRoot), []);

  const permit = admission.open(options.allocation.owner, 1);
  assert.throws(() => superviseMemoryFixture({ ...options, token: permit.token }), /allocation_invalid/);
  const next = { ...options, token: permit.token, allocation: { ...options.allocation, token: permit.token } };
  assert.throws(() => superviseMemoryFixture({
    ...next,
    startFixture(input) {
      assert.deepEqual(input, { profileRoot, expiresAt: options.allocation.expiresAt, env: { AERYNTH_NATIVE_TEST_SLOT: permit.token } });
      assert.deepEqual(readdirSync(profileRoot), ["synthetic-packaged.started"]);
      throw Error("fixture_start_outcome_unknown");
    },
  }), /fixture_start_outcome_unknown/);
  assert.throws(() => superviseMemoryFixture(next), /profile_not_fresh/);
});
