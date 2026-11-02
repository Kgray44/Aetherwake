import test from "node:test";
import assert from "node:assert/strict";
import { blockDocument } from "./component-dom.mts";
import { until } from "../../conversation-product/test/component-dom.mts";
import { mountNoteExperience } from "../note-view.ts";
import { NoteSession } from "../note-session.ts";
import type { NoteExperiencePort } from "../note-contracts.ts";
import { mountTaskGroupExperience } from "../task-group-view.ts";
import type { Resource } from "../../application-contract/contracts.ts";

// Actual view/session components at a CPU DOM boundary. This does not claim
// browser sizing, native pointer/keyboard input, GPU motion or owner acceptance.
for (const kind of ["note", "research", "reference"] as const) {
  test(`${kind} keeps its real editor, mode, recovery text and selection through workspace/focused transitions`, async (t) => {
    const view = blockDocument(),
      restore = view.install();
    view.doc.addEventListener = () => {};
    view.doc.removeEventListener = () => {};
    let controller: ReturnType<typeof mountNoteExperience> | undefined;
    t.after(() => {
      controller?.dispose();
      restore();
    });
    const text = "# Synthetic findings\nA source: https://example.com/source",
      canonical = {
        id: "document:" + kind,
        kind,
        title: "Synthetic " + kind,
        content: "Saved base",
        version: 3,
      },
      writes: string[] = [];
    const port: NoteExperiencePort = {
      async readNote() {
        return {
          resource: canonical,
          draft: {
            content: text,
            version: 7,
            baseResourceVersion: 3,
            updatedAt: "2026-11-02T00:00:00Z",
          },
          draftRevision: 7,
          conflict: false,
          canRename: false,
        };
      },
      async saveNoteDraft(input) {
        writes.push(input.content);
        return {
          version: input.expectedDraftVersion + 1,
          baseResourceVersion: 3,
          content: input.content,
          updatedAt: "2026-11-02T00:00:01Z",
        };
      },
      async commitNote() {
        throw new Error("unexpected commit");
      },
      async discardNoteDraft() {
        throw new Error("unexpected discard");
      },
    };
    const session = new NoteSession(canonical.id, port, canonical);
    await until(() => session.snapshot().phase !== "loading");
    const label = view.doc.createElement("label"),
      editor = view.doc.createElement("textarea");
    label.append(editor);
    view.root.append(label);
    editor.oninput = () => {
      void session.edit(editor.value);
    };
    controller = mountNoteExperience(view.root, editor, session, port, {
      kind,
      initialMode: kind === "note" ? "write" : "read",
      presentation: "workspace",
    });
    assert.equal(editor.value, text);
    assert.equal(editor.hidden, kind !== "note");
    if (kind !== "note") {
      const sources = view.root.querySelector(".aw-note-sources"),
        reading = view.root.querySelector(".aw-note-reading");
      assert.match(sources.textContent, /https:\/\/example.com\/source/);
      assert.match(reading.textContent, /Synthetic findings/);
      assert.equal(
        view.root.children.indexOf(sources) <
          view.root.children.indexOf(reading),
        kind === "reference",
      );
      view.root.querySelector(".aw-note-tools button").onclick();
    }
    editor.focus();
    editor.setSelectionRange(5, 12);
    editor.scrollTop = 33;
    controller.setPresentation("focused");
    controller.setPresentation("workspace");
    controller.setActive(false);
    controller.setActive(true);
    assert.equal(view.root.querySelector("textarea"), editor);
    assert.equal(view.doc.activeElement, editor);
    assert.equal(
      editor.hidden,
      false,
      "Chosen editing mode survives pose changes",
    );
    assert.deepEqual(
      [editor.selectionStart, editor.selectionEnd, editor.scrollTop],
      [5, 12, 33],
    );
    assert.equal(
      writes.length,
      0,
      "Presentation does not write or re-read a document",
    );
    editor.value += "\nTyped directly in the normal card";
    editor.oninput();
    await session.persist();
    assert.equal(writes.at(-1), editor.value);
    assert.equal(
      canonical.content,
      "Saved base",
      "A recovery write is not a committed document",
    );
  });
}

test("normal task-group checklist updates real member IDs, preserves search/focus and rolls failed changes back to the canonical projection", async (t) => {
  const view = blockDocument(),
    restore = view.install();
  let controller: ReturnType<typeof mountTaskGroupExperience> | undefined;
  t.after(() => {
    controller?.dispose();
    restore();
  });
  let members: NonNullable<Resource["taskMembers"]> = [
      { id: "task:a", title: "Synthetic first task", status: "open" },
      { id: "task:b", title: "Synthetic second task", status: "done" },
    ],
    fail = false,
    manages = 0;
  const calls: { resourceId: string; status: "open" | "done" }[] = [],
    opens: string[] = [];
  controller = mountTaskGroupExperience(view.root, {
    members,
    presentation: "workspace",
    async setStatus(input) {
      calls.push(input);
      if (fail) throw new Error("task_version_conflict");
      members = members.map((member) =>
        member.id === input.resourceId
          ? { ...member, status: input.status }
          : member,
      );
      controller!.update(members);
    },
    manageMembers() {
      manages++;
    },
    openTask(id) {
      opens.push(id);
    },
  });
  const search =
      view.root.querySelector('input[type="search"]') ??
      view.root.querySelector("input"),
    row = view.root.querySelector('[data-task-id="task:a"]'),
    checkbox = row.querySelector("input");
  const completion = view.root.querySelector(".aw-task-group-completion");
  assert.equal(completion.hidden, false);
  assert.deepEqual([completion.value, completion.max], [1, 2]);
  checkbox.focus();
  checkbox.checked = true;
  checkbox.onchange();
  await until(() => calls.length === 1 && !checkbox.disabled);
  assert.deepEqual(calls, [{ resourceId: "task:a", status: "done" }]);
  assert.equal(checkbox.checked, true);
  assert.deepEqual([completion.value, completion.max], [2, 2]);
  assert.equal(view.root.querySelector('[data-task-id="task:a"]'), row);
  controller.setPresentation("focused");
  controller.setPresentation("workspace");
  assert.equal(view.doc.activeElement, checkbox);
  fail = true;
  checkbox.checked = false;
  checkbox.onchange();
  await until(() => calls.length === 2 && !checkbox.disabled);
  assert.equal(checkbox.checked, true);
  assert.equal(completion.getAttribute("aria-valuetext"), "2 of 2 completed locally", "Failure cannot advance completion independently of canonical membership");
  assert.match(
    view.root.querySelector(".aw-task-group-status").textContent,
    /version conflict/,
  );
  search.value = "first";
  search.focus();
  search.setSelectionRange(1, 4);
  search.oninput();
  controller.update([...members]);
  controller.setPresentation("focused");
  assert.equal(view.root.querySelector("input"), search);
  assert.equal(view.root.querySelectorAll("[data-task-id]").length, 1);
  assert.deepEqual([completion.value, completion.max], [2, 2], "Filtering never substitutes the visible subset for group completion");
  assert.deepEqual([search.selectionStart, search.selectionEnd], [1, 4]);
  view.root.querySelector(".aw-task-group-title").onclick();
  assert.deepEqual(opens, ["task:a"]);
  view.root
    .querySelectorAll("button")
    .find((button: any) => button.textContent === "Manage tasks")
    .onclick();
  await until(() => manages === 1);
  controller.setActive(false);
  controller.update([]);
  assert.equal(
    view.root.querySelectorAll("[data-task-id]").length,
    1,
    "Inactive rows do not repaint",
  );
  controller.setActive(true);
  assert.equal(view.root.querySelectorAll("[data-task-id]").length, 0);
  assert.equal(completion.hidden, true, "An empty group has no implied progress percentage");
});
