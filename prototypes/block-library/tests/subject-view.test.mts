import test from "node:test";
import assert from "node:assert/strict";
import { mountSubjectExperience } from "../subject-view.ts";
import type {
  BrowseResourcesInput,
  BrowseResourcesPage,
  ProjectOverview,
  ResourceCandidate,
} from "../contracts.ts";
import type { SubjectIdentity } from "../identity-model.ts";
import { blockDocument } from "./component-dom.mts";
import { until } from "../../conversation-product/test/component-dom.mts";

const page = (): BrowseResourcesPage => ({
  scopeTitle: "Authorized scope",
  resources: [
    {
      id: "resource:actual",
      title: "Synthetic canonical note",
      kind: "note",
      projectId: null,
      version: 7,
      placementCount: 0,
      placementCountComplete: true,
    },
  ],
  nextCursor: null,
});

test("normal browser search and same-ID actions stay mounted across pose, refresh and filtering", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const reads: BrowseResourcesInput[] = [],
    attached: ResourceCandidate[] = [],
    opened: string[] = [],
    currentPage = page();
  const controller = mountSubjectExperience(
    view.root,
    { kind: "collection", collectionId: "collection:actual" },
    {
      async projectOverview() {
        throw Error("unexpected");
      },
      async browseResources(input) {
        reads.push(input);
        return structuredClone(currentPage);
      },
    },
    {
      presentation: "workspace",
      attachResource: async (resource) => {
        attached.push(resource);
      },
      openResource: (id) => opened.push(id),
    },
  );
  t.after(() => controller.dispose());
  await until(
    () => view.root.querySelectorAll("[data-resource-id]").length === 1,
  );
  const search = view.root.querySelector("input"),
    row = view.root.querySelector("[data-resource-id]"),
    details = row.querySelector("details");
  assert.equal(row.querySelector('.aw-subject-related'), null, 'An absent native callback must not advertise relationship inspection');
  details.open = true;
  row.scrollTop = 17;
  search.value = "Synthetic";
  search.focus();
  search.setSelectionRange(2, 5);
  search.oninput();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(reads.at(-1)!.query, "Synthetic");
  const before = reads.length;
  controller.setPresentation("focused");
  controller.setPresentation("workspace");
  currentPage.resources[0].title = "Synthetic renamed resource";
  currentPage.resources[0].version = 8;
  await controller.refresh();
  assert.equal(
    reads.length,
    before + 1,
    "Pose changes do not query the backend",
  );
  assert.equal(view.root.querySelector("[data-resource-id]"), row);
  assert.equal(row.querySelector("details"), details);
  assert.equal(details.open, true);
  assert.equal(view.doc.activeElement, search);
  assert.deepEqual(
    [search.value, search.selectionStart, search.selectionEnd, row.scrollTop],
    ["Synthetic", 2, 5, 17],
  );
  row.querySelector(".aw-subject-resource-title").onclick();
  row.querySelector(".aw-subject-action").onclick();
  await until(() => attached.length === 1);
  assert.deepEqual(opened, ["resource:actual"]);
  assert.equal(attached[0].id, "resource:actual");
  assert.equal(attached[0].version, 8);
  assert.equal(
    row.querySelector(".aw-subject-action").getAttribute("aria-label"),
    "Attach Synthetic renamed resource to workspace",
  );
  assert.equal(view.root.querySelector(".aw-subject-filter-menu").open, false);
  controller.setActive(false);
  const paused = reads.length;
  await controller.refresh();
  assert.equal(reads.length, paused);
});

for (const collection of [false, true]) test((collection ? 'Collection' : 'Resource') + ' browser opens relationships for the same current resource from retained Details without touching attachment or search state', async t => {
  const view = blockDocument(); t.after(view.install());
  const current = page(), opened: { id: string; anchor: HTMLElement }[] = [], attached: string[] = [];
  const controller = mountSubjectExperience(view.root, collection ? { kind: 'collection', collectionId: 'collection:actual' } : { kind: 'resource-query', projectId: null, query: '' }, {
    async projectOverview() { throw Error('unexpected'); },
    async browseResources() { return structuredClone(current); },
  }, {
    openRelated(id, anchor) { opened.push({ id, anchor }); },
    ...(collection ? { attachResource: async (resource: ResourceCandidate) => { attached.push(resource.id); } } : {}),
  });
  t.after(() => controller.dispose());
  await until(() => !!view.root.querySelector('.aw-subject-related'));
  const row = view.root.querySelector('[data-resource-id]'), details = row.querySelector('details'), related = row.querySelector('.aw-subject-related'), search = view.root.querySelector('input');
  details.open = true; search.value = 'Retained search'; search.focus(); search.setSelectionRange(2, 5);
  current.resources[0].title = 'Renamed canonical note'; current.resources[0].version = 8;
  await controller.refresh();
  assert.equal(view.root.querySelector('.aw-subject-related'), related); assert.equal(row.querySelector('details'), details); assert.equal(details.open, true);
  assert.equal(view.doc.activeElement, search); assert.deepEqual([search.value, search.selectionStart, search.selectionEnd], ['Retained search', 2, 5]);
  assert.equal(related.getAttribute('aria-label'), 'Related resources for Renamed canonical note');
  related.onclick(); await until(() => opened.length === 1 && !related.disabled);
  assert.equal(opened[0].id, 'resource:actual'); assert.equal(opened[0].anchor, related); assert.deepEqual(attached, []);
  if (collection) assert.equal(row.querySelector('.aw-subject-actions button').getAttribute('aria-label'), 'Attach Renamed canonical note to workspace');
  controller.setActive(false); related.onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(opened.length, 1, 'Hidden/nonworking controls cannot dispatch relationship inspection');
});

test('failed, denied, hidden and disposed relationship openings preserve honest browser state and cannot dispatch stale row authority', async t => {
  const view = blockDocument(); t.after(view.install());
  let denied = false, calls = 0;
  const controller = mountSubjectExperience(view.root, { kind: 'collection', collectionId: 'collection:actual' }, {
    async projectOverview() { throw Error('unexpected'); },
    async browseResources() { if (denied) throw Error('subject_access_denied'); return page(); },
  }, { async openRelated() { calls++; throw Error('native_relationship_surface_unavailable'); } });
  t.after(() => controller.dispose());
  await until(() => !!view.root.querySelector('.aw-subject-related'));
  const row = view.root.querySelector('[data-resource-id]'), related = row.querySelector('.aw-subject-related');
  related.onclick(); await until(() => calls === 1 && !related.disabled);
  assert.equal(view.root.querySelector('[data-resource-id]'), row, 'Opening failure does not revoke an otherwise readable browser page');
  assert.match(view.root.querySelector('.aw-subject-status').textContent, /could not be opened/);
  assert.doesNotMatch(view.root.querySelector('.aw-subject-status').textContent, /Saved|Attached/);
  related.onclick(); controller.setActive(false); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1, 'Departure before the queued dispatch cancels it');
  denied = true; controller.setActive(true); await controller.refresh(); assert.equal(view.root.querySelector('[data-resource-id]'), null);
  related.onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1, 'A retained detached button cannot reuse revoked row authority');
  controller.dispose(); related.onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); assert.equal(view.root.children.length, 0);
});

test("normal project keeps workspace navigation and secondary disclosures stable on canonical updates", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const opened: string[] = [];
  const overview: ProjectOverview = {
    project: { id: "project:a", title: "Synthetic project", version: 1 },
    workspaces: [
      { id: "workspace:a", title: "Synthetic workspace", version: 1 },
    ],
    workspaceListComplete: true,
    resourcesByKind: { note: 3 },
    tasks: { open: 2, done: 1 },
    resourceCountsComplete: false,
    recentEvents: [],
  };
  const controller = mountSubjectExperience(
    view.root,
    { kind: "project", projectId: "project:a" },
    {
      async projectOverview() {
        return structuredClone(overview);
      },
      async browseResources() {
        return page();
      },
    },
    {
      presentation: "workspace",
      openWorkspace(id) {
        opened.push(id);
      },
    },
  );
  t.after(() => controller.dispose());
  await until(
    () => view.root.querySelectorAll("[data-workspace-id]").length === 1,
  );
  const row = view.root.querySelector("[data-workspace-id]"),
    button = row.querySelector("button"),
    more = view.root.querySelector(".aw-project-details");
  const metrics = view.root.querySelector(".aw-project-metrics");
  assert.deepEqual(metrics.querySelectorAll("dd").map((node: any) => node.textContent), ["1", "3+"], "Resource count remains visibly bounded");
  more.open = true;
  button.focus();
  overview.tasks.open = 5;
  controller.setPresentation("focused");
  await controller.refresh();
  controller.setPresentation("workspace");
  assert.equal(view.root.querySelector("[data-workspace-id]"), row);
  assert.equal(view.root.querySelector(".aw-project-details"), more);
  assert.equal(more.open, true);
  assert.equal(view.doc.activeElement, button);
  assert.equal(view.root.querySelector(".aw-project-metrics"), metrics, "Canonical refresh keeps the metric nodes and workspace navigation mounted");
  assert.match(
    view.root.querySelector(".aw-project-summary").textContent,
    /5 open · 1 done · partial counts/,
  );
  button.onclick();
  assert.deepEqual(opened, ["workspace:a"]);
});

test("compact subject reads only when visible, uses a bounded page, and attaches the same granted resource", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const reads: BrowseResourcesInput[] = [],
    projections: SubjectIdentity[] = [],
    attached: ResourceCandidate[] = [];
  const controller = mountSubjectExperience(
    view.root,
    { kind: "resource-query", projectId: null, query: "" },
    {
      async projectOverview() {
        throw new Error("unexpected project read");
      },
      async browseResources(input) {
        reads.push(input);
        return page();
      },
    },
    {
      active: false,
      visible: false,
      onProjection: (value) => projections.push(value),
      attachResource: async (value) => {
        attached.push(value);
      },
    },
  );
  t.after(() => controller.dispose());
  assert.equal(reads.length, 0);
  controller.setVisible(true);
  await until(() => projections.at(-1)?.phase === "ready");
  assert.equal(reads[0].limit, 4);
  assert.equal(
    view.root.querySelectorAll("li").length,
    0,
    "Full browser DOM stays suspended",
  );
  await controller.attach("resource:actual");
  assert.deepEqual(attached, [page().resources[0]]);
  await assert.rejects(
    controller.attach("resource:foreign"),
    /resource_attachment_unavailable/,
  );
  controller.setActive(true);
  await until(
    () => reads.length === 2 && view.root.querySelectorAll("li").length === 1,
  );
  assert.equal(reads[1].limit, 30);
  controller.setActive(false);
  controller.setVisible(false);
  const pausedReads = reads.length;
  await controller.refresh();
  controller.search("Hidden query");
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(reads.length, pausedReads);
  controller.setVisible(true);
  await until(() => reads.length > pausedReads);
  assert.equal(reads.at(-1)!.query, "Hidden query");
});

test("hidden or stale subject replies cannot publish old content; denied refresh clears attachment authority", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const projections: SubjectIdentity[] = [];
  const pending: {
    resolve(page: BrowseResourcesPage): void;
    reject(error: Error): void;
  }[] = [];
  const controller = mountSubjectExperience(
    view.root,
    { kind: "collection", collectionId: "collection:actual" },
    {
      async projectOverview() {
        throw new Error("unexpected project read");
      },
      browseResources: () =>
        new Promise((resolve, reject) => pending.push({ resolve, reject })),
    },
    {
      active: false,
      visible: true,
      onProjection: (value) => projections.push(value),
      attachResource: async () => {},
    },
  );
  t.after(() => controller.dispose());
  controller.setVisible(false);
  pending[0].resolve(page());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    projections.filter((value) => value.phase === "ready").length,
    0,
  );
  controller.setVisible(true);
  pending[1].resolve(page());
  await until(() => projections.at(-1)?.phase === "ready");
  const refresh = controller.refresh();
  pending[2].reject(new Error("subject_access_denied"));
  await refresh;
  assert.equal(projections.at(-1)!.phase, "unavailable");
  assert.equal(view.root.querySelectorAll("li").length, 0);
  await assert.rejects(
    controller.attach("resource:actual"),
    /resource_attachment_unavailable/,
  );
});

test("compact project reads actual overview only; opening adds its resource page", async (t) => {
  const view = blockDocument();
  t.after(view.install());
  const projections: SubjectIdentity[] = [];
  let overviewReads = 0,
    resourceReads = 0;
  const overview: ProjectOverview = {
    project: { id: "project:actual", title: "Synthetic project", version: 1 },
    workspaces: [],
    workspaceListComplete: true,
    resourcesByKind: {},
    tasks: { open: 0, done: 0 },
    resourceCountsComplete: true,
    recentEvents: [],
  };
  const controller = mountSubjectExperience(
    view.root,
    { kind: "project", projectId: "project:actual" },
    {
      async projectOverview() {
        overviewReads++;
        return overview;
      },
      async browseResources() {
        resourceReads++;
        return page();
      },
    },
    {
      active: false,
      visible: true,
      onProjection: (value) => projections.push(value),
    },
  );
  t.after(() => controller.dispose());
  await until(() => projections.at(-1)?.phase === "ready");
  assert.equal(overviewReads, 1);
  assert.equal(resourceReads, 0);
  controller.setActive(true);
  await until(() => resourceReads === 1);
  assert.equal(overviewReads, 2);
});
