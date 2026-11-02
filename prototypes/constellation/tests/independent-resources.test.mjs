import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, edges } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
import { project, isUniverseRoot } from "../projection.ts";

const resource = (id, kind = "note") => ({
  id,
  title: `Independent ${id}`,
  kind,
  project_id: null,
});
const key = (id) => `resource:unplaced:${id}`;
const fixture = (resources = [resource("note")]) => ({
  projects: [],
  workspaces: [],
  resources,
  blocks: [],
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: null },
});
function setup(snapshot = fixture(), load = null) {
  const motion = new MotionCoordinator(),
    calls = { opens: [], navigation: [], saves: [] },
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async (destination) => calls.navigation.push(destination),
      openResource: async (request) => calls.opens.push(request),
      persistence: {
        load: async () => load,
        save: async (state) => calls.saves.push(structuredClone(state)),
      },
    }),
    n = new SpatialNavigator(c, () => {}, { width: 1600, height: 1000 });
  c.spatial = n;
  const scene = new ConstellationScene(c, n, () => ({
      left: 0,
      top: 0,
      width: 1600,
      height: 1000,
    })),
    settle = () => {
      for (let i = 0; i < 180; i++) motion.step(1 / 60);
    };
  return {
    c,
    n,
    scene,
    calls,
    settle,
    dispose() {
      scene.dispose();
      c.dispose();
    },
  };
}

test("zero-project zero-workspace resources are real Universe nodes with rendered labels, list discovery and direct Open", async () => {
  for (const kind of [
    "note",
    "conversation",
    "image",
    "agent",
    "checklist",
    "timeline",
  ]) {
    const snapshot = fixture([resource(kind, kind)]),
      before = structuredClone(snapshot),
      { c, n, scene, calls, dispose } = setup(snapshot),
      node = c.nodes.get(key(kind));
    assert.ok(
      node,
      "a canonical resource cannot disappear solely because there are no projects/workspaces",
    );
    assert.equal(node.parent, null);
    assert.equal(node.id, kind);
    assert.equal(node.resourceId, kind);
    assert.equal(node.resourceKind, kind);
    assert.equal(node.workspaceId, undefined);
    assert.equal(c.nodes.size, 1);
    assert.deepEqual(
      n.candidateNodes().map((n) => n.key),
      [key(kind)],
    );
    assert.deepEqual(
      c.visible(1600, 1000).map((n) => n.key),
      [key(kind)],
    );
    assert.equal(c.search(`Independent ${kind}`)[0].key, key(kind));
    assert.ok(
      n.camera.distance >= 3300,
      "exercise Universe label distance gating",
    );
    assert.deepEqual(
      scene.labels(1600, 1000).map((p) => p.node.key),
      [key(kind)],
    );
    assert.equal(scene.diagnostics.nodes, 1);
    const state = structuredClone(c.state),
      camera = n.camera;
    await c.approach(key(kind));
    assert.equal(calls.opens[0].resourceId, kind);
    assert.equal(calls.opens[0].preferredPresentation, "direct");
    assert.equal(calls.opens[0].preferredPlacement, undefined);
    assert.equal(calls.navigation.length, 0);
    assert.equal(calls.saves.length, 0);
    assert.deepEqual(c.state, state);
    assert.deepEqual(n.camera, camera);
    assert.deepEqual(snapshot, before);
    assert.equal(snapshot.projects.length, 0);
    assert.equal(snapshot.workspaces.length, 0);
    assert.equal(snapshot.blocks.length, 0);
    dispose();
  }
});

test("Locate, Explore, inward wheel and return preserve an independent resource's Universe context and real relationship direction", async () => {
  const snapshot = fixture([
    resource("note"),
    resource("chat", "conversation"),
  ]);
  snapshot.relationships.push({
    id: "reference",
    source_id: "note",
    target_id: "chat",
    kind: "references",
    provenance: "user",
  });
  const { c, n, scene, calls, settle, dispose } = setup(snapshot);
  await c.locate(key("note"), false);
  assert.deepEqual(c.location, { kind: "universe" });
  assert.deepEqual(calls.navigation[0], {
    kind: "constellation",
    projectId: null,
  });
  await n.explore(key("note"));
  settle();
  assert.equal(n.neighborhood, key("note"));
  assert.deepEqual(
    new Set(n.candidateNodes().map((n) => n.key)),
    new Set([key("note"), key("chat")]),
  );
  assert.deepEqual(
    edges(c).map((e) => ({
      id: e.id,
      from: e.sourceId,
      to: e.targetId,
      kind: e.kind,
    })),
    [{ id: "reference", from: "note", to: "chat", kind: "references" }],
  );
  scene.update(1600, 1000);
  assert.equal(scene.diagnostics.edges, 1);
  n.target({ ...n.camera, target: n.position(key("note")), distance: 440 });
  settle();
  const navigation = calls.navigation.length,
    history = structuredClone(c.state.history);
  c.zoom(1.3, key("note"));
  const desired = n.bookmark();
  await new Promise(setImmediate);
  settle();
  assert.equal(calls.opens.at(-1).resourceId, "note");
  assert.equal(calls.navigation.length, navigation);
  assert.deepEqual(c.location, { kind: "universe" });
  assert.deepEqual(c.state.history, history);
  assert.deepEqual(n.camera, desired);
  assert.equal(n.neighborhood, key("note"));
  assert.ok(
    calls.navigation.every((target) => target.kind === "constellation"),
  );
  dispose();
});

test("a resource created while the zero-organization Universe is open appears without restart or camera reset", () => {
  const { c, n, scene, dispose } = setup(fixture([])),
    camera = n.camera;
  assert.equal(c.nodes.size, 0);
  assert.deepEqual(scene.labels(1600, 1000), []);
  const next = fixture([resource("new-note")]);
  c.update(next, false);
  assert.deepEqual(n.camera, camera);
  assert.ok(
    scene
      .labels(1600, 1000)
      .some((label) => label.node.key === key("new-note")),
  );
  assert.equal(c.nodes.get(key("new-note")).parent, null);
  assert.equal(c.snapshot.projects.length, 0);
  assert.equal(c.snapshot.workspaces.length, 0);
  assert.equal(c.snapshot.blocks.length, 0);
  dispose();
});

test("an independent resource neighborhood exposes granted related aliases without inventing their ownership", async () => {
  const snapshot = fixture([
    resource("independent"),
    { ...resource("linked"), project_id: "p" },
  ]);
  snapshot.projects.push({ id: "p", title: "Existing project" });
  snapshot.workspaces.push({
    id: "w",
    title: "Existing workspace",
    project_id: "p",
  });
  snapshot.blocks.push({
    id: "b",
    resource_id: "linked",
    workspace_id: "w",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: 0,
  });
  snapshot.relationships.push({
    id: "reference",
    source_id: "independent",
    target_id: "linked",
    kind: "references",
    provenance: "user",
  });
  const { c, n, scene, settle, dispose } = setup(snapshot);
  assert.equal(
    n.candidateNodes().some((node) => node.key === "resource:b"),
    false,
  );
  await n.explore(key("independent"));
  settle();
  assert.ok(n.candidateNodes().some((node) => node.key === "resource:b"));
  assert.equal(c.nodes.get(key("independent")).parent, null);
  assert.equal(c.nodes.get("resource:b").parent, "workspace:w");
  scene.update(1600, 1000);
  assert.ok(
    scene.links.children.some((line) => line.userData.edge === "reference"),
  );
  dispose();
});

test("existing placed aliases remain unchanged and no unknown or denied project is invented", () => {
  const snapshot = fixture([
    resource("shared"),
    { ...resource("unknown"), project_id: "missing" },
    { ...resource("denied"), project_id: "private" },
  ]);
  snapshot.projects.push({ id: "private", title: "Hidden", visible: false });
  snapshot.workspaces.push(
    ...["a", "b"].map((id) => ({ id, title: id, project_id: null })),
  );
  snapshot.blocks.push(
    ...["a", "b"].map((workspace_id) => ({
      id: `block-${workspace_id}`,
      resource_id: "shared",
      workspace_id,
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      z: 0,
    })),
  );
  const before = structuredClone(snapshot),
    nodes = project(snapshot, {});
  assert.equal(nodes.has(key("shared")), false);
  assert.equal(nodes.has(key("unknown")), false);
  assert.equal(nodes.has(key("denied")), false);
  for (const id of ["a", "b"]) {
    assert.equal(nodes.get(`resource:block-${id}`).resourceId, "shared");
    assert.equal(nodes.get(`resource:block-${id}`).parent, `workspace:${id}`);
  }
  assert.equal([...nodes.values()].filter(isUniverseRoot).length, 2);
  assert.deepEqual(snapshot, before);
  snapshot.blocks = [];
  const unplaced = project(snapshot, {});
  assert.equal(unplaced.get(key("shared")).parent, null);
  assert.equal(unplaced.has("project:missing"), false);
  assert.equal(unplaced.has("workspace:undefined"), false);
});

test("denied metadata and hidden placements cannot erase or influence a separately granted independent resource", () => {
  const hidden = { ...resource("hidden"), visible: false };
  Object.defineProperty(hidden, "title", {
    get() {
      assert.fail("denied title read");
    },
  });
  const snapshot = fixture([
    hidden,
    resource("allowed"),
    { ...resource("unavailable"), available: false },
  ]);
  snapshot.workspaces.push({
    id: "hidden-workspace",
    project_id: null,
    title: "Hidden",
    visible: false,
  });
  snapshot.blocks.push({
    id: "hidden-block",
    resource_id: "allowed",
    workspace_id: "hidden-workspace",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    z: 0,
  });
  const baseline = project(snapshot, {}),
    withHiddenAnchor = project(snapshot, {
      [key("hidden")]: { x: 0, y: 0 },
      "workspace:hidden-workspace": { x: 160, y: 160 },
    });
  assert.deepEqual(
    withHiddenAnchor.get(key("allowed")),
    baseline.get(key("allowed")),
  );
  assert.equal(withHiddenAnchor.has(key("hidden")), false);
  assert.equal(withHiddenAnchor.has("resource:hidden-block"), false);
  assert.equal(withHiddenAnchor.get(key("unavailable")).available, false);
});

test("new independent resources preserve manual XYZ, pins, camera and exact restart view without canonical organization", async () => {
  const snapshot = fixture([resource("z-existing")]),
    { c, n, calls, settle, dispose } = setup(snapshot),
    existing = key("z-existing");
  await n.place(existing, { x: 500, y: 220, z: -300 }, true);
  c.select(existing);
  n.target({
    ...n.camera,
    target: n.position(existing),
    distance: 1700,
    yaw: -0.9,
    pitch: 0.5,
  });
  settle();
  const anchor = structuredClone(c.state.anchors[existing]),
    camera = n.camera,
    before = structuredClone(snapshot);
  const next = structuredClone(snapshot);
  next.resources.unshift(resource("a-new"));
  c.update(next);
  assert.deepEqual(c.state.anchors[existing], anchor);
  assert.deepEqual(n.camera, camera);
  assert.deepEqual(snapshot, before);
  assert.equal(next.projects.length, 0);
  assert.equal(next.workspaces.length, 0);
  assert.equal(next.blocks.length, 0);
  await c.persist();
  const saved = calls.saves.at(-1),
    restored = setup(next, saved);
  await restored.c.restore();
  restored.settle();
  assert.deepEqual(restored.c.state.anchors, c.state.anchors);
  assert.deepEqual(restored.n.camera, n.camera);
  assert.equal(restored.c.selected, existing);
  assert.deepEqual(restored.c.location, { kind: "universe" });
  next.resources = next.resources.filter((r) => r.id !== "z-existing");
  restored.c.update(next);
  assert.equal(restored.c.nodes.has(existing), false);
  assert.equal(restored.c.state.anchors[existing], undefined);
  restored.dispose();
  dispose();
});

test("ten thousand independent resources retain compact framing, bounded detail/labels and the private view-state size bound", async () => {
  const resources = Array.from({ length: 10000 }, (_, i) =>
      resource(
        `${i.toString(16).padStart(8, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
      ),
    ),
    { c, n, scene, calls, dispose } = setup(fixture(resources));
  assert.equal(c.nodes.size, resources.length);
  assert.equal(n.candidateNodes().length, resources.length);
  assert.ok(n.camera.distance <= 100000);
  const labels = scene.labels(1600, 1000);
  assert.ok(labels.length > 0 && labels.length <= 30);
  assert.ok(scene.objects.size <= 160);
  assert.ok(scene.diagnostics.instancedBodies > 0);
  assert.equal(
    scene.diagnostics.nodes + scene.diagnostics.culled,
    resources.length,
  );
  await c.persist();
  assert.ok(
    Buffer.byteLength(JSON.stringify(calls.saves.at(-1))) <= 2 * 1024 * 1024,
  );
  assert.equal(c.snapshot.projects.length, 0);
  assert.equal(c.snapshot.workspaces.length, 0);
  assert.equal(c.snapshot.blocks.length, 0);
  dispose();
});
