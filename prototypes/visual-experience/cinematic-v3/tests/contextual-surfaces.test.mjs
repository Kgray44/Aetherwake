import test from "node:test";
import assert from "node:assert/strict";
import { placeContextualSurface } from "../src/contextual-surfaces.ts";
const viewport = { width: 800, height: 600 };
test("an anchored surface uses its requested side when it fits and flips above the bottom edge", () => {
  const below = placeContextualSurface({
    anchor: { x: 100, y: 100, width: 40, height: 30 },
    size: { width: 200, height: 100 },
    viewport,
  });
  assert.equal(below.side, "bottom");
  assert.equal(below.y, 142);
  const above = placeContextualSurface({
    anchor: { x: 400, y: 560, width: 40, height: 30 },
    size: { width: 200, height: 100 },
    viewport,
  });
  assert.equal(above.side, "top");
  assert.equal(above.y, 448);
});
test("horizontal fallback uses available space when the anchor spans the height", () => {
  const r = placeContextualSurface({
    anchor: { x: 300, y: 0, width: 40, height: 600 },
    size: { width: 200, height: 180 },
    viewport,
  });
  assert.equal(r.side, "right");
  assert.equal(r.x, 352);
});
test("oversized content receives real bounded dimensions and an explicit constrained result", () => {
  const r = placeContextualSurface({
    anchor: { x: 760, y: 570, width: 30, height: 20 },
    size: { width: 900, height: 900 },
    viewport,
    safeInsets: { left: 20, right: 20, top: 100, bottom: 80 },
  });
  assert.deepEqual(
    { x: r.x, y: r.y, width: r.width, height: r.height },
    { x: 20, y: 100, width: 760, height: 420 },
  );
  assert.equal(r.constrained, true);
});
test("translated viewport/anchor coordinates preserve relative placement without mutating inputs", () => {
  const anchor = Object.freeze({ x: 100, y: 100, width: 40, height: 30 }),
    size = Object.freeze({ width: 200, height: 100 });
  const a = placeContextualSurface({ anchor, size, viewport });
  const b = placeContextualSurface({
    anchor: { ...anchor, x: anchor.x + 310, y: anchor.y + 170 },
    size,
    viewport: { ...viewport, x: 310, y: 170 },
  });
  assert.equal(b.x - a.x, 310);
  assert.equal(b.y - a.y, 170);
  assert.equal(a.side, b.side);
});
test("tiny, offscreen, inset and high-DPI fractional geometry stays finite inside its viewport", () => {
  for (const width of [0.5, 1, 120, 480, 1920])
    for (const height of [0.5, 1, 160, 720])
      for (const inset of [0, 12, 300])
        for (const x of [-5000, -10, 20, width * 0.95, width + 5000])
          for (const size of [
            { width: 48, height: 36 },
            { width: 240, height: 120 },
            { width: 800, height: 680 },
          ])
            for (const preferred of ["bottom", "top", "right", "left"]) {
              const r = placeContextualSurface({
                anchor: { x, y: height - 20, width: 24, height: 16 },
                size,
                viewport: { x: 0, y: 0, width, height },
                safeInsets: {
                  left: inset,
                  right: inset,
                  top: inset,
                  bottom: inset,
                },
                preferred,
              });
              assert.ok([r.x, r.y, r.width, r.height].every(Number.isFinite));
              assert.ok(r.width > 0 && r.height > 0);
              assert.ok(
                r.x >= -1e-7 &&
                  r.y >= -1e-7 &&
                  r.x + r.width <= width + 1e-7 &&
                  r.y + r.height <= height + 1e-7,
                JSON.stringify(r),
              );
            }
});
test("invalid geometry fails before an invalid CSS projection can be produced", () => {
  const base = {
    anchor: { x: 10, y: 10, width: 10, height: 10 },
    size: { width: 200, height: 100 },
    viewport,
  };
  for (const patch of [
    { viewport: { width: 0, height: 100 } },
    { size: { width: NaN, height: 100 } },
    { anchor: { x: Infinity, y: 0, width: 10, height: 10 } },
    { safeInsets: { left: -1 } },
    { gap: -1 },
    { preferred: "unknown" },
  ])
    assert.throws(() => placeContextualSurface({ ...base, ...patch }));
});
