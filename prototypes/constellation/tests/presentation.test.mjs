import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

function setup(exclusions = []) {
  const snapshot = {
      projects: [{ id: "p", title: "Project" }],
      workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
      resources: [{ id: "r", title: "Note", kind: "note", project_id: "p" }],
      blocks: [
        {
          id: "b",
          resource_id: "r",
          workspace_id: "w",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          z: 0,
        },
      ],
      relationships: [],
      activeWorkspaceId: null,
      navigation: { kind: "constellation", projectId: "p" },
    },
    motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  let bounds = { left: 40, top: 70, width: 1280, height: 800, bottom: 870 };
  const scene = new ConstellationScene(
    c,
    n,
    () => bounds,
    () => {},
    () => exclusions,
  );
  const pose = {
    ...n.camera,
    target: n.position("project:p"),
    distance: 2500,
    yaw: 0,
    pitch: 0,
  };
  n.target(pose);
  motion.snap(n.id);
  c.selected = null;
  return {
    c,
    n,
    scene,
    motion,
    pose,
    setBounds: (next) => {
      bounds = next;
    },
    close() {
      scene.dispose();
      c.dispose();
    },
  };
}
function renderer() {
  let viewport = new THREE.Vector4(0, 0, 1440, 1000),
    scissor = viewport.clone(),
    test = false;
  return {
    autoClear: true,
    info: { autoReset: false, render: { calls: 0, triangles: 0 } },
    getViewport: (v) => v.copy(viewport),
    getScissor: (v) => v.copy(scissor),
    getScissorTest: () => test,
    setViewport: (...v) => {
      viewport = v.length === 1 ? v[0].clone() : new THREE.Vector4(...v);
    },
    setScissor: (...v) => {
      scissor = v.length === 1 ? v[0].clone() : new THREE.Vector4(...v);
    },
    setScissorTest: (value) => {
      test = value;
    },
    clearDepth: () => {},
    render: () => {},
  };
}
const frame = {
  width: 1440,
  height: 1000,
  time: 0,
  quality: "balanced",
  reduced: false,
  quiet: false,
};

test("actual UI rectangles replace the blanket upper-right ban without hiding bodies or labels", () => {
  const exclusions = [],
    { c, n, scene, motion, pose, close } = setup(exclusions);
  n.target({
    ...pose,
    target: {
      x: pose.target.x - 800,
      y: pose.target.y - 400,
      z: pose.target.z,
    },
  });
  motion.snap(n.id);
  const first = scene.labels(1280, 800).find((p) => p.node.key === "project:p");
  assert(
    first.x > 1280 * 0.66 && first.y < 400,
    "unoccupied upper-right remains usable",
  );
  const anchors = structuredClone(c.state.anchors),
    bodies = scene.diagnostics.nodes;
  exclusions.push({
    left: first.x - 110,
    top: first.y - 45,
    right: first.x + 110,
    bottom: first.y + 45,
  });
  const next = scene.labels(1280, 800).find((p) => p.node.key === "project:p");
  assert(next);
  assert(
    next.x !== first.x || next.y !== first.y,
    "real UI moves the caption to a legal slot",
  );
  assert.equal(scene.diagnostics.nodes, bodies);
  assert.deepEqual(c.state.anchors, anchors);
  close();
});

test("fallback captions choose the nearest legal grid slot and retain that slot while it remains legal", () => {
  const exclusions = [{ left: 200, top: 300, right: 1080, bottom: 640 }],
    { scene, close } = setup(exclusions);
  const first = scene.labels(1280, 800).find((p) => p.node.key === "project:p");
  assert(first);
  assert(
    Math.hypot(first.x - first.anchorX, first.y - first.anchorY) < 190,
    "fallback must not jump to the first top-left slot",
  );
  assert(first.y < 300 && first.x > 500 && first.x < 800);
  exclusions.length = 0;
  const retained = scene
    .labels(1280, 800)
    .find((p) => p.node.key === "project:p");
  assert.deepEqual(
    { x: retained.x, y: retained.y },
    { x: first.x, y: first.y },
  );
  close();
});

test("workspace arrival keeps last drawn pixel coordinates after the working field hides and camera/model projection changes", async () => {
  const { c, n, scene, motion, setBounds, close } = setup();
  assert.equal(scene.screenOrigin("workspace:w"), undefined);
  scene.render(renderer(), frame);
  const body = scene.diagnostics.projectedBodies.find(
      (p) => p.key === "workspace:w",
    ),
    expected = { x: 40 + body.x, y: 70 + body.y };
  const data = structuredClone(c.snapshot);
  await c.go({ kind: "workspace", workspaceId: "w" });
  setBounds({ left: 0, top: 0, width: 0, height: 0, bottom: 0 });
  n.target({ ...n.camera, target: n.position("workspace:w"), distance: 800 });
  motion.snap(n.id);
  scene.update(300, 300);
  assert.deepEqual(scene.screenOrigin("workspace:w"), expected);
  assert.deepEqual(
    c.snapshot,
    data,
    "projection cache never changes canonical working data",
  );
  close();
});

test("arrival origins require a successful draw and matching canonical identity, and are cleared by graphics loss", () => {
  const { c, scene, close } = setup(),
    gpu = renderer();
  scene.render(gpu, frame);
  const original = scene.screenOrigin("resource:b");
  assert(original);
  gpu.render = () => {
    throw Error("draw failed");
  };
  assert.throws(() => scene.render(gpu, frame), /draw failed/);
  assert.deepEqual(
    scene.screenOrigin("resource:b"),
    original,
    "failed submission cannot replace the last successful projection",
  );
  const next = structuredClone(c.snapshot);
  next.resources.push({
    id: "replacement",
    title: "Replacement",
    kind: "note",
    project_id: "p",
  });
  next.blocks[0].resource_id = "replacement";
  c.update(next);
  assert.equal(
    scene.screenOrigin("resource:b"),
    undefined,
    "same placement key cannot reuse another canonical resource's origin",
  );
  scene.contextLost();
  assert.equal(scene.screenOrigin("workspace:w"), undefined);
  scene.contextRestored();
  assert.equal(
    scene.screenOrigin("workspace:w"),
    undefined,
    "restoration alone does not invent a new draw",
  );
  gpu.render = () => {};
  scene.render(gpu, frame);
  assert(scene.screenOrigin("workspace:w"));
  close();
});
