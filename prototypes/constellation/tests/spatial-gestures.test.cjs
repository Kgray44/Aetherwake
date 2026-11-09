const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { spatialDragPoint, resolveSpatialDragTarget } = require("./integrated-native.cjs");

function fixture({
  width = 1600,
  height = 1000,
  hit,
  bodies = [{ key: "resource:unit-moon", x: 400, y: 300, radius: 64 }],
  hidden = false,
  inert = false,
} = {}) {
  let hits = 0;
  const world = {
    classList: { contains: (name) => name === "aw-spatial-world" },
  };
  const label = {
    dataset: { key: "resource:unit-moon" },
    getBoundingClientRect: () => ({
      left: 450,
      top: 235,
      width: 100,
      height: 30,
    }),
  };
  const surface = {
    hidden,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
    }),
    closest: () => inert,
    contains: (e) => e === world,
  };
  const doc = {
    querySelector: (selector) =>
      selector === ".aw-spatial-field" ? surface : null,
    elementFromPoint: (x, y) => {
      hits++;
      return hit ? hit(x, y, { surface, world, label }) : surface;
    },
  };
  const read = (bodyKey = null, dx = 95, dy = -25) =>
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(
          `(${spatialDragPoint.toString()})(".aw-spatial-field",bodyKey,dx,dy)`,
          {
            document: doc,
            window: { __aerynth: { snapshot: () => ({ spatial: { renderer: { projectedBodies: bodies } } }) } },
            innerWidth: width,
            innerHeight: height,
            bodyKey,
            dx,
            dy,
          },
        ),
      ),
    );
  return { read, surface, world, label, hits: () => hits };
}

test("actual browser-side gesture locator recovers when the old fixed orbit point lands on a project label", () => {
  const f = fixture({
    hit: (x, y, { surface, label }) =>
      x >= 200 && x <= 380 && y >= 630 && y <= 730 ? label : surface,
  });
  const target = f.read();
  assert.equal(target.method, "hit-tested-spatial-background");
  assert.ok(target.attempts > 1 && target.attempts <= 26);
  assert.notDeepEqual(target.point, { x: 320, y: 700 });
  assert.deepEqual(target.point, { x: 800, y: 450 });
  assert.equal(
    f.label.dataset.key,
    "resource:unit-moon",
    "labels remain intact; no product mutation or hidden-body workaround",
  );
});

test("orbit/pan target lookup is bounded, rejects foreign world elements and returns explicit failure details instead of throwing in Electron", () => {
  const foreign = {
    className: "aw-spatial-world foreign",
    classList: { contains: () => true },
  };
  const f = fixture({ hit: () => foreign });
  const target = f.read(null, 60, 25);
  assert.match(target.error, /No exposed spatial background/);
  assert.equal(target.attempts, 26);
  assert.ok(f.hits() <= 52);
  assert.equal(target.blockers.length, 4);
  assert.equal(target.point, undefined);
  const own = fixture({ hit: (_x, _y, { world }) => world });
  assert.ok(
    own.read().point,
    "only the actual field or its own world can start native camera input",
  );
});

test("body Alt-drag requires an exposed projected body and never falls back to camera background", () => {
  const f = fixture();
  const target = f.read("resource:unit-moon", 42, 18);
  assert.deepEqual(target.point, { x: 400, y: 300 });
  assert.equal(target.method, "isolated-projected-body");
  assert.match(
    fixture({ bodies: [] }).read("resource:unit-moon").error,
    /missing from the renderer projection/,
  );
  const covered = fixture({ hit: (_x, _y, { label }) => label });
  assert.match(covered.read("resource:unit-moon").error, /No exposed isolated/);
  assert.equal(covered.read("resource:unit-moon").point, undefined);
});

test("Alt-drag avoids the nearer body's projected bound from the failed native receipt", () => {
  const moon = { key: "resource:unit-moon", x: 801, y: 501, radius: 64 };
  const foreground = { key: "resource:foreground", x: 845, y: 541, radius: 104 };
  const { point, attempts } = fixture({ bodies: [foreground, moon] }).read(moon.key, 55, -30);
  assert(attempts > 1 && attempts <= 73);
  assert(Math.hypot(point.x - moon.x, point.y - moon.y) < moon.radius);
  assert(Math.hypot(point.x - foreground.x, point.y - foreground.y) > foreground.radius);
  const fullyCovered = { ...foreground, x: moon.x, y: moon.y };
  assert.match(fixture({ bodies: [fullyCovered, moon] }).read(moon.key).error, /No exposed isolated/);
});

test("inactive fields and paths leaving the actual viewport produce no native input coordinates", () => {
  for (const flags of [{ hidden: true }, { inert: true }]) {
    const f = fixture(flags);
    assert.match(f.read().error, /inactive/);
    assert.equal(f.hits(), 0);
  }
  assert.match(
    fixture({ width: 100, height: 80 }).read(null, 200, 200).error,
    /No exposed/,
  );
  assert.match(
    fixture({ width: 300, height: 200 }).read("resource:unit-moon").error,
    /No exposed isolated/,
  );
});

test("camera fallback rechecks an occluded body after orbiting and stops at the first exposed point", async () => {
  const moon = { key: "resource:unit-moon", x: 400, y: 300, radius: 64 };
  const cover = { key: "resource:foreground", x: 400, y: 300, radius: 120 };
  let orbits = 0;
  const readTarget = () => fixture({ bodies: orbits ? [moon] : [moon, cover] }).read(moon.key);
  const result = await resolveSpatialDragTarget(readTarget, async () => { orbits++; });
  assert.equal(orbits, 1);
  assert.equal(result.cameraAdjustments, 1);
  assert.deepEqual(result.target.point, { x: 400, y: 300 });
});

test("camera fallback is bounded and propagates a lost native input owner", async () => {
  const moon = { key: "resource:unit-moon", x: 400, y: 300, radius: 64 };
  const cover = { key: "resource:foreground", x: 400, y: 300, radius: 120 };
  const readTarget = () => fixture({ bodies: [moon, cover] }).read(moon.key);
  const result = await resolveSpatialDragTarget(readTarget, async () => {});
  assert.equal(result.cameraAdjustments, 4);
  assert.equal(result.target.point, undefined);
  const ownerLost = Error("native_owner_window_inactive");
  await assert.rejects(resolveSpatialDragTarget(readTarget, async () => { throw ownerLost; }), ownerLost);
});
