import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument } from "../../../conversation-product/test/component-dom.mts";
import { mountMissionWorkroomView } from "../src/mission-workroom-view.ts";

const binding = (dashboard, revision = 1) => ({
  kind: "workroom-resource", missionId: "mission-a", outcome: "running", revision, dashboard,
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
