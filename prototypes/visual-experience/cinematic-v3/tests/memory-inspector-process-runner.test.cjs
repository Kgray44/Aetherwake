const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const test = require("node:test");
const { createAdmission } = require("../native/native-test-admission.cjs");
const { digest, enterMemoryFixture } = require("../native/memory-fixture-entry.cjs");
const { paths, manifestName, migrations } = require("../native/memory-inspector-artifact.cjs");
const { runMemoryInspectorProcess } = require("../native/memory-inspector-process-runner.cjs");

test("fixture runner verifies both inventories, privately transfers once and preserves unresolved custody", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-runner-stub-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = join(root, "artifact"), vendor = join(root, "vendor"), directory = join(root, "slot");
  const artifactPath = join(artifact, manifestName), manifestPath = join(vendor, "manifest.json");
  const executable = join(vendor, "AerynthReview.exe");
  const files = [...Object.values(paths), ...migrations].map(path => {
    const target = join(artifact, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path);
    return { path, sha256: digest(path) };
  });
  writeFileSync(artifactPath, JSON.stringify({ contract: "aerynth.memory-inspector-artifact@1", files }));
  mkdirSync(vendor);
  writeFileSync(executable, "electron stub");
  const vendorFiles = [{ path: "AerynthReview.exe", origin: "electron-runtime:electron.exe", bytes: 13, sha256: digest("electron stub") }];
  for (const path of ["resources/app/package.json", "resources/app/fixture-bootstrap.cjs"]) {
    mkdirSync(dirname(join(vendor, path)), { recursive: true });
    writeFileSync(join(vendor, path), path);
    vendorFiles.push({ path, origin: "fixture-bootstrap:" + path, bytes: Buffer.byteLength(path), sha256: digest(path) });
  }
  const receipt = JSON.stringify({
    contract: "aerynth.memory-inspector-electron@1", complete: true, runtimes: { platform: "win32", arch: "x64" },
    files: vendorFiles,
  });
  writeFileSync(manifestPath, receipt);
  const admission = createAdmission(directory);
  admission.resume(Date.now());
  const permit = admission.open("memory-inspector", 1);
  const options = suffix => {
    const profileRoot = join(root, "memory-witness-" + suffix);
    mkdirSync(profileRoot);
    return {
      allocation: { ...permit, profileRoot, expiresAt: Date.now() + 30_000, contract: "aerynth.memory-fixture-allocation@1" },
      profileRoot, artifactPath, token: permit.token, allowWrite: () => true,
      electronReceipt: { manifestPath, manifestSha256: digest(receipt) },
      locateDesktop: () => directory, openAdmission: () => admission,
      launchFixture: () => assert.fail("denial reached process start"),
    };
  };
  const good = options("good");
  assert.throws(() => runMemoryInspectorProcess({ ...good, token: "wrong" }), /slot_closed/);
  writeFileSync(executable, "bad");
  assert.throws(() => runMemoryInspectorProcess(good), /electron_unverified/);
  writeFileSync(executable, "electron stub");
  const bundle = join(artifact, paths.bundle);
  writeFileSync(bundle, "bad");
  assert.throws(() => runMemoryInspectorProcess(good), /artifact_unverified/);
  writeFileSync(bundle, paths.bundle);
  assert.deepEqual(await runMemoryInspectorProcess({
    ...good,
    launchFixture(binary, args, { env, shell }) {
      assert.equal(binary, executable);
      assert.deepEqual(args, []);
      assert.equal(JSON.parse(env.AERYNTH_MEMORY_FIXTURE_HANDOFF).entryPath, join(artifact, paths.executable));
      assert.equal(shell, false);
      assert.equal(env.AERYNTH_NATIVE_TEST_SLOT, permit.token);
      assert.ok(!env.AERYNTH_MEMORY_FIXTURE_HANDOFF.includes(permit.token));
      const handoff = { ...good, ...JSON.parse(env.AERYNTH_MEMORY_FIXTURE_HANDOFF), pid: 222 };
      const child = enterMemoryFixture(handoff);
      child.release();
      assert.throws(() => enterMemoryFixture(handoff), /profile_not_pending/);
      return { pid: 222, exit: Promise.resolve({ code: 0 }) };
    },
  }), { code: 0 });
  const unresolved = options("unresolved");
  let terminations = 0;
  await assert.rejects(runMemoryInspectorProcess({
    ...unresolved, runMs: 1, shutdownMs: 1,
    launchFixture() {
      return { pid: 333, exit: new Promise(() => {}), terminate: () => { terminations++; } };
    },
  }), /process_outcome_unresolved/);
  assert.equal(terminations, 1);
  assert.equal(admission.status().lease.pid, 333);
  assert.equal(JSON.parse(readFileSync(join(unresolved.profileRoot, "synthetic-launch-unresolved.json"))).childPid, 333);
});
