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
  import { syncBuiltinESMExports } from "node:module";
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[method] = () => { throw Error("unexpected_child_launch"); };
  }
  syncBuiltinESMExports();
`);

for (const [name, args] of launchers) {
  test(`${name} refuses a launch without a desktop permit`, {
    skip: process.platform !== "win32",
  }, () => {
    const env = { ...process.env, AERYNTH_OUTPUT_ONLY_DOM_QA: "1" };
    delete env.AERYNTH_NATIVE_TEST_SLOT;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(process.execPath, ["--import", forbidChildren, ...args], {
      cwd: appRoot, env, windowsHide: true, shell: false, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1, child.stdout + child.stderr);
    assert.doesNotMatch(child.stdout + child.stderr, /unexpected_child_launch/);
    assert.match(child.stdout + child.stderr,
      /native_test_desktop_(availability_unconfirmed|slot_closed|gaming|state_unreadable)/);
  });
}
