import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { electronRuntimeFile } from "./review-build.mjs";
import runner from "../prototypes/visual-experience/cinematic-v3/native/memory-inspector-process-runner.cjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function fixtureBootstrap(entry) {
  return `"use strict";
const { createHash } = require("node:crypto");
const { readFileSync, realpathSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { userInfo } = require("node:os");
const { spawnSync } = require("node:child_process");
const { app } = require("electron");
try {
  const raw = process.env.AERYNTH_MEMORY_FIXTURE_HANDOFF;
  if (!raw || Buffer.byteLength(raw) > 8192 || !process.env.AERYNTH_NATIVE_TEST_SLOT) throw Error();
  const handoff = JSON.parse(raw);
  const root = dirname(handoff.artifactPath);
  const expectedEntry = join(root, ${JSON.stringify(entry)});
  if (handoff.entryPath !== expectedEntry || realpathSync(expectedEntry) !== expectedEntry) throw Error();
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const manifest = readFileSync(handoff.artifactPath);
  if (manifest.length > 1048576 || hash(manifest) !== handoff.artifactSha256) throw Error();
  const inventory = JSON.parse(manifest);
  if (inventory.contract !== "aerynth.memory-inspector-artifact@1") throw Error();
  // Check the native JS closure before loading any artifact code.
  for (const file of inventory.files.filter(file => file.path.endsWith(".cjs"))) {
    if (!file.path.split("/").every(part => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..")) throw Error();
    const path = join(root, file.path);
    if (realpathSync(path) !== path || hash(readFileSync(path)) !== file.sha256) throw Error();
  }
  if (!inventory.files.some(file => file.path === ${JSON.stringify(entry)})) throw Error();
  const allowWrite = () => {
    const drive = handoff.profileRoot.slice(0, 2).toUpperCase();
    if (!["C:", "D:"].includes(drive) || !process.env.SystemRoot) return false;
    const guard = join(userInfo().homedir, "AppData/Local/AeroStorageWatch/ReserveGuard.ps1");
    const ps = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-File", guard,
      "-EstimatedCBytes", drive === "C:" ? "268435456" : "0",
      "-EstimatedDBytes", drive === "D:" ? "268435456" : "0"],
      { windowsHide: true, timeout: 3000, maxBuffer: 8192, encoding: "utf8" });
    try { return result.status === 0 && JSON.parse(result.stdout).allowed === true; }
    catch { return false; }
  };
  void require(expectedEntry).consumeMemoryInspectorHandoff({
    env: process.env, electron: require("electron"), allowWrite,
  }).catch(() => app.exit(2));
} catch { app.exit(2); }
`;
}

export async function buildMemoryInspectorElectronLayout({ reviewManifest, reviewSha256, output, entry, admit }) {
  if (!/^[a-z0-9_./-]+\.cjs$/iu.test(entry) || entry.split("/").some(part => !part || part === "." || part === ".."))
    throw Error("memory_fixture_entry_mismatch");
  const binary = runner.reviewedElectron({ manifestPath: reviewManifest, manifestSha256: reviewSha256, check() {} });
  const reviewBytes = await readFile(reviewManifest);
  if (sha(reviewBytes) !== reviewSha256) throw Error("memory_fixture_electron_unverified");
  const review = JSON.parse(reviewBytes);
  const files = review.files.filter(file => file.origin.startsWith("electron-runtime:"));
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > 512 * 1024 ** 2 || !files.every(file => electronRuntimeFile(file.origin.slice("electron-runtime:".length))))
    throw Error("memory_fixture_electron_capacity");
  if (admit(total + 1024 ** 2) !== true) throw Error("storage_reserve_admission_denied");
  await mkdir(output);
  for (const file of files) {
    const target = join(output, file.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(dirname(binary), file.path), target, constants.COPYFILE_EXCL);
  }
  for (const [path, content] of [
    ["resources/app/package.json", JSON.stringify({ name: "aerynth-memory-inspector-fixture", private: true, main: "fixture-bootstrap.cjs" })],
    ["resources/app/fixture-bootstrap.cjs", fixtureBootstrap(entry)],
  ]) {
    const target = join(output, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
    files.push({ path, origin: "fixture-bootstrap:" + path, bytes: Buffer.byteLength(content), sha256: sha(content) });
  }
  const manifest = JSON.stringify({ contract: "aerynth.memory-inspector-electron@1", complete: true,
    runtimes: review.runtimes, reviewSha256, files }, null, 2) + "\n";
  const manifestPath = join(output, "manifest.json");
  const manifestSha256 = sha(manifest);
  await writeFile(manifestPath, manifest, { flag: "wx" });
  runner.reviewedElectron({ manifestPath, manifestSha256, check() {} });
  return { manifestPath, manifestSha256, files: files.length, runtimeBytes: total };
}
