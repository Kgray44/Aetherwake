import test from "node:test";
import assert from "node:assert/strict";
import { createResourcePresenter } from "../src/resource-presentation.ts";

function fixture(projection) {
  const actions = [];
  let active = true;
  const presenter = createResourcePresenter({
    remember: ({ id }) => actions.push(["remember", id]),
    project: (key) => {
      actions.push(["project", key]);
      return projection;
    },
    enqueue: async (run) => run(),
    navigate: async (id) => {
      actions.push(["navigate", id]);
      active = false;
    },
    close: (id) => actions.push(["close", id]),
    focusPlacement: (id) => actions.push(["focus", id]),
    showAgent: async (id) => actions.push(["agent", id]),
    showConversation: async (id, message, current, anchor) =>
      actions.push(["chat", id, message, current(), anchor]),
    showResource: ({ id }, anchor) => actions.push(["resource", id, anchor]),
  });
  return { presenter, actions, current: () => active };
}

function ready(kind, mode = "direct") {
  return {
    resource: { id: "canonical-resource-id", kind },
    presentation: { kind, mode },
    selection: { messageId: "canonical-message-id" },
  };
}

const origin = {
  resourceId: "canonical-resource-id",
  origin: { source: "constellation", nodeKey: "node" },
};
const bounds = { left: 10, top: 20, right: 40, bottom: 60 };

test("conversation handoff retains canonical message and same-resource anchor", async () => {
  const { presenter, actions, current } = fixture({
    resourceId: origin.resourceId,
    clippedBounds: bounds,
  });
  await presenter(ready("conversation"), origin, current);
  assert.deepEqual(actions, [
    ["remember", origin.resourceId],
    ["project", "node"],
    ["close", "canonical-resource"],
    [
      "chat",
      origin.resourceId,
      "canonical-message-id",
      true,
      { x: 10, y: 20, width: 30, height: 40 },
    ],
  ]);
});

test("direct resources reject other-resource anchors and empty bounds", async () => {
  for (const projection of [
    { resourceId: "other", clippedBounds: bounds },
    {
      resourceId: origin.resourceId,
      clippedBounds: { ...bounds, right: bounds.left },
    },
  ]) {
    const { presenter, actions, current } = fixture(projection);
    await presenter(ready("note"), origin, current);
    assert.deepEqual(actions.slice(-2), [
      ["close", "conversations"],
      ["resource", origin.resourceId, undefined],
    ]);
  }
});

test("superseded placement navigation leaves current focus and surfaces alone", async () => {
  const { presenter, actions, current } = fixture();
  await presenter(
    {
      ...ready("note", "existing-placement"),
      placement: { workspaceId: "workspace", blockId: "block" },
    },
    origin,
    current,
  );
  assert.deepEqual(actions, [
    ["remember", origin.resourceId],
    ["navigate", "workspace"],
  ]);
  await presenter(ready("agent"), origin, current);
  assert.equal(actions.length, 2);
});
