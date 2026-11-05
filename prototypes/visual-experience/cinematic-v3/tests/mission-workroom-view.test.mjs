import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument } from "../../../conversation-product/test/component-dom.mts";
import { mountMissionWorkroomView } from "../src/mission-workroom-view.ts";

const binding = (dashboard, revision = 1) => ({
  kind: "workroom-resource", missionId: "mission-a", outcome: "running", revision, dashboard,
});

test("an individual specialist card separates assignment, observed attempts and provider-reported outcomes", async () => {
  const { root, doc } = componentDocument(), profiles = [];
  let revision = 1;
  let assignment = { kind: "agent", taskId: "review", title: "Review the selected evidence", role: "Evidence reviewer",
    responsibility: "Inspect the scoped report", state: "queued", executor: "chatgpt.specialist",
    provider: "chatgpt-plan-responses", model: "fixture-model", criterion: "review-report", dependencies: [],
    maxAttempts: 2, timeoutMs: 15000, webSearch: false, wait: "capacity",
    profile: { id: "profile-review", title: "Saved reviewer", profileVersion: 3, resourceVersion: 2 }, attempts: [] };
  const view = mountMissionWorkroomView(root, "dashboard", "room", async () => binding(assignment, revision), undefined,
    () => {}, id => profiles.push(id));
  try {
    await view.refresh();
    assert.equal(root.querySelector('[data-mission-workroom-card="agent"]').getAttribute("aria-label"), "Specialist assignment");
    const row = () => root.querySelector('[data-mission-agent-task="review"]');
    assert.match(row().textContent, /Evidence reviewer.*Waiting for a worker.*Assigned · execution has not started/);
    assert.match(row().textContent, /No hosted tools permitted.*assigned profile v3/);
    assert.equal(root.querySelector('[data-agent-attempt]'), null);
    const profile = root.querySelector('[data-mission-agent-profile="profile-review"]');
    profile.onclick();
    assert.deepEqual(profiles, ["profile-review"]);
    assignment = { ...assignment, state: "running", wait: undefined, attempts: [{ id: "attempt-a", admittedAt: "2026-11-04T03:00:00.000Z" }] };
    revision++;
    await view.refresh();
    const detail = root.querySelector('[data-agent-attempt="attempt-a"]').querySelector("details");
    detail.open = true;
    detail.querySelector("summary").focus();
    assert.match(detail.textContent, /Attempt 1 · Running.*Provider usage unavailable/);
    assert.doesNotMatch(detail.textContent, /0 total/);
    assignment = { ...assignment, state: "verified", attempts: [{ ...assignment.attempts[0], outcome: "verified",
      finishedAt: "2026-11-04T03:00:00.250Z", evidenceId: "evidence-a", source: "chatgpt-plan-responses:reported",
      observedAt: "2026-11-04T03:00:00.249Z", passed: true, verification: "Report shape checked", findings: ["A reported recommendation"],
      citations: ["https://example.test/evidence"], timing: { queueMs: 10, contextPreparationMs: 2, executionMs: 230, verificationMs: 1 },
      telemetry: { durationMs: 250, providerCalls: 1, usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
        responseId: "response-a", reportedModel: "fixture-actual-model" },
      context: { digest: "manifest-a", accounting: { method: "utf8-byte-estimate", tokens: 30, maxTokens: 100 },
        sources: [{ ref: { id: "source-a" }, version: 2, digest: "digest-a" }], dependencies: [] } }] };
    revision++;
    await view.refresh();
    const refreshed = root.querySelector('[data-agent-attempt="attempt-a"]').querySelector("details");
    assert.equal(refreshed.open, true);
    assert.equal(doc.activeElement, refreshed.querySelector("summary"));
    assert.match(row().textContent, /Report contract verified · recommendations remain provider-reported/);
    assert.match(refreshed.textContent, /Provider-reported findings · factual confirmation is separate.*A reported recommendation/);
    assert.match(refreshed.textContent, /Provider-reported tokens · 40 input \/ 10 output \/ 50 total/);
    assert.match(refreshed.textContent, /Estimated context tokens · 30 \/ 100.*Source source-a · version 2 · digest-a/);
    view.setScope(null);
    profile.onclick();
    assert.deepEqual(profiles, ["profile-review"], "A detached stale control cannot navigate after scope revocation");
    assert.equal(root.querySelector('[data-agent-attempt]'), null);
  } finally { view.dispose(); }
});

test("mission workroom cards show graph dependencies, scoped events, and unavailable telemetry", async () => {
  const graph = componentDocument(), stream = componentDocument(), performance = componentDocument();
  const graphView = mountMissionWorkroomView(graph.root, "dashboard", "room", async () => binding({
    kind: "graph", objective: "Measure the test host", planRevision: 2, tasks: [
      { id: "cpu", title: "Sample CPU", state: "running", executor: "sample.cpu", dependencies: [] },
      { id: "join", title: "Check samples", state: "queued", executor: "join.samples", dependencies: ["cpu"], wait: "dependencies" },
    ],
  }), undefined, () => {});
  const streamView = mountMissionWorkroomView(stream.root, "stream", "room", async () => binding({
    kind: "stream", events: [{ eventId: "evt-a", cursor: 7, receivedAt: "2026-11-04T01:00:00.000Z",
      type: "vela.mission/started", status: "running", classification: "observed", taskId: "cpu" }],
  }), undefined, () => {});
  const performanceView = mountMissionWorkroomView(performance.root, "dashboard", "room", async () => binding({
    kind: "performance", profile: { elapsedMs: 30, peakWorkers: 1, attempts: 1, retries: 0, providerCalls: 0,
      usageReports: 0, reportedTotalTokens: null, verifiedObjectivesPerReportedToken: null },
  }), undefined, () => {});
  try {
    await Promise.all([graphView.refresh(), streamView.refresh(), performanceView.refresh()]);
    const join = graph.root.querySelector('[data-mission-task="join"]');
    assert.deepEqual(JSON.parse(join.dataset.taskDependencies), ["cpu"]);
    assert.match(join.textContent, /Requires Sample CPU.*Waiting for verified prerequisites/);
    const event = stream.root.querySelector('[data-stream-event-id="evt-a"]');
    assert.equal(event.dataset.streamCursor, "7");
    assert.match(event.textContent, /Attempt started.*Observed.*cpu/);
    assert.equal(performance.root.querySelector('[data-mission-metric="providerCalls"]').querySelector("strong").textContent, "0");
    assert.equal(performance.root.querySelector('[data-mission-metric="reportedTotalTokens"]').querySelector("strong").textContent, "Unavailable");
  } finally { for (const view of [graphView, streamView, performanceView]) view.dispose(); }
});

test("evidence disclosures keep their place on refresh and clear immediately when access changes", async () => {
  const { doc, root } = componentDocument();
  let revision = 1, allowed = true, release;
  const revoked = new Promise(resolve => { release = () => resolve(null); });
  const view = mountMissionWorkroomView(root, "dashboard", "room", async () => {
    if (!allowed) return revoked;
    return binding({ kind: "evidence", criteria: ["sample"], rows: [{ taskId: "a", title: "Review a test source",
      state: "verified", criterion: "sample", evidenceId: "record-a", source: "chatgpt-plan-responses:reported", passed: true,
      findings: ["Reported result"], citations: ["https://example.test/source"] }, { taskId: "cpu", title: "Measure CPU",
      state: "verified", criterion: "sample", evidenceId: "record-cpu", source: "node:os.cpus", passed: true,
      findings: ["CPU 12%"] }] }, revision);
  }, undefined, () => {});
  try {
    await view.refresh();
    const details = root.querySelector('[data-evidence-task="a"]');
    details.open = true;
    details.querySelector("summary").focus();
    revision++;
    await view.refresh();
    const restored = root.querySelector('[data-evidence-task="a"]');
    assert.equal(restored.open, true);
    assert.equal(doc.activeElement, restored.querySelector("summary"));
    assert.match(restored.textContent, /Provider-reported findings.*Reported result.*https:\/\/example\.test\/source/);
    assert.match(root.querySelector('[data-evidence-task="cpu"]').textContent, /Measured results.*CPU 12%/);
    allowed = false;
    view.observe(true);
    assert.equal(root.querySelector('[data-mission-evidence-id="record-a"]'), null);
    release();
    await view.refresh();
    assert.match(root.textContent, /Mission card unavailable in this workspace/);
    assert.equal(root.querySelector('[data-mission-id="mission-a"]'), null);
  } finally { view.dispose(); }
});

test("a visible performance card reports host pressure and refreshes until its mission settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { doc, root } = componentDocument();
  const observedAt = "2026-11-04T01:00:00.000Z";
  let reads = 0, running = true;
  const view = mountMissionWorkroomView(root, "dashboard", "room", async () => {
    reads++;
    return { ...binding({ kind: "performance", profile: { elapsedMs: 30, peakWorkers: 1, attempts: 1, retries: 0,
      providerCalls: 0, usageReports: 0, reportedTotalTokens: null, verifiedObjectivesPerReportedToken: null },
      admission: { workerLimit: running ? 1 : 3, reasons: running ? ["cpu-load"] : [], readings: {
        cpuPercent: { value: 96, observedAt }, diskQueueLength: { value: 0, observedAt },
      } } }), outcome: running ? "running" : "verified" };
  }, undefined, () => {});
  try {
    await view.refresh();
    const detail = () => root.querySelector('[data-mission-admission="current"]');
    assert.equal(detail().querySelector("summary").textContent, "Scheduler limit · 1 worker · High CPU load");
    assert.equal(detail().querySelector('[data-admission-metric="gpuEnginePercent"]').textContent, "Busiest GPU engine · Unavailable");
    assert.equal(detail().querySelector('[data-admission-metric="diskQueueLength"]').textContent, `Disk queue length · 0 · Observed ${observedAt}`);
    detail().open = true;
    detail().querySelector("summary").focus();
    running = false;
    const before = reads;
    t.mock.timers.tick(2000);
    await Promise.resolve();
    assert.equal(reads, before + 1);
    assert.equal(detail().querySelector("summary").textContent, "Scheduler limit · 3 workers");
    assert.equal(detail().open, true);
    assert.equal(doc.activeElement, detail().querySelector("summary"));
    t.mock.timers.tick(4000);
    assert.equal(reads, before + 1);
  } finally { view.dispose(); }
});
