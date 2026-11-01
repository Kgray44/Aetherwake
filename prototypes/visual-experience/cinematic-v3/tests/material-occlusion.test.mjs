import test from "node:test";
import assert from "node:assert/strict";
import { overlappingSurfaceIds } from "../src/material-occlusion.ts";

const surface = (id, x, y, w = 100, h = 100, extra = {}) => ({
  id,
  x,
  y,
  w,
  h,
  lift: 0,
  yaw: 0,
  opacity: 1,
  ...extra,
});
const ids = (surfaces) => [...overlappingSurfaceIds(surfaces)].sort();

test("native conversation-to-third-slot repro makes both overlapping DOM resources opaque without changing their identities", () => {
  // Settled 1600×1000 desktop poses: the conversation's wider resource shape
  // in slot 3 intersects the note in slot 2. The default ordering does not.
  const initial = [
    surface("conversation-tidal", 104, 370, 458.6666667, 240, {
      lift: 16,
      yaw: -5,
    }),
    surface("research-material", 1016, 557.6666667, 277.3333333, 277.3333333, {
      yaw: 7,
    }),
    surface("note-field", 544, 668.6, 362.6666667, 166.4, { yaw: -2 }),
  ];
  assert.deepEqual(ids(initial), []);
  const reordered = Object.freeze([
    Object.freeze(
      surface("research-material", 160, 370, 277.3333333, 277.3333333, {
        lift: 16,
        yaw: -5,
      }),
    ),
    Object.freeze(
      surface("note-field", 960, 560, 362.6666667, 166.4, { yaw: 7 }),
    ),
    Object.freeze(
      surface("conversation-tidal", 544, 595, 458.6666667, 240, { yaw: -2 }),
    ),
  ]);
  const before = structuredClone(reordered);
  assert.deepEqual(ids(reordered), ["conversation-tidal", "note-field"]);
  assert.deepEqual(reordered, before);
});

test("CSS perspective lift and yaw can create projected overlap outside canonical rectangles", () => {
  const unlifted = surface("front", 0, 0);
  const neighbor = surface("neighbor", 140, 0, 40, 40);
  assert.deepEqual(ids([unlifted, neighbor]), []);
  // At lift 750, perspective 1500 doubles the front surface around its center:
  // its right edge becomes 150, covering ten pixels of the neighbor.
  assert.deepEqual(ids([{ ...unlifted, lift: 750 }, neighbor]), [
    "front",
    "neighbor",
  ]);
  const broad = surface("tilted", 0, 0, 400, 100);
  const below = surface("below", 100, 103, 20, 10);
  assert.deepEqual(ids([broad, below]), []);
  assert.deepEqual(ids([{ ...broad, yaw: 60 }, below]), ["below", "tilted"]);
});

test("touching edges and invisible surfaces do not suppress normal material response", () => {
  const a = surface("a", 0, 0);
  assert.deepEqual(
    ids([a, surface("right-touch", 100, 0), surface("bottom-touch", 0, 100)]),
    [],
  );
  for (const opacity of [0, 0.025, 0.05]) {
    assert.deepEqual(
      ids([a, surface("invisible", 25, 25, 100, 100, { opacity })]),
      [],
    );
  }
  assert.deepEqual(
    ids([a, surface("visible", 25, 25, 100, 100, { opacity: 0.051 })]),
    ["a", "visible"],
  );
  assert.deepEqual(ids([a, surface("positive-area", 99.5, 99.5)]), [
    "a",
    "positive-area",
  ]);
});

test("crossing motion and resizing acquire then release clarity without stale overlap state", () => {
  const note = Object.freeze(surface("note", 140, 80, 80, 40));
  assert.deepEqual(ids([surface("moving", 0, 0), note]), []);
  assert.deepEqual(
    ids([surface("moving", 100, 0, 100, 100, { lift: 55 }), note]),
    ["moving", "note"],
  );
  assert.deepEqual(ids([surface("moving", 300, 0), note]), []);
  assert.deepEqual(ids([surface("resized", 0, 0, 200, 100), note]), [
    "note",
    "resized",
  ]);
  assert.deepEqual(ids([surface("resized", 0, 0), note]), []);
  const chain = [
    surface("first", 0, 0),
    surface("middle", 90, 0),
    surface("last", 180, 0),
    surface("remote", 400, 400),
  ];
  assert.deepEqual(ids(chain), ["first", "last", "middle"]);
});

test("focused peripheral anchors remain translucent when clear and become guarded while a surface crosses them", () => {
  const anchors = [
    surface("research-anchor", 24, 238, 176, 76, { lift: -4, opacity: 0.8 }),
    surface("note-anchor", 24, 338, 176, 76, { lift: -4, opacity: 0.8 }),
  ];
  assert.deepEqual(
    ids([surface("focused", 232, 152, 1000, 690, { lift: 35 }), ...anchors]),
    [],
  );
  assert.deepEqual(
    ids([surface("focused", 190, 152, 1000, 690, { lift: 35 }), ...anchors]),
    ["focused", "note-anchor", "research-anchor"],
  );
  assert.deepEqual(
    ids([
      surface("focused", 96, 152, 716, 410, { lift: 35 }),
      surface("research-anchor", 16, 238, 56, 64, { lift: -4, opacity: 0.8 }),
      surface("note-anchor", 16, 326, 56, 64, { lift: -4, opacity: 0.8 }),
    ]),
    [],
  );
});
