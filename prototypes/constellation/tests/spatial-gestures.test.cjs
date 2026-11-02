const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { spatialDragPoint } = require("./integrated-native.cjs");

function fixture({
  width = 1600,
  height = 1000,
  hit,
  body = true,
  leader = true,
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
  const line = {
    getAttribute: (name) =>
      ({ x1: "400", y1: "300", x2: "500", y2: "235" })[name],
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
    querySelectorAll: (selector) =>
      selector.includes(".aw-anchor")
        ? body
          ? [label]
          : []
        : leader
          ? [line]
          : [],
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

test("body Alt-drag still targets its actual leader; missing or covered geometry never falls back to camera background", () => {
  const f = fixture();
  const target = f.read("resource:unit-moon", 42, 18);
  assert.deepEqual(target.point, { x: 400, y: 300 });
  assert.equal(target.method, "actual-body-leader");
  assert.match(
    fixture({ body: false }).read("resource:unit-moon").error,
    /Body label missing/,
  );
  assert.match(
    fixture({ leader: false }).read("resource:unit-moon").error,
    /leader missing/,
  );
  const covered = fixture({ hit: (_x, _y, { label }) => label });
  assert.match(covered.read("resource:unit-moon").error, /target occluded/);
  assert.equal(covered.read("resource:unit-moon").point, undefined);
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
    /outside field/,
  );
});
