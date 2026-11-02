import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prepareWorkspaceNative } from "../prepare-workspace-native.mts";
import { BackendCore } from "../../integrated-backend/src/core.mts";
import { REGISTERED_BLOCKS } from "../registry.ts";
const require = createRequire(import.meta.url);
const { options, workspaceState, verify } = require("./workspace-native.cjs");

test("normal-card native entry requires the qualified explicit deadline and exact host start", () => {
  for (const deadline of [undefined, "", "0", "90001", "NaN", "Infinity"])
    assert.throws(() =>
      options(
        deadline === undefined
          ? []
          : ["--verification-deadline-ms=" + deadline],
        1000,
      ),
    );
  assert.throws(() => options(["--verification-deadline-ms=90000"], undefined));
  const value = options(
    ["--verification-deadline-ms=90000", "--verify-restore"],
    1000,
  );
  assert.equal(value.deadlineAt, 91000);
  assert.equal(value.maxScreenshots, 2);
  assert.equal(value.maxPngBytes, 8388608);
  assert.equal(value.maxCheckpointBytes, 131072);
  assert.equal(value.restore, true);
});

test("normal-card helper immediately stops on lost ownership, saves only a bounded failure receipt and exits its own app", async () => {
  const argv = process.argv;
  process.argv = [...argv, "--verification-deadline-ms=30000"];
  let exits = 0,
    removed = 0;
  const fail = () => {
    throw Error("No input, JS, capture or focus acquisition is permitted");
  };
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => false,
    focus: fail,
    show: fail,
    setSize: fail,
    webContents: {
      on() {},
      removeListener() {
        removed++;
      },
      isDestroyed: () => false,
      executeJavaScript: fail,
      sendInputEvent: fail,
      capturePage: fail,
      insertText: fail,
    },
  };
  try {
    const receipt = await verify({
      win,
      app: {
        exit(code: number) {
          assert.equal(code, 1);
          exits++;
        },
      },
      privateRoot: join(tmpdir(), "review-workspace-native-never-open"),
      source: {},
      moduleStarted: Date.now(),
    });
    assert.equal(receipt.passed, false);
    assert.match(receipt.error, /native_owner_window_inactive/);
    assert.equal(receipt.actions.length + receipt.screenshots.length, 0);
    assert.equal(exits, 1);
    assert.equal(removed, 1);
  } finally {
    process.argv = argv;
  }
});

test("observed host startup shader/console errors fail before interaction and retain a bounded copy", async () => {
  const argv = process.argv;
  process.argv = [...argv, "--verification-deadline-ms=30000"];
  let exitCode: number | undefined;
  const fail = () => {
      throw Error("Startup failure cannot perform UI work");
    },
    win = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => true,
      webContents: {
        on() {},
        removeListener() {},
        isDestroyed: () => false,
        executeJavaScript: fail,
        sendInputEvent: fail,
        capturePage: fail,
        insertText: fail,
      },
    },
    startupErrors = Array.from(
      { length: 25 },
      () => "Synthetic observed shader error " + "x".repeat(2000),
    );
  try {
    const receipt = await verify({
      win,
      app: {
        exit(code: number) {
          exitCode = code;
        },
      },
      privateRoot: join(tmpdir(), "review-workspace-native-never-open"),
      source: {},
      moduleStarted: Date.now(),
      startupErrors,
    });
    assert.equal(receipt.passed, false);
    assert.equal(exitCode, 1);
    assert.equal(receipt.startupErrorCount, 25);
    assert.equal(receipt.startupErrors.length, 20);
    assert.ok(
      receipt.startupErrors.every((value: string) => value.length <= 1000),
    );
    assert.match(receipt.error, /Observed startup graphics\/console error/);
    assert.equal(receipt.actions.length + receipt.screenshots.length, 0);
  } finally {
    process.argv = argv;
  }
});

test("offline normal-card preparation and fresh Core restore use canonical kinds, distinct defaults and actual subject membership with no execution", async (t) => {
  const profile = join(
      tmpdir(),
      "review-workspace-native-source-" + randomUUID(),
    ),
    seed = await prepareWorkspaceNative(profile);
  // Preserve this bounded synthetic profile as a private preparation receipt.
  const path = join(profile, "aerynth.sqlite"),
    core = new BackendCore({
      path,
      privateRoot: profile,
      provider: "codex",
      contentPolicy: "local-private",
    });
  t.after(() => core.command("close", {}));
  assert.equal(seed.cases.length, REGISTERED_BLOCKS.length);
  const approach = require('./workspace-approach.cjs'), expressions = require('./workspace-approach-expressions.cjs');
  assert.equal(seed.approachValidation.preflightSha256, expressions.preflight().sha256);
  assert.match(seed.approachValidation.expressionHelperSha256, /^[a-f0-9]{64}$/);
  assert.match(seed.approachValidation.commonHelperSha256, /^[a-f0-9]{64}$/);
  assert.equal(seed.minimizeValidation.preflightSha256, require('./workspace-minimize-expressions.cjs').preflight().sha256);
  for (const value of [seed.minimizeValidation.helperSha256, seed.minimizeValidation.expressionHelperSha256, seed.minimizeValidation.commonHelperSha256]) assert.match(value, /^[a-f0-9]{64}$/);
  assert.deepEqual(require('./workspace-minimize.cjs').selectCases(seed).map((entry: any) => entry.kind), ['conversation', 'note', 'reference']);
  const selected = approach.selectCases(seed);
  assert.deepEqual(selected.map((entry: any) => entry.kind), ['research', 'task', 'reference']);
  assert.deepEqual(selected.map((entry: any) => entry.shape ?? 'default'), ['default', 'pill', 'circle']);
  assert.deepEqual(
    new Set(seed.shapeCases.map((entry) => entry.shape)),
    new Set(["lens", "circle", "pill"]),
  );
  assert.equal(
    seed.cases.filter((entry) => !entry.blockId).length,
    2,
    "Note and Chat require actual native Library creation",
  );
  assert.equal(
    new Set(
      seed.cases.map(
        (entry) => entry.defaultSize.width + "x" + entry.defaultSize.height,
      ),
    ).size,
    10,
  );
  const initial = await core.command("desktop", { type: "snapshot" });
  assert.deepEqual(initial, seed.expected);
  for (const entry of seed.cases) {
    const state = await core.command("desktop", {
      type: "navigate",
      target: { kind: "workspace", workspaceId: entry.workspaceId },
    });
    assert.equal(state.organization!.mode, "freeform");
    if (!entry.blockId) {
      assert.equal(state.blocks.length, 0);
      continue;
    }
    const block = state.blocks.find((block) => block.id === entry.blockId)!;
    assert(block);
    assert.equal(block.shape, entry.defaultShape);
    assert.deepEqual(
      { width: block.width, height: block.height },
      entry.defaultSize,
    );
    assert.deepEqual(workspaceState(state).blocks, state.blocks);
    if (entry.kind === "task_group")
      assert.equal(
        state.resources.find((resource) => resource.id === entry.resourceId)!
          .taskMembers![0].id,
        seed.taskId,
      );
    if (entry.kind === "collection_browser") {
      const page = await core.command("library", {
        name: "browseResources",
        input: {
          subject: { kind: "collection", collectionId: seed.collectionId },
          limit: 30,
        },
      });
      assert.equal((page.result as any).resources[0].id, seed.memberId);
    }
  }
  for (const entry of seed.shapeCases) {
    const state = await core.command("desktop", {
        type: "navigate",
        target: { kind: "workspace", workspaceId: entry.workspaceId },
      }),
      block = state.blocks.find((block) => block.id === entry.blockId)!;
    assert.equal(block.shape, entry.shape);
    assert.equal(block.resource_id, entry.resourceId);
    assert.deepEqual({ width: block.width, height: block.height }, entry.size);
    assert(
      seed.cases.some((original) => original.resourceId === entry.resourceId),
      "Saved shape references existing canonical resource",
    );
  }
  assert.equal(
    Object.keys((await core.command("snapshot", {})).executions).length,
    0,
  );
  const task = initial.resources.find(resource => resource.id === seed.taskId)!;
  const toggled = await core.command('desktop', { type: 'taskStatus', resourceId: task.id, expectedVersion: task.version, status: 'done' });
  assert.doesNotThrow(() => approach.assertResourceEffects(initial.resources, toggled.resources, new Map([[task.id, { taskStatus: 'done' }]])));
  const group = toggled.resources.find(resource => resource.kind === 'task_group')!;
  assert.equal(group.taskMembers![0].status, 'done', 'Real canonical projection follows the Task without changing group membership');
  assert.throws(() => approach.assertResourceEffects(initial.resources, toggled.resources.map(resource => resource.id === group.id ? { ...resource, title: 'Unexpected group mutation' } : resource), new Map([[task.id, { taskStatus: 'done' }]])), /Only intended canonical effects/);
  const before = readFileSync(join(profile, "workspace-native-seed.json"));
  await assert.rejects(
    prepareWorkspaceNative(profile),
    /existing_profiles_must_be_preserved/,
  );
  assert.deepEqual(
    readFileSync(join(profile, "workspace-native-seed.json")),
    before,
  );
});
