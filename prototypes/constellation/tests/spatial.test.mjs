import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, edges, validSpatialCamera } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
import { randomUUID } from "node:crypto";
import { planetAppearance } from "../planets.ts";
import * as THREE from "three";

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
const groupedFixture = () => {
  const s = fixture();
  s.resources.push({
    id: "group",
    title: "Synthetic task group",
    kind: "task_group",
    project_id: "p",
  });
  s.blocks.push({
    id: "bg",
    resource_id: "group",
    workspace_id: "w2",
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    z: 20,
  });
  s.relationships.push({
    id: "contains",
    source_id: "group",
    target_id: "r2",
    kind: "contains_task",
    provenance: "user",
  });
  return s;
};
const settle = (m) => {
  for (let i = 0; i < 180; i++) m.step(1 / 60);
};

test("manual camera input during a pending destination keeps its new pose on arrival", async () => {
  let release;
  const {
    c,
    motion,
    navigation: n,
  } = setup(fixture(), {
    navigate: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const travel = c.go({ kind: "universe" });
  await new Promise(setImmediate);
  n.orbit(90, -30);
  n.pan(80, 20);
  const desired = n.bookmark();
  release();
  await travel;
  settle(motion);
  assert.equal(c.location.kind, "universe");
  assert.deepEqual(n.camera, desired);
  c.dispose();
});

test("wheel zoom crosses project and universe scope without resetting the continuous camera", async () => {
  const visits = [];
  const {
    c,
    motion,
    navigation: n,
  } = setup(fixture(), {
    navigate: async (destination) => {
      visits.push(destination);
    },
  });
  n.zoom(0.4);
  const outer = n.bookmark();
  await new Promise(setImmediate);
  settle(motion);
  assert.equal(c.location.kind, "universe");
  assert.deepEqual(n.camera, outer);
  c.select("project:p");
  n.zoom(3);
  const inner = n.bookmark();
  await new Promise(setImmediate);
  settle(motion);
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  assert.deepEqual(n.camera, inner);
  assert.deepEqual(visits, [
    { kind: "constellation", projectId: null },
    { kind: "constellation", projectId: "p" },
  ]);
  c.dispose();
});

test("body emphasis shares the host spring and small bodies lose detail, with no orphaned motion", () => {
  const { c, motion, navigation: n } = setup();
  let wakes = 0;
  const scene = new ConstellationScene(
    c,
    n,
    () => ({}),
    () => {
      wakes++;
    },
  );
  scene.update(1440, 900);
  const key = "project:p",
    root = scene.objects.get(key);
  assert.ok(root);
  settle(motion);
  scene.update(1440, 900);
  c.select(key);
  scene.update(1440, 900);
  assert.equal(root.scale.x, 1);
  motion.step(0.04);
  scene.update(1440, 900);
  assert.ok(root.scale.x > 1 && root.scale.x < 1.08);
  c.setPolicy({ reduced: true });
  scene.update(1440, 900);
  assert.equal(root.scale.x, 1.08);
  const closeCount = root.userData.body.geometry.attributes.position.count;
  n.target({ ...n.camera, distance: 40000 });
  scene.update(1440, 900);
  assert.ok(root.userData.body.geometry.attributes.position.count < closeCount);
  assert.equal(root.userData.body.material.uniforms.uDetail.value, 0);
  assert.ok(wakes > 0);
  scene.dispose();
  assert.equal(
    [...motion.bodies.keys()].some((id) => id.includes(":body:")),
    false,
  );
  c.dispose();
});

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

test("panning follows the perspective camera plane with the same pixel scale at different viewport heights", () => {
  const { c, navigation: n } = setup();
  c.setPolicy({ reduced: true });
  const start = { ...n.camera, yaw: 0.7, pitch: 0.8 };
  n.target(start);
  const camera = new THREE.PerspectiveCamera(43, 1, 1, 100000),
    cp = Math.cos(start.pitch);
  camera.position.set(
    start.target.x + Math.sin(start.yaw) * cp * start.distance,
    start.target.y + Math.sin(start.pitch) * start.distance,
    start.target.z + Math.cos(start.yaw) * cp * start.distance,
  );
  camera.lookAt(start.target.x, start.target.y, start.target.z);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    forward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  n.pan(70, 40, 900);
  const actual = n.bookmark().target,
    delta = new THREE.Vector3(
      actual.x - start.target.x,
      actual.y - start.target.y,
      actual.z - start.target.z,
    ),
    scale = (2 * start.distance * Math.tan((43 * Math.PI) / 360)) / 900;
  assert.ok(Math.abs(delta.dot(right) - 70 * scale) < 1e-8);
  assert.ok(Math.abs(delta.dot(up) - 40 * scale) < 1e-8);
  assert.ok(Math.abs(delta.dot(forward)) < 1e-8);
  n.target(start);
  n.pan(70, 40, 1800);
  const smaller = n.bookmark().target;
  assert.ok(Math.abs(smaller.x - start.target.x - delta.x * 0.5) < 1e-8);
  c.dispose();
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

test("explicit task membership clusters only the same-workspace placement and retains canonical workspace edges", () => {
  const s = groupedFixture();
  s.blocks.push({
    id: "shared-task",
    resource_id: "r2",
    workspace_id: "w",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: 21,
  });
  const before = structuredClone(s),
    { c, navigation: n } = setup(s);
  assert.equal(c.nodes.get("resource:b2").parent, "resource:bg");
  assert.equal(c.nodes.get("resource:shared-task").parent, "workspace:w");
  assert.equal(c.nodes.get("resource:b2").resourceId, "r2");
  assert.ok(n.candidateNodes().some((node) => node.key === "resource:b2"));
  const all = edges(c);
  assert.ok(
    all.some(
      (e) =>
        e.kind === "contains_task" &&
        e.sourceId === "group" &&
        e.targetId === "r2",
    ),
  );
  assert.ok(
    all.some(
      (e) =>
        e.id === "membership:resource:b2" &&
        e.kind === "workspace_placement" &&
        e.targetId === "w2",
    ),
  );
  assert.deepEqual(s, before);
  c.dispose();
});

test("hidden, unavailable, inferred and ambiguous group links never invent a parent or ownership", () => {
  for (const scenario of [
    "hidden",
    "unavailable",
    "inferred",
    "reversed",
    "non-task",
    "ambiguous",
  ]) {
    const s = groupedFixture();
    if (scenario === "hidden") s.resources.at(-1).visible = false;
    if (scenario === "unavailable") s.resources.at(-1).available = false;
    if (scenario === "inferred") s.relationships.at(-1).provenance = "inferred";
    if (scenario === "reversed")
      [s.relationships.at(-1).source_id, s.relationships.at(-1).target_id] = [
        "r2",
        "group",
      ];
    if (scenario === "non-task") s.resources[2].kind = "note";
    if (scenario === "ambiguous") {
      s.resources.push({
        id: "group2",
        title: "Second group",
        kind: "task_group",
      });
      s.blocks.push({ ...s.blocks.at(-1), id: "bg2", resource_id: "group2" });
      s.relationships.push({
        ...s.relationships.at(-1),
        id: "contains2",
        source_id: "group2",
      });
    }
    const { c } = setup(s);
    assert.equal(c.nodes.get("resource:b2").parent, "workspace:w2", scenario);
    if (scenario === "hidden")
      assert.equal(c.search("Synthetic task group").length, 0);
    if (scenario === "ambiguous")
      assert.equal(
        edges(c).filter((e) => e.kind === "contains_task").length,
        2,
      );
    c.dispose();
  }
});

test("new task-group membership retains saved XYZ and coherent unpinned cluster movement", async () => {
  const { c, navigation: n } = setup();
  const original = { ...n.position("resource:b2") };
  c.update(groupedFixture());
  assert.deepEqual(n.position("resource:b2"), original);
  const group = n.position("resource:bg");
  await n.place("resource:bg", {
    x: group.x + 100,
    y: group.y + 20,
    z: group.z + 40,
  });
  assert.deepEqual(n.position("resource:b2"), {
    x: Math.round((original.x + 100) * 1000) / 1000,
    y: Math.round((original.y + 20) * 1000) / 1000,
    z: Math.round((original.z + 40) * 1000) / 1000,
  });
  const pinned = { ...n.position("resource:b2") };
  await n.place("resource:b2", pinned, true);
  await n.place("resource:bg", group);
  assert.deepEqual(n.position("resource:b2"), pinned);
  await n.explore("resource:b2");
  const keys = new Set(n.candidateNodes().map((node) => node.key));
  for (const key of ["resource:bg", "resource:b2", "workspace:w2", "project:p"])
    assert.ok(keys.has(key));
  c.dispose();
});

test("grouped tasks retain accessible selected labels without the 3D renderer", () => {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: groupedFixture(),
      motion,
      navigate: async () => {},
    });
  c.select("resource:b2");
  c.fit();
  settle(motion);
  assert.ok(c.visible(1440, 900).some((node) => node.key === "resource:b2"));
  c.dispose();
});

test("3D scene has real planetary geometry, perspective picking and graphics-loss recovery", () => {
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
  assert.ok(shapes.has("SphereGeometry"));
  const point = layer.project("workspace:w", 1440, 900);
  assert.equal(layer.pick(point.x, point.y, 1440, 900)?.key, "workspace:w");
  layer.contextLost();
  assert.equal(layer.active, false);
  layer.contextRestored();
  assert.equal(layer.active, true);
  layer.dispose();
  assert.equal(layer.objects.size, 0);
});

test("planet and moon appearances are stable per canonical identity, varied and texture-free", () => {
  const a = planetAppearance("canonical-conversation", "resource");
  assert.deepEqual(a, planetAppearance("canonical-conversation", "resource"));
  const signatures = new Set();
  const types = new Set();
  for (let i = 0; i < 10000; i++) {
    const p = planetAppearance(
      "canonical-object-" + i,
      i % 3 === 0 ? "project" : i % 3 === 1 ? "workspace" : "resource",
    );
    signatures.add(JSON.stringify(p));
    types.add(p.type);
    assert.ok(p.palette.flat().every(Number.isFinite));
  }
  assert.equal(signatures.size, 10000);
  assert.equal(types.size, 5);
  const { c, navigation } = setup(),
    scene = new ConstellationScene(c, navigation, () => ({
      left: 0,
      top: 0,
      bottom: 900,
      width: 1440,
      height: 900,
    }));
  scene.update(1440, 900);
  for (const object of scene.objects.values()) {
    assert.ok(object.children.length <= 3);
    object.traverse((o) => {
      if (o.isMesh) assert.equal(o.material.map, undefined);
    });
  }
  scene.dispose();
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

test("moving a workspace carries its unpinned resource cluster and undo restores the whole operation", async () => {
  const { c, navigation: n } = setup();
  const original = structuredClone(c.snapshot);
  await n.place("resource:b1", { x: 111, y: 222, z: 333 }, true);
  const fixed = n.position("resource:b1"),
    old = n.position("resource:b3"),
    w = n.position("workspace:w");
  const applied = await n.place("workspace:w", {
    x: w.x + 100,
    y: w.y + 20,
    z: w.z + 30,
  });
  assert.deepEqual(n.position("resource:b1"), fixed);
  // A pinned neighbor may constrain the requested move; the whole unpinned
  // cluster must still follow the same applied translation.
  for (const axis of ["x", "y", "z"])
    assert.ok(
      Math.abs(
        n.position("resource:b3")[axis] - old[axis] - applied[axis] + w[axis],
      ) < 0.002,
    );
  await n.undoPosition();
  assert.deepEqual(n.position("workspace:w"), w);
  assert.deepEqual(n.position("resource:b3"), old);
  assert.deepEqual(c.snapshot, original);
});

test("automatic arrangements are previewable, cancelable and undoable while respecting pins", async () => {
  let saves = 0;
  const { c, navigation: n } = setup(fixture(), {
    persistence: {
      load: async () => null,
      save: async () => {
        saves++;
      },
    },
  });
  await n.place("workspace:w", { x: 900, y: 100, z: 300 }, true);
  const before = structuredClone(c.state.anchors),
    count = saves;
  n.previewLayout("radial");
  assert.equal(saves, count);
  assert.deepEqual(c.state.anchors, before);
  assert.deepEqual(n.position("workspace:w"), before["workspace:w"].spatial);
  n.cancelLayout();
  assert.deepEqual(n.position("workspace:w2"), before["workspace:w2"].spatial);
  n.previewLayout("hierarchical");
  await n.applyLayout();
  assert.notDeepEqual(
    n.position("workspace:w2"),
    before["workspace:w2"].spatial,
  );
  await n.undoPosition();
  for (const [key, a] of Object.entries(before))
    assert.deepEqual(c.state.anchors[key].spatial, a.spatial);
});

test("authorized cross-project links appear in a resource neighborhood without inventing ownership", async () => {
  const s = fixture();
  s.projects.push({ id: "other", title: "Other synthetic project" });
  s.workspaces.push({
    id: "other-w",
    project_id: "other",
    title: "Other workspace",
  });
  s.resources.push({ id: "other-r", kind: "note", title: "Other resource" });
  s.blocks.push({
    id: "other-b",
    resource_id: "other-r",
    workspace_id: "other-w",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: 0,
  });
  s.relationships.push({
    id: "cross",
    source_id: "r0",
    target_id: "other-r",
    kind: "references",
    provenance: "user",
  });
  const { c, navigation: n } = setup(s);
  await n.explore("resource:b0");
  const keys = new Set(n.candidateNodes().map((n) => n.key));
  assert.ok(keys.has("resource:other-b"));
  assert.ok(keys.has("project:other"));
  assert.equal(
    c.snapshot.workspaces.find((w) => w.id === "other-w").project_id,
    "other",
  );
});

test("unplaced canonical resources remain in their project graph and cannot fabricate an editor placement", async () => {
  const s = fixture();
  s.resources[0].project_id = "p";
  s.blocks = s.blocks.filter((b) => b.resource_id !== "r0");
  const { c } = setup(s);
  assert.ok(c.nodes.has("resource:unplaced:r0"));
  assert.ok(edges(c).some((e) => e.id === "edge1"));
  assert.ok(
    edges(c).some(
      (e) => e.sourceId === "r0" && e.kind === "resource_project_membership",
    ),
  );
  await assert.rejects(c.approach("resource:unplaced:r0"), /unplaced/);
  assert.equal(c.snapshot.resources.length, 18);
});

test("revoked resource focus is pruned from spatial bookmarks and camera history", async () => {
  const { c, navigation: n } = setup();
  await n.explore("resource:b0");
  await c.persist();
  const s = fixture();
  s.resources = s.resources.filter((r) => r.id !== "r0");
  c.update(s);
  await c.persist();
  assert.equal(JSON.stringify(c.state).includes("resource:b0"), false);
  assert.equal(n.neighborhood, undefined);
});

test("10000 UUID placement positions fit the private 2MiB view-state bound without content", async () => {
  const s = fixture(10000);
  for (const b of s.blocks) b.id = randomUUID();
  const { c } = setup(s);
  await c.persist();
  const json = JSON.stringify(c.state);
  assert.ok(Buffer.byteLength(json) < 2 * 1024 * 1024);
  assert.equal(json.includes("Synthetic project"), false);
  assert.equal(json.includes("conversation"), false);
});

test("shared renderer pass restores host state after failure and reports only its own submissions", () => {
  const { c, navigation } = setup(),
    layer = new ConstellationScene(c, navigation, () => ({
      left: 10,
      top: 10,
      bottom: 890,
      width: 1420,
      height: 880,
    }));
  let viewport = [0, 0, 1440, 900],
    scissor = [0, 0, 1440, 900],
    scissorTest = false;
  const renderer = {
    autoClear: true,
    info: { autoReset: false, render: { calls: 100, triangles: 1000 } },
    getViewport: (v) => v.set(...viewport),
    getScissor: (v) => v.set(...scissor),
    getScissorTest: () => scissorTest,
    setViewport: (...v) => {
      viewport = v.length === 1 ? v[0].toArray() : v;
    },
    setScissor: (...v) => {
      scissor = v.length === 1 ? v[0].toArray() : v;
    },
    setScissorTest: (v) => (scissorTest = v),
    clearDepth: () => {},
    render: () => {
      renderer.info.render.calls += 7;
      renderer.info.render.triangles += 80;
    },
  };
  const frame = {
    width: 1440,
    height: 900,
    time: 0,
    quality: "balanced",
    reduced: false,
    quiet: false,
  };
  layer.render(renderer, frame);
  assert.equal(layer.diagnostics.drawCalls, 7);
  assert.equal(layer.diagnostics.triangles, 80);
  renderer.render = () => {
    throw Error("GPU loss");
  };
  assert.throws(() => layer.render(renderer, frame), /GPU loss/);
  assert.deepEqual(viewport, [0, 0, 1440, 900]);
  assert.deepEqual(scissor, [0, 0, 1440, 900]);
  assert.equal(scissorTest, false);
  assert.equal(renderer.autoClear, true);
  layer.dispose();
});

test("a visible scene object can be archived or detached without stale picking/cache failure", () => {
  const { c, navigation } = setup(),
    layer = new ConstellationScene(c, navigation, () => ({
      left: 0,
      top: 0,
      bottom: 900,
      width: 1440,
      height: 900,
    }));
  layer.update(1440, 900);
  const visible = [...layer.objects.keys()].find((k) =>
    k.startsWith("resource:"),
  );
  assert.ok(visible);
  const id = c.nodes.get(visible).resourceId,
    next = fixture();
  next.resources = next.resources.filter((r) => r.id !== id);
  c.update(next);
  assert.doesNotThrow(() => layer.update(1440, 900));
  assert.equal(layer.objects.has(visible), false);
  layer.dispose();
});

test("a canonical refresh changes a cached connection's provenance and removes revoked edges", async () => {
  const { c, motion, navigation } = setup(fixture(2)),
    layer = new ConstellationScene(c, navigation, () => ({}));
  await navigation.place("resource:b0", { x: 10000, y: 0, z: 0 });
  await navigation.place("resource:b1", { x: 12000, y: 0, z: 0 });
  navigation.target({
    ...navigation.camera,
    target: { x: 11000, y: 0, z: 0 },
    distance: 4000,
    yaw: 0,
    pitch: 0,
  });
  settle(motion);
  layer.update(1440, 900);
  const line = () =>
    layer.scene.children
      .flatMap((group) => group.children)
      .find((o) => o.userData.edge === "edge1");
  assert.equal(line().material.type, "LineBasicMaterial");
  const next = fixture(2);
  next.relationships[0].provenance = "inferred";
  c.update(next);
  layer.update(1440, 900);
  assert.equal(line().material.type, "LineDashedMaterial");
  next.resources[0].visible = false;
  c.update(next);
  layer.update(1440, 900);
  assert.equal(line(), undefined);
  layer.dispose();
  c.dispose();
});

test("a distant culled moon remains searchable and becomes visible when fitted", async () => {
  const { c, motion, navigation: n } = setup(),
    layer = new ConstellationScene(c, n, () => ({}));
  await n.place("resource:b0", { x: 50000, y: 400, z: 50000 });
  layer.update(1440, 900);
  assert.equal(layer.objects.has("resource:b0"), false);
  assert.ok(c.search("Synthetic 0").some((node) => node.key === "resource:b0"));
  c.select("resource:b0");
  n.fit();
  settle(motion);
  layer.update(1440, 900);
  assert.equal(layer.objects.has("resource:b0"), true);
  layer.dispose();
  c.dispose();
});

test("scope changes refresh the rendered bodies even with an identical camera pose", async () => {
  const { c, navigation: n } = setup(),
    layer = new ConstellationScene(c, n, () => ({}));
  layer.update(1440, 900);
  assert.ok(
    [...layer.objects.keys()].some((key) => key.startsWith("resource:")),
  );
  await c.go({ kind: "universe" }, undefined, n.camera);
  layer.update(1440, 900);
  assert.ok(
    [...layer.objects.keys()].every((key) => key.startsWith("project:")),
  );
  layer.dispose();
  c.dispose();
});

test("small project and universe views retain discoverable labels for every visible semantic anchor", async () => {
  const s = fixture(2);
  s.projects.push({ id: "second", title: "Second project" });
  s.workspaces.push({
    id: "second-w",
    title: "Second workspace",
    project_id: "second",
  });
  const { c, motion, navigation: n } = setup(s);
  const p = n.position("project:p");
  await n.place("workspace:w", { x: p.x + 367, y: p.y + 105, z: p.z - 367 });
  n.target({ ...n.camera, target: p, distance: 1900 });
  settle(motion);
  const scene = new ConstellationScene(c, n, () => ({
    left: 0,
    top: 0,
    bottom: 460,
    width: 1570,
    height: 460,
  }));
  let labels = scene.labels(1570, 460);
  assert.ok(labels.some((l) => l.node.key === "workspace:w"));
  assert.ok(labels.some((l) => l.node.key === "workspace:w2"));
  await c.go({ kind: "universe" });
  settle(motion);
  labels = scene.labels(1570, 460);
  assert.ok(labels.some((l) => l.node.key === "project:p"));
  assert.ok(labels.some((l) => l.node.key === "project:second"));
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.ok(
        Math.abs(labels[i].x - labels[j].x) >= 180 ||
          Math.abs(labels[i].y - labels[j].y) >= 52,
      );
  scene.dispose();
});

test("spatial labels avoid real UI rectangles as toolbars wrap and panels open without losing the independent workspace", () => {
  const s = {
    projects: [],
    workspaces: [
      { id: "standalone", title: "Synthetic Vela alignment", project_id: null },
    ],
    resources: [],
    blocks: [],
    relationships: [],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: null },
  };
  const { c, navigation: n } = setup(s);
  let blockers = [{ left: 24, top: 192, right: 900, bottom: 240 }];
  const scene = new ConstellationScene(
    c,
    n,
    () => ({}),
    () => {},
    () => blockers,
  );
  const check = (width, height) => {
    const label = scene
      .labels(width, height)
      .find((p) => p.node.key === "workspace:standalone");
    assert.ok(label, "independent workspace remains discoverable");
    for (const r of blockers)
      assert.ok(
        label.x + 95 <= r.left ||
          label.x - 95 >= r.right ||
          label.y + 34 <= r.top ||
          label.y - 34 >= r.bottom,
        "reserved UI stays clear of the entire two-line label",
      );
    return label;
  };
  const original = check(1020, 260);
  blockers.push({
    left: original.x - 100,
    top: original.y - 40,
    right: original.x + 100,
    bottom: original.y + 40,
  });
  const changed = check(1020, 260);
  assert.notDeepEqual([changed.x, changed.y], [original.x, original.y]);
  blockers = [
    { left: 0, top: 0, right: 720, bottom: 25 },
    { left: 20, top: 110, right: 680, bottom: 200 },
  ];
  check(720, 200);
  blockers = [
    { left: 0, top: 0, right: 1400, bottom: 30 },
    { left: 20, top: 320, right: 1100, bottom: 380 },
    { left: 960, top: 50, right: 1400, bottom: 500 },
  ];
  check(1400, 500);
  assert.ok(
    c
      .search("Synthetic Vela alignment")
      .some((node) => node.id === "standalone"),
  );
  scene.dispose();
  c.dispose();
});
