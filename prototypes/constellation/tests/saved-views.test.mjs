import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { savedViewControls } from "../saved-view-controls.ts";

const fixture = () => ({
  projects: [
    { id: "p", title: "First" },
    { id: "q", title: "Second" },
  ],
  workspaces: [{ id: "w", title: "Workspace", project_id: "p" }],
  resources: [{ id: "r", title: "Note", kind: "note", project_id: "p" }],
  blocks: [
    {
      id: "b",
      resource_id: "r",
      workspace_id: "w",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: 0,
    },
  ],
  relationships: [],
  activeWorkspaceId: null,
  navigation: { kind: "constellation", projectId: "p" },
});
function setup(options = {}) {
  const motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot: fixture(),
      motion,
      navigate: async () => {},
      ...options,
    }),
    n = new SpatialNavigator(c, () => {});
  c.spatial = n;
  return { c, n, motion };
}
const settle = (m) => {
  for (let i = 0; i < 180; i++) m.step(1 / 60);
};

test("named views retain independent exact camera, selection, neighborhood and modes, with Back/Forward recovery", async () => {
  const { c, n, motion } = setup(),
    canonical = structuredClone(c.snapshot);
  c.select("resource:b");
  n.target({
    ...n.bookmark(),
    yaw: -0.7,
    pitch: 0.62,
    sensitivity: 0.6,
    mode: "pan",
    neighborhood: "resource:b",
  });
  c.move({ x: 143, y: -82, zoom: 0.8 });
  settle(motion);
  const id = await c.saveView("  Branch neighborhood  "),
    saved = structuredClone(c.state.savedViews[0]);
  assert.equal(saved.name, "Branch neighborhood");
  assert.match(id, /^view:/);
  n.neighborhood = undefined;
  n.presentation = "list";
  n.pan(130, 20);
  c.select("workspace:w");
  const other = await c.saveView("Workspace list");
  assert.notEqual(id, other);
  await c.go({ kind: "universe" });
  n.orbit(30, -15);
  settle(motion);
  const outer = n.camera;
  await c.returnView(id);
  settle(motion);
  assert.deepEqual(c.location, saved.location);
  assert.deepEqual(c.camera, saved.bookmark.camera);
  assert.deepEqual(n.camera, saved.bookmark.spatial);
  assert.equal(c.selected, saved.bookmark.selected);
  await c.back();
  settle(motion);
  assert.equal(c.location.kind, "universe");
  assert.deepEqual(n.camera, outer);
  await c.forward();
  settle(motion);
  assert.deepEqual(n.camera, saved.bookmark.spatial);
  assert.deepEqual(
    c.state.savedViews[0],
    saved,
    "automatic scope bookmarks cannot replace an explicit saved view",
  );
  assert.deepEqual(
    c.snapshot,
    canonical,
    "saving or returning to a view cannot edit resources or placements",
  );
  c.dispose();
});

test("saved views survive private persistence/restart and legacy profiles default to an empty list", async () => {
  let stored;
  const persistence = {
    load: async () => structuredClone(stored),
    save: async (value) => {
      stored = structuredClone(value);
    },
  };
  const first = setup({ persistence });
  first.n.orbit(60, -10);
  const id = await first.c.saveView("Project overview"),
    expected = structuredClone(stored.savedViews);
  first.n.pan(70, 25);
  await first.c.persist();
  first.c.dispose();
  const next = setup({ persistence });
  await next.c.restore();
  assert.deepEqual(next.c.state.savedViews, expected);
  await next.c.returnView(id);
  settle(next.motion);
  assert.deepEqual(next.n.camera, expected[0].bookmark.spatial);
  delete stored.savedViews;
  const legacy = setup({ persistence });
  await legacy.c.restore();
  assert.deepEqual(legacy.c.state.savedViews, []);
  next.c.dispose();
  legacy.c.dispose();
});

test("naming, duplicate prevention, rename/remove and the 32-view limit preserve existing views without navigation", async () => {
  const visits = [],
    { c } = setup({ navigate: async (target) => visits.push(target) });
  const id = await c.saveView("First view");
  for (const name of ["", "  ", "x".repeat(65), "line\nbreak", "FIRST VIEW"])
    await assert.rejects(c.saveView(name));
  await c.renameView(id, "Renamed");
  assert.equal(c.state.savedViews[0].id, id);
  assert.equal(c.state.savedViews[0].name, "Renamed");
  for (let i = 1; i < 32; i++) await c.saveView("View " + i);
  const before = structuredClone(c.state.savedViews);
  await assert.rejects(c.saveView("Overflow"), /32/);
  await assert.rejects(c.renameView(id, "VIEW 1"), /already exists/);
  assert.deepEqual(c.state.savedViews, before);
  await c.removeView(id);
  await assert.rejects(c.returnView(id), /unavailable/);
  await assert.rejects(c.renameView(id, "Missing"), /unavailable/);
  await c.saveView("Replacement");
  assert.equal(c.state.savedViews.length, 32);
  assert.deepEqual(visits, []);
  c.dispose();
});

test("restore bounds saved views, strips unknown fields and permission-prunes destinations and focus IDs", async () => {
  const { c, n } = setup();
  c.select("resource:b");
  n.neighborhood = "resource:b";
  await c.saveView("Kept");
  const base = structuredClone(c.state.savedViews[0]);
  await c.go({ kind: "project", projectId: "q" });
  await c.saveView("Revoked project");
  const raw = structuredClone(c.state),
    current = fixture();
  current.projects[1].visible = false;
  current.resources[0].visible = false;
  raw.savedViews.push(
    { ...base, extra: "private content must not be retained" },
    { ...base, id: "other", name: "KEPT" },
    {
      ...base,
      id: "bad-camera",
      name: "Invalid",
      bookmark: { camera: { zoom: 0, x: 0, y: 0 } },
    },
    { ...base, id: "bad-name", name: "x".repeat(65) },
  );
  const clean = setup({
    snapshot: current,
    persistence: { load: async () => raw, save: async () => {} },
  });
  await clean.c.restore();
  assert.equal(clean.c.state.savedViews.length, 1);
  const view = clean.c.state.savedViews[0];
  assert.equal(view.bookmark.selected, null);
  assert.equal(view.bookmark.spatial.neighborhood, undefined);
  assert.equal(JSON.stringify(view).includes("private content"), false);
  raw.savedViews = Array.from({ length: 50 }, (_, i) => ({
    ...base,
    id: "view-" + i,
    name: "View " + i,
  }));
  await clean.c.restore();
  assert.equal(clean.c.state.savedViews.length, 32);
  c.dispose();
  clean.c.dispose();
});

test("permission changes during awaited bookmark travel cannot restore stale selected or neighborhood IDs", async () => {
  let pause = false,
    release;
  const { c, n, motion } = setup({
    navigate: () =>
      pause
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(),
  });
  c.select("resource:b");
  n.neighborhood = "resource:b";
  const id = await c.saveView("Source neighborhood");
  await c.go({ kind: "universe" });
  pause = true;
  const travel = c.returnView(id);
  await new Promise(setImmediate);
  const changed = fixture();
  changed.resources[0].visible = false;
  c.update(changed);
  pause = false;
  release();
  await travel;
  settle(motion);
  assert.equal(c.selected, null);
  assert.equal(n.neighborhood, undefined);
  assert.equal(c.state.savedViews[0].bookmark.selected, null);
  assert.equal(c.state.savedViews[0].bookmark.spatial.neighborhood, undefined);
  assert.ok(c.state.history.every((h) => h.bookmark.selected !== "resource:b"));
  c.dispose();
});

test("failed or superseded saved-view travel retains stacks and newer manual input remains authoritative", async () => {
  let pause = false,
    fail = false,
    release;
  const { c, n, motion } = setup({
    navigate: () =>
      fail
        ? Promise.reject(Error("offline"))
        : pause
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(),
  });
  const id = await c.saveView("Project");
  await c.go({ kind: "universe" });
  const before = structuredClone(c.state);
  fail = true;
  await assert.rejects(c.returnView(id), /offline/);
  fail = false;
  assert.deepEqual(c.state.history, before.history);
  assert.deepEqual(c.state.future, before.future);
  pause = true;
  let travel = c.returnView(id);
  await new Promise(setImmediate);
  await assert.rejects(
    c.saveView("Ambiguous pending scope"),
    /Finish navigation/,
  );
  n.orbit(95, -20);
  n.pan(40, 12);
  const desired = n.bookmark();
  pause = false;
  release();
  await travel;
  settle(motion);
  assert.deepEqual(n.camera, desired);
  await c.go({ kind: "universe" });
  pause = true;
  travel = c.returnView(id);
  await new Promise(setImmediate);
  const newer = c.go({ kind: "project", projectId: "q" });
  pause = false;
  release();
  await Promise.all([travel, newer]);
  assert.deepEqual(c.location, { kind: "project", projectId: "q" });
  assert.deepEqual(c.state.savedViews, before.savedViews);
  c.dispose();
});

test("save failures retain session views, remain visible and clear only after a successful retry", async () => {
  let fail = true,
    saved;
  const { c } = setup({
    persistence: {
      load: async () => null,
      save: async (value) => {
        if (fail) throw Error("disk unavailable");
        saved = value;
      },
    },
  });
  const id = await c.saveView("Retained locally");
  assert.match(c.error, /could not be saved/);
  assert.equal(c.state.savedViews[0].id, id);
  fail = false;
  await c.persist();
  assert.equal(c.error, "");
  assert.equal(saved.savedViews[0].id, id);
  c.error = "Navigation unavailable";
  await c.persist();
  assert.equal(
    c.error,
    "Navigation unavailable",
    "saving cannot erase a different error",
  );
  c.dispose();
});

class Element {
  constructor(tag, text = "") {
    this.tag = tag;
    this.textContent = text;
    this.children = [];
    this.value = "";
    this.listeners = new Map();
    this.attributes = {};
    this.open = false;
    this.disabled = false;
    this.isConnected = true;
  }
  append(...children) {
    this.children.push(...children);
    if (this.tag === "select" && !this.value)
      this.value = children[0]?.value ?? "";
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }
  querySelector(tag) {
    return all(this).find((e) => e.tag === tag) ?? null;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.listeners.get("close")?.();
  }
  getClientRects() {
    return [{}];
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  select() {}
  reportValidity() {
    return true;
  }
  remove() {
    this.isConnected = false;
  }
}
const all = (e) => [e, ...e.children.flatMap(all)];

test("the actual compact form saves, restores, renames and removes private views without graph mutations", async (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    activeElement: new Element("button"),
    createElement: (tag) => new Element(tag),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const actions = [],
    { c, n, motion } = setup({
      graphAction: async (action) => {
        actions.push(action);
        return fixture();
      },
    }),
    root = new Element("div"),
    ui = savedViewControls(root, c, () => {}),
    dialog = root.children[0];
  n.orbit(50, -15);
  settle(motion);
  ui.save();
  assert.equal(all(dialog).filter((e) => e.tag === "button").length, 2);
  all(dialog).find((e) => e.tag === "input").value = "Original project";
  await all(dialog)
    .find((e) => e.tag === "form")
    .onsubmit({ preventDefault() {} });
  assert.equal(dialog.open, false);
  assert.equal(c.state.savedViews.length, 1);
  const expected = structuredClone(c.state.savedViews[0]);
  await c.go({ kind: "universe" });
  ui.open();
  assert.equal(all(dialog).filter((e) => e.tag === "button").length, 4);
  await all(dialog)
    .find((e) => e.textContent === "Open view")
    .onclick();
  settle(motion);
  assert.equal(dialog.open, false);
  assert.deepEqual(n.camera, expected.bookmark.spatial);
  ui.open();
  await all(dialog)
    .find((e) => e.textContent === "Rename")
    .onclick();
  all(dialog).find((e) => e.tag === "input").value = "<b>Literal view name</b>";
  await all(dialog)
    .find((e) => e.tag === "form")
    .onsubmit({ preventDefault() {} });
  assert.equal(
    all(dialog).find((e) => e.tag === "option").textContent,
    "<b>Literal view name</b>",
  );
  await all(dialog)
    .find((e) => e.textContent === "Remove view")
    .onclick();
  assert.equal(c.state.savedViews.length, 0);
  assert.deepEqual(actions, []);
  await c.saveView("Revoked private viewpoint");
  ui.open();
  await all(dialog)
    .find((e) => e.textContent === "Rename")
    .onclick();
  const revoked = fixture();
  revoked.projects[0].visible = false;
  c.update(revoked);
  assert.equal(
    all(dialog).some((e) => e.tag === "input"),
    false,
    "revocation also clears a stale open rename form",
  );
  assert.equal(c.state.savedViews.length, 0);
  ui.dispose();
  c.dispose();
});
