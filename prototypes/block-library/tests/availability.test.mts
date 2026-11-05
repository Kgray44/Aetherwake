import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { createCanonicalTemplateHost } from "../canonical-host.mts";
import { TemplateService } from "../service.mts";
import { NoteExperienceService } from "../note-service.mts";
import { REGISTERED_BLOCKS, BUILTIN_BLOCKS } from "../registry.ts";
import {
  unavailableBlock,
  showUnavailableBlock,
} from "../availability-view.ts";
import type { BlockKind, LibraryCapabilities } from "../contracts.ts";

// DOM state boundary only: no browser layout/native input claim.
class Element {
  [key: string]: any;
  children: Element[] = [];
  parentElement: Element | null = null;
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  inert = false;
  hidden = false;
  disabled = false;
  tagName: string;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  append(...children: Element[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  insertBefore(child: Element, before: Element | null) {
    child.remove();
    child.parentElement = this;
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
    this.parentElement = null;
  }
  setAttribute() {}
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (
        selector.startsWith(".")
          ? child.className.split(" ").includes(selector.slice(1))
          : child.tagName === selector.toUpperCase()
      )
        return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}
function card(t: any) {
  const globals = globalThis as any,
    prior = globals.document;
  globals.document = { createElement: (tag: string) => new Element(tag) };
  t.after(() => {
    if (prior === undefined) delete globals.document;
    else globals.document = prior;
  });
  const article = new Element("article"),
    inner = new Element("div"),
    content = new Element("div"),
    editor = new Element("textarea"),
    preview = new Element("div"),
    subtitle = new Element("div"),
    actions = new Element("div");
  inner.className = "folio-inner";
  content.className = "working-content";
  preview.className = "folio-preview";
  subtitle.className = "folio-subtitle";
  actions.className = "folio-actions";
  editor.value = "Synthetic unsaved recovery text";
  editor.selectionStart = 4;
  editor.selectionEnd = 12;
  content.append(editor);
  inner.append(subtitle, preview, content, actions);
  article.append(inner);
  return {
    article: article as unknown as HTMLElement,
    root: article,
    content,
    editor,
  };
}
function fixture(t: any) {
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db),
    engine = desktop.nativeBlockServices().engine;
  t.after(() => kernel.close());
  const snapshot = () =>
    desktop.snapshot(() => ({ provider: "local", messages: [] }));
  const noConversation = () => {
    throw Error("unexpected_conversation_creation");
  };
  desktop.apply(
    {
      type: "createWorkspace",
      title: "Synthetic unavailable view",
      projectId: null,
    },
    noConversation,
  );
  desktop.apply(
    {
      type: "createResource",
      kind: "note",
      title: "Synthetic retained note",
      workspaceId: snapshot().activeWorkspaceId,
    },
    noConversation,
  );
  const resource = snapshot().resources[0],
    block = snapshot().blocks[0];
  desktop.apply(
    {
      type: "content",
      resourceId: resource.id,
      expectedVersion: resource.version,
      content: "Synthetic canonical text",
    },
    noConversation,
  );
  const caps: LibraryCapabilities = {
    revision: 1,
    kinds: Object.fromEntries(
      BUILTIN_BLOCKS.map((definition) => [
        definition.kind,
        { state: "available" },
      ]),
    ),
    providers: {},
    velaPlanning: { state: "unsupported" },
  };
  const host = createCanonicalTemplateHost({
    db,
    kernel,
    engine,
    atomic: (operation) => kernel.withTransaction(operation),
    capabilities: () => caps,
    createResource: noConversation,
    resourceKind: (id) =>
      String(
        db
          .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
          .get(id)!.kind,
      ) as BlockKind,
    isAuthorized: () => true,
    navigateWorkspace() {},
    setTaskGroupMembers() {},
  });
  const library = new TemplateService(db, host),
    notes = new NoteExperienceService(db, {
      db,
      atomic: (operation) => kernel.withTransaction(operation),
      readResource: (id) => {
        const resource = snapshot().resources.find(
          (resource) => resource.id === id,
        );
        return resource ? { resource, authorized: true } : null;
      },
      updateNote() {
        throw Error("unexpected_canonical_edit");
      },
    });
  return {
    kernel,
    db,
    desktop,
    engine,
    snapshot,
    resource: snapshot().resources[0],
    block,
    library,
    notes,
  };
}

test("an unknown persisted desktop kind gets a recoverable view while canonical content, geometry and durable draft remain intact", (t) => {
  const f = fixture(t),
    ui = card(t);
  f.notes.saveNoteDraft({
    resourceId: f.resource.id,
    expectedDraftVersion: 0,
    baseResourceVersion: f.resource.version,
    content: ui.editor.value,
  });
  const before = f.kernel.getResource(f.resource.id),
    geometry = f.engine.project(f.block.workspace_id);
  f.db
    .prepare("UPDATE desktop_resources SET kind=? WHERE resource_id=?")
    .run("future_extension", f.resource.id);
  const resource = f.snapshot().resources[0];
  assert.equal(String(resource.kind), "future_extension");
  assert.equal(resource.available, true);
  assert.throws(
    () => f.notes.readNote(resource.id),
    /note_kind_required/,
    "the generic note service cannot edit this saved kind",
  );
  const reason = unavailableBlock({ kind: resource.kind });
  assert.equal(reason?.code, "missing-type");
  assert.equal(
    showUnavailableBlock(ui.article, reason, {
      kind: resource.kind,
      referenceId: resource.id,
      preview: resource.content,
      subtitle: resource.title,
    }),
    true,
  );
  assert.equal(ui.content.inert, true);
  assert.equal(ui.article.dataset.blockAvailability, "unavailable");
  assert.equal(ui.editor.value, "Synthetic unsaved recovery text");
  assert.equal(ui.editor.selectionStart, 4);
  assert.equal(ui.editor.selectionEnd, 12);
  assert.equal(
    ui.root.querySelector("button")!.hidden,
    true,
    "unknown types do not offer a fake migration",
  );
  assert.deepEqual(f.kernel.getResource(resource.id), before);
  assert.deepEqual(f.engine.project(f.block.workspace_id), geometry);
  assert.equal(
    f.db
      .prepare("SELECT content FROM block_note_drafts WHERE resource_id=?")
      .get(resource.id)!.content,
    ui.editor.value,
  );
  f.db
    .prepare("UPDATE desktop_resources SET kind='note' WHERE resource_id=?")
    .run(resource.id);
  assert.equal(f.notes.readNote(resource.id).draft!.content, ui.editor.value);
});

test("unsupported saved manifest metadata suspends only presentation and explicit retry never repairs or overwrites it", (t) => {
  const f = fixture(t),
    ui = card(t);
  f.library.configureBlock({
    placementId: f.block.id,
    expectedVersion: 0,
    configuration: { schemaVersion: 1, textScale: 1.5, contentMode: "reading" },
  });
  f.db
    .prepare(
      "UPDATE block_library_instances SET manifest_version=2 WHERE placement_id=?",
    )
    .run(f.block.id);
  let failure: unknown;
  try {
    f.library.getBlockSettings(f.block.id);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  const reason = unavailableBlock({ kind: "note", settingsError: failure });
  assert.equal(reason?.code, "unsupported-version");
  const metadata = f.db
    .prepare("SELECT * FROM block_library_instances WHERE placement_id=?")
    .get(f.block.id);
  let reads = 0;
  const options = {
    kind: "note",
    referenceId: f.resource.id,
    preview: "Synthetic current preview",
    subtitle: "Synthetic current subtitle",
    retry() {
      reads++;
      assert.throws(
        () => f.library.getBlockSettings(f.block.id),
        /unsupported_block_manifest_version/,
      );
    },
  };
  showUnavailableBlock(ui.article, reason, options);
  const notice = ui.root.querySelector(".aw-block-unavailable"),
    editor = ui.root.querySelector("textarea");
  assert.ok(notice);
  assert.equal(editor, ui.editor);
  assert.equal(ui.content.inert, true);
  ui.root.querySelector("button")!.onclick();
  assert.equal(reads, 1);
  assert.deepEqual(
    f.db
      .prepare("SELECT * FROM block_library_instances WHERE placement_id=?")
      .get(f.block.id),
    metadata,
  );
  assert.equal(
    showUnavailableBlock(ui.article, reason, options),
    false,
    "repeated failures reuse the same notice",
  );
  assert.equal(ui.root.querySelector(".aw-block-unavailable"), notice);
  // A compatible host may later read the retained version. Presentation recovery
  // itself keeps the same editor node, local text and selection and writes no data.
  showUnavailableBlock(ui.article, null, options);
  assert.equal(ui.content.inert, false);
  assert.equal(ui.root.querySelector("textarea"), editor);
  assert.equal(ui.editor.value, "Synthetic unsaved recovery text");
  assert.equal(ui.editor.selectionEnd, 12);
  assert.equal(
    ui.root.querySelector(".folio-preview")!.textContent,
    options.preview,
  );
  assert.equal(ui.article.dataset.blockAvailability, undefined);
  assert.deepEqual(
    f.db
      .prepare("SELECT * FROM block_library_instances WHERE placement_id=?")
      .get(f.block.id),
    metadata,
  );
});

test("known definitions, transient service failures, missing references and changed bindings remain distinct", () => {
  for (const definition of REGISTERED_BLOCKS)
    assert.equal(unavailableBlock({ kind: definition.kind }), null);
  assert.equal(
    unavailableBlock({
      kind: "note",
      settingsError: Error("backend_disconnected"),
    }),
    null,
  );
  assert.equal(
    unavailableBlock({ kind: "note", missingResource: true })?.code,
    "missing-resource",
  );
  assert.equal(
    unavailableBlock({
      kind: "note",
      settingsError: { code: "block_binding_changed" },
    })?.code,
    "binding-changed",
  );
});
