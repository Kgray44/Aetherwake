import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument, until } from "../../../conversation-product/test/component-dom.mts";
import { createVelaMissionView, missionTaskControls } from "../src/vela-missions.ts";

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

test('API specialist controls preserve nonreplayable attempts', () => {
  const mission = initial();
  const worker = { ...task('api-worker', 'api.specialist', 'Assess supplied evidence'), state: 'failed' };
  assert.equal(missionTaskControls(mission, worker).retry, false);
  assert.equal(missionTaskControls(mission, { ...worker, state: 'queued' }).cancel, true);
  assert.equal(missionTaskControls(mission, { ...worker, executor: 'sample.cpu' }).retry, true);
});

async function fixture(handle, askCheckpoint) {
  const dom = componentDocument();
  const state = { projection: initial(), scope };
  const requests = [];
  const view = createVelaMissionView(dom.doc, async request => {
    requests.push(request);
    if (request.name === "list") return state.scope.workspaceId === scope.workspaceId ? [state.projection] : [];
    if (request.name === "read") return state.projection;
    return handle(request, state);
  }, undefined, askCheckpoint);
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

test("Executive proposal enters the existing revision review and waits for explicit apply", async () => {
  const f = await fixture(async request => {
    assert.equal(request.name, "executive-review");
    return { kind: "executive-result", result: {
      state: "reviewable", reason: "Retain the verified CPU sample.",
      change: { type: "replace", taskId: "ram" },
      preview: { kind: "revision-preview", missionId: "mission-a", revision: 4,
        fingerprint: "reviewed-executive-change", summary: "Replace the failed RAM sample." },
    } };
  });
  try {
    f.state.projection.tasks[1].state = "failed";
    f.state.projection.events = [{ seq: 3, kind: "settled", taskId: "ram" }];
    f.view.openReport("mission-a");
    await until(() => !!f.control("executive-review"));
    f.control("executive-review").fire("click");
    await until(() => !!f.control("revision-apply"));
    assert.deepEqual(f.requests.find(request => request.name === "executive-review").input,
      { id: "mission-a", revision: 4, triggerSeq: 3 });
    assert.match(f.dom.root.textContent, /Retain the verified CPU sample/);
    assert.equal(f.requests.some(request => request.name === "revision-apply"), false);
  } finally { f.view.setVisible(false); }
});

test("a checkpoint question passes the exact active mission revision to native review", async () => {
  const asked = [];
  const f = await fixture(() => assert.fail("the question must not invoke a mission control"),
    async (intent, checkpoint) => { asked.push({ intent, checkpoint }); });
  try {
    assert.equal(f.dom.root.querySelector("[data-mission-checkpoint-question]"), null);
    f.state.projection.events = [{ seq: 3, kind: "settled", taskId: "ram" }];
    f.view.openReport("mission-a");
    const form = () => f.dom.root.querySelector("[data-mission-checkpoint-question]");
    await until(() => !!form());
    form().querySelector("input").value = "Which check is still unverified?";
    form().fire("submit");
    await until(() => f.dom.root.textContent.includes("The answer is in Vela chat."));
    assert.deepEqual(asked, [{ intent: "Which check is still unverified?", checkpoint: { id: "mission-a", revision: 4, triggerSeq: 3 } }]);
  } finally { f.view.setVisible(false); }
});

test("partial investigation preview discloses missing server evidence before Start and names the dedicated API planning route", async () => {
  const f=await fixture(async()=>{assert.fail('preview must not dispatch');});
  try{
    const offer={kind:'planning-offer',scope,objective:'Can you investigate why the Minecraft server is lagging?',fingerprint:'offer',
      planner:{provider:'openai-api-vela',model:'gpt-6-luna',effort:'low',capabilities:['CPU and RAM']}};
    f.view.review(offer,()=>{});assert.match(f.dom.root.textContent,/Vela’s dedicated API/);assert.equal(f.requests.some(request=>request.name==='plan'),false);
    f.view.review({fingerprint:'plan',plan:{...initial(),coverage:{status:'partial',limitations:['Minecraft server logs and TPS are unavailable.']}},executors:[]},()=>{});
    assert.match(f.dom.root.textContent,/Partial investigation.*Minecraft server logs and TPS.*original objective will remain blocked/su);
    assert.equal(f.requests.some(request=>request.name==='start'),false);
  }finally{f.view.setVisible(false);}
});

test("illustration preview discloses a billable image request and managed workspace writes before Start", async () => {
  const f = await fixture(() => assert.fail("preview must not dispatch"));
  try {
    const illustration = task("illustration", "artifact.illustration", "Generate and verify workspace illustration files");
    f.view.review({
      fingerprint: "artifact-plan",
      plan: { ...initial(), objective: "Generate an illustration", tasks: [illustration] },
      executors: [{ id: illustration.id, available: true }],
      artifactReview: {
        prompt: "Illustrate a sailboat",
        digest: "artifact-digest",
        model: "gpt-image-2.6-sunburst",
        quality: "medium",
        rates: { textInput: 5, imageInput: 8, imageOutput: 30 },
        width: 1024,
        height: 1024,
        files: ["illustration.png", "illustration-notes.txt"],
      },
    }, () => {});
    const preview = f.dom.root.textContent;
    assert.match(preview, /native review for one billable image request to OpenAI using gpt-image-2\.6-sunburst at medium quality/);
    assert.match(preview, /1024 × 1024 PNG/);
    assert.match(preview, /managed workspace files illustration\.png and illustration-notes\.txt/);
    assert.doesNotMatch(preview, /Local read-only tasks/);
    assert.equal(f.requests.some(request => request.name === "start"), false);

    f.view.review({ fingerprint: "local-plan", plan: initial(), executors: [] }, () => {});
    assert.match(f.dom.root.textContent, /Local read-only tasks/);
  } finally { f.view.setVisible(false); }
});

test("mixed mission preview discloses the image, specialist calls, and local review together", async () => {
  const f = await fixture(() => assert.fail("preview must not dispatch"));
  try {
    f.view.review({
      fingerprint: "mixed-plan",
      plan: initial(),
      executors: [],
      localReview: { kind: "node-test", maxFiles: 4 },
      externalReview: { provider: "Vela dedicated API", calls: 2, model: "gpt-6.1-sol", effort: "high" },
      artifactReview: {
        prompt: "Illustrate a sailboat", digest: "artifact-digest", model: "gpt-image-2.6-sunburst", quality: "medium",
        width: 1024, height: 1024, files: ["illustration.png", "illustration-notes.txt"],
      },
    }, () => {});
    const preview = f.dom.root.textContent;
    assert.match(preview, /one billable image request/);
    assert.match(preview, /2 separate requests to Vela dedicated API/);
    assert.match(preview, /tracked Node tests/);
  } finally { f.view.setVisible(false); }
});

test("completed host evidence keeps the investigation blocked and offers an attributable partial report", async () => {
  const f=await fixture(async request=>{assert.equal(request.name,'post-report');return {kind:'mission-report',missionId:'mission-a',messageId:'partial-report'};});
  try{
    f.state.projection={...initial(),disposition:'active',outcome:'blocked',coverage:{status:'partial',limitations:['Server logs and network traces are unavailable.']},
      tasks:initial().tasks.map(task=>({...task,state:'verified'}))};
    f.view.openReport('mission-a');await until(()=>/Investigation incomplete/.test(f.dom.root.textContent));
    assert.match(f.dom.root.textContent,/Server logs and network traces are unavailable/);assert.ok(f.control('post-report'));
    f.control('post-report').fire('click');await until(()=>f.requests.some(request=>request.name==='post-report'));
    assert.equal(f.state.projection.outcome,'blocked');assert.equal(f.requests.some(request=>request.name==='start'),false);
  }finally{f.view.setVisible(false);}
});


const sourceReceiptCandidate = () => ({
  ...task("cpu", "inspect.backend-source", "Inspect shipped source"), state: "uncertain", maxAttempts: 1,
  attempts: [{ id: "original-source", backendInspection: { contract: "aerynth.backend-inspection-terminal@1",
    missionId: "mission-a", taskId: "cpu", attemptId: "original-source" } }],
});

test("original source receipt offers recovery despite uncertainty and exhausted attempts, without granting execution", () => {
  const mission = { ...initial(), outcome: "uncertain", disposition: "active" }, worker = sourceReceiptCandidate();
  assert.equal(missionTaskControls(mission, worker).retry, true);
  assert.equal(missionTaskControls(mission, worker).reconcile, true);
  assert.equal(worker.state, "uncertain");
  assert.equal(worker.attempts.length, 1);
  assert.equal(missionTaskControls(mission, { ...worker, state: "failed" }).reconcile, true);
  assert.equal(missionTaskControls({ ...mission, disposition: "cancelled" }, worker).retry, false);
  assert.equal(missionTaskControls(mission, { ...worker, state: "running" }).retry, false);
  for (const executor of ["api.specialist", "chatgpt.specialist", "sample.cpu"]) {
    assert.equal(missionTaskControls(mission, { ...worker, executor }).reconcile, false);
    assert.equal(missionTaskControls(mission, { ...worker, executor }).retry, false);
  }
  for (const field of ["missionId", "taskId", "attemptId", "contract"]) {
    const invalid = structuredClone(worker);
    invalid.attempts[0].backendInspection[field] = "unrelated";
    assert.equal(missionTaskControls(mission, invalid).reconcile, false);
    assert.equal(missionTaskControls(mission, invalid).retry, false);
  }
  const missing = structuredClone(worker); delete missing.attempts[0].backendInspection;
  assert.equal(missionTaskControls(mission, missing).retry, false);
});

test("the existing control labels source readback and sends the same backend-validated Retry request", async () => {
  const f = await fixture(async (request, state) => {
    assert.equal(request.name, "control");
    assert.deepEqual(request.input.control, { type: "retry", taskId: "cpu" });
    state.projection = { ...state.projection, revision: state.projection.revision + 1, outcome: "verified",
      tasks: [{ ...state.projection.tasks[0], state: "verified" }] };
    return state.projection;
  });
  try {
    // The shared CPU-only DOM omits this standard browser property; supply it only for this fixture.
    Object.defineProperty(Object.getPrototypeOf(f.dom.root), "childElementCount", {
      get() { return this.children.filter(child => child.tagName !== "#TEXT").length; },
    });
    f.state.projection = { ...f.state.projection, outcome: "uncertain", disposition: "active", tasks: [sourceReceiptCandidate()] };
    f.view.observe();
    await until(() => f.control("cpu-retry")?.textContent === "Recover original result");
    f.control("cpu-retry").fire("click");
    await until(() => f.requests.some(request => request.name === "control"));
    assert.equal(f.requests.filter(request => request.name === "control").length, 1);
    assert.equal(f.requests.some(request => request.name === "start"), false);
  } finally { f.view.setVisible(false); }
});
