import test from "node:test";
import assert from "node:assert/strict";
import { blockDocument } from "../../../block-library/tests/component-dom.mts";
import { createResourceSurface } from "../src/resource-surface.ts";

const resource = (id, patch = {}) => ({
  id,
  kind: "note",
  title: id,
  version: 1,
  content: "Synthetic canonical text",
  available: true,
  visible: true,
  state: "active",
  ...patch,
});

function fixture() {
  const dom = blockDocument(),
    restore = dom.install();
  const mounted = [],
    disposed = [],
    failed = [];
  let request;
  const surface = createResourceSurface({
    surfaces: {
      open(next) {
        if (request && request.content !== next.content)
          request.onClose?.("programmatic");
        request = next;
        return next.content;
      },
      close() {
        request?.onClose?.("programmatic");
        request = undefined;
      },
    },
    anchor: () => ({ x: 240, y: 160, width: 16, height: 16 }),
    failed: (error) => failed.push(error.message),
    mount(root, value) {
      const editor = document.createElement("textarea");
      editor.value = value.content;
      root.append(editor);
      const view = {
        root,
        editor,
        active: true,
        flushError: null,
        update(next) {
          view.current = next;
        },
        setActive(active) {
          view.active = active;
        },
        async flush() {
          if (view.flushError) throw Error(view.flushError);
        },
        dispose() {
          disposed.push(value.id);
        },
      };
      mounted.push(view);
      return view;
    },
  });
  return {
    surface,
    mounted,
    disposed,
    failed,
    restore,
    request: () => request,
  };
}

test("focused resource reopens the same editor DOM and keeps its caret, draft and scroll", () => {
  const f = fixture();
  try {
    f.surface.show(resource("a"));
    const editor = f.mounted[0].editor;
    editor.value = "Synthetic unsent edit";
    editor.selectionStart = 7;
    editor.selectionEnd = 12;
    editor.scrollTop = 95;
    f.request().onClose("close-button");
    f.surface.show(resource("a", { version: 2 }));
    assert.equal(f.mounted.length, 1);
    assert.equal(f.mounted[0].editor, editor);
    assert.equal(editor.value, "Synthetic unsent edit");
    assert.equal(editor.selectionStart, 7);
    assert.equal(editor.selectionEnd, 12);
    assert.equal(editor.scrollTop, 95);
    assert.deepEqual(f.disposed, []);
  } finally {
    f.restore();
  }
});

test("switching direct resources retains the previous canonical editor without manufacturing placements", () => {
  const f = fixture();
  try {
    f.surface.show(resource("a"));
    f.surface.show(resource("b"));
    assert.equal(f.mounted[0].active, false);
    f.surface.show(resource("a"));
    assert.equal(f.mounted.length, 2);
    assert.equal(f.mounted[0].active, true);
    assert.equal(f.request().content.dataset.resourceId, "a");
    assert.equal(f.request().content.dataset.block, undefined);
  } finally {
    f.restore();
  }
});

test("current availability revocation disposes and clears even cached focused content", () => {
  const f = fixture();
  try {
    f.surface.show(resource("a"));
    f.surface.reconcile([resource("a", { available: false, visible: false })]);
    assert.deepEqual(f.disposed, ["a"]);
    assert.equal(f.mounted[0].root.children.length, 0);
    assert.equal(f.request(), undefined);
    assert.throws(
      () => f.surface.show(resource("a", { available: false })),
      /resource_unavailable/,
    );
    f.surface.show(resource("a"));
    assert.equal(f.mounted.length, 2);
  } finally {
    f.restore();
  }
});

test("failed canonical draft flush keeps the existing view available to recover", async () => {
  const f = fixture();
  try {
    f.surface.show(resource("a"));
    f.mounted[0].flushError = "note_version_conflict";
    assert.equal(await f.request().beforeClose("close-button"), false);
    assert.deepEqual(f.failed, ["note_version_conflict"]);
    assert.deepEqual(f.disposed, []);
    assert.equal(f.mounted[0].active, true);
  } finally {
    f.restore();
  }
});
