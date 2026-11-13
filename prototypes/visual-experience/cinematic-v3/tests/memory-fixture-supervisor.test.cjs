const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { createAdmission } = require("../native/native-test-admission.cjs");
const { superviseMemoryFixture } = require("../native/memory-fixture-supervisor.cjs");
const { enterMemoryFixture } = require("../native/memory-fixture-entry.cjs");
const { startMemoryInspectorFixture } = require("../native/memory-inspector-fixture-startup.cjs");

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

test("consumer refuses aliased paths and releases its lease after reserve denial", t => {
  const { options, admission, profileRoot } = setup(t);
  const handoff = superviseMemoryFixture({ ...options, startFixture: value => value });
  const input = { ...options, descriptorDigest: handoff.descriptorDigest, pid: 123 };
  const { sep } = require("node:path");
  assert.throws(() => enterMemoryFixture({ ...input, profileRoot: profileRoot + sep + "." }), /path_mismatch/);
  assert.throws(() => enterMemoryFixture({
    ...input, artifactPath: options.artifactPath + sep + ".",
  }), /descriptor_invalid/);
  assert.equal(admission.status().lease, null);
  assert.throws(() => enterMemoryFixture({
    ...input,
    allowWrite() {
      assert.equal(admission.status().lease.pid, 123);
      return false;
    },
  }), /storage_reserve_admission_denied/);
  assert.equal(admission.status().lease, null);
  assert.deepEqual(readdirSync(profileRoot), ["synthetic-packaged.started"]);
});

test("consumer releases its lease if the permit is revoked during reserve admission", t => {
  const { options, admission, profileRoot } = setup(t);
  const handoff = superviseMemoryFixture({ ...options, startFixture: value => value });
  assert.throws(() => enterMemoryFixture({
    ...options, descriptorDigest: handoff.descriptorDigest,
    allowWrite() { admission.close(); return true; },
  }), /slot_closed/);
  assert.equal(admission.status().lease, null);
  assert.deepEqual(readdirSync(profileRoot), ["synthetic-packaged.started"]);
});

test("inspector startup gates all fixture effects and sends policy authority only after native consent", async t => {
  const { options, admission, profileRoot } = setup(t);
  const handoff = {
    ...options,
    ...superviseMemoryFixture({ ...options, startFixture: value => value }),
  };
  const steps = [], calls = [];
  const rendererURL = "file:///fixture/index.html";
  let approve = false, token;
  const frame = { url: rendererURL, executeJavaScript: async (_script, userGesture) => {
    assert.equal(userGesture, false);
    return true;
  } };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  const runtime = {
    createProtector({ profileRoot: root, fixtureKey, mode }) {
      steps.push("custody");
      assert.equal(root, profileRoot);
      assert.equal(mode, "create");
      assert.equal(fixtureKey.length, 32);
      return { close: () => steps.push("custody closed") };
    },
    startBackend({ args, env, protector }) {
      steps.push("worker");
      assert.ok(protector);
      assert.equal(args[1], "--memory-fixture-bootstrap-v1");
      assert.deepEqual(JSON.parse(args[2]), {
        contract: "aerynth.memory-fixture-bootstrap@1", profileRoot, expiresAt: handoff.expiresAt,
      });
      assert.deepEqual(Object.keys(env), ["AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN", "AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN"]);
      assert.match(env.AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN, /^[a-zA-Z0-9_-]{43}$/u);
      assert.notEqual(env.AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN, env.AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN);
      token = env.AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN;
      return {
        ready: () => true,
        async call(request) {
          calls.push(request);
          return { version: 3, storageEnabled: true, velaEnabled: false };
        },
        close: () => steps.push("worker closed"),
      };
    },
    createSurface({ preloadPath }) {
      steps.push("surface");
      assert.equal(preloadPath, "production-preload");
      return {
        win: { webContents: contents, isDestroyed: () => false, isVisible: () => true,
          isMinimized: () => false, isFocused: () => true },
        dialog: { showMessageBox: async () => ({ response: approve ? 1 : 0 }) },
        close: () => steps.push("surface closed"),
        async mount({ dispatch, rendererURL: url }) {
          assert.equal(url, rendererURL);
          const input = { type: "enableProviderMemory", assistant: "vela", version: 3, fixturePolicyToken: "forged" };
          for (const command of ["personalMemoryPolicyNative", "providerAuth", "velaApiConfigure"])
            assert.deepEqual(await dispatch(event, command, input), { ok: false, error: "memory_fixture_command_denied" });
          assert.equal((await dispatch({ ...event, senderFrame: {} }, "personalMemory", input)).ok, false);
          assert.deepEqual(await dispatch(event, "personalMemory", input), { ok: true, result: { status: "cancelled" } });
          assert.equal(calls.some(request => request.fixturePolicyToken), false);
          approve = true;
          assert.equal((await dispatch(event, "personalMemory", input)).ok, true);
          assert.deepEqual(calls.at(-1), {
            command: "personalMemoryPolicyNative", input: { assistant: "vela", enable: true, expectedVersion: 3 },
            fixturePolicyToken: token,
          });
        },
      };
    },
  };
  const startup = {
    handoff, runtime, allowWrite: () => true,
    verifyArtifact({ check }) {
      steps.push("artifact");
      check();
      assert.equal(admission.status().lease.pid, process.pid);
      return { rendererURL, preloadPath: "production-preload", hostPath: "fixture-host", nodePath: "fixture-node" };
    },
  };
  await assert.rejects(startMemoryInspectorFixture({ ...startup, handoff: { ...handoff, token: "wrong" } }), /slot_closed/);
  assert.deepEqual(steps, []);
  const fixture = await startMemoryInspectorFixture(startup);
  await fixture.close();
  assert.deepEqual(steps, ["artifact", "custody", "worker", "surface", "surface closed", "worker closed", "custody closed"]);
  assert.equal(admission.status().lease, null);
});
