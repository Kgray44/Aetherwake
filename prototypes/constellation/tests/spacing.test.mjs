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
const setup = (snapshot = fixture()) => {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
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

test("every camera pose keeps rendered silhouettes apart and the projected bounds contain actual mesh vertices", async () => {
  const { c, n, motion } = setup(fixture(120)),
    layer = new ConstellationScene(c, n, () => ({}));
  let checked = 0,
    decluttered = 0;
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
      decluttered += layer.diagnostics.overlapCulled;
      for (let a = 0; a < discs.length; a++)
        for (let b = a + 1; b < discs.length; b++)
          assert.ok(
            Math.hypot(discs[a].x - discs[b].x, discs[a].y - discs[b].y) >=
              discs[a].radius + discs[b].radius + 7.999,
          );
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
  assert.ok(decluttered > 0);
  for (let i = 0; i < 120; i++)
    assert.ok(
      c.search(`Resource ${i}`).some((node) => node.id === `r${i}`),
      "decluttering never removes canonical search destinations",
    );
  layer.dispose();
  c.dispose();
});
