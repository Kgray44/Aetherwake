import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestationGeometry } from "../src/manifestation-geometry.ts";

const viewport = { width: 1200, height: 900 };
const hostRect = { x: 400, y: 300, width: 360, height: 280 };
const rect = (x, y, width = 80, height = 100) => ({ x, y, width, height });
const absolute = (geometry, p) => ({
  x: geometry.bounds.x + p.x,
  y: geometry.bounds.y + p.y,
});
const inside = (p, r, tolerance = 0.001) =>
  p.x >= r.x - tolerance &&
  p.x <= r.x + r.width + tolerance &&
  p.y >= r.y - tolerance &&
  p.y <= r.y + r.height + tolerance;

function checkGeometry(input) {
  const g = manifestationGeometry(input);
  assert(g, "a visible separated sculpture and host must connect");
  assert(inside(g.bounds, { x: 0, y: 0, ...input.viewport }));
  assert(g.bounds.width > 0 && g.bounds.height > 0);
  assert(g.bounds.x + g.bounds.width <= input.viewport.width);
  assert(g.bounds.y + g.bounds.height <= input.viewport.height);
  assert.equal(g.offset.x + input.hostRect.x, g.bounds.x);
  assert.equal(g.offset.y + input.hostRect.y, g.bounds.y);
  assert(
    inside(absolute(g, g.origin), input.actualVelaRect),
    "source stays on actual Vela",
  );
  assert(
    inside(absolute(g, g.target), input.hostRect),
    "join stays in the actual host",
  );
  assert(g.path.endsWith(" Z"));
  for (const path of [g.path, g.spine]) {
    assert(!/NaN|Infinity/.test(path));
    const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(numbers.length % 2, 0);
    for (let i = 0; i < numbers.length; i += 2) {
      assert(
        inside(
          { x: numbers[i], y: numbers[i + 1] },
          {
            x: 0,
            y: 0,
            width: g.bounds.width,
            height: g.bounds.height,
          },
        ),
        "every Bezier control point is bounded, so its entire curve is bounded",
      );
    }
  }
  return g;
}

test("one bridge connects actual Vela to every side and a rounded corner", () => {
  for (const [source, side] of [
    [rect(200, 370), "left"],
    [rect(900, 370), "right"],
    [rect(500, 100), "top"],
    [rect(500, 700), "bottom"],
    [rect(190, 100), "left"],
  ]) {
    const g = checkGeometry({ actualVelaRect: source, hostRect, viewport });
    assert.equal(g.side, side);
  }
});

test("actual moving sculpture and host positions update the origin without saved anchors", () => {
  const input = { actualVelaRect: rect(190, 370), hostRect, viewport };
  const before = checkGeometry(input);
  const moved = checkGeometry({
    ...input,
    actualVelaRect: rect(190, 410),
    hostRect: { ...hostRect, y: hostRect.y + 40 },
  });
  const oldOrigin = absolute(before, before.origin);
  const newOrigin = absolute(moved, moved.origin);
  assert(Math.abs(newOrigin.y - oldOrigin.y - 40) < 1e-8);
  assert(Math.abs(newOrigin.x - oldOrigin.x) < 1e-8);
  assert.deepEqual(
    manifestationGeometry(input),
    before,
    "no time or retained state",
  );
});

test("crossing a rounded corner keeps attachment continuous", () => {
  let previous;
  for (let x = 280; x <= 480; x += 0.5) {
    const g = checkGeometry({
      actualVelaRect: rect(x, 100),
      hostRect,
      viewport,
    });
    const p = absolute(g, g.target);
    if (previous) assert(Math.hypot(p.x - previous.x, p.y - previous.y) < 1);
    previous = p;
  }
});

test("partly clipped visible inputs retain a real source and bounded path", () => {
  for (const [source, host] of [
    [rect(-20, 330), hostRect],
    [rect(1160, 330), hostRect],
    [rect(500, -20), hostRect],
    [rect(500, 840), hostRect],
    [rect(190, 370), { ...hostRect, width: 900 }],
  ])
    checkGeometry({ actualVelaRect: source, hostRect: host, viewport });
});

test("viewport scaling uses CSS geometry rather than display scale or fixed offsets", () => {
  for (const zoom of [0.5, 0.8, 1, 1.5, 2]) {
    const scale = (r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * zoom]));
    const input = {
      actualVelaRect: scale(rect(190, 370)),
      hostRect: scale(hostRect),
      viewport: scale(viewport),
    };
    const g = checkGeometry(input);
    const origin = absolute(g, g.origin);
    assert(inside(origin, input.actualVelaRect));
  }
});

test("invalid, touching, overlapping and invisible inputs omit decorative geometry", () => {
  const base = { actualVelaRect: rect(190, 370), hostRect, viewport };
  for (const change of [
    { actualVelaRect: rect(420, 350) },
    { actualVelaRect: rect(320, 350) },
    { actualVelaRect: rect(-200, 370) },
    { actualVelaRect: rect(1300, 370) },
    { actualVelaRect: rect(400, -200) },
    { actualVelaRect: rect(400, 950) },
    { hostRect: rect(1300, 370, 360, 280) },
    { actualVelaRect: rect(NaN, 370) },
    { actualVelaRect: rect(190, Infinity) },
    { hostRect: rect(400, 300, -5, 280) },
    { actualVelaRect: rect(190, 370, 0, 100) },
    { actualVelaRect: rect(190, 370, 1, 1) },
    { viewport: { width: Infinity, height: 900 } },
    { viewport: { width: 0, height: 900 } },
  ])
    assert.equal(manifestationGeometry({ ...base, ...change }), null);
});

test("offscreen ellipse attachment is omitted instead of clamped to an invented origin", () => {
  assert.equal(
    manifestationGeometry({
      actualVelaRect: rect(-90, 100, 100, 100),
      hostRect: rect(100, 600, 360, 200),
      viewport,
    }),
    null,
  );
});

test("visible layout grid gives finite bounded geometry or safely omits an overlap", () => {
  for (let y = 0; y <= 800; y += 40)
    for (let x = 0; x <= 1120; x += 40) {
      const input = { actualVelaRect: rect(x, y), hostRect, viewport };
      const g = manifestationGeometry(input);
      if (g) checkGeometry(input);
    }
});
