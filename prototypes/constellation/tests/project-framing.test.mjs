import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, validSpatialCamera } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

function fixture(count = 400) {
  return {
    projects: [{ id: "p", title: "Project" }],
    workspaces: [
      { id: "wa", title: "Workspace A", project_id: "p" },
      { id: "wb", title: "Workspace B", project_id: "p" },
    ],
    resources: Array.from({ length: count }, (_, i) => ({
      id: "r" + i,
      title: "Resource " + i,
      kind: "note",
      project_id: "p",
    })),
    blocks: [],
    relationships: [],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: "p" },
  };
}
function setup(
  snapshot = fixture(),
  viewport = { width: 1280, height: 800 },
  options = {},
) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
      ...options,
    }),
    n = new SpatialNavigator(c, () => {}, viewport),
    scene = new ConstellationScene(c, n, () => ({}));
  c.spatial = n;
  return {
    c,
    n,
    scene,
    motion,
    close() {
      scene.dispose();
      c.dispose();
    },
  };
}
const settle = (motion) => {
  for (let i = 0; i < 180; i++) motion.step(1 / 60);
};
function assertFramed(scene, width, height, count) {
  scene.update(width, height);
  assert.equal(scene.diagnostics.nodes, count);
  assert.equal(scene.diagnostics.culled, 0);
  for (const p of scene.diagnostics.projectedBodies) {
    assert(
      p.x - p.radius >= 0 && p.x + p.radius <= width,
      p.key + " horizontal envelope",
    );
    assert(
      p.y - p.radius >= 0 && p.y + p.radius <= height,
      p.key + " vertical envelope",
    );
  }
}

test("fresh project framing encloses the real resource cloud and body envelopes in landscape and portrait viewports", () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 560, height: 1000 },
  ]) {
    const { c, n, scene, close } = setup(fixture(), viewport),
      anchors = structuredClone(c.state.anchors),
      data = structuredClone(c.snapshot);
    assert(
      n.camera.distance > 3000,
      "overview is not limited to workspace-only approach distance",
    );
    assertFramed(scene, viewport.width, viewport.height, 403);
    assert.deepEqual(c.state.anchors, anchors);
    assert.deepEqual(c.snapshot, data);
    close();
  }
});

test("recenter frames distant pins without relocating any canonical or visual anchor", () => {
  const { c, n, scene, motion, close } = setup(),
    key = "resource:unplaced:r0",
    project = n.position("project:p");
  c.state.anchors[key].spatial = {
    x: project.x + 9000,
    y: project.y + 2000,
    z: project.z - 3000,
  };
  c.state.anchors[key].pinned = true;
  n.updateGraph();
  const anchors = structuredClone(c.state.anchors),
    data = structuredClone(c.snapshot);
  n.target({ ...n.camera, distance: 1000 });
  n.recenter();
  settle(motion);
  assertFramed(scene, 1280, 800, 403);
  assert.deepEqual(c.state.anchors, anchors);
  assert.deepEqual(c.snapshot, data);
  close();
});

test("saved and manually chosen cameras survive portrait resize, graph additions and restart without automatic refitting", async () => {
  let saved;
  const a = setup(fixture(), undefined, {
    persistence: {
      load: async () => null,
      save: async (state) => {
        saved = structuredClone(state);
      },
    },
  });
  a.n.target({
    ...a.n.camera,
    distance: 1234,
    yaw: -0.7,
    pitch: 0.2,
    sensitivity: 0.6,
  });
  const desired = a.n.bookmark();
  a.n.setViewport(560, 1000);
  const next = structuredClone(a.c.snapshot);
  next.resources.push({
    id: "new",
    title: "New note",
    kind: "note",
    project_id: "p",
  });
  a.c.update(next);
  assert.deepEqual(a.n.bookmark(), desired);
  await a.c.persist();
  const anchors = structuredClone(saved.anchors);
  a.close();
  const b = setup(
    next,
    { width: 560, height: 1000 },
    { persistence: { load: async () => saved, save: async () => {} } },
  );
  await b.c.restore();
  assert.deepEqual(b.n.bookmark(), desired);
  assert.deepEqual(b.c.state.anchors, anchors);
  b.n.zoom(1.01, "project:p");
  await new Promise(setImmediate);
  assert.equal(b.c.location.kind, "project");
  assert.equal(b.n.bookmark().distance, desired.distance / 1.01);
  b.n.zoom(1 / 1.01, "project:p");
  await new Promise(setImmediate);
  assert.equal(b.c.location.kind, "project");
  assert(Math.abs(b.n.bookmark().distance - desired.distance) < 1e-9);
  assert.deepEqual(b.c.state.anchors, anchors);
  b.close();
});

test("Universe approach thresholds and wheel-preserved close poses stay separate from the wider default overview", async () => {
  const { c, n, motion, close } = setup();
  await c.go({ kind: "universe" });
  n.fit("project:p");
  assert(
    n.bookmark().distance <= 3000,
    "Fit retains its existing star approach distance",
  );
  const target = n.position("project:p");
  n.target({ ...n.camera, target, distance: 3500 });
  settle(motion);
  c.zoom(1.1, "project:p");
  await new Promise(setImmediate);
  assert.equal(
    c.location.kind,
    "universe",
    "wide overview distance must not admit a premature project entry",
  );
  n.target({ ...n.bookmark(), target, distance: 1800 });
  settle(motion);
  c.zoom(1.1, "project:p");
  const dolly = n.bookmark();
  await new Promise(setImmediate);
  settle(motion);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  assert.deepEqual(n.bookmark(), dolly);
  assert(n.bookmark().distance < 1800);
  assert(n.defaultCamera().distance > 3000);
  close();
});

test("fresh large and small project overviews keep inward, outward and reversed wheel input in their own semantic band", async () => {
  for (const count of [0, 400]) {
    const snapshot = fixture(count);
    snapshot.navigation.projectId = null;
    const { c, n, motion, close } = setup(snapshot);
    await c.go({ kind: "project", projectId: "p" });
    settle(motion);
    const entry = n.bookmark();
    n.zoom(1.05, "project:p");
    await new Promise(setImmediate);
    assert.equal(
      c.location.kind,
      "project",
      "first inward wheel keeps the entered project",
    );
    n.zoom(1 / 1.05, "project:p");
    await new Promise(setImmediate);
    assert.equal(
      c.location.kind,
      "project",
      "outward reversal returns to the overview within its band",
    );
    assert(Math.abs(n.bookmark().distance - entry.distance) < 1e-9);
    n.zoom(0.9, "project:p");
    n.zoom(1.05, "project:p");
    await new Promise(setImmediate);
    assert.equal(
      c.location.kind,
      "project",
      "small alternating gestures do not switch scope",
    );
    n.zoom(0.5, "project:p");
    const outer = n.bookmark();
    await new Promise(setImmediate);
    settle(motion);
    assert.equal(
      c.location.kind,
      "universe",
      "deliberate departure beyond the overview band still works",
    );
    assert.deepEqual(
      n.bookmark(),
      outer,
      "scope change preserves the actual dolly pose",
    );
    close();
  }
});

test("foreign project positions do not widen this project's frame and extreme owned pins respect the existing camera bound", async () => {
  const snapshot = fixture();
  snapshot.projects.push({ id: "q", title: "Other project" });
  snapshot.resources.push({
    id: "foreign",
    title: "Foreign note",
    kind: "note",
    project_id: "q",
  });
  const { c, n, close } = setup(snapshot),
    before = n.defaultCamera();
  c.state.anchors["resource:unplaced:foreign"].spatial = {
    x: 5000000,
    y: 0,
    z: 0,
  };
  c.state.anchors["resource:unplaced:foreign"].pinned = true;
  n.updateGraph();
  assert.deepEqual(n.defaultCamera(), before);
  const key = "resource:unplaced:r0";
  c.state.anchors[key].spatial = { x: -5000000, y: 0, z: 0 };
  c.state.anchors[key].pinned = true;
  n.updateGraph();
  const pose = n.defaultCamera();
  assert.equal(pose.distance, 100000);
  assert(validSpatialCamera(pose));
  assert.deepEqual(n.position(key), { x: -5000000, y: 0, z: 0 });
  n.restore();
  n.zoom(0.9, "project:p");
  const outer = n.bookmark();
  await new Promise(setImmediate);
  assert.equal(
    c.location.kind,
    "universe",
    "maximum-distance pin cannot trap outward navigation",
  );
  assert.deepEqual(n.bookmark(), outer);
  close();
});
