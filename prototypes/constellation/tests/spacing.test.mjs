import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, hash } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
import { BODY_GAP, BODY_MAX_SCALE, bodyEnvelope } from "../body-metrics.ts";
import { BodySpace } from "../spacing.ts";

const fixture = (count = 80) => ({
  projects: Array.from({ length: 3 }, (_, i) => ({
    id: `p${i}`,
    title: `Project ${i}`,
  })),
  workspaces: Array.from({ length: 6 }, (_, i) => ({
    id: `w${i}`,
    project_id: `p${i % 3}`,
    title: `Workspace ${i}`,
  })),
  resources: Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    kind: i % 2 ? "note" : "conversation",
    title: `Resource ${i}`,
  })),
  blocks: Array.from({ length: count }, (_, i) => ({
    id: `b${i}`,
    resource_id: `r${i}`,
    workspace_id: `w${i % 6}`,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: i,
  })),
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "p0" },
});
const setup = (snapshot = fixture(), options = {}) => {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
      ...options,
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  return { c, n, motion };
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// Independent exhaustive check, rather than trusting the packing broad phase.
function clear(c, n) {
  const nodes = [...c.nodes.values()];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j],
        actual = distance(n.position(a.key), n.position(b.key)),
        minimum =
          bodyEnvelope(a.id, a.kind) + bodyEnvelope(b.id, b.kind) + BODY_GAP;
      assert.ok(
        actual >= minimum - 0.001,
        `${a.key} / ${b.key}: ${actual} < ${minimum}`,
      );
    }
}
const settle = (m) => {
  for (let i = 0; i < 180; i++) m.step(1 / 60);
};

test("upgrading legacy orbits keeps a clear saved project centered in its restored camera", async () => {
  const snapshot = fixture(0);
  snapshot.projects = snapshot.projects.slice(0, 1);
  snapshot.workspaces = snapshot.workspaces.filter(
    (w) => w.project_id === "p0",
  );
  let saved;
  const { c, n, motion } = setup(snapshot, {
    persistence: {
      load: async () => structuredClone(saved),
      save: async () => {},
    },
  });
  saved = structuredClone(c.state);
  const project = c.nodes.get("project:p0"),
    h = hash(project.key),
    old = { x: project.point.x, y: (h - 0.5) * 240, z: project.point.y * 0.8 };
  saved.anchors[project.key].spatial = old;
  for (const node of c.nodes.values())
    if (node.kind === "workspace") {
      const h = hash(node.key);
      saved.anchors[node.key].spatial = {
        x: old.x + Math.cos(h * Math.PI * 2) * 520,
        y: old.y + (h - 0.5) * 280,
        z: old.z + Math.sin(h * Math.PI * 2) * 520,
      };
    }
  saved.bookmarks[project.key] = {
    camera: c.camera,
    selected: project.key,
    spatial: { ...n.camera, target: old, distance: 1450 },
  };
  await c.restore();
  settle(motion);
  assert.deepEqual(
    n.position(project.key),
    old,
    "clear project centers never migrate merely to widen the grid",
  );
  assert.deepEqual(
    n.camera.target,
    old,
    "restored framing retains the original center",
  );
  clear(c, n);
  const scene = new ConstellationScene(c, n, () => ({}));
  scene.update(1440, 900);
  const screen = scene.project(project.key, 1440, 900);
  assert.ok(
    Math.abs(screen.x - 720) < 1e-7 && Math.abs(screen.y - 450) < 1e-7,
    "actual perspective projection stays centered",
  );
  assert.ok(scene.objects.has(project.key));
  scene.dispose();
  c.dispose();
});

test("clear saved pins keep full coordinate precision through graph refreshes", () => {
  const { c, n } = setup(),
    key = "resource:b0",
    point = { x: 30333.123456789, y: 0.333333333333, z: 9999.987654321 };
  c.state.anchors[key].spatial = { ...point };
  c.state.anchors[key].pinned = true;
  n.updateGraph();
  assert.deepEqual(n.position(key), point);
  c.update(fixture(81));
  assert.deepEqual(n.position(key), point);
  clear(c, n);
  c.dispose();
});

test("automatic positions leave a full geometry gap, vary parent distances, and stay stable as objects arrive", () => {
  const { c, n } = setup(fixture(1000));
  clear(c, n);
  for (const parent of ["project:p0", "workspace:w0"]) {
    const ds = [...c.nodes.values()]
      .filter((node) => node.parent === parent)
      .map((node) => distance(n.position(parent), n.position(node.key)));
    assert.ok(
      Math.max(...ds) - Math.min(...ds) > 30,
      "siblings have varied parent distances",
    );
  }
  const before = structuredClone(c.state.anchors),
    snapshot = fixture(1001);
  snapshot.conversationBranches = [
    {
      parentResourceId: "r0",
      childResourceId: "r1000",
      sourceMessageId: "m",
      mode: "application_continuation",
    },
  ];
  c.update(snapshot);
  for (const [key, anchor] of Object.entries(before))
    assert.deepEqual(c.state.anchors[key], anchor);
  clear(c, n);
  c.dispose();
});

test("legacy equal-distance orbits and conflicting pins are repaired deterministically without changing canonical data", () => {
  const snapshot = fixture(8),
    a = setup(snapshot),
    b = setup(structuredClone(snapshot)),
    source = structuredClone(snapshot);
  for (const { c, n } of [a, b]) {
    const parent = { x: -1500, y: (hash("project:p0") - 0.5) * 240, z: -400 };
    c.state.anchors["project:p0"].spatial = parent;
    for (const key of ["workspace:w0", "workspace:w3"]) {
      const h = hash(key);
      c.state.anchors[key].spatial = {
        x: parent.x + Math.cos(h * Math.PI * 2) * 520,
        y: parent.y + (h - 0.5) * 280,
        z: parent.z + Math.sin(h * Math.PI * 2) * 520,
      };
    }
    for (const key of ["resource:b0", "resource:b1"]) {
      c.state.anchors[key].spatial = { x: 30000, y: 200, z: 30000 };
      c.state.anchors[key].pinned = true;
    }
    n.updateGraph();
    clear(c, n);
    assert.deepEqual(n.position("resource:b0"), { x: 30000, y: 200, z: 30000 });
    assert.equal(c.state.anchors["resource:b1"].pinned, true);
    assert.match(n.notice, /Conflicting saved pins/);
    assert.deepEqual(c.snapshot, source);
  }
  assert.deepEqual(a.c.state.anchors, b.c.state.anchors);
  a.c.dispose();
  b.c.dispose();
});

test("dragging stops before an occupied body and commits the displayed position; arrangements and undo keep gaps", async () => {
  const { c, n } = setup(fixture(20));
  await n.place("resource:b0", { x: 30000, y: 0, z: 0 });
  await n.place("resource:b1", { x: 30400, y: 0, z: 0 });
  const desired = { x: 30800, y: 0, z: 0 },
    preview = n.previewMove("resource:b0", desired);
  assert.ok(preview.x > 30000 && preview.x < 30400);
  clear(c, n);
  n.cancelLayout();
  await n.place("resource:b0", preview);
  assert.deepEqual(n.position("resource:b0"), preview);
  clear(c, n);
  await n.place("resource:b0", n.position("resource:b1"));
  clear(c, n);
  for (const strategy of ["radial", "hierarchical"]) {
    const before = structuredClone(c.state.anchors);
    n.previewLayout(strategy);
    clear(c, n);
    await n.applyLayout();
    clear(c, n);
    await n.undoPosition();
    clear(c, n);
    for (const [key, anchor] of Object.entries(before)) {
      assert.deepEqual(c.state.anchors[key].spatial, anchor.spatial);
      assert.equal(
        c.state.anchors[key].pinned === true,
        anchor.pinned === true,
      );
    }
  }
  n.previewLayout("radial");
  c.update(fixture(21));
  clear(c, n);
  assert.equal(
    n.preview.size,
    0,
    "new canonical obstacles cancel stale previews",
  );
  c.dispose();
});

test("continuous sweeps catch crossing an obstacle even when the endpoint is clear", () => {
  const space = new BodySpace(),
    moving = { key: "moving", point: { x: 0, y: 0, z: 0 }, radius: 40 };
  space.set(moving);
  space.set({ key: "fixed", point: { x: 300, y: 0, z: 0 }, radius: 70 });
  const fraction = space.fraction([moving], { x: 600, y: 0, z: 0 });
  assert.ok(fraction > 0 && fraction < 0.5);
  assert.ok(300 - 600 * fraction >= 40 + 70 + BODY_GAP);
  assert.equal(space.fraction([moving], { x: -600, y: 0, z: 0 }), 1);
});

test("a large rigid cluster does not repeatedly rescan its own bodies as obstacles", () => {
  const space = new BodySpace(),
    count = 1000;
  for (let i = 0; i < count; i++)
    space.set({
      key: `moving:${i}`,
      point: { x: 0, y: i * 1000, z: 0 },
      radius: 20,
    });
  const moving = [...space.bodies.values()];
  let reads = 0;
  for (const body of moving) {
    const key = body.key;
    Object.defineProperty(body, "key", {
      get() {
        assert.ok(
          ++reads <= count * 32,
          "rigid-cluster broad phase must avoid quadratic self scans",
        );
        return key;
      },
    });
  }
  assert.equal(space.fraction(moving, { x: 100000, y: 100000, z: 100000 }), 1);
  assert.ok(
    reads <= count * 32,
    "deterministic work bound, independent of host timing",
  );
});

test("large-cluster fallback reuse still stops at the earliest fixed neighbor", () => {
  const space = new BodySpace(),
    count = 1000;
  for (let i = 0; i < count; i++)
    space.set({
      key: `moving:${i}`,
      point: { x: 0, y: i * 1000, z: 0 },
      radius: 20,
    });
  const moving = [...space.bodies.values()];
  space.set({ key: "pinned", point: { x: 500, y: 500, z: 500 }, radius: 20 });
  for (let i = 0; i < 64; i++)
    space.set({
      key: `distant:${i}`,
      point: { x: 1000000 + i * 1000, y: 0, z: 0 },
      radius: 20,
    });
  let reads = 0;
  for (const body of space.bodies.values()) {
    const key = body.key;
    Object.defineProperty(body, "key", {
      get() {
        assert.ok(
          ++reads <= count * 32,
          "long sweeps must reuse their fixed fallback",
        );
        return key;
      },
    });
  }
  const fraction = space.fraction(moving, { x: 100000, y: 100000, z: 100000 }),
    expected = (500 - (40 + BODY_GAP + 0.04) / Math.sqrt(3)) / 100000 - 1e-5;
  assert.ok(Math.abs(fraction - expected) < 1e-12);
  assert.ok(Math.sqrt(3) * (500 - 100000 * fraction) >= 40 + BODY_GAP);
});

test("orbit retains aligned bodies, physical gaps and projected bounds containing actual mesh vertices", async () => {
  const { c, n, motion } = setup(fixture(120)),
    layer = new ConstellationScene(c, n, () => ({}));
  let checked = 0,
    aligned = 0;
  for (const location of [
    { kind: "project", projectId: "p0" },
    { kind: "universe" },
  ]) {
    await c.go(location);
    settle(motion);
    const base = n.camera;
    for (let i = 0; i < 8; i++) {
      n.target({
        ...base,
        yaw: (i * Math.PI) / 4,
        pitch: i % 2 ? 0.7 : -0.3,
        distance: base.distance * (i % 3 ? 1 : 0.7),
      });
      settle(motion);
      layer.update(1440, 900);
      const discs = layer.diagnostics.projectedBodies;
      assert.equal(layer.diagnostics.overlapCulled, 0);
      for (let a = 0; a < discs.length; a++)
        for (let b = a + 1; b < discs.length; b++)
          if (
            Math.hypot(discs[a].x - discs[b].x, discs[a].y - discs[b].y) >=
            discs[a].radius + discs[b].radius + 8
          )
            continue;
          else aligned++;
      for (const disc of discs) {
        const root = layer.objects.get(disc.key),
          center = root.position.clone();
        root.scale.setScalar(BODY_MAX_SCALE);
        root.updateMatrixWorld(true);
        root.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const vertices = mesh.geometry.attributes.position;
          for (let k = 0; k < vertices.count; k++) {
            const world = new THREE.Vector3()
              .fromBufferAttribute(vertices, k)
              .applyMatrix4(mesh.matrixWorld);
            assert.ok(
              world.distanceTo(center) <= n.radius(disc.key) + 0.001,
              "world envelope includes ring, air and emphasis",
            );
            const p = world.project(layer.camera);
            assert.ok(
              Math.hypot(
                (p.x * 0.5 + 0.5) * 1440 - disc.x,
                (-p.y * 0.5 + 0.5) * 900 - disc.y,
              ) <=
                disc.radius + 0.001,
              "projected envelope includes off-axis mesh",
            );
          }
        });
        checked++;
      }
    }
  }
  assert.ok(checked > 20);
  assert.ok(aligned > 0, "normal depth-aligned sightlines retain both bodies");
  for (let i = 0; i < 120; i++)
    assert.ok(
      c.search(`Resource ${i}`).some((node) => node.id === `r${i}`),
      "decluttering never removes canonical search destinations",
    );
  layer.dispose();
  c.dispose();
});
