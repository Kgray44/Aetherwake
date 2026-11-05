import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument } from "../../../conversation-product/test/component-dom.mts";
import { mountMissionWorkroomView } from "../src/mission-workroom-view.ts";
import { blockDocument } from '../../../block-library/tests/component-dom.mts';

const binding = (dashboard, revision = 1) => ({
  kind: "workroom-resource", missionId: "mission-a", outcome: "running", revision, dashboard,
});

const fullMission = (revision = 1) => ({ contract: 'aerynth.vela-mission@1', id: 'mission-a', requestId: 'synthetic:mission-request',
  objective: 'SYNTHETIC CPU and RAM fixture', scope: { workspaceId: 'origin', projectId: null }, criteria: ['Inspect samples'],
  createdAt: '2026-11-05T01:00:00Z', revision, planRevision: 1, concurrency: 2, disposition: 'active', outcome: 'verified', waits: {},
  tasks: [['cpu', []], ['ram', []], ['report', ['cpu', 'ram']]].map(([id, dependencies]) => ({ id, dependencies, state: 'verified',
    objective: id, executor: id === 'report' ? 'join.samples' : 'sample.' + id, claims: [], criterion: 'Inspect samples', timeoutMs: 1000,
    maxAttempts: 1, queuedAt: '2026-11-05T01:00:00Z', priority: 0, attempts: [] })), events: [],
  profile: { elapsedMs: 1, peakWorkers: 2, attempts: 3, retries: 0, providerCalls: null, reportedTotalTokens: null, usageReports: 0, verifiedObjectivesPerReportedToken: null } });
const flowPort = () => { const poses = new Map(); return { poses, motion: { reduced: true, add(key, pose) { poses.set(key, pose); },
  target(key, pose) { poses.set(key, pose); }, pose(key) { assert(poses.has(key)); return poses.get(key); }, remove(key) { poses.delete(key); }, wake() {} } }; };

for (const cardKind of ['stream', 'graph']) test(cardKind + ' workroom defaults to shared canonical Flow with real dependency joins and forensic rows', async t => {
  const dom = blockDocument(), restore = dom.install(), port = flowPort();
  const mission = fullMission(), dashboard = cardKind === 'graph' ? { kind: 'graph', objective: mission.objective, planRevision: 1,
    tasks: mission.tasks.map(task => ({ ...task, title: task.objective })) } : { kind: 'stream', events: [{ eventId: 'actual-event', cursor: 7,
      receivedAt: '2026-11-05T01:00:00Z', type: 'vela.mission/settled', status: 'verified', classification: 'observed', taskId: 'cpu' }] };
  const view = mountMissionWorkroomView(dom.root, cardKind === 'graph' ? 'dashboard' : 'stream', 'workroom', async () => binding(dashboard), undefined,
    () => {}, undefined, { motion: port.motion, viewId: 'synthetic:' + cardKind, readMission: async () => mission });
  t.after(() => { view.dispose(); restore(); }); await view.refresh(); view.frame();
  assert.equal(dom.root.querySelectorAll('.aw-mission-task').length, 3); assert.equal(dom.root.querySelectorAll('.aw-mission-edge').length, 2);
  assert.equal(dom.root.querySelector('[data-mission-task-id="report"]').dataset.join, 'true'); assert.equal(port.poses.size, 3);
  dom.root.querySelector('[data-mission-task-id="cpu"]').onclick(); assert.match(dom.root.querySelector('.aw-stream-inspector').textContent, /Task IDcpu/);
  const rows = dom.root.querySelector('.aw-mission-workroom').querySelector('ol'); assert(rows.hidden);
  dom.root.querySelector('[data-workroom-mode="forensic"]').onclick(); assert.equal(rows.hidden, false); assert.equal(port.poses.size, 0);
  if (cardKind === 'stream') assert(rows.querySelector('[data-stream-event-id="actual-event"]'));
  dom.root.querySelector('[data-workroom-mode="glimpse"]').onclick(); assert(rows.hidden); assert.equal(port.poses.size, 3);
  view.setActive(false); assert.equal(port.poses.size, 0); view.frame();
});

test('compact workroom shows terse current status and one external menu while profile changes retain task identity', async t => {
  const dom = blockDocument(), restore = dom.install(), port = flowPort(), mission = fullMission();
  const dashboard = { kind: 'graph', objective: mission.objective, planRevision: 1,
    tasks: mission.tasks.map(task => ({ ...task, title: task.objective })) };
  const view = mountMissionWorkroomView(dom.root, 'dashboard', 'workroom', async () => binding(dashboard), undefined,
    () => {}, undefined, { motion: port.motion, viewId: 'synthetic:compact-wrapper', readMission: async () => mission });
  t.after(() => { view.dispose(); restore(); }); await view.refresh(); view.frame();
  const section = dom.root.querySelector('.aw-mission-workroom'), header = section.querySelector('.aw-mission-workroom-header');
  const menu = header.querySelector('.aw-flow-options'), task = section.querySelector('[data-mission-task-id="cpu"]');
  assert.equal(section.dataset.presentation, 'workspace'); assert.equal(section.dataset.flowReady, 'true');
  assert.equal(section.querySelector('.aw-mission-workroom-status').textContent, 'Running · v1');
  assert(menu); assert.equal(section.querySelectorAll('.aw-flow-options').length, 1);
  assert.equal(menu.querySelector('[data-workroom-mode="forensic"]').closest('.aw-mission-flow'), null);
  assert.equal(task.style.width, '110px');
  view.setPresentation('focused'); view.frame();
  assert.equal(section.querySelector('[data-mission-task-id="cpu"]'), task);
  assert.equal(task.style.width, '190px');
  assert.match(section.querySelector('.aw-mission-workroom-status').textContent, /Plan v1.*Journal revision 1/);
  menu.querySelector('[data-workroom-mode="forensic"]').onclick();
  assert.equal(section.querySelector('ol').hidden, false); assert.equal(menu.isConnected, true);
  menu.querySelector('[data-workroom-mode="flow"]').onclick(); view.setPresentation('workspace'); view.frame();
  assert.equal(section.querySelector('[data-mission-task-id="cpu"]').style.width, '110px');
  view.setActive(false); assert.equal(section.querySelector('.aw-flow-options'), null); assert.equal(port.poses.size, 0);
});

test('mission identity/revision mismatch, denied full reads and late scope replies cannot retain or remount graph authority', async t => {
  const dom = blockDocument(), restore = dom.install(), port = flowPort(); let current = fullMission(), denied = false, release;
  const view = mountMissionWorkroomView(dom.root, 'stream', 'workroom', async () => binding({ kind: 'stream', events: [] }, 2), undefined, () => {}, undefined,
    { motion: port.motion, viewId: 'synthetic:scope', readMission: async () => { if (denied) throw Error('denied'); return current; } });
  t.after(() => { view.dispose(); restore(); }); await view.refresh(); assert.equal(port.poses.size, 0); assert.match(dom.root.textContent, /access could not be confirmed/);
  current = { ...fullMission(2), id: 'wrong-mission' }; await view.refresh(); assert.equal(port.poses.size, 0);
  current = fullMission(2); await view.refresh(); assert.equal(port.poses.size, 3);
  denied = true; view.observe(true); assert.equal(port.poses.size, 0); await view.refresh(); assert.equal(dom.root.querySelectorAll('.aw-mission-task').length, 0);
  denied = false; let held = new Promise(resolve => { release = resolve; });
  const late = mountMissionWorkroomView(dom.root, 'stream', 'workroom', async () => binding({ kind: 'stream', events: [] }), undefined, () => {}, undefined,
    { motion: port.motion, viewId: 'synthetic:late', readMission: () => held });
  await Promise.resolve(); late.setScope(null); release(fullMission()); await late.refresh();
  assert.equal(port.poses.size, 0); assert.equal(dom.root.querySelectorAll('.aw-mission-task').length, 0); late.dispose();
});

test('mission Timeline mounts the canonical temporal/planning experience as primary and retains recorded journal in Forensic disclosure', async () => {
  const dom = componentDocument(), calls = [], canonical = dom.doc.createElement('section'); canonical.textContent = 'Canonical Timeline instrument';
  let allowed = true;
  const manual = { setActive: value => calls.push(['active', value]), setPresentation() {}, refresh: async () => calls.push(['refresh']),
    flush: async () => {}, frame: () => calls.push(['frame']), reflow() {}, dispose: () => calls.push(['dispose']) };
  const view = mountMissionWorkroomView(dom.root, 'timeline', 'workroom', async () => { if (!allowed) throw Error('denied'); return { kind: 'workroom-resource', missionId: 'mission-a', outcome: 'verified', revision: 1,
    timeline: [{ seq: 1, kind: 'created', time: '2026-11-05T01:00:00Z' }] }; }, host => { host.append(canonical); return manual; }, () => {});
  try {
    await view.refresh(); assert.equal(dom.root.children[0], canonical.parentElement); assert(calls.some(call => call[0] === 'active' && call[1] === true));
    const forensic = dom.root.querySelector('details'); assert.match(forensic.querySelector('summary').textContent, /Forensic mission journal/); assert.equal(forensic.open, false);
    assert(forensic.querySelector('[data-mission-sequence="1"]')); view.frame(); assert(calls.some(call => call[0] === 'frame'));
    allowed = false; view.observe(true); await view.refresh(); assert.equal(canonical.parentElement.parentElement, null); assert(calls.some(call => call[0] === 'active' && call[1] === false));
  } finally { view.dispose(); } assert.equal(calls.filter(call => call[0] === 'dispose').length, 1);
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
