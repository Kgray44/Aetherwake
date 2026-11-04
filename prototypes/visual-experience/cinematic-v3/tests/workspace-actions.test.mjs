import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockDocument } from "../../../block-library/tests/component-dom.mts";
import { until } from "../../../conversation-product/test/component-dom.mts";
import { MotionCoordinator } from "../src/motion.ts";
import { mountWorkspaceActions } from "../src/workspace-actions.ts";

const initial = () => ({
  contract: "aerynth.desktop@1",
  revision: 1,
  graphRevision: 1,
  projects: [],
  workspaces: [
    {
      id: "synthetic:workspace",
      title: "Synthetic workspace",
      project_id: null,
      version: 1,
    },
  ],
  resources: [
    {
      id: "synthetic:note",
      title: "Canonical note",
      kind: "note",
      version: 1,
      content: "Synthetic only",
      available: true,
    },
  ],
  blocks: [
    {
      id: "synthetic:block",
      resource_id: "synthetic:note",
      workspace_id: "synthetic:workspace",
      version: 1,
      x: 20,
      y: 30,
      width: 400,
      height: 250,
      z: 1,
      shape: "rectangle",
      subjectState: "active",
    },
  ],
  activeWorkspaceId: "synthetic:workspace",
  navigation: { kind: "workspace", workspaceId: "synthetic:workspace" },
  history: [],
  relationships: [],
  layoutVersion: 1,
  canUndo: false,
  canRedo: false,
  hasCheckpoint: false,
  viewport: { x: 0, y: 0, zoom: 1 },
  organization: {
    schemaVersion: 1,
    revision: 1,
    mode: "fluid",
    gap: 16,
    structured: {
      preset: "balanced",
      order: [],
      spans: {},
      rowHeight: 180,
      rowGap: 16,
      columnGap: 16,
      margin: 24,
    },
  },
  presence: {
    id: "system:vela",
    kind: "vela",
    workspaceId: "synthetic:workspace",
    version: 3,
    x: 700,
    y: 200,
    width: 200,
    height: 200,
    scale: 0.65,
    locked: false,
  },
});
function setup(extra = {}, snapshot = initial()) {
  const dom = blockDocument(),
    create = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const n = create(tag),
      values = n.style;
    values.setProperty = (key, value) => {
      values[key] = value;
    };
    values.getPropertyValue = (key) => values[key] ?? "";
    return n;
  };
  const restore = dom.install(),
    motion = new MotionCoordinator(),
    calls = [];
  motion.add("synthetic:external-body", {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    lift: 0,
    yaw: 0,
    opacity: 1,
  });
  let wakes = 0;
  const options = {
    snapshot,
    motion,
    wake: () => {
      wakes++;
    },
    act: async (action) => {
      calls.push(["act", action]);
    },
    changeMode: async (mode) => {
      calls.push(["mode", mode]);
    },
    locateBlock: async (id) => {
      calls.push(["block", id]);
    },
    locateVela: async () => {
      calls.push(["vela"]);
    },
    lockVela: async (value) => {
      calls.push(["lock", value]);
    },
    resources: async () => {
      calls.push(["resources"]);
    },
    constellation: async () => {
      calls.push(["constellation"]);
    },
    stream: async () => {
      calls.push(["stream"]);
    },
    connections: async () => {
      calls.push(["connections"]);
    },
    ...extra,
  };
  const view = mountWorkspaceActions(dom.root, options);
  const get = (action) => dom.root.querySelector(`[data-action="${action}"]`);
  const tick = (frames = 180) => {
    for (let i = 0; i < frames; i++) {
      motion.step(1 / 60);
      view.frame();
    }
  };
  return {
    dom,
    motion,
    calls,
    view,
    get,
    tick,
    snapshot,
    wakes: () => wakes,
    shell: dom.root.querySelector(".aw-workspace-actions"),
    cleanup() {
      view.dispose();
      restore();
    },
  };
}

test("mount/read/frame have no actions; compact capabilities reflect the canonical snapshot without mutation", () => {
  const snapshot = initial(),
    before = structuredClone(snapshot),
    f = setup({}, snapshot);
  try {
    f.tick();
    f.view.update(structuredClone(snapshot));
    assert.deepEqual(f.calls, []);
    assert.deepEqual(snapshot, before);
    assert.equal(f.shell.dataset.mode, "fluid");
    assert.equal(f.shell.dataset.state, "ready");
    assert.equal(f.get("mode-fluid").getAttribute("aria-pressed"), "true");
    assert.equal(f.get("undo").disabled, true);
    assert.equal(f.get("redo").disabled, true);
    assert.equal(f.get("restore").disabled, true);
    assert.equal(f.get("checkpoint").disabled, false);
    assert.equal(
      f.get("history-toggle").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(f.get("find-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(
      f.get("grid-toggle"),
      null,
      "unsupported advanced controls are not shown",
    );
    assert.equal(
      f.get("find-block"),
      null,
      "Find rows are created only on explicit disclosure",
    );
    const next = {
      ...structuredClone(snapshot),
      revision: 2,
      canUndo: true,
      canRedo: true,
      hasCheckpoint: true,
    };
    f.view.update(next);
    assert.equal(f.get("undo").disabled, false);
    assert.equal(f.get("redo").disabled, false);
    assert.equal(f.get("restore").disabled, false);
  } finally {
    f.cleanup();
  }
});

test("hover/focus/press/selected/disabled effects glide on the existing coordinator and never dispatch actions", () => {
  const f = setup();
  try {
    f.tick();
    const button = f.get("bring-all");
    button.fire("pointerenter");
    assert.equal(button.style["--wa-hover"], "0");
    f.tick(1);
    const hover = Number(button.style["--wa-hover"]);
    assert(hover > 0 && hover < 1);
    button.fire("focus");
    button.fire("pointerdown");
    f.tick(1);
    assert(Number(button.style["--wa-focus"]) > 0);
    assert(Number(button.style["--wa-pressed"]) > 0);
    button.fire("pointerleave");
    const value = Number(button.style["--wa-hover"]);
    assert(value > 0);
    f.tick();
    assert.equal(button.style["--wa-hover"], "0");
    assert.equal(button.style["--wa-pressed"], "0");
    const next = {
      ...structuredClone(f.snapshot),
      revision: 2,
      organization: {
        ...f.snapshot.organization,
        mode: "structured",
        revision: 2,
      },
    };
    const selected = f.get("mode-structured");
    assert.equal(selected.style["--wa-selected"], "0");
    f.view.update(next);
    assert.equal(selected.getAttribute("aria-pressed"), "true");
    assert.equal(selected.style["--wa-selected"], "0");
    f.tick(1);
    assert(Number(selected.style["--wa-selected"]) > 0);
    const undo = f.get("undo");
    f.view.update({ ...next, revision: 3, canUndo: true });
    assert.equal(undo.disabled, false);
    assert.equal(undo.style["--wa-disabled"], "1");
    f.tick(1);
    assert(Number(undo.style["--wa-disabled"]) < 1);
    assert.deepEqual(f.calls, []);
  } finally {
    f.cleanup();
  }
});

test("History/Find reverse continuously, close semantics immediately and retain real nodes until actual settle", () => {
  const f = setup();
  try {
    const toggle = f.get("find-toggle");
    toggle.fire("click");
    const body = f.dom.root
      .querySelectorAll(".aw-workspace-actions-disclosure")
      .find((n) => n.id === toggle.getAttribute("aria-controls"));
    assert.equal(body.hidden, false);
    assert.equal(body.inert, false);
    f.tick(8);
    const opacity = Number(body.style.opacity);
    assert(opacity > 0 && opacity < 1);
    const bodyKey = [...f.motion.bodies.keys()].find((k) =>
        k.endsWith("find-disclosure"),
      ),
      velocity = f.motion.bodies.get(bodyKey).channels.opacity.velocity;
    f.get("find-search").focus();
    toggle.fire("click");
    assert.equal(body.inert, true);
    assert.equal(body.getAttribute("aria-hidden"), "true");
    assert.equal(body.hidden, false);
    assert.equal(f.dom.doc.activeElement, toggle);
    assert.equal(Number(body.style.opacity), opacity);
    assert.equal(
      f.motion.bodies.get(bodyKey).channels.opacity.velocity,
      velocity,
    );
    toggle.fire("click");
    assert.equal(body.inert, false);
    assert.equal(Number(body.style.opacity), opacity);
    toggle.fire("click");
    f.tick();
    assert.equal(body.hidden, true);
    f.get("history-toggle").fire("click");
    const escape = f.shell.fire("keydown", { key: "Escape" });
    assert(escape.defaultPrevented && escape.stopped);
    assert.equal(
      f.get("history-toggle").getAttribute("aria-expanded"),
      "false",
    );
    f.motion.reduced = true;
    toggle.fire("click");
    assert.equal(body.style.opacity, "1");
    toggle.fire("click");
    assert.equal(body.hidden, true);
  } finally {
    f.cleanup();
  }
});

test("Find preserves search/editor/scroll/focus across refresh and only routes actual readable canonical IDs", async () => {
  const f = setup();
  try {
    f.get("find-toggle").fire("click");
    const search = f.get("find-search"),
      row = f.get("find-block"),
      list = f.dom.root.querySelector(".aw-wa-find-list");
    search.value = "Canonical";
    search.selectionStart = 2;
    search.selectionEnd = 5;
    search.focus();
    search.fire("input");
    list.scrollTop = 73;
    f.view.update({
      ...structuredClone(f.snapshot),
      revision: 2,
      resources: [
        { ...f.snapshot.resources[0], title: "Canonical note revised" },
      ],
    });
    assert.equal(f.get("find-search"), search);
    assert.equal(f.get("find-block"), row);
    assert.equal(search.value, "Canonical");
    assert.equal(search.selectionStart, 2);
    assert.equal(search.selectionEnd, 5);
    assert.equal(list.scrollTop, 73);
    assert.equal(f.dom.doc.activeElement, search);
    assert.equal(row.dataset.blockId, "synthetic:block");
    assert.equal(row.dataset.resourceId, "synthetic:note");
    row.fire("click");
    await until(() => f.calls.length === 1);
    assert.deepEqual(f.calls[0], ["block", "synthetic:block"]);
    f.view.update({
      ...structuredClone(f.snapshot),
      revision: 3,
      resources: [{ ...f.snapshot.resources[0], available: false }],
    });
    assert.equal(
      f.get("find-block"),
      null,
      "unavailable data has no fake disabled Find row",
    );
    f.get("find-vela").fire("click");
    await until(() => f.calls.length === 2);
    assert.deepEqual(f.calls[1], ["vela"]);
  } finally {
    f.cleanup();
  }
});

test("pending commands deduplicate locally, leave unrelated controls usable and ignore stale returned snapshots", async () => {
  let complete;
  const calls = [],
    pending = new Promise((resolve) => {
      complete = resolve;
    });
  const f = setup({
    act: async (action) => {
      calls.push(action);
      return pending;
    },
  });
  try {
    f.get("history-toggle").fire("click");
    const checkpoint = f.get("checkpoint");
    checkpoint.fire("click");
    checkpoint.fire("click");
    assert.deepEqual(calls, ["checkpoint"]);
    assert.equal(checkpoint.disabled, true);
    assert.equal(checkpoint.getAttribute("aria-busy"), "true");
    assert.equal(f.get("resources").disabled, false);
    f.get("resources").fire("click");
    await until(() => f.calls.length === 1);
    const next = {
      ...structuredClone(f.snapshot),
      revision: 4,
      graphRevision: 4,
      layoutVersion: 4,
      organization: {
        ...f.snapshot.organization,
        mode: "structured",
        revision: 3,
      },
    };
    f.view.update(next);
    assert.equal(checkpoint.disabled, true);
    complete(f.snapshot);
    await until(() => checkpoint.disabled === false);
    assert.equal(f.shell.dataset.mode, "structured");
    assert.equal(f.shell.dataset.state, "ready");
    assert.equal(f.get("checkpoint"), checkpoint);
  } finally {
    f.cleanup();
  }
});

test("named layouts save with the current revision and restore only a selected, reviewed layout", async () => {
  const initialState = initial();
  const workspaceId = initialState.activeWorkspaceId;
  const older = { id: "saved:older", name: "Older arrangement", createdAt: "2026-11-03T20:00:00Z" };
  const newer = { id: "saved:newer", name: "Current arrangement", createdAt: "2026-11-03T21:00:00Z" };
  initialState.savedLayouts = [older, newer];
  const calls = [];
  const f = setup({ namedLayouts: {
    save: async input => { calls.push(["save", input]); },
    restore: async input => { calls.push(["restore", input]); },
  } }, initialState);
  try {
    f.get("history-toggle").fire("click");
    const name = f.get("layout-name"), save = f.get("save-named-layout");
    const select = f.get("saved-layout-select"), review = f.get("review-named-layout"), restore = f.get("restore-named-layout");
    assert.equal(save.disabled, true);
    assert.equal(restore.hidden, true);
    name.value = "  Layout for review  ";
    name.fire("input");
    save.fire("click");
    await until(() => name.value === "");
    assert.deepEqual(calls[0], ["save", { workspaceId, expectedLayoutVersion: initialState.layoutVersion, name: "Layout for review" }]);
    select.value = older.id;
    select.fire("change");
    review.fire("click");
    assert.equal(restore.hidden, false);
    assert.match(f.shell.querySelector(".aw-wa-named-layouts").querySelector(".aw-wa-grid-notice").textContent, /Older arrangement/);
    const updated = { ...initialState, revision: initialState.revision + 1, layoutVersion: initialState.layoutVersion + 1 };
    f.view.update(updated);
    assert.equal(restore.hidden, true);
    restore.fire("click");
    assert.equal(calls.length, 1);
    review.fire("click");
    restore.fire("click");
    await until(() => restore.hidden);
    assert.deepEqual(calls[1], ["restore", { workspaceId, expectedLayoutVersion: updated.layoutVersion, checkpointId: older.id }]);
  } finally { f.cleanup(); }
});

test("mode and lock dispatch explicit current intent and the canonical expected presence version; failures persist across refresh", async () => {
  const f = setup({
    changeMode: async () => {
      throw Error("Synthetic layout conflict");
    },
  });
  try {
    const structured = f.get("mode-structured");
    structured.fire("click");
    await until(() => f.shell.dataset.state === "error");
    assert.equal(f.shell.dataset.mode, "fluid");
    f.view.update(structuredClone(f.snapshot));
    assert.equal(f.shell.dataset.state, "error");
    assert(
      f.dom.root
        .querySelector('[role="status"]')
        .textContent.includes("conflict"),
    );
    f.get("find-toggle").fire("click");
    f.get("lock-vela").fire("click");
    await until(() => f.calls.length === 1);
    assert.deepEqual(f.calls[0], [
      "lock",
      { expectedVersion: 3, locked: true },
    ]);
    assert.equal(
      f.get("lock-vela").getAttribute("aria-pressed"),
      "false",
      "no optimistic lock fabrication",
    );
    f.get("mode-fluid").focus();
    const event = f.get("mode-fluid").fire("keydown", { key: "ArrowRight" });
    assert(event.defaultPrevented);
    assert.equal(f.dom.doc.activeElement, f.get("mode-freeform"));
    assert.equal(
      f.calls.length,
      1,
      "arrow navigation alone never changes mode",
    );
  } finally {
    f.cleanup();
  }
});

test("Grid drafts bind a revision, retain fields on canonical conflict and require explicit reload before a new apply", async () => {
  const commits = [],
    previews = [];
  let cancels = 0;
  const f = setup({
    configureOrganization: async (input) => {
      commits.push(input);
      throw Error("organization_revision_conflict");
    },
    previewOrganization: (input) => previews.push(input),
    cancelOrganizationPreview: () => {
      cancels++;
    },
  });
  try {
    assert.equal(previews.length, 0);
    assert.equal(commits.length, 0);
    f.get("grid-toggle").fire("click");
    const field = f.dom.root.querySelector('[data-organization-field="gap"]'),
      form = f.dom.root.querySelector(".aw-wa-grid-form");
    field.value = "25";
    field.focus();
    field.fire("input");
    assert.equal(previews.at(-1).gap, 25);
    const newer = {
      ...structuredClone(f.snapshot),
      revision: 2,
      layoutVersion: 2,
      organization: { ...f.snapshot.organization, revision: 2, gap: 20 },
    };
    f.view.update(newer);
    assert.equal(field.value, "25");
    assert.equal(f.dom.doc.activeElement, field);
    assert.equal(f.get("grid-apply").disabled, true);
    assert.equal(f.get("grid-reload").hidden, false);
    form.fire("submit");
    assert.equal(commits.length, 0);
    f.get("grid-reload").fire("click");
    assert.equal(field.value, "20");
    field.value = "30";
    field.fire("input");
    form.fire("submit");
    await until(
      () => commits.length === 1 && f.shell.dataset.state === "error",
    );
    assert.equal(commits[0].expectedRevision, 2);
    assert.equal(commits[0].organization.gap, 30);
    assert.equal(commits[0].organization.structured.columnCount, null);
    assert.equal(field.value, "30");
    assert.equal(f.get("grid-apply").disabled, true);
    f.get("grid-toggle").fire("click");
    assert(cancels >= 2);
    f.get("grid-toggle").fire("click");
    assert.equal(
      field.value,
      "30",
      "closing/reopening does not silently discard or rebase conflicted edits",
    );
  } finally {
    f.cleanup();
  }
});

test("Selected optimization reviews only movable cards and requires a fresh preview after camera changes", async () => {
  const snapshot = initial();
  const block = snapshot.blocks[0];
  snapshot.blocks.push({ ...block, id: "synthetic:locked", locked: true });
  const previews = [], applies = [];
  let cancellations = 0;
  const f = setup({ optimization: {
    limit: 16,
    preview(ids) {
      const review = {
        workspaceId: snapshot.activeWorkspaceId, layoutRevision: 1,
        bounds: { x: 0, y: 0, width: 800, height: 400 },
        cards: ids.map(blockId => ({ blockId, from: { x: 20, y: 30 }, to: { x: 40, y: 50 } })),
        unresolvedPlacementIds: [],
      };
      previews.push(review);
      return review;
    },
    apply: async review => { applies.push(review); },
    cancel: () => { cancellations++; },
  } }, snapshot);
  try {
    f.get("optimize-toggle").fire("click");
    assert.equal(f.get("optimize-preview").disabled, true);
    assert.equal(f.dom.root.querySelector('[data-optimize-block="synthetic:locked"]'), null);
    const selected = f.dom.root.querySelector('[data-optimize-block="synthetic:block"]');
    selected.checked = true;
    selected.fire("change");
    f.get("optimize-preview").fire("click");
    assert.equal(previews.length, 1);
    assert.match(f.dom.root.querySelector('[data-optimize-review-block="synthetic:block"]').textContent, /20, 30.*40, 50/);
    assert.equal(f.get("optimize-apply").disabled, false);
    f.view.update({ ...snapshot, revision: 2, viewport: { ...snapshot.viewport, zoom: 0.9 } });
    assert.equal(cancellations, 1);
    assert.equal(f.get("optimize-apply").disabled, true);
    f.get("optimize-apply").fire("click");
    assert.equal(applies.length, 0);
    f.get("optimize-preview").fire("click");
    f.get("optimize-apply").fire("click");
    await until(() => applies.length === 1 && f.get("optimize-apply").hidden);
    assert.equal(applies[0], previews[1]);
  } finally { f.cleanup(); }
});

test("Grid completion preserves edits typed while awaiting the canonical commit and advances only its verified own revision", async () => {
  let complete;
  const commits = [],
    pending = new Promise((resolve) => {
      complete = resolve;
    });
  const f = setup({
    configureOrganization: async (input) => {
      commits.push(input);
      return pending;
    },
  });
  try {
    f.get("grid-toggle").fire("click");
    const gap = f.dom.root.querySelector('[data-organization-field="gap"]'),
      form = f.dom.root.querySelector(".aw-wa-grid-form");
    gap.value = "20";
    gap.fire("input");
    form.fire("submit");
    gap.value = "40";
    gap.fire("input");
    complete({
      ...structuredClone(f.snapshot),
      revision: 2,
      layoutVersion: 2,
      organization: { ...f.snapshot.organization, revision: 2, gap: 20 },
    });
    await until(() => f.get("grid-apply").disabled === false);
    assert.equal(gap.value, "40");
    form.fire("submit");
    await until(() => commits.length === 2);
    assert.equal(commits[1].expectedRevision, 2);
    assert.equal(commits[1].organization.gap, 40);
  } finally {
    f.cleanup();
  }
});

test("structured arrangements dispatch the exact released preset capability and never substitute an organization patch", async () => {
  const calls = [],
    previews = [],
    organization = [];
  const f = setup({
    configureOrganization: async (input) => {
      organization.push(input);
    },
    applyStructuredPreset: async (preset) => {
      calls.push(preset);
    },
    previewStructuredPreset: (preset) => previews.push(preset),
  });
  try {
    assert.deepEqual(calls, []);
    assert.deepEqual(previews, []);
    f.get("grid-toggle").fire("click");
    for (const preset of ["balanced", "focus", "development", "research"]) {
      const control = f.get("preset-" + preset);
      control.fire("click");
      await until(() => control.getAttribute("aria-busy") === "false");
    }
    assert.deepEqual(calls, ["balanced", "focus", "development", "research"]);
    assert.deepEqual(previews, calls);
    assert.deepEqual(organization, []);
    assert.equal(
      f.get("preset-research").getAttribute("aria-pressed"),
      "false",
      "completion alone never fabricates the observed current preset",
    );
    f.view.update({
      ...structuredClone(f.snapshot),
      revision: 2,
      layoutVersion: 2,
      organization: {
        ...f.snapshot.organization,
        mode: "structured",
        revision: 2,
        structured: {
          ...f.snapshot.organization.structured,
          preset: "research",
        },
      },
    });
    assert.equal(f.get("preset-research").getAttribute("aria-pressed"), "true");
  } finally {
    f.cleanup();
  }
});

test("absent workspace disables mutations truthfully; disposal cancels preview and retires only owned motion/listeners", async () => {
  const snapshot = initial();
  snapshot.workspaces = [];
  snapshot.activeWorkspaceId = null;
  snapshot.blocks = [];
  delete snapshot.organization;
  delete snapshot.presence;
  let complete,
    cancels = 0;
  const promise = new Promise((resolve) => {
    complete = resolve;
  });
  const f = setup(
    {
      resources: async () => promise,
      configureOrganization: async () => {},
      cancelOrganizationPreview: () => {
        cancels++;
      },
    },
    snapshot,
  );
  try {
    assert.equal(f.shell.dataset.state, "unavailable");
    assert.equal(f.get("mode-fluid").disabled, true);
    assert.equal(f.get("bring-all").disabled, true);
    assert.equal(f.get("find-vela").hidden, true);
    f.get("resources").fire("click");
    f.get("grid-toggle").fire("click");
    const before = f.wakes();
    f.view.dispose();
    complete();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.motion.bodies.size, 1);
    assert(f.motion.bodies.has("synthetic:external-body"));
    assert.equal(f.dom.root.children.length, 0);
    assert.equal(f.wakes(), before);
    assert.equal(
      cancels,
      0,
      "opening/disposing cannot cancel another surface's unowned preview",
    );
  } finally {
    f.cleanup();
  }
});

test("content module has no scheduler, CSS transition/animation, full-scene blur or independent shell", () => {
  const source = readFileSync(
      new URL("../src/workspace-actions.ts", import.meta.url),
      "utf8",
    ),
    css = readFileSync(
      new URL("../src/workspace-actions.css", import.meta.url),
      "utf8",
    );
  assert(
    !/requestAnimationFrame\s*\(|setTimeout\s*\(|setInterval\s*\(/.test(source),
  );
  assert(
    !/\b(?:transition|animation|backdrop-filter)\s*:|@keyframes/.test(css),
  );
  assert(
    !/:hover|\[aria-pressed=.*\].*\{/.test(css),
    "material cues are driven by shared coordinator values",
  );
});
