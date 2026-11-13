const { lstatSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");
const { createAdmission, desktopDirectory } = require("./native-test-admission.cjs");
const { artifactDigest, digest } = require("./memory-fixture-entry.cjs");
const { superviseMemoryInspectorExecutable } = require("./memory-fixture-supervisor.cjs");

// Match the reviewed portable package's retained Electron vendor inventory.
// Its packaged normal entry must never be invoked by this fixture runner.
function reviewedElectron({ manifestPath, manifestSha256, check }) {
  const fail = () => { throw Error("memory_fixture_electron_unverified"); };
  if (!isAbsolute(manifestPath) || realpathSync(manifestPath) !== manifestPath) fail();
  const info = lstatSync(manifestPath);
  if (!info.isFile() || info.nlink !== 1 || info.size > 2 ** 21) fail();
  const bytes = readFileSync(manifestPath);
  if (digest(bytes) !== manifestSha256) fail();
  const manifest = JSON.parse(bytes);
  if (manifest.contract !== "aerynth.portable-review@1" || manifest.complete !== true ||
      manifest.runtimes?.platform !== "win32" || manifest.runtimes?.arch !== "x64" ||
      !Array.isArray(manifest.files) || manifest.files.length > 4096) fail();
  const root = dirname(manifestPath);
  const entries = manifest.files.filter(file => file.origin?.startsWith("electron-runtime:"));
  const seen = new Set();
  for (const file of entries) {
    check();
    const name = file.origin.slice("electron-runtime:".length);
    const path = resolve(root, file.path);
    const rel = relative(root, path);
    if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel) ||
        file.path !== (name === "electron.exe" ? "AerynthReview.exe" : name) ||
        seen.has(name) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 ||
        lstatSync(path).size !== file.bytes || artifactDigest(path, check) !== file.sha256) fail();
    seen.add(name);
  }
  const binary = entries.find(file => file.origin === "electron-runtime:electron.exe");
  if (binary?.path !== "AerynthReview.exe") fail();
  return resolve(root, binary.path);
}

async function waitForExit(exit, ms) {
  let timer;
  try { return await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
}

// No spawn default. A reviewed, fixture-specific process implementation is
// required because the portable review binary selects the normal app package.
function runMemoryInspectorProcess({
  allocation, profileRoot, artifactPath, token, allowWrite, electronReceipt, launchFixture,
  locateDesktop = desktopDirectory, openAdmission = createAdmission, now = Date.now, shutdownMs = 1000,
  runMs = 45_000,
}) {
  if (typeof launchFixture !== "function") throw Error("memory_fixture_process_launcher_unavailable");
  const directory = locateDesktop();
  if (!directory) throw Error("native_test_desktop_slot_requires_windows");
  const admission = openAdmission(directory);
  const check = () => admission.checkPermit(token);
  check();
  const executable = reviewedElectron({ ...electronReceipt, check });
  return superviseMemoryInspectorExecutable({
    allocation, profileRoot, artifactPath, token, allowWrite, locateDesktop, openAdmission, now,
    async startFixture({ env, ...handoff }) {
      if (reviewedElectron({ ...electronReceipt, check }) !== executable)
        throw Error("memory_fixture_electron_unverified");
      check();
      const child = launchFixture(executable, [handoff.entryPath], {
        windowsHide: true, shell: false,
        env: { ...env, AERYNTH_MEMORY_FIXTURE_HANDOFF: JSON.stringify(handoff) },
      });
      const exit = child.exit.then(result => result, () => undefined);
      const result = await waitForExit(exit, Math.max(0, Math.min(runMs, handoff.expiresAt - now())));
      if (result && admission.status().lease === null) return result;
      if (!result) {
        try { child.terminate(); } catch { /* Await the authoritative exit record. */ }
        const stopped = await waitForExit(exit, shutdownMs);
        if (stopped && admission.status().lease === null) return stopped;
      }
      if (!admission.status().lease && Number.isSafeInteger(child.pid) && child.pid > 0) {
        try { admission.claim(token, child.pid); } catch { /* Existing or revoked admission stays authoritative. */ }
      }
      if (allowWrite() === true) writeFileSync(join(profileRoot, "synthetic-launch-unresolved.json"),
        JSON.stringify({ childPid: child.pid ?? null, ownerPid: process.pid }), { flag: "wx", mode: 0o600 });
      throw Error("memory_fixture_process_outcome_unresolved");
    },
  });
}

module.exports = { runMemoryInspectorProcess };
