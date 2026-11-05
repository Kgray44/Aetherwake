import test from "node:test";
import assert from "node:assert/strict";
import { blockIdentity, type SubjectIdentity } from "../identity-model.ts";
import { mountBlockIdentity } from "../identity-view.ts";
import { showUnavailableBlock } from "../availability-view.ts";
import { blockDocument, card } from "./component-dom.mts";
import { until } from "../../conversation-product/test/component-dom.mts";
import type { Resource } from "../../application-contract/contracts.ts";
import type {
  BrowseResourcesPage,
  ProjectOverview,
  BlockInstanceKind,
} from "../contracts.ts";

const resource = (
  kind: Resource["kind"],
  extra: Partial<Resource> = {},
): Resource => ({
  id: "resource:" + kind,
  title: "Synthetic " + kind,
  kind,
  version: 1,
  content: "# Actual heading\nActual authored text",
  provider: "local",
  messages: [],
  ...extra,
});
export const page: BrowseResourcesPage = {
  scopeTitle: "Synthetic canonical scope",
  nextCursor: "resource:more",
  resources: [
    {
      id: "resource:real",
      title: "A real canonical row",
      kind: "note",
      version: 4,
      projectId: null,
      placementCount: 0,
      placementCountComplete: false,
    },
  ],
};
export const overview: ProjectOverview = {
  project: { id: "project:actual", title: "Actual project title", version: 3 },
  workspaces: [
    { id: "workspace:actual", title: "Actual workspace", version: 2 },
  ],
  workspaceListComplete: false,
  resourcesByKind: { note: 4, task: 2 },
  tasks: { open: 1, done: 1 },
  resourceCountsComplete: false,
  recentEvents: [],
};

test("all registered kinds project a distinct useful structure; Codex has observed execution identity", () => {
  const kinds: BlockInstanceKind[] = [
    "conversation",
    "note",
    "task",
    "task_group",
    'checklist',
    'agent',
    'timeline',
    'task_objective',
    "stream",
    "project_overview",
    "resource_browser",
    "collection_browser",
    "research",
    "reference",
  ];
  const models = kinds.map((kind) =>
    blockIdentity({
      kind,
      ...([
        "project_overview",
        "resource_browser",
        "collection_browser",
      ].includes(kind)
        ? {}
        : { resource: resource(kind as Resource["kind"]) }),
    }),
  );
  assert.equal(new Set(models.map((model) => model.layout)).size, 14);
  assert.equal(new Set(models.map((model) => model.label)).size, 13);
  assert.equal(models.find(model => model.kind === 'resource_browser')!.label, 'Resource Explorer');
  assert.equal(models.find(model => model.kind === 'collection_browser')!.label, 'Resource Explorer');
  assert.equal(models[0].rows.length, 0, "No invented assistant response");
  assert.equal(models.find(model => model.kind === 'stream')!.rows.length, 0, "No invented activity");
  assert.equal(models.find(model => model.kind === 'project_overview')!.phase, "loading");
  assert.deepEqual(models.find(model => model.kind === 'project_overview')!.metrics, [], "Loading is not a zero count");
  const codex = blockIdentity({
    kind: "conversation",
    resource: resource("conversation", {
      provider: "codex",
      execution: {
        id: "execution:actual",
        state: "running",
        taskVerified: false,
      },
    }),
  });
  assert.equal(codex.layout, "execution");
  assert.equal(codex.label, "Codex");
  assert.deepEqual(codex.metrics, [{ label: "Turn", value: "running" }]);
  assert.doesNotMatch(
    JSON.stringify(codex),
    /verified complete|tokens|task progress/i,
  );
});

test("scoped identities preserve real IDs, bounded counts, authored sources and unavailable state", () => {
  const project = blockIdentity({
    kind: "project_overview",
    subject: { phase: "ready", kind: "project", overview },
  });
  assert.deepEqual(
    project.metrics.map((metric) => metric.value),
    ["1+", "6+", "1+"],
  );
  assert.equal(project.rows[0].id, "workspace:actual");
  const unavailableProject = blockIdentity({
    kind: "project_overview",
    subject: {
      phase: "unavailable",
      message: "Project archived. Layout retained.",
    },
  });
  assert.equal(unavailableProject.phase, "unavailable");
  assert.deepEqual(unavailableProject.rows, []);
  assert.deepEqual(unavailableProject.metrics, []);
  assert.doesNotMatch(
    JSON.stringify(unavailableProject),
    /workspace:actual|Actual project title/,
  );
  const browser = blockIdentity({
    kind: "collection_browser",
    subject: { phase: "ready", kind: "browser", page, query: "actual" },
  });
  assert.equal(browser.heading, page.scopeTitle);
  assert.equal(browser.rows[0].id, "resource:real");
  assert.doesNotMatch(browser.rows[0].detail, /Unplaced/);
  const reference = blockIdentity({
    kind: "reference",
    resource: resource("reference", {
      content: "Authored source https://example.test/a?x=1 and javascript:bad",
    }),
  });
  assert.deepEqual(reference.links, [
    { url: "https://example.test/a?x=1", domain: "example.test" },
  ]);
  assert.match(reference.subtitle, /not retrieved/);
  const denied = blockIdentity({
    kind: "reference",
    resource: resource("reference", {
      available: false,
      content: "PRIVATE retained data https://private.test",
      messages: [{ id: "hidden", role: "user", content: "hidden" }],
    }),
  });
  assert.equal(denied.phase, "unavailable");
  assert.equal(denied.layout, "reference");
  assert.deepEqual(denied.links, []);
  assert.doesNotMatch(JSON.stringify(denied), /PRIVATE|private.test|hidden/);
  const stream = blockIdentity({
    kind: "stream",
    disconnected: true,
    events: [
      {
        id: "event:actual",
        type: "task.updated",
        source: "application",
        classification: "observed",
        receivedAt: "2026-11-02T01:02:03Z",
      },
    ],
  });
  assert.equal(stream.rows[0].time, "2026-11-02T01:02:03Z");
  assert.match(stream.subtitle, /Disconnected/);
  const task = blockIdentity({ kind: "task", resource: resource("task") });
  assert.equal(
    task.rows[0].checked,
    undefined,
    "Missing status is not invented as open or done",
  );
});

test("resource search retains its input/caret; refreshed rows use real canonical actions and identities", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const f = card(view),
    opened: string[] = [],
    attached: string[] = [],
    queries: string[] = [];
  const identity = mountBlockIdentity(f.article, {
    openResource: (id) => opened.push(id),
    attachResource: async (id) => {
      attached.push(id);
    },
    search: (query) => queries.push(query),
  });
  t.after(() => identity.dispose());
  const model = blockIdentity({
    kind: "resource_browser",
    subject: { phase: "ready", kind: "browser", page, query: "" },
  });
  identity.update(model);
  const input = identity.search as any,
    row = view.root.querySelector(".aw-identity-row"),
    open = view.root.querySelector(".aw-identity-open");
  input.value = "A new search";
  input.focus();
  input.setSelectionRange(2, 7);
  input.oninput();
  identity.update({
    ...model,
    query: "Older response",
    rows: [{ ...model.rows[0], title: "Renamed canonical row" }],
  });
  assert.equal(identity.search, input);
  assert.equal(input.value, "A new search");
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]);
  assert.equal(view.root.querySelector(".aw-identity-row"), row);
  assert.match(row.textContent, /Renamed canonical row/);
  open.onclick();
  view.root.querySelector(".aw-identity-attach").onclick();
  await until(() => attached.length === 1);
  assert.deepEqual(opened, ["resource:real"]);
  assert.deepEqual(attached, ["resource:real"]);
  assert.deepEqual(queries, ["A new search"]);
  assert.equal(
    f.actions.parentElement,
    f.top,
    "Existing Open is moved, not replaced or duplicated",
  );
  assert.equal(
    f.article.querySelector(".anchor-label small")!.textContent,
    "Resource Explorer",
  );
  assert.equal(
    f.article.querySelector(".resource-anchor")!.getAttribute("aria-label"),
    "Open Resource Explorer · Synthetic title",
  );
});

test("failed direct checkbox change preserves canonical status and the same checkbox node", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const f = card(view),
    attempts: [string, boolean][] = [];
  const identity = mountBlockIdentity(f.article, {
    async toggleTask(id, done) {
      attempts.push([id, done]);
      throw new Error("version_conflict");
    },
  });
  t.after(() => identity.dispose());
  identity.update(
    blockIdentity({
      kind: "task",
      resource: resource("task", { taskStatus: "open" }),
    }),
  );
  const check = view.root.querySelector(".aw-identity-check");
  check.focus();
  check.checked = true;
  check.onchange();
  await until(() => attempts.length === 1 && !check.disabled);
  assert.deepEqual(attempts, [["resource:task", true]]);
  assert.equal(check.checked, false);
  assert.equal(view.root.querySelector(".aw-identity-check"), check);
  assert.equal(view.doc.activeElement, check);
  assert.match(
    view.root.querySelector(".aw-identity-status").textContent,
    /Could not confirm/,
  );
});

test("unsupported settings after header relocation never detach or erase the editor", (t) => {
  const view = blockDocument();
  t.after(view.install());
  const f = card(view),
    identity = mountBlockIdentity(f.article, {});
  identity.update(blockIdentity({ kind: "note", resource: resource("note") }));
  f.editor.value = "Synthetic retained unsaved draft";
  f.editor.setSelectionRange(3, 11);
  const options = {
    kind: "note",
    referenceId: "resource:note",
    preview: "saved",
    subtitle: "document",
  };
  assert.doesNotThrow(() =>
    showUnavailableBlock(
      f.article,
      {
        code: "unsupported-version",
        title: "Unsupported saved settings",
        message: "Data retained",
      },
      options,
    ),
  );
  assert.equal(f.working.inert, true);
  assert.equal(f.editor.parentElement, f.working);
  showUnavailableBlock(f.article, null, options);
  assert.equal(f.working.inert, undefined);
  assert.equal(f.editor.value, "Synthetic retained unsaved draft");
  assert.deepEqual([f.editor.selectionStart, f.editor.selectionEnd], [3, 11]);
  identity.dispose();
  assert.equal(f.actions.parentElement, f.inner);
});
