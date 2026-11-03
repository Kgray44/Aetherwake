import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";

function fixture() {
  return {
    projects: [{ id: "p", title: "Project" }],
    workspaces: ["w", "q"].map((id) => ({ id, title: id, project_id: "p" })),
    resources: [
      { id: "placed", title: "Shared note", kind: "note", project_id: "p" },
      {
        id: "unplaced",
        title: "Unplaced chat",
        kind: "conversation",
        project_id: "p",
        providerId: "local",
        messages: [
          {
            id: "message",
            role: "user",
            content: "Synthetic canonical content",
          },
        ],
      },
      { id: "orphan", title: "Independent note", kind: "note" },
    ],
    blocks: ["w", "q"].map((workspace_id, i) => ({
      id: `b${i}`,
      resource_id: "placed",
      workspace_id,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: 0,
    })),
    relationships: [],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: "p" },
  };
}
function setup(hooks = {}) {
  const calls = { opened: [], navigated: [], saved: [], graph: [] },
    motion = new MotionCoordinator();
  let c;
  c = new ConstellationController({
    snapshot: hooks.snapshot ?? fixture(),
    motion,
    onNavigationIntent: hooks.onNavigationIntent,
    navigate: async (destination) => {
      calls.navigated.push(destination);
      await hooks.navigate?.(destination, c);
    },
    openResource: hooks.missingHost
      ? undefined
      : async (request) => {
          calls.opened.push(structuredClone(request));
          return hooks.open?.(request, c);
        },
    graphAction: async (request) => {
      calls.graph.push(request);
      throw Error("Open must not organize resources");
    },
    persistence: {
      load: async () => hooks.load?.(),
      save: async (state) => {
        calls.saved.push(state);
      },
    },
  });
  const n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  const settle = () => {
    for (let i = 0; i < 180; i++) motion.step(1 / 60);
  };
  return { c, n, calls, settle, dispose: () => c.dispose() };
}
const context = (c, n) =>
  structuredClone({
    snapshot: c.snapshot,
    state: c.state,
    selected: c.selected,
    camera: c.camera,
    spatial: n.camera,
    desired: n.bookmark(),
  });
const tick = () => new Promise(setImmediate);

test("navigation intent reaches the host before queued navigation dispatch", async () => {
  let intents = 0;
  const { c, calls, dispose } = setup({
    onNavigationIntent: () => {
      assert.equal(calls.navigated.length, 0);
      intents++;
    },
  });
  try {
    const navigation = c.go({ kind: "workspace", workspaceId: "w" });
    assert.equal(c.pending, true);
    assert.equal(intents, 1);
    assert.deepEqual(calls.navigated, []);
    await navigation;
    assert.deepEqual(calls.navigated, [{ kind: "workspace", workspaceId: "w" }]);
  } finally {
    dispose();
  }
});

test("unplaced Open dispatches canonical identity and preserves exact spatial context without organization or persistence", async () => {
  const { c, n, calls, settle, dispose } = setup();
  c.select("resource:unplaced:unplaced");
  n.target({
    ...n.camera,
    target: { x: 90, y: 30, z: -200 },
    distance: 1400,
    yaw: -1.2,
    pitch: 0.61,
  });
  settle();
  const before = context(c, n);
  await c.approach();
  assert.deepEqual(calls.opened, [
    {
      resourceId: "unplaced",
      preferredPresentation: "direct",
      origin: {
        source: "constellation",
        nodeKey: "resource:unplaced:unplaced",
      },
    },
  ]);
  assert.deepEqual(context(c, n), before);
  assert.deepEqual(calls.navigated, []);
  assert.deepEqual(calls.saved, []);
  assert.deepEqual(calls.graph, []);
  assert.equal(c.pending, false);
  dispose();
});

test("resources with no project or placement are discoverable roots and open directly with optional message selection", async () => {
  const { c, n, calls, dispose } = setup(),
    before = context(c, n);
  assert.equal(
    [...c.nodes.values()].some((node) => node.id === "orphan"),
    true,
  );
  await c.openResource("orphan");
  await c.openResource("unplaced", { selection: { messageId: "message" } });
  assert.deepEqual(
    calls.opened.map((r) => r.resourceId),
    ["orphan", "unplaced"],
  );
  assert.deepEqual(calls.opened[1].selection, { messageId: "message" });
  assert.ok(calls.opened.every((r) => !r.preferredPlacement));
  assert.deepEqual(context(c, n), before);
  dispose();
});

test("legacy surface Open treats stale placement IDs as optional hints rather than resource identity", async () => {
  const { c, n, calls, dispose } = setup(),
    before = context(c, n);
  await c.go({
    kind: "surface",
    workspaceId: "missing-workspace",
    blockId: "removed-placement",
    resourceId: "orphan",
  });
  assert.deepEqual(calls.opened, [
    {
      resourceId: "orphan",
      preferredPresentation: "direct",
      origin: { source: "constellation" },
    },
  ]);
  assert.deepEqual(context(c, n), before);
  assert.equal(calls.navigated.length, 0);
  dispose();
});

test("bounded animation hints never truncate a valid long canonical resource ID", async () => {
  const snapshot = fixture(),
    id = "r".repeat(256);
  snapshot.resources.push({
    id,
    kind: "note",
    title: "Long identity",
    project_id: "p",
  });
  const { c, calls, dispose } = setup({ snapshot });
  await c.approach("resource:unplaced:" + id);
  assert.equal(calls.opened[0].resourceId, id);
  assert.deepEqual(calls.opened[0].origin, { source: "constellation" });
  dispose();
});

test("shared placements default to the same canonical direct Open; placement focus is a separate explicit request", async () => {
  const { c, n, calls, dispose } = setup(),
    before = context(c, n);
  await c.approach("resource:b0");
  await c.approach("resource:b1");
  assert.deepEqual(
    calls.opened.map((r) => r.resourceId),
    ["placed", "placed"],
  );
  assert.ok(
    calls.opened.every(
      (r) => r.preferredPresentation === "direct" && !r.preferredPlacement,
    ),
  );
  await c.focusExistingPlacement("resource:b1");
  assert.deepEqual(calls.opened[2], {
    resourceId: "placed",
    preferredPresentation: "existing-placement",
    preferredPlacement: { workspaceId: "q", blockId: "b1" },
    origin: { source: "constellation", nodeKey: "resource:b1" },
  });
  assert.deepEqual(context(c, n), before);
  assert.deepEqual(calls.navigated, []);
  await assert.rejects(
    c.focusExistingPlacement("resource:unplaced:unplaced"),
    /existing workspace placement/,
  );
  dispose();
});

test("removing the last placement leaves its canonical resource directly openable", async () => {
  const snapshot = fixture();
  snapshot.blocks = [];
  const { c, n, calls, dispose } = setup({ snapshot }),
    before = context(c, n);
  await c.approach("resource:unplaced:placed");
  assert.equal(calls.opened[0].resourceId, "placed");
  assert.equal(calls.opened[0].preferredPlacement, undefined);
  assert.deepEqual(context(c, n), before);
  assert.deepEqual(calls.navigated, []);
  dispose();
});

test("placement unavailability does not revoke canonical Open, but explicit placement focus remains unavailable", async () => {
  const snapshot = fixture();
  snapshot.blocks[0].available = false;
  const { c, calls, dispose } = setup({ snapshot });
  await c.approach("resource:b0");
  assert.equal(calls.opened[0].resourceId, "placed");
  assert.equal(calls.opened[0].origin.nodeKey, undefined);
  await assert.rejects(
    c.focusExistingPlacement("resource:b0"),
    /Destination unavailable/,
  );
  assert.equal(calls.opened.length, 1);
  dispose();
});

test("hidden, revoked, unknown and host-unsupported resources fail truthfully without navigation", async () => {
  for (const change of [
    (s) => (s.resources[1].visible = false),
    (s) => (s.resources[1].available = false),
    (s) => s.resources.splice(1, 1),
  ]) {
    const snapshot = fixture();
    change(snapshot);
    const { c, calls, dispose } = setup({ snapshot });
    await assert.rejects(c.openResource("unplaced"), /Destination unavailable/);
    assert.equal(calls.opened.length, 0);
    assert.equal(calls.navigated.length, 0);
    dispose();
  }
  const { c, n, calls, dispose } = setup({ missingHost: true }),
    before = context(c, n);
  await assert.rejects(c.openResource("orphan"), /editor is unavailable/);
  assert.deepEqual(context(c, n), before);
  assert.equal(calls.navigated.length, 0);
  dispose();
});

test("queued direct opening revalidates canonical permissions and does not supersede an explicit navigation in flight", async () => {
  let release;
  const { c, calls, dispose } = setup({
    navigate: async (destination, controller) => {
      await new Promise((resolve) => (release = resolve));
      controller.update({
        ...controller.snapshot,
        activeWorkspaceId: destination.workspaceId,
        navigation: destination,
      });
    },
  });
  const travel = c.go({ kind: "workspace", workspaceId: "w" });
  await tick();
  const opening = c.openResource("unplaced"),
    rejected = assert.rejects(opening, /Destination unavailable/);
  const next = fixture();
  next.resources[1].visible = false;
  c.update(next);
  release();
  await travel;
  await rejected;
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: "w" });
  assert.equal(calls.opened.length, 0);
  assert.equal(c.pending, false);
  dispose();
});

test("manual camera motion and repeated direct views retain the latest context without hidden mutations", async () => {
  let release,
    focused = null;
  const { c, n, calls, settle, dispose } = setup({
    open: async (request) => {
      focused = request.resourceId;
      await new Promise((resolve) => (release = resolve));
    },
  });
  const opening = c.openResource("unplaced");
  await tick();
  n.orbit(90, -20);
  n.pan(30, -10);
  settle();
  const before = context(c, n);
  release();
  await opening;
  assert.deepEqual(context(c, n), before);
  for (let i = 0; i < 3; i++) {
    focused = null;
    const again = c.openResource("unplaced");
    await tick();
    release();
    await again;
    assert.equal(focused, "unplaced");
  }
  focused = null;
  assert.deepEqual(context(c, n), before);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.navigated.length, 0);
  assert.equal(calls.graph.length, 0);
  dispose();
});

test("new navigation cancels queued Open and direct-view failures cannot corrupt source navigation", async () => {
  const { c, calls, dispose } = setup({
    open: async () => {
      throw Error("Supported viewer disconnected");
    },
  });
  const opening = c.openResource("unplaced"),
    travel = c.go({ kind: "universe" });
  await opening;
  await travel;
  assert.equal(calls.opened.length, 0);
  assert.deepEqual(c.location, { kind: "universe" });
  const before = structuredClone(c.state);
  await assert.rejects(c.openResource("unplaced"), /viewer disconnected/);
  assert.equal(c.error, "Supported viewer disconnected");
  assert.deepEqual(c.state, before);
  dispose();
});

test("new direct intents reach the central opener while an older viewer is loading", async () => {
  let release,
    revision = 0,
    visible = null;
  const { c, calls, dispose } = setup({
    open: async (request) => {
      const intent = ++revision;
      if (request.resourceId === "unplaced")
        await new Promise((resolve) => (release = resolve));
      if (intent === revision) visible = request.resourceId;
    },
  });
  const first = c.openResource("unplaced");
  await tick();
  const latest = c.openResource("orphan");
  await tick();
  try {
    assert.deepEqual(
      calls.opened.map((r) => r.resourceId),
      ["unplaced", "orphan"],
    );
  } finally {
    release();
  }
  await Promise.all([first, latest]);
  assert.equal(visible, "orphan");
  dispose();
});

test("permission changes during an awaited viewer are reported without moving the source camera", async () => {
  let release;
  const { c, n, calls, dispose } = setup({
    open: async () => new Promise((resolve) => (release = resolve)),
  });
  const before = {
      location: structuredClone(c.location),
      camera: n.bookmark(),
      history: structuredClone(c.state.history),
    },
    opening = c.openResource("unplaced"),
    rejected = assert.rejects(opening, /Destination unavailable/);
  await tick();
  const next = fixture();
  next.resources[1].available = false;
  c.update(next, false);
  release();
  await rejected;
  assert.deepEqual(c.location, before.location);
  assert.deepEqual(n.bookmark(), before.camera);
  assert.deepEqual(c.state.history, before.history);
  assert.equal(c.error, "Destination unavailable");
  assert.equal(calls.navigated.length, 0);
  dispose();
});

test("legacy surface history, Forward and saved views normalize to workspace navigation without implicit editor opening", async () => {
  const snapshot = fixture();
  snapshot.blocks = [];
  snapshot.navigation = { kind: "workspace", workspaceId: "w" };
  snapshot.activeWorkspaceId = "w";
  let saved;
  const { c, calls, dispose } = setup({ snapshot, load: () => saved });
  const bookmark = { camera: { x: 40, y: 80, zoom: 1.5 }, selected: null },
    surface = {
      kind: "surface",
      workspaceId: "q",
      resourceId: "placed",
      blockId: "removed-placement",
    };
  saved = {
    ...structuredClone(c.state),
    history: [{ location: surface, bookmark }],
    future: [{ location: surface, bookmark }],
    savedViews: [
      { id: "view:legacy", name: "Legacy", location: surface, bookmark },
    ],
  };
  await c.restore();
  for (const entry of [
    ...c.state.history,
    ...c.state.future,
    ...c.state.savedViews,
  ])
    assert.deepEqual(entry.location, { kind: "workspace", workspaceId: "q" });
  await c.back();
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: "q" });
  assert.equal(calls.opened.length, 0);
  dispose();
});

test("inward wheel opens an unplaced resource and retains the deliberate camera pose and project history", async () => {
  const { c, n, calls, settle, dispose } = setup(),
    key = "resource:unplaced:unplaced";
  n.target({ ...n.camera, target: n.position(key), distance: 440 });
  settle();
  const history = structuredClone(c.state.history),
    snapshot = structuredClone(c.snapshot);
  c.zoom(1.3, key);
  const desired = n.bookmark();
  await tick();
  settle();
  assert.equal(calls.opened[0].resourceId, "unplaced");
  assert.deepEqual(c.location, { kind: "project", projectId: "p" });
  assert.deepEqual(n.camera, desired);
  assert.deepEqual(c.state.history, history);
  assert.deepEqual(c.snapshot, snapshot);
  assert.deepEqual(calls.navigated, []);
  dispose();
});
