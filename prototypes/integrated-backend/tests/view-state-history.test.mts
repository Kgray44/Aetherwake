import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BackendCore } from "../src/core.mts";

test("canonical view persistence preserves optional Forward/named views and legacy schema-1 states across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-view-history-"));
  const options = {
    path: join(root, "aerynth.sqlite"),
    privateRoot: root,
    cwd: root,
    provider: "codex" as const,
    contentPolicy: "local-private" as const,
  };
  let core = new BackendCore(options);
  let connections = 0;
  const forbidConnect = () => {
    (core as any).port.connect = async () => {
      connections++;
      throw new Error("View persistence must not connect a provider");
    };
  };
  forbidConnect();
  try {
    const desktop = await core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic navigation history",
      projectId: null,
    });
    const workspaceId = desktop.activeWorkspaceId!;
    const legacy = {
      schema: "aerynth.constellation@1",
      anchors: {},
      bookmarks: {},
      location: { kind: "universe" },
      history: [],
    };
    const entry = {
      location: { kind: "workspace", workspaceId },
      bookmark: {
        camera: { x: 120, y: -50, zoom: 0.7 },
        selected: `workspace:${workspaceId}`,
        spatial: {
          target: { x: 9, y: -5, z: 13 },
          distance: 720,
          yaw: 0.4,
          pitch: 0.2,
          mode: "orbit",
          sensitivity: 1,
        },
      },
    };
    const saved = { id: "synthetic-named-view", name: "Synthetic orbit view", ...entry };
    const state = { ...legacy, future: Array.from({ length: 32 }, () => entry), savedViews: [saved] };
    await core.command("viewState", { state });
    assert.deepEqual(await core.command("viewState", {}), state);
    await core.command("close", {});
    core = new BackendCore(options);
    forbidConnect();
    assert.deepEqual(await core.command("viewState", {}), state);
    for (const invalid of [null, {}, "future", [...state.future, entry]]) {
      await assert.rejects(
        core.command("viewState", { state: { ...state, future: invalid } }),
        /invalid_view_state/,
      );
      assert.deepEqual(await core.command("viewState", {}), state);
    }
    for (const invalid of [null, {}, "savedViews", Array.from({ length: 33 }, () => saved)]) {
      await assert.rejects(
        core.command("viewState", { state: { ...state, savedViews: invalid } }),
        /invalid_view_state/,
      );
      assert.deepEqual(await core.command("viewState", {}), state);
    }
    await assert.rejects(
      core.command("viewState", { state: { ...state, resources: [] } }),
      /invalid_view_state/,
    );
    await assert.rejects(
      core.command("viewState", {
        state: { ...state, anchors: { oversized: "x".repeat(2 * 1024 * 1024) } },
      }),
      /view_state_too_large/,
    );
    await core.command("viewState", { state: legacy });
    await core.command("close", {});
    core = new BackendCore(options);
    forbidConnect();
    assert.deepEqual(await core.command("viewState", {}), legacy);
    await core.command("viewState", { state: { ...legacy, future: [] } });
    assert.deepEqual(await core.command("viewState", {}), { ...legacy, future: [] });
    const actual = await core.command("desktop", { type: "snapshot" });
    assert.deepEqual(actual, desktop, "View history does not mutate canonical workspace state");
    const backend = await core.command("snapshot", {});
    assert.deepEqual(backend.executions, {});
    assert.deepEqual(backend.bindings, {});
    assert.equal(connections, 0);
  } finally {
    await core.command("close", {});
    const target = resolve(root);
    const part = relative(resolve(tmpdir()), target);
    assert.ok(part.startsWith("aerynth-view-history-") && !part.startsWith("..") && !isAbsolute(part));
    rmSync(target, { recursive: true, force: true });
  }
});
