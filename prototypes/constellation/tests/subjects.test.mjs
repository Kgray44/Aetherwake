import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "../projection.ts";
const fixture = () => ({
  projects: [{ id: "p", title: "Project" }],
  workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
  resources: [{ id: "r", title: "Note", kind: "note" }],
  relationships: [],
  activeWorkspaceId: "w",
  blocks: [],
});
const placement = {
  workspace_id: "w",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  z: 0,
};
test("typed non-resource block subjects do not become invented canonical resources", () => {
  const s = fixture();
  s.blocks = [
    {
      ...placement,
      id: "r-block",
      resource_id: "r",
      subject: { kind: "resource", resourceId: "r" },
    },
    {
      ...placement,
      id: "project-view",
      subject: { kind: "project", projectId: "p" },
    },
    {
      ...placement,
      id: "collection-view",
      subject: { kind: "collection", collectionId: "collection" },
    },
    {
      ...placement,
      id: "query-view",
      subject: { kind: "resource-query", projectId: "p", query: "notes" },
    },
  ];
  const nodes = project(s, {});
  assert.equal(nodes.size, 3);
  assert.equal(nodes.get("resource:r-block").resourceId, "r");
  for (const key of ["project-view", "collection-view", "query-view"])
    assert.equal(nodes.has("resource:" + key), false);
  assert.equal(nodes.get("project:p").parent, null);
});
test("subject identity mismatches are rejected and unavailable resource subjects cannot open", () => {
  const s = fixture();
  s.blocks = [
    {
      ...placement,
      id: "wrong",
      resource_id: "r",
      subject: { kind: "resource", resourceId: "other" },
    },
    {
      ...placement,
      id: "spoof",
      resource_id: "r",
      subject: { kind: "project", projectId: "p" },
    },
    {
      ...placement,
      id: "unavailable",
      resource_id: "r",
      subject: { kind: "resource", resourceId: "r" },
      subjectState: "unavailable",
    },
  ];
  const nodes = project(s, {});
  assert.equal(nodes.has("resource:wrong"), false);
  assert.equal(nodes.has("resource:spoof"), false);
  assert.equal(nodes.get("resource:unavailable").available, false);
});
