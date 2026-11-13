import assert from "node:assert/strict";
import test from "node:test";
import { componentDocument, named, until } from "../../../conversation-product/test/component-dom.mts";
import { mountMemoryInspectorNavigation } from "../src/memory-inspector-navigation.ts";

test("Saved memories opens and scrolls the exact canonical message through restricted IPC", async () => {
  const f = componentDocument();
  const restore = f.install();
  const scrolled = [];
  const prototype = Object.getPrototypeOf(f.root);
  const scrollIntoView = prototype.scrollIntoView;
  prototype.scrollIntoView = function (options) {
    scrolled.push({ id: this.dataset.messageId, options });
  };

  const resourceId = "chat:fixture";
  const messageId = "message:exact";
  const record = { id: "fact-1", version: 3, scope: { kind: "conversation", id: resourceId }, state: "active" };
  const fact = { ...record, text: "Synthetic saved fact", keywords: [],
    provenance: { kind: "conversation-message", conversationId: resourceId, messageId } };
  const createdAt = "2026-11-02T00:00:00Z";
  const message = { id: messageId, resourceId, role: "user", content: "Exact original text",
    createdAt, provenance: "user", inherited: false, sensitivity: "internal" };
  const detail = {
    conversation: { resourceId, conversationId: "graph:fixture", title: "Synthetic conversation",
      providerId: "local", revision: 2, version: 1, projectId: null, projectIds: [],
      state: "active", createdAt, favorite: false, messageCount: 1, collectionIds: [] },
    messages: { items: [message], total: 1, offset: 0, limit: 1, hasMore: false },
    lineage: [], shares: [], providers: [],
    policy: { resourceId, revision: 1, mode: "independent", allowedSourceIds: [],
      allowCrossProject: false, maxSensitivity: "internal", categories: ["excerpt"] },
  };
  const calls = [];
  let wrongMessage = false;
  try {
    const view = mountMemoryInspectorNavigation(f.root, async (command, input) => {
      calls.push([command, input]);
      if (command === "personalMemory" && input.type === "list")
        return { records: [record], next: null, policy: { version: 1 } };
      if (command === "personalMemory" && input.type === "read") return fact;
      if (command === "openResource") return { contract: "aerynth.resource-opening@1", status: "ready",
        resourceId, resource: { id: resourceId, messages: [] },
        presentation: { kind: "conversation", mode: "direct" }, selection: { messageId } };
      if (command === "conversation" && input.name === "detail")
        return wrongMessage ? { ...detail, messages: { ...detail.messages, items: [{ ...message, id: "other" }] } } : detail;
      assert.fail(`Unexpected fixture command: ${command}`);
    });
    named(view, "Load saved memories").fire("click");
    await until(() => !!named(view, "Memory fact-1 · conversation · active"));
    named(view, "Memory fact-1 · conversation · active").fire("click");
    await until(() => !!named(view, "Open original message"));
    const open = named(view, "Open original message");
    open.fire("click");
    const selector = '[data-message-id="message:exact"]';
    await until(() => !!f.doc.activeElement?.matches(selector));
    const rendered = f.root.querySelector(selector);
    assert.equal(f.doc.activeElement, rendered);
    assert.match(rendered.textContent, /Exact original text/);
    assert.deepEqual(scrolled, [{ id: messageId, options: { block: "center" } }]);
    assert.equal(f.root.querySelector(".cp-composer"), null);
    assert.deepEqual(calls, [
      ["personalMemory", { type: "list", after: null }],
      ["personalMemory", { type: "read", id: record.id }],
      ["personalMemory", { type: "read", id: record.id }],
      ["openResource", { resourceId, selection: { messageId } }],
      ["conversation", { name: "detail", input: { resourceId, aroundMessageId: messageId } }],
    ]);
    await until(() => !open.disabled);
    wrongMessage = true;
    open.fire("click");
    await until(() => /Original message is unavailable/.test(view.textContent));
    assert.equal(f.root.querySelector(".cp-chat"), null);
    assert.equal(scrolled.length, 1);
  } finally {
    prototype.scrollIntoView = scrollIntoView;
    restore();
  }
});
