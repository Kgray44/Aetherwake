import test from "node:test";
import assert from "node:assert/strict";
import { recommendBlocks, REGISTERED_BLOCKS } from "../registry.ts";
import type { LibraryCapabilities } from "../contracts.ts";
const capabilities: LibraryCapabilities = {
  revision: 1,
  kinds: Object.fromEntries(
    REGISTERED_BLOCKS.map((block) => [block.kind, { state: "available" }]),
  ),
  subjects: {
    project_overview: { state: "available" },
    resource_browser: { state: "available" },
    collection_browser: { state: "available" },
  },
  providers: { local: { state: "available" } },
  velaPlanning: { state: "unsupported" },
};
test("recommendations explain current metadata without requiring a model or changing the canonical context", () => {
  const context = {
      projectId: "synthetic-project",
      presentKinds: ["conversation", "task"] as const,
    },
    before = structuredClone(context);
  const result = recommendBlocks(context, capabilities);
  assert.deepEqual(
    result.map((item) => item.kind),
    ["project_overview", "note", "stream", "task_group", "resource_browser"],
  );
  assert.ok(result.every((item) => item.reason.length > 20));
  assert.deepEqual(context, before);
});
test("unknown or unavailable capabilities never become recommendations and present views are not suggested again", () => {
  const unavailable = structuredClone(capabilities);
  unavailable.kinds.note = { state: "disabled" };
  delete unavailable.subjects?.resource_browser;
  delete unavailable.subjects?.project_overview;
  assert.deepEqual(
    recommendBlocks(
      {
        projectId: "synthetic-project",
        presentKinds: ["conversation", "stream"],
      },
      unavailable,
    ),
    [],
  );
  assert.deepEqual(recommendBlocks(null, capabilities), []);
});
test("empty workspace suggestions remain task independent and missing context does not fabricate compatibility", () => {
  assert.deepEqual(
    recommendBlocks({ projectId: null, presentKinds: [] }, capabilities).map(
      (item) => item.kind,
    ),
    ["note", "conversation"],
  );
  const unknown: LibraryCapabilities = {
    revision: 1,
    kinds: {},
    providers: {},
    velaPlanning: { state: "unknown" },
  };
  assert.deepEqual(
    recommendBlocks({ projectId: null, presentKinds: [] }, unknown),
    [],
  );
});
