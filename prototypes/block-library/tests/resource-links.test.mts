import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import {
  resourceLinks,
  confirmsResourceLinkChange,
  type ResourceLinksPort,
  type ResourceLinkAction,
  type ResourceLinksSnapshot,
} from "../resource-links.ts";
import { mountResourceLinks } from "../resource-links-view.ts";
import { blockDocument } from "./component-dom.mts";
import { until } from "../../conversation-product/test/component-dom.mts";
import type {
  Resource,
  DesktopCommand,
} from "../../application-contract/contracts.ts";
import { NoteSession } from "../note-session.ts";
import { mountNoteExperience } from "../note-view.ts";
import type { NoteExperiencePort } from "../note-contracts.ts";

const { graphAction } = createRequire(import.meta.url)(
  "../../visual-experience/cinematic-v3/native/graph-actions.cjs",
);
const resource = (id: string, extra: Partial<Resource> = {}): Resource => ({
  id,
  kind: "note",
  title: "Synthetic " + id,
  version: 1,
  content: "PRIVATE canonical body",
  provider: "local",
  messages: [],
  ...extra,
});

test("links project only accessible metadata and retain real direction/provenance; system membership stays read-only", () => {
  const snapshot: ResourceLinksSnapshot = {
    resources: [
      resource("source"),
      resource("target"),
      resource("hidden", { available: false }),
    ],
    relationships: [
      {
        id: "edge:out",
        source_id: "source",
        target_id: "target",
        kind: "references",
        provenance: "user",
      },
      {
        id: "edge:in",
        source_id: "target",
        target_id: "source",
        kind: "depends_on",
        provenance: "inferred",
      },
      {
        id: "edge:membership",
        source_id: "source",
        target_id: "target",
        kind: "contains_task",
        provenance: "user",
      },
      {
        id: "edge:hidden",
        source_id: "source",
        target_id: "hidden",
        kind: "related_to",
        provenance: "user",
      },
    ],
  };
  const model = resourceLinks(snapshot, "source");
  assert.deepEqual(
    model.links.map((link) => [link.id, link.direction, link.removable]),
    [
      ["edge:out", "outgoing", true],
      ["edge:in", "incoming", false],
      ["edge:membership", "outgoing", false],
    ],
  );
  assert.deepEqual(
    model.candidates.map((resource) => resource.id),
    ["target"],
  );
  assert.doesNotMatch(
    JSON.stringify(model),
    /PRIVATE|edge:hidden|Synthetic hidden/,
  );
  assert.equal(
    resourceLinks(snapshot, "source", "depends").links[0].id,
    "edge:in",
  );
  assert.equal(resourceLinks(snapshot, "hidden").source, null);
  const hiddenAfter = {
    ...snapshot,
    resources: snapshot.resources.map((resource) =>
      resource.id === "target" ? { ...resource, visible: false } : resource,
    ),
    relationships: [],
  };
  assert.equal(
    confirmsResourceLinkChange(snapshot, hiddenAfter, {
      type: "unrelate",
      relationshipId: "edge:out",
    }),
    false,
    "Revocation cannot masquerade as successful removal",
  );
});

function fixture(t: any) {
  const view = blockDocument();
  t.after(view.install());
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db),
    source = kernel.createNote(
      "Synthetic source note",
      "Exact original source text",
    ),
    target = kernel.createNote(
      "Synthetic target task context",
      "Exact original target text",
    ),
    other = kernel.createNote(
      "Synthetic imported context",
      "Exact imported text",
    );
  const imported = kernel.relate(other.id, source.id, "related_to", "imported");
  const snapshot = () =>
    desktop.snapshot(() => ({ provider: "local" as const, messages: [] }));
  const actions: ResourceLinkAction[] = [],
    opened: string[] = [];
  let fail = false,
    ignore = false,
    denied = false;
  const port: ResourceLinksPort = {
    capabilities: { relate: true, unrelate: true },
    async read() {
      if (denied) throw new Error("source_unavailable");
      return snapshot();
    },
    async change(action) {
      actions.push(action);
      if (fail) throw new Error("response_lost");
      if (ignore) return snapshot();
      return graphAction(
        action,
        async (name: string, input: DesktopCommand) => {
          assert.equal(name, "desktop");
          desktop.apply(input, () => {
            throw new Error("unexpected_conversation_creation");
          });
          return snapshot();
        },
      );
    },
    openResource(id) {
      opened.push(id);
    },
  };
  t.after(() => kernel.close());
  return {
    view,
    kernel,
    source,
    target,
    other,
    imported,
    snapshot,
    port,
    actions,
    opened,
    fail() {
      fail = true;
    },
    recover() {
      fail = false;
      ignore = false;
      denied = false;
    },
    ignore() {
      ignore = true;
    },
    deny() {
      denied = true;
    },
  };
}
const submit = (form: any) => form.onsubmit({ preventDefault() {} });

test("actual graphAction/desktop/kernel creates and removes the same resource link without touching note content or IDs", async (t) => {
  const f = fixture(t),
    controller = mountResourceLinks(f.view.root, f.source.id, f.port);
  t.after(() => controller.dispose());
  await controller.ready;
  const form = f.view.root.querySelector("form"),
    selects = form.querySelectorAll("select"),
    target = selects[0],
    kind = selects[1],
    search = f.view.root.querySelector("input");
  assert.equal(f.actions.length, 0);
  assert.equal(
    f.view.root.querySelectorAll("[data-remove-link]").length,
    0,
    "Imported links are inspectable but not removable here",
  );
  target.value = f.target.id;
  target.onchange();
  kind.value = "depends_on";
  submit(form);
  await until(() => f.actions.length === 1 && !target.disabled);
  const link = f.kernel
    .listRelationships(f.source.id)
    .find((edge) => edge.target_id === f.target.id);
  assert.ok(link);
  assert.equal(link.kind, "depends_on");
  assert.equal(link.provenance, "user");
  assert.deepEqual(f.actions[0], {
    type: "relate",
    sourceId: f.source.id,
    targetId: f.target.id,
    kind: "depends_on",
  });
  assert.equal(
    f.kernel.getResource(f.source.id).note.content,
    "Exact original source text",
  );
  assert.equal(
    f.kernel.getResource(f.target.id).note.content,
    "Exact original target text",
  );
  const input = search;
  search.value = "target task";
  search.focus();
  search.setSelectionRange(2, 7);
  search.oninput();
  await controller.refresh();
  assert.equal(f.view.root.querySelector("input"), input);
  assert.deepEqual([search.selectionStart, search.selectionEnd], [2, 7]);
  const row = f.view.root
    .querySelectorAll("li")
    .find((row: any) => row.dataset.relationshipId === link.id);
  row.querySelectorAll("button")[0].onclick();
  assert.deepEqual(f.opened, [f.target.id]);
  row.querySelector("[data-remove-link]").onclick();
  await until(() => f.actions.length === 2 && !target.disabled);
  assert.equal(
    f.kernel.listRelationships(f.source.id).some((edge) => edge.id === link.id),
    false,
  );
  assert.equal(
    f.kernel
      .listRelationships(f.source.id)
      .some((edge) => edge.id === f.imported.id),
    true,
  );
  assert.equal(f.kernel.getResource(f.source.id).resource.id, f.source.id);
});

test("an unconfirmed link action is never reported saved or replayed; explicit refresh recovers after a read denial", async (t) => {
  const f = fixture(t),
    controller = mountResourceLinks(f.view.root, f.source.id, f.port);
  t.after(() => controller.dispose());
  await controller.ready;
  const form = f.view.root.querySelector("form"),
    target = form.querySelectorAll("select")[0],
    status = f.view.root.querySelector(".aw-resource-links-status");
  target.value = f.target.id;
  target.onchange();
  f.ignore();
  submit(form);
  await until(() => /not visible yet/.test(status.textContent));
  assert.equal(target.disabled, true);
  assert.doesNotMatch(status.textContent, /saved\./i);
  submit(form);
  assert.equal(f.actions.length, 1);
  f.deny();
  await controller.refresh();
  assert.equal(f.view.root.querySelectorAll("[data-remove-link]").length, 0);
  assert.equal(target.options.length, 1);
  assert.match(status.textContent, /Could not read/);
  assert.equal(f.actions.length, 1);
  f.recover();
  await controller.refresh();
  target.value = f.target.id;
  target.onchange();
  f.fail();
  submit(form);
  await until(() => /could not be confirmed/.test(status.textContent));
  submit(form);
  assert.equal(f.actions.length, 2);
  assert.equal(f.kernel.listRelationships(f.source.id).length, 1);
  assert.equal(
    f.kernel.getResource(f.source.id).note.content,
    "Exact original source text",
  );
});

test("related resources can be read-only and bound large result sets without inventing a total", async (t) => {
  const f = fixture(t),
    resources = [
      resource("source"),
      ...Array.from({ length: 125 }, (_, i) => resource("target:" + i)),
    ],
    relationships = resources
      .slice(1)
      .map((target, i) => ({
        id: "edge:" + i,
        source_id: "source",
        target_id: target.id,
        kind: "references",
        provenance: "user",
      }));
  const snapshot = { resources, relationships },
    model = resourceLinks(snapshot, "source");
  assert.equal(model.links.length, 100);
  assert.equal(model.moreLinks, true);
  assert.equal(model.candidates.length, 60);
  assert.equal(model.moreCandidates, true);
  const controller = mountResourceLinks(f.view.root, "source", {
    capabilities: { relate: false, unrelate: false },
    read: async () => snapshot,
  });
  t.after(() => controller.dispose());
  await controller.ready;
  assert.equal(f.view.root.querySelector("form").hidden, true);
  assert.equal(f.view.root.querySelectorAll("[data-remove-link]").length, 0);
});

test("opening related resources from the actual note menu preserves its recovered draft, editor and selection without saving or remounting", async (t) => {
  const view = blockDocument(),
    restore = view.install();
  let controller: ReturnType<typeof mountNoteExperience> | undefined;
  t.after(() => {
    controller?.dispose();
    restore();
  });
  view.doc.addEventListener = () => {};
  view.doc.removeEventListener = () => {};
  const canonical = resource("source"),
    draftText = "Synthetic exact recovered draft",
    writes: string[] = [],
    opened: { id: string; anchor: HTMLElement }[] = [];
  const port: NoteExperiencePort = {
    async readNote() {
      return {
        resource: canonical,
        draft: {
          version: 5,
          baseResourceVersion: 1,
          content: draftText,
          updatedAt: "2026-11-02T00:00:00Z",
        },
        draftRevision: 5,
        conflict: false,
        canRename: false,
      };
    },
    async saveNoteDraft() {
      writes.push("save");
      throw Error("unexpected_save");
    },
    async commitNote() {
      writes.push("commit");
      throw Error("unexpected_commit");
    },
    async discardNoteDraft() {
      writes.push("discard");
      throw Error("unexpected_discard");
    },
  };
  const session = new NoteSession(canonical.id, port, canonical);
  await until(() => session.snapshot().phase !== "loading");
  const label = view.doc.createElement("label"),
    editor = view.doc.createElement("textarea");
  editor.value = draftText;
  editor.focus();
  editor.setSelectionRange(3, 11);
  label.append(editor);
  view.root.append(label);
  controller = mountNoteExperience(view.root, editor, session, port, {
    kind: "note",
    openRelated(id, anchor) {
      opened.push({ id, anchor });
    },
  });
  const related = view.root
    .querySelectorAll("button")
    .find((button: any) => button.textContent === "Related resources");
  related.onclick();
  await until(() => opened.length === 1);
  assert.equal(opened[0].id, canonical.id);
  assert.equal(opened[0].anchor, related);
  assert.equal(view.root.querySelector("textarea"), editor);
  assert.equal(editor.value, draftText);
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [3, 11]);
  assert.equal(session.snapshot().content, draftText);
  assert.equal(session.snapshot().dirty, true);
  assert.deepEqual(writes, []);
});

test("a reply after the related-resource surface closes cannot remount content", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  let complete!: (snapshot: ResourceLinksSnapshot) => void;
  const controller = mountResourceLinks(view.root, "source", {
    capabilities: { relate: false, unrelate: false },
    read: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  controller.dispose();
  complete({
    resources: [resource("source"), resource("target")],
    relationships: [],
  });
  await controller.ready;
  assert.equal(view.root.children.length, 0);
});

test("compact links retain keyed rows, options, selected relationship and focused search across metadata refresh/filter changes", async t => {
  const f = fixture(t), controller = mountResourceLinks(f.view.root, f.source.id, f.port);
  t.after(() => controller.dispose());
  await controller.ready;
  const root = f.view.root, search = root.querySelector("input"),
    creation = root.querySelector(".aw-resource-links-create-toggle"),
    help = root.querySelector(".aw-resource-links-help"),
    form = root.querySelector("form"), [target, kind] = form.querySelectorAll("select"),
    row = root.querySelector("[data-relationship-id]"), title = row.querySelector("button");
  assert.equal(root.querySelector("h3").textContent, f.source.title);
  assert.equal(creation.open, false);
  assert.equal(help.open, false);
  assert.match(help.textContent, /without copying content or changing permissions/);
  assert.equal(form.parentElement, creation);
  const selectedOption = target.options.find((option: any) => option.value === f.target.id);
  target.value = f.target.id;
  target.onchange();
  kind.value = "depends_on";
  title.focus();
  await controller.refresh();
  assert.equal(root.querySelector("[data-relationship-id]"), row);
  assert.equal(row.querySelector("button"), title);
  assert.equal(f.view.doc.activeElement, title);
  assert.equal(target.options.find((option: any) => option.value === f.target.id), selectedOption);
  search.value = "imported";
  search.focus();
  search.setSelectionRange(2, 5);
  search.oninput();
  await controller.refresh();
  assert.equal(root.querySelector("input"), search);
  assert.equal(f.view.doc.activeElement, search);
  assert.deepEqual([search.selectionStart, search.selectionEnd], [2, 5]);
  assert.equal(root.querySelector("[data-relationship-id]"), row);
  assert.equal(target.value, f.target.id, "A selected authorized target survives another search");
  assert.equal(kind.value, "depends_on");
  assert.equal(f.actions.length, 0);
});

test("only confirmed creation quiets success and returns its own submit focus to the collapsed Add link disclosure", async t => {
  const f = fixture(t), controller = mountResourceLinks(f.view.root, f.source.id, f.port);
  t.after(() => controller.dispose());
  await controller.ready;
  const root = f.view.root, creation = root.querySelector(".aw-resource-links-create-toggle"),
    form = root.querySelector("form"), [target, kind] = form.querySelectorAll("select"),
    add = form.querySelector("button"), status = root.querySelector(".aw-resource-links-status");
  creation.open = true;
  target.value = f.target.id;
  kind.value = "references";
  target.onchange();
  add.focus();
  submit(form);
  await until(() => status.dataset.state === "success");
  assert.equal(status.textContent, "Link change saved.", "The live success announcement remains available");
  assert.equal(creation.open, false);
  assert.equal(f.view.doc.activeElement, creation.querySelector("summary"));
  assert.equal(target.value, f.target.id);
  assert.equal(kind.value, "references");
  creation.open = true;
  kind.value = "depends_on";
  f.ignore();
  add.focus();
  submit(form);
  await until(() => status.dataset.state === "uncertain");
  assert.equal(creation.open, true);
  assert.equal(f.view.doc.activeElement, add);
  assert.match(status.textContent, /not visible yet/);
  assert.equal(target.disabled, true);
  submit(form);
  assert.equal(f.actions.length, 2, "Uncertain changes cannot be replayed");
});

test("a delayed confirmed reply cannot collapse creation or move focus during another edit or search composition", async t => {
  const f = fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = mountResourceLinks(f.view.root, f.source.id, {
    ...f.port,
    async change(action) { await gate; return f.port.change!(action); },
  });
  t.after(() => controller.dispose());
  await controller.ready;
  const root = f.view.root, search = root.querySelector("input"),
    creation = root.querySelector(".aw-resource-links-create-toggle"), form = root.querySelector("form"),
    [target, kind] = form.querySelectorAll("select"), add = form.querySelector("button"),
    imported = root.querySelector("[data-relationship-id]"), status = root.querySelector(".aw-resource-links-status");
  creation.open = true;
  target.value = f.target.id;
  kind.value = "references";
  target.onchange();
  add.focus();
  submit(form);
  assert.equal(status.dataset.state, "progress");
  assert.equal(add.disabled, false, "Pending submit keeps its native focus target");
  assert.equal(add.getAttribute("aria-disabled"), "true");
  submit(form);
  assert.equal(status.dataset.state, "progress");
  search.focus();
  search.fire("compositionstart");
  search.value = "target task";
  search.setSelectionRange(2, 6);
  search.oninput();
  assert.equal(root.querySelector("[data-relationship-id]"), imported, "Incomplete composition does not refilter rows");
  release();
  await until(() => status.dataset.state === "success");
  assert.equal(add.getAttribute("aria-disabled"), "false");
  assert.equal(f.actions.length, 1, "Pending native/keyboard repeat submission is not replayed");
  assert.equal(creation.open, true);
  assert.equal(f.view.doc.activeElement, search);
  assert.equal(root.querySelector("input"), search);
  assert.equal(search.value, "target task");
  assert.deepEqual([search.selectionStart, search.selectionEnd], [2, 6]);
  assert.equal(target.value, f.target.id);
  assert.equal(kind.value, "references");
  assert.equal(root.querySelectorAll("[data-relationship-id]").includes(imported), true);
  search.fire("compositionend");
  assert.equal(root.querySelectorAll("[data-relationship-id]").includes(imported), false);
  assert.equal(root.querySelectorAll("[data-remove-link]").length, 1);
  assert.equal(f.view.doc.activeElement, search);
  assert.deepEqual([search.selectionStart, search.selectionEnd], [2, 6]);
});

test("revoked metadata is removed during composition while the search node and uncommitted text remain intact", async t => {
  const f = fixture(t);
  let hidden = false;
  const controller = mountResourceLinks(f.view.root, f.source.id, {
    ...f.port,
    async read() {
      const snapshot = await f.port.read();
      return hidden ? { ...snapshot, resources: snapshot.resources.map(resource => ({ ...resource, visible: false })) } : snapshot;
    },
  });
  t.after(() => controller.dispose());
  await controller.ready;
  const root = f.view.root, search = root.querySelector("input");
  search.focus();
  search.fire("compositionstart");
  search.value = "uncommitted input";
  search.setSelectionRange(3, 8);
  search.oninput();
  hidden = true;
  await controller.refresh();
  assert.equal(root.querySelectorAll("[data-relationship-id]").length, 0);
  assert.equal(root.querySelector("form").querySelector("select").options.length, 1);
  assert.equal(root.querySelector("input"), search);
  assert.equal(search.value, "uncommitted input");
  assert.deepEqual([search.selectionStart, search.selectionEnd], [3, 8]);
  assert.equal(f.view.doc.activeElement, search);
  assert.match(root.querySelector(".aw-resource-links-status").textContent, /unavailable/);
});
