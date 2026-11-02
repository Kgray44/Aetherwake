import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, edges } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
import { RelationshipFilament } from "../relationship-filaments.ts";

function fixture(count = 4) {
  return {
    projects: [{ id: "p", title: "Project" }],
    workspaces: [0, 1].map((i) => ({
      id: `w${i}`,
      title: `Workspace ${i}`,
      project_id: "p",
    })),
    resources: Array.from({ length: count }, (_, i) => ({
      id: `r${i}`,
      title: `Resource ${i}`,
      kind: i === 0 ? "task_group" : i === 1 ? "task" : "conversation",
      project_id: "p",
    })),
    blocks: Array.from({ length: count }, (_, i) => ({
      id: `b${i}`,
      resource_id: `r${i}`,
      workspace_id: `w${i % 2}`,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: i,
    })),
    relationships: Array.from({ length: count - 1 }, (_, i) => ({
      id: `edge${i}`,
      source_id: `r${i}`,
      target_id: `r${i + 1}`,
      kind: i === 0 ? "contains_task" : "references",
      provenance: i === 1 ? "inferred" : "user",
    })),
    conversationBranches: [
      {
        parentResourceId: "r2",
        childResourceId: "r3",
        sourceMessageId: "synthetic-message",
        mode: "app_continuation",
      },
    ],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: "p" },
  };
}
function setup(count = 4) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: fixture(count),
      motion,
      navigate: async () => {},
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  const scene = new ConstellationScene(c, n, () => ({}));
  const pose = (values, width = 1280, height = 800) => {
    n.target({ ...n.camera, ...values });
    for (let i = 0; i < 180; i++) motion.step(1 / 60);
    scene.update(width, height);
  };
  return {
    c,
    n,
    scene,
    pose,
    dispose() {
      scene.dispose();
      c.dispose();
    },
  };
}
const lines = (scene) =>
  scene.links.children.filter((child) => child.userData.edge);
const ids = (scene) => lines(scene).map((line) => line.userData.edge);

test("off-screen endpoints never erase an on-screen relationship middle", async () => {
  const { c, n, scene, pose, dispose } = setup(),
    origin = n.position("project:p");
  await n.place("resource:b0", {
    x: origin.x - 1800,
    y: origin.y,
    z: origin.z,
  });
  await n.place("resource:b1", {
    x: origin.x + 1800,
    y: origin.y,
    z: origin.z,
  });
  pose({ target: origin, yaw: 0, pitch: 0, distance: 6000 });
  const before = lines(scene).find((line) => line.userData.edge === "edge0");
  assert.ok(before, "the existing connection starts in view");
  pose({ target: origin, yaw: 0, pitch: 0, distance: 1800 });
  const submitted = new Set(
    scene.diagnostics.projectedBodies.map((p) => p.key),
  );
  assert.equal(submitted.has("resource:b0"), false);
  assert.equal(submitted.has("resource:b1"), false);
  const middle = new THREE.Vector3(origin.x, origin.y + 95, origin.z).project(
    scene.camera,
  );
  assert.ok(
    Math.abs(middle.x) < 1 && Math.abs(middle.y) < 1 && Math.abs(middle.z) < 1,
  );
  assert.equal(
    lines(scene).find((line) => line.userData.edge === "edge0"),
    before,
    "body-frustum changes must not dispose a still-visible curve",
  );
  const anchors = structuredClone(c.state.anchors);
  pose({ yaw: 0.1, pitch: 0.15, distance: 700 });
  assert.equal(
    lines(scene).find((line) => line.userData.edge === "edge0"),
    before,
  );
  assert.deepEqual(c.state.anchors, anchors);
  dispose();
});

test("typed project/workspace/family/branch links keep geometry and context through orbit, pan, zoom and quality changes", () => {
  const { c, n, scene, pose, dispose } = setup();
  pose({ target: n.position("project:p"), distance: 6000 });
  const initial = lines(scene),
    expected = new Set(edges(c).map((e) => e.id)),
    geometry = initial.map((line) => line.geometry),
    cache = scene.scopedEdges;
  assert.deepEqual(new Set(ids(scene)), expected);
  assert.ok(expected.has("membership:workspace:w0"));
  assert.ok(expected.has("membership:resource:b0"));
  assert.ok([...expected].some((id) => id.startsWith("lineage:")));
  for (const tier of ["efficient", "balanced", "cinematic"]) {
    c.setPolicy({ tier });
    for (const distance of [180, 1200, 12000, 100000]) {
      for (let i = 0; i < 8; i++) {
        pose({
          yaw: (i * Math.PI) / 4,
          pitch: i % 2 ? -0.6 : 0.75,
          distance,
          target: {
            ...n.position("project:p"),
            x: n.position("project:p").x + (i % 3) * 200,
          },
        });
        assert.deepEqual(lines(scene), initial);
        assert.deepEqual(
          lines(scene).map((line) => line.geometry),
          geometry,
        );
        assert.equal(
          scene.scopedEdges,
          cache,
          "camera/tier changes do not repeat graph resolution/sort",
        );
        assert.deepEqual(new Set(ids(scene)), expected);
        for (const line of initial) {
          assert.ok(line.isLine2 && line.material.isLineMaterial);
          assert.equal(line.frustumCulled, false);
          assert.ok(line.material.linewidth >= 1.5);
          assert.equal(line.material.worldUnits, false);
          assert.equal(line.material.depthTest, true);
          assert.equal(line.material.depthWrite, false);
          assert.equal(line.material.side, THREE.DoubleSide);
          assert.ok(line.material.opacity >= 0.5);
          assert.deepEqual(line.material.resolution.toArray(), [1280, 800]);
          assert.ok(
            Number.isFinite(line.material.dashScale) &&
              line.material.dashScale > 0,
          );
        }
      }
    }
  }
  c.select("resource:b0");
  scene.update(1280, 800);
  assert.deepEqual(
    new Set(ids(scene)),
    expected,
    "selection emphasizes incident links without erasing context",
  );
  dispose();
});

test("actual inferred addon curves retain provenance with finite clipping, resize and small-size dash density", () => {
  const camera = new THREE.PerspectiveCamera(43, 1.6, 1, 180000),
    curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-150, 0, 0),
      new THREE.Vector3(0, 200, 0),
      new THREE.Vector3(150, 0, 0),
    ),
    line = new RelationshipFilament(
      { id: "inferred", provenance: "inferred" },
      curve,
      0x9e8aa6,
      false,
    );
  for (const distance of [0.5, 2, 100, 1200, 12000, 100000]) {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const [width, height] of [
      [700, 600],
      [2000, 1252],
      [900, 1600],
    ]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      line.updateViewport(camera, width, height);
      assert.equal(line.material.dashed, true);
      assert.equal(line.userData.edge, "inferred");
      assert.deepEqual(line.material.resolution.toArray(), [width, height]);
      assert.ok(
        Number.isFinite(line.material.dashScale) && line.material.dashScale > 0,
      );
      assert.ok(line.material.gapSize >= 0 && line.material.gapSize <= 4);
      assert.equal(line.material.opacity, 0.8);
    }
  }
  assert.equal(
    line.material.gapSize,
    0,
    "unresolvable gaps close, rather than erasing a tiny inferred arc",
  );
  line.dispose();
});

test("dense edge selection is bounded and camera-stable, and explicit edge selection prioritizes its canonical identity", () => {
  const { c, n, scene, pose, dispose } = setup(250);
  pose({ target: n.position("project:p"), distance: 12000 });
  const before = lines(scene),
    beforeIds = ids(scene);
  assert.equal(before.length, 40);
  assert.ok(beforeIds.includes("membership:workspace:w0"));
  for (const distance of [180, 850, 30000, 100000]) {
    pose({ yaw: distance / 1000, pitch: 0.4, distance });
    assert.deepEqual(lines(scene), before);
  }
  scene.selectedEdge = "edge200";
  scene.update(1280, 800);
  assert.equal(ids(scene)[0], "edge200");
  c.select("resource:b201");
  scene.update(1280, 800);
  assert.ok(ids(scene).includes("edge201"));
  assert.equal(scene.diagnostics.edges, 40);
  assert.ok(ids(scene).some((id) => id.startsWith("membership:workspace:")));
  dispose();
});

test("edge refresh and revocation dispose addon geometry/materials once without changing surviving canonical relationships", () => {
  const { c, n, scene, pose, dispose } = setup();
  pose({ target: n.position("project:p"), distance: 8000 });
  const before = lines(scene),
    disposed = new Map();
  for (const line of before) {
    disposed.set(line, { geometry: 0, material: 0 });
    line.geometry.addEventListener(
      "dispose",
      () => disposed.get(line).geometry++,
    );
    line.material.addEventListener(
      "dispose",
      () => disposed.get(line).material++,
    );
  }
  const next = fixture();
  next.resources[0].visible = false;
  next.relationships[2].provenance = "inferred";
  c.update(next);
  scene.update(1280, 800);
  assert.equal(ids(scene).includes("edge0"), false);
  assert.equal(ids(scene).includes("membership:resource:b0"), false);
  assert.equal(
    lines(scene).find((line) => line.userData.edge === "edge2").material.dashed,
    true,
  );
  for (const counters of disposed.values())
    assert.deepEqual(counters, { geometry: 1, material: 1 });
  dispose();
  for (const counters of disposed.values())
    assert.deepEqual(counters, { geometry: 1, material: 1 });
});

test("explicit selection uses the actual shared-resource placement without camera-driven alias jumps", () => {
  const { c, n, scene, pose, dispose } = setup(),
    next = fixture();
  next.blocks.push({ ...next.blocks[0], id: "shared", workspace_id: "w1" });
  c.update(next);
  c.select("resource:shared");
  pose({ target: n.position("project:p"), distance: 6000 });
  const line = lines(scene).find((line) => line.userData.edge === "edge0"),
    start = line.points[0],
    selected = n.position("resource:shared");
  assert.deepEqual(start.toArray(), [selected.x, selected.y, selected.z]);
  pose({ yaw: -2.7, pitch: 0.6, distance: 180 });
  assert.equal(
    lines(scene).find((candidate) => candidate.userData.edge === "edge0"),
    line,
  );
  assert.deepEqual(start.toArray(), [selected.x, selected.y, selected.z]);
  dispose();
});

test("near-plane crossing addon geometry retains finite dash uniforms and the CSS viewport across DPR changes", () => {
  const camera = new THREE.PerspectiveCamera(43, 1.6, 1, 180000),
    curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-100, 0, -100),
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(100, 0, 100),
    ),
    line = new RelationshipFilament(
      { id: "crossing", provenance: "inferred" },
      curve,
      0x9e8aa6,
      false,
    );
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const depths = line.points.map(
    (point) => point.clone().applyMatrix4(camera.matrixWorldInverse).z,
  );
  assert.ok(depths.some((z) => z > 0) && depths.some((z) => z < -camera.near));
  const geometry = line.geometry;
  for (const dpr of [1, 1.25, 2]) {
    line.updateViewport(camera, 1280, 800);
    line.onBeforeRender({
      getViewport: (target) => target.set(0, 0, 1280, 800),
      getPixelRatio: () => dpr,
    });
    assert.deepEqual(
      line.material.resolution.toArray(),
      [1280, 800],
      "DPR must not be applied twice to the CSS-pixel viewport",
    );
    assert.equal(line.material.linewidth, 1.6);
    assert.ok(
      Number.isFinite(line.material.dashScale) && line.material.dashScale > 0,
    );
    assert.ok(Number.isFinite(line.material.gapSize));
    assert.equal(line.geometry, geometry);
  }
  line.dispose();
});

test("screen-width relationship picking resolves the actual canonical edge ID away from stellar bodies", async () => {
  const { n, scene, pose, dispose } = setup(),
    origin = n.position("project:p");
  await n.place("resource:b0", {
    x: origin.x - 1800,
    y: origin.y + 1100,
    z: origin.z,
  });
  await n.place("resource:b1", {
    x: origin.x + 1800,
    y: origin.y + 1100,
    z: origin.z,
  });
  pose({ target: origin, yaw: 0, pitch: 0, distance: 8000 });
  const line = lines(scene).find((line) => line.userData.edge === "edge0"),
    point = line.points[16].clone().project(scene.camera),
    hit = scene.pick(
      (point.x * 0.5 + 0.5) * 1280,
      (-point.y * 0.5 + 0.5) * 800,
      1280,
      800,
    );
  assert.equal(hit?.edge, "edge0");
  dispose();
});
