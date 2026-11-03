import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../src/core.mts";
import type {
  ProviderPort,
  VelaBackendState,
  VelaOperation,
} from "../src/contracts.mts";
import type { VelaRequest } from "../../vela-core/src/contracts.ts";
import { planningDigest } from "../../vela-core/src/codex-planning-adapter.mts";
import { admitVelaFileEdit, parseVelaFileEdit, upgradeVelaFileEdit } from "../src/vela-file-edit.mts";

test("Check my logs, fix the code, and keep the original file until I approve", {
  skip: process.platform !== "win32",
}, async () => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  admitVelaFileEdit(runtime);
  mkdirSync(runtime, { recursive: true });
  const dir = mkdtempSync(join(runtime, "vela-file-edit-"));
  const file = join(dir, "sample.json"), alias = join(dir, "linked.json");
  const f = fixture(false, "air-file-edit", false);
  const git = (...args: string[]) => execFileSync("git.exe", ["-C", dir, "-c", "core.hooksPath=NUL", ...args], { windowsHide: true, timeout: 6000, stdio: "pipe" });
  try {
    git("init", "--quiet", "--template=");
    writeFileSync(file, '{"count":1}\n');
    git("add", "--", "sample.json");
    git("-c", "user.name=AIR fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
    const intent = "Edit sample.json to set the count to two";
    const input = { intent, resourceIds: [], adaptive: true as const };
    await assert.rejects(f.core.command("velaRequestPreview", input), /vela_codex_edit_target_required/);
    linkSync(file, alias);
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editTargetPaths: [file] }), /vela_edit_file_ineligible/);
    rmSync(alias);
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editTargetPaths: [f.path] }), /vela_edit_path_ineligible|vela_edit_file_ineligible/);
    const logIntent = "Inspect the logs, find the stutter, fix the code, and run the benchmark";
    const logBody = "Synthetic frame 123 took 80 ms after config count changed";
    const proposal = async (logId?: string) => {
      const preview = await f.core.command("velaRequestPreview", { ...input,
        ...(logId ? { intent: logIntent, resourceIds: [logId] } : {}), editTargetPaths: [file] });
      assert.equal(preview.route?.kind, "file-edit");
      if (logId && preview.route?.kind === "file-edit") {
        assert.equal(preview.route.inspectSelectedLogs, true);
        assert.equal(preview.route.followUpCheck, "node-benchmark");
      }
      const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
      assert.deepEqual(native.editPaths, [file]);
      assert.equal(native.workingDirectory, dir);
      assert(!native.prompt.includes(dir));
      assert.match(native.prompt, /Do not write, run tests/u);
      if (logId) assert(native.prompt.includes(logBody));
      await assert.rejects(f.core.command("authorizeVelaRequest", {
        previewId: preview.id, signature: preview.signature, reviewDigest: native.reviewDigest, directSend: true,
      }), /vela_attached_context_review_required/);
      return f.vela("request", await f.approve({ preview, native })) as Promise<VelaRequest>;
    };
    const first = await proposal();
    assert.equal(first.state, "responded", first.errorCode);
    assert.equal(readFileSync(file, "utf8"), '{"count":1}\n');
    const stale = await f.core.command("velaFileEditReview", { requestId: first.id });
    writeFileSync(file, '{"count":3}\n');
    await assert.rejects(f.core.command("velaFileEditApply", { requestId: first.id, reviewId: stale.reviewId }), /vela_edit_file_changed/);
    assert.equal(readFileSync(file, "utf8"), '{"count":3}\n');
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, intent: logIntent, editTargetPaths: [file] }), /vela_edit_log_source_required/);
    const workspace = await f.core.command("desktop", { type: "createWorkspace", title: "Synthetic log review", projectId: null });
    const notes = await f.core.command("desktop", { type: "createResource", kind: "note", title: "Frame timing excerpt", workspaceId: workspace.activeWorkspaceId! });
    const log = notes.resources.find(resource => resource.title === "Frame timing excerpt")!;
    await f.core.command("desktop", { type: "content", resourceId: log.id, expectedVersion: log.version, content: logBody });
    const second = await proposal(log.id);
    await assert.rejects(f.core.command("velaFileEditApply", { requestId: second.id, reviewId: stale.reviewId }), /vela_edit_review_required/);
    await f.reopen();
    const review = await f.core.command("velaFileEditReview", { requestId: second.id });
    assert.equal(review.files[0].before, '{"count":3}\n');
    assert.equal(review.files[0].after, '{"count":2}\n');
    const applied = await f.core.command("velaFileEditApply", { requestId: second.id, reviewId: review.reviewId });
    assert.equal(applied.state, "applied");
    assert.equal(applied.followUpCheck, "node-benchmark");
    assert.equal(applied.files[0].verification, "bytes-and-json-syntax");
    assert.equal(readFileSync(file, "utf8"), '{"count":2}\n');
    assert.equal(readFileSync(applied.files[0].backupPath!, "utf8"), '{"count":3}\n');
    assert.equal((await f.state()).fileEdits?.find(edit => edit.requestId === second.id)?.state, "applied");
    await assert.rejects(f.core.command("velaFileEditApply", { requestId: second.id, reviewId: review.reviewId }), /vela_edit_review_required/);
    const edits = (f.core as any).state.vela.edits;
    // Simulate losing the final SQLite receipt after the external replacement.
    (f.core as any).atomic(() => { edits[second.id].state = "applying"; delete edits[second.id].files[0].verification; });
    await f.reopen();
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editTargetPaths: [file] }), /vela_edit_reconciliation_required/);
    const recovered = await f.vela("reconcileFileEdit", { requestId: second.id });
    assert.equal((recovered as typeof applied).files[0].verification, "bytes-and-json-syntax");
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
  } finally {
    await f.close();
    const canonical = realpathSync(dir);
    assert.equal(dirname(canonical), realpathSync(runtime));
    assert(relative(runtime, canonical).startsWith("vela-file-edit-"));
    rmSync(canonical, { recursive: true, force: true });
  }
});

test("AIR batch parser permits an exact selected subset and rejects duplicates or new destinations", () => {
  const targets = ["sample.json", "second.json"].map(relativePath => ({
    relativePath, path: "C:\\synthetic\\" + relativePath, root: "C:\\synthetic",
    head: "a".repeat(40), beforeDigest: "b".repeat(64), identity: "synthetic",
  }));
  const output = (paths: string[]) => JSON.stringify({ summary: "Fixture", files: paths.map(path => ({ path, replacement: "{}" })) });
  assert.deepEqual(parseVelaFileEdit(output(["second.json", "sample.json"]), targets).map(edit => edit.target.relativePath), ["sample.json", "second.json"]);
  assert.equal(parseVelaFileEdit(output(["second.json"]), targets).length, 1);
  assert.throws(() => parseVelaFileEdit(output(["sample.json", "sample.json"]), targets), /vela_edit_invalid_proposal/);
  assert.throws(() => parseVelaFileEdit(output(["../second.json"]), targets), /vela_edit_invalid_proposal/);
  const legacy = upgradeVelaFileEdit({ requestId: "fixture", executionId: "fixture", outputMessageId: "fixture",
    scopeStamp: "fixture", target: targets[0], afterDigest: "c".repeat(64), state: "awaiting-review" });
  assert.equal(legacy.legacySingleOutput, true);
  assert.equal(legacy.files[0].state, "pending");
  assert.equal(parseVelaFileEdit('{"summary":"Fixture","replacement":"{}"}', [legacy.files[0].target], true)[0].replacement, "{}");
});

test("Edit this file, create the other one, and run the tests", {
  skip: process.platform !== "win32",
}, async () => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  admitVelaFileEdit(runtime);
  mkdirSync(runtime, { recursive: true });
  const dir = mkdtempSync(join(runtime, "vela-file-edit-"));
  const original = join(dir, "sample.json"), created = join(dir, "created.json");
  const f = fixture(false, "air-file-edit", false);
  const git = (...args: string[]) => execFileSync("git.exe", ["-C", dir, "-c", "core.hooksPath=NUL", ...args],
    { windowsHide: true, timeout: 6000, stdio: "pipe" });
  const input = { intent: "Create created.json with a count of two", resourceIds: [], adaptive: true as const };
  const editCreatePaths = [created];
  const approvedBytes = '{"count":2}\n';
  const testFile = join(dir, "sample.test.mjs"), failureFile = join(dir, "failure.test.mjs");
  const testBody = `import test from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';\n` +
    `test('checks the created file', () => assert.equal(JSON.parse(readFileSync('created.json','utf8')).count, 2));\n`;
  try {
    git("init", "--quiet", "--template=");
    writeFileSync(original, '{"count":1}\n');
    writeFileSync(join(dir, ".gitignore"), "ignored.json\n");
    writeFileSync(join(dir, "tracked.json"), "{}");
    writeFileSync(testFile, testBody);
    writeFileSync(failureFile, testBody.replace("count, 2", "count, 3"));
    const benchPath = join(dir, "sample.bench.mjs");
    writeFileSync(benchPath, `import { readFileSync } from 'node:fs';
const times = Array.from({ length: 12 }, () => {
  const start = performance.now();
  if (JSON.parse(readFileSync('created.json', 'utf8')).count !== 2) throw Error('Wrong count');
  return performance.now() - start;
}).sort((a, b) => a - b);
console.log(JSON.stringify({ samples: times.length, medianMs: times[5], p95Ms: times[11] }));
`);
    git("add", "--", "sample.json", "tracked.json", ".gitignore", "sample.test.mjs", "failure.test.mjs", "sample.bench.mjs");
    git("-c", "user.name=AIR fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
    rmSync(join(dir, "tracked.json"));
    await assert.rejects(f.core.command("velaRequestPreview", input), /vela_codex_create_target_required/);
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editCreatePaths: [join(dir, "TRACKED.json")] }),
      /vela_edit_destination_tracked/);
    git("add", "-u", "--", "tracked.json");
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editCreatePaths: [join(dir, "TRACKED.json")] }),
      /vela_edit_destination_tracked/);
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editCreatePaths: [join(dir, "ignored.json")] }),
      /vela_edit_destination_ignored/);
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editCreatePaths: [original] }), /vela_edit_destination_exists/);
    const propose = async (mixed: boolean) => {
      const selected = mixed ? { ...input, intent: "Edit sample.json, create created.json, and run the tests", editTargetPaths: [original] } : input;
      if (mixed) await assert.rejects(f.core.command("velaRequestPreview", selected), /vela_codex_mixed_targets_required/);
      const preview = await f.core.command("velaRequestPreview", { ...selected, editCreatePaths });
      assert.equal(preview.route?.reason, "reviewed-file-creation");
      assert.equal(preview.route?.kind === "file-edit" && preview.route.followUpCheck, mixed ? "node-test" : undefined);
      const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
      assert.deepEqual(native.editPaths, mixed ? [original, created] : [created]);
      assert(!native.prompt.includes(dir));
      assert.match(native.prompt, /"path":"created.json","operation":"create","content":null/u);
      const request = await f.vela("request", await f.approve({ preview, native })) as VelaRequest;
      assert.equal(request.state, "responded", request.errorCode);
      assert.equal(existsSync(created), false);
      const review = await f.core.command("velaFileEditReview", { requestId: request.id });
      assert.deepEqual(review.files.map(file => file.before), mixed ? ['{"count":1}\n', null] : [null]);
      assert.equal(review.files.at(-1)?.beforeDigest, null);
      return { requestId: request.id, reviewId: review.reviewId };
    };
    const stale = await propose(false);
    writeFileSync(created, approvedBytes, { flag: "wx" });
    await assert.rejects(f.core.command("velaFileEditApply", stale), /vela_edit_destination_exists/);
    assert.equal(readFileSync(created, "utf8"), approvedBytes);
    rmSync(created);
    const mixed = await propose(true);
    const applied = await f.core.command("velaFileEditApply", mixed);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.files.map(file => file.verification), ["bytes-and-json-syntax", "bytes-and-json-syntax"]);
    assert.equal(applied.files[1].backupPath, undefined);
    assert.equal(readFileSync(created, "utf8"), approvedBytes);
    assert.equal(readFileSync(applied.files[0].backupPath!, "utf8"), '{"count":1}\n');
    assert.equal(applied.projectChecksAvailable, true);
    assert.equal(applied.followUpCheck, "node-test");
    assert.equal(applied.projectChecks, undefined);
    const inferenceBeforeChecks = (await f.core.command("providerActivity", {})).providerRequests;
    const reviewCheck = (path: string) => f.core.command("velaProjectCheckReview", {
      requestId: mixed.requestId, kind: "node-test", paths: [path],
    });
    await assert.rejects(reviewCheck(original), /vela_project_check_invalid_input/);
    await assert.rejects(f.core.command("velaProjectCheckRun", { requestId: mixed.requestId, reviewId: "forged" }), /vela_project_check_review_required/);
    const staleCheck = await reviewCheck(testFile);
    writeFileSync(testFile, testBody + "// stale after review\n");
    await assert.rejects(f.core.command("velaProjectCheckRun", staleCheck), /vela_project_check_stale/);
    writeFileSync(testFile, testBody);
    const failingCheck = await reviewCheck(failureFile);
    const failed = await f.core.command("velaProjectCheckRun", failingCheck);
    assert.equal(failed.projectChecks?.[0].state, "failed");
    assert.equal(failed.projectChecks?.[0].exitCode, 1);
    const freshCheck = await reviewCheck(testFile);
    assert.deepEqual(freshCheck.argv.slice(-2), ["--", "./sample.test.mjs"]);
    const checked = await f.core.command("velaProjectCheckRun", freshCheck);
    assert.deepEqual(checked.projectChecks?.map(check => [check.state, check.testCount, check.exitCode]), [["passed", 1, 0]]);
    assert.equal(checked.projectChecks?.[0].inputs[0], "sample.test.mjs");
    assert.match(checked.projectChecks?.[0].sourceHead ?? "", /^[a-f0-9]{40,64}$/u);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, inferenceBeforeChecks);
    await assert.rejects(f.core.command("velaProjectCheckRun", freshCheck), /vela_project_check_review_required/);
    const bench = await f.core.command("velaProjectCheckReview", { requestId: mixed.requestId, kind: "node-benchmark", paths: [benchPath] });
    assert.deepEqual(bench.argv.slice(-2), ["--", "./sample.bench.mjs"]);
    const benchmarked = await f.core.command("velaProjectCheckRun", bench);
    const observation = benchmarked.projectChecks?.find(check => check.kind === "node-benchmark");
    assert.equal(observation?.state, "passed");
    assert.equal(observation?.benchmark?.samples, 12);
    assert(observation!.benchmark!.p95Ms >= observation!.benchmark!.medianMs);
    // Lose the final receipt while retaining the pre-publication file identities.
    (f.core as any).atomic(() => { (f.core as any).state.vela.edits[mixed.requestId].state = "applying"; });
    await f.reopen();
    assert.deepEqual(await f.vela("reconcileFileEdit", { requestId: mixed.requestId }), benchmarked);
    // Keep the published object alive under a different name to avoid inode reuse.
    linkSync(created, join(dir, "moved.json"));
    rmSync(created);
    writeFileSync(created, approvedBytes, { flag: "wx" });
    (f.core as any).atomic(() => { (f.core as any).state.vela.edits[mixed.requestId].state = "applying"; });
    const conflict = await f.vela("reconcileFileEdit", { requestId: mixed.requestId }) as typeof applied;
    assert.equal(conflict.state, "partial");
    assert.equal(conflict.files[1].state, "conflict");
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
  } finally {
    await f.close();
    const canonical = realpathSync(dir);
    assert.equal(dirname(canonical), realpathSync(runtime));
    assert(relative(runtime, canonical).startsWith("vela-file-edit-"));
    rmSync(canonical, { recursive: true, force: true });
  }
});

test("AIR file batch detects a stale later file and reports an actual partial write across restart", {
  skip: process.platform !== "win32",
}, async () => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  admitVelaFileEdit(runtime);
  mkdirSync(runtime, { recursive: true });
  const dir = mkdtempSync(join(runtime, "vela-file-edit-"));
  const names = ["sample.json", "second.json", "third.json"], paths = names.map(name => join(dir, name));
  const f = fixture(false, "air-file-edit", false);
  let lock: ReturnType<typeof spawn> | undefined;
  const git = (...args: string[]) => execFileSync("git.exe", ["-C", dir, "-c", "core.hooksPath=NUL", ...args], { windowsHide: true, timeout: 6000, stdio: "pipe" });
  try {
    git("init", "--quiet", "--template=");
    for (const file of paths) writeFileSync(file, '{"count":1}\n');
    git("add", "--", ...names);
    git("-c", "user.name=AIR fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
    const input = { intent: "Edit the source files to set the counts to two", resourceIds: [], adaptive: true as const, editTargetPaths: paths };
    const proposal = async (editTargetPaths = paths) => {
      const preview = await f.core.command("velaRequestPreview", { ...input, editTargetPaths });
      const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
      assert.deepEqual(native.editPaths, editTargetPaths);
      const request = await f.vela("request", await f.approve({ preview, native })) as VelaRequest;
      assert.equal(request.state, "responded", request.errorCode);
      return f.core.command("velaFileEditReview", { requestId: request.id });
    };
    await assert.rejects(f.core.command("velaRequestPreview", { ...input, editTargetPaths: [paths[0], paths[0]] }), /vela_edit_repository_mismatch/);
    const stale = await proposal();
    writeFileSync(paths[2], '{"count":3}\n');
    await assert.rejects(f.core.command("velaFileEditApply", { requestId: stale.requestId, reviewId: stale.reviewId }), /vela_edit_file_changed/);
    assert.equal(readFileSync(paths[0], "utf8"), '{"count":1}\n');
    assert.equal(readFileSync(paths[1], "utf8"), '{"count":1}\n');
    const review = await proposal();
    assert.deepEqual(review.files.map(file => file.path), paths);
    lock = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; $f=[IO.File]::Open($env:VELA_FIXTURE_LOCK_PATH,'Open','Read','Read'); [Console]::WriteLine('locked'); try { [void][Console]::ReadLine() } finally { $f.Dispose() }"],
      { windowsHide: true, env: { ...process.env, VELA_FIXTURE_LOCK_PATH: paths[1] } });
    const lockTimeout = AbortSignal.timeout(5000);
    const [message] = await once(lock.stdout!, "data", { signal: lockTimeout });
    assert.match(String(message), /locked/);
    const applied = await f.core.command("velaFileEditApply", { requestId: review.requestId, reviewId: review.reviewId });
    assert.equal(applied.state, "partial");
    assert.deepEqual(applied.files.map(file => file.state), ["applied", "unchanged", "unchanged"]);
    assert.equal(readFileSync(paths[0], "utf8"), '{"count":2}\n');
    assert.equal(readFileSync(applied.files[0].backupPath!, "utf8"), '{"count":1}\n');
    assert.equal(readFileSync(paths[1], "utf8"), '{"count":1}\n');
    assert.equal(readFileSync(paths[2], "utf8"), '{"count":3}\n');
    lock.stdin!.end();
    await once(lock, "exit", { signal: AbortSignal.timeout(5000) });
    await f.reopen();
    assert.deepEqual(await f.vela("reconcileFileEdit", { requestId: review.requestId }), applied);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
    const next = await proposal(paths.slice(1));
    const finished = await f.core.command("velaFileEditApply", { requestId: next.requestId, reviewId: next.reviewId });
    assert.equal(finished.state, "applied");
    assert.deepEqual(finished.files.map(file => file.verification), ["bytes-and-json-syntax", "bytes-and-json-syntax"]);
    assert.equal(readFileSync(finished.files[0].backupPath!, "utf8"), '{"count":1}\n');
    assert.equal(readFileSync(finished.files[1].backupPath!, "utf8"), '{"count":3}\n');
    assert(paths.every(path => readFileSync(path, "utf8") === '{"count":2}\n'));
  } finally {
    if (lock?.exitCode === null && lock.signalCode === null) {
      const exit = once(lock, "exit", { signal: AbortSignal.timeout(5000) });
      lock.kill();
      await exit;
    }
    await f.close();
    const canonical = realpathSync(dir);
    assert.equal(dirname(canonical), realpathSync(runtime));
    assert(relative(runtime, canonical).startsWith("vela-file-edit-"));
    rmSync(canonical, { recursive: true, force: true });
  }
});

test("Run the tests and build a file I can review before saving", {
  skip: process.platform !== "win32",
}, async () => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  admitVelaFileEdit(runtime);
  mkdirSync(runtime, { recursive: true });
  const dir = mkdtempSync(join(runtime, "vela-file-edit-"));
  const path = join(dir, "standalone.test.mjs");
  const build = join(dir, "sample.build.mjs"), artifact = join(dir, "generated.json");
  const body = "import test from 'node:test'; import assert from 'node:assert/strict'; test('fixture', () => assert.equal(6 * 7, 42));\n";
  const f = fixture(false, "air-file-edit", false);
  const git = (...args: string[]) => execFileSync("git.exe", ["-C", dir, "-c", "core.hooksPath=NUL", ...args],
    { windowsHide: true, timeout: 6000, stdio: "pipe" });
  const intent = "Run the Node tests in this repository";
  try {
    git("init", "--quiet", "--template=");
    writeFileSync(path, body);
    writeFileSync(build, "process.stdout.write(JSON.stringify({ sum: [6, 7].reduce((sum, n) => sum + n, 0) }) + '\\n');\n");
    git("add", "--", "standalone.test.mjs", "sample.build.mjs");
    git("-c", "user.name=AIR fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
    assert.deepEqual(await f.core.command("velaRouteNative", { intent }), { matched: false, projectCheck: "node-test" });
    await assert.rejects(f.core.command("velaRouteNative", { intent, settings: { providerId: "chatgpt-plan-responses" } }),
      /vela_pinned_provider_cannot_execute/);
    await assert.rejects(f.core.command("velaRouteNative", { intent, settings: { model: "fixture-model" } }),
      /vela_project_check_model_pin/);
    await assert.rejects(f.core.command("velaRequestPreview", { intent, resourceIds: ["attached-note"], adaptive: true }),
      /vela_project_check_attached_sources/);
    await assert.rejects(f.core.command("velaStandaloneCheckRun", { reviewId: "forged" }), /vela_project_check_review_required/);
    const review = () => f.core.command("velaStandaloneCheckReview", { intent, paths: [path], settings: { mode: "codex", budgetLimit: 0 } });
    const stale = await review();
    assert.equal(stale.requestId, null);
    assert.equal((await f.state()).requests.length, 0);
    writeFileSync(path, body + "// changed after review\n");
    await assert.rejects(f.core.command("velaStandaloneCheckRun", { reviewId: stale.reviewId }), /vela_project_check_stale/);
    assert.equal((await f.state()).requests.length, 0);
    writeFileSync(path, body);
    const approved = await review();
    const runner = (f.core as any).port.projectChecks as NonNullable<ProviderPort["projectChecks"]>;
    const execute = runner.execute;
    let markStarted!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    runner.execute = async (command, cwd) => {
      markStarted();
      await released;
      return execute(command, cwd);
    };
    const running = f.core.command("velaStandaloneCheckRun", { reviewId: approved.reviewId });
    try {
      await Promise.race([started, running]);
      const pending = (await f.state()).requests[0];
      assert.equal(pending.state, "checking");
      assert.equal(pending.projectCheck?.state, "running");
      await assert.rejects(f.vela("cancel", pending.id), /vela_project_check_wait_for_result/);
      await assert.rejects(review(), /vela_project_check_busy/);
    } finally { release(); }
    const result = await running;
    assert.equal(result.state, "responded");
    assert.equal(result.providerId, null);
    assert.equal(result.route?.kind, "project-check");
    assert.equal(result.routingSettings?.effective.mode, "codex");
    assert.equal(result.projectCheck?.state, "passed");
    assert.equal(result.projectCheck?.testCount, 1);
    assert.deepEqual(result.projectCheck?.inputs, ["standalone.test.mjs"]);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
    await assert.rejects(f.core.command("velaStandaloneCheckRun", { reviewId: approved.reviewId }), /vela_project_check_review_required/);
    await f.reopen();
    const reopened = await f.state();
    assert.equal(reopened.fileEdits?.length ?? 0, 0);
    assert.deepEqual(reopened.requests[0].projectCheck, result.projectCheck);
    const response = reopened.conversation?.messages.find(message => message.id === result.response?.messageId);
    assert.equal(response?.source, "vela-native");
    assert.equal(response?.classification, "observed");
    assert.match(response?.content ?? "", /Node tests passed/u);
    // Reopen after a committed dispatch marker with no terminal observation.
    const interrupted = (f.core as any).vela.beginProjectCheck(intent, {
      id: randomUUID(), kind: "node-test", state: "running", inputs: result.projectCheck?.inputs,
      sourceHead: result.projectCheck?.sourceHead, inputDigest: result.projectCheck?.inputDigest,
      startedAt: new Date().toISOString(),
    }, result.routingSettings) as VelaRequest;
    await f.reopen();
    const restored = (await f.state()).requests.find(request => request.id === interrupted.id);
    assert.equal(restored?.state, "unknown");
    assert.equal(restored?.projectCheck?.state, "unknown");
    assert.equal(restored?.errorCode, "restart_project_check_outcome_unknown");
    const buildInput = { intent: "Build this project", paths: [build] };
    assert.deepEqual(await f.core.command("velaRouteNative", { intent: buildInput.intent }), { matched: false, projectCheck: "node-build" });
    await assert.rejects(f.core.command("velaStandaloneCheckReview", buildInput), /vela_build_destination_required/);
    const buildReview = await f.core.command("velaStandaloneCheckReview", { ...buildInput, artifactPath: artifact });
    assert.equal(buildReview.artifactPath, artifact);
    assert.deepEqual(buildReview.argv.slice(-2), ["--", "./sample.build.mjs"]);
    const generated = await f.core.command("velaStandaloneCheckRun", buildReview);
    assert.equal(generated.projectCheck?.state, "passed");
    assert.equal(generated.projectCheck?.artifact?.relativePath, "generated.json");
    assert.equal(existsSync(artifact), false);
    await f.reopen();
    const fileReview = await f.core.command("velaFileEditReview", { requestId: generated.id });
    assert.equal(fileReview.files[0].before, null);
    assert.equal(fileReview.files[0].after, '{"sum":13}\n');
    assert.equal(fileReview.files[0].afterDigest, generated.projectCheck?.artifact?.digest);
    writeFileSync(artifact, '{"external":true}\n', { flag: "wx" });
    await assert.rejects(f.core.command("velaFileEditApply", fileReview), /vela_edit_destination_exists/);
    assert.equal(readFileSync(artifact, "utf8"), '{"external":true}\n');
    rmSync(artifact);
    const revisedReview = await f.core.command("velaFileEditReview", { requestId: generated.id });
    assert.equal((await f.core.command("velaFileEditApply", revisedReview)).state, "applied");
    assert.equal(readFileSync(artifact, "utf8"), '{"sum":13}\n');
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
  } finally {
    await f.close();
    const canonical = realpathSync(dir);
    assert.equal(dirname(canonical), realpathSync(runtime));
    assert(relative(runtime, canonical).startsWith("vela-file-edit-"));
    rmSync(canonical, { recursive: true, force: true });
  }
});

test("AIR sends authorized inspection through native Codex protocol with discovered controls", async () => {
  const f = fixture(false, "air-inspection", false);
  try {
    const intent = "Inspect the repository logs for recent build errors";
    assert.deepEqual(await f.vela("routingOptions", { providerId: "codex-app-server" }),
      [{ id: "fixture-model", label: "fixture-model", reasoningEfforts: ["high"] }]);
    await assert.rejects(f.core.command("velaRequestPreview", {
      intent, resourceIds: [], adaptive: true, model: "hidden-fixture-model",
    }), /unsupported_model/);
    const preview = await f.core.command("velaRequestPreview", {
      intent, resourceIds: [], adaptive: true, model: "fixture-model", reasoningEffort: "high",
    });
    assert.deepEqual(preview.route, {
      kind: "agentic", reason: "local-tools-required", environment: "local-read-only",
      model: "fixture-model", effort: "high",
    });
    const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
    await assert.rejects(f.core.command("authorizeVelaRequest", {
      previewId: preview.id, signature: preview.signature, reviewDigest: native.reviewDigest, directSend: true,
    }), /vela_attached_context_review_required/);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
    const request = await f.vela("request", await f.approve({ preview, native })) as VelaRequest;
    assert.equal(request.state, "responded", request.errorCode);
    assert.equal(request.providerId, "codex-app-server");
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 1);
    const snapshot = await f.core.command("snapshot", {});
    const execution = Object.values(snapshot.executions).find(item => item.commandId === "vela-inspection:" + request.id);
    assert.equal(execution?.state, "provider_completed");
    assert.equal(execution?.taskVerified, false);
    const mixed = await f.core.command("velaRequestPreview", {
      intent: "Check CPU usage, then inspect the repository logs", resourceIds: [], adaptive: true,
      model: "fixture-model", reasoningEffort: "high", includeRecentHistory: true,
    });
    assert(mixed.route?.kind === "composite");
    assert.equal(mixed.route.metric, "system.cpu");
    const reviewed = await f.core.command("velaNativeReview", { previewId: mixed.id, signature: mixed.signature });
    assert.match(reviewed.prompt, /"nativeStage":\{.*CPU usage was [\d.]+%/u);
    assert.equal(reviewed.history?.messages.length, 2);
    const next = await f.vela("request", await f.approve({ preview: mixed, native: reviewed })) as VelaRequest;
    assert.equal(next.state, "responded", next.errorCode);
    assert.equal(next.conversationId, request.conversationId);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 2);
  } finally { await f.close(); }
});

test("Inspect the repository I picked and ask again if its revision changed", { skip: process.platform !== "win32" }, async () => {
  const runtime = fileURLToPath(new URL("../.runtime/", import.meta.url));
  admitVelaFileEdit(runtime);
  mkdirSync(runtime, { recursive: true });
  const root = realpathSync.native(mkdtempSync(join(runtime, "vela-air-inspection-")));
  const git = (...args: string[]) => execFileSync("git.exe", ["-C", root, "-c", "core.hooksPath=NUL", ...args],
    { windowsHide: true, timeout: 6000, stdio: "pipe" });
  const f = fixture(false, "air-inspection", false);
  const command = { intent: "Inspect the repository logs for errors", resourceIds: [], adaptive: true as const, requireInspectionDirectory: true as const };
  const commit = (title: string) => git("-c", "user.name=AIR fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", title);
  try {
    git("init", "--quiet", "--template=");
    commit("First synthetic revision");
    mkdirSync(join(root, "nested"));
    await assert.rejects(f.core.command("velaRequestPreview", command), /vela_codex_inspection_target_required/);
    await assert.rejects(f.core.command("velaRequestPreview", { ...command, inspectionDirectory: join(root, "nested") }), /vela_codex_inspection_target_unavailable/);
    const prepare = async () => {
      const preview = await f.core.command("velaRequestPreview", { ...command, inspectionDirectory: root });
      const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
      assert.equal(native.workingDirectory, root);
      assert.equal(preview.workingDirectory, root);
      return f.approve({ preview, native });
    };
    const stale = await prepare();
    commit("Second synthetic revision");
    const refused = await f.vela("request", stale) as VelaRequest;
    assert.notEqual(refused.state, "responded");
    assert.equal(refused.errorCode, "vela_codex_inspection_target_changed");
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
    const port = (f.core as any).port as ProviderPort;
    const open = port.open.bind(port);
    port.open = options => { assert.equal(options?.cwd, root); return open(options); };
    const accepted = await f.vela("request", await prepare()) as VelaRequest;
    assert.equal(accepted.state, "responded", accepted.errorCode);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 1);
  } finally { await f.close(); }
});

test("Can you check whether Codex finished without running it again?", async () => {
  const f = fixture(false, "air-inspection", false);
  try {
    const firstPort = (f.core as any).port as ProviderPort;
    const terminal = firstPort.terminal.bind(firstPort);
    firstPort.terminal = async (...args) => {
      await terminal(...args);
      throw Error("Simulated lost completion");
    };
    const preview = await f.core.command("velaRequestPreview", { intent: "Inspect the repository logs for build errors",
      resourceIds: [], adaptive: true, model: "fixture-model", reasoningEffort: "high" });
    const native = await f.core.command("velaNativeReview", { previewId: preview.id, signature: preview.signature });
    const request = await f.vela("request", await f.approve({ preview, native })) as VelaRequest;
    assert.equal(request.state, "unknown");
    const execution = Object.values((await f.core.command("snapshot", {})).executions)
      .find(item => item.commandId === "vela-inspection:" + request.id)!;
    assert(execution.binding && execution.turnId);
    await f.reopen();
    assert.deepEqual((await f.state()).recoverableProviderRequestIds, [request.id]);
    const port = (f.core as any).port as ProviderPort;
    const input = { requestId: request.id };
    port.recentTurns = async () => [{ id: "a different turn", status: "completed" }];
    assert.equal(await f.vela("reconcileProviderTurn", input), null);
    port.recentTurns = async threadId => {
      assert.equal(threadId, execution.binding!.nativeThreadId);
      return [{ id: execution.turnId, status: "completed" }];
    };
    const recovered = await f.vela("reconcileProviderTurn", input);
    const state = await f.state();
    const updated = state.requests.find(item => item.id === request.id)!;
    assert.deepEqual(updated.providerRecovery, recovered);
    assert.equal(updated.providerRecovery?.state, "provider_completed");
    assert.equal(updated.state, "unknown", "Provider status does not prove the task outcome");
    assert.equal(updated.response, undefined);
    assert.deepEqual(state.recoverableProviderRequestIds, []);
    assert.equal((await f.core.command("providerActivity", {})).providerRequests, 0);
    await f.reopen();
    assert.deepEqual((await f.state()).requests.find(item => item.id === request.id)?.providerRecovery, recovered);
    await assert.rejects(f.vela("reconcileProviderTurn", input), /vela_provider_recovery_unavailable/);
  } finally { await f.close(); }
});

/** Actual Core/SQLite with an explicit local stdio protocol double. No Codex/account/model connection. */
function fixture(history = true, mode = "answer-catalog", discovery = true) {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-frozen-history-")),
    path = join(dir, "canonical.sqlite");
  const options = {
    path,
    provider: "codex" as const,
    contentPolicy: "synthetic-only" as const,
    codexExecutable: process.execPath,
    codexArgs: [
      fileURLToPath(
        new URL("../../codex-bridge/tests/catalog-server.mjs", import.meta.url),
      ),
      mode,
    ],
    velaCatalogDiscovery: discovery,
    velaHistoryContext: history,
  };
  let core = new BackendCore(options),
    closed = false;
  const vela = (name: VelaOperation["name"], input: unknown = {}) =>
      core.command("vela", { name, input } as VelaOperation),
    state = () => vela("state") as Promise<VelaBackendState>;
  const review = async (
    intent = "Synthetic frozen history question",
    resourceIds: string[] = [],
  ) => {
    await core.command("capabilities", {});
    const preview = await core.command("velaRequestPreview", {
        intent,
        resourceIds,
      }),
      native = await core.command("velaNativeReview", {
        previewId: preview.id,
        signature: preview.signature,
      });
    return { preview, native };
  };
  const approve = async (value: Awaited<ReturnType<typeof review>>) => {
    const grant = await core.command("authorizeVelaRequest", {
      previewId: value.preview.id,
      signature: value.preview.signature,
      reviewDigest: value.native.reviewDigest,
    });
    return {
      intent: value.preview.intent,
      resourceIds: value.preview.resourceIds,
      authorizeProvider: true,
      previewId: value.preview.id,
      grantId: grant.grantId,
    };
  };
  return {
    get core() {
      return core;
    },
    path,
    options,
    vela,
    state,
    review,
    approve,
    db: () => (core as unknown as { db: DatabaseSync }).db,
    async ask(intent: string, resourceIds: string[] = []) {
      const value = await review(intent, resourceIds),
        input = await approve(value),
        request = (await vela("request", input)) as VelaRequest;
      assert.equal(request.state, "responded", request.errorCode);
      return { ...value, input, request };
    },
    async reopen(edit?: (db: DatabaseSync) => void) {
      await core.command("close", {});
      closed = true;
      if (edit) {
        const db = new DatabaseSync(path);
        try {
          edit(db);
        } finally {
          db.close();
        }
      }
      core = new BackendCore(options);
      closed = false;
    },
    async close() {
      if (!closed) await core.command("close", {});
      const target = resolve(dir),
        part = relative(resolve(tmpdir()), target);
      assert(
        part.startsWith("aerynth-frozen-history-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(target, { recursive: true, force: true });
    },
  };
}
test("private native review binds exact semantic egress and canonical whole-pair history across a real Core SQLite restart", async () => {
  const f = fixture();
  try {
    const projectState = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic metadata audit project",
      }),
      projectId = projectState.projects[0].id;
    const workspaceState = await f.core.command("desktop", {
        type: "createWorkspace",
        title: "Synthetic metadata audit workspace",
        projectId,
      }),
      workspaceId = workspaceState.activeWorkspaceId!;
    const noteState = await f.core.command("desktop", {
        type: "createResource",
        kind: "note",
        title: "Synthetic metadata audit note",
        workspaceId,
      }),
      note = noteState.resources.find((item) => item.kind === "note")!;
    await f.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: note.version,
      content: "SYNTHETIC_SOURCE_BODY_NOT_FOR_METADATA",
    });
    // Keep the body sentinel beyond the native planning conversation's legitimate 120-character title projection.
    const first = await f.review(
      "Synthetic metadata audit request ".repeat(5) +
        "SYNTHETIC_HISTORY_BODY_NOT_FOR_METADATA",
      [note.id],
    );
    assert.equal(
      (await f.state()).conversation,
      null,
      "Read-only review never creates Vela",
    );
    await assert.rejects(
      f.core.command("authorizeVelaRequest", {
        previewId: first.preview.id,
        signature: first.preview.signature,
      }),
      /vela_native_review_required/,
    );
    await assert.rejects(
      f.core.command("authorizeVelaRequest", {
        previewId: first.preview.id,
        signature: first.preview.signature,
        reviewDigest: "forged",
      }),
      /vela_native_review_required/,
    );
    const initial = (await f.vela(
      "request",
      await f.approve(first),
    )) as VelaRequest;
    assert.equal(initial.state, "responded", initial.errorCode);
    const before = (await f.state()).conversation!,
      selected = await f.review(
        "Synthetic follow-up about the previous answer",
      );
    assert.equal(selected.preview.history?.messageCount, 2);
    assert(!Object.hasOwn(selected.preview.context, "history"));
    assert(!Object.hasOwn(selected.preview, "prompt"));
    assert(!Object.hasOwn(selected.preview, "historyFence"));
    assert.deepEqual(
      selected.native.history!.messages.map((item) => item.id),
      before.messages.map((item) => item.id),
    );
    assert.deepEqual(
      selected.native.history!.messages.map((item) => item.content),
      before.messages.map((item) => item.content),
    );
    assert(
      !JSON.stringify(selected.native.historyOmissions).includes("requestId"),
    );
    const anyCore = f.core as any,
      read = anyCore.readVelaCatalog.bind(anyCore);
    let bodyReads = 0,
      guardedReads = 0,
      acceptedMetadata = false,
      violationStack: string | undefined;
    const markers = [
      "SYNTHETIC_HISTORY_BODY_NOT_FOR_METADATA",
      "SYNTHETIC_SOURCE_BODY_NOT_FOR_METADATA",
    ];
    const containsBody = (
      value: unknown,
      seen = new Set<unknown>(),
    ): boolean => {
      if (typeof value === "string")
        return markers.some((marker) => value.includes(marker));
      if (!value || typeof value !== "object" || seen.has(value)) return false;
      seen.add(value);
      return Object.values(value).some((item) => containsBody(item, seen));
    };
    anyCore.readVelaCatalog = async (requestId: string, call: unknown) => {
      const entry = anyCore.velaCatalogLeases.get(requestId),
        leaseRead = entry.lease.read;
      // Wait/binding writes belong to the existing execution flow. Guard the synchronous authorized metadata operation itself.
      entry.lease.read = (value: unknown) => {
        guardedReads++;
        const message = anyCore.velaHistoryMessage,
          content = anyCore.velaHistoryContent,
          snapshot = anyCore.graph.snapshot,
          save = anyCore.save,
          atomic = anyCore.atomic,
          state = anyCore.vela.state,
          clone = structuredClone,
          stringify = JSON.stringify;
        const forbidden = () => {
          bodyReads++;
          violationStack ??= new Error(
            "No state/body mutation snapshots in metadata tool",
          ).stack;
          throw new Error("No state/body mutation snapshots in metadata tool");
        };
        anyCore.velaHistoryMessage = forbidden;
        anyCore.velaHistoryContent = forbidden;
        anyCore.graph.snapshot = forbidden;
        anyCore.save = forbidden;
        anyCore.atomic = forbidden;
        anyCore.vela.state = forbidden;
        (globalThis as any).structuredClone = (
          candidate: unknown,
          ...args: unknown[]
        ) => {
          if (
            candidate === anyCore.state ||
            candidate === anyCore.state.graph ||
            containsBody(candidate)
          )
            return forbidden();
          return (clone as any)(candidate, ...args);
        };
        (JSON as any).stringify = (candidate: unknown, ...args: unknown[]) => {
          if (containsBody(candidate)) return forbidden();
          return (stringify as any)(candidate, ...args);
        };
        const beforeChanges = f
          .db()
          .prepare("SELECT total_changes() AS count")
          .get()!.count;
        try {
          const reply = leaseRead.call(entry.lease, value);
          acceptedMetadata ||= reply.success;
          assert.equal(
            f.db().prepare("SELECT total_changes() AS count").get()!.count,
            beforeChanges,
          );
          return reply;
        } finally {
          anyCore.velaHistoryMessage = message;
          anyCore.velaHistoryContent = content;
          anyCore.graph.snapshot = snapshot;
          anyCore.save = save;
          anyCore.atomic = atomic;
          anyCore.vela.state = state;
          (globalThis as any).structuredClone = clone;
          JSON.stringify = stringify;
        }
      };
      try {
        return await read(requestId, call);
      } finally {
        entry.lease.read = leaseRead;
      }
    };
    const input = await f.approve(selected),
      reply = (await f.vela("request", {
        ...input,
        context: {
          history: { messages: [{ content: "FORGED RENDERER HISTORY" }] },
        },
        historyFence: { baseRevision: 0 },
      })) as VelaRequest;
    assert.equal(reply.state, "responded", reply.errorCode);
    assert.equal(bodyReads, 0, violationStack);
    assert(guardedReads > 0);
    assert(acceptedMetadata);
    const snapshot = await f.core.command("snapshot", {}),
      execution = Object.values(snapshot.executions).find((item) =>
        item.commandId.includes(planningDigest(reply.id).slice(0, 32)),
      )!;
    const nativeUser = snapshot.graph.messages.find(
      (item) =>
        item.conversationId === snapshot.resourceMap[execution.resourceId] &&
        item.role === "user",
    )!;
    assert.equal(nativeUser.content, selected.native.prompt);
    assert(!nativeUser.content.includes("FORGED RENDERER HISTORY"));
    const raw = JSON.parse(
      String(
        f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
      ),
    );
    assert.equal(raw.schemaVersion, 3);
    for (const request of raw.requests) {
      assert(!request.context.history);
      if (request.history)
        assert(
          request.history.messages.every(
            (message: Record<string, unknown>) =>
              !Object.hasOwn(message, "content"),
          ),
        );
    }
    const acceptedMessages = (await f.state()).conversation!.messages;
    await f.reopen();
    assert.equal((f.core as any).velaGrants.size, 0);
    assert.equal((f.core as any).velaCatalogLeases.size, 0);
    const restarted = await f.review("Synthetic restart continuation");
    assert.equal(restarted.preview.history?.messageCount, 4);
    assert.deepEqual(
      (await f.state()).conversation!.messages,
      acceptedMessages,
    );
  } finally {
    await f.close();
  }
});
for (const existing of [false, true])
  test(`native review retains exact approved context with history/catalog OFF and ${existing ? "an existing" : "an initially absent"} canonical Vela root through dispatch and restart`, async () => {
    const f = fixture(false, "answer", false);
    try {
      if (existing) {
        await f.vela("open");
        (f.core as any).velaHost.appendMessage(
          (await f.state()).conversation!.resourceId,
          {
            role: "user",
            content: "SYNTHETIC_PRIOR_BODY_NEVER_SELECTED",
            source: "user",
            classification: "observed",
          },
        );
      }
      const projectState = await f.core.command("desktop", {
          type: "createProject",
          title: "Synthetic frozen approval project",
        }),
        projectId = projectState.projects[0].id,
        workspaceState = await f.core.command("desktop", {
          type: "createWorkspace",
          title: "Synthetic frozen approval workspace",
          projectId,
        }),
        workspaceId = workspaceState.activeWorkspaceId!,
        sourceState = await f.core.command("desktop", {
          type: "createResource",
          kind: "note",
          title: "Synthetic exact approved source",
          workspaceId,
        }),
        source = sourceState.resources.find((value) => value.kind === "note")!;
      await f.core.command("desktop", {
        type: "content",
        resourceId: source.id,
        expectedVersion: source.version,
        content: "Synthetic full approved source body",
      });
      const chatState = await f.core.command("desktop", {
          type: "createResource",
          kind: "conversation",
          title: "Synthetic full approved local chat",
          provider: "local",
          workspaceId,
        }),
        chat = chatState.resources.find(
          (value) => value.kind === "conversation",
        )!;
      await f.core.command("addMessage", {
        resourceId: chat.id,
        role: "user",
        content: "Synthetic exact approved local chat source",
        expectedRevision: 1,
      });
      const core = f.core as any,
        beforeConversation = (await f.state()).conversation,
        beforeDesktop = await f.core.command("desktop", { type: "snapshot" });
      for (const name of [
        "velaHistorySnapshot",
        "velaHistoryMessage",
        "velaHistoryContent",
      ])
        core[name] = () => {
          throw new Error("Default-off must not retrieve implicit history");
        };
      const selected = await f.review(
          "Synthetic exact approved native context",
          [chat.id, source.id],
        ),
        approvedContext = structuredClone(selected.native.context);
      assert.equal(selected.preview.nativeReviewRequired, undefined);
      assert.equal(selected.native.history, undefined);
      assert(
        !selected.native.prompt.includes("SYNTHETIC_PRIOR_BODY_NEVER_SELECTED"),
      );
      assert.equal(
        (await f.state()).conversation?.resourceId ?? null,
        beforeConversation?.resourceId ?? null,
        "Review never creates a Vela identity",
      );
      const append = core.velaHost.appendMessage;
      let actualBase: { conversationId: string; revision: number } | undefined;
      core.velaHost.appendMessage = (id: string, message: any) => {
        if (
          message.source === "user" &&
          message.content === selected.preview.intent
        )
          actualBase = {
            conversationId: id,
            revision: core.velaHost.conversationRevision(id),
          };
        return append(id, message);
      };
      const input = await f.approve(selected),
        request = (await f.vela("request", {
          ...input,
          context: { id: "FORGED-RENDERER-CONTEXT", createdAt: "forged" },
          historyFence: { baseRevision: 999 },
        })) as VelaRequest;
      assert.equal(request.state, "responded", request.errorCode);
      assert.deepEqual(request.context, approvedContext);
      assert.equal(request.context.id, selected.preview.context.id);
      assert.equal(
        request.context.createdAt,
        selected.preview.context.createdAt,
      );
      const preview = core.velaPreviews.get(selected.preview.id);
      assert.deepEqual(preview.acceptedInputBase, actualBase);
      assert.equal(preview.acceptedAppend.revision, actualBase!.revision + 1);
      assert.equal(actualBase!.conversationId, request.conversationId);
      if (existing)
        assert.equal(actualBase!.revision, beforeConversation!.revision);
      else
        assert.equal(
          core.velaHistoryMessageMetadata(
            request.conversationId,
            request.inputMessageId,
          ).ordinal,
          1,
        );
      const snapshot = await f.core.command("snapshot", {}),
        execution = Object.values(snapshot.executions).find((value) =>
          value.commandId.includes(planningDigest(request.id).slice(0, 32)),
        )!,
        user = snapshot.graph.messages.find(
          (value) =>
            value.conversationId ===
              snapshot.resourceMap[execution.resourceId] &&
            value.role === "user",
        )!;
      assert.equal(user.content, selected.native.prompt);
      const data = JSON.parse(user.content.split("\n").at(-1)!);
      assert.deepEqual(data.context, approvedContext);
      assert(!data.capabilityDiscovery);
      assert(!data.context.history);
      assert.deepEqual(
        (await f.core.command("desktop", { type: "snapshot" })).blocks,
        beforeDesktop.blocks,
      );
      assert.equal(
        (await f.core.command("desktop", { type: "snapshot" })).resources.find(
          (value) => value.id === source.id,
        )!.content,
        "Synthetic full approved source body",
      );
      assert.deepEqual(
        JSON.parse(
          String(
            f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!
              .json,
          ),
        ).requests.find((value: any) => value.id === request.id).context,
        approvedContext,
      );
      await assert.rejects(
        f.vela("request", input),
        /native_vela_grant_required/,
      );
      await f.reopen();
      assert.deepEqual(
        (await f.state()).requests.find((value) => value.id === request.id)!
          .context,
        approvedContext,
      );
      assert.equal(
        Object.keys((await f.core.command("snapshot", {})).executions).length,
        1,
      );
      await assert.rejects(
        f.vela("request", input),
        /native_vela_grant_required/,
      );
    } finally {
      await f.close();
    }
  });

test("history/catalog OFF native approval refuses independent roots, extra input, forged accepted proof and revoked sources before any new provider/native effect", async () => {
  for (const failure of [
    "created-root",
    "replaced-root",
    "extra-before",
    "extra-after",
    "forged-proof",
    "forged-base",
    "stale-source",
    "revoked-source",
    "scope",
    "expired-grant",
    "forged-review",
  ] as const) {
    const f = fixture(false, "answer", false);
    try {
      if (failure !== "created-root") await f.vela("open");
      const workspace = await f.core.command("desktop", {
          type: "createWorkspace",
          title: "Synthetic rejection workspace",
          projectId: null,
        }),
        sourceState = await f.core.command("desktop", {
          type: "createResource",
          kind: "note",
          title: "Synthetic rejection source",
          workspaceId: workspace.activeWorkspaceId,
        }),
        source = sourceState.resources.find((value) => value.kind === "note")!;
      const selected = await f.review(
          "Synthetic history-off rejected request",
          [source.id],
        ),
        core = f.core as any;
      if (failure === "forged-review") {
        const before = String(
          f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
        );
        await assert.rejects(
          f.core.command("authorizeVelaRequest", {
            previewId: selected.preview.id,
            signature: selected.preview.signature,
            reviewDigest: "forged",
          }),
          /vela_native_review_required/,
        );
        assert.equal(
          String(
            f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!
              .json,
          ),
          before,
        );
        assert.equal(core.velaGrants.size, 0);
        continue;
      }
      const input = await f.approve(selected);
      if (failure === "created-root") await f.vela("open");
      if (failure === "replaced-root") {
        const other = await f.core.command("createConversation", {
          title: "Synthetic independent replacement",
          providerId: "local",
          commandId: "synthetic-root-replacement",
        });
        core.state.vela.conversationId = other.resourceId;
      }
      if (failure === "extra-before")
        core.velaHost.appendMessage(core.state.vela.conversationId, {
          role: "user",
          content: "Synthetic independent append",
          source: "user",
          classification: "observed",
        });
      if (failure === "stale-source")
        await f.core.command("desktop", {
          type: "content",
          resourceId: source.id,
          expectedVersion: source.version,
          content: "Synthetic concurrent canonical change",
        });
      if (failure === "revoked-source") {
        const read = core.conversationAccess.resource;
        core.conversationAccess.resource = (id: string, ...rest: unknown[]) =>
          id !== source.id && read(id, ...rest);
      }
      if (failure === "scope")
        await f.core.command("desktop", {
          type: "navigate",
          target: { kind: "constellation", projectId: null },
        });
      if (["extra-after", "forged-proof", "forged-base"].includes(failure)) {
        const bridge = core.frozenVelaProviderContext.bind(core);
        core.frozenVelaProviderContext = (id: string) => {
          const value = bridge(id);
          return {
            ...value,
            onAcceptedAppend: (accepted: any, base: any) => {
              value.onAcceptedAppend(
                failure === "forged-proof"
                  ? { ...accepted, contentDigest: "0".repeat(64) }
                  : accepted,
                failure === "forged-base"
                  ? { ...base, revision: base.revision + 1 }
                  : base,
              );
              if (failure === "extra-after")
                core.velaHost.appendMessage(core.state.vela.conversationId, {
                  role: "user",
                  content: "Synthetic extra append after accepted input",
                  source: "user",
                  classification: "observed",
                });
            },
          };
        };
      }
      const before = await f.core.command("desktop", { type: "snapshot" }),
        stored = String(
          f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
        ),
        integrationStored = String(
          f.db().prepare("SELECT json FROM integration_state WHERE id=1").get()!
            .json,
        ),
        clock = Date.now;
      try {
        if (failure === "expired-grant") Date.now = () => clock() + 61000;
        if (failure === "extra-after") {
          const rejected = (await f.vela("request", input)) as VelaRequest;
          assert.equal(rejected.state, "failed");
          assert.equal(rejected.errorCode, "planning_failed");
          assert.throws(
            () =>
              core.validateVelaInputAnchor(
                core.velaPreviews.get(selected.preview.id),
              ),
            /stale_vela_input_revision/,
          );
        } else {
          await assert.rejects(
            f.vela("request", input),
            /stale_vela_input|invalid_history_append|stale_vela_preview|native_vela_grant_expired/,
          );
          assert.equal(
            String(
              f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!
                .json,
            ),
            stored,
            "Rejected pre-dispatch request must not append canonical input or change Vela state: " +
              failure,
          );
          assert.equal(
            String(
              f
                .db()
                .prepare("SELECT json FROM integration_state WHERE id=1")
                .get()!.json,
            ),
            integrationStored,
            "Rejected canonical append must also roll back Core graph/identity storage",
          );
        }
      } finally {
        Date.now = clock;
      }
      const after = await f.core.command("desktop", { type: "snapshot" });
      assert.deepEqual(after.blocks, before.blocks);
      assert.deepEqual(after.workspaces, before.workspaces);
      assert.deepEqual(
        after.resources.filter((value) => value.id === source.id),
        before.resources.filter((value) => value.id === source.id),
      );
      assert.equal(
        Object.keys((await f.core.command("snapshot", {})).executions).length,
        0,
        failure + " starts no provider turn",
      );
    } finally {
      await f.close();
    }
  }
});

test("default-false history never selects or materializes previous bodies; host review remains private and byte-exact", async () => {
  const f = fixture(false);
  try {
    await f.ask("Synthetic explicit first question");
    const core = f.core as any;
    core.velaHistorySnapshot = () => {
      throw new Error("History disabled");
    };
    core.velaHistoryMessage = () => {
      throw new Error("History disabled");
    };
    core.velaHistoryContent = () => {
      throw new Error("History disabled");
    };
    const preview = await f.core.command("velaRequestPreview", {
      intent: "Synthetic default-off follow-up",
      resourceIds: [],
    });
    assert.equal(preview.history, undefined);
    assert(!preview.context.history);
    await assert.rejects(
      f.vela("nativeReview" as VelaOperation["name"], {
        previewId: preview.id,
        signature: preview.signature,
      }),
      /unsupported_vela_command/,
    );
    await assert.rejects(
      f.core.command("velaNativeReview", {
        previewId: preview.id,
        signature: "foreign",
      }),
      /approval_scope_mismatch/,
    );
  } finally {
    await f.close();
  }
});
test("an extra canonical append or changed source invalidates a frozen window instead of silently selecting replacements", async () => {
  const f = fixture();
  try {
    await f.ask("Synthetic history seed");
    const selected = await f.review("Synthetic stale window"),
      id = (await f.state()).conversation!.resourceId;
    await f.core.command("addMessage", {
      resourceId: id,
      role: "user",
      content: "Synthetic concurrent canonical append",
      expectedRevision: (await f.state()).conversation!.revision,
    });
    await assert.rejects(f.approve(selected), /stale-history-revision/);
  } finally {
    await f.close();
  }
  const g = fixture();
  try {
    await g.ask("Synthetic history seed for dispatch fence");
    const selected = await g.review(
        "Synthetic request with exactly one permitted append",
      ),
      input = await g.approve(selected),
      core = g.core as any,
      bridge = core.frozenVelaProviderContext.bind(core);
    core.frozenVelaProviderContext = (id: string) => {
      const value = bridge(id);
      return {
        ...value,
        onAcceptedAppend: (append: unknown, base: unknown) => {
          value.onAcceptedAppend(append, base);
          core.velaHost.appendMessage(core.state.vela.conversationId, {
            role: "user",
            content: "Synthetic unauthorized extra append",
            source: "user",
            classification: "observed",
          });
        },
      };
    };
    const request = (await g.vela("request", input)) as VelaRequest;
    assert.equal(request.state, "failed");
    assert.equal(
      Object.values((await g.core.command("snapshot", {})).executions).length,
      1,
      "No new synthetic provider turn crosses the stale append fence",
    );
  } finally {
    await g.close();
  }
  const h = fixture();
  try {
    const created = await h.core.command("desktop", {
        type: "createResource",
        kind: "note",
        title: "Synthetic transitive history source",
        workspaceId: null,
      }),
      note = created.resources.find((item) => item.kind === "note")!;
    const saved = await h.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: note.version,
      content: "Synthetic source detail that remains canonical.",
    });
    await h.ask("Synthetic answer derived from this source", [note.id]);
    const reviewed = await h.review(
      "Synthetic follow-up without reselecting the note",
    );
    assert.equal(reviewed.native.history?.messages.length, 2);
    const current = saved.resources.find((item) => item.id === note.id)!;
    await h.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: current.version,
      content: "Synthetic source changed after native review",
    });
    await assert.rejects(h.approve(reviewed), /upstream-changed/);
    const updated = await h.review(
      "Synthetic new follow-up after source change",
    );
    assert.equal(updated.native.history, undefined);
    assert(
      updated.native.historyOmissions.some(
        (item) => item.reason === "upstream-changed",
      ),
    );
  } finally {
    await h.close();
  }
});
test("foreign navigation history is omitted before any historical body reader and never becomes known-null provenance", async () => {
  const f = fixture();
  try {
    const a = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic history scope A",
      }),
      projectA = a.projects[0];
    await f.core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic A workspace",
      projectId: projectA.id,
    });
    await f.ask("SYNTHETIC_PRIVATE_SCOPE_A_QUESTION");
    const b = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic history scope B",
      }),
      projectB = b.projects.find((item) => item.id !== projectA.id)!;
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "constellation", projectId: projectB.id },
    });
    let bodies = 0;
    (f.core as any).velaHistoryMessage = () => {
      bodies++;
      throw new Error("Foreign history body must not be materialized");
    };
    const reviewed = await f.review("Synthetic B request");
    assert.equal(reviewed.native.history, undefined);
    assert.equal(bodies, 0);
    assert(
      !reviewed.native.prompt.includes("SYNTHETIC_PRIVATE_SCOPE_A_QUESTION"),
    );
    assert(
      reviewed.native.historyOmissions.some(
        (item) => item.reason === "scope-mismatch",
      ),
    );
  } finally {
    await f.close();
  }
});
test("foreign inherited conversation sources deny content preflight before body size or over-budget disclosure", async () => {
  const f = fixture();
  try {
    const a = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic inherited scope A",
      }),
      projectA = a.projects[0].id,
      b = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic inherited scope B",
      }),
      projectB = b.projects.find((item) => item.id !== projectA)!.id,
      parent = await f.core.command("createConversation", {
        title: "Synthetic foreign parent",
        providerId: "local",
        commandId: "history-parent",
      }),
      origin = await f.core.command("addMessage", {
        resourceId: parent.resourceId,
        role: "user",
        content: "Synthetic foreign inherited body",
        expectedRevision: 1,
      });
    await f.core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: parent.resourceId,
        projectId: projectB,
        expectedVersion: 1,
      },
    });
    const child = await f.core.command("branch", {
      resourceId: parent.resourceId,
      messageId: origin.id,
      includeMessageIds: [origin.id],
      providerId: "local",
      title: "Synthetic scoped child",
      commandId: "history-child",
      tokenBudget: 8192,
    });
    await f.core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: child.conversation.resourceId,
        projectId: projectA,
        expectedVersion: 1,
      },
    });
    await f.core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic inherited A workspace",
      projectId: projectA,
    });
    const core = f.core as any,
      scope = core.velaHost.scope(),
      ref = core.velaHost.resolve(
        { id: child.conversation.resourceId, kind: "resource" },
        scope,
      ),
      record = core.graph.data.messages.find(
        (item: { id: string }) => item.id === origin.id,
      ),
      descriptor = Object.getOwnPropertyDescriptor(record, "content")!;
    assert(ref);
    assert(scope.resourceIds.includes(child.conversation.resourceId));
    assert(!scope.resourceIds.includes(parent.resourceId));
    let bodyReads = 0;
    Object.defineProperty(record, "content", {
      configurable: true,
      get() {
        bodyReads++;
        throw new Error("Foreign inherited body must not be examined");
      },
    });
    try {
      assert.equal(
        core.velaHistoryContent(ref, 0),
        null,
        "Denied source is not reported as an oversized authorized body",
      );
      assert.equal(core.velaHistoryContent(ref, 131072), null);
      assert.equal(bodyReads, 0);
    } finally {
      Object.defineProperty(record, "content", descriptor);
    }
    assert.equal(
      Object.values((await f.core.command("snapshot", {})).executions).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("actual Core accepts legacy Vela state1/2 and writes3 with default history off; unknown future state fails before canonical writes", async () => {
  for (const version of [1, 2]) {
    const f = fixture(false);
    try {
      const first = await f.ask("Synthetic supported legacy migration"),
        before = await f.core.command("snapshot", {}),
        messages = (await f.state()).conversation!.messages;
      await f.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = version;
        for (const request of raw.requests) {
          delete request.origin;
          delete request.inputMessageId;
          delete request.inputContentDigest;
          delete request.provenance;
          delete request.history;
          if (request.response) delete request.response.contentDigest;
        }
        db.prepare(
          "UPDATE vela_state SET schema_version=?,json=? WHERE id=1",
        ).run(version, JSON.stringify(raw));
      });
      assert.equal(
        f
          .db()
          .prepare("SELECT schema_version FROM vela_state WHERE id=1")
          .get()!.schema_version,
        3,
      );
      assert.deepEqual((await f.state()).conversation!.messages, messages);
      assert.deepEqual(
        (await f.core.command("snapshot", {})).resourceMap,
        before.resourceMap,
      );
      assert.equal(
        (await f.state()).requests.find((item) => item.id === first.request.id)!
          .origin,
        undefined,
      );
      assert.equal(
        Object.values((await f.core.command("snapshot", {})).executions).length,
        1,
      );
    } finally {
      await f.close();
    }
  }
  const g = fixture(false);
  try {
    await g.ask("Synthetic future-version preservation");
    const before = String(
      g.db().prepare("SELECT json FROM integration_state WHERE id=1").get()!
        .json,
    );
    await assert.rejects(
      g.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = 4;
        db.prepare(
          "UPDATE vela_state SET schema_version=4,json=? WHERE id=1",
        ).run(JSON.stringify(raw));
      }),
      /unsupported_vela_schema/,
    );
    const db = new DatabaseSync(g.path);
    try {
      assert.equal(
        String(
          db.prepare("SELECT json FROM integration_state WHERE id=1").get()!
            .json,
        ),
        before,
      );
      assert.equal(
        db.prepare("SELECT schema_version FROM vela_state WHERE id=1").get()!
          .schema_version,
        4,
      );
    } finally {
      db.close();
    }
  } finally {
    await g.close();
  }
  const h = fixture(false);
  try {
    await h.ask("Synthetic mismatched downgrade preservation");
    await assert.rejects(
      h.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = 2;
        db.prepare("UPDATE vela_state SET json=? WHERE id=1").run(
          JSON.stringify(raw),
        );
      }),
      /corrupt_vela_state/,
    );
  } finally {
    await h.close();
  }
});
