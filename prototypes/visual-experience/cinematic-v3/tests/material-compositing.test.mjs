import test from "node:test";
import assert from "node:assert/strict";
import {
  MaterialCompositor,
  compareSurfaceStack,
  projectSurfacePoint,
} from "../src/material-compositing.ts";
import {
  createInstrumentMaterials,
  updateInstrumentMaterials,
} from "../src/instrument-materials.ts";
import { contourPoint } from "../src/surface-contour.ts";
const surface = (id, x, y, extra = {}) => ({
  id,
  x,
  y,
  w: 200,
  h: 160,
  lift: 0,
  yaw: 0,
  opacity: 1,
  zIndex: 0,
  shape: "rounded",
  ...extra,
});
function visible(path, x, y) {
  if (!path) return true;
  if (path.startsWith("inset")) return false;
  for (const part of path.match(/M[^Z]+Z/g) ?? []) {
    const values = part.match(/-?\d+(?:\.\d+)?/g).map(Number);
    let inside = false;
    for (let i = 0, j = values.length - 2; i < values.length; j = i, i += 2) {
      const ax = values[i],
        ay = values[i + 1],
        bx = values[j],
        by = values[j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
        inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
test("screen-space presence text clips behind projected cards without changing their stack or identity", () => {
  const c = new MaterialCompositor();
  const card = surface("resource", 100, 100, { w: 200, h: 160 });
  c.update([card], { scale: 0.5, originX: 0, originY: 0 });
  const overlay = surface("presence-presentation", 0, 0, { w: 400, h: 300 });
  const clip = c.clipOverlay(overlay);
  assert.equal(visible(clip, 95, 90), false);
  assert.equal(visible(clip, 240, 200), true);
  assert.equal(
    c.clipOverlay(overlay),
    clip,
    "unchanged frame reuses the derived clip",
  );
  assert.deepEqual(
    c.ordered.map((e) => e.id),
    ["resource"],
  );
  assert.deepEqual(card, surface("resource", 100, 100, { w: 200, h: 160 }));
  c.update([{ ...card, x: 700 }]);
  assert.equal(
    c.clipOverlay(overlay),
    "",
    "moving the front card releases the presence text",
  );
});
test("minor, quarter, major and complete overlaps clip only covered rear content; front material is untouched", () => {
  const c = new MaterialCompositor(),
    back = surface("back", 100, 100, { zIndex: 1 });
  for (const x of [480, 299, 250, 150, 100]) {
    const front = surface("front", x, 100, { zIndex: 2 });
    const before = structuredClone([back, front]);
    const rows = c.update([back, front]),
      a = rows.find((r) => r.id === "back"),
      b = rows.find((r) => r.id === "front");
    assert.equal(b.clipPath, "");
    assert.deepEqual([back, front], before);
    if (x === 480) assert.equal(a.clipPath, "");
    else assert(a.clipPath);
    if (x === 100) assert.equal(a.covered, true);
  }
});
test("disjoint unrotated cards defer outlines and keep exact bounds for a later overlap", () => {
  const c = new MaterialCompositor();
  const back = surface("back", 20, 30, { shape: "lens", lift: 34 });
  const front = surface("front", 400, 30, { zIndex: 1 });
  const view = { scale: 0.73, originX: 140, originY: 90 };
  c.update([back, front], view);
  const entry = c.get(back.id);
  const bounds = ({ left, right, top, bottom }) => [left, right, top, bottom];
  const disjoint = bounds(entry);
  assert.equal(entry.polygon.count, 0);
  assert.equal(c.diagnostics().scratchPolygons, 0);
  c.update([back, { ...front, x: 80 }], view);
  assert(entry.polygon.count > 0);
  assert(entry.clipPath);
  bounds(entry).forEach((edge, index) => assert(Math.abs(edge - disjoint[index]) < 1e-9));
  c.update([back, front], view);
  assert.equal(entry.clipPath, "");
});
test("overlapping foreground masks form a union and never reopen rear text in their shared area", () => {
  const c = new MaterialCompositor();
  const rows = c.update([
    surface("rear", 0, 0, { w: 400, h: 300 }),
    surface("middle", 100, 40, { zIndex: 1 }),
    surface("front", 180, 80, { zIndex: 2 }),
  ]);
  const rear = rows[0];
  assert.equal(visible(rear.clipPath, 220, 130), false);
  assert.equal(visible(rear.clipPath, 20, 20), true);
  assert.equal(visible(rear.clipPath, 130, 80), false);
});
test("circular silhouettes leave corner space visible instead of using overlapping AABBs as opacity switches", () => {
  const c = new MaterialCompositor();
  const rows = c.update([
    surface("back", 0, 0, { w: 300, h: 300 }),
    surface("lens", 100, 100, { w: 160, h: 160, shape: "circle", zIndex: 2 }),
  ]);
  assert.equal(visible(rows[0].clipPath, 102, 102), true);
  assert.equal(visible(rows[0].clipPath, 180, 180), false);
});
test("canonical z and binary ID ties determine identical stacking regardless of input order or selection", () => {
  const a = surface("A", 0, 0),
    b = surface("a", 0, 0),
    z = surface("z", 0, 0, { zIndex: 3 });
  const c = new MaterialCompositor();
  assert.deepEqual(
    c.update([z, b, a]).map((r) => r.id),
    ["A", "a", "z"],
  );
  const recomputations = c.recomputations;
  assert.deepEqual(
    c.update([{ ...a, selected: true }, z, b]).map((r) => r.id),
    ["A", "a", "z"],
  );
  assert.equal(
    c.recomputations,
    recomputations,
    "selection alone cannot replace occlusion/material identity",
  );
  assert(compareSurfaceStack(a, b) < 0);
});
test("planar rotation remains distinct from 3D yaw and clipping follows the actual projected pose", () => {
  const c = new MaterialCompositor();
  const rear = surface("rear", 0, 0, { w: 500, h: 400 });
  const front = surface("front", 100, 80, {
    rotation: 32,
    yaw: 18,
    lift: 42,
    zIndex: 2,
  });
  const center = projectSurfacePoint(front, 0, 0);
  const rows = c.update([rear, front]);
  assert.equal(visible(rows[0].clipPath, center.x, center.y), false);
  assert.equal(visible(rows[0].clipPath, 10, 10), true);
  for (const row of rows) assert(!/NaN|Infinity/.test(row.clipPath));
});
test("dragging, resizing and repeated crossings retain valid geometry and release derived clipping", () => {
  const c = new MaterialCompositor(),
    back = surface("back", 100, 100);
  for (let i = 0; i < 180; i++) {
    const x = 350 * Math.sin(i / 15) + 100,
      w = 120 + (i % 60) * 2;
    const rows = c.update([
      back,
      surface("moving", x, 110, { w, rotation: i % 35, zIndex: 2 }),
    ]);
    assert(!rows.some((r) => /NaN|Infinity/.test(r.clipPath)));
  }
  assert(
    c
      .update([back, surface("moving", 600, 600, { zIndex: 2 })])
      .every((r) => !r.clipPath),
  );
});
test("invalid, invisible and perspective-plane crossing inputs fail closed without invalid opacity or CSS", () => {
  const c = new MaterialCompositor();
  for (const patch of [
    { opacity: NaN },
    { opacity: 0 },
    { w: -1 },
    { lift: 1800 },
    { yaw: 90 },
    { x: Infinity },
  ]) {
    const rows = c.update([
      surface("bad", 0, 0, patch),
      surface("good", 20, 20, { zIndex: 1 }),
    ]);
    assert.equal(rows.find((r) => r.id === "bad").covered, true);
    assert(rows.every((r) => !/NaN|Infinity/.test(r.clipPath)));
  }
});
test("3,10 and25 arbitrary IDs share the compositor and reuse warmed scratch capacity", () => {
  for (const n of [3, 10, 25]) {
    const c = new MaterialCompositor();
    const poses = Array.from({ length: n }, (_, i) =>
      surface(`block-${i}`, 50 + (i % 5) * 42, 50 + Math.floor(i / 5) * 28, {
        zIndex: i,
        shape: i % 3 === 0 ? "lens" : "rounded",
      }),
    );
    c.update(poses);
    const capacity = c.diagnostics().scratchPolygons,
      updates = c.recomputations;
    for (let i = 0; i < 20; i++) c.update(poses);
    assert.equal(c.recomputations, updates);
    assert.equal(c.diagnostics().scratchPolygons, capacity);
    assert.equal(c.diagnostics().surfaces, n);
    assert.equal(c.update([]).length, 0);
  }
});
test("glass identity is independent of selection and only continuous emphasis enhances its existing response", () => {
  const materials = createInstrumentMaterials(),
    identities = Object.values(materials);
  try {
    for (const kind of ["conversation", "research", "note"]) {
      const input = {
        study: "optical",
        kind,
        unfold: 0,
        selected: false,
        quality: "balanced",
        architectureWeight: 1,
        emphasis: 0,
      };
      updateInstrumentMaterials(materials, input);
      const values = () =>
        Object.values(materials).map((m) => [
          m.roughness,
          m.clearcoat,
          m.metalness,
          m.opacity,
          m.envMapIntensity,
        ]);
      const resting = values();
      for (let i = 0; i < 100; i++) {
        updateInstrumentMaterials(materials, { ...input, selected: !!(i % 2) });
        assert.deepEqual(values(), resting);
        assert.deepEqual(Object.values(materials), identities);
      }
      assert(
        materials.face.clearcoat > 0.9 &&
          materials.face.roughness < 0.3 &&
          materials.face.opacity === 1,
      );
      const start = materials.face.envMapIntensity;
      let last = start;
      for (let i = 1; i <= 30; i++) {
        updateInstrumentMaterials(materials, {
          ...input,
          selected: true,
          emphasis: i / 30,
        });
        assert(materials.face.envMapIntensity >= last);
        assert(materials.face.envMapIntensity - last < start * 0.01);
        last = materials.face.envMapIntensity;
      }
      updateInstrumentMaterials(materials, { ...input, unfold: 1 });
      assert.equal(materials.face.opacity, 1);
    }
  } finally {
    identities.forEach((m) => m.dispose());
  }
});
test("all six engine contours retain finite positions and unit normals through unfolding", () => {
  const point = { x: 0, y: 0, nx: 0, ny: 0 };
  for (const shape of [
    "rectangle",
    "rounded",
    "circle",
    "pill",
    "folio",
    "lens",
  ])
    for (const unfold of [0, 0.4, 1])
      for (let i = 0; i < 96; i++) {
        contourPoint(320, 200, shape, unfold, i / 96, 0, point);
        assert(Object.values(point).every(Number.isFinite));
        assert(Math.abs(Math.hypot(point.nx, point.ny) - 1) < 1e-8);
      }
});

test("global arrival projection preserves the same rear local clipping region", () => {
  const c = new MaterialCompositor(),
    poses = [
      surface("rear", 50, 60),
      surface("front", 140, 90, { zIndex: 2, rotation: 12, yaw: 8, lift: 25 }),
    ];
  const first = c.update(poses).find((e) => e.id === "rear").clipPath;
  const second = c
    .update(poses, { scale: 0.73, originX: 790, originY: 450 })
    .find((e) => e.id === "rear").clipPath;
  for (const [x, y] of [
    [20, 20],
    [140, 80],
    [180, 130],
  ])
    assert.equal(visible(first, x, y), visible(second, x, y));
});

test("focused representation stays above any canonical layer without rewriting persistent z", () => {
  const back = surface("focus", 0, 0, {
    zIndex: -1000000,
    presentationLayer: 1,
  });
  const front = surface("ordinary", 0, 0, { zIndex: 1000000 });
  const rows = new MaterialCompositor().update([back, front]);
  assert.equal(rows.at(-1).id, "focus");
  assert.equal(back.zIndex, -1000000);
});
