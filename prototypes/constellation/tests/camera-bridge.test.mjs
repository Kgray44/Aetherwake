import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

function setup() {
  const motion = new MotionCoordinator(),
    calls = { wake: 0, navigate: 0, open: 0, save: 0 },
    c = new ConstellationController({
      snapshot: {
        projects: [{ id: "p", title: "Project" }],
        workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
        resources: [{ id: "r", title: "Note", kind: "note", project_id: "p" }],
        blocks: [],
        relationships: [],
        activeWorkspaceId: null,
        navigation: { kind: "constellation", projectId: "p" },
      },
      motion,
      navigate: async () => {
        calls.navigate++;
      },
      openResource: async () => {
        calls.open++;
      },
      persistence: {
        load: async () => null,
        save: async () => {
          calls.save++;
        },
      },
      onDirty: () => calls.wake++,
    }),
    n = new SpatialNavigator(c, () => calls.wake++);
  c.spatial = n;
  const rect = {
      left: 80,
      top: 40,
      width: 1200,
      height: 800,
      right: 1280,
      bottom: 840,
    },
    scene = new ConstellationScene(c, n, () => rect);
  const settle = () => {
    for (let i = 0; i < 180; i++) motion.step(1 / 60);
  };
  return {
    c,
    n,
    scene,
    motion,
    calls,
    rect,
    settle,
    dispose() {
      scene.dispose();
      c.dispose();
    },
  };
}
function submit(scene, preserveWorldDepth) {
  const renderer = {
    depthClears: 0,
    autoClear: true,
    info: { autoReset: false, render: { calls: 0, triangles: 0 } },
    getViewport: (target) => target.set(0, 0, 1600, 1000),
    getScissor: (target) => target.set(0, 0, 1600, 1000),
    getScissorTest: () => false,
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    clearDepth() {
      this.depthClears++;
    },
    render() {
      this.info.render.calls++;
    },
  };
  scene.render(renderer, {
    width: 1600,
    height: 1000,
    time: 0,
    quality: "balanced",
    reduced: false,
    quiet: false,
    ...(preserveWorldDepth === undefined ? {} : { preserveWorldDepth }),
  });
  return renderer;
}
function assertPose(camera, pose) {
  const cp = Math.cos(pose.pitch),
    expected = new THREE.Vector3(
      pose.target.x + Math.sin(pose.yaw) * cp * pose.distance,
      pose.target.y + Math.sin(pose.pitch) * pose.distance,
      pose.target.z + Math.cos(pose.yaw) * cp * pose.distance,
    );
  assert.ok(camera.position.distanceTo(expected) < 1e-8);
  const direction = new THREE.Vector3(
    pose.target.x,
    pose.target.y,
    pose.target.z,
  )
    .sub(camera.position)
    .normalize();
  assert.ok(
    camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction) < 1e-8,
  );
}

test("celestial preparation borrows the exact current spring camera without stepping, rebuilding or persisting", () => {
  const { c, n, scene, motion, calls, settle, dispose } = setup();
  n.target({ ...n.camera, distance: 5000, yaw: -0.8, pitch: 0.2 });
  settle();
  const previous = n.camera;
  n.target({
    ...n.camera,
    target: { x: 200, y: 100, z: -300 },
    distance: 900,
    yaw: 1.3,
    pitch: -0.4,
  });
  const before = structuredClone({
      state: c.state,
      camera: n.camera,
      target: n.bookmark(),
      calls,
    }),
    count = motion.bodies.size;
  const camera = scene.prepareCelestialCamera(1600, 1000);
  assert.equal(camera, scene.camera);
  assertPose(camera, previous);
  assert.equal(camera.fov, 43);
  assert.equal(camera.near, 1);
  assert.equal(camera.far, 180000);
  assert.equal(
    scene.objects.size,
    0,
    "preparing the camera does not build the graph",
  );
  assert.equal(motion.bodies.size, count);
  assert.deepEqual(
    { state: c.state, camera: n.camera, target: n.bookmark(), calls },
    before,
  );
  motion.step(1 / 60);
  const current = n.camera;
  assert.notDeepEqual(current, n.bookmark(), "the spring is still in flight");
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  assertPose(camera, current);
  dispose();
});

test("the same camera remains authoritative while workspace bodies are inactive and direct content opens", async () => {
  const { c, n, scene, motion, settle, dispose } = setup();
  n.target({
    ...n.camera,
    target: n.position("project:p"),
    distance: 5000,
    yaw: -0.8,
    pitch: 0.2,
  });
  settle();
  const before = n.camera,
    camera = scene.prepareCelestialCamera(1600, 1000);
  await c.go({ kind: "workspace", workspaceId: "w" });
  assert.equal(scene.active, false);
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  assertPose(camera, before);
  motion.step(1 / 60);
  assertPose(scene.prepareCelestialCamera(1600, 1000), n.camera);
  const working = n.camera;
  await c.openResource("r");
  assert.deepEqual(n.camera, working);
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  const retained = n.camera;
  await c.go({ kind: "project", projectId: "p" });
  assertPose(scene.prepareCelestialCamera(1600, 1000), retained);
  dispose();
});

test("resize and full azimuth use the shared perspective without changing navigation or camera history", () => {
  const { c, n, scene, settle, dispose } = setup();
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
    n.target({ ...n.camera, yaw, pitch: yaw % 2 ? -1.2 : 1.2, distance: 1200 });
    settle();
    const pose = n.camera,
      before = structuredClone(c.state);
    for (const [width, height] of [
      [1600, 1000],
      [700, 1000],
      [2000, 800],
    ]) {
      const camera = scene.prepareCelestialCamera(width, height);
      assert.equal(camera, scene.camera);
      assert.equal(camera.aspect, width / height);
      assertPose(camera, pose);
      assert.deepEqual(n.camera, pose);
      assert.deepEqual(c.state, before);
    }
  }
  dispose();
});

test("list and body-disabled views retain the camera; hidden/lost graphics and invalid viewports do not expose it", () => {
  const { c, n, scene, settle, dispose } = setup();
  n.target({ ...n.camera, distance: 2300, yaw: 1.1, pitch: -0.5 });
  settle();
  const pose = n.camera,
    camera = scene.prepareCelestialCamera(1600, 1000);
  for (const [width, height] of [
    [0, 1000],
    [1600, -1],
    [NaN, 1000],
    [1600, Infinity],
  ])
    assert.equal(scene.prepareCelestialCamera(width, height), null);
  scene.enabled = false;
  assert.equal(scene.active, false);
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  assertPose(camera, pose);
  scene.enabled = true;
  n.presentation = "list";
  assert.equal(scene.active, false);
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  assertPose(camera, pose);
  n.presentation = "spatial";
  c.setPolicy({ hidden: true });
  assert.equal(scene.prepareCelestialCamera(1600, 1000), null);
  c.setPolicy({ hidden: false });
  c.setPolicy({ graphicsAvailable: false });
  assert.equal(scene.prepareCelestialCamera(1600, 1000), null);
  c.setPolicy({ graphicsAvailable: true });
  scene.contextLost();
  assert.equal(scene.prepareCelestialCamera(1600, 1000), null);
  scene.contextRestored();
  assert.equal(scene.prepareCelestialCamera(1600, 1000), camera);
  assertPose(camera, pose);
  scene.dispose();
  assert.equal(scene.prepareCelestialCamera(1600, 1000), null);
  c.dispose();
});

test("world depth is preserved only with explicit host opt-in; existing callers keep their reset", () => {
  const { scene, dispose } = setup();
  assert.equal(submit(scene).depthClears, 1);
  assert.equal(submit(scene, false).depthClears, 1);
  assert.equal(submit(scene, true).depthClears, 0);
  dispose();
});

test("focused entry obtains cached drawn body geometry in client pixels after the field hides or camera changes", async () => {
  const { c, n, scene, rect, settle, dispose } = setup(),
    key = "resource:unplaced:r";
  n.target({
    ...n.camera,
    target: n.position(key),
    yaw: 0,
    pitch: 0,
    distance: 1000,
  });
  settle();
  assert.equal(
    scene.screenBodyProjection(key),
    null,
    "projection requires a successfully submitted draw",
  );
  submit(scene);
  const projection = scene.screenBodyProjection(key),
    expected = scene.project(key, rect.width, rect.height);
  assert.equal(projection.key, key);
  assert.equal(projection.kind, "resource");
  assert.equal(projection.resourceId, "r");
  assert.deepEqual(projection.center, {
    x: rect.left + expected.x,
    y: rect.top + expected.y,
  });
  assert.ok(
    Math.abs(
      projection.bounds.right - projection.bounds.left - projection.radius * 2,
    ) < 1e-9,
  );
  assert.deepEqual(projection.viewport, {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  });
  assert.deepEqual(scene.screenOrigin(key), projection.center);
  await c.go({ kind: "workspace", workspaceId: "w" });
  rect.width = 0;
  rect.height = 0;
  scene.prepareCelestialCamera(1600, 1000);
  assert.deepEqual(
    scene.screenBodyProjection(key),
    projection,
    "entry uses last drawn pixels rather than a new/zero-sized field projection",
  );
  dispose();
});

test("body envelope clipping is bounded and rejects revoked identities, graphics loss and stale recovery geometry", () => {
  const { c, n, scene, rect, settle, dispose } = setup(),
    key = "resource:unplaced:r",
    body = n.position(key);
  n.target({
    ...n.camera,
    target: { ...body, x: body.x + 290 },
    yaw: 0,
    pitch: 0,
    distance: 500,
  });
  settle();
  submit(scene);
  const projection = scene.screenBodyProjection(key);
  assert.ok(projection.bounds.left < rect.left);
  assert.equal(projection.clippedBounds.left, rect.left);
  assert.ok(projection.clippedBounds.right > projection.clippedBounds.left);
  assert.ok(
    projection.clippedBounds.right <= rect.right &&
      projection.clippedBounds.bottom <= rect.bottom,
  );
  scene.contextLost();
  assert.equal(scene.screenBodyProjection(key), null);
  scene.contextRestored();
  assert.equal(
    scene.screenBodyProjection(key),
    null,
    "recovery needs a new draw",
  );
  submit(scene);
  assert.ok(scene.screenBodyProjection(key));
  const next = structuredClone(c.snapshot);
  next.resources[0].available = false;
  c.update(next, false);
  assert.equal(scene.screenBodyProjection(key), null);
  assert.equal(scene.screenOrigin(key), undefined);
  dispose();
  assert.equal(scene.screenBodyProjection(key), null);
});
