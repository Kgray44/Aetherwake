import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument, until } from "../../../conversation-product/test/component-dom.mts";
import { createVelaMissionView } from "../src/vela-missions.ts";

const scope = { workspaceId: "workspace-a", projectId: "project-a" };
const task = (id, executor, objective, dependencies = []) => ({
  id, executor, objective, dependencies, claims: [], criterion: id, timeoutMs: 5000,
  maxAttempts: 2, state: "queued", queuedAt: "2026-11-04T00:00:00Z", priority: 0, attempts: [],
});
const initial = () => ({
  id: "mission-a", contract: "aerynth.vela-mission@1", scope, disposition: "paused", outcome: "paused",
  objective: "Measure CPU and RAM", planRevision: 1, revision: 4, concurrency: 1, waits: {}, events: [],
  tasks: [task("cpu", "sample.cpu", "Sample CPU"), task("ram", "sample.ram", "Sample RAM"),
    task("report", "join.samples", "Join measured results", ["cpu", "ram"])],
});

async function fixture(handle) {
  const dom = componentDocument();
  const state = { projection: initial(), scope };
  const requests = [];
  const view = createVelaMissionView(dom.doc, async request => {
    requests.push(request);
    if (request.name === "list") return state.scope.workspaceId === scope.workspaceId ? [state.projection] : [];
    if (request.name === "read") return state.projection;
    return handle(request, state);
  });
  dom.root.append(view.element);
  const control = key => dom.root.querySelector(`[data-mission-focus="${key}"]`);
  view.setScope(scope);
  view.setVisible(true);
  await until(() => !!control("mission-a"));
  control("mission-a").fire("click");
  await until(() => !!control("cpu-revision"));
  return { dom, state, requests, view, control };
}

test("paused plan revision previews the exact change before applying and retains the old task", async () => {
  const f = await fixture(async (request, state) => {
    if (request.name === "revision-preview") return {
      kind: "revision-preview", missionId: state.projection.id, revision: state.projection.revision,
      fingerprint: "reviewed-fingerprint", summary: "Replace Sample CPU using its remaining attempt budget.",
    };
    assert.equal(request.name, "revision-apply");
    const [cpu, ram, report] = state.projection.tasks;
    state.projection = { ...state.projection, planRevision: 2, revision: 5, retiredTasks: [cpu],
      tasks: [{ ...cpu, id: "replacement" }, ram, { ...report, dependencies: ["replacement", "ram"] }] };
    return state.projection;
  });
  assert.equal(f.control("revision-apply"), null);
  f.control("cpu-revision-preview").fire("click");
  await until(() => !!f.control("revision-apply"));
  assert.deepEqual(f.requests.find(request => request.name === "revision-preview").input, {
    id: "mission-a", revision: 4, change: { type: "replace", taskId: "cpu" },
  });
  assert.equal(f.requests.some(request => request.name === "revision-apply"), false);
  assert.match(f.dom.root.textContent, /Replace Sample CPU using its remaining attempt budget/);
  f.control("revision-apply").fire("click");
  await until(() => !!f.dom.root.querySelector('[data-retired-mission-task="cpu"]'));
  assert.deepEqual(f.requests.find(request => request.name === "revision-apply").input, {
    id: "mission-a", revision: 4, change: { type: "replace", taskId: "cpu" }, fingerprint: "reviewed-fingerprint",
  });
  assert(f.dom.root.querySelector('[data-mission-task="replacement"]'));
  assert.equal(f.control("revision-apply"), null);
});

test("prerequisite picker avoids cycles and discards a pending review on workspace change", async () => {
  let resolve;
  const f = await fixture(async () => new Promise(done => { resolve = done; }));
  const change = f.control("cpu-revision-action");
  change.value = "dependencies";
  change.fire("change");
  assert.equal(f.control("cpu-revision-dependency-report"), null);
  const ram = f.control("cpu-revision-dependency-ram");
  ram.checked = true;
  ram.fire("change");
  f.control("cpu-revision-preview").fire("click");
  await until(() => !!resolve);
  assert.deepEqual(f.requests.find(request => request.name === "revision-preview").input.change,
    { type: "dependencies", taskId: "cpu", dependencies: ["ram"] });
  f.state.scope = { ...scope, workspaceId: "workspace-b" };
  f.view.setScope(f.state.scope);
  resolve({ kind: "revision-preview", missionId: "mission-a", revision: 4,
    fingerprint: "reviewed-fingerprint", summary: "This is a stale prior-workspace preview." });
  await until(() => !f.dom.root.querySelector(".vela-missions-body").getAttribute("aria-busy"));
  assert.equal(f.control("revision-apply"), null);
  assert.doesNotMatch(f.dom.root.textContent, /stale prior-workspace/);
});
