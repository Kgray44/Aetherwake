import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator, edges } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";

const kinds = ["agent", "checklist", "timeline"],
  key = (id) => `resource:unplaced:${id}`;
function fixture() {
  return {
    projects: [],
    workspaces: [],
    blocks: [],
    resources: kinds.map((kind) => ({
      id: `canonical-${kind}`,
      kind,
      title: kind,
      project_id: null,
      version: 1,
    })),
    relationships: [
      {
        id: "reference",
        source_id: "canonical-agent",
        target_id: "canonical-checklist",
        kind: "references",
        provenance: "user",
        evidenceRef: "synthetic-canonical-reference",
        freshness: "current",
      },
      {
        id: "dependency",
        source_id: "canonical-checklist",
        target_id: "canonical-timeline",
        kind: "depends_on",
        provenance: "user",
      },
    ],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: null },
  };
}
function setup(snapshot = fixture(), load = null) {
  const calls = { opens: [], navigation: [], saves: [], graph: [] },
    motion = new MotionCoordinator(),
    unsupported = {
      contract: "aerynth.resource-opening@1",
      status: "unsupported",
      resourceId: "canonical-timeline",
      kind: "timeline",
      reason: "resource-kind-unsupported",
    },
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async (destination) => calls.navigation.push(destination),
      openResource: async (request) => {
        calls.opens.push(request);
        return request.resourceId === unsupported.resourceId
          ? unsupported
          : undefined;
      },
      graphAction: async (request) => {
        calls.graph.push(request);
        throw Error("Projection must not organize canonical resources");
      },
      persistence: {
        load: async () => load,
        save: async (state) => calls.saves.push(structuredClone(state)),
      },
    }),
    n = new SpatialNavigator(c, () => {});
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
    unsupported,
    settle,
    dispose() {
      scene.dispose();
      c.dispose();
    },
  };
}
const filaments = (scene) =>
  scene.links.children.filter((child) => child.userData.edge);

test("Agent Checklist and Timeline projection/opening uses canonical metadata only and preserves an unsupported viewer result", async () => {
  const snapshot = fixture();
  for (const resource of snapshot.resources)
    for (const field of [
      "content",
      "configuration",
      "entries",
      "events",
      "messages",
    ])
      Object.defineProperty(resource, field, {
        get() {
          assert.fail(`Projection read domain/private ${field}`);
        },
      });
  const { c, n, scene, calls, unsupported, dispose } = setup(snapshot),
    before = structuredClone(c.state),
    camera = n.camera;
  assert.equal(c.nodes.size, 3);
  assert.deepEqual(
    new Set(scene.labels(1600, 1000).map((label) => label.node.resourceKind)),
    new Set(kinds),
  );
  for (const resource of snapshot.resources) {
    const node = c.nodes.get(key(resource.id));
    assert.equal(node.resourceId, resource.id);
    assert.equal(node.id, resource.id);
    assert.equal(node.resourceKind, resource.kind);
    assert.equal(node.parent, null);
    assert.equal(node.workspaceId, undefined);
    const result = await c.approach(node.key);
    if (resource.kind === "timeline")
      assert.equal(
        result,
        unsupported,
        "unsupported canonical presentation is not replaced with a Note editor or fabricated success",
      );
  }
  assert.deepEqual(
    calls.opens.map((request) => request.resourceId),
    snapshot.resources.map((resource) => resource.id),
  );
  assert.ok(
    calls.opens.every(
      (request) =>
        request.preferredPresentation === "direct" &&
        !request.preferredPlacement &&
        !("kind" in request),
    ),
  );
  assert.deepEqual(c.state, before);
  assert.deepEqual(n.camera, camera);
  assert.equal(snapshot.projects.length, 0);
  assert.equal(snapshot.workspaces.length, 0);
  assert.equal(snapshot.blocks.length, 0);
  assert.equal(calls.navigation.length, 0);
  assert.equal(calls.saves.length, 0);
  assert.equal(calls.graph.length, 0);
  dispose();
});

test("mixed canonical kinds retain directed typed filaments through orbit/zoom and preserve pinned layout across metadata refresh/restart", async () => {
  const snapshot = fixture(),
    { c, n, scene, calls, settle, dispose } = setup(snapshot);
  scene.update(1600, 1000);
  const initial = filaments(scene);
  assert.equal(initial.length, 2);
  const projectedEdges = () =>
    edges(c).map((edge) => ({
      id: edge.id,
      from: edge.sourceId,
      to: edge.targetId,
      kind: edge.kind,
      provenance: edge.provenance,
    }));
  const canonicalEdges = projectedEdges();
  assert.deepEqual(
    canonicalEdges,
    snapshot.relationships.map((edge) => ({
      id: edge.id,
      from: edge.source_id,
      to: edge.target_id,
      kind: edge.kind,
      provenance: edge.provenance,
    })),
  );
  for (const distance of [180, 800, 10000])
    for (const yaw of [0, 1.2, Math.PI, 4.8]) {
      n.target({ ...n.camera, yaw, pitch: yaw % 2 ? -0.55 : 0.7, distance });
      settle();
      scene.update(1600, 1000);
      assert.deepEqual(projectedEdges(), canonicalEdges);
      const current = filaments(scene);
      assert.equal(current.length, initial.length);
      for (let i = 0; i < current.length; i++) {
        assert.equal(current[i], initial[i]);
        assert.equal(current[i].geometry, initial[i].geometry);
      }
    }
  const agentKey = key("canonical-agent");
  await n.place(agentKey, { x: 600, y: 200, z: -400 }, true);
  const anchor = structuredClone(c.state.anchors[agentKey]),
    camera = n.camera;
  const next = fixture();
  next.resources[0].title = "Renamed canonical Agent";
  next.resources[0].version = 2;
  c.update(next);
  assert.deepEqual(c.state.anchors[agentKey], anchor);
  assert.deepEqual(n.camera, camera);
  assert.equal(c.nodes.get(agentKey).resourceKind, "agent");
  assert.equal(c.nodes.size, 3);
  await c.persist();
  const saved = calls.saves.at(-1),
    restored = setup(next, saved);
  await restored.c.restore();
  restored.settle();
  assert.deepEqual(restored.c.state.anchors, c.state.anchors);
  assert.deepEqual(restored.n.camera, n.camera);
  assert.deepEqual(
    edges(restored.c).map((edge) => edge.id),
    snapshot.relationships.map((edge) => edge.id),
  );
  assert.equal(next.projects.length, 0);
  assert.equal(next.workspaces.length, 0);
  assert.equal(next.blocks.length, 0);
  restored.dispose();
  dispose();
});

test("an explicit Agent placement keeps the Agent resource identity and other independent pins without phantom Note or transcript resources", async () => {
  const { c, n, calls, dispose } = setup(),
    checklist = key("canonical-checklist");
  await n.place(checklist, { x: -600, y: -200, z: 400 }, true);
  const anchor = structuredClone(c.state.anchors[checklist]),
    next = fixture();
  next.workspaces.push({
    id: "actual-workspace",
    title: "Explicit workspace",
    project_id: null,
  });
  next.blocks.push({
    id: "actual-agent-placement",
    workspace_id: "actual-workspace",
    resource_id: "canonical-agent",
    subject: { kind: "resource", resourceId: "canonical-agent" },
    x: 0,
    y: 0,
    width: 360,
    height: 300,
    z: 0,
  });
  c.update(next);
  assert.equal(c.nodes.has(key("canonical-agent")), false);
  const alias = c.nodes.get("resource:actual-agent-placement");
  assert.equal(alias.id, "canonical-agent");
  assert.equal(alias.resourceId, "canonical-agent");
  assert.equal(alias.resourceKind, "agent");
  assert.equal(alias.parent, "workspace:actual-workspace");
  assert.deepEqual(c.state.anchors[checklist], anchor);
  await c.approach(alias.key);
  assert.equal(calls.opens.at(-1).resourceId, "canonical-agent");
  assert.equal(calls.opens.at(-1).preferredPresentation, "direct");
  assert.deepEqual(
    new Set(c.snapshot.resources.map((resource) => resource.kind)),
    new Set(kinds),
  );
  assert.equal(c.snapshot.resources.length, 3);
  assert.equal(c.snapshot.blocks.length, 1);
  dispose();
});
