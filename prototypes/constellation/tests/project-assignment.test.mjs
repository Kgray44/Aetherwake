import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "../projection.ts";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";

const canonicalKey = "resource:unplaced:r";
const block = (id, workspaceId) => ({
  id,
  resource_id: "r",
  workspace_id: workspaceId,
  x: 30,
  y: 40,
  width: 320,
  height: 240,
  z: 1,
});
const fixture = () => ({
  projects: [
    { id: "p", title: "Original project" },
    { id: "q", title: "Destination project" },
  ],
  workspaces: [
    { id: "wp", title: "Original workspace", project_id: "p" },
    { id: "wq", title: "Destination workspace", project_id: "q" },
  ],
  resources: [{ id: "r", title: "Shared note", kind: "note", project_id: "p" }],
  blocks: [block("b", "wp")],
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "q" },
});

test("project reassignment adds the canonical project body while retaining foreign workspace references", () => {
  const snapshot = fixture(),
    anchors = {};
  const before = project(snapshot, anchors);
  assert.equal(before.has(canonicalKey), false);
  const changed = structuredClone(snapshot);
  changed.resources[0].project_id = "q";
  changed.blocks.push(block("another-reference", "wp"));
  const original = structuredClone(changed),
    nodes = project(changed, anchors);
  assert.equal(nodes.get(canonicalKey).parent, "project:q");
  assert.equal(nodes.get(canonicalKey).resourceId, "r");
  assert.equal(nodes.get(canonicalKey).workspaceId, undefined);
  assert.equal(nodes.get("resource:b").parent, "workspace:wp");
  assert.deepEqual(nodes.get("resource:b"), before.get("resource:b"));
  assert.equal(nodes.get("resource:another-reference").resourceId, "r");
  assert.equal(
    [...nodes.values()].filter(
      (n) => n.parent === "project:q" && n.resourceId === "r",
    ).length,
    1,
  );
  assert.deepEqual(
    changed,
    original,
    "projection must not mutate canonical data or block geometry",
  );
});

test("a placement in the resource's canonical project represents it without an extra canonical body", () => {
  const snapshot = fixture();
  snapshot.resources[0].project_id = "q";
  snapshot.blocks.push(block("own-project", "wq"));
  let nodes = project(snapshot, {});
  assert.equal(nodes.has(canonicalKey), false);
  assert.equal(nodes.get("resource:own-project").parent, "workspace:wq");
  assert.equal(nodes.get("resource:b").parent, "workspace:wp");
  snapshot.blocks = snapshot.blocks.filter((b) => b.id !== "own-project");
  nodes = project(snapshot, {});
  assert.equal(
    nodes.get(canonicalKey).parent,
    "project:q",
    "removing the last local reference must not erase the canonical association",
  );
  assert.equal(nodes.get("resource:b").resourceId, "r");
});

test("unassigned and unknown projects are never invented; standalone workspace references do not hide a granted canonical association", () => {
  for (const projectId of [null, undefined, "unknown"]) {
    const snapshot = fixture();
    snapshot.resources[0].project_id = projectId;
    const nodes = project(snapshot, {});
    assert.equal(nodes.has(canonicalKey), false);
    assert.equal(nodes.get("resource:b").resourceId, "r");
    assert.equal(nodes.size, 5);
  }
  const snapshot = fixture();
  snapshot.workspaces[0].project_id = null;
  const nodes = project(snapshot, {});
  assert.equal(nodes.get("workspace:wp").parent, null);
  assert.equal(nodes.get("resource:b").parent, "workspace:wp");
  assert.equal(nodes.get(canonicalKey).parent, "project:p");
});

test("denied and revoked metadata stays excluded before canonical-project representation", () => {
  const snapshot = fixture();
  snapshot.resources[0].project_id = "q";
  const anchors = {};
  assert(project(snapshot, anchors).has(canonicalKey));
  snapshot.projects[1].visible = false;
  Object.defineProperty(snapshot.projects[1], "title", {
    get() {
      assert.fail("denied project title must not be read");
    },
  });
  let nodes = project(snapshot, anchors);
  assert.equal(nodes.has("project:q"), false);
  assert.equal(nodes.has("workspace:wq"), false);
  assert.equal(nodes.has(canonicalKey), false);
  assert.equal(
    nodes.get("resource:b").resourceId,
    "r",
    "a separately granted existing reference is preserved",
  );
  snapshot.resources[0].visible = false;
  Object.defineProperty(snapshot.resources[0], "title", {
    get() {
      assert.fail("revoked resource title must not be read");
    },
  });
  nodes = project(snapshot, anchors);
  assert.equal(
    [...nodes.values()].some((n) => n.resourceId === "r"),
    false,
  );
});

test("a hidden placement cannot suppress an otherwise granted canonical resource or expose its workspace", () => {
  const snapshot = fixture();
  snapshot.resources[0].project_id = "q";
  snapshot.blocks.push(block("hidden-placement", "wq"));
  snapshot.workspaces[1].visible = false;
  Object.defineProperty(snapshot.workspaces[1], "title", {
    get() {
      assert.fail("hidden workspace metadata must not be read");
    },
  });
  let nodes = project(snapshot, {});
  assert.equal(nodes.has("workspace:wq"), false);
  assert.equal(nodes.has("resource:hidden-placement"), false);
  assert.equal(nodes.get(canonicalKey).parent, "project:q");
  assert.equal(nodes.get(canonicalKey).workspaceId, undefined);
  snapshot.resources[0].available = false;
  nodes = project(snapshot, {});
  assert.equal(nodes.get(canonicalKey).available, false);
  assert.equal(nodes.get("resource:b").available, false);
});

test("a live assignment refresh preserves existing XYZ pins and canonical IDs while exposing the destination project body", async () => {
  const snapshot = fixture(),
    motion = new MotionCoordinator();
  let navigations = 0;
  const controller = new ConstellationController({
    snapshot,
    motion,
    navigate: async () => {
      navigations++;
    },
  });
  const spatial = new SpatialNavigator(controller, () => {});
  controller.spatial = spatial;
  try {
    await spatial.place("resource:b", spatial.position("resource:b"));
    const anchors = structuredClone(controller.state.anchors);
    const changed = structuredClone(snapshot);
    changed.resources[0].project_id = "q";
    const unchanged = structuredClone(changed);
    controller.update(changed);
    assert(spatial.candidateNodes().some((n) => n.key === canonicalKey));
    assert.equal(controller.nodes.get(canonicalKey).parent, "project:q");
    assert.equal(controller.nodes.get(canonicalKey).resourceId, "r");
    assert.equal(controller.nodes.get("resource:b").parent, "workspace:wp");
    for (const [key, anchor] of Object.entries(anchors))
      assert.deepEqual(controller.state.anchors[key], anchor, key);
    assert.equal(controller.state.anchors["resource:b"].pinned, true);
    assert.deepEqual(changed, unchanged);
    assert.equal(
      navigations,
      0,
      "a metadata refresh must not navigate or reattach the resource",
    );
    changed.resources[0].title = "Renamed shared note";
    controller.update(changed);
    assert.equal(
      controller.nodes.get(canonicalKey).title,
      changed.resources[0].title,
    );
    assert.equal(
      controller.nodes.get("resource:b").title,
      changed.resources[0].title,
    );
    changed.resources[0].visible = false;
    controller.update(changed);
    assert.equal(controller.nodes.has(canonicalKey), false);
    assert.equal(controller.nodes.has("resource:b"), false);
    assert.equal(controller.state.anchors[canonicalKey], undefined);
    assert.equal(controller.state.anchors["resource:b"], undefined);
  } finally {
    controller.dispose();
  }
});
