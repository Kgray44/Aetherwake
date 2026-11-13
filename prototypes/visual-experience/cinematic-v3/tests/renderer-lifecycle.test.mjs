import assert from "node:assert/strict";
import { test } from "node:test";
import { mountRendererLifecycle } from "../src/renderer-lifecycle.ts";

test("context recovery replaces the owned renderer and failed recovery clears the stale reference", () => {
  const canvas = new EventTarget();
  const page = new EventTarget();
  const signals = [];
  let created = 0;
  const lifecycle = mountRendererLifecycle({
    canvas,
    page,
    create() {
      const id = ++created;
      if (id === 2) throw new Error("GPU unavailable");
      return {
        id,
        dispose() {
          signals.push("dispose " + id);
        },
      };
    },
    changed(state) {
      signals.push(state);
    },
    failed(error) {
      signals.push(error.message);
    },
  });
  const loss = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(loss);
  assert.equal(loss.defaultPrevented, true);
  assert.equal(lifecycle.graphicsFailed, true);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(lifecycle.current, null);
  assert.equal(lifecycle.graphicsFailed, true);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(lifecycle.current.id, 3);
  assert.equal(lifecycle.graphicsFailed, false);
  page.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
  assert.equal(lifecycle.current.id, 3);
  page.dispatchEvent(new Event("pagehide"));
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(lifecycle.current, null);
  assert.deepEqual(signals, [
    "interrupted",
    "dispose 1",
    "GPU unavailable",
    "restored",
    "dispose 3",
  ]);
});

test("initial failure selects fallback and allows a later context restoration", () => {
  const canvas = new EventTarget();
  const changes = [];
  let create = 0;
  const lifecycle = mountRendererLifecycle({
    canvas,
    page: new EventTarget(),
    create() {
      if (!create++) throw new Error("initial");
      return { dispose() {} };
    },
    changed(state) {
      changes.push(state);
    },
    failed() {},
  });
  assert.equal(lifecycle.graphicsFailed, true);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(lifecycle.graphicsFailed, false);
  assert.deepEqual(changes, ["unavailable", "restored"]);
});
