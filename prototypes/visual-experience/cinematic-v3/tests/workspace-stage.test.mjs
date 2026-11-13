import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import { createWorkspaceStage } from "../src/workspace-stage.ts";

function setup() {
  const writes = [];
  const style = new Proxy(
    {},
    {
      set(target, key, value) {
        writes.push([key, value]);
        return Reflect.set(target, key, value);
      },
    },
  );
  const element = { style, inert: false };
  const motion = new MotionCoordinator();
  let wakes = 0;
  const stage = createWorkspaceStage(element, motion, () => wakes++, {
    x: 640,
    y: 400,
  });
  return { element, motion, stage, writes, wakes: () => wakes };
}

test("workspace stage retains travel and stops writing identical frame styles", () => {
  const { element, motion, stage, writes } = setup();
  stage.frame(false, false);
  assert.equal(element.style.transform, "scale(1)");
  const initial = writes.length;
  for (let i = 0; i < 600; i++) stage.frame(false, false);
  assert.equal(writes.length, initial);

  stage.reconcile({
    overview: true,
    leaving: true,
    arriving: false,
    navigated: true,
    quiet: false,
    center: { x: 500, y: 300 },
  });
  assert.equal(element.inert, true);
  assert.equal(stage.surfacesVisible(true), true);
  assert.equal(element.style.transformOrigin, "500px 300px");
  assert.equal(motion.bodies.size, 1);
  motion.step(0.06);
  stage.frame(true, false);
  assert.ok(stage.view().scale < 1);
  assert.ok(stage.view().opacity > 0);
  stage.frame(true, true);
  assert.equal(element.style.visibility, "hidden");
  assert.equal(stage.surfacesVisible(true), false);
});

test("workspace waits for Vela after settled departure and resumes from the canonical anchor", () => {
  const { element, motion, stage, wakes } = setup();
  const center = { x: 640, y: 400 };
  stage.reconcile({
    overview: true,
    leaving: true,
    arriving: false,
    navigated: true,
    quiet: true,
    center,
  });
  stage.reconcile({
    overview: false,
    leaving: false,
    arriving: true,
    navigated: true,
    quiet: false,
    center,
    velaOccludes: () => true,
  });
  assert.equal(stage.waiting, true);
  assert.equal(element.inert, true);
  assert.equal(stage.surfacesVisible(false), false);
  stage.approach({ x: 450, y: 280 }, false);
  assert.equal(element.style.transformOrigin, "450px 280px");
  assert.equal(motion.pose("application:arrival").opacity, 0);
  stage.reveal();
  assert.equal(stage.waiting, false);
  assert.equal(element.inert, false);
  assert.equal(wakes(), 2);
  stage.frame(false, true);
  assert.deepEqual(stage.view(), {
    scale: 1,
    opacity: 1,
    originX: 450,
    originY: 280,
  });
});

test("quiet arrivals never call the Vela occlusion probe and interrupted departure stays continuous", () => {
  const { stage, motion, element } = setup();
  const center = { x: 640, y: 400 };
  stage.reconcile({
    overview: true,
    leaving: true,
    arriving: false,
    navigated: true,
    quiet: false,
    center,
  });
  motion.step(0.05);
  const outgoing = stage.view();
  stage.reconcile({
    overview: false,
    leaving: false,
    arriving: true,
    navigated: true,
    quiet: false,
    center,
    velaOccludes: () => assert.fail("travel was still visible"),
  });
  assert.deepEqual(stage.view(), outgoing);
  stage.frame(false, true);
  stage.reconcile({
    overview: true,
    leaving: true,
    arriving: false,
    navigated: true,
    quiet: true,
    center,
  });
  stage.reconcile({
    overview: false,
    leaving: false,
    arriving: true,
    navigated: true,
    quiet: true,
    center,
    velaOccludes: () => assert.fail("quiet policy must skip the probe"),
  });
  assert.equal(element.inert, false);
});
