import test from "node:test";
import assert from "node:assert/strict";
import { deriveSceneState } from "../src/scene-state.ts";
import { validateMessages } from "../src/conversation.ts";
const base = {
  selected: null,
  expanded: null,
  related: null,
  dragging: false,
  focus: 0,
  attention: 0,
  ambient: true,
  ambientStrength: 1,
  quiet: false,
  visible: true,
  reduced: false,
  vela: "idle",
  pointer: { x: 0.4, y: 0.2 },
  surfaces: [{ id: "folio", x: 100, y: 200, w: 200, h: 100 }],
  width: 1000,
  height: 800,
};
test("one scene interpretation follows the actual moving resource and calms around focused work", () => {
  const workspace = deriveSceneState(base);
  const selected = deriveSceneState({
    ...base,
    selected: "folio",
    dragging: true,
  });
  const focused = deriveSceneState({
    ...base,
    selected: "folio",
    expanded: "folio",
    focus: 1,
  });
  assert.deepEqual(workspace.pointer, base.pointer);
  assert.deepEqual(selected.pointer, { x: -0.6, y: 0.375 });
  assert.equal(selected.interaction, 1);
  assert.equal(focused.activeResource, "folio");
  assert.ok(focused.ambientStrength < workspace.ambientStrength);
  assert.equal(focused.focus, 1);
});
test("absence of availability, visibility or motion permission never invents autonomous Vela motion", () => {
  for (const setting of [
    { visible: false },
    { reduced: true },
    { quiet: true },
    { ambient: false },
    { vela: "unavailable" },
  ])
    assert.equal(deriveSceneState({ ...base, ...setting }).ambientStrength, 0);
});

test("plain card selection stays local instead of retargeting environmental pointer, illumination or focus", () => {
  const before = deriveSceneState(base);
  const selected = deriveSceneState({ ...base, selected: "folio" });
  assert.deepEqual(selected, before);
  assert.equal(selected.activeResource, null);
  assert.equal(selected.interaction, 0);
  assert.equal(selected.focus, 0);
});
test("local history rejects oversized, duplicate and malformed entries without accepting corrupt persistence", () => {
  const message = {
    id: "local-1",
    text: "A thought",
    at: "2026-11-01T00:00:00Z",
  };
  assert.deepEqual(validateMessages([message]), [message]);
  assert.equal(validateMessages([message, message]), null);
  assert.equal(validateMessages([{ ...message, at: "later" }]), null);
  assert.equal(
    validateMessages([{ ...message, text: "x".repeat(200001) }]),
    null,
  );
  assert.equal(validateMessages([{ ...message, text: " " }]), null);
});
