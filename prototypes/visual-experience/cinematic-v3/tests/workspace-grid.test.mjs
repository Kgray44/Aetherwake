import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import {
  createWorkspaceGrid,
  projectWorkspaceGrid,
} from "../src/workspace-grid.ts";
import { STRUCTURED_GRID_SIZE } from "../../../workspace-engine/structured-grid.mts";
const policy = {
  reduced: false,
  quiet: false,
  hidden: false,
  graphicsAvailable: true,
  tier: "balanced",
};

test("the sparse paint grid remains world-anchored to the unchanged canonical16-unit lattice across zoom and pan", () => {
  assert.equal(STRUCTURED_GRID_SIZE, 16);
  for (const zoom of [0.05, 0.17, 0.5, 0.8, 1, 1.7, 3, 4]) {
    const offset = { x: -357.25, y: 83.125 },
      layers = projectWorkspaceGrid(zoom, offset);
    assert(layers);
    assert(
      Math.abs(layers.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12,
    );
    for (const item of layers) {
      assert.equal(Math.log2(item.worldStep / 16) % 1, 0);
      assert(item.spacing >= 64 && item.spacing <= 256);
      assert(item.x >= 0 && item.x < item.spacing);
      assert(item.y >= 0 && item.y < item.spacing);
      assert(
        Math.abs(
          (offset.x - item.x) / item.spacing -
            Math.round((offset.x - item.x) / item.spacing),
        ) < 1e-10,
      );
    }
  }
  for (const zoom of [0, -1, NaN, Infinity, Number.MIN_VALUE, Number.MAX_VALUE])
    assert.equal(projectWorkspaceGrid(zoom, { x: 0, y: 0 }), null);
  assert.equal(projectWorkspaceGrid(1, { x: Infinity, y: 0 }), null);
});

test("density transitions share the same dominant world line family on both sides of an LOD boundary", () => {
  for (const boundary of [0.25, 0.5, 1, 2]) {
    const left = projectWorkspaceGrid(boundary * (1 - 1e-8), { x: -33, y: 88 }),
      right = projectWorkspaceGrid(boundary * (1 + 1e-8), { x: -33, y: 88 });
    const dominant = (layers) =>
        layers.reduce((a, b) => (a.weight > b.weight ? a : b)),
      a = dominant(left),
      b = dominant(right);
    assert.equal(a.worldStep, b.worldStep);
    assert(a.weight > 0.99999 && b.weight > 0.99999);
    assert(Math.abs(a.spacing - b.spacing) < 0.00001);
  }
});

function fixture(paintInScene = false) {
  const motion = new MotionCoordinator();
  let wakes = 0,
    writes = 0;
  const element = () => ({
    children: [],
    hidden: false,
    style: {
      setProperty() {
        writes++;
      },
    },
    setAttribute() {},
    append(child) {
      this.children.push(child);
    },
    remove() {},
  });
  const root = element();
  root.ownerDocument = { createElement: element };
  const grid = createWorkspaceGrid({
    root,
    motion,
    paintInScene,
    wake() {
      wakes++;
    },
  });
  return {
    grid,
    root,
    motion,
    get wakes() {
      return wakes;
    },
    get writes() {
      return writes;
    },
  };
}

test("mode reveal reverses in the existing spring; fade-out retains its geometry until settled and idle writes stop", () => {
  const f = fixture(),
    input = { visible: true, zoom: 1, offset: { x: 12, y: 24 } };
  f.grid.update(input);
  f.grid.frame(policy);
  assert.equal(f.grid.diagnostics().reveal, 0);
  f.motion.step(1 / 60);
  f.grid.frame(policy);
  const reveal = f.grid.diagnostics().reveal;
  assert(reveal > 0 && reveal < 1);
  const projection = structuredClone(f.grid.diagnostics().projection);
  f.grid.update({
    ...input,
    visible: false,
    zoom: 0.05,
    offset: { x: 100, y: 100 },
  });
  assert.equal(f.grid.diagnostics().reveal, reveal);
  assert.deepEqual(f.grid.diagnostics().projection, projection);
  assert.equal(f.root.hidden, false);
  for (let i = 0; i < 180; i++) {
    f.motion.step(1 / 60);
    f.grid.frame(policy);
  }
  assert.equal(f.root.hidden, true);
  assert.equal(f.grid.diagnostics().reveal, 0);
  const writes = f.writes,
    wakes = f.wakes;
  for (let i = 0; i < 30; i++) {
    f.grid.update({ ...input, visible: false });
    f.grid.frame(policy);
  }
  assert.equal(f.writes, writes);
  assert.equal(f.wakes, wakes);
  assert.equal(f.motion.bodies.size, 1);
  f.grid.dispose();
  assert.equal(f.motion.bodies.size, 0);
});

test("reduced motion reconciles reveal immediately without changing paint spacing or introducing another body", () => {
  const f = fixture();
  f.grid.update({ visible: true, zoom: 0.8, offset: { x: 12, y: 24 } });
  f.grid.frame({ ...policy, reduced: true });
  assert.equal(f.grid.diagnostics().reveal, 1);
  const projection = structuredClone(f.grid.diagnostics().projection);
  f.grid.update({ visible: false, zoom: 4, offset: { x: 99, y: 99 } });
  f.grid.frame({ ...policy, reduced: true });
  assert.equal(f.grid.diagnostics().reveal, 0);
  assert.equal(f.root.hidden, true);
  assert.deepEqual(f.grid.diagnostics().projection, projection);
  assert.equal(f.motion.bodies.size, 1);
  f.grid.dispose();
});

test("scene painting retains MC reveal and LOD without painting a DOM grid over physical surfaces", () => {
  const f = fixture(true);
  assert.match(f.root.style.cssText, /display:none/);
  f.grid.update({ visible: true, zoom: 0.8, offset: { x: 12, y: 24 } });
  f.motion.step(1 / 60);
  f.grid.frame(policy);
  assert(f.grid.diagnostics().reveal > 0 && f.grid.diagnostics().reveal < 1);
  assert.equal(f.writes, 0);
  assert.equal(f.motion.bodies.size, 1);
  f.grid.dispose();
});
