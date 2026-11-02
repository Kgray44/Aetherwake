import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { createCanonicalTemplateHost } from "../canonical-host.mts";
import { TemplateService } from "../service.mts";
import { mountBlockLibrary } from "../view.ts";
import { BUILTIN_BLOCKS } from "../registry.ts";
import type {
  BlockLibraryHostPort,
  LibraryCapabilities,
} from "../contracts.ts";

// CPU-only DOM boundary for the actual component. No layout, native input or
// browser validation claim; the tests submit valid synthetic form values.
class Element {
  [key: string]: any;
  children: Element[] = [];
  parentElement: Element | null = null;
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  className = "";
  value = "";
  disabled = false;
  hidden = false;
  text = "";
  tagName: string;
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.replaceChildren();
  }
  get isConnected(): boolean {
    return this === documentRoot || !!this.parentElement?.isConnected;
  }
  append(...nodes: Element[]) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: Element[]) {
    for (const node of [...nodes].reverse()) {
      node.remove();
      node.parentElement = this;
      this.children.unshift(node);
    }
  }
  replaceChildren(...nodes: Element[]) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this,
      );
    this.parentElement = null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  reportValidity() {
    return true;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const tag = part.trim().match(/^[a-z]+/i)?.[0],
        cls = part.match(/\.([\w-]+)/)?.[1],
        attr = part.match(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/);
      const value = attr
        ? attr[1].startsWith("data-")
          ? this.dataset[
              attr[1]
                .slice(5)
                .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
            ]
          : (this.attrs.get(attr[1]) ?? this[attr[1]])
        : undefined;
      return (
        (!tag || this.tagName === tag.toUpperCase()) &&
        (!cls || this.className.split(" ").includes(cls)) &&
        (!attr ||
          (value !== undefined &&
            (attr[2] === undefined || String(value) === attr[2])))
      );
    });
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
let documentRoot: Element;
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(check(), "actual component operation settles");
}
function fixture(t: any, withProject = false, legacyScopes = false) {
  const globals = globalThis as any,
    previous = { document: globals.document, HTMLElement: globals.HTMLElement };
  documentRoot = new Element("main");
  globals.document = {
    activeElement: null,
    createElement: (tag: string) => new Element(tag),
  };
  globals.HTMLElement = Element;
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db),
    engine = desktop.nativeBlockServices().engine;
  const caps: LibraryCapabilities = {
    revision: 1,
    kinds: Object.fromEntries(
      BUILTIN_BLOCKS.map((definition) => [
        definition.kind,
        { state: "available" },
      ]),
    ),
    providers: { local: { state: "available" } },
    velaPlanning: { state: "unsupported" },
  };
  const host = createCanonicalTemplateHost({
    db,
    kernel,
    engine,
    atomic: (operation) => kernel.withTransaction(operation),
    capabilities: () => caps,
    createResource(kind, title, _provider, projectId) {
      assert.equal(
        kind,
        "note",
        "this fixture exercises actual canonical notes only",
      );
      const resource = kernel.createNote(title, "", projectId);
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(resource.id, kind);
      return resource.id;
    },
    resourceKind: () => "note",
    authorizeSubject: () => true,
    isAuthorized: () => true,
    navigateWorkspace() {},
    setTaskGroupMembers() {},
  });
  const service = new TemplateService(db, host),
    project = withProject
      ? kernel.createProject("Synthetic picker project")
      : null,
    workspace = engine.createWorkspace(
      "Synthetic component recovery",
      project?.id ?? null,
    );
  let revision = workspace.revision,
    preferenceReads = 0,
    failPreferences = false;
  const results: any[] = [];
  let scopeTargetReads = 0;
  const port: BlockLibraryHostPort = {
    capabilities: async () => {
      const value = service.capabilities();
      if (legacyScopes) delete value.discoveryFilters;
      return value;
    },
    createBlock: async (input) => service.createBlock(input),
    configureBlock: async (input) => service.configureBlock(input),
    findResources: async (input) => service.findResources(input),
    attachBlock: async (input) => service.attachBlock(input),
    subjectTargets: async (workspaceId) => {
      scopeTargetReads++;
      return service.subjectTargets(workspaceId);
    },
    preferences: async () => {
      preferenceReads++;
      if (failPreferences && preferenceReads > 1)
        throw Error("synthetic_preference_read_failure");
      return service.preferences();
    },
  };
  let controller: ReturnType<typeof mountBlockLibrary>;
  t.after(() => {
    controller?.dispose();
    kernel.close();
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete globals[key];
      else globals[key] = value;
  });
  return {
    kernel,
    db,
    engine,
    service,
    workspace,
    project,
    get scopeTargetReads() {
      return scopeTargetReads;
    },
    root: documentRoot,
    results,
    setRevision: (value: number) => {
      revision = value;
    },
    failPreferences: () => {
      failPreferences = true;
    },
    mount() {
      controller = mountBlockLibrary(documentRoot as any, port, {
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: () => revision,
        onCreated: (result) => {
          results.push(result);
        },
        onClose() {},
      });
      return controller;
    },
  };
}
function field(root: Element, name: string) {
  const label = root
    .querySelectorAll("label")
    .find((label) => label.text === name);
  assert.ok(label, "actual labeled field exists: " + name);
  return label.children[0];
}
async function configureNote(root: Element) {
  await until(() => !!root.querySelector("form"));
  root
    .querySelectorAll("button")
    .find((button) => button.dataset.blockKind === "note")!
    .onclick();
  const form = root.querySelector("form")!;
  field(form, "Title").value = "Synthetic recovery title";
  field(form, "Width").value = "486";
  field(form, "Height").value = "330";
  field(form, "Text scale").value = "1.5";
  field(form, "Content presentation").value = "reading";
  return form;
}
async function submit(root: Element, form: Element) {
  form.onsubmit({ preventDefault() {} });
  await until(
    () => !root.querySelector(".aw-library")!.hasAttribute("aria-busy"),
  );
}

test("Library preserves title and presentation when the real canonical layout fence rejects Add", async (t) => {
  const f = fixture(t);
  f.mount();
  const form = await configureNote(f.root),
    title = field(form, "Title");
  f.service.createBlock({
    commandId: "synthetic-concurrent-create",
    workspaceId: f.workspace.workspaceId,
    expectedLayoutVersion: f.workspace.revision,
    kind: "note",
    title: "Synthetic concurrent note",
  });
  await submit(f.root, form);
  assert.match(
    f.root.querySelector(".aw-library__status")!.textContent,
    /layout version conflict/,
  );
  assert.ok(
    f.root.querySelector("form") === form,
    "failure retains the actual form and focused input nodes",
  );
  assert.equal(field(form, "Title"), title);
  assert.equal(title.value, "Synthetic recovery title");
  assert.equal(field(form, "Width").value, "486");
  assert.equal(field(form, "Height").value, "330");
  assert.equal(field(form, "Text scale").value, "1.5");
  assert.equal(field(form, "Content presentation").value, "reading");
  assert.equal(form.querySelector('button[type="submit"]')!.disabled, false);
  assert.equal(f.engine.project(f.workspace.workspaceId).blocks.length, 1);
  f.setRevision(f.engine.project(f.workspace.workspaceId).revision);
  await submit(f.root, form);
  assert.equal(f.results.length, 1);
  const result = f.results[0],
    block = f.engine
      .project(f.workspace.workspaceId)
      .blocks.find((block) => block.blockId === result.placementId)!;
  assert.equal(
    f.kernel.getResource(result.resourceId).resource.title,
    "Synthetic recovery title",
  );
  assert.equal(block.width, 486);
  assert.equal(block.height, 330);
  assert.deepEqual(
    f.service.getBlockSettings(result.placementId).configuration,
    { schemaVersion: 1, textScale: 1.5, contentMode: "reading" },
  );
});

test("Library does not describe a committed block as failed when the later recent-items read fails", async (t) => {
  const f = fixture(t);
  f.failPreferences();
  f.mount();
  const form = await configureNote(f.root);
  await submit(f.root, form);
  assert.equal(f.results.length, 1);
  assert.equal(f.engine.project(f.workspace.workspaceId).blocks.length, 1);
  assert.match(
    f.root.querySelector(".aw-library__status")!.textContent,
    /Block saved.*recent/i,
  );
});

test("Library scope filters use actual project and collection discovery while retaining form nodes and canonical attachment", async (t) => {
  const f = fixture(t, true),
    local = f.kernel.createNote(
      "Synthetic project note",
      "Original project content",
      f.project!.id,
    ),
    unassigned = f.kernel.createNote(
      "Synthetic global note",
      "Original shared content",
    ),
    other = f.kernel.createProject("Synthetic other project"),
    foreign = f.kernel.createNote(
      "Synthetic foreign note",
      "Private foreign content",
      other.id,
    ),
    collection = f.kernel.createCollection(
      "Synthetic actual collection",
      other.id,
    );
  f.kernel.addToCollection(collection.id, unassigned.id);
  f.kernel.addToCollection(collection.id, foreign.id);
  f.mount();
  const form = await configureNote(f.root),
    title = field(form, "Title");
  const attach = f.root
    .querySelectorAll("details")
    .find(
      (details) => details.querySelector("summary")?.text === "Attach Existing",
    )!;
  attach.open = true;
  attach.ontoggle();
  const resourceIds = () =>
    attach
      .querySelectorAll("button")
      .filter((button) => button.dataset.attachResource)
      .map((button) => button.dataset.attachResource);
  await until(() => resourceIds().length === 2);
  assert.deepEqual(new Set(resourceIds()), new Set([local.id, unassigned.id]));
  const scopes = attach.querySelector(".aw-library__scope-filters")!;
  scopes.open = true;
  scopes.ontoggle();
  const project = field(scopes, "Project"),
    collectionSelect = field(scopes, "Collection");
  await until(() => !collectionSelect.disabled);
  assert.ok(
    collectionSelect.children.some(
      (option) =>
        option.value === collection.id && option.text === collection.title,
    ),
  );
  project.value = "workspace-project";
  project.onchange();
  await until(() => resourceIds().length === 1);
  assert.deepEqual(resourceIds(), [local.id]);
  project.value = "unassigned";
  project.onchange();
  await until(() => resourceIds().length === 1);
  assert.deepEqual(resourceIds(), [unassigned.id]);
  collectionSelect.value = collection.id;
  collectionSelect.onchange();
  await until(() => resourceIds().length === 1);
  assert.deepEqual(
    resourceIds(),
    [unassigned.id],
    "Collection membership cannot expand target project scope",
  );
  assert.equal(f.root.querySelector("form"), form);
  assert.equal(field(form, "Title"), title);
  assert.equal(title.value, "Synthetic recovery title");
  assert.equal(field(form, "Text scale").value, "1.5");
  attach
    .querySelectorAll("button")
    .find((button) => button.dataset.attachResource === unassigned.id)!
    .onclick();
  await until(() => f.results.length === 1);
  assert.equal(f.results[0].resourceId, unassigned.id);
  assert.equal(
    f.kernel.getResource(unassigned.id).note.content,
    "Original shared content",
  );
  assert.equal(
    f.kernel.getResource(foreign.id).note.content,
    "Private foreign content",
  );
  assert.equal(
    f.engine.project(f.workspace.workspaceId).blocks[0].resourceId,
    unassigned.id,
  );
});

test("Library clears stale attachment actions when its selected collection becomes unavailable", async (t) => {
  const f = fixture(t),
    note = f.kernel.createNote(
      "Synthetic retained note",
      "Retained after denial",
    ),
    collection = f.kernel.createCollection("Synthetic disappearing scope");
  f.kernel.addToCollection(collection.id, note.id);
  f.mount();
  const form = await configureNote(f.root);
  const attach = f.root
    .querySelectorAll("details")
    .find(
      (details) => details.querySelector("summary")?.text === "Attach Existing",
    )!;
  attach.open = true;
  attach.ontoggle();
  const scopes = attach.querySelector(".aw-library__scope-filters")!;
  scopes.open = true;
  scopes.ontoggle();
  const collectionSelect = field(scopes, "Collection");
  await until(() => !collectionSelect.disabled);
  collectionSelect.value = collection.id;
  collectionSelect.onchange();
  await until(() =>
    attach
      .querySelectorAll("button")
      .some((button) => button.dataset.attachResource === note.id),
  );
  f.kernel.setCollectionArchived(collection.id, true, 1);
  attach.querySelector("input")!.oninput();
  await until(() => attach.textContent.includes("subject unavailable"));
  assert.equal(
    attach
      .querySelectorAll("button")
      .some((button) => button.dataset.attachResource),
    false,
  );
  assert.equal(f.root.querySelector("form"), form);
  assert.equal(f.results.length, 0);
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Retained after denial",
  );
});

test("older hosts retain compatible attachment without inferring unadvertised scope filtering", async (t) => {
  const f = fixture(t, false, true),
    note = f.kernel.createNote(
      "Synthetic legacy compatible note",
      "Retained legacy content",
    );
  f.mount();
  await configureNote(f.root);
  const attach = f.root
    .querySelectorAll("details")
    .find(
      (details) => details.querySelector("summary")?.text === "Attach Existing",
    )!;
  attach.open = true;
  attach.ontoggle();
  await until(() =>
    attach
      .querySelectorAll("button")
      .some((button) => button.dataset.attachResource === note.id),
  );
  const scopes = attach.querySelector(".aw-library__scope-filters")!;
  scopes.open = true;
  scopes.ontoggle();
  assert.equal(field(scopes, "Project").disabled, true);
  assert.equal(field(scopes, "Collection").disabled, true);
  assert.match(scopes.textContent, /filtering is unavailable/);
  assert.equal(
    f.scopeTargetReads,
    0,
    "Method existence alone does not imply filtering capability",
  );
  assert.equal(f.engine.project(f.workspace.workspaceId).blocks.length, 0);
});
