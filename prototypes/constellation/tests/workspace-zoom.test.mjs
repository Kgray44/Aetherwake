import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";

function fixture() {
  return {
    projects: [{ id: "p", title: "Project" }],
    workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
    resources: [
      { id: "r", title: "Chat", kind: "conversation", project_id: "p" },
    ],
    blocks: [
      {
        id: "b",
        resource_id: "r",
        workspace_id: "w",
        x: 20,
        y: 40,
        width: 320,
        height: 240,
        z: 0,
      },
    ],
    relationships: [],
    activeWorkspaceId: "w",
    navigation: { kind: "workspace", workspaceId: "w" },
  };
}
function setup(options = {}) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: fixture(),
      motion,
      navigate: async () => {},
      ...options,
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  return { c, n, motion };
}
const settle = (motion) => {
  for (let i = 0; i < 180; i++) motion.step(1 / 60);
};
const finish = async (motion) => {
  await new Promise(setImmediate);
  settle(motion);
};

test("wheel out of a working workspace reveals its project from the same anchor and damped orbit pose", async () => {
  const visits = [],
    { c, n, motion } = setup({
      navigate: async (destination) => visits.push(destination),
    }),
    before = structuredClone(c.snapshot);
  n.target({
    ...n.camera,
    target: n.position("workspace:w"),
    distance: 800,
    yaw: -0.84,
    pitch: 0.61,
  });
  settle(motion);
  const actual = n.camera;
  c.zoom(0.8);
  const desired = n.bookmark();
  assert.deepEqual(
    n.camera,
    actual,
    "input retargets the spring without snapping its current pose",
  );
  await finish(motion);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  assert.deepEqual(n.camera, desired);
  assert.equal(n.camera.distance, 1000);
  assert.deepEqual(n.camera.target, n.position("workspace:w"));
  assert.ok(n.candidateNodes().some((n) => n.kind === "project"));
  assert.deepEqual(
    c.snapshot,
    before,
    "camera travel never edits canonical working data",
  );
  assert.deepEqual(visits, [{ kind: "constellation", projectId: "p" }]);
  c.dispose();
});

test("inward wheel enters a workspace under the cursor without an earlier selection, then reverses outward continuously", async () => {
  const visits = [],
    { c, n, motion } = setup({
      navigate: async (destination) => visits.push(destination),
    });
  await c.go({ kind: "project", projectId: "p" });
  settle(motion);
  c.select("project:p");
  n.target({
    ...n.camera,
    target: n.position("project:p"),
    distance: 850,
    yaw: 0.7,
    pitch: -0.2,
  });
  settle(motion);
  c.zoom(1.3, "workspace:w");
  const approach = n.bookmark();
  await finish(motion);
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: "w" });
  assert.deepEqual(n.camera, approach);
  assert.deepEqual(n.camera.target, n.position("workspace:w"));
  assert.deepEqual(visits.at(-1), { kind: "workspace", workspaceId: "w" });
  c.zoom(0.9);
  const depart = n.bookmark();
  await finish(motion);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  assert.deepEqual(n.camera, depart);
  assert.equal(n.camera.yaw, 0.7);
  assert.equal(n.camera.pitch, -0.2);
  c.dispose();
});

test("keyboard zoom enters the selected workspace and reduced motion preserves the same semantic result", async () => {
  for (const reduced of [false, true]) {
    const { c, n, motion } = setup();
    c.setPolicy({ reduced });
    await c.go({ kind: "project", projectId: "p" });
    c.select("workspace:w");
    n.fit();
    settle(motion);
    c.zoom(1.3);
    const desired = n.bookmark();
    await finish(motion);
    assert.deepEqual(c.location, { kind: "workspace", workspaceId: "w" });
    assert.deepEqual(n.camera, desired);
    c.dispose();
  }
});

test("inward zoom can open a placed resource through the actual host editor contract", async () => {
  const opened = [],
    { c, n, motion } = setup({
      openResource: async (destination) => opened.push(destination),
    });
  await c.go({ kind: "project", projectId: "p" });
  n.target({ ...n.camera, target: n.position("resource:b"), distance: 440 });
  settle(motion);
  c.zoom(1.3, "resource:b");
  const desired = n.bookmark();
  await finish(motion);
  assert.deepEqual(c.location, {
    kind: "surface",
    workspaceId: "w",
    resourceId: "r",
    blockId: "b",
  });
  assert.deepEqual(opened, [
    { kind: "surface", resourceId: "r", workspaceId: "w", blockId: "b" },
  ]);
  assert.deepEqual(n.camera, desired);
  c.zoom(0.9);
  await finish(motion);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  c.dispose();
});

test("a failed semantic departure preserves location and history and reports the service error", async () => {
  const { c, n, motion } = setup({
      navigate: async () => {
        throw Error("service unavailable");
      },
    }),
    history = structuredClone(c.state.history);
  c.zoom(0.8);
  await finish(motion);
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: "w" });
  assert.deepEqual(c.state.history, history);
  assert.equal(c.error, "service unavailable");
  assert.deepEqual(n.camera.target, n.position("workspace:w"));
  c.dispose();
});

test("manual input and newer destinations supersede an awaited semantic workspace departure", async () => {
  let release,
    deferred = true;
  const { c, n, motion } = setup({
    navigate: () =>
      deferred
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(),
  });
  c.zoom(0.8);
  await new Promise(setImmediate);
  n.orbit(100, 30);
  n.pan(20, -15);
  const desired = n.bookmark();
  deferred = false;
  release();
  await finish(motion);
  assert.deepEqual(
    n.camera,
    desired,
    "late service success cannot reset the newer manual pose",
  );
  // A new direct destination also owns the serialized canonical result.
  await c.go({ kind: "workspace", workspaceId: "w" });
  deferred = true;
  c.zoom(0.8);
  await new Promise(setImmediate);
  const newer = c.go({ kind: "universe" });
  deferred = false;
  release();
  await newer;
  await finish(motion);
  assert.deepEqual(c.location, { kind: "universe" });
  c.dispose();
});

test("a standalone workspace zooms out to Universe and foreign or revoked cursor keys cannot enter", async () => {
  const snapshot = fixture();
  snapshot.workspaces[0].project_id = undefined;
  const { c, n, motion } = setup({ snapshot });
  c.zoom(0.8);
  await finish(motion);
  assert.deepEqual(c.location, { kind: "universe" });
  c.dispose();
  const other = fixture();
  other.projects.push({ id: "q", title: "Other" });
  other.workspaces.push({ id: "foreign", title: "Foreign", project_id: "q" });
  other.navigation = { kind: "constellation", projectId: "p" };
  const f = setup({ snapshot: other });
  f.n.target({ ...f.n.camera, distance: 500 });
  settle(f.motion);
  const target = f.n.camera.target;
  for (const key of ["workspace:foreign", "workspace:revoked"]) {
    f.c.zoom(1.3, key);
    await finish(f.motion);
    assert.deepEqual(f.c.location, { kind: "project", projectId: "p" });
    assert.deepEqual(f.n.camera.target, target);
  }
  f.c.dispose();
});
