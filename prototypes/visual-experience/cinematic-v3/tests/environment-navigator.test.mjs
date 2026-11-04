import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountEnvironmentNavigator } from "../src/environment-navigator.ts";
import { MotionCoordinator } from "../src/motion.ts";
import {
  componentDocument,
  named,
  until,
} from "../../../conversation-product/test/component-dom.mts";

// Synthetic canonical port + CPU event/DOM adapter. No browser layout, native
// host, account, model, graphics, persistent dataset or acceptance claim.
const snapshot = () => ({
  contract: "aerynth.desktop@1",
  revision: 1,
  projects: [
    { id: "p-a", title: "Atlas", version: 2 },
    { id: "p-b", title: "Observatory", version: 4 },
  ],
  workspaces: [
    { id: "w-a", title: "Research", project_id: "p-a", version: 3 },
    { id: "w-b", title: "Writing", project_id: "p-a", version: 2 },
    { id: "w-c", title: "Signals", project_id: "p-b", version: 7 },
    { id: "w-i", title: "Untethered", project_id: null, version: 1 },
  ],
  archivedWorkspaces: [
    { id: "w-old", title: "Old research", project_id: "p-a", version: 9 },
  ],
  resources: [],
  blocks: [],
  relationships: [],
  navigation: { kind: "workspace", workspaceId: "w-a" },
  history: [],
  activeWorkspaceId: "w-a",
  layoutVersion: 1,
  canUndo: false,
  canRedo: false,
  hasCheckpoint: false,
});
function fixture(overrides = {}) {
  const dom = componentDocument(),
    base = dom.doc.createElement;
  dom.doc.createElement = (tag) => {
    const n = base(tag);
    n.style.setProperty = (k, v) => {
      n.style[k] = v;
    };
    n.click = () => n.fire("click");
    return n;
  };
  const calls = [],
    motion = new MotionCoordinator();
  let wakes = 0;
  const record = (name) => async (input) => {
    calls.push([name, input]);
  };
  const ports = {
    snapshot: snapshot(),
    motion,
    wake() {
      wakes++;
    },
    openWorkspace: record("openWorkspace"),
    openProject: record("openProject"),
    createProject: record("createProject"),
    createWorkspace: record("createWorkspace"),
    templates: record("templates"),
    askVela: record("askVela"),
    renameWorkspace: record("renameWorkspace"),
    archiveWorkspace: record("archiveWorkspace"),
    newConversation: record("newConversation"),
    resources: record("resources"),
    ...overrides,
  };
  const controller = mountEnvironmentNavigator(dom.root, ports),
    root = dom.root.querySelector(".en-navigator"),
    search = root.querySelector("input"),
    tree = root.querySelector(".en-tree");
  return {
    ...dom,
    root,
    tree,
    search,
    calls,
    motion,
    ports,
    controller,
    get wakes() {
      return wakes;
    },
    group(id) {
      return root.querySelector(`.en-group[data-project-id="${id}"]`);
    },
    row(id) {
      return root.querySelector(`.en-workspace-row[data-workspace-id="${id}"]`);
    },
    close() {
      controller.dispose();
    },
  };
}
const control = (f, label) => f.root.querySelector(`[aria-label="${label}"]`);
const action = (f, label) => {
  const n = named(f.root, label);
  assert(n, label);
  n.fire("click");
  return n;
};
const settleMotion = (f) => {
  for (let i = 0; i < 30; i++) {
    f.motion.step(0.1);
    f.controller.frame();
  }
};
const settled = async (f) => {
  await until(() => f.root.getAttribute("aria-busy") !== "true");
  settleMotion(f);
};

test("canonical projects contain their actual workspaces; independent is logical and current selection is explicit", () => {
  const f = fixture();
  try {
    assert.equal(f.group("p-a").querySelector(".en-count").textContent, "2");
    assert.equal(f.group("p-b").querySelector(".en-count").textContent, "1");
    assert.equal(f.row("w-a").closest(".en-group"), f.group("p-a"));
    assert.equal(f.row("w-c").closest(".en-group"), f.group("p-b"));
    assert.equal(f.row("w-i").closest(".en-group"), f.group(""));
    assert.equal(
      f
        .row("w-a")
        .querySelector(".en-workspace-name")
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(f.group("p-a").querySelector(".en-workspaces").hidden, false);
    assert.equal(f.group("p-b").querySelector(".en-workspaces").inert, true);
    const next = snapshot();
    next.navigation = { kind: "constellation", projectId: "p-b" };
    f.controller.update(next);
    assert.equal(
      f
        .group("p-b")
        .querySelector(".en-project-name")
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(f.row("w-a").querySelector(".en-current").hidden, true);
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});

test("metadata search filters projects and child counts and quick-switches the one exact canonical workspace", async () => {
  const f = fixture();
  try {
    f.search.value = "signals";
    f.search.fire("input");
    assert.equal(f.group("p-a"), null);
    assert.equal(f.group("p-b").querySelector(".en-count").textContent, "1");
    assert.equal(f.group("p-b").querySelector(".en-workspaces").hidden, false);
    f.search.fire("keydown", { key: "Enter" });
    await settled(f);
    assert.deepEqual(f.calls, [["openWorkspace", "w-c"]]);
    f.search.fire("keydown", { key: "Escape" });
    assert.equal(f.search.value, "");
    assert.equal(f.group("p-a").querySelector(".en-workspaces").hidden, false);
    assert.equal(f.group("p-b").querySelector(".en-workspaces").inert, true);
    settleMotion(f);
    assert.equal(f.group("p-b").querySelector(".en-workspaces").hidden, true);
    f.search.value = "Atlas";
    f.search.fire("input");
    assert.equal(f.group("p-a").querySelector(".en-count").textContent, "2");
    assert.equal(f.group("p-b"), null);
  } finally {
    f.close();
  }
});

test("tree arrows/Home/End/Space use visible hierarchy and project activation opens its canonical overview", async () => {
  const f = fixture();
  try {
    f.search.fire("keydown", { key: "ArrowDown" });
    const first = f.doc.activeElement;
    assert.equal(first.dataset.navKey, "project:p-a");
    first.fire("keydown", { key: "ArrowRight" });
    assert.equal(f.doc.activeElement.dataset.navKey, "workspace:w-a");
    f.doc.activeElement.fire("keydown", { key: "ArrowDown" });
    assert.equal(f.doc.activeElement.dataset.navKey, "workspace:w-b");
    f.doc.activeElement.fire("keydown", { key: "ArrowLeft" });
    assert.equal(f.doc.activeElement, first);
    first.fire("keydown", { key: " " });
    assert.equal(f.group("p-a").querySelector(".en-workspaces").hidden, true);
    first.fire("keydown", { key: "ArrowDown" });
    assert.equal(f.doc.activeElement.dataset.navKey, "project:p-b");
    f.doc.activeElement.fire("keydown", { key: "Home" });
    assert.equal(f.doc.activeElement, first);
    first.fire("click");
    await settled(f);
    assert.deepEqual(f.calls, [["openProject", "p-a"]]);
  } finally {
    f.close();
  }
});

test("keyed updates retain search, hierarchy focus, list scroll and exact unfinished create input/caret", () => {
  const f = fixture();
  try {
    action(f, "Project");
    const input = control(f, "Environment name");
    input.value = "Unfinished project";
    input.setSelectionRange(4, 9);
    input.focus();
    f.tree.scrollTop = 71;
    const row = f.row("w-a");
    const next = snapshot();
    next.revision++;
    next.workspaces[0].title = "Research revised";
    f.controller.update(next);
    assert.equal(control(f, "Environment name"), input);
    assert.equal(input.value, "Unfinished project");
    assert.equal(f.doc.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 9]);
    assert.equal(f.tree.scrollTop, 71);
    assert.equal(f.row("w-a"), row);
    assert.equal(row.querySelector(".en-name").textContent, "Research revised");
    assert.equal(f.calls.length, 0);
  } finally {
    f.close();
  }
});

test("New chat and Resources delegate directly without title/project ceremony or implicit provider action", async () => {
  const f = fixture();
  try {
    action(f, "New chat");
    await settled(f);
    action(f, "Resources");
    await settled(f);
    assert.deepEqual(f.calls, [
      ["newConversation", undefined],
      ["resources", undefined],
    ]);
    assert.equal(f.root.querySelector(".en-editor").hidden, true);
  } finally {
    f.close();
  }
});

test("Conversations remains a compact optional canonical library entry rather than an unavailable placeholder", async () => {
  const f = fixture({
    conversations: async () => {
      f.calls.push(["conversations"]);
    },
  });
  try {
    action(f, "Conversations");
    await settled(f);
    assert.deepEqual(f.calls, [["conversations"]]);
    assert.equal(control(f, "Environment name").value, "");
  } finally {
    f.close();
  }
  const absent = fixture();
  try {
    assert.equal(named(absent.root, "Conversations"), undefined);
  } finally {
    absent.close();
  }
});

test("workspace creation exposes blank/template/Vela progressively with the exact optional project", async () => {
  const f = fixture();
  try {
    action(f, "Workspace");
    const input = control(f, "Environment name"),
      project = control(f, "Workspace project");
    assert.equal(project.value, "p-a");
    assert.equal(f.calls.length, 0);
    action(f, "From template");
    await settled(f);
    project.value = "p-b";
    input.value = "  Signal analysis workspace  ";
    action(f, "Ask Vela");
    await settled(f);
    assert.deepEqual(f.calls, [
      ["templates", "p-a"],
      ["askVela", { projectId: "p-b", title: "Signal analysis workspace" }],
    ]);
    project.value = "";
    input.value = "A blank independent environment";
    f.root.querySelector("form").fire("submit");
    await settled(f);
    assert.deepEqual(f.calls.at(-1), [
      "createWorkspace",
      { title: input.value, projectId: null },
    ]);
    assert.equal(f.root.querySelector(".en-editor").hidden, true);
  } finally {
    f.close();
  }
});

test("More opens/closes actual scoped actions; a rename preserves the original CAS fence and failed text across updates", async () => {
  const f = fixture({
    renameWorkspace: async (input) => {
      f.calls.push(["renameWorkspace", input]);
      throw Error("workspace_version_conflict");
    },
  });
  try {
    const more = control(f, "More options for Research");
    more.fire("click");
    assert.equal(more.getAttribute("aria-expanded"), "true");
    assert.equal(f.root.querySelector(".en-workspace-actions").hidden, false);
    action(f, "Done");
    assert.equal(more.getAttribute("aria-expanded"), "false");
    more.fire("click");
    action(f, "Rename");
    const input = control(f, "Environment name");
    input.value = "My research";
    input.setSelectionRange(2, 5);
    const next = snapshot();
    next.workspaces[0].version = 8;
    f.controller.update(next);
    assert.equal(input.value, "My research");
    f.root.querySelector("form").fire("submit");
    await settled(f);
    assert.deepEqual(f.calls, [
      [
        "renameWorkspace",
        { id: "w-a", expectedVersion: 3, title: "My research" },
      ],
    ]);
    assert.equal(input.value, "My research");
    assert.equal(f.root.querySelector(".en-editor").hidden, false);
    assert.match(
      f.root.querySelector(".en-status").textContent,
      /workspace_version_conflict/,
    );
    assert.equal(f.root.querySelector(".en-status").dataset.state, "error");
  } finally {
    f.close();
  }
});

test("archive requires invoked review and restore uses the actual archived ID/version without copying resources", async () => {
  const f = fixture();
  try {
    control(f, "More options for Research").fire("click");
    action(f, "Archive…");
    assert.equal(f.calls.length, 0);
    assert.match(
      f.root.querySelector(".en-explanation").textContent,
      /retained/,
    );
    f.root.querySelector("form").fire("submit");
    await settled(f);
    assert.deepEqual(f.calls.at(-1), [
      "archiveWorkspace",
      { id: "w-a", expectedVersion: 3, archived: true },
    ]);
    control(f, "Restore Old research").fire("click");
    assert.equal(f.calls.length, 1);
    f.root.querySelector("form").fire("submit");
    await settled(f);
    assert.deepEqual(f.calls.at(-1), [
      "archiveWorkspace",
      { id: "w-old", expectedVersion: 9, archived: false },
    ]);
    assert.deepEqual(f.ports.snapshot.resources, []);
  } finally {
    f.close();
  }
});

test("unavailable metadata is removed; retained controls cannot open stale workspaces or create into a removed project", async () => {
  const f = fixture();
  try {
    const old = f.row("w-a").querySelector(".en-workspace-name");
    control(f, "More options for Research").fire("click");
    action(f, "Workspace");
    control(f, "Workspace project").value = "p-a";
    control(f, "Environment name").value = "Retain this local text";
    const next = snapshot();
    next.projects = next.projects.filter((p) => p.id !== "p-a");
    next.workspaces.push({
      id: "orphan",
      title: "Never relabel hidden project",
      project_id: "missing",
      version: 1,
    });
    f.controller.update(next);
    assert.equal(!!f.row("w-a"), false);
    assert.equal(!!f.row("orphan"), false);
    assert.equal(f.root.querySelector(".en-workspace-actions").hidden, true);
    f.root.querySelector("form").fire("submit");
    assert.equal(f.calls.length, 0);
    assert.match(
      f.root.querySelector(".en-status").textContent,
      /no longer available/,
    );
    old.fire("click");
    await settled(f);
    assert.equal(f.calls.length, 0);
    assert.equal(
      control(f, "Environment name").value,
      "Retain this local text",
    );
  } finally {
    f.close();
  }
});

test("in-flight updates retain later typing and disposal never cancels, replays or rebuilds a completed canonical mutation", async () => {
  let release;
  const f = fixture({
    createProject: async (title) => {
      f.calls.push(["createProject", title]);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  try {
    action(f, "Project");
    const input = control(f, "Environment name");
    input.value = "Submitted title";
    f.root.querySelector("form").fire("submit");
    await until(() => !!release);
    input.value = "Later unfinished title";
    input.setSelectionRange(3, 8);
    f.controller.update(snapshot());
    assert.equal(input.value, "Later unfinished title");
    release(snapshot());
    await settled(f);
    assert.equal(f.root.querySelector(".en-editor").hidden, false);
    assert.equal(input.value, "Later unfinished title");
    assert.deepEqual(f.calls, [["createProject", "Submitted title"]]);
    f.controller.dispose();
    assert.equal(f.motion.bodies.size, 0);
    f.controller.update(snapshot());
    f.controller.frame();
    assert.equal(f.root.parentElement, null);
  } finally {
    f.close();
  }
});

test("project rename exists only when a canonical capability is supplied and uses its captured version", async () => {
  const f = fixture({
    renameProject: async (input) => {
      f.calls.push(["renameProject", input]);
    },
  });
  try {
    control(f, "Rename project Atlas").fire("click");
    control(f, "Environment name").value = "Atlas II";
    f.root.querySelector("form").fire("submit");
    await settled(f);
    assert.deepEqual(f.calls, [
      ["renameProject", { id: "p-a", expectedVersion: 2, title: "Atlas II" }],
    ]);
  } finally {
    f.close();
  }
  const absent = fixture();
  try {
    assert.equal(control(absent, "Rename project Atlas"), null);
  } finally {
    absent.close();
  }
});

test("closing during a deferred canonical mutation detaches only presentation and catches eventual failure without replay", async () => {
  let reject;
  const f = fixture({
    createProject: async (title) => {
      f.calls.push(["createProject", title]);
      return new Promise((_resolve, no) => {
        reject = no;
      });
    },
  });
  action(f, "Project");
  control(f, "Environment name").value = "Exact submitted project";
  f.root.querySelector("form").fire("submit");
  await until(() => !!reject);
  f.controller.dispose();
  const wakes = f.wakes;
  reject(Error("synthetic late failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.motion.bodies.size, 0);
  assert.equal(f.root.parentElement, null);
  assert.equal(f.wakes, wakes);
  assert.deepEqual(f.calls, [["createProject", "Exact submitted project"]]);
});

test("group reveal uses only the supplied coordinator/frame; reduced motion snaps and interaction is never delayed", () => {
  const f = fixture();
  try {
    assert(f.motion.bodies.size > 3);
    f.motion.step(0.1);
    f.controller.frame();
    assert.notEqual(f.group("p-a").style["--en-reveal"], "0.000");
    assert.equal(f.row("w-a").querySelector("button").disabled, false);
    f.motion.reduced = true;
    control(f, "Expand Observatory").fire("click");
    f.controller.frame();
    assert.equal(f.group("p-b").style["--en-reveal"], "1.000");
    assert.equal(f.group("p-b").querySelector(".en-workspaces").hidden, false);
    assert(f.wakes > 0);
    const source = readFileSync(
        new URL("../src/environment-navigator.ts", import.meta.url),
        "utf8",
      ),
      css = readFileSync(
        new URL("../src/environment-navigator.css", import.meta.url),
        "utf8",
      );
    assert(!/requestAnimationFrame|setInterval|setTimeout/.test(source));
    assert(
      !/@keyframes|animation\s*:|transition\s*:|backdrop-filter/.test(css),
    );
  } finally {
    f.close();
  }
});

test("actual hover/focus/press/selection and contextual disclosures retarget the same motion engine without scheduling or delaying controls", () => {
  const f = fixture();
  try {
    const ws = f.row("w-a").querySelector(".en-workspace-name");
    ws.fire("pointerenter");
    f.motion.step(0.04);
    f.controller.frame();
    assert(Number(ws.style["--en-hover"]) > 0);
    assert(Number(ws.style["--en-selected"]) > 0);
    ws.fire("focus");
    ws.fire("pointerdown");
    f.motion.step(0.04);
    f.controller.frame();
    assert(Number(ws.style["--en-focus"]) > 0);
    assert(Number(ws.style["--en-pressed"]) > 0);
    ws.fire("pointerleave");
    ws.fire("blur");
    assert(f.motion.receipts.some((r) => r.status === "retargeted"));
    const create = f.root.querySelector(".en-create");
    create.querySelector("summary").fire("click");
    f.motion.step(0.08);
    f.controller.frame();
    assert(Number(f.root.style["--en-create-reveal"]) > 0);
    control(f, "More options for Research").fire("click");
    assert.equal(f.root.querySelector(".en-workspace-actions").hidden, false);
    f.motion.step(0.08);
    f.controller.frame();
    assert(Number(f.root.style["--en-actions-reveal"]) > 0);
    action(f, "Rename");
    f.motion.step(0.08);
    f.controller.frame();
    assert(Number(f.root.style["--en-editor-reveal"]) > 0);
    assert.equal(control(f, "Environment name").disabled, false);
    f.motion.reduced = true;
    action(f, "Cancel");
    f.controller.frame();
    assert.equal(f.root.style["--en-editor-reveal"], "0.000");
    f.search.value = "Signals";
    f.search.fire("input");
    f.search.value = "";
    f.search.fire("input");
    const returned = f.row("w-a").querySelector(".en-workspace-name");
    returned.fire("pointerenter");
    f.controller.frame();
    assert.equal(returned.style["--en-hover"], "1.000");
  } finally {
    f.close();
  }
});

test("details retain actual children/open through an interruptible closing glide, while accessibility closes immediately", () => {
  const f = fixture();
  try {
    const details = f.root.querySelector(".en-create"),
      summary = details.querySelector("summary"),
      children = f.root.querySelector(".en-create-choices");
    summary.fire("click");
    settleMotion(f);
    assert.equal(details.open, true);
    assert.equal(children.style.opacity, "1.000");
    summary.fire("click");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(children.inert, true);
    assert.equal(details.open, true);
    assert.equal(children.hidden, false);
    assert.equal(children.style.opacity, "1.000");
    f.motion.step(0.04);
    f.controller.frame();
    const halfway = Number(children.style.opacity);
    assert(halfway > 0 && halfway < 1);
    assert.equal(details.open, true);
    summary.fire("click");
    assert.equal(children.inert, false);
    assert.equal(Number(children.style.opacity), halfway);
    settleMotion(f);
    assert.equal(children.style.opacity, "1.000");
    summary.fire("click");
    settleMotion(f);
    assert.equal(details.open, false);
    assert.equal(children.hidden, true);
    const archive = f.root.querySelector(".en-archive"),
      archiveSummary = archive.querySelector("summary"),
      list = f.root.querySelector(".en-archive-list");
    archiveSummary.fire("click");
    settleMotion(f);
    archiveSummary.fire("click");
    assert.equal(archive.open, true);
    assert.equal(list.inert, true);
    assert.equal(list.hidden, false);
    settleMotion(f);
    assert.equal(archive.open, false);
    assert.equal(list.hidden, true);
  } finally {
    f.close();
  }
});

test("editor/action close retains painted descendants until MC0 and disabled material glides after immediate native denial", async () => {
  let resolve;
  const f = fixture({
    createProject: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  try {
    control(f, "More options for Research").fire("click");
    settleMotion(f);
    const actions = f.root.querySelector(".en-workspace-actions");
    action(f, "Done");
    assert.equal(actions.inert, true);
    assert.equal(actions.hidden, false);
    assert.equal(actions.style.opacity, "1.000");
    settleMotion(f);
    assert.equal(actions.hidden, true);
    action(f, "Project");
    settleMotion(f);
    const editor = f.root.querySelector(".en-editor"),
      input = control(f, "Environment name");
    input.value = "Retain this closing value";
    action(f, "Cancel");
    assert.equal(editor.inert, true);
    assert.equal(editor.hidden, false);
    assert.equal(input.value, "Retain this closing value");
    f.motion.step(0.04);
    f.controller.frame();
    assert(
      Number(editor.style.opacity) > 0 && Number(editor.style.opacity) < 1,
    );
    settleMotion(f);
    assert.equal(editor.hidden, true);
    action(f, "Project");
    input.value = "Exact pending project";
    f.root.querySelector("form").fire("submit");
    const chat = named(f.root, "New chat");
    assert.equal(chat.disabled, true);
    f.controller.frame();
    assert.equal(chat.style["--en-disabled"], "0.000");
    f.motion.step(0.04);
    f.controller.frame();
    assert(
      Number(chat.style["--en-disabled"]) > 0 &&
        Number(chat.style["--en-disabled"]) < 1,
    );
    resolve();
    await settled(f);
    assert.equal(chat.disabled, false);
    assert.equal(chat.style["--en-disabled"], "0.000");
    const css = readFileSync(
      new URL("../src/environment-navigator.css", import.meta.url),
      "utf8",
    );
    assert(!/:hover|\[data-current=|\[aria-current=/.test(css));
    assert(!/button:disabled\s*\{[^}]*opacity/.test(css));
  } finally {
    resolve?.();
    f.close();
  }
});
