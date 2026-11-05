import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
import { planetAppearance } from "../planets.ts";

function fixture(count = 12) {
  return {
    projects: [{ id: "p", title: "Project" }],
    workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
    resources: Array.from({ length: count }, (_, i) => ({
      id: `r${i}`,
      title: `Resource ${i}`,
      kind: "note",
      project_id: "p",
    })),
    blocks: Array.from({ length: count }, (_, i) => ({
      id: `b${i}`,
      resource_id: `r${i}`,
      workspace_id: "w",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: i,
    })),
    relationships: [
      {
        id: "ref",
        source_id: "r0",
        target_id: "r1",
        kind: "references",
        provenance: "user",
      },
    ],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: "p" },
  };
}
function setup(count, options = {}) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: fixture(count),
      motion,
      navigate: async () => {},
      ...options,
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  const scene = new ConstellationScene(c, n, () => ({}));
  return { c, n, scene, motion };
}
function settle(motion) {
  for (let i = 0; i < 180; i++) motion.step(1 / 60);
}
const submitted = (scene) =>
  new Set(scene.diagnostics.projectedBodies.map((p) => p.key));

test("every in-frame project body survives orbit and quality changes, including depth-aligned sightlines", () => {
  const { c, n, scene, motion } = setup(120),
    anchors = structuredClone(c.state.anchors),
    base = n.camera;
  let aligned = 0,
    checked = 0;
  for (const tier of ["efficient", "balanced", "cinematic"]) {
    c.setPolicy({ tier });
    for (let i = 0; i < 16; i++) {
      n.target({ ...base, yaw: (i * Math.PI) / 8, pitch: i % 2 ? 0.65 : -0.2 });
      settle(motion);
      scene.update(1280, 800);
      const keys = submitted(scene),
        discs = scene.diagnostics.projectedBodies;
      for (const node of c.nodes.values()) {
        const p = n.position(node.key),
          clip = new THREE.Vector3(p.x, p.y, p.z).project(scene.camera);
        if (
          Math.abs(clip.x) <= 1 &&
          Math.abs(clip.y) <= 1 &&
          Math.abs(clip.z) <= 1
        ) {
          assert.ok(
            keys.has(node.key),
            `${tier}: in-frame ${node.key} was erased while orbiting`,
          );
          checked++;
        }
      }
      assert.equal(scene.diagnostics.overlapCulled, 0);
      for (let a = 0; a < discs.length; a++)
        for (let b = a + 1; b < discs.length; b++)
          if (
            Math.hypot(discs[a].x - discs[b].x, discs[a].y - discs[b].y) <
            discs[a].radius + discs[b].radius
          )
            aligned++;
    }
  }
  assert.ok(checked > 1000);
  assert.ok(
    aligned > 0,
    "ordinary camera alignment must exercise the old disappearing-body bug",
  );
  assert.deepEqual(
    c.state.anchors,
    anchors,
    "orbit and LOD never move the physical organization",
  );
  scene.dispose();
  c.dispose();
});

test("far on-screen resources stay submitted; only leaving the frame removes them", async () => {
  const { c, n, scene, motion } = setup(),
    origin = n.position("project:p");
  await n.place("resource:b0", {
    x: origin.x + 100,
    y: origin.y,
    z: origin.z - 6000,
  });
  n.target({ ...n.camera, target: origin, yaw: 0, pitch: 0, distance: 900 });
  settle(motion);
  scene.update(1280, 800);
  assert.ok(
    submitted(scene).has("resource:b0"),
    "distance from orbit target must not erase a body in the camera frustum",
  );
  await n.place("resource:b0", {
    x: origin.x + 50000,
    y: origin.y,
    z: origin.z - 6000,
  });
  scene.update(1280, 800);
  assert.equal(submitted(scene).has("resource:b0"), false);
  scene.dispose();
  c.dispose();
});

test("dense views retain all bodies in one lightweight batch, preserve identity and support instance picking", () => {
  const { c, n, scene, motion } = setup(1000),
    anchors = structuredClone(c.state.anchors);
  n.target({
    ...n.camera,
    target: n.position("project:p"),
    distance: 20000,
    yaw: 0,
    pitch: 0,
  });
  settle(motion);
  for (const [tier, budget] of [
    ["efficient", 70],
    ["balanced", 160],
    ["cinematic", 280],
  ]) {
    c.setPolicy({ tier });
    scene.update(1920, 1080);
    assert.equal(scene.diagnostics.nodes, c.nodes.size);
    assert.ok(scene.objects.size <= budget);
    assert.equal(
      scene.diagnostics.instancedBodies,
      c.nodes.size - scene.objects.size,
    );
    const batch = scene.scene.getObjectByName("distant-planet-batch");
    assert.ok(batch.isInstancedMesh);
    batch.raycast = () => assert.fail("pointer input must not scan the whole instance batch");
    assert.equal(batch.count, scene.diagnostics.instanceDrawCount);
    assert.equal(
      batch.count,
      c.nodes.size - 1,
      "one stable non-stellar batch spans the project",
    );
    assert.equal(
      Array.from(batch.geometry.getAttribute("aVisible").array)
        .slice(0, batch.count)
        .filter((v) => v === 1).length,
      scene.diagnostics.instancedBodies,
    );
    assert.ok(batch.geometry.index.count / 3 <= 80);
    assert.ok(scene.labels(1920, 1080).length <= 30);
    const matrix = new THREE.Matrix4(),
      actualPosition = new THREE.Vector3();
    let picked = false;
    for (let i = 0; i < batch.count; i++) {
      const key = scene.distantKeys[i],
        node = c.nodes.get(key),
        appearance = planetAppearance(node.id, node.kind);
      assert.ok(
        Math.abs(
          batch.geometry.getAttribute("aSeed").getX(i) - appearance.seeds[0],
        ) < 1e-7,
      );
      batch.getMatrixAt(i, matrix);
      actualPosition.setFromMatrixPosition(matrix);
      const p = n.position(key);
      assert.ok(
        actualPosition.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 0.001,
      );
      if (!picked) {
        const at = scene.project(key, 1920, 1080);
        picked = scene.pick(at.x, at.y, 1920, 1080)?.key === key;
      }
    }
    assert.ok(picked, "a real instance ray hit resolves to its canonical key");
    assert.equal(batch.material.map, undefined);
    const matrixVersion = batch.instanceMatrix.version,
      geologyVersion = batch.geometry.getAttribute("aSeed").version,
      base = n.camera;
    for (let i = 0; i < 3; i++) {
      n.target({ ...base, yaw: base.yaw + i * 0.4 });
      settle(motion);
      scene.update(1920, 1080);
    }
    assert.equal(
      batch.instanceMatrix.version,
      matrixVersion,
      "camera orbit never uploads physical positions again",
    );
    assert.equal(
      batch.geometry.getAttribute("aSeed").version,
      geologyVersion,
      "camera orbit never rebuilds geology/color buffers",
    );
    const order = scene.orderedBodies, camera = n.bookmark();
    n.target({ ...camera, target: { ...camera.target, x: camera.target.x + 20 } });
    settle(motion); scene.update(1920, 1080);
    assert.equal(scene.orderedBodies, order, "small pans retain stable detail priority without another dense sort");
    assert.equal(batch.instanceMatrix.version, matrixVersion);
  }
  assert.deepEqual(c.state.anchors, anchors);
  const batch = scene.scene.getObjectByName("distant-planet-batch");
  let disposed = 0;
  batch.addEventListener("dispose", () => disposed++);
  scene.dispose();
  assert.equal(disposed, 1);
  c.dispose();
});

test("resource focus retains unrelated project bodies while framing only the real related neighborhood", async () => {
  const { c, n, scene, motion } = setup(10);
  await n.explore("resource:b0");
  settle(motion);
  const related = new Set(n.relatedNodes().map((n) => n.key)),
    candidates = new Set(n.candidateNodes().map((n) => n.key));
  assert.ok(related.has("resource:b1"));
  assert.equal(related.has("resource:b9"), false);
  assert.ok(
    candidates.has("resource:b9"),
    "approaching a chat must retain the rest of its project",
  );
  const pose = n.camera;
  n.target({ ...pose, distance: 10000 });
  settle(motion);
  scene.update(1280, 800);
  assert.equal(scene.diagnostics.nodes, c.nodes.size);
  const snapshot = fixture(10);
  snapshot.resources[9].visible = false;
  c.update(snapshot);
  scene.update(1280, 800);
  assert.equal(
    submitted(scene).has("resource:b9"),
    false,
    "revoked bodies remain excluded",
  );
  scene.dispose();
  c.dispose();
});

test("project identities render as self-lit stars with bounded coronas and no planetary rings", () => {
  const { c, n, scene } = setup(0);
  scene.update(1280, 800);
  const star = scene.objects.get("project:p"),
    appearance = star.userData.appearance,
    body = star.getObjectByName("stellar-photosphere"),
    corona = star.getObjectByName("atmosphere");
  assert.equal(appearance.kind, "star");
  assert.equal(appearance.rings, false);
  assert.ok(body.isMesh);
  assert.ok(corona.isMesh);
  assert.equal(star.getObjectByName("planet-ring"), undefined);
  assert.ok(
    !body.material.fragmentShader.includes("diffuse"),
    "photosphere emits light instead of a planetary day/night face",
  );
  assert.ok(corona.scale.x > body.scale.x);
  assert.ok(corona.scale.x * 1.08 <= n.radius("project:p"));
  const identities = new Set(
    Array.from({ length: 100 }, (_, i) =>
      JSON.stringify(planetAppearance(`star-${i}`, "project")),
    ),
  );
  assert.equal(identities.size, 100);
  scene.dispose();
  c.dispose();
});
