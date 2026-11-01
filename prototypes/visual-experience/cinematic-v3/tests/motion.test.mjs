import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  channels,
  MotionCoordinator,
  reorder,
  slotPose,
} from "../src/motion.ts";

const origin = { x: 40, y: 70, w: 300, h: 180, lift: 0, yaw: -4, opacity: 1 };
const expanded = {
  x: 120,
  y: 25,
  w: 900,
  h: 650,
  lift: 40,
  yaw: 0,
  opacity: 1,
};
function settle(coordinator) {
  for (let i = 0; i < 600; i++) {
    if (!coordinator.step(1 / 120)) return;
  }
  assert.fail("Motion did not settle within five simulated seconds");
}

test("resting critically damped springs converge without overshoot at several cadences", () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 240]) {
    for (const [start, target] of [
      [0, 500],
      [500, -120],
      [-10, -10],
    ]) {
      const channel = { value: start, velocity: 0, target };
      let previousDistance = Math.abs(start - target);
      for (let i = 0; i < Math.ceil(5 / dt); i++) {
        advance(channel, dt);
        assert.ok(
          Number.isFinite(channel.value) && Number.isFinite(channel.velocity),
        );
        assert.ok(channel.value >= Math.min(start, target) - 1e-10);
        assert.ok(channel.value <= Math.max(start, target) + 1e-10);
        const distance = Math.abs(channel.value - target);
        assert.ok(distance <= previousDistance + 1e-10);
        previousDistance = distance;
      }
      assert.equal(channel.value, target);
      assert.equal(channel.velocity, 0);
    }
  }
});

test("spring trajectory is independent of frame partition before settling tolerance", () => {
  const coarse = { value: 0, target: 1000, velocity: 120 };
  const fine = { ...coarse };
  advance(coarse, 0.1);
  for (let i = 0; i < 10; i++) advance(fine, 0.01);
  assert.ok(Math.abs(coarse.value - fine.value) < 1e-9);
  assert.ok(Math.abs(coarse.velocity - fine.velocity) < 1e-9);
});

test("reversal and resize retarget preserve current position and velocity", () => {
  const coordinator = new MotionCoordinator();
  coordinator.add("resource", origin);
  coordinator.target("resource", expanded, "expand");
  for (let i = 0; i < 8; i++) coordinator.step(1 / 120);
  const body = coordinator.bodies.get("resource");
  const before = Object.fromEntries(
    channels.map((k) => [k, { ...body.channels[k] }]),
  );
  coordinator.target("resource", origin, "reverse");
  for (const key of channels) {
    assert.equal(body.channels[key].value, before[key].value);
    assert.equal(body.channels[key].velocity, before[key].velocity);
  }
  coordinator.step(1 / 120);
  const resized = { ...expanded, w: 620, h: 420 };
  const atResize = coordinator.pose("resource");
  coordinator.target("resource", resized, "viewport changed");
  assert.deepEqual(coordinator.pose("resource"), atResize);
  settle(coordinator);
  assert.deepEqual(coordinator.pose("resource"), resized);
  assert.equal(coordinator.bodies.size, 1);
  assert.deepEqual(
    coordinator.receipts.map((r) => r.status),
    ["started", "retargeted", "retargeted", "settled"],
  );
});

test("reduced policy reconciles active and future transitions without residual momentum", () => {
  const coordinator = new MotionCoordinator();
  coordinator.add("resource", origin);
  coordinator.target("resource", expanded, "expand");
  coordinator.step(1 / 60);
  coordinator.reduced = true;
  assert.equal(coordinator.step(1 / 60), false);
  assert.deepEqual(coordinator.pose("resource"), expanded);
  coordinator.target("resource", origin, "collapse");
  assert.deepEqual(coordinator.pose("resource"), origin);
  assert.ok(
    Object.values(coordinator.bodies.get("resource").channels).every(
      (c) => c.velocity === 0,
    ),
  );
  assert.deepEqual(
    coordinator.receipts.map((r) => r.status),
    ["started", "settled", "started", "settled"],
  );
});

test("receipts identify interrupted versus settled work and do not duplicate idle settlement", () => {
  const coordinator = new MotionCoordinator();
  coordinator.add("resource", origin);
  coordinator.target("resource", expanded, "expand");
  const initial = coordinator.receipts[0].transition;
  coordinator.step(1 / 60);
  coordinator.cancel("resource", origin);
  settle(coordinator);
  assert.deepEqual(coordinator.pose("resource"), origin);
  assert.ok(
    coordinator.receipts.some(
      (r) => r.transition === initial && r.status === "cancelled",
    ),
  );
  assert.ok(
    !coordinator.receipts.some(
      (r) => r.transition === initial && r.status === "settled",
    ),
  );
  const final = coordinator.receipts.at(-1);
  assert.equal(final.status, "settled");
  const count = coordinator.receipts.length;
  for (let i = 0; i < 30; i++) coordinator.step(1 / 60);
  coordinator.target("resource", origin, "already there");
  assert.equal(coordinator.receipts.length, count);
});

test("cancellation toward the existing target creates a distinct recovery transition", () => {
  const coordinator = new MotionCoordinator();
  coordinator.add("resource", origin);
  coordinator.target("resource", expanded, "expand");
  coordinator.step(1 / 60);
  const cancelledTransition = coordinator.receipts[0].transition;
  const before = coordinator.pose("resource");
  const velocity = coordinator.bodies.get("resource").channels.w.velocity;
  coordinator.cancel("resource", expanded);
  assert.deepEqual(coordinator.pose("resource"), before);
  assert.equal(
    coordinator.bodies.get("resource").channels.w.velocity,
    velocity,
  );
  const recovery = coordinator.receipts.at(-1);
  assert.notEqual(recovery.transition, cancelledTransition);
  assert.equal(recovery.status, "started");
  settle(coordinator);
  assert.deepEqual(coordinator.pose("resource"), expanded);
  assert.ok(
    coordinator.receipts.some(
      (r) => r.transition === cancelledTransition && r.status === "cancelled",
    ),
  );
  assert.ok(
    !coordinator.receipts.some(
      (r) => r.transition === cancelledTransition && r.status === "settled",
    ),
  );
  assert.ok(
    coordinator.receipts.some(
      (r) => r.transition === recovery.transition && r.status === "settled",
    ),
  );
});

test("motion diagnostics stay bounded during repeated interaction and retain coherent recent IDs", () => {
  const coordinator = new MotionCoordinator();
  coordinator.reduced = true;
  coordinator.add("resource", origin);
  for (let i = 0; i < 400; i++)
    coordinator.target("resource", i % 2 ? origin : expanded, "repeat");
  assert.equal(coordinator.receipts.length, 256);
  for (let i = 0; i < coordinator.receipts.length; i += 2) {
    const start = coordinator.receipts[i];
    const end = coordinator.receipts[i + 1];
    assert.equal(start.resource, "resource");
    assert.equal(start.status, "started");
    assert.equal(end.status, "settled");
    assert.equal(start.transition, end.transition);
    assert.ok(Number.isFinite(start.at) && end.at >= start.at);
    if (i) assert.ok(start.transition > coordinator.receipts[i - 2].transition);
  }
});

test("duplicate or absent visual identities fail explicitly", () => {
  const coordinator = new MotionCoordinator();
  coordinator.add("resource", origin);
  assert.throws(() => coordinator.add("resource", expanded), /Duplicate/);
  assert.throws(
    () => coordinator.target("missing", expanded, "invalid"),
    /Unknown/,
  );
  assert.equal(coordinator.bodies.size, 1);
});

test("reordering changes placements while preserving input, identity set and canonical content", () => {
  const resources = new Map([
    ["a", { text: "unsent draft" }],
    ["b", { text: "research" }],
    ["c", { text: "note" }],
  ]);
  const before = [...resources.entries()];
  const order = ["a", "b", "c"];
  assert.deepEqual(reorder(order, "a", 2), ["b", "c", "a"]);
  assert.deepEqual(reorder(order, "c", -10), ["c", "a", "b"]);
  assert.deepEqual(reorder(order, "a", 100), ["b", "c", "a"]);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual([...resources.entries()], before);
  assert.equal(resources.get("a"), before[0][1]);
  assert.throws(() => reorder(order, "unknown", 1), /Unknown/);
});

test("compact layouts retain three reachable resource placements above the dock reserve", () => {
  const resources = new Map([
    ["conversation", { text: "draft" }],
    ["research", { text: "observations" }],
    ["note", { text: "thought" }],
  ]);
  const canonical = [...resources.entries()];
  let order = [...resources.keys()];
  const coordinator = new MotionCoordinator();
  for (const [slot, id] of order.entries())
    coordinator.add(id, slotPose(slot, 700, 650));
  for (const [width, height] of [
    [700, 650],
    [900, 850],
  ]) {
    order = reorder(order, "conversation", 2);
    for (const [slot, id] of order.entries())
      coordinator.target(
        id,
        slotPose(slot, width, height),
        "compact resize and rearrange",
      );
    settle(coordinator);
    const boxes = order.map((id) => coordinator.pose(id));
    assert.equal(coordinator.bodies.size, 3);
    assert.equal(new Set(order).size, 3);
    assert.deepEqual([...resources.entries()], canonical);
    for (const box of boxes) {
      assert.ok(
        box.x >= 0 && box.y >= 100,
        "resource remains below the header",
      );
      assert.ok(
        box.x + box.w <= width,
        "resource remains within horizontal bounds",
      );
      assert.ok(
        box.y + box.h <= height - 120,
        "resource avoids the dock/status reserve",
      );
      assert.ok(
        box.w >= 240 && box.h >= 105,
        "resource retains an actionable compact size",
      );
    }
    for (let i = 1; i < boxes.length; i++)
      assert.ok(
        boxes[i].y >= boxes[i - 1].y + boxes[i - 1].h + 8,
        "compact resources do not overlap",
      );
  }
});
