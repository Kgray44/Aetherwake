import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";

const fixture = () => ({
  projects: [
    { id: "p", title: "Synthetic first" },
    { id: "q", title: "Synthetic second" },
  ],
  workspaces: [{ id: "w", title: "Synthetic workspace", project_id: "p" }],
  resources: [{ id: "r", title: "Synthetic note", kind: "note" }],
  blocks: [
    {
      id: "b",
      resource_id: "r",
      workspace_id: "w",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: 0,
    },
  ],
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "p" },
});
const setup = (options = {}) => {
  const motion = new MotionCoordinator();
  const c = new ConstellationController({
    snapshot: fixture(),
    motion,
    navigate: async () => {},
    ...options,
  });
  const n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  return { c, n, motion };
};
const settle = (motion) => {
  for (let i = 0; i < 180; i++) motion.step(1 / 60);
};

test("Back and Forward restore exact camera, selection, mode and presentation in both directions", async () => {
  const { c, n, motion } = setup();
  c.select("resource:b");
  n.mode = "pan";
  n.orbit(65, -20);
  n.pan(45, 25);
  c.move({ x: 140, y: 260, zoom: 1.2 });
  settle(motion);
  const first = { spatial: n.camera, camera: c.camera, selected: c.selected };
  await c.go({ kind: "universe" });
  c.select("project:q");
  n.mode = "orbit";
  n.presentation = "list";
  n.sensitivity = 0.7;
  n.orbit(-75, 25);
  n.pan(70, -30);
  c.move({ x: 420, y: -150, zoom: 0.6 });
  settle(motion);
  const second = { spatial: n.camera, camera: c.camera, selected: c.selected };
  await c.back();
  settle(motion);
  assert.deepEqual(
    { spatial: n.camera, camera: c.camera, selected: c.selected },
    first,
  );
  assert.equal(c.state.history.length, 0);
  assert.equal(c.state.future.length, 1);
  await c.forward();
  settle(motion);
  assert.deepEqual(
    { spatial: n.camera, camera: c.camera, selected: c.selected },
    second,
  );
  assert.equal(c.state.future.length, 0);
  assert.deepEqual(
    c.state.history.map((h) => h.location),
    [{ kind: "project", projectId: "p" }],
  );
  c.dispose();
});

test("a History jump preserves the skipped views in Forward order", async () => {
  const { c } = setup();
  await c.go({ kind: "project", projectId: "q" });
  await c.go({ kind: "universe" });
  await c.go({ kind: "workspace", workspaceId: "w" });
  await c.returnHistory(0);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  for (const expected of [
    { kind: "project", projectId: "q" },
    { kind: "universe" },
    { kind: "workspace", workspaceId: "w" },
  ]) {
    await c.forward();
    assert.deepEqual(c.location, expected);
  }
  assert.equal(c.state.future.length, 0);
  c.dispose();
});

test("history travel saves coherent stacks once, and Forward survives restart and legacy profiles", async () => {
  const saves = [];
  let saved;
  const persistence = {
    load: async () => saved,
    save: async (s) => {
      saved = structuredClone(s);
      saves.push(saved);
    },
  };
  const first = setup({ persistence });
  first.n.orbit(30, 15);
  await first.c.go({ kind: "universe" });
  const universe = first.n.bookmark();
  saves.length = 0;
  await first.c.back();
  assert.equal(
    saves.length,
    1,
    "no intermediate location with stale history is saved",
  );
  assert.equal(saved.history.length, 0);
  assert.deepEqual(saved.future[0].location, { kind: "universe" });
  const restored = setup({ persistence });
  await restored.c.restore();
  assert.equal(restored.c.state.future.length, 1);
  await restored.c.forward();
  settle(restored.motion);
  assert.deepEqual(restored.n.camera, universe);
  delete saved.future;
  const legacy = setup({ persistence });
  await legacy.c.restore();
  assert.deepEqual(legacy.c.state.future, []);
  for (const { c } of [first, restored, legacy]) c.dispose();
});

test("failed new travel and failed Forward preserve both stacks; successful new travel clears Forward", async () => {
  let reject = false;
  const { c } = setup({
    navigate: async () => {
      if (reject) throw Error("Synthetic unavailable service");
    },
  });
  await c.go({ kind: "universe" });
  await c.back();
  const before = {
    history: structuredClone(c.state.history),
    future: structuredClone(c.state.future),
  };
  reject = true;
  await assert.rejects(c.go({ kind: "project", projectId: "q" }));
  await assert.rejects(c.forward());
  assert.deepEqual(
    { history: c.state.history, future: c.state.future },
    before,
  );
  reject = false;
  await c.go({ kind: "project", projectId: "q" });
  assert.deepEqual(c.state.future, []);
  c.dispose();
});

test("a superseded pending Forward cannot change either stack over newer travel", async () => {
  let delayed = false;
  const releases = [];
  const { c } = setup({
    navigate: () =>
      delayed ? new Promise((r) => releases.push(r)) : Promise.resolve(),
  });
  await c.go({ kind: "universe" });
  await c.back();
  const before = {
    history: structuredClone(c.state.history),
    future: structuredClone(c.state.future),
  };
  delayed = true;
  const old = c.forward();
  await new Promise(setImmediate);
  const newer = c.go({ kind: "project", projectId: "q" });
  releases.shift()();
  await old;
  assert.deepEqual(
    { history: c.state.history, future: c.state.future },
    before,
  );
  await new Promise(setImmediate);
  releases.shift()();
  await newer;
  assert.deepEqual(c.location, { kind: "project", projectId: "q" });
  assert.equal(c.state.future.length, 0);
  c.dispose();
});

test("metadata refresh preserves Forward, permission revocation prunes it, and external navigation clears it", async () => {
  const { c } = setup();
  await c.go({ kind: "project", projectId: "q" });
  await c.back();
  c.update(fixture());
  assert.equal(c.state.future.length, 1);
  const revoked = fixture();
  revoked.projects = revoked.projects.filter((p) => p.id !== "q");
  c.update(revoked);
  assert.equal(c.state.future.length, 0);
  assert.equal(JSON.stringify(c.state).includes("project:q"), false);
  await c.go({ kind: "universe" });
  await c.back();
  assert.equal(c.state.future.length, 1);
  c.update({
    ...revoked,
    navigation: { kind: "workspace", workspaceId: "w" },
    activeWorkspaceId: "w",
  });
  assert.deepEqual(c.state.future, []);
  c.dispose();
});

test("restored Forward entries are bounded and remove unavailable selection and neighborhood IDs", async () => {
  const { c } = setup();
  await c.persist();
  const raw = structuredClone(c.state);
  raw.future = Array.from({ length: 50 }, () => ({
    location: { kind: "project", projectId: "q" },
    bookmark: {
      camera: { x: 1, y: 2, zoom: 1 },
      selected: "resource:revoked",
      spatial: {
        target: { x: 1, y: 2, z: 3 },
        distance: 900,
        yaw: 0.4,
        pitch: 0.3,
        mode: "orbit",
        sensitivity: 1,
        neighborhood: "resource:revoked",
      },
    },
  }));
  const restored = setup({
    persistence: { load: async () => raw, save: async () => {} },
  });
  await restored.c.restore();
  assert.equal(restored.c.state.future.length, 32);
  assert.ok(
    restored.c.state.future.every(
      (h) => h.bookmark.selected === null && !h.bookmark.spatial.neighborhood,
    ),
  );
  assert.equal(JSON.stringify(restored.c.state).includes("revoked"), false);
  c.dispose();
  restored.c.dispose();
});
