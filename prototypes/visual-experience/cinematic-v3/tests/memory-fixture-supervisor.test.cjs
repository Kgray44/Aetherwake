const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { createAdmission } = require("../native/native-test-admission.cjs");
const { superviseMemoryFixture } = require("../native/memory-fixture-supervisor.cjs");
const { enterMemoryFixture } = require("../native/memory-fixture-entry.cjs");

function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-supervisor-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profileRoot = join(root, "memory-witness-synthetic");
  const slot = join(root, "slot");
  const artifactPath = join(root, "acceptance-fixture.stub");
  mkdirSync(profileRoot);
  writeFileSync(artifactPath, "synthetic package identity");
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
    allocation, profileRoot, artifactPath, token: permit.token, now,
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
      assert.equal(input.profileRoot, profileRoot);
      assert.equal(input.artifactPath, options.artifactPath);
      assert.match(input.descriptorDigest, /^[a-f0-9]{64}$/u);
      assert.equal(input.expiresAt, options.allocation.expiresAt);
      assert.deepEqual(input.env, { AERYNTH_NATIVE_TEST_SLOT: permit.token });
      assert.deepEqual(readdirSync(profileRoot), ["synthetic-packaged.started"]);
      throw Error("fixture_start_outcome_unknown");
    },
  }), /fixture_start_outcome_unknown/);
  assert.throws(() => superviseMemoryFixture(next), /profile_not_fresh/);
});

test("fixture entry claims the canonical lease and returns only the minimal backend descriptor once", t => {
  const { options, admission, profileRoot } = setup(t);
  const handoff = superviseMemoryFixture({ ...options, startFixture: value => value });
  const input = { ...options, descriptorDigest: handoff.descriptorDigest, pid: 123 };
  assert.throws(() => enterMemoryFixture({ ...input, token: "foreign" }), /slot_closed/);
  assert.throws(() => enterMemoryFixture({ ...input, descriptorDigest: "foreign" }), /descriptor_invalid/);
  assert.equal(admission.status().lease, null);
  const entered = enterMemoryFixture(input);
  assert.deepEqual(entered.backendDescriptor, {
    contract: "aerynth.memory-fixture-bootstrap@1", profileRoot, expiresAt: options.allocation.expiresAt,
  });
  assert.deepEqual(admission.status().lease, { owner: options.allocation.owner, pid: 123 });
  entered.check();
  entered.release();
  assert.throws(() => enterMemoryFixture(input), /profile_not_pending/);
});

test("artifact substitution, expiry and revoked permit never consume the descriptor", t => {
  const { options, admission, profileRoot, advance } = setup(t);
  const handoff = superviseMemoryFixture({ ...options, startFixture: value => value });
  const input = { ...options, descriptorDigest: handoff.descriptorDigest };
  writeFileSync(options.artifactPath, "changed");
  assert.throws(() => enterMemoryFixture(input), /artifact_changed/);
  assert.equal(admission.status().lease, null);
  advance(41_000);
  assert.throws(() => enterMemoryFixture(input), /descriptor_invalid/);
  admission.close();
  assert.throws(() => enterMemoryFixture(input), /slot_closed/);
  assert.deepEqual(readdirSync(profileRoot), ["synthetic-packaged.started"]);
});
