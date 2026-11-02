import { test } from "node:test";
import assert from "node:assert/strict";
import { graphControls } from "../graph-controls.ts";

// A small form harness exercises the actual submit closure, without a browser.
class Element {
  constructor(tag, text = "") {
    this.tag = tag;
    this.textContent = text;
    this.children = [];
    this.checked = this.disabled = this.open = false;
    this.value = "";
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.get("close")?.(); }
}
const all = (element) => [element, ...element.children.flatMap(all)];

test("the actual branch form submits a local continuation with only reviewed in-boundary context", async (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    activeElement: { isConnected: true, focus() {} },
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new Element("#text", text),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const source = { id: "source", title: "Synthetic conversation", kind: "conversation", provider: "local",
    messages: [0, 1, 2].map((i) => ({ id: "m" + i, role: "user", content: "Synthetic message " + i })) };
  const before = structuredClone(source), actions = [], root = new Element("div");
  const controller = {
    selected: "resource:block",
    nodes: new Map([["resource:block", { resourceId: source.id, workspaceId: "workspace" }]]),
    snapshot: { resources: [source] },
    act: async (action) => actions.push(action),
  };
  graphControls(root, controller, () => {}).branch();
  const elements = all(root), checks = elements.filter((e) => e.tag === "input" && e.type === "checkbox");
  assert.equal(checks.length, 3);
  assert.ok(checks.every((e) => !e.checked), "context requires explicit selection");
  const boundary = elements.find((e) => e.tag === "select");
  checks[0].checked = checks[2].checked = true;
  boundary.value = "m1";
  boundary.onchange();
  assert.equal(checks[2].disabled, true);
  assert.equal(checks[2].checked, false, "later context is removed at the boundary");
  elements.find((e) => e.tag === "input" && e.type === "text").value = "Reviewed continuation";
  await elements.find((e) => e.tag === "form").onsubmit({ preventDefault() {} });
  assert.deepEqual(actions, [{ type: "branch", resourceId: "source", messageId: "m1",
    includeMessageIds: ["m0"], title: "Reviewed continuation", providerId: "local",
    tokenBudget: 1024, workspaceId: "workspace" }]);
  assert.deepEqual(source, before, "the form does not edit the source conversation");
});
