import test from "node:test";
import assert from "node:assert/strict";
import { workspaceWheelFactor } from "../src/workspace-wheel.ts";

const event = {
  deltaX: 0,
  deltaY: 64,
  deltaMode: 0,
  defaultPrevented: false,
  cancelable: true,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};
const context = {
  workspace: true,
  background: true,
  blocked: false,
  hidden: false,
  pageHeight: 1000,
};

test("workspace traversal does not consume editor, card, overlay, drag, hidden or already-handled wheel input", () => {
  for (const changed of [
    { workspace: false },
    { background: false },
    { blocked: true },
    { hidden: true },
  ])
    assert.equal(workspaceWheelFactor(event, { ...context, ...changed }), null);
  for (const changed of [
    { defaultPrevented: true },
    { cancelable: false },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
  ])
    assert.equal(workspaceWheelFactor({ ...event, ...changed }, context), null);
  for (const changed of [
    { deltaY: 0 },
    { deltaX: 128 },
    { deltaY: NaN },
    { deltaX: Infinity },
    { deltaMode: 9 },
  ])
    assert.equal(workspaceWheelFactor({ ...event, ...changed }, context), null);
});

test("pixel, line and page wheels share one bounded traversal scale in both directions", () => {
  const pixels = workspaceWheelFactor(event, context);
  assert.equal(
    workspaceWheelFactor({ ...event, deltaY: 4, deltaMode: 1 }, context),
    pixels,
  );
  assert.equal(
    workspaceWheelFactor({ ...event, deltaY: 0.064, deltaMode: 2 }, context),
    pixels,
  );
  assert.ok(pixels < 1 && pixels > 0);
  assert.ok(workspaceWheelFactor({ ...event, deltaY: -64 }, context) > 1);
  assert.equal(
    workspaceWheelFactor({ ...event, deltaY: 1e9 }, context),
    workspaceWheelFactor({ ...event, deltaY: 150 }, context),
  );
  assert.equal(
    workspaceWheelFactor({ ...event, deltaY: -1e9 }, context),
    workspaceWheelFactor({ ...event, deltaY: -150 }, context),
  );
  assert.equal(
    workspaceWheelFactor(event, { ...context, pageHeight: 0 }),
    null,
  );
});
