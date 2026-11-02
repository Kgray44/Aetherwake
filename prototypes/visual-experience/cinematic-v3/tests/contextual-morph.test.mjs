import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import { presentContextualSurface } from "../src/contextual-surfaces.ts";

const small = { x: 180, y: 200, w: 440, h: 148, opacity: 1, lift: 0, yaw: 0 };
const large = { ...small, x: 100, y: 120, w: 540, h: 580 };
const bounds = (pose) =>
  presentContextualSurface({
    pose,
    viewport: { width: 900, height: 760 },
    safeInsets: { top: 96, bottom: 56, left: 16, right: 16 },
  });

test("surface growth paints real intermediate dimensions and reverses without restarting the spring", () => {
  const m = new MotionCoordinator();
  m.add("context", small);
  m.target("context", large, "actual context opened");
  for (let i = 0; i < 9; i++) m.step(1 / 60);
  const during = m.pose("context"),
    painted = bounds(during);
  assert(painted.width > small.w && painted.width < large.w);
  assert(painted.height > small.h && painted.height < large.h);
  const velocity = m.bodies.get("context").channels.h.velocity;
  m.target("context", small, "context closed during arrival");
  assert.equal(m.bodies.get("context").channels.h.velocity, velocity);
  assert.deepEqual(m.pose("context"), during);
  for (let i = 0; i < 180; i++) m.step(1 / 60);
  assert.equal(bounds(m.pose("context")).height, small.h);
});

test("viewport contraction keeps an interrupted large surface within current safe area", () => {
  const r = presentContextualSurface({
    pose: { ...large, x: 800, y: 600, lift: 12 },
    viewport: { width: 360, height: 320 },
    safeInsets: { top: 96, bottom: 56, left: 16, right: 16 },
  });
  assert(r.x >= 16 && r.y >= 96);
  assert(r.x + r.width <= 344 && r.y + r.height <= 264);
  assert.deepEqual(large, { ...small, x: 100, y: 120, w: 540, h: 580 });
});

test("reduced motion reconciles content growth immediately, with no decorative scale", () => {
  const m = new MotionCoordinator();
  m.reduced = true;
  m.add("context", small);
  m.target("context", large, "review available");
  const r = bounds(m.pose("context"));
  assert.equal(r.width, large.w);
  assert.equal(r.height, large.h);
  assert.equal(m.bodies.get("context").channels.h.velocity, 0);
});
