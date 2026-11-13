const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");
const admissionPath = require.resolve("../prototypes/visual-experience/cinematic-v3/native/native-test-admission.cjs");
const { createAdmission, verificationLaunch } = require(admissionPath);

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "aerynth-native-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = 1000;
  return { root, admission: createAdmission(root, () => clock), advance: () => { clock += 60_000; } };
}

test("native test classification covers expanded, offscreen, catalog and CDP launches", () => {
  for (const args of [
    ["--integration-expanded"],
    ["--native-test"],
    ["--integration-benchmark", "--offscreen-renderer"],
    ["--integration-vela-air-plan"],
    ["--check-model-catalog"],
    ["--aerynth-capture-visible"],
    ["--remote-debugging-port=0"],
  ]) assert.equal(verificationLaunch(args), true, args.join(" "));
  assert.equal(verificationLaunch(["--profile=C:/profile"]), false);
});

test("a permit names one owner, expires, and never silently replaces a lease", t => {
  const { admission, advance } = fixture(t);
  assert.throws(() => admission.claim(undefined, 1), { code: "native_test_desktop_slot_closed" });
  const { token } = admission.open("mission-9", 1);
  assert.throws(() => admission.open("mission-10", 1), { code: "native_test_desktop_slot_busy" });
  assert.throws(() => admission.claim("wrong", 2), { code: "native_test_desktop_slot_closed" });
  const lease = admission.claim(token, 1);
  assert.deepEqual(admission.status().lease, { owner: "mission-9", pid: 1 });
  assert.throws(() => admission.claim(token, 2), { code: "native_test_desktop_slot_busy" });
  assert.throws(() => admission.checkLease(token, 2), { code: "native_test_desktop_lease_lost" });
  advance();
  assert.throws(lease.check, { code: "native_test_desktop_slot_closed" });
  admission.close();
  assert.throws(() => admission.open("mission-10", 1), { code: "native_test_desktop_slot_busy" });
  lease.release();
  const next = admission.open("mission-10", 1);
  const nextLease = admission.claim(next.token, 2);
  lease.release();
  nextLease.check();
  nextLease.release();
});

test("gaming revokes a running verifier and prevents opening or reusing a permit", t => {
  const { admission } = fixture(t);
  const { token } = admission.open("mission-9", 10);
  const lease = admission.claim(token, 1);
  admission.pause();
  admission.pause();
  assert.equal(admission.status().gaming, true);
  assert.throws(lease.check, { code: "native_test_desktop_gaming" });
  assert.throws(() => admission.open("mission-10", 1), { code: "native_test_desktop_gaming" });
  assert.throws(() => admission.claim(token, 2), { code: "native_test_desktop_gaming" });
  lease.release();
  admission.resume();
  assert.deepEqual(admission.status(), { gaming: false, permit: null, lease: null });
  assert.throws(() => admission.claim(token, 2), { code: "native_test_desktop_slot_closed" });
});

test("unreadable state and abandoned ownership fail closed", t => {
  const { root, admission } = fixture(t);
  writeFileSync(path.join(root, "gaming.json"), "null");
  assert.throws(() => admission.open("mission-9", 1), { code: "native_test_desktop_state_unreadable" });
  admission.resume();
  writeFileSync(path.join(root, "lease.json"), "{}");
  assert.throws(() => admission.open("mission-9", 1), { code: "native_test_desktop_slot_busy" });
});

test("independent processes contending for the same Windows slot produce one winner", async t => {
  const { root } = fixture(t);
  const admission = createAdmission(root);
  const { token } = admission.open("mission-9", 1);
  const code = `
    const { createAdmission } = require(process.argv[1]);
    try {
      createAdmission(process.argv[2]).claim(process.argv[3], process.pid);
      console.log("claimed");
    } catch (error) {
      console.log(error.code);
    }
  `;
  const execute = promisify(execFile);
  const results = await Promise.all(Array.from({ length: 4 }, () =>
    execute(process.execPath, ["-e", code, admissionPath, root, token], { windowsHide: true })));
  assert.deepEqual(results.map(result => result.stdout.trim()).sort(), [
    "claimed", ...Array(3).fill("native_test_desktop_slot_busy"),
  ]);
});

test("Windows denial exits without reaching window code and revocation fences visible and input methods", {
  skip: process.platform !== "win32",
  timeout: 5000,
}, async t => {
  const { root } = fixture(t);
  const localDirectory = path.join(root, "Aerynth", "native-test-admission-v1");
  const admission = createAdmission(localDirectory);
  const code = `
    const assert = require("node:assert/strict");
    const { EventEmitter } = require("node:events");
    const { installDesktopTestAdmission } = require(process.argv[1]);
    const app = new EventEmitter();
    let shown = 0, inputs = 0, hidden = 0, terminated = 0;
    const win = {
      show: () => shown++,
      isDestroyed: () => false,
      hide: () => hidden++,
      webContents: { sendInputEvent: () => inputs++ },
    };
    const check = installDesktopTestAdmission({
      app, BrowserWindow: { getAllWindows: () => [win] }, terminate: () => terminated++,
    });
    app.emit("browser-window-created", {}, win);
    win.show();
    win.webContents.sendInputEvent({});
    console.log("ready");
    process.stdin.once("data", () => {
      assert.throws(() => win.show(), { code: "native_test_desktop_gaming" });
      assert.throws(() => win.webContents.sendInputEvent({}), { code: "native_test_desktop_gaming" });
      assert.throws(check, { code: "native_test_desktop_gaming" });
      assert.deepEqual([shown, inputs, hidden, terminated], [1, 1, 1, 1]);
      app.emit("quit");
    });
  `;
  const env = { ...process.env, LOCALAPPDATA: root, AERYNTH_NATIVE_TEST_SLOT: "" };
  await assert.rejects(promisify(execFile)(process.execPath, ["-e", code, admissionPath], {
    windowsHide: true, env,
  }), error => error.code === 2 && error.stdout === "" && /slot_closed/.test(error.stderr));
  const { token } = admission.open("mission-9", 1);
  const child = spawn(process.execPath, ["-e", code, admissionPath], {
    windowsHide: true, env: { ...env, AERYNTH_NATIVE_TEST_SLOT: token },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("ready") && !child.stdin.writableEnded) {
        admission.pause();
        child.stdin.end("check");
      }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", status => status === 0 && stdout.includes("ready") ? resolve() : reject(Error(stderr)));
  });
  assert.equal(admission.status().lease, null);
});
