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
