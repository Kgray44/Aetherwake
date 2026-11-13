const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const modes = ["verify", "record", "preview", "soak", "constellation"];
const launchers = [
  ...modes.map(mode => [`prototype or Constellation launcher: ${mode}`, ["native/launch-native-test.cjs", mode]]),
  ["expanded application", ["native/run-application-check.cjs"]],
  ["document extraction smoke", ["native/run-document-text-smoke.mjs"]],
  ["output-only DOM fixture", ["tests/gpt-live-output-only-dom.test.mjs"]],
];
const forbidChildren = "data:text/javascript," + encodeURIComponent(`
  import childProcess from "node:child_process";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import Module, { syncBuiltinESMExports } from "node:module";
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[method] = () => { throw Error("unexpected_child_launch"); };
  }
  // Exercise canonical resolution without reading the real admission directory.
  const home = path.resolve("stub-os-account-home");
  const directory = path.join(home, ".aerynth-native-test-admission-v2");
  os.userInfo = () => ({ homedir: home });
  const read = fs.readFileSync;
  const revokeDuringResolution = process.env.AERYNTH_STUB_REVOKE_DURING_RESOLUTION === "1";
  let executableResolved = false;
  const load = Module._load;
  Module._load = function(request, ...args) {
    if (request === "electron") {
      if (!revokeDuringResolution) throw Error("unexpected_electron_resolution");
      executableResolved = true;
      return path.join(home, "never-executed.exe");
    }
    return load.call(this, request, ...args);
  };
  fs.readFileSync = (file, ...args) => {
    if (typeof file === "string" && /(?:gaming|availability|permit|lease)\.json$/.test(file)) {
      if (path.dirname(file) !== directory) throw Error("unexpected_admission_directory");
      process.stderr.write("stub_admission_read:" + path.basename(file) + "\\n");
      if (revokeDuringResolution && !executableResolved) {
        if (path.basename(file) === "availability.json")
          return JSON.stringify({ id: "stub-confirmation", confirmedAt: Date.now() });
        if (path.basename(file) === "permit.json")
          return JSON.stringify({ token: "stub-token", availabilityId: "stub-confirmation", expiresAt: Date.now() + 10000 });
      }
      throw Object.assign(Error("synthetic missing state"), { code: "ENOENT" });
    }
    return read(file, ...args);
  };
  syncBuiltinESMExports();
`);

for (const [name, args] of launchers) {
  test(`${name} refuses a launch without a desktop permit`, {
    skip: process.platform !== "win32",
  }, () => {
    const env = { ...process.env, AERYNTH_OUTPUT_ONLY_DOM_QA: "1" };
    delete env.AERYNTH_STUB_REVOKE_DURING_RESOLUTION;
    delete env.AERYNTH_NATIVE_TEST_SLOT;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(process.execPath, ["--import", forbidChildren, ...args], {
      cwd: appRoot, env, windowsHide: true, shell: false, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1, child.stdout + child.stderr);
    assert.doesNotMatch(child.stdout + child.stderr, /unexpected_child_launch|unexpected_admission_directory|unexpected_electron_resolution/);
    assert.match(child.stderr, /stub_admission_read:gaming\.json/);
    assert.match(child.stderr, /stub_admission_read:availability\.json/);
    assert.match(child.stdout + child.stderr, /native_test_desktop_availability_unconfirmed/);
  });
}

test("prototype preflight rechecks the same directory after executable resolution", {
  skip: process.platform !== "win32",
}, () => {
  const env = { ...process.env, AERYNTH_STUB_REVOKE_DURING_RESOLUTION: "1", AERYNTH_NATIVE_TEST_SLOT: "stub-token" };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(process.execPath, ["--import", forbidChildren, "native/launch-native-test.cjs", "verify"], {
    cwd: appRoot, env, windowsHide: true, shell: false, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.deepEqual(child.stderr.trim().split(/\r?\n/), [
    "stub_admission_read:gaming.json",
    "stub_admission_read:availability.json",
    "stub_admission_read:permit.json",
    "stub_admission_read:gaming.json",
    "stub_admission_read:availability.json",
    "native_test_desktop_availability_unconfirmed",
  ]);
});
