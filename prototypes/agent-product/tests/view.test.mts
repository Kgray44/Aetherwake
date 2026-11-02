import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { until } from "../../conversation-product/test/component-dom.mts";
import {
  canonicalFixture,
  cleanup,
  deferred,
  viewFixture,
} from "./view-fixture.mts";
import type {
  AgentLibraryClientPort,
  AgentMutationReceipt,
} from "../contracts.ts";
test.afterEach(cleanup);

test("empty library and real eight templates create a persistent independent canonical profile through UI events", async () => {
  const f = canonicalFixture(),
    view = viewFixture(f);
  await view.controller.refresh();
  assert.match(view.root.textContent, /first agent profile/);
  view.click("create");
  view.input("template", "researcher", "change");
  view.click("use-template");
  view.input("title", "Synthetic UI Researcher");
  view.submit();
  await until(() => !view.controller.hasUnsavedChanges());
  const list = f.service.list();
  assert.equal(list.items.length, 1);
  const id = list.items[0]!.resource.id,
    profile = f.service.inspect(id);
  assert.equal(profile.resource.projectId, null);
  assert.equal(
    profile.profile.purpose,
    "Investigate questions, compare evidence, and cite sources.",
  );
  assert.equal(f.db.prepare("SELECT count(*) n FROM notes").get()!.n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM blocks").get()!.n, 0);
  view.controller.dispose();
  f.restart();
  assert.deepEqual(f.service.inspect(id), profile);
});
test("profile edit saves canonical versions, archive confirmation and restore retain exact identity", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic Engineer"),
    view = viewFixture(f);
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic Engineer",
  );
  view.click("edit");
  view.input("title", "Synthetic Engineer revised");
  view.input("purpose", "Synthetic scoped implementation");
  view.submit();
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(f.service.inspect(a.agent.resourceId).ref.profileVersion, 2);
  view.click("review-archive");
  view.click("confirm-archive");
  await until(
    () =>
      f.service.list().items.length === 0 &&
      view.root.dataset.state !== "saving",
  );
  view.click("toggle-archived");
  await until(
    () =>
      !!view.root.querySelector(`[data-resource-id="${a.agent.resourceId}"]`),
  );
  view.select(a.agent.resourceId);
  assert.equal(view.action("restore").hidden, false);
  view.click("restore");
  await until(
    () =>
      f.service.list().items.length === 1 &&
      view.root.dataset.state !== "saving",
  );
  assert.equal(
    f.service.inspect(a.agent.resourceId).resource.title,
    "Synthetic Engineer revised",
  );
  assert.equal(f.service.inspect(a.agent.resourceId).ref.profileVersion, 4);
  view.controller.dispose();
});
test("refresh preserves actual input nodes, focus, caret, scroll and captured stale CAS draft until explicit reload", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic Draft"),
    view = viewFixture(f);
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic Draft",
  );
  view.click("edit");
  const input = view.input("purpose", "Unsaved local draft");
  input.focus();
  input.setSelectionRange(3, 8);
  input.scrollTop = 19;
  view.root.querySelector(".agent-list").scrollTop = 23;
  f.service.update({
    commandId: "external-update",
    agent: a.agent,
    title: "Synthetic external revision",
    profile: f.service.inspect(a.agent.resourceId).profile,
  });
  await view.controller.refresh();
  assert.equal(view.action("purpose"), input);
  assert.equal(input.value, "Unsaved local draft");
  assert.equal(view.doc.activeElement, input);
  assert.equal(input.selectionStart, 3);
  assert.equal(input.selectionEnd, 8);
  assert.equal(input.scrollTop, 19);
  assert.equal(view.root.querySelector(".agent-list").scrollTop, 23);
  assert.equal(view.action("save").disabled, true);
  view.submit();
  assert.equal(
    f.service.inspect(a.agent.resourceId).profile.purpose,
    "Investigate questions, compare evidence, and cite sources.",
  );
  view.click("reload");
  await until(
    () =>
      view.action("save").disabled === false &&
      view.root.querySelector("h3").textContent ===
        "Synthetic external revision",
  );
  view.controller.dispose();
});
test("unconfirmed create retries the exact original command once and preserves newer typed draft", async () => {
  const f = canonicalFixture();
  let first = true;
  const payloads: Parameters<AgentLibraryClientPort["create"]>[0][] = [];
  const view = viewFixture(f, {
    async create(input) {
      payloads.push(structuredClone(input));
      const result = f.service.create(input);
      if (first) {
        first = false;
        throw Error("synthetic lost acknowledgement");
      }
      return result;
    },
  });
  await view.controller.refresh();
  view.click("create");
  view.input("title", "Synthetic confirmed original");
  view.input("purpose", "Synthetic original purpose");
  view.submit();
  await until(() => view.action("retry").hidden === false);
  assert.equal(f.service.list().items.length, 1);
  view.input("title", "Newer unsaved name");
  view.click("retry");
  await until(
    () => view.action("retry").hidden && view.root.dataset.state !== "saving",
  );
  assert.deepEqual(payloads[1], payloads[0]);
  assert.equal(f.service.list().items.length, 1);
  assert.equal(view.action("title").value, "Newer unsaved name");
  assert.equal(view.controller.hasUnsavedChanges(), true);
  view.controller.dispose();
});
test("typing while an accepted save awaits acknowledgement retains draft and advances only its own confirmed CAS", async () => {
  const f = canonicalFixture(),
    gate = deferred<AgentMutationReceipt>();
  let accepted: AgentMutationReceipt | null = null;
  const view = viewFixture(f, {
    async create(input) {
      accepted = f.service.create(input);
      return gate.promise;
    },
  });
  await view.controller.refresh();
  view.click("create");
  view.input("title", "Synthetic first save");
  view.input("purpose", "Synthetic accepted body");
  view.submit();
  await until(() => accepted !== null);
  view.input("purpose", "Newer typing while pending");
  const input = view.action("purpose");
  input.focus();
  input.setSelectionRange(4, 9);
  gate.resolve(accepted!);
  await until(() => view.root.dataset.state !== "saving");
  assert.equal(view.action("purpose").value, "Newer typing while pending");
  assert.equal(input.selectionStart, 4);
  assert.equal(input.selectionEnd, 9);
  assert.equal(view.controller.hasUnsavedChanges(), true);
  view.submit();
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(
    f.service.inspect(accepted!.agent.resourceId).profile.purpose,
    "Newer typing while pending",
  );
  view.controller.dispose();
});
test("newer search response wins while slow superseded query cannot overwrite results or draft/search state", async () => {
  const f = canonicalFixture();
  f.create("Synthetic Alpha");
  f.create("Synthetic Beta");
  const slow = deferred<Awaited<ReturnType<AgentLibraryClientPort["list"]>>>();
  const view = viewFixture(f, {
    async list(input) {
      return input.query === "Alpha" ? slow.promise : f.service.list(input);
    },
  });
  await view.controller.refresh();
  view.input("search", "Alpha");
  view.input("search", "Beta");
  await until(() =>
    view.root.querySelector(".agent-list").textContent.includes("Beta"),
  );
  slow.resolve(f.service.list({ query: "Alpha" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.action("search").value, "Beta");
  assert(!view.root.querySelector(".agent-list").textContent.includes("Alpha"));
  view.controller.dispose();
});
test("dirty profile navigation is explicit, and unavailable catalog does not invent an agent runner or overwrite inherited settings", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic A"),
    b = f.create("Synthetic B"),
    view = viewFixture(f, {
      async catalog() {
        return null;
      },
    });
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic A",
  );
  view.click("edit");
  view.input("purpose", "Keep this draft");
  view.select(b.agent.resourceId);
  assert.equal(view.root.querySelector(".agent-draft-review").hidden, false);
  assert.equal(view.action("purpose").value, "Keep this draft");
  view.click("keep-draft");
  assert.equal(view.action("purpose").value, "Keep this draft");
  view.select(b.agent.resourceId);
  view.click("discard-draft");
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic B",
  );
  assert.equal(view.action("references-toggle").hidden, true);
  assert(!view.root.textContent.includes("Running"));
  assert(!view.action("start"));
  view.controller.dispose();
});
test("shared motion has intermediate reveal, interrupted retarget and immediate reduced state; disposal removes only own keys", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic Motion"),
    view = viewFixture(f);
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic Motion",
  );
  view.click("preferences-toggle");
  view.frame(0.04);
  const panel = view.root.querySelector(".agent-preferences");
  assert(Number(panel.style.opacity) > 0 && Number(panel.style.opacity) < 1);
  view.click("preferences-toggle");
  assert.equal(panel.inert, true);
  assert.equal(panel.hidden, false);
  assert(
    view.coordinator.receipts.some(
      (r) =>
        r.cause === "agent library disclosure" && r.status === "retargeted",
    ),
  );
  view.coordinator.reduced = true;
  view.click("preferences-toggle");
  assert.equal(Number(panel.style.opacity), 1);
  assert(Number.parseFloat(panel.style.height) > 0);
  view.controller.dispose();
  assert.deepEqual([...view.coordinator.bodies.keys()], ["unrelated-parent"]);
  assert(view.wakes > 0);
});

test("all preference controls fit the full shared-MC disclosure and remain reachable by the inspector alone", async () => {
  const f = canonicalFixture(),
    view = viewFixture(f);
  await view.controller.refresh();
  view.click("create");
  const panel = view.root.querySelector(".agent-preferences"),
    inner = view.root.querySelector(".agent-preferences-inner"),
    inspector = view.root.querySelector(".agent-inspector");
  // CPU layout/bounds fixture for the native defect: the fourth/fifth controls
  // lie below460px. These are explicit synthetic bounds, not browser evidence.
  let intrinsic = 1040.4;
  Object.defineProperty(inner, "scrollHeight", {
    configurable: true,
    get: () => Math.floor(intrinsic),
  });
  inner.getBoundingClientRect = () => ({ height: intrinsic });
  const lowerField = view.action("source-additionalInstructions"),
    lastField = view.action("source-requiredCapabilities");
  const top = 120,
    lowerTop = 680,
    lastTop = 930,
    controlHeight = 38;
  lowerField.getBoundingClientRect = () => ({
    top: top + lowerTop - inspector.scrollTop,
    bottom: top + lowerTop + controlHeight - inspector.scrollTop,
  });
  lastField.getBoundingClientRect = () => ({
    top: top + lastTop - inspector.scrollTop,
    bottom: top + lastTop + controlHeight - inspector.scrollTop,
  });
  inspector.clientHeight = 260;
  view.coordinator.reduced = true;
  view.click("preferences-toggle");
  view.frame();
  assert.equal(
    Number.parseFloat(panel.style.height),
    1041,
    "fractional intrinsic bottom must not be rounded down or capped",
  );
  assert(
    lastTop + controlHeight <= Number.parseFloat(panel.style.height),
    "last control lies inside the fully revealed wrapper",
  );
  for (const [field, offset] of [
    [lowerField, lowerTop],
    [lastField, lastTop],
  ] as const) {
    inspector.scrollTop = top + offset + controlHeight - inspector.clientHeight;
    const bounds = field.getBoundingClientRect();
    assert(
      bounds.top >= 0 && bounds.bottom <= inspector.clientHeight,
      "one outer inspector scroll exposes the whole control",
    );
  }
  intrinsic = 1490.75;
  view.frame();
  view.frame();
  assert.equal(
    Number.parseFloat(panel.style.height),
    1491,
    "content growth remains uncapped through the shared resize path",
  );
  view.coordinator.reduced = false;
  intrinsic = 1820.5;
  view.frame();
  view.frame(0.04);
  assert(
    Number.parseFloat(panel.style.height) > 1491 &&
      Number.parseFloat(panel.style.height) < 1821,
    "growth uses existing MC interpolation",
  );
  for (let i = 0; i < 80; i++) view.frame(0.04);
  assert.equal(Number.parseFloat(panel.style.height), 1821);
  const css = readFileSync(new URL("../view.css", import.meta.url), "utf8");
  assert.match(css, /\.agent-inspector\s*\{\s*overflow:\s*auto/);
  assert.match(
    css,
    /\.agent-preferences,\s*\.agent-references\s*\{[^}]*overflow:\s*clip/s,
  );
  view.controller.dispose();
});
test("all explicit controls participate in Root feedback and no component scheduler/CSS transition replaces shared motion", async () => {
  const f = canonicalFixture(),
    view = viewFixture(f);
  await view.controller.refresh();
  for (const node of view.root.querySelectorAll("button,input,select,textarea"))
    assert.equal(node.dataset.aerynthMotionControl, "true");
  const source = readFileSync(new URL("../view.ts", import.meta.url), "utf8"),
    css = readFileSync(new URL("../view.css", import.meta.url), "utf8");
  assert(
    !/requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|innerHTML/.test(
      source,
    ),
  );
  assert(!/\btransition\s*:|\banimation\s*:/.test(css));
  assert(!/from ['"]node:/.test(source));
  view.controller.dispose();
});

test("post-acknowledgement read failure never turns a confirmed creation into a second create command", async () => {
  const f = canonicalFixture();
  let readsFail = true,
    creates = 0;
  const commands: string[] = [];
  const view = viewFixture(f, {
    async create(input) {
      creates++;
      commands.push(input.commandId);
      return f.service.create(input);
    },
    async inspect(id) {
      if (readsFail) throw Error("agent_resource_unavailable");
      return f.service.inspect(id);
    },
  });
  await view.controller.refresh();
  view.click("create");
  view.input("title", "Synthetic acknowledged profile");
  view.input("purpose", "Synthetic persisted body");
  view.submit();
  await until(() => !view.action("retry").hidden);
  assert.match(
    view.root.querySelector(".agent-status").textContent,
    /Saved, but/,
  );
  view.submit();
  assert.equal(creates, 1);
  assert.equal(f.service.list().items.length, 1);
  view.click("retry");
  await until(() => view.root.dataset.state !== "saving");
  assert.equal(commands[1], commands[0]);
  assert.equal(f.service.list().items.length, 1);
  readsFail = false;
  view.click("retry");
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(new Set(commands).size, 1);
  view.controller.dispose();
});

test("selection wait hides previous actions, late inspector result cannot replace the latest canonical identity", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic previous"),
    b = f.create("Synthetic latest"),
    gate = deferred<ReturnType<typeof f.service.inspect>>();
  let delay = false;
  const view = viewFixture(f, {
    async inspect(id) {
      return delay && id === b.agent.resourceId
        ? gate.promise
        : f.service.inspect(id);
    },
  });
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic previous",
  );
  delay = true;
  view.select(b.agent.resourceId);
  assert.equal(view.root.dataset.mode, "loading");
  assert.throws(() => view.click("edit"), /unavailable/);
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic previous",
  );
  gate.resolve(f.service.inspect(b.agent.resourceId));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    view.root.querySelector(".agent-inspector").dataset.resourceId,
    a.agent.resourceId,
  );
  view.controller.dispose();
});

test("actual project choices and browser-like select values preserve override model IDs and inherited origin truthfully", async () => {
  const f = canonicalFixture(),
    project = f.kernel.createProject("Synthetic actual project"),
    configured = f.service.inspect(
      f.create("Synthetic configured").agent.resourceId,
    ).profile;
  configured.settings.providerId = {
    source: "override",
    value: "codex-app-server",
  };
  configured.settings.modelId = {
    source: "override",
    value: "synthetic-model",
  };
  configured.settings.additionalInstructions = {
    source: "override",
    value: "Old profile adjunct",
  };
  const a = f.create("Synthetic configured override", configured, project.id),
    view = viewFixture(f);
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () =>
      view.root.querySelector(".agent-availability").textContent ===
      "Catalog supported",
  );
  view.click("edit");
  view.click("preferences-toggle");
  assert.equal(view.action("project").value, project.id);
  assert.equal(view.action("setting-providerId").value, "codex-app-server");
  assert.equal(view.action("setting-modelId").value, "synthetic-model");
  view.input("source-additionalInstructions", "inherit", "change");
  assert.equal(view.action("setting-additionalInstructions").disabled, true);
  assert.equal(
    view.action("setting-additionalInstructions").value,
    "",
    "the old override is not misrepresented as an inherited value",
  );
  view.submit();
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(
    f.service.inspect(a.agent.resourceId).profile.settings
      .additionalInstructions.source,
    "inherit",
  );
  assert.equal(
    f.service.effective(f.service.inspect(a.agent.resourceId).ref).settings
      .additionalInstructions,
    "Synthetic user adjunct",
  );
  view.controller.dispose();
});

test("a real stale mutation is rejected by service CAS and preserves the draft without automatic rebasing", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic stale form"),
    view = viewFixture(f);
  await view.controller.refresh();
  view.select(a.agent.resourceId);
  await until(
    () => view.root.querySelector("h3").textContent === "Synthetic stale form",
  );
  view.click("edit");
  view.input("purpose", "Unsaved stale draft");
  f.service.update({
    commandId: "concurrent-before-submit",
    agent: a.agent,
    title: "Synthetic concurrent saved",
    profile: f.service.inspect(a.agent.resourceId).profile,
  });
  view.submit();
  await until(() => view.root.dataset.state === "stale");
  assert.equal(view.action("purpose").value, "Unsaved stale draft");
  assert.equal(view.action("save").disabled, true);
  assert.notEqual(
    f.service.inspect(a.agent.resourceId).profile.purpose,
    "Unsaved stale draft",
  );
  view.controller.dispose();
});

test("new profile project association uses an actual authorized canonical choice without creating a workspace", async () => {
  const f = canonicalFixture(),
    project = f.kernel.createProject("Synthetic creation project"),
    view = viewFixture(f);
  await view.controller.refresh();
  view.click("create");
  view.input("title", "Synthetic scoped UI agent");
  view.input("purpose", "Synthetic project specialist");
  view.input("project", project.id, "change");
  view.submit();
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(f.service.list().items[0]!.resource.projectId, project.id);
  assert.equal(f.db.prepare("SELECT count(*) n FROM workspaces").get()!.n, 0);
  view.controller.dispose();
});

test("direct canonical open works during initial refresh and outside current list/search without mutating the profile", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic direct profile");
  let reads = 0;
  const view = viewFixture(f, {
    async inspect(id) {
      reads++;
      return f.service.inspect(id);
    },
  });
  assert.equal(await view.controller.open(a.agent.resourceId), "opened");
  assert(reads >= 1);
  assert.equal(
    view.root.querySelector(".agent-inspector").dataset.resourceId,
    a.agent.resourceId,
  );
  view.input("search", "Does not match");
  await until(
    () => view.root.querySelector(".agent-list").children.length === 0,
  );
  const before = f.service.inspect(a.agent.resourceId);
  assert.equal(await view.controller.open(a.agent.resourceId), "opened");
  assert.equal(view.action("search").value, "Does not match");
  assert.deepEqual(f.service.inspect(a.agent.resourceId), before);
  view.controller.dispose();
});

test("direct open retains dirty draft until explicit discard and never uses a DOM click macro", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic guarded profile"),
    b = f.create("Synthetic target profile"),
    inspected: string[] = [];
  const view = viewFixture(f, {
    async inspect(id) {
      inspected.push(id);
      return f.service.inspect(id);
    },
  });
  await view.controller.open(a.agent.resourceId);
  view.click("edit");
  const input = view.input("purpose", "Keep exact guarded draft");
  input.focus();
  input.setSelectionRange(2, 7);
  assert.equal(await view.controller.open(b.agent.resourceId), "draft-review");
  assert(!inspected.includes(b.agent.resourceId));
  assert.equal(view.action("purpose").value, "Keep exact guarded draft");
  assert.equal(view.doc.activeElement, input);
  assert.equal(input.selectionStart, 2);
  view.click("keep-draft");
  assert.equal(view.controller.hasUnsavedChanges(), true);
  assert.equal(await view.controller.open(b.agent.resourceId), "draft-review");
  view.click("discard-draft");
  await until(
    () =>
      view.root.querySelector(".agent-inspector").dataset.resourceId ===
      b.agent.resourceId,
  );
  assert(inspected.includes(b.agent.resourceId));
  view.controller.dispose();
});

test("direct open preserves unconfirmed mutation retry intent and cannot reinterpret archive metadata as authorized opened content", async () => {
  const f = canonicalFixture(),
    target = f.create("Synthetic other profile");
  let first = true;
  const commands: string[] = [];
  const view = viewFixture(f, {
    async create(input) {
      commands.push(input.commandId);
      const receipt = f.service.create(input);
      if (first) {
        first = false;
        throw Error("synthetic lost reply");
      }
      return receipt;
    },
  });
  await view.controller.refresh();
  view.click("create");
  view.input("title", "Synthetic unconfirmed profile");
  view.input("purpose", "Synthetic unconfirmed draft");
  view.submit();
  await until(() => !view.action("retry").hidden);
  assert.equal(
    await view.controller.open(target.agent.resourceId),
    "draft-review",
  );
  view.click("keep-draft");
  assert.equal(view.action("retry").hidden, false);
  view.click("retry");
  await until(() => !view.controller.hasUnsavedChanges());
  assert.equal(commands[0], commands[1]);
  assert.equal(f.service.list().items.length, 2);
  const current = f.service.inspect(target.agent.resourceId);
  f.service.archive({
    commandId: "archive-direct-target",
    agent: current.ref,
    archived: true,
  });
  view.click("toggle-archived");
  await until(
    () =>
      !!view.root.querySelector(
        `[data-resource-id="${target.agent.resourceId}"]`,
      ),
  );
  assert.equal(
    await view.controller.open(target.agent.resourceId),
    "unavailable",
  );
  assert.match(
    view.root.querySelector(".agent-availability").textContent,
    /unavailable/,
  );
  view.controller.dispose();
});

test("direct-open result follows actual latest authorization, cancellation and disposal, never a retained previous profile", async () => {
  const f = canonicalFixture(),
    a = f.create("Synthetic delayed direct"),
    b = f.create("Synthetic newest direct"),
    gate = deferred<ReturnType<typeof f.service.inspect>>();
  const view = viewFixture(f, {
    async inspect(id) {
      return id === a.agent.resourceId ? gate.promise : f.service.inspect(id);
    },
  });
  const older = view.controller.open(a.agent.resourceId);
  assert.equal(await view.controller.open(b.agent.resourceId), "opened");
  gate.resolve(f.service.inspect(a.agent.resourceId));
  assert.equal(await older, "unavailable");
  assert.equal(
    view.root.querySelector(".agent-inspector").dataset.resourceId,
    b.agent.resourceId,
  );
  f.allow(false);
  assert.equal(await view.controller.open(b.agent.resourceId), "unavailable");
  f.allow(true);
  assert.equal(
    await view.controller.open("synthetic-missing-resource"),
    "unavailable",
  );
  view.controller.dispose();
  assert.equal(await view.controller.open(b.agent.resourceId), "unavailable");
});
