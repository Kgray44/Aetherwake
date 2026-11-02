import test from "node:test";
import assert from "node:assert/strict";
import { approachWorkspaceCard } from "../src/workspace-approach.ts";

const example = () => ({
  block: { x: 400, y: 300, width: 380, height: 600 },
  view: { x: -100, y: 80, zoom: 0.5 },
  body: { width: 190, height: 300, bodyWidth: 150, bodyHeight: 180 },
  minimum: { minimumBodyWidth: 256, minimumBodyHeight: 108 },
  safe: { x: 20, y: 170, width: 1560, height: 680 },
});
const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);

test("Approach gives a narrow conversation readable body space and centers only its camera", () => {
  const input = example(),
    before = structuredClone(input);
  const { viewport: v, constrained } = approachWorkspaceCard(input);
  assert(!constrained);
  close((input.body.bodyWidth * v.zoom) / input.view.zoom, 256);
  close((input.block.x + input.block.width / 2 - v.x) * v.zoom, 800);
  close((input.block.y + input.block.height / 2 - v.y) * v.zoom, 510);
  assert(input.block.height * v.zoom <= input.safe.height);
  assert.deepEqual(
    input,
    before,
    "saved block geometry and return viewport stay byte-for-byte equivalent",
  );
});

test("real exhausted body space grows past existing chrome without dividing by zero", () => {
  const input = example();
  input.body.bodyHeight = 0;
  const { viewport: v } = approachWorkspaceCard(input);
  assert(Number.isFinite(v.zoom));
  assert(
    input.block.height * v.zoom - input.body.height >=
      input.minimum.minimumBodyHeight,
  );
});

test("an interrupted camera transition uses actual projected size and never multiplies the newer target zoom twice", () => {
  const input = example();
  input.view.zoom = 1;
  const { viewport: v } = approachWorkspaceCard(input);
  close(v.zoom, 1);
});

test("rotation, viewport contraction and maximum zoom constrain framing without rotating or resizing the card", () => {
  const input = example();
  input.block.rotation = 90;
  input.safe = { x: 20, y: 170, width: 500, height: 400 };
  const result = approachWorkspaceCard(input);
  assert(result.constrained);
  close(result.viewport.zoom, 500 / 600);
  const maximum = example();
  maximum.block = { x: -200, y: 600, width: 60, height: 100 };
  maximum.body = { width: 30, height: 50, bodyWidth: 1, bodyHeight: 1 };
  assert.equal(approachWorkspaceCard(maximum).viewport.zoom, 4);
});

test("invalid/unobservable geometry and a safe area already too small fail without inventing a destination", () => {
  for (const edit of [
    (i) => (i.body.width = 0),
    (i) => (i.body.bodyHeight = NaN),
    (i) => (i.view.zoom = 5),
    (i) => (i.block.x = Infinity),
    (i) => (i.block.rotation = NaN),
    (i) => (i.safe.height = 0),
  ]) {
    const input = example();
    edit(input);
    assert.throws(() => approachWorkspaceCard(input), /geometry_unavailable/);
  }
  const input = example();
  input.safe.height = 200;
  assert.throws(() => approachWorkspaceCard(input), /needs_more_room/);
});
