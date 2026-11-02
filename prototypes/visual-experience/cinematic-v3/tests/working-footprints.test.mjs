import test from "node:test";
import assert from "node:assert/strict";
import { createWorkingFootprints } from "../src/working-footprints.ts";

function fixture() {
  let deliver,
    wakes = 0,
    disconnected = false;
  const observed = new Set();
  const tracker = createWorkingFootprints(
    () => wakes++,
    (read) => {
      deliver = read;
      return {
        observe: (node) => observed.add(node),
        unobserve: (node) => observed.delete(node),
        disconnect: () => {
          disconnected = true;
          observed.clear();
        },
      };
    },
  );
  return {
    tracker,
    observed,
    wakes: () => wakes,
    disconnected: () => disconnected,
    deliver: (target, width, height) =>
      deliver([{ target, contentRect: { width, height } }]),
  };
}

test("visibility waits for an actual body delivery, retaining real zero while rejecting hidden stale boxes", () => {
  const f = fixture(),
    node = {};
  f.tracker.track("chat", node);
  f.deliver(node, 0, 0);
  assert.equal(f.tracker.read("chat"), undefined);
  f.tracker.setVisible("chat", true);
  assert.equal(f.tracker.read("chat"), undefined, "no fabricated initial zero");
  f.deliver(node, 210.5, 0);
  assert.deepEqual(f.tracker.read("chat"), { width: 210.5, height: 0 });
  assert.equal(f.wakes(), 1);
  f.deliver(node, 210.5, 0);
  assert.equal(f.wakes(), 1, "unchanged deliveries do not create a wake loop");
  f.tracker.setVisible("chat", false);
  f.deliver(node, 0, 0);
  assert.equal(f.tracker.read("chat"), undefined);
  f.tracker.setVisible("chat", true);
  assert.equal(f.tracker.read("chat"), undefined);
  f.deliver(node, 368, 112);
  assert.deepEqual(f.tracker.read("chat"), { width: 368, height: 112 });
});

test("replacement and release reject late old-body callbacks without retaining removed cards", () => {
  const f = fixture(),
    old = {},
    current = {};
  f.tracker.track("note", old);
  f.tracker.setVisible("note", true);
  f.deliver(old, 300, 200);
  f.tracker.track("note", current);
  f.tracker.setVisible("note", true);
  f.deliver(old, 900, 900);
  assert.equal(f.tracker.read("note"), undefined);
  assert(!f.observed.has(old));
  f.deliver(current, 320, 240);
  assert.deepEqual(f.tracker.read("note"), { width: 320, height: 240 });
  f.tracker.release("note");
  f.deliver(current, 100, 100);
  assert.equal(f.tracker.read("note"), undefined);
  assert.equal(f.observed.size, 0);
});

test("invalid measurements and post-disposal delivery cannot wake or mutate retained geometry", () => {
  const f = fixture(),
    node = {};
  f.tracker.track("task", node);
  f.tracker.setVisible("task", true);
  for (const [w, h] of [
    [NaN, 20],
    [100, Infinity],
    [-1, 30],
    [100, -1],
  ])
    f.deliver(node, w, h);
  assert.equal(f.wakes(), 0);
  assert.equal(f.tracker.read("task"), undefined);
  f.tracker.dispose();
  f.deliver(node, 200, 100);
  f.tracker.track("later", {});
  assert.equal(f.wakes(), 0);
  assert.equal(f.observed.size, 0);
  assert(f.disconnected());
});
