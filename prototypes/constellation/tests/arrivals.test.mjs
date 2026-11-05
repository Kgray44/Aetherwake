import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

const fixture = (count = 12) => ({
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
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "p" },
});
function setup(snapshot = fixture()) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  let wakes = 0;
  const scene = new ConstellationScene(
    c,
    n,
    () => ({}),
    () => {
      wakes++;
    },
  );
  n.target({ ...n.camera, distance: 20000 });
  settle(motion);
  scene.update(1440, 900);
  return { c, n, scene, motion, wakes: () => wakes };
}
function settle(m) {
  for (let i = 0; i < 180; i++) m.step(1 / 60);
}
const bodyId = (c, key) => c.motionId + ":body:" + key;

test("live graph additions for projects, workspaces and resources get one shared-spring arrival without moving old anchors", () => {
  for (const role of ["project", "workspace", "resource"]) {
    const initial = fixture();
    if (role === "project") initial.navigation.projectId = null;
    const { c, n, scene, motion, wakes } = setup(initial),
      before = structuredClone(c.state.anchors),
      changed = fixture(role === "resource" ? 13 : 12);
    let key;
    if (role === "project") {
      changed.navigation.projectId = null;
      changed.projects.push({ id: "q", title: "New project" });
      key = "project:q";
    } else if (role === "workspace") {
      changed.workspaces.push({
        id: "w2",
        title: "New workspace",
        project_id: "p",
      });
      key = "workspace:w2";
    } else key = "resource:b12";
    assert.ok(
      [...scene.objects.values()].every((root) => root.scale.x === 1),
      "initial display is steady",
    );
    c.update(changed);
    scene.update(1440, 900);
    const root = scene.objects.get(key),
      id = bodyId(c, key);
    assert.ok(root, role + " is visible in the live scene");
    assert.equal(root.scale.x, 0.88);
    assert.equal(motion.bodies.get(id).channels.x.target, 1);
    assert.equal(motion.bodies.get(id).transitioning, true);
    assert.ok(wakes() > 0, "arrival wakes the host scheduler");
    let previous = root.scale.x;
    for (let i = 0; i < 12; i++) {
      motion.step(1 / 60);
      scene.update(1440, 900);
      assert.ok(root.scale.x >= previous && root.scale.x <= 1);
      previous = root.scale.x;
      assert.deepEqual(
        { x: root.position.x, y: root.position.y, z: root.position.z },
        n.position(key),
      );
    }
    settle(motion);
    scene.update(1440, 900);
    assert.equal(root.scale.x, 1);
    assert.equal(scene.diagnostics.arrivingBodies, 0);
    for (const [key, anchor] of Object.entries(before))
      assert.deepEqual(c.state.anchors[key], anchor);
    changed.projects[0].title = "Renamed project";
    c.update(changed);
    scene.update(1440, 900);
    assert.equal(
      scene.objects.get(key).scale.x,
      1,
      "metadata refresh cannot replay arrival",
    );
    assert.equal(
      motion.receipts.filter(
        (r) => r.resource === id && r.cause === "authorized graph addition",
      ).length,
      1,
    );
    scene.dispose();
    c.dispose();
  }
});

test("frustum re-entry never replays arrival, including interruption before the first arrival settles", () => {
  const { c, n, scene, motion } = setup(),
    base = n.camera;
  c.update(fixture(13));
  scene.update(1440, 900);
  const key = "resource:b12",
    id = bodyId(c, key);
  assert.equal(scene.objects.get(key).scale.x, 0.88);
  n.target({ ...base, target: { x: 1000000, y: 0, z: 0 }, distance: 1000 });
  motion.snap(n.id);
  scene.update(1440, 900);
  assert.equal(scene.objects.has(key), false);
  assert.equal(motion.bodies.has(id), false);
  assert.equal(
    motion.receipts.filter((r) => r.resource === id && r.status === "cancelled")
      .length,
    1,
    "an interrupted visual arrival has an honest terminal receipt",
  );
  n.target(base);
  settle(motion);
  scene.update(1440, 900);
  assert.equal(scene.objects.get(key).scale.x, 1);
  assert.equal(scene.diagnostics.arrivingBodies, 0);
  assert.equal(
    motion.receipts.filter(
      (r) => r.resource === id && r.cause === "authorized graph addition",
    ).length,
    1,
  );
  // An addition observed outside the current frame has no delayed birth cue.
  n.target({ ...base, target: { x: 1000000, y: 0, z: 0 }, distance: 1000 });
  settle(motion);
  c.update(fixture(14));
  scene.update(1440, 900);
  n.target(base);
  settle(motion);
  scene.update(1440, 900);
  assert.equal(scene.objects.get("resource:b13").scale.x, 1);
  scene.dispose();
  c.dispose();
});

test("hidden, reduced, Quiet, list and unavailable graphics additions settle without deferred animation", () => {
  for (const mode of [
    "hidden",
    "reduced",
    "quiet",
    "list",
    "graphics",
    "coordinator-reduced",
  ]) {
    const { c, n, scene, motion } = setup();
    if (mode === "list") n.presentation = "list";
    else if (mode === "graphics") scene.contextLost();
    else if (mode === "coordinator-reduced") motion.reduced = true;
    else c.setPolicy({ [mode]: true });
    c.update(fixture(13));
    // No draw is needed while the surface is inactive; the graph observer owns
    // suppression, so returning later cannot replay the hidden event.
    n.presentation = "spatial";
    scene.contextRestored();
    motion.reduced = false;
    c.setPolicy({ hidden: false, reduced: false, quiet: false });
    scene.update(1440, 900);
    assert.equal(scene.objects.get("resource:b12").scale.x, 1, mode);
    assert.equal(scene.diagnostics.arrivingBodies, 0, mode);
    scene.dispose();
    c.dispose();
  }
  const { c, scene } = setup();
  c.update(fixture(13));
  c.setPolicy({ hidden: true });
  c.setPolicy({ hidden: false });
  scene.update(1440, 900);
  assert.equal(
    scene.objects.get("resource:b12").scale.x,
    1,
    "hiding before the first draw drops an already queued cue",
  );
  scene.dispose();
  c.dispose();
});

test("large graph batches bound arrival/detail allocations, keep instance positions stable and release revoked motion", () => {
  const { c, scene, motion } = setup(fixture(1000));
  c.setPolicy({ tier: "efficient" });
  scene.update(1440, 900);
  const before = structuredClone(c.state.anchors),
    next = fixture(1100);
  c.update(next);
  scene.update(1440, 900);
  assert.equal(scene.diagnostics.arrivingBodies, 8);
  assert.ok(scene.objects.size <= 70);
  assert.equal(scene.diagnostics.nodes, c.nodes.size);
  const batch = scene.scene.getObjectByName("distant-planet-batch"),
    version = batch.instanceMatrix.version;
  for (let i = 0; i < 12; i++) {
    motion.step(1 / 60);
    scene.update(1440, 900);
  }
  assert.equal(
    batch.instanceMatrix.version,
    version,
    "arrival uses the shared spring without rewriting dense instance transforms",
  );
  for (const [key, anchor] of Object.entries(before))
    assert.deepEqual(c.state.anchors[key], anchor);
  const revoked = "resource:b1000";
  assert.ok(motion.bodies.has(bodyId(c, revoked)));
  next.resources[1000].visible = false;
  c.update(next);
  scene.update(1440, 900);
  assert.equal(scene.objects.has(revoked), false);
  assert.equal(motion.bodies.has(bodyId(c, revoked)), false);
  assert.equal(scene.distantKeys.includes(revoked), false);
  settle(motion);
  scene.update(1440, 900);
  assert.equal(scene.diagnostics.arrivingBodies, 0);
  scene.dispose();
  assert.ok(
    [...motion.bodies.keys()].every(
      (key) => !key.startsWith(c.motionId + ":body:"),
    ),
  );
  c.dispose();
});
