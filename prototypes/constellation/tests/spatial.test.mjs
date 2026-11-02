import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, edges, validSpatialCamera } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

const fixture = (count = 18) => ({
  projects: [{ id: "p", title: "Synthetic project" }],
  workspaces: [
    { id: "w", title: "Development", project_id: "p" },
    { id: "w2", title: "Planning", project_id: "p" },
  ],
  resources: Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    title: `Synthetic ${i}`,
    kind: i % 3 === 0 ? "conversation" : i % 3 === 1 ? "note" : "task",
  })),
  blocks: Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    resource_id: `r${i}`,
    workspace_id: i % 2 ? "w" : "w2",
    x: i * 20,
    y: (i % 4) * 80,
    width: 300,
    height: 200,
    z: i,
  })),
  relationships: [
    {
      id: "edge1",
      source_id: "r0",
      target_id: "r1",
      kind: "references",
      provenance: "user",
    },
    {
      id: "edge2",
      source_id: "r1",
      target_id: "r2",
      kind: "depends_on",
      provenance: "inferred",
    },
  ],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "p" },
});
const setup = (s = fixture(), extra = {}) => {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: s,
      motion,
      navigate: async () => {},
      ...extra,
    });
  const navigation = new SpatialNavigator(c, () => {});
  c.spatial = navigation;
  return { c, motion, navigation };
};
const settle = (m) => {
  for (let i = 0; i < 180; i++) m.step(1 / 60);
};

test("orbit is damped, bounded, interruptible and reduced-motion compatible without a private RAF", () => {
  const { c, motion, navigation: n } = setup();
  const start = n.camera;
  n.orbit(150, 300);
  assert.deepEqual(n.camera, start);
  motion.step(0.04);
  assert.notEqual(n.camera.yaw, start.yaw);
  n.orbit(1e7, 1e7);
  settle(motion);
  assert.ok(Math.abs(n.camera.pitch) <= 1.2);
  n.interrupt();
  const stopped = n.camera;
  settle(motion);
  assert.deepEqual(n.camera, stopped);
  c.setPolicy({ reduced: true });
  n.zoom(2);
  assert.equal(motion.bodies.get(n.id).transitioning, false);
  assert.ok(validSpatialCamera(n.camera));
  c.dispose();
  assert.equal(motion.bodies.has(n.id), false);
});

test("3D node positions and pins survive new graph objects, resource removal and undo", async () => {
  const { c, navigation: n } = setup();
  await n.place("resource:b0", { x: 800, y: 240, z: -300 }, true);
  const saved = structuredClone(c.state.anchors);
  const next = fixture(19);
  c.update(next);
  for (const [key, a] of Object.entries(saved))
    assert.deepEqual(c.state.anchors[key], a);
  assert.deepEqual(n.position("resource:b0"), { x: 800, y: 240, z: -300 });
  await n.place("resource:b0", { x: 1, y: 2, z: 3 }, true);
  await n.undoPosition();
  assert.deepEqual(n.position("resource:b0"), { x: 800, y: 240, z: -300 });
  next.resources = next.resources.filter((r) => r.id !== "r0");
  c.update(next);
  assert.equal("resource:b0" in c.state.anchors, false);
});

test("restart restores orbit pose, mode, depth, pinned resources and selected neighborhood", async () => {
  let saved;
  const persist = {
    load: async () => saved,
    save: async (state) => {
      saved = state;
    },
  };
  const first = setup(fixture(), { persistence: persist });
  await first.navigation.place("resource:b0", { x: 112, y: 215, z: 320 });
  await first.navigation.explore("resource:b0");
  first.navigation.mode = "pan";
  first.navigation.orbit(80, -40);
  settle(first.motion);
  await first.c.persist();
  const expected = first.navigation.bookmark();
  const restored = setup(fixture(), { persistence: persist });
  await restored.c.restore();
  assert.deepEqual(restored.navigation.camera, expected);
  assert.deepEqual(restored.navigation.position("resource:b0"), {
    x: 112,
    y: 215,
    z: 320,
  });
  assert.equal(restored.c.state.anchors["resource:b0"].pinned, true);
});

test("canonical relationships, placements and branch lineage preserve distinct types and provenance", () => {
  const s = fixture();
  s.conversationBranches = [
    {
      parentResourceId: "r0",
      childResourceId: "r3",
      sourceMessageId: "m1",
      mode: "application_continuation",
      createdAt: "2026-11-01T00:00:00Z",
    },
  ];
  const { c, navigation: n } = setup(s);
  const all = edges(c);
  assert.ok(all.some((e) => e.kind === "workspace_placement"));
  assert.ok(all.some((e) => e.kind === "project_membership"));
  const branch = all.find((e) => e.id.startsWith("lineage:"));
  assert.equal(branch.sourceMessageId, "m1");
  assert.equal(branch.kind, "application_continuation");
  const parent = n.position("resource:b0"),
    child = n.position("resource:b3");
  assert.ok(
    Math.hypot(parent.x - child.x, parent.y - child.y, parent.z - child.z) <
      250,
  );
  s.resources[3].visible = false;
  c.update(s);
  assert.equal(
    edges(c).some((e) => e.id.startsWith("lineage:")),
    false,
  );
});

test("3D scene has actual heterogeneous geometry, perspective picking and graphics-loss recovery", () => {
  const { c, motion, navigation: n } = setup();
  c.select("workspace:w");
  n.fit("workspace:w");
  settle(motion);
  const layer = new ConstellationScene(c, n, () => ({
    left: 0,
    top: 0,
    bottom: 900,
    width: 1440,
    height: 900,
  }));
  layer.update(1440, 900);
  assert.ok(layer.objects.size > 0);
  const shapes = new Set();
  layer.scene.traverse((o) => {
    if (o.isMesh) shapes.add(o.geometry.type);
  });
  assert.ok(shapes.size >= 4);
  const point = layer.project("workspace:w", 1440, 900);
  assert.equal(layer.pick(point.x, point.y, 1440, 900)?.key, "workspace:w");
  layer.contextLost();
  assert.equal(layer.active, false);
  layer.contextRestored();
  assert.equal(layer.active, true);
  layer.dispose();
  assert.equal(layer.objects.size, 0);
});

test("actual scene object/label/edge allocations stay bounded with 10000 canonical resources", () => {
  const { c, navigation: n } = setup(fixture(10000));
  const layer = new ConstellationScene(c, n, () => ({
    left: 0,
    top: 0,
    bottom: 1080,
    width: 1920,
    height: 1080,
  }));
  for (const tier of ["cinematic", "balanced", "efficient"]) {
    c.setPolicy({ tier });
    const labels = layer.labels(1920, 1080);
    assert.ok(
      layer.objects.size <=
        (tier === "cinematic" ? 280 : tier === "balanced" ? 160 : 70),
    );
    assert.ok(labels.length <= 30);
    assert.ok(layer.diagnostics.edges <= 40);
  }
  layer.dispose();
});

test("graph mutation dispatch uses only supported typed service operations and refreshed canonical identities", async () => {
  const calls = [];
  const { c } = setup(fixture(), {
    capabilities: { createResource: true },
    graphAction: async (action) => {
      calls.push(action);
      return fixture(19);
    },
  });
  await c.act({
    type: "createResource",
    workspaceId: "w",
    title: "Synthetic new note",
    kind: "note",
  });
  assert.equal(c.nodes.has("resource:b18"), true);
  await assert.rejects(
    c.act({
      type: "branch",
      resourceId: "r0",
      messageId: "m",
      includeMessageIds: [],
      title: "Unsupported",
      providerId: "codex",
      tokenBudget: 1000,
    }),
    /unavailable/,
  );
  assert.equal(calls.length, 1);
});
