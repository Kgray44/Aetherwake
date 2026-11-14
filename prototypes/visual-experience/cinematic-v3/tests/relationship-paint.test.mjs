import assert from "node:assert/strict";
import test from "node:test";
import { createRelationshipPaint } from "../src/relationship-paint.ts";

test("relationship curve retains geometry and opacity without settled writes", () => {
  const geometry = [];
  const opacity = [];
  const paint = createRelationshipPaint({
    setAttribute(name, value) {
      assert.equal(name, "d");
      geometry.push(value);
    },
    style: { set opacity(value) { opacity.push(value); } },
  });
  const target = { x: 100, y: 90, w: 200 };
  for (let frame = 0; frame < 600; frame++) {
    paint(target, 1000, 500, false, 0.5);
  }
  assert.deepEqual(geometry, ["M630,200 C630,98 200,200 200,98"]);
  assert.deepEqual(opacity, [String(0.2 + 0.5 * 0.55)]);
  paint(undefined, 1000, 500, false, 0.5);
  paint(undefined, 1000, 500, false, 0.5);
  paint(target, 1000, 500, true, 0.5);
  assert.deepEqual(geometry, [
    "M630,200 C630,98 200,200 200,98",
    "M880,160 C880,98 200,160 200,98",
  ]);
  assert.deepEqual(opacity, [String(0.2 + 0.5 * 0.55), "0", String(0.2 + 0.5 * 0.55)]);
});
