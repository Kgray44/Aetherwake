import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import {
  registerResourceMaterial,
  targetResourceMaterial,
  resourceUnfold,
  resourceDock,
  materialMotionKey,
} from "../src/resource-material-motion.ts";
test("ordinary drag/resize/rotation pose changes cannot activate focused reading materials", () => {
  const m = new MotionCoordinator(),
    id = "arbitrary-block";
  m.add(id, { x: 0, y: 0, w: 300, h: 150, lift: 0, yaw: 0, opacity: 1 });
  registerResourceMaterial(m, id);
  const material = m.bodies.get(materialMotionKey(id));
  for (let frame = 0; frame < 100; frame++) {
    m.target(
      id,
      {
        x: frame * 3,
        y: frame,
        w: 300 + frame * 3,
        h: 150 + frame * 7,
        lift: 35,
        yaw: frame / 8,
        opacity: 1,
      },
      "native resize preview",
    );
    targetResourceMaterial(m, id, false, "resize");
    m.step(1 / 60);
    assert.equal(resourceUnfold(m, id), 0);
    assert.equal(m.bodies.get(materialMotionKey(id)), material);
  }
});
test("peripheral labels settle independently of narrow geometry, snap on blur and reverse on return", () => {
  const m = new MotionCoordinator();
  m.add("small", { x: 0, y: 0, w: 16, h: 12, lift: 0, yaw: 0, opacity: 1 });
  registerResourceMaterial(m, "small");
  const body = m.bodies.get(materialMotionKey("small"));
  targetResourceMaterial(m, "small", false, "other resource focused", true);
  m.step(1 / 60);
  assert(resourceDock(m, "small") > 0 && resourceDock(m, "small") < 1);
  m.snap(materialMotionKey("small"));
  assert.equal(resourceDock(m, "small"), 1);
  assert.equal(resourceUnfold(m, "small"), 0);
  targetResourceMaterial(m, "small", false, "return");
  assert.equal(resourceDock(m, "small"), 1);
  for (let i = 0; i < 180; i++) m.step(1 / 60);
  assert.equal(resourceDock(m, "small"), 0);
  assert.equal(m.bodies.get(materialMotionKey("small")), body);
  m.reduced = true;
  targetResourceMaterial(m, "small", false, "reduced focus", true);
  assert.equal(resourceDock(m, "small"), 1);
  targetResourceMaterial(m, "small", true, "focus the anchor");
  assert.equal(resourceDock(m, "small"), 0);
  assert.equal(resourceUnfold(m, "small"), 1);
});
test("focus and return reverse continuously on the same shared material channel; reduced reconciles immediately", () => {
  const m = new MotionCoordinator();
  registerResourceMaterial(m, "block");
  targetResourceMaterial(m, "block", true, "focus");
  for (let i = 0; i < 12; i++) m.step(1 / 60);
  const before = resourceUnfold(m, "block");
  assert(before > 0 && before < 1);
  targetResourceMaterial(m, "block", false, "reverse");
  assert.equal(resourceUnfold(m, "block"), before);
  for (let i = 0; i < 180; i++) m.step(1 / 60);
  assert(resourceUnfold(m, "block") < 0.001);
  m.reduced = true;
  targetResourceMaterial(m, "block", true, "reduced focus");
  assert.equal(resourceUnfold(m, "block"), 1);
});
