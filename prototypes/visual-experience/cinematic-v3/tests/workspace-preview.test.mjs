import assert from "node:assert/strict";
import { test } from "node:test";
import { MotionCoordinator } from "../src/motion.ts";
import { mountWorkspacePreview } from "../src/workspace-preview.ts";

test("workspace preview coalesces requests and commits against the first captured layout revision", () => {
  const motion = new MotionCoordinator();
  const guide = {
    style: {},
    setAttribute() {},
    innerHTML: "",
    replaceChildren() {},
  };
  const document = { createElement: () => guide, body: { dataset: {} } };
  const stage = { ownerDocument: document, append() {} };
  const layout = {
    blocks: [],
    revision: 3,
    organization: { mode: "freeform" },
  };
  const requests = [];
  const view = mountWorkspacePreview({
    stage,
    motion,
    camera: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
    layout() {},
    wake() {},
    failed: (error) => assert.fail(error),
    calculate: (_layout, request) => {
      requests.push(request);
      return { ...layout, guides: [], placementAreas: [] };
    },
  });
  const bounds = { x: 0, y: 0, width: 800, height: 600 };
  view.queue(
    () => layout,
    { intent: "move" },
    () => bounds,
  );
  view.queue(
    () => assert.fail("the original layout is already captured"),
    { intent: "resize" },
    () => bounds,
  );
  assert.deepEqual(requests, []);
  view.paint();
  assert.deepEqual(requests, [
    { intent: "resize", expectedRevision: 3, bounds },
  ]);
  assert.equal(view.revision, 3);
  view.paint();
  assert.equal(requests.length, 1);
  view.cancel();
  assert.equal(view.revision, undefined);
  assert.equal(view.current, undefined);
  assert.equal(document.body.dataset.layoutPreview, undefined);
});

test("unchanged geometry retains guide nodes and reduced motion settles dismissal", () => {
  const motion = new MotionCoordinator();
  let writes = 0,
    clears = 0;
  const guide = {
    style: {},
    setAttribute() {},
    set innerHTML(value) {
      assert.match(value, /placement-area/);
      writes++;
    },
    replaceChildren() {
      clears++;
    },
  };
  const stage = {
    ownerDocument: { createElement: () => guide, body: { dataset: {} } },
    append() {},
  };
  const base = { revision: 4 };
  const review = {
    organization: { mode: "structured" },
    guides: [],
    placementAreas: [{ x: 2, y: 3, width: 4, height: 5 }],
  };
  const preview = mountWorkspacePreview({
    stage,
    motion,
    camera: () => ({ zoom: 1, offset: { x: 0, y: 0 } }),
    layout() {},
    wake() {},
    failed: (error) => assert.fail(error),
  });
  preview.showReview(base, review);
  preview.showReview(base, review);
  preview.frame(true);
  assert.equal(writes, 1);
  assert.equal(guide.style.opacity, "1");
  preview.cancel();
  preview.frame(true);
  preview.frame(true);
  assert.equal(guide.style.opacity, "0");
  assert.equal(clears, 1);
});
