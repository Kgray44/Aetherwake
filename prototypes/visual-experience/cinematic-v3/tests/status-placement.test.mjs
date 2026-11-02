import test from "node:test";
import assert from "node:assert/strict";
import { placeStatus } from "../src/status-placement.ts";

test("a preserved offscreen note leaves its recovery buttons clear of the live notice", () => {
  const obstacles = [
    { left: 40, right: 365, top: 958, bottom: 976 },
    { left: 620, right: 1105, top: 720, bottom: 1010 },
    { left: 1280, right: 1560, top: 958, bottom: 976 },
  ];
  const result = placeStatus({
    width: 1600,
    height: 1000,
    desiredWidth: 170,
    obstacles,
  });
  assert.equal(result.placement, "footer");
  assert(result.left >= 373 && result.left + result.width <= 612);
  assert.deepEqual(obstacles[1], {
    left: 620,
    right: 1105,
    top: 720,
    bottom: 1010,
  });
});

test("a full-width footer card yields only the reserved native chrome, retaining window controls", () => {
  const result = placeStatus({
    width: 980,
    height: 700,
    desiredWidth: 900,
    obstacles: [{ left: -100, right: 1100, top: 640, bottom: 900 }],
  });
  assert.equal(result.placement, "chrome");
  assert.equal(result.width, 512);
  assert(result.left >= 24 && result.left + result.width <= 820);
  assert.equal(700 - result.bottom - 32, 8);
});

test("distant and invalid bounds cannot obstruct the footer; contraction stays inside the current viewport", () => {
  for (const width of [320, 640, 980, 1600]) {
    const result = placeStatus({
      width,
      height: 700,
      desiredWidth: 220,
      obstacles: [
        { left: 0, right: width, top: 100, bottom: 200 },
        { left: NaN, right: 100, top: 650, bottom: 800 },
      ],
    });
    assert.equal(result.placement, "footer");
    assert(result.left >= 0 && result.left + result.width <= width);
  }
  assert.throws(() =>
    placeStatus({ width: NaN, height: 700, desiredWidth: 220, obstacles: [] }),
  );
});
