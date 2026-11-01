import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import {
  registerScene,
  retargetScene,
  sceneWeights,
} from "../src/scene-transition.ts";

test("scene changes reverse in place on the shared coordinator and conserve light weights", () => {
  const motion = new MotionCoordinator();
  registerScene(motion, "architecture");
  retargetScene(motion, "living");
  for (let i = 0; i < 8; i++) motion.step(1 / 60);
  const before = sceneWeights(motion);
  assert.ok(before.architecture > 0 && before.living > 0);
  retargetScene(motion, "observatory");
  assert.deepEqual(sceneWeights(motion), before);
  for (let i = 0; i < 120; i++) {
    motion.step(1 / 60);
    const weights = Object.values(sceneWeights(motion));
    assert.ok(weights.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  }
  assert.deepEqual(sceneWeights(motion), {
    architecture: 0,
    living: 0,
    observatory: 1,
  });
  assert.ok(motion.receipts.some((r) => r.status === "retargeted"));
});

test("reduced motion reconciles scene retargeting immediately without touching resource poses", () => {
  const motion = new MotionCoordinator();
  const resource = {
    x: 20,
    y: 30,
    w: 400,
    h: 300,
    lift: 12,
    yaw: 3,
    opacity: 1,
  };
  motion.add("resource", resource);
  registerScene(motion, "architecture");
  motion.reduced = true;
  retargetScene(motion, "living");
  assert.deepEqual(sceneWeights(motion), {
    architecture: 0,
    living: 1,
    observatory: 0,
  });
  assert.deepEqual(motion.pose("resource"), resource);
  assert.equal(motion.step(1 / 60), false);
});
