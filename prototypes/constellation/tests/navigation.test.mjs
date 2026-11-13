import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SyntheticService } from "../demo/service.mts";
import { project } from "../projection.ts";

const step = (m) => {
  for (let i = 0; i < 150; i++) m.step(1 / 60);
};
const empty = () => ({
  projects: [],
  workspaces: [],
  resources: [],
  blocks: [],
  relationships: [],
  activeWorkspaceId: null,
});
const setup = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-constellation-"));
  let service = new SyntheticService(join(dir, "fixture.sqlite"));
  service.seed();
  t.after(() => {
    service.close();
    rmSync(dir, { recursive: true });
  });
  return {
    get service() {
      return service;
    },
    restart() {
      service.close();
      service = new SyntheticService(join(dir, "fixture.sqlite"));
      return service;
    },
  };
};
const create = (service) => {
  const motion = new MotionCoordinator(),
    opened = [];
  const c = new ConstellationController({
    snapshot: service.snapshot(),
    motion,
    navigate: async (d) => service.navigate(d),
    persistence: {
      load: async () => service.load(),
      save: async (s) => service.save(s),
    },
    openResource: async (request) => opened.push(request),
  });
  return { c, motion, opened };
};

test("zero, one and many projects; standalone workspaces remain direct destinations", () => {
  const motion = new MotionCoordinator(),
    s = empty();
  const c = new ConstellationController({
    snapshot: s,
    motion,
    navigate: async () => {},
  });
  assert.equal(c.nodes.size, 0);
  assert.deepEqual(c.visible(1400, 800), []);
  s.projects.push({ id: "one", title: "One" });
  s.workspaces.push({
    id: "standalone",
    title: "Standalone",
    project_id: null,
  });
  c.update(s);
  assert.equal(c.search("One").filter((n) => n.kind === "project").length, 1);
  assert.equal(c.search("Standalone")[0].kind, "workspace");
  for (let i = 0; i < 30; i++)
    s.projects.push({ id: `p${i}`, title: `Project ${i}` });
  c.update(s);
  assert.equal(c.search("Project", 100).length, 30);
  c.dispose();
});

test("persisted workspace → project → universe → other project → editor → back preserves identities and layouts", async (t) => {
  const { service } = setup(t),
    { c, motion, opened } = create(service);
  await c.restore();
  const before = service.snapshot();
  const a = before.workspaces.find((w) => w.title === "Development"),
    b = before.workspaces.find((w) => w.title === "Engineering");
  assert.equal(c.location.workspaceId, a.id);
  await c.zoomOut();
  assert.equal(c.location.projectId, a.project_id);
  await c.zoomOut();
  assert.equal(c.location.kind, "universe");
  await c.approach(`project:${b.project_id}`);
  assert.equal(c.location.kind, "project");
  await c.approach(`workspace:${b.id}`);
  assert.equal(service.snapshot().activeWorkspaceId, b.id);
  const block = before.blocks.find((x) => x.workspace_id === b.id);
  const viewBeforeOpen = structuredClone(c.state),
    cameraBeforeOpen = c.camera;
  await c.approach(`resource:${block.id}`);
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: b.id });
  assert.deepEqual(c.state, viewBeforeOpen);
  assert.deepEqual(c.camera, cameraBeforeOpen);
  assert.equal(opened.at(-1).resourceId, block.resource_id);
  assert.equal(opened.at(-1).preferredPresentation, "direct");
  const r = service
    .snapshot()
    .resources.find((r) => r.id === block.resource_id);
  service.content(r.id, "Edited through the real canonical kernel.", r.version);
  await c.go({ kind: "workspace", workspaceId: a.id });
  step(motion);
  await c.persist();
  assert.deepEqual(service.snapshot().blocks, before.blocks);
  assert.equal(service.snapshot().resources.length, before.resources.length);
  assert.equal(
    service.snapshot().resources.find((x) => x.id === r.id).content,
    "Edited through the real canonical kernel.",
  );
  await c.back();
  assert.equal(c.location.workspaceId, b.id);
});

test("restart restores camera, pinned project/workspace anchors and canonical block geometry", async (t) => {
  const fixture = setup(t),
    { c, motion } = create(fixture.service);
  await c.restore();
  await c.zoomOut();
  const project = c.location.projectId;
  await c.pin(`project:${project}`, { x: 808, y: 304 });
  await c.pin(`workspace:${fixture.service.snapshot().workspaces[0].id}`, {
    x: 950,
    y: 480,
  });
  c.move({ x: 900, y: 410, zoom: 1.22 });
  step(motion);
  await c.persist();
  const saved = structuredClone(c.state),
    blocks = fixture.service.snapshot().blocks;
  c.dispose();
  fixture.restart();
  const restored = create(fixture.service);
  await restored.c.restore();
  assert.deepEqual(
    restored.c.camera,
    saved.bookmarks[`project:${project}`].camera,
  );
  assert.deepEqual(restored.c.state.anchors, saved.anchors);
  assert.deepEqual(fixture.service.snapshot().blocks, blocks);
});

test("zoom reversal and interrupted/retargeted camera preserve stable orientation", async (t) => {
  const { service } = setup(t),
    { c, motion } = create(service);
  await c.zoomOut();
  c.zoom(2);
  motion.step(0.04);
  const before = c.camera;
  c.zoom(0.5);
  assert.deepEqual(c.camera, before);
  motion.step(0.03);
  c.interrupt();
  const at = c.camera;
  step(motion);
  assert.deepEqual(c.camera, at);
  c.fit([...c.nodes.keys()][0]);
  step(motion);
  assert.equal(motion.pose(c.motionId).yaw, 0);
  assert.equal(c.camera.zoom, 0.8);
});

test("reduced motion, Quiet and hidden states settle immediately in all quality tiers", async (t) => {
  const { service } = setup(t);
  for (const tier of ["cinematic", "balanced", "efficient"]) {
    const { c, motion } = create(service);
    c.setPolicy({ tier, reduced: true });
    c.move({ x: 100, y: 200, zoom: 0.8 });
    assert.deepEqual(c.camera, { x: 100, y: 200, zoom: 0.8 });
    assert.equal(motion.bodies.get(c.motionId).transitioning, false);
    c.setPolicy({ reduced: false, quiet: true });
    c.pan(20, 10);
    assert.equal(c.camera.x, 120);
    c.setPolicy({ quiet: false, hidden: true });
    c.zoom(2);
    assert.equal(c.camera.zoom, 1.6);
    c.dispose();
  }
});

test("visibility filtering removes nodes, search, edges, counts and saved hidden IDs; unknown/unavailable open fails", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  const s = service.snapshot(),
    hidden = s.projects[0];
  await c.go({ kind: "project", projectId: hidden.id });
  await c.pin(`project:${hidden.id}`, { x: 777, y: 0 });
  hidden.visible = false;
  c.update(s);
  assert.equal(c.location.kind, "universe");
  assert.equal(c.nodes.has(`project:${hidden.id}`), false);
  assert.equal(c.search(hidden.title).length, 0);
  assert.equal(JSON.stringify(c.state).includes(hidden.id), false);
  const unavailable = s.workspaces.find((w) => w.project_id !== hidden.id);
  unavailable.available = false;
  c.update(s);
  await assert.rejects(
    c.approach(`workspace:${unavailable.id}`),
    /unavailable/,
  );
  await assert.rejects(
    c.go({ kind: "workspace", workspaceId: "unknown" }),
    /unavailable/,
  );
});

test("incremental placement never moves saved anchors or collides with occupied cells", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  const before = structuredClone(c.state.anchors);
  service.kernel.createProject("New fixture");
  c.update(service.snapshot());
  for (const [key, p] of Object.entries(before))
    assert.deepEqual(c.state.anchors[key], p);
  const points = service
    .snapshot()
    .projects.map((p) => c.state.anchors[`project:${p.id}`]);
  assert.equal(new Set(points.map((p) => `${p.x},${p.y}`)).size, points.length);
});

test("graphics recovery retains selection, navigation and camera; corrupt stored views recover truthfully", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  await c.zoomOut();
  c.select(`project:${c.location.projectId}`);
  const selected = c.selected;
  c.setPolicy({ graphicsAvailable: false });
  assert.equal(c.selected, selected);
  c.setPolicy({ graphicsAvailable: true });
  assert.equal(c.selected, selected);
  const broken = new ConstellationController({
    snapshot: service.snapshot(),
    motion: new MotionCoordinator(),
    navigate: async () => {},
    persistence: {
      load: async () => {
        throw Error("storage");
      },
      save: async () => {},
    },
  });
  await broken.restore();
  assert.match(broken.error, /could not be restored/);
  assert.ok(broken.search("Engineering").length);
});

test("large datasets have bounded proxy counts and no content mounted in projection", async () => {
  const s = empty();
  for (let p = 0; p < 50; p++) {
    s.projects.push({ id: `p${p}`, title: `P ${p}` });
    for (let w = 0; w < 10; w++) {
      s.workspaces.push({
        id: `w${p}-${w}`,
        project_id: `p${p}`,
        title: `W ${w}`,
      });
      for (let r = 0; r < 20; r++) {
        const id = `r${p}-${w}-${r}`;
        s.resources.push({ id, title: id, kind: "note" });
        s.blocks.push({
          id: `b${id}`,
          workspace_id: `w${p}-${w}`,
          resource_id: id,
          x: r * 20,
          y: 0,
          width: 100,
          height: 100,
          z: r,
        });
      }
    }
  }
  const c = new ConstellationController({
    snapshot: s,
    motion: new MotionCoordinator(),
    navigate: async () => {},
  });
  assert.equal(c.nodes.size, 10550);
  for (const tier of ["cinematic", "balanced", "efficient"]) {
    c.setPolicy({ tier });
    assert.ok(c.visible(1920, 1080).length <= 120);
  }
  assert.equal(
    JSON.stringify([...c.nodes.values()]).includes("content"),
    false,
  );
});

test("external canonical direct navigation synchronizes the layer; stale bookmark cannot override it", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  const b = service
    .snapshot()
    .workspaces.find((w) => w.title === "Engineering");
  service.navigate({ kind: "workspace", workspaceId: b.id });
  c.update(service.snapshot());
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: b.id });
  await c.persist();
  const saved = service.load();
  saved.location = { kind: "project", projectId: b.project_id };
  service.save(saved);
  const restored = create(service);
  await restored.c.restore();
  assert.deepEqual(restored.c.location, {
    kind: "workspace",
    workspaceId: b.id,
  });
});

test("a direct switch after spatial navigation records the previous workspace and camera for Back", async (t) => {
  const { service } = setup(t),
    { c, motion } = create(service);
  const b = service
    .snapshot()
    .workspaces.find((w) => w.title === "Engineering");
  const next = service
    .snapshot()
    .workspaces.find((w) => w.title === "Calibration");
  await c.zoomOut();
  await c.go({ kind: "universe" });
  await c.go({ kind: "workspace", workspaceId: b.id });
  c.move({ x: 450, y: 230, zoom: 1.3 });
  step(motion);
  const bookmark = c.camera;
  service.navigate({ kind: "workspace", workspaceId: next.id });
  c.update(service.snapshot());
  const length = c.state.history.length;
  c.update(service.snapshot());
  assert.equal(
    c.state.history.length,
    length,
    "ordinary snapshots do not duplicate history",
  );
  await c.back();
  step(motion);
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: b.id });
  assert.deepEqual(c.camera, bookmark);
  assert.equal(service.snapshot().activeWorkspaceId, b.id);
});

test("an unavailable previous workspace is not reintroduced into direct-switch history", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  const previous = c.location.workspaceId;
  const next = service.snapshot().workspaces.find((w) => w.id !== previous);
  service.navigate({ kind: "workspace", workspaceId: next.id });
  const snapshot = service.snapshot();
  snapshot.workspaces = snapshot.workspaces.filter((w) => w.id !== previous);
  c.update(snapshot);
  assert.equal(JSON.stringify(c.state.history).includes(previous), false);
  assert.deepEqual(c.location, { kind: "workspace", workspaceId: next.id });
});

test("direct opening survives placement removal without navigating or fabricating a replacement", async (t) => {
  const { service } = setup(t);
  const target = service
    .snapshot()
    .workspaces.find((w) => w.title === "Engineering");
  const block = service
    .snapshot()
    .blocks.find((b) => b.workspace_id === target.id);
  let opened = 0,
    navigated = 0,
    c;
  c = new ConstellationController({
    snapshot: service.snapshot(),
    motion: new MotionCoordinator(),
    navigate: async () => {
      navigated++;
    },
    openResource: async () => {
      opened++;
      const next = service.snapshot();
      c.update({ ...next, blocks: next.blocks.filter((b) => b.id !== block.id) });
    },
  });
  const before = c.location;
  await c.go({
    kind: "surface",
    workspaceId: target.id,
    resourceId: block.resource_id,
    blockId: block.id,
  });
  assert.equal(opened, 1);
  assert.equal(navigated, 0);
  assert.deepEqual(c.location, before);
  assert.equal(c.snapshot.blocks.some((b) => b.id === block.id), false);
  assert.ok(c.snapshot.resources.some((r) => r.id === block.resource_id));
  assert.equal(c.pending, false);
});

test("a saved surface explicitly restores as its workspace with bookmark and selection, without claiming an open editor", async (t) => {
  const { service } = setup(t),
    { c, motion } = create(service);
  const block = service
    .snapshot()
    .blocks.find((b) => b.workspace_id === c.location.workspaceId);
  c.select(`resource:${block.id}`);
  await c.go({
    kind: "surface",
    workspaceId: block.workspace_id,
    resourceId: block.resource_id,
    blockId: block.id,
  });
  c.move({ x: 570, y: 210, zoom: 1.7 });
  step(motion);
  await c.persist();
  service.save({
    ...structuredClone(c.state),
    location: {
      kind: "surface",
      workspaceId: block.workspace_id,
      resourceId: block.resource_id,
      blockId: block.id,
    },
  });
  let opened = 0;
  const restored = new ConstellationController({
    snapshot: service.snapshot(),
    motion: new MotionCoordinator(),
    navigate: async () => {},
    openResource: async () => {
      opened++;
    },
    persistence: {
      load: async () => service.load(),
      save: async (state) => service.save(state),
    },
  });
  await restored.restore();
  assert.deepEqual(restored.location, {
    kind: "workspace",
    workspaceId: block.workspace_id,
  });
  assert.deepEqual(restored.camera, c.camera);
  assert.equal(restored.selected, `resource:${block.id}`);
  assert.equal(opened, 0);
});

test("overlapping async navigation is serialized and the latest destination wins in the canonical service", async (t) => {
  const { service } = setup(t),
    motion = new MotionCoordinator();
  let release;
  const gate = new Promise((r) => (release = r));
  const seen = [];
  const c = new ConstellationController({
    snapshot: service.snapshot(),
    motion,
    navigate: async (d) => {
      seen.push(d);
      if (seen.length === 1) await gate;
      service.navigate(d);
    },
  });
  const ws = service.snapshot().workspaces;
  const one = c.go({ kind: "workspace", workspaceId: ws[1].id });
  await Promise.resolve();
  const two = c.go({ kind: "workspace", workspaceId: ws[2].id });
  release();
  await Promise.all([one, two]);
  assert.equal(service.snapshot().activeWorkspaceId, ws[2].id);
  assert.equal(c.location.workspaceId, ws[2].id);
  assert.equal(c.pending, false);
});

test("cancelled Back and History travel retain the history needed by newer navigation", async () => {
  for (const operation of ["back", "history"]) {
    const s = empty(), releases = [];
    let delayed = false;
    s.projects.push({ id: "p", title: "Synthetic project" });
    s.workspaces.push({ id: "w", title: "Synthetic workspace", project_id: "p" });
    s.navigation = { kind: "constellation", projectId: "p" };
    const c = new ConstellationController({
      snapshot: s,
      motion: new MotionCoordinator(),
      navigate: () => delayed
        ? new Promise((resolve) => releases.push(resolve)) : Promise.resolve(),
    });
    await c.go({ kind: "universe" });
    await c.go({ kind: "project", projectId: "p" });
    await c.go({ kind: "universe" });
    const history = structuredClone(c.state.history);
    delayed = true;
    const old = operation === "back" ? c.back() : c.returnHistory(1);
    await new Promise(setImmediate);
    const newer = c.go({ kind: "workspace", workspaceId: "w" });
    releases.shift()();
    await old;
    assert.deepEqual(c.state.history, history, operation);
    await new Promise(setImmediate);
    releases.shift()();
    await newer;
    assert.deepEqual(c.location, { kind: "workspace", workspaceId: "w" });
    assert.deepEqual(c.state.history.slice(0, -1), history, operation);
    c.dispose();
  }
});

test("History return cannot reintroduce destinations revoked during awaited navigation", async () => {
  const s = empty();
  let delayed = false, release;
  s.projects.push({ id: "p", title: "Synthetic current" }, { id: "gone", title: "Synthetic revoked" });
  s.navigation = { kind: "constellation", projectId: "p" };
  const c = new ConstellationController({
    snapshot: s,
    motion: new MotionCoordinator(),
    navigate: () => delayed
      ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(),
  });
  await c.go({ kind: "project", projectId: "gone" });
  await c.go({ kind: "universe" });
  await c.go({ kind: "project", projectId: "p" });
  delayed = true;
  const travel = c.returnHistory(2);
  await new Promise(setImmediate);
  c.update({ ...s, projects: s.projects.filter((p) => p.id !== "gone") });
  release();
  await travel;
  assert.deepEqual(c.location, { kind: "universe" });
  assert.deepEqual(c.state.history.map((h) => h.location), [{ kind: "project", projectId: "p" }]);
  assert.equal(JSON.stringify(c.state).includes('"gone"'), false);
  c.dispose();
});

test("failed service navigation preserves location/history; unavailable editor never changes canonical navigation", async (t) => {
  const { service } = setup(t),
    motion = new MotionCoordinator();
  let calls = 0;
  const c = new ConstellationController({
    snapshot: service.snapshot(),
    motion,
    navigate: async () => {
      calls++;
      throw Error("Service unavailable");
    },
  });
  const before = structuredClone(c.state);
  await assert.rejects(c.zoomOut(), /Service unavailable/);
  assert.deepEqual(c.state.location, before.location);
  assert.deepEqual(c.state.history, []);
  const block = service.snapshot().blocks[0];
  await assert.rejects(
    c.approach(`resource:${block.id}`),
    /editor is unavailable/,
  );
  assert.equal(calls, 1);
});

test("invalid camera and corrupt bookmark values are rejected; persistence failures remain visible", async (t) => {
  const { service } = setup(t),
    { c } = create(service);
  assert.throws(() => c.move({ x: 0, y: 0, zoom: NaN }), /Invalid camera/);
  assert.throws(() => c.zoom(0), /Invalid zoom/);
  service.save({
    ...c.state,
    bookmarks: {
      universe: { camera: { x: 0, y: 0, zoom: Infinity }, selected: "hidden" },
    },
  });
  const restored = create(service);
  await restored.c.restore();
  assert.ok(Number.isFinite(restored.c.camera.zoom));
  const broken = new ConstellationController({
    snapshot: service.snapshot(),
    motion: new MotionCoordinator(),
    navigate: async () => {},
    persistence: {
      load: async () => null,
      save: async () => {
        throw Error("disk full");
      },
    },
  });
  await broken.persist();
  assert.match(broken.error, /could not be saved/);
});

test("revoked saved anchors cannot reserve cells or affect visible layout", () => {
  const s = empty();
  s.projects.push(
    { id: "visible", title: "Visible" },
    { id: "hidden", title: "Hidden", visible: false },
  );
  const anchors = { "project:hidden": { x: -1500, y: -500 } };
  const nodes = project(s, anchors);
  assert.deepEqual(nodes.get("project:visible").point, { x: -1500, y: -500 });
});

test("screen-space labels never overlap at project and resource scales; selected resource remains reachable", async (t) => {
  const { service } = setup(t),
    { c, motion } = create(service);
  await c.zoomOut();
  for (const zoom of [0.5, 0.9, 1.5, 2, 3]) {
    c.move({ ...c.camera, zoom });
    step(motion);
    const nodes = c.visible(1440, 900);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j],
          aw = a.kind === "resource" ? 160 : 194,
          bw = b.kind === "resource" ? 160 : 194,
          ah = a.kind === "resource" ? 110 : 150,
          bh = b.kind === "resource" ? 110 : 150;
        assert.ok(
          Math.abs((a.point.x - b.point.x) * zoom) >= (aw + bw) / 2 + 12 ||
            Math.abs((a.point.y - b.point.y) * zoom) >= (ah + bh) / 2 + 12,
        );
      }
  }
  const n = [...c.nodes.values()].find((n) => n.kind === "resource");
  await c.locate(n.key);
  step(motion);
  assert.ok(c.visible(1440, 900).some((v) => v.key === n.key));
});
test("snapshot refresh cannot overwrite a saved pin while restore is reading", async () => {
  const snapshot = { ...empty(), projects: [{ id: "p", title: "Project" }] };
  const pin = { x: 25, y: 10, spatial: { x: 100, y: 50, z: -30 }, pinned: true };
  let saved = {
    schema: "aerynth.constellation@1", anchors: { "project:p": pin },
    bookmarks: {}, history: [], future: [], savedViews: [], location: { kind: "universe" },
  };
  let releaseRead;
  const reading = new Promise((resolve) => { releaseRead = resolve; });
  const writes = [];
  const c = new ConstellationController({
    snapshot, motion: new MotionCoordinator(), navigate: async () => snapshot,
    persistence: {
      load: async () => { await reading; return structuredClone(saved); },
      save: async (value) => { saved = value; writes.push(value); },
    },
  });
  const restore = c.restore();
  c.update(snapshot);
  const flush = c.persist();
  await new Promise((resolve) => setImmediate(resolve));
  const writesBeforeRead = writes.length;
  releaseRead();
  await Promise.all([restore, flush]);
  assert.equal(writesBeforeRead, 0);
  assert.deepEqual(c.state.anchors["project:p"], pin);
  await c.pin("project:p", { x: 80, y: 60 });
  assert.deepEqual(saved.anchors["project:p"], { x: 80, y: 60 });
  c.dispose();
});

test("failed restore protects the existing record and an empty successful retry permits writes", async () => {
  const snapshot = empty();
  const writes = [];
  let fail = true;
  const c = new ConstellationController({
    snapshot, motion: new MotionCoordinator(), navigate: async () => snapshot,
    persistence: {
      load: async () => { if (fail) throw Error("storage unavailable"); return null; },
      save: async (state) => { writes.push(state); },
    },
  });
  const restore = c.restore();
  c.update(snapshot);
  await Promise.all([restore, c.persist()]);
  assert.equal(writes.length, 0);
  assert.match(c.error, /could not be restored/);
  fail = false;
  await c.restore();
  await c.persist();
  assert.equal(writes.length, 1);
  c.dispose();
});
