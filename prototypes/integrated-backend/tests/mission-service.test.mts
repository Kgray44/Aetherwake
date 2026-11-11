import { strict as assert } from 'node:assert';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService, validateMissionPlan, type MissionServiceHost } from '../src/mission-service.mts';
import { proposeMissionExecutiveRevision } from '../src/mission-executive.mts';
import { nativeMissionPlan, replanNativeMission } from '../src/mission-native.mts';
import { projectMissionExecution, resolveMissionHypothesis } from '../src/execution-profiler.mts';
import { MISSION_LIMITS, type Mission, type MissionAdmission, type MissionExecutionContext, type MissionExecutor, type MissionPlan, type MissionScope,
  type MissionTaskPlan } from '../src/mission-contracts.mts';
import type { MissionContextSource } from '../../vela-core/src/mission-context.mts';
import { createMissionAdmission } from '../src/mission-admission.mts';

const scope = { workspaceId: 'workspace-1', projectId: 'project-1' };
const task = (id: string, dependencies: string[] = [], resource?: string): MissionTaskPlan => ({
  id, dependencies, criterion: id, claims: resource ? [{ resource, mode: 'exclusive' }] : [], objective: 'Synthetic ' + id,
  executor: 'fixture', timeoutMs: 2000, maxAttempts: 2,
});
const plan = (...tasks: MissionTaskPlan[]): MissionPlan => ({ scope, objective: 'Synthetic objective', tasks, criteria: tasks.map(t => t.criterion) });

function fixture(replaySafe = true) {
  const db = new DatabaseSync(':memory:');
  let access = true;
  let pressure = false;
  const active = new Map<string, { context: MissionExecutionContext; release: (value?: boolean) => void }>();
  const executor: MissionExecutor = {
    lane: 'fixture', replaySafe, available: () => true,
    async run(context) {
      const value = await new Promise<boolean>(resolve => {
        active.set(context.task.id, { context, release: (pass = true) => resolve(pass) });
        context.signal.addEventListener('abort', () => resolve(false), { once: true });
      });
      active.delete(context.task.id);
      return { source: 'synthetic-fixture', value };
    },
    verify: evidence => ({ passed: evidence.value === true, detail: 'Independent synthetic evidence check' }),
  };
  const host = { db, atomic<T>(f: () => T): T { db.exec('BEGIN'); try { const r = f(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; } }, authorized: (candidate: MissionScope) =>
    access && candidate.workspaceId === scope.workspaceId && candidate.projectId === scope.projectId,
  executors: { fixture: executor }, laneLimit: () => 3, underPressure: () => pressure };
  return { db, active, host, create: () => new MissionService(host),
    revoke: () => { access = false; }, pressure: (value: boolean) => { pressure = value; } };
}

function revisionFixture(reassign?: MissionServiceHost['reassign']) {
  const f = fixture();
  const native = { ...f.host.executors.fixture, lane: 'native' };
  const specialist = { ...f.host.executors.fixture, lane: 'chatgpt-plan-responses', replaySafe: false };
  const host = { ...f.host, reassign, executors: { 'sample.cpu': native, 'sample.ram': native,
    'join.samples': native, 'codex.project-check': { ...native, lane: 'codex-local-check' }, 'chatgpt.specialist': specialist } };
  return { ...f, host, create: () => new MissionService(host) };
}

const revisionTask = (id: string, executor: string, dependencies: string[] = []) => ({ ...task(id, dependencies), executor });

test('MissionService admits remote work under local pressure and releases attempt leases on settlement', async () => {
  const f = fixture();
  let available = 0;
  const governor = createMissionAdmission({ maxWorkers: MISSION_LIMITS.workers, availableMemory: () => available,
    readWindowsPressure: null });
  const kind = (lane: string) => lane === 'native' ? 'cpu' as const : 'remote' as const;
  const service = new MissionService({ ...f.host, admission: governor.read,
    executors: { local: { ...f.host.executors.fixture, lane: 'native' }, remote: f.host.executors.fixture },
    resources: {
      canAcquire: (lane: string) => governor.canLease(kind(lane)),
      acquire: (lane: string, request: { missionId: string; taskId: string; attemptId: string; timeoutMs: number }) =>
        governor.tryLease({ ...request, kind: kind(lane) }),
    },
  });
  try {
    const { id } = service.create('resource-separation', plan(revisionTask('local', 'local'), revisionTask('remote', 'remote')));
    await flush();
    assert.equal(f.active.has('local'), false);
    assert.ok(f.active.has('remote'));
    const running = service.read(id, scope);
    const remote = running.tasks.find(t => t.id === 'remote')!.attempts[0];
    assert.equal(remote.resourceLease?.kind, 'remote');
    const liveProfile = projectMissionExecution(running);
    assert.equal(liveProfile.attempts[0].resourceLease?.leaseId, remote.resourceLease.leaseId);
    assert.deepEqual(liveProfile.resourcePolicy.leaseCoverage, { withReceipt: 1, withoutReceipt: 0, attemptsByKind: { remote: 1 } });
    f.active.get('remote')!.release();
    await flush();
    assert.equal(governor.inspectPolicy().active.remote, 0);
    assert.deepEqual(projectMissionExecution(service.read(id, scope)).attempts[0].resourceLease,
      liveProfile.attempts[0].resourceLease);
    available = 1024 ** 3;
    service.capacityChanged();
    await flush();
    assert.ok(f.active.has('local'));
  } finally { await service.close(); governor.dispose(); f.db.close(); }
});

test('the scoped execution profile reconstructs admitted parallel work and its verified join', async () => {
  const f = fixture();
  const service = f.create();
  try {
    const mission = service.create('profile-parallel', plan(task('left'), task('right'), task('join', ['left', 'right'])));
    const readProfile = () => projectMissionExecution(service.read(mission.id, scope));
    await flush();
    const live = readProfile();
    assert.deepEqual(live.attempts.map(a => a.state), ['running', 'running']);
    assert.equal(live.work.criticalPath, null);
    const snapshot = service.read(mission.id, scope);
    const [firstOpen, secondOpen] = live.attempts;
    assert.deepEqual(live.work.dependencyWaits, [{
      taskId: 'join', planRevision: 1, prerequisites: [
        { taskId: 'left', state: 'running', attemptId: firstOpen.id },
        { taskId: 'right', state: 'running', attemptId: secondOpen.id },
      ],
    }]);
    const observation = { clock: firstOpen.start.clock!, monotonicMs: secondOpen.start.monotonicMs! + 5 };
    const liveWork = projectMissionExecution(snapshot, null, null, observation).work;
    assert.deepEqual(liveWork.live?.observation, observation);
    assert.deepEqual(liveWork.live?.attempts.map(attempt => [attempt.attemptId, attempt.elapsedSinceDispatchMs]),
      live.attempts.map(attempt => [attempt.id, observation.monotonicMs - attempt.start.monotonicMs!]));
    assert.ok(projectMissionExecution(snapshot, null, null, { ...observation, clock: 'other' }).work.live?.attempts
      .every(attempt => attempt.elapsedSinceDispatchMs === null));
    assert.equal(liveWork.workerMs, null);
    await new Promise(resolve => setTimeout(resolve, 10));
    f.active.get('left')!.release();
    await flush();
    assert.deepEqual(readProfile().work.dependencyWaits, [{
      taskId: 'join', planRevision: 1,
      prerequisites: [{ taskId: 'right', state: 'running', attemptId: secondOpen.id }],
    }]);
    f.active.get('right')!.release();
    await flush();
    assert.deepEqual(readProfile().work.dependencyWaits, []);
    f.active.get('join')!.release();
    await flush();
    const profile = readProfile();
    const [left, right, join] = profile.attempts;
    assert.deepEqual(profile.verifiedTaskMilestones.first?.settlement, profile.firstVerifiedTask);
    assert.equal(profile.verifiedTaskMilestones.last?.attemptId, join.id);
    assert.deepEqual(profile.verifiedTaskMilestones.last?.evidenceIds, join.verifiedEvidenceIds);
    assert.equal(profile.verifiedTaskMilestones.last?.criterion, 'join');
    assert.equal(profile.verifiedTaskMilestones.last?.intakeToSettlementMs, null);
    const phases = join.phases;
    assert.ok(phases);
    assert.equal(phases.clock, join.start.clock);
    const intervals = [phases.contextAssembly, phases.dispatchValidation, phases.execution,
      phases.postExecutionContextValidation, phases.verification];
    let last = -Infinity;
    for (const interval of intervals) {
      assert.ok(interval && interval[0] >= last && interval[1] >= interval[0]);
      last = interval[1];
    }
    assert.ok(last <= join.end!.monotonicMs!);
    assert.deepEqual(join.predecessors, [left.id, right.id]);
    assert.equal(join.planRevision, 1);
    assert.equal(profile.work.peakWorkers, 2);
    assert.ok(profile.work.overlapMs! > 0);
    assert.equal(profile.work.criticalPath!.attemptIds.length, 2);
    assert.equal(profile.work.criticalPath!.attemptIds.at(-1), join.id);
    assert.ok(profile.work.workerMs! > profile.work.criticalPath!.durationMs);
    assert.equal(profile.economics.cost, null);
    assert.equal(profile.economics.costCoverage, 'provider-call-count-unavailable');
    assert.equal(profile.economics.usageCoverage, 'missing');
    assert.equal(profile.attempts[0].start.eventSeq > 0, true);
    assert.ok(!JSON.stringify(profile).includes('Independent synthetic evidence check'));
    const replay = service.read(mission.id, scope);
    replay.events = [...replay.events, replay.events[0], replay.events.at(-1)!].reverse();
    assert.deepEqual(projectMissionExecution(replay), profile);
    const withoutLifecycle = projectMissionExecution({ ...replay, events: [] });
    assert.deepEqual(withoutLifecycle.quality.criteria, profile.quality.criteria);
    assert.equal(withoutLifecycle.quality.objectiveVerified, true);
    assert.ok(withoutLifecycle.experiment.blockers.includes('incomplete-causal-timing'));
    const differentReportClock = {
      eventId: 'test-report', cursor: 1, receivedAt: profile.lastSettlement!.utc,
      timing: { clock: 'reopened-report-clock', compositionStartedMs: 1, composedMs: 3, stagedMs: 4 },
    };
    const laterReport = projectMissionExecution(replay, differentReportClock);
    assert.equal(laterReport.settlementToReportStagedMs, null);
    assert.deepEqual(laterReport.reportLatency, {
      publicationEventId: 'test-report', settlementEventSeq: null, settlementToCompositionMs: null,
      compositionMs: 2, compositionToStagingMs: 1, stagingToRendererReceiptMs: null,
    });
    const crossClock = structuredClone(replay);
    for (const event of crossClock.events) {
      if (event.kind === 'created') event.timing!.intakeMonotonicMs = event.timing!.monotonicMs;
      if (event.seq === join.end!.eventSeq) event.timing!.domain = 'reopened-fixture';
    }
    const crossClockMilestones = projectMissionExecution(crossClock).verifiedTaskMilestones;
    assert.ok(crossClockMilestones.first?.intakeToSettlementMs != null);
    assert.deepEqual(crossClockMilestones.last?.evidenceIds, join.verifiedEvidenceIds);
    assert.equal(crossClockMilestones.last?.intakeToSettlementMs, null);
    // Independent expected intervals: [1, 6], [2, 10], [12, 15].
    const times = new Map([[left.start.eventSeq, 1], [left.end!.eventSeq, 6],
      [right.start.eventSeq, 2], [right.end!.eventSeq, 10], [join.start.eventSeq, 12], [join.end!.eventSeq, 15]]);
    replay.events = replay.events.map(event => times.has(event.seq) ?
      { ...event, timing: { ...event.timing!, monotonicMs: times.get(event.seq)! } } : event);
    const timingById = new Map([
      [left.id, { contextAssembly: [0, 1] as [number, number] }],
      [right.id, { contextAssembly: [1, 2] as [number, number], execution: [3, 9] as [number, number] }],
      [join.id, { contextAssembly: [11, 12] as [number, number], execution: [12, 14] as [number, number],
        readyQueue: { firstObservedMs: 10.25, blockers: {} } }],
    ]);
    for (const task of replay.tasks) for (const attempt of task.attempts) {
      attempt.timing!.phases = { clock: left.start.clock!, ...timingById.get(attempt.id)! };
    }
    const { work } = projectMissionExecution(replay);
    assert.equal(work.activeMs, 12);
    assert.equal(work.workerMs, 16);
    assert.equal(work.overlapMs, 4);
    assert.deepEqual(work.occupancyByOutcome, [{
      outcome: 'verified', attempts: 3, measuredAttempts: 3,
      clockSegments: [{ clock: left.start.clock, attemptIds: [left.id, right.id, join.id], workerMs: 16 }],
    }]);
    const splitOccupancy = structuredClone(replay);
    for (const event of splitOccupancy.events) if (event.attemptId === right.id)
      event.timing!.domain = 'separate-clock';
    const splitWork = projectMissionExecution(splitOccupancy).work;
    assert.equal(splitWork.workerMs, null);
    assert.deepEqual(splitWork.occupancyByOutcome[0].clockSegments, [
      { clock: left.start.clock, attemptIds: [left.id, join.id], workerMs: 8 },
      { clock: 'separate-clock', attemptIds: [right.id], workerMs: 8 },
    ]);
    assert.deepEqual(work.criticalPath, { durationMs: 11, attemptIds: [right.id, join.id] });
    const readiness = work.dependencyReadinessPath;
    assert.ok(readiness);
    assert.deepEqual(readiness.attempts.map(node => [node.attemptId, node.gapBeforeAssemblyMs]), [[right.id, null], [join.id, 1]]);
    assert.equal(readiness.elapsedMs, 14);
    assert.equal(readiness.betweenAttemptsMs, 1);
    assert.equal(readiness.attempts[1].observedReadyWaitMs, 0.75);
    assert.equal(readiness.attempts[1].unattributedGapMs, 0.25);
    assert.equal(readiness.observedReadyBetweenAttemptsMs, 0.75);
    assert.equal(readiness.unattributedBetweenAttemptsMs, 0.25);
    assert.deepEqual(readiness.readyQueueCoverage, { observedEdges: 1, totalEdges: 1 });
    assert.deepEqual(readiness.largestMeasuredSegment, { kind: 'execution', attemptId: right.id, taskId: 'right',
      startedMs: 3, endedMs: 9, durationMs: 6 });
    assert.equal(projectMissionExecution(replay).experiment.hypothesis, null);
    const constrained = structuredClone(replay);
    const queuedAttempt = constrained.tasks.find(task => task.id === 'join')!.attempts[0];
    queuedAttempt.admission = { workerLimit: 1, reasons: ['cpu-load'], readings: {} };
    const blockers = queuedAttempt.timing!.phases!.readyQueue!.blockers;
    blockers['worker-budget'] = { samples: 2, lastObservedMs: 10.75 };
    blockers['resource-conflict'] = { samples: 1, lastObservedMs: 10.5 };
    const experiment = projectMissionExecution(constrained).experiment;
    const hypothesis = experiment.hypothesis;
    assert.ok(hypothesis);
    assert.equal(hypothesis.id, `${constrained.id}:${constrained.planRevision}:${join.id}:worker-budget`);
    assert.equal(hypothesis.owner, 'arie');
    assert.equal(hypothesis.status, 'hypothesis');
    assert.equal(hypothesis.evidence.observedReadyWaitMs, 0.75);
    assert.deepEqual(hypothesis.evidence.eventSeqs, [join.start.eventSeq, join.end!.eventSeq]);
    assert.deepEqual(hypothesis.evidence.blockers, blockers);
    assert.deepEqual(hypothesis.evidence.verifiedEvidenceIds, join.verifiedEvidenceIds);
    assert.ok(experiment.blockers.includes('no-independent-quality-evaluation'));
    assert.deepEqual(resolveMissionHypothesis(constrained, hypothesis.id, constrained.revision), {
      kind: 'experiment-hypothesis', missionRevision: constrained.revision, hypothesis,
    });
    assert.equal(resolveMissionHypothesis(constrained, hypothesis.id, constrained.revision + 1), null);
    assert.equal(resolveMissionHypothesis(constrained, 'unrelated-hypothesis', constrained.revision), null);
    assert.deepEqual(projectMissionExecution(structuredClone(constrained)).experiment.hypothesis, hypothesis);
    assert.equal(projectMissionExecution({ ...constrained, criteria: [...constrained.criteria, 'missing'] }).experiment.hypothesis, null);
    blockers['worker-budget']!.lastObservedMs = 11.25;
    assert.equal(projectMissionExecution(constrained).experiment.hypothesis, null);
    const withEntry = structuredClone(replay);
    const created = withEntry.events.find(event => event.kind === 'created')!;
    for (const event of withEntry.events) if (event.seq === created.seq) event.timing!.monotonicMs = 0;
    withEntry.tasks.find(task => task.id === 'right')!.attempts[0].timing!.phases!.readyQueue = {
      firstObservedMs: 0.25, blockers: {},
    };
    const entry = projectMissionExecution(withEntry).work.dependencyReadinessPath?.entry;
    assert.deepEqual(entry, { taskId: 'right', attemptId: right.id, admissionEventSeq: created.seq,
      admittedMs: 0, assemblyStartedMs: 1, elapsedMs: 1, observedReadyWaitMs: 0.75, unattributedGapMs: 0.25 });
    const rootPhases = withEntry.tasks.find(task => task.id === 'right')!.attempts[0].timing!.phases!;
    rootPhases.contextAssembly = [8, 9];
    rootPhases.execution = [9, 9.5];
    for (const event of withEntry.events) if (event.seq === right.start.eventSeq) event.timing!.monotonicMs = 9;
    const delayedEntry = projectMissionExecution(withEntry).work.dependencyReadinessPath!;
    assert.equal(delayedEntry.entry?.observedReadyWaitMs, 7.75);
    assert.equal(delayedEntry.elapsedMs, 7);
    assert.deepEqual(delayedEntry.largestMeasuredSegment,
      { kind: 'execution', attemptId: join.id, taskId: 'join', startedMs: 12, endedMs: 14, durationMs: 2 });
    rootPhases.readyQueue!.firstObservedMs = -1;
    const staleEntry = projectMissionExecution(withEntry).work.dependencyReadinessPath?.entry;
    assert.equal(staleEntry?.observedReadyWaitMs, null);
    assert.equal(staleEntry?.unattributedGapMs, 8);
    for (const event of withEntry.events) if (event.seq === created.seq) event.timing!.domain = 'unrelated-clock-fixture';
    assert.equal(projectMissionExecution(withEntry).work.dependencyReadinessPath?.entry, null);
    const queued = structuredClone(replay);
    for (const event of queued.events) {
      if (event.seq === join.start.eventSeq) event.timing!.monotonicMs = 20;
      if (event.seq === join.end!.eventSeq) event.timing!.monotonicMs = 23;
    }
    const queuedPhases = queued.tasks.find(task => task.id === 'join')!.attempts[0].timing!.phases!;
    queuedPhases.contextAssembly = [19, 20];
    queuedPhases.execution = [20, 22];
    assert.deepEqual(projectMissionExecution(queued).work.dependencyReadinessPath?.largestMeasuredSegment,
      { kind: 'observed-ready-wait', attemptId: join.id, taskId: 'join', startedMs: 10.25, endedMs: 19, durationMs: 8.75 });
    assert.equal(readiness.unattributedWithinAttemptsMs, 3);
    assert.deepEqual(readiness.phaseMs, { contextAssembly: 2, execution: 8 });
    const invalid = structuredClone(replay);
    invalid.tasks.find(task => task.id === 'join')!.attempts[0].timing!.phases!.contextAssembly[0] = 9;
    assert.equal(projectMissionExecution(invalid).work.dependencyReadinessPath, null);
    const staleReady = structuredClone(replay);
    staleReady.tasks.find(task => task.id === 'join')!.attempts[0].timing!.phases!.readyQueue!.firstObservedMs = 9;
    const unknownGap = projectMissionExecution(staleReady).work.dependencyReadinessPath!;
    assert.equal(unknownGap.observedReadyBetweenAttemptsMs, null);
    assert.equal(unknownGap.unattributedBetweenAttemptsMs, 1);
    assert.deepEqual(unknownGap.readyQueueCoverage, { observedEdges: 0, totalEdges: 1 });
    staleReady.tasks.find(task => task.id === 'join')!.attempts[0].timing!.phases!.readyQueue!.firstObservedMs = 11;
    const instantReady = projectMissionExecution(staleReady).work.dependencyReadinessPath!;
    assert.equal(instantReady.observedReadyBetweenAttemptsMs, 0);
    assert.deepEqual(instantReady.readyQueueCoverage, { observedEdges: 1, totalEdges: 1 });
    const shorterLateBranch = structuredClone(replay);
    for (const event of shorterLateBranch.events)
      if (event.seq === right.start.eventSeq) event.timing!.monotonicMs = 6;
    shorterLateBranch.tasks.find(task => task.id === 'right')!.attempts[0].timing!.phases!.execution = [7, 9];
    const split = projectMissionExecution(shorterLateBranch).work;
    assert.deepEqual(split.criticalPath?.attemptIds, [left.id, join.id]);
    assert.deepEqual(split.dependencyReadinessPath?.attempts.map(node => node.attemptId), [right.id, join.id]);
    const recoveredPublication = projectMissionExecution(replay, {
      eventId: 'report-after-restart', cursor: 99, receivedAt: '2026-11-10T22:00:00.000Z',
      timing: { clock: 'reopened-process', compositionStartedMs: 20, composedMs: 21, stagedMs: 22 },
    });
    assert.equal(recoveredPublication.reportPublication?.eventId, 'report-after-restart');
    assert.equal(recoveredPublication.settlementToReportStagedMs, null);
    f.revoke();
    assert.throws(readProfile, /mission_not_found/);
  } finally {
    await service.close();
    f.db.close();
  }
});

test('a thrown executor or verifier retains the elapsed phases that actually ran', async () => {
  for (const failure of ['execution', 'verification'] as const) {
    const f = fixture(), base = f.host.executors.fixture;
    const executor: MissionExecutor = {
      ...base,
      run: failure === 'execution' ? () => { throw Error('synthetic executor failure'); } : base.run,
      verify: () => { throw Error('synthetic verifier failure'); },
    };
    const service = new MissionService({ ...f.host, executors: { fixture: executor } });
    try {
      const mission = service.create('profile-failure-' + failure, plan(task('inspect')));
      await flush();
      f.active.get('inspect')?.release();
      await flush();
      const [attempt] = projectMissionExecution(service.read(mission.id, scope)).attempts;
      assert.equal(attempt.state, 'failed');
      const interval = attempt.phases?.[failure];
      assert.ok(interval && interval[1] >= interval[0]);
      if (failure === 'execution') assert.equal(attempt.phases?.verification, undefined);
      else assert.ok(attempt.verificationMs !== null && attempt.verificationMs >= 0);
    } finally {
      await service.close();
      f.db.close();
    }
  }
});

test('the execution profile keeps interrupted attempts and leaves their duration unknown', async () => {
  const f = fixture(false);
  const running = f.create();
  const other = fixture(false);
  let recovered: MissionService | undefined;
  try {
    const mission = running.create('profile-restart', plan(task('inspect')));
    await flush();
    const row = f.db.prepare('SELECT * FROM vela_missions WHERE id=?').get(mission.id)!;
    await other.create().close();
    other.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,?,?,?)')
      .run(row.id, row.request_id, row.request_digest, row.scope_key, row.pending, row.active, row.json);
    recovered = other.create();
    const profile = projectMissionExecution(recovered.read(mission.id, scope));
    assert.equal(profile.attempts[0].state, 'uncertain');
    assert.equal(profile.attempts[0].interrupted, true);
    assert.notEqual(profile.attempts[0].start.clock, profile.attempts[0].end?.clock);
    assert.equal(profile.attempts[0].interval, null);
    assert.equal(profile.work.criticalPath, null);
    assert.equal(profile.work.workerMs, null);
  } finally {
    await running.close();
    await recovered?.close();
    f.db.close();
    other.db.close();
  }
});

test('simulated provider usage stays out of the reported token total', async () => {
  const f = fixture();
  const service = f.create();
  try {
    const proposed = plan(task('inspect'));
    proposed.planning = { provider: 'chatgpt-plan-responses', model: 'fixture', responseId: 'fixture',
      startedAt: new Date().toISOString(), durationMs: 12, providerEvidence: 'simulated',
      usage: { source: 'provider-reported', inputTokens: 6, outputTokens: 4, totalTokens: 10 } };
    const mission = service.create('profile-simulated', proposed);
    const profile = projectMissionExecution(service.read(mission.id, scope));
    assert.equal(profile.planning?.providerEvidence, 'simulated');
    assert.equal(profile.economics.reportedTotalTokens, null);
    assert.equal(profile.economics.simulatedTotalTokens, 10);
    assert.deepEqual(profile.economics.usageReceipts, { reported: 0, simulated: 1, unattributed: 0, missing: 0 });
    assert.equal(profile.economics.costCoverage, 'simulated-only');
    assert.deepEqual(profile.economics.usageGaps, []);
    await flush();
    f.active.get('inspect')!.release();
    await flush();
    const retained = service.read(mission.id, scope);
    retained.profile.providerCalls = 3;
    retained.tasks[0].attempts[0].telemetry = { durationMs: 15, providerCalls: 1, providerEvidence: 'reported',
      usage: { source: 'provider-reported', inputTokens: 12, outputTokens: 8, totalTokens: 20 } };
    const economics = projectMissionExecution({ ...retained, events: [] }).economics;
    assert.equal(economics.reportedTotalTokens, 20);
    assert.equal(economics.simulatedTotalTokens, 10);
    assert.equal(economics.usageCoverage, 'partial');
    assert.deepEqual(economics.usageReceipts, { reported: 1, simulated: 1, unattributed: 0, missing: 1 });
    assert.equal(economics.costCoverage, 'billing-receipt-unavailable');
    assert.deepEqual(economics.usageGaps, ['missing-usage-receipts']);
    assert.deepEqual(economics.usageBySource.reported.inputTokens, { observedTokens: 12, receipts: 1 });
    assert.deepEqual(economics.usageBySource.reported.cachedInputTokens, { observedTokens: null, receipts: 0 });
    assert.deepEqual(economics.usageBySource.simulated.outputTokens, { observedTokens: 4, receipts: 1 });
    const invalid = structuredClone(retained);
    const invalidTelemetry = invalid.tasks[0].attempts[0].telemetry!;
    invalidTelemetry.usage = { ...invalidTelemetry.usage!, cachedInputTokens: 13,
      cacheWriteInputTokens: 13, reasoningOutputTokens: 9 };
    const constrained = projectMissionExecution(invalid).economics;
    assert.equal(constrained.reportedTotalTokens, 20);
    const unavailable = { observedTokens: null, receipts: 0 };
    assert.deepEqual(constrained.usageBySource.reported.cachedInputTokens, unavailable);
    assert.deepEqual(constrained.usageBySource.reported.cacheWriteInputTokens, unavailable);
    assert.deepEqual(constrained.usageBySource.reported.reasoningOutputTokens, unavailable);
    invalidTelemetry.usage = { ...invalidTelemetry.usage, cachedInputTokens: 12,
      cacheWriteInputTokens: 0, reasoningOutputTokens: 8 };
    const bounded = projectMissionExecution(invalid).economics.usageBySource.reported;
    assert.deepEqual(bounded.cachedInputTokens, { observedTokens: 12, receipts: 1 });
    assert.deepEqual(bounded.cacheWriteInputTokens, { observedTokens: 0, receipts: 1 });
    assert.deepEqual(bounded.reasoningOutputTokens, { observedTokens: 8, receipts: 1 });
    const inconsistentCount = projectMissionExecution({ ...retained, profile: { ...retained.profile, providerCalls: 1 } }).economics;
    assert.deepEqual(inconsistentCount.usageGaps, ['usage-exceeds-provider-call-count']);
    assert.equal(inconsistentCount.usageReceipts.missing, null);
    delete retained.tasks[0].attempts[0].telemetry.providerEvidence;
    retained.profile.providerCalls = null;
    const unattributed = projectMissionExecution(retained).economics;
    assert.deepEqual(unattributed.usageReceipts,
      { reported: 0, simulated: 1, unattributed: 1, missing: null });
    assert.equal(unattributed.costCoverage, 'provider-call-count-unavailable');
    assert.deepEqual(unattributed.usageGaps, ['provider-call-count-unavailable', 'unattributed-usage']);
    retained.planning!.executionId = 'same-execution';
    retained.tasks[0].attempts[0].telemetry = { ...retained.tasks[0].attempts[0].telemetry!,
      providerExecutionId: 'same-execution', providerEvidence: 'simulated', usage: retained.planning!.usage };
    retained.profile.providerCalls = 2;
    const deduplicated = projectMissionExecution(retained).economics;
    assert.equal(deduplicated.providerCalls, 1);
    assert.equal(deduplicated.simulatedTotalTokens, 10);
    assert.equal(deduplicated.usageCoverage, 'complete');
    retained.tasks[0].attempts[0].telemetry.usage = { ...retained.planning!.usage!, cachedInputTokens: 0 };
    const enriched = projectMissionExecution(retained).economics;
    assert.deepEqual(enriched.usageBySource.simulated.cachedInputTokens, { observedTokens: 0, receipts: 1 });
    assert.deepEqual(enriched.conflictingUsageExecutionIds, []);
    retained.tasks[0].attempts[0].telemetry.providerEvidence = 'reported';
    const conflicted = projectMissionExecution(retained).economics;
    assert.equal(conflicted.reportedTotalTokens, null);
    assert.equal(conflicted.simulatedTotalTokens, null);
    assert.deepEqual(conflicted.conflictingUsageExecutionIds, ['same-execution']);
    assert.deepEqual(conflicted.usageGaps, ['missing-usage-receipts', 'conflicting-usage-receipts']);
  } finally {
    await service.close();
    f.db.close();
  }
});

test('a source edit fences in-flight results, invalidates downstream proof and permits reviewed native retry', async () => {
  const f = fixture();
  const ref = { kind: 'resource' as const, id: 'synthetic-note' };
  let version = 1;
  const source: MissionContextSource = {
    scopeVersion: () => 'fixture-policy',
    retrieve: () => [ref],
    read: () => ({ ref, version, locator: 'synthetic-note', scope: { kind: 'workspace', id: scope.workspaceId },
      certainty: 'observed', content: 'Synthetic objective sample ' + version }),
  };
  const service = new MissionService({ ...f.host, contextSource: (_mission, task) => task.id === 'inspect' ? source : undefined });
  try {
    const { id } = service.create('source-edits', plan(task('inspect'), task('join', ['inspect'])));
    const read = () => service.read(id, scope);
    await flush();
    assert.equal(f.active.get('inspect')?.context.context.manifest.sources[0]?.version, 1);
    f.active.get('inspect')!.release();
    await flush();
    assert.equal(read().tasks[0].state, 'verified');
    assert(f.active.has('join'));
    version++;
    f.active.get('join')!.release();
    await flush();
    const stale = read();
    assert.equal(stale.outcome, 'blocked');
    assert.equal(stale.tasks[0].detail, 'mission_source_changed_since_verification');
    assert.equal(stale.tasks[1].detail, 'mission_context_changed_during_execution');
    assert(stale.tasks.every(task => !task.attempts[0].evidence && !task.attempts[0].verification && !task.attempts[0].context));
    assert.deepEqual(projectMissionExecution(stale).verifiedTaskMilestones, { first: null, last: null });
    const staleProfile = projectMissionExecution(stale);
    assert.ok(staleProfile.quality.criteria.every(criterion => criterion.state === 'unverified' && !criterion.proofs.length));
    assert.ok(staleProfile.experiment.blockers.includes('missing-current-criterion-evidence'));
    service.control(id, scope, stale.revision, { type: 'retry', taskId: 'inspect' });
    await flush();
    assert.equal(f.active.get('inspect')?.context.context.manifest.sources[0]?.version, 2);
    f.active.get('inspect')!.release();
    await flush();
    service.control(id, scope, read().revision, { type: 'retry', taskId: 'join' });
    await flush();
    f.active.get('join')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
    assert(read().tasks.every(task => task.attempts[1].verification?.passed));
    const milestones = projectMissionExecution(read()).verifiedTaskMilestones;
    assert.equal(milestones.first?.attemptId, read().tasks[0].attempts[1].id);
    assert.equal(milestones.last?.attemptId, read().tasks[1].attempts[1].id);
    const restoredProfile = projectMissionExecution(read());
    assert.equal(restoredProfile.quality.objectiveVerified, true);
    assert.deepEqual(restoredProfile.quality.criteria.map(criterion => criterion.proofs[0].attemptId),
      read().tasks.map(task => task.attempts[1].id));
  } finally { await service.close(); f.db.close(); }
});

test('validates dependencies and holds simple AIR routes outside mission planning', () => {
  const f = fixture();
  try {
    assert.throws(() => validateMissionPlan(plan(task('x', ['y'])), f.host.executors), /missing_mission_dependency/);
    assert.throws(() => validateMissionPlan(plan(task('x', ['y']), task('y', ['x'])), f.host.executors), /mission_dependency_cycle/);
    assert.equal(nativeMissionPlan('What is CPU usage?', scope), null);
    assert.equal(nativeMissionPlan('Measure CPU and RAM and send the results', scope), null);
    const native = nativeMissionPlan('Vela, run a mission to measure CPU, RAM, and GPU utilization in parallel.', scope)!;
    assert.deepEqual(native.tasks.find(t => t.id === 'report')?.dependencies, ['cpu', 'ram', 'gpu']);
  } finally { f.db.close(); }
});

test('a failed publication stage rolls back the journal and idempotent creation stages once', async () => {
  const f = fixture();
  f.pressure(true);
  f.db.exec('CREATE TABLE staged_events (mission_id TEXT, seq INTEGER, PRIMARY KEY (mission_id, seq))');
  const notifications: { seq: number; inTransaction: boolean }[] = [];
  let failStage = true;
  const service = new MissionService({ ...f.host,
    stagePublication(mission, from) {
      assert.equal(f.db.isTransaction, true);
      const row = f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(mission.id);
      assert.ok(row);
      const persisted = JSON.parse(String(row.json)) as Mission;
      assert.equal(persisted.revision, mission.revision);
      for (const event of persisted.events.slice(from))
        f.db.prepare('INSERT INTO staged_events VALUES(?,?)').run(mission.id, event.seq);
      if (failStage) throw Error('synthetic_stage_failure');
    },
    observe(_mission, event) { notifications.push({ seq: event.seq, inTransaction: f.db.isTransaction }); },
  });
  const staged = () => f.db.prepare('SELECT seq FROM staged_events ORDER BY seq').all().map(row => row.seq);
  const original = plan(task('root'));
  try {
    assert.throws(() => service.create('staged-create', original), /synthetic_stage_failure/);
    assert.deepEqual(service.list(scope), []);
    assert.deepEqual(staged(), []);
    assert.deepEqual(notifications, []);

    failStage = false;
    const created = service.create('staged-create', original);
    assert.equal(service.create('staged-create', original).id, created.id);
    assert.deepEqual(staged(), [1]);
    assert.deepEqual(notifications, [{ seq: 1, inTransaction: false }]);

    failStage = true;
    const pause = () => service.control(created.id, scope, created.revision, { type: 'pause' });
    assert.throws(pause, /synthetic_stage_failure/);
    assert.equal(service.read(created.id, scope).revision, created.revision);
    assert.deepEqual(staged(), [1]);

    failStage = false;
    const paused = pause();
    assert.equal(paused.disposition, 'paused');
    assert.deepEqual(staged(), [1, 2]);
    assert.deepEqual(notifications, [{ seq: 1, inTransaction: false }, { seq: 2, inTransaction: false }]);
  } finally { await service.close(); f.db.close(); }
});

test('an observed backend outlier amends the graph before its report and retains the triggering attempt', async () => {
  const f = fixture(), order: string[] = [];
  let committedAtSettlement: Record<string, SQLOutputValue> | undefined;
  let stagedAtSettlement: string[] | undefined;
  const probe: MissionExecutor = { lane: 'native', replaySafe: true, available: () => true,
    async run(context) {
      order.push(context.task.id);
      if (context.task.id === 'report') assert.deepEqual(context.task.dependencies, ['backend', 'backend-repeat']);
      return { source: 'synthetic-timer-sample', value: { timerOvershootMs: context.task.id === 'backend' ? 28 : 0 } };
    },
    verify: () => ({ passed: true, detail: 'Synthetic measurement passed' }),
  };
  const service = new MissionService({ ...f.host, replan: replanNativeMission, stagePublication(mission, from) {
    const appended = mission.events.slice(from);
    if (appended[0]?.kind === 'settled' && appended[0].taskId === 'backend')
      stagedAtSettlement = appended.map(event => event.kind);
  }, observe: (mission, event) => {
    if (event.kind === 'settled' && event.taskId === 'backend')
      committedAtSettlement = f.db.prepare('SELECT * FROM vela_missions WHERE id=?').get(mission.id);
  },
    executors: { 'sample.backend': probe, 'join.samples': probe } });
  try {
    const original = plan({ ...task('backend'), executor: 'sample.backend' },
      { ...task('report', ['backend']), executor: 'join.samples' });
    const { id } = service.create('timer-outlier', original);
    await flush();
    const observed = service.read(id, scope);
    assert.equal(observed.outcome, 'verified');
    assert.equal(observed.planRevision, 2);
    assert.equal(observed.objective, original.objective);
    assert.deepEqual(observed.criteria, original.criteria);
    assert.deepEqual(order, ['backend', 'backend-repeat', 'report']);
    const revision = observed.events.find(event => event.kind === 'revised')!;
    assert.equal(revision.taskId, 'backend');
    assert.equal(revision.attemptId, observed.tasks[0].attempts[0].id);
    assert.ok(revision.seq < observed.events.find(event => event.taskId === 'backend-repeat' && event.kind === 'started')!.seq);

    const checkpoint = committedAtSettlement;
    assert.ok(checkpoint, 'The observer must see a committed settlement checkpoint');
    const committed = JSON.parse(String(checkpoint.json)) as Mission;
    assert.equal(committed.tasks.find(node => node.id === 'backend')?.state, 'verified');
    assert.deepEqual(committed.tasks.find(node => node.id === 'report')?.dependencies, ['backend', 'backend-repeat']);
    assert.deepEqual(committed.events.slice(-2).map(event => event.kind), ['settled', 'revised']);
    assert.deepEqual(stagedAtSettlement, ['settled', 'revised']);
    const second = fixture();
    const reopenedHost = { ...second.host, replan: replanNativeMission, executors: { 'sample.backend': probe, 'join.samples': probe } };
    let recovered: MissionService | undefined;
    try {
      await new MissionService(reopenedHost).close();
      second.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,?,?,?)').run(checkpoint.id, checkpoint.request_id,
        checkpoint.request_digest, checkpoint.scope_key, checkpoint.pending, checkpoint.active, checkpoint.json);
      recovered = new MissionService(reopenedHost);
      const durable = recovered.read(id, scope);
      assert.equal(durable.disposition, 'paused');
      assert.equal(durable.tasks.find(node => node.id === 'backend-repeat')?.state, 'queued');
      assert.equal(durable.waits.report, 'dependencies');
      assert.equal(durable.tasks.find(node => node.id === 'report')?.attempts.length, 0);

      await recovered.close();
      const legacy = { ...committed, revision: committed.revision - 1, planRevision: committed.planRevision - 1,
        events: committed.events.slice(0, -1), tasks: committed.tasks.filter(node => node.id !== 'backend-repeat') };
      legacy.tasks.find(node => node.id === 'report')!.dependencies = ['backend'];
      second.db.prepare('UPDATE vela_missions SET pending=?,active=?,json=? WHERE id=?')
        .run(checkpoint.pending, checkpoint.active, JSON.stringify(legacy), checkpoint.id);
      recovered = new MissionService(reopenedHost);
      const beforeResume = recovered.read(id, scope);
      assert.equal(beforeResume.disposition, 'paused');
      assert.ok(!beforeResume.tasks.some(node => node.id === 'backend-repeat'));
      const resumed = recovered.control(id, scope, beforeResume.revision, { type: 'resume' });
      assert.deepEqual(resumed.tasks.find(node => node.id === 'report')?.dependencies, ['backend', 'backend-repeat']);
      await flush();
      assert.deepEqual(order.slice(-2), ['backend-repeat', 'report']);
      assert.equal(recovered.read(id, scope).outcome, 'verified');
    } finally { await recovered?.close(); second.db.close(); }
  } finally { await service.close(); f.db.close(); }
});

test('a required amendment beyond the graph limit retains sample evidence and blocks report dispatch', async () => {
  const f = fixture(), dispatched: string[] = [];
  const probe: MissionExecutor = { lane: 'native', replaySafe: true, available: () => true,
    async run({ task }) {
      dispatched.push(task.id);
      return { source: 'synthetic-timer-sample', value: { timerOvershootMs: task.id === 'backend' ? 28 : 0 } };
    },
    verify: () => ({ passed: true, detail: 'Synthetic timer sample verified' }),
  };
  const service = new MissionService({ ...f.host, replan: replanNativeMission,
    executors: { 'sample.backend': probe, 'join.samples': probe } });
  try {
    const original = plan(revisionTask('backend', 'sample.backend'), revisionTask('report', 'join.samples', ['backend']),
      ...Array.from({ length: MISSION_LIMITS.tasks - 2 }, (_, index) => revisionTask('followup-' + index, 'join.samples', ['report'])));
    const { id } = service.create('replan-capacity-denial', original);
    await flush();
    const blocked = service.read(id, scope);
    const sample = blocked.tasks.find(node => node.id === 'backend')!;
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(sample.state, 'blocked');
    assert.equal(sample.detail, 'mission_required_replan_blocked');
    assert.equal(sample.attempts[0].outcome, 'blocked');
    assert.equal(sample.attempts[0].verification?.passed, true);
    assert.deepEqual(sample.attempts[0].evidence?.value, { timerOvershootMs: 28 });
    assert.deepEqual(blocked.tasks.find(node => node.id === 'report')?.dependencies, ['backend']);
    assert.equal(blocked.planRevision, 1);
    assert.equal(blocked.events.at(-1)?.detail, 'blocked');
    assert.deepEqual(dispatched, ['backend']);

    const other = service.create('replan-independent-mission', plan(revisionTask('independent', 'sample.backend')));
    await flush();
    assert.equal(service.read(other.id, scope).outcome, 'verified');
    assert.deepEqual(dispatched, ['backend', 'independent']);
  } finally { await service.close(); f.db.close(); }
});

test('overlaps independent branches and missions, serializes exclusive claims, and joins verified evidence', async () => {
  const f = fixture(), service = f.create();
  try {
    const firstPlan = plan(task('analysis', [], 'repo'), task('profile'), task('join', ['analysis', 'profile']));
    const a = service.create('a', firstPlan);
    assert.equal(service.create('a', firstPlan).id, a.id);
    assert.throws(() => service.create('a', { ...firstPlan, objective: 'Changed' }), /mission_request_conflict/);
    const b = service.create('b', plan(task('conflict', [], 'repo'), task('independent')));
    await flush();
    assert.deepEqual([...f.active.keys()].sort(), ['analysis', 'independent', 'profile']);
    assert.equal(service.read(b.id, scope).waits.conflict, 'resource-conflict');
    assert.equal(service.read(a.id, scope).waits.join, 'dependencies');
    f.active.get('analysis')!.release();
    await flush();
    assert.ok(f.active.has('conflict'));
    assert.ok(service.read(b.id, scope).tasks[0].attempts[0].timing?.phases?.readyQueue?.blockers['resource-conflict']);
    assert.equal(f.active.has('join'), false);
    f.active.get('profile')!.release();
    await flush();
    const join = f.active.get('join')!;
    assert.equal(join.context.dependencies.length, 2);
    assert.equal(new Set(join.context.dependencies.map(e => e.id)).size, 2);
    const read = service.read(a.id, scope);
    const earliestEnd = Math.min(...read.tasks.slice(0, 2).map(t => Date.parse(t.attempts[0].finishedAt!)));
    const latestStart = Math.max(...read.tasks.slice(0, 2).map(t => Date.parse(t.attempts[0].admittedAt)));
    assert.ok(latestStart <= earliestEnd);
    join.release();
    f.active.get('independent')!.release();
    f.active.get('conflict')!.release();
    await flush();
    assert.equal(service.read(a.id, scope).outcome, 'verified');
    assert.equal(service.read(b.id, scope).outcome, 'verified');
    assert.throws(() => service.read(a.id, { ...scope, projectId: 'other' }), /mission_not_found/);
  } finally { await service.close(); f.db.close(); }
});

test('verification failure, paused admission, evidence-bound amendment, and replay-safe retry', async () => {
  const f = fixture(), service = f.create();
  const read = (id: string) => service.read(id, scope);
  try {
    const m = service.create('failure', plan(task('inspect'), task('verify', ['inspect'])));
    await flush();
    const paused = service.control(m.id, scope, read(m.id).revision, { type: 'pause' });
    assert.equal(paused.disposition, 'paused');
    f.active.get('inspect')!.release(false);
    await flush();
    const failed = read(m.id);
    assert.equal(failed.tasks[0].attempts[0].verification?.passed, false);
    assert.equal(failed.tasks[1].attempts.length, 0);
    assert.throws(() => service.revise(m.id, scope, failed.revision, [{ ...task('other'), criterion: 'other' }], 'invalid criteria'),
      /invalid_mission_task/);
    const revised = service.revise(m.id, scope, failed.revision, [{ ...task('second-check', ['verify']), criterion: 'verify' }],
      'Evidence requires an additional check');
    assert.deepEqual(revised.criteria, failed.criteria);
    assert.equal(revised.objective, failed.objective);
    assert.throws(() => service.control(m.id, scope, failed.revision, { type: 'resume' }), /mission_revision_changed/);
    const retried = service.control(m.id, scope, revised.revision, { type: 'retry', taskId: 'inspect' });
    await flush();
    assert.equal(f.active.size, 0);
    service.control(m.id, scope, retried.revision, { type: 'resume' });
    await flush();
    f.active.get('inspect')!.release(true);
    await flush();
    f.active.get('verify')!.release(true);
    await flush();
    f.active.get('second-check')!.release(true);
    await flush();
    assert.equal(read(m.id).outcome, 'verified');
    assert.equal(read(m.id).tasks[0].attempts.length, 2);
    const final = read(m.id), profile = projectMissionExecution(final);
    const [first, retry, dependent] = profile.attempts;
    const requestEvent = final.events.find(event => event.kind === 'control' && event.detail === 'retry')!;
    const retryRequest = { eventSeq: requestEvent.seq, utc: requestEvent.time, clock: requestEvent.timing!.domain,
      monotonicMs: requestEvent.timing!.monotonicMs };
    assert.deepEqual(profile.work.retries, [{ taskId: 'inspect', previousAttemptId: first.id, attemptId: retry.id,
      previousOutcome: 'failed', previousSettlement: first.end, retryRequest, retryDispatch: retry.start,
      previousOccupiedMs: first.interval!.end - first.interval!.start,
      settlementToRetryRequestMs: retryRequest.monotonicMs - first.end!.monotonicMs!,
      retryRequestToDispatchMs: retry.start.monotonicMs! - retryRequest.monotonicMs,
      settlementToDispatchMs: retry.start.monotonicMs! - first.end!.monotonicMs! }]);
    assert.deepEqual(profile.work.occupancyByOutcome.find(item => item.outcome === 'failed'), {
      outcome: 'failed', attempts: 1, measuredAttempts: 1,
      clockSegments: [{ clock: first.interval!.clock, attemptIds: [first.id],
        workerMs: first.interval!.end - first.interval!.start }],
    });
    const withoutRequest = projectMissionExecution({ ...final, events: final.events.filter(event => event.seq !== requestEvent.seq) });
    assert.equal(withoutRequest.work.retries[0]?.retryRequest, null);
    assert.equal(withoutRequest.work.retries[0]?.settlementToRetryRequestMs, null);
    assert.equal(withoutRequest.work.retries[0]?.retryRequestToDispatchMs, null);
    assert.equal(withoutRequest.work.retries[0]?.settlementToDispatchMs, profile.work.retries[0]?.settlementToDispatchMs);
    const withoutPriorEvents = projectMissionExecution({ ...final, events: final.events.filter(event => event.attemptId !== first.id) });
    assert.equal(withoutPriorEvents.work.retries[0]?.previousAttemptId, first.id);
    assert.equal(withoutPriorEvents.work.retries[0]?.previousOccupiedMs, null);
    assert.equal(withoutPriorEvents.work.retries[0]?.settlementToDispatchMs, null);
    assert.deepEqual(withoutPriorEvents.work.occupancyByOutcome.find(item => item.outcome === 'failed'), {
      outcome: 'failed', attempts: 1, measuredAttempts: 0, clockSegments: [],
    });
    const crossClock = structuredClone(final);
    crossClock.events.find(event => event.seq === retry.start.eventSeq)!.timing!.domain = 'after-restart';
    const separated = projectMissionExecution(crossClock).work.retries[0];
    assert.equal(separated?.previousOccupiedMs, profile.work.retries[0].previousOccupiedMs);
    assert.equal(separated?.settlementToDispatchMs, null);
    assert.equal(separated?.settlementToRetryRequestMs, profile.work.retries[0]?.settlementToRetryRequestMs);
    assert.equal(separated?.retryRequestToDispatchMs, null);
    assert.ok(retry.phases!.readyQueue!.firstObservedMs >= first.end!.monotonicMs!);
    assert.ok(dependent.phases!.readyQueue!.firstObservedMs >= retry.end!.monotonicMs!);
  } finally { await service.close(); f.db.close(); }
});

test('a parallel retry preserves attempt timing and separates mixed usage receipts', async () => {
  const f = fixture();
  const executor = f.host.executors.fixture;
  const service = new MissionService({ ...f.host, executors: { fixture: {
    ...executor,
    async run(context) {
      const result = await executor.run(context);
      if (context.task.id === 'join') return { ...result, telemetry: { durationMs: 0, providerCalls: 0 } };
      const simulated = context.task.id === 'right';
      const usage = result.value === false ? undefined : { source: 'provider-reported' as const,
        inputTokens: 12, outputTokens: 8, totalTokens: 20, cachedInputTokens: simulated ? 0 : 4 };
      return { ...result, telemetry: { durationMs: 2, providerCalls: 1, usage,
        providerEvidence: simulated ? 'simulated' : 'reported', providerExecutionId: context.attemptId } };
    },
  } } });
  try {
    const { id } = service.create('parallel-retry-economics', plan(task('left'), task('right'), task('join', ['left', 'right'])));
    const read = () => service.read(id, scope);
    await flush();
    assert.ok(f.active.has('left') && f.active.has('right'));
    f.active.get('left')!.release(false);
    await flush();
    service.control(id, scope, read().revision, { type: 'retry', taskId: 'left' });
    await flush();
    assert.ok(f.active.has('left') && f.active.has('right'));
    f.active.get('right')!.release();
    await flush();
    assert.equal(f.active.has('join'), false);
    f.active.get('left')!.release();
    await flush();
    f.active.get('join')!.release();
    await flush();

    const settled = read();
    const profile = projectMissionExecution(settled);
    assert.equal(profile.outcome, 'verified');
    const [failed, parallel, retry, join] = profile.attempts;
    assert.equal(failed.state, 'failed');
    assert.deepEqual(retry.predecessors, [failed.id]);
    assert.deepEqual(join.predecessors, [retry.id, parallel.id]);
    assert.equal(profile.work.retries[0]?.previousAttemptId, failed.id);
    assert.equal(profile.work.retries[0]?.attemptId, retry.id);
    const duration = (attempt: typeof failed) => attempt.interval!.end - attempt.interval!.start;
    const expectedPathMs = Math.max(duration(failed) + duration(retry), duration(parallel)) + duration(join);
    assert.ok(Math.abs(profile.work.criticalPath!.durationMs - expectedPathMs) < 1e-6);
    assert.ok(Math.abs(profile.work.workerMs! - profile.attempts.reduce((sum, attempt) => sum + duration(attempt), 0)) < 1e-6);
    assert.equal(profile.work.peakWorkers, 2);
    assert.ok(profile.work.overlapMs! > 0);
    assert.ok(profile.admissionToLastSettlementMs! >= expectedPathMs);
    const { economics } = profile;
    assert.equal(economics.providerCalls, 3);
    assert.deepEqual(economics.usageReceipts, { reported: 1, simulated: 1, missing: 1, unattributed: 0 });
    assert.equal(economics.reportedTotalTokens, 20);
    assert.equal(economics.simulatedTotalTokens, 20);
    assert.equal(settled.profile.reportedTotalTokens, economics.reportedTotalTokens);
    assert.equal(settled.profile.verifiedObjectivesPerReportedToken, null);
    assert.deepEqual(economics.usageBySource.reported.cachedInputTokens, { observedTokens: 4, receipts: 1 });
    assert.deepEqual(economics.usageBySource.simulated.cachedInputTokens, { observedTokens: 0, receipts: 1 });
    assert.equal(economics.cost, null);
    assert.equal(economics.costCoverage, 'billing-receipt-unavailable');
  } finally { await service.close(); f.db.close(); }
});

test('restart reconciles a committed in-flight nonreplayable attempt as uncertain and never dispatches twice', async () => {
  const f = fixture(false), service = f.create();
  let recovered: MissionService | undefined;
  try {
    const m = service.create('recovery', plan(task('remote'), task('dependent', ['remote'])));
    await flush();
    assert.ok(f.active.has('remote'));
    // Copy the committed row to a fresh connection exactly as a restarted process sees it.
    const second = fixture(false);
    try {
      await second.create().close();
      const snapshot = f.db.prepare('SELECT * FROM vela_missions WHERE id=?').get(m.id)!;
      second.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,?,?,?)').run(snapshot.id, snapshot.request_id,
        snapshot.request_digest, snapshot.scope_key, snapshot.pending, snapshot.active, snapshot.json);
      second.db.exec('CREATE TABLE staged_recovery (seq INTEGER PRIMARY KEY)');
      const before = JSON.parse(String(snapshot.json)) as Mission;
      const recoveryHost: MissionServiceHost = { ...second.host, stagePublication(mission, from) {
        assert.equal(second.db.isTransaction, true);
        assert.equal(from, before.events.length);
        const row = second.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(mission.id)!;
        const persisted = JSON.parse(String(row.json)) as Mission;
        assert.equal(persisted.disposition, 'paused');
        for (const event of persisted.events.slice(from))
          second.db.prepare('INSERT INTO staged_recovery VALUES(?)').run(event.seq);
      } };
      recovered = new MissionService(recoveryHost);
      const observed = recovered.read(m.id, scope);
      assert.equal(observed.tasks[0].state, 'uncertain');
      assert.equal(observed.outcome, 'uncertain');
      assert.equal(observed.disposition, 'paused');
      const appended = observed.events.slice(before.events.length);
      assert.deepEqual(appended.map(event => event.kind), ['recovered', 'recovered']);
      assert.deepEqual(second.db.prepare('SELECT seq FROM staged_recovery ORDER BY seq').all().map(row => row.seq),
        appended.map(event => event.seq));
      assert.deepEqual(recovered.publicationEvent(m.id, appended[0].seq).event, appended[0]);
      assert.throws(() => recovered!.publicationEvent(m.id, observed.revision + 1), /mission_publication_event_not_found/);
      assert.throws(() => recovered!.control(m.id, scope, observed.revision, { type: 'retry', taskId: 'remote' }), /mission_retry_denied/);
      await flush();
      assert.equal(second.active.size, 0);
      await recovered.close();
      recovered = new MissionService(recoveryHost);
      assert.equal(recovered.read(m.id, scope).revision, observed.revision);
    } finally { await recovered?.close(); second.db.close(); }
  } finally { await service.close(); f.db.close(); }
});

test('a saturated worker budget is observed by every ready mission deferred in that scheduler pass', async () => {
  const f = fixture();
  const service = new MissionService({ ...f.host, admission: () => ({ workerLimit: 1, reasons: [], readings: {} }) });
  try {
    service.create('budget-running', plan(task('running')));
    await flush();
    const first = service.create('budget-first', plan(task('first')));
    const second = service.create('budget-second', plan(task('second')));
    await flush();
    assert.deepEqual([...f.active.keys()], ['running']);
    for (const mission of [first, second]) {
      const profile = projectMissionExecution(service.read(mission.id, scope, { includeReadyQueue: true }));
      const [queued] = profile.work.liveReadyQueue!.tasks;
      assert.equal(queued.wait, 'resource-pressure');
      assert.equal(queued.blockers['worker-budget']?.samples, 1);
    }
  } finally { await service.close(); f.db.close(); }
});

test('pressure defers admission and cancelling a branch preserves an independent branch', async () => {
  const f = fixture(), service = f.create();
  try {
    f.pressure(true);
    const m = service.create('pressure', plan(task('branch'), task('dependent', ['branch']), task('independent')));
    await flush();
    const waiting = service.read(m.id, scope);
    assert.equal(waiting.waits.branch, 'resource-pressure');
    assert.equal(waiting.waits.dependent, 'dependencies');
    assert.equal(f.active.size, 0);
    assert.equal(waiting.readyQueueObservation, undefined);
    assert.throws(() => service.read(m.id, { ...scope, workspaceId: 'unrelated' }, { includeReadyQueue: true }));
    const readProfile = () => projectMissionExecution(service.read(m.id, scope, { includeReadyQueue: true }));
    const queue = readProfile().work.liveReadyQueue;
    assert.equal(queue?.clock, service.fullProfilingClock());
    assert.deepEqual(queue?.tasks.map(task => task.taskId), ['branch', 'independent']);
    for (const task of queue!.tasks) {
      assert.equal(task.wait, 'resource-pressure');
      assert.ok(task.blockers['worker-budget']!.samples >= 1);
      assert.equal(task.elapsedSinceFirstObservedMs, queue!.monotonicMs - task.firstObservedMs);
      assert.ok(task.elapsedSinceFirstObservedMs >= 0);
    }
    f.pressure(false);
    service.control(m.id, scope, waiting.revision, { type: 'concurrency', concurrency: 2 });
    await flush();
    const admitted = readProfile();
    assert.equal(admitted.work.liveReadyQueue, null);
    for (const queued of queue!.tasks) {
      const attempt = admitted.attempts.find(attempt => attempt.taskId === queued.taskId);
      assert.equal(attempt?.phases?.readyQueue?.firstObservedMs, queued.firstObservedMs);
      assert.deepEqual(attempt?.phases?.readyQueue?.blockers, queued.blockers);
    }
    assert.equal(f.active.size, 2);
    const cancelling = service.control(m.id, scope, service.read(m.id, scope).revision, { type: 'cancel-branch', taskId: 'branch' });
    const open = projectMissionExecution(cancelling).work.live;
    assert.deepEqual(open?.attempts.map(attempt => [attempt.taskId, attempt.state, attempt.elapsedSinceDispatchMs]),
      [['branch', 'cancelling', null], ['independent', 'running', null]]);
    f.active.get('independent')!.release();
    await flush();
    const outcome = service.read(m.id, scope);
    assert.equal(outcome.tasks.find(t => t.id === 'branch')?.state, 'cancelled');
    assert.equal(outcome.tasks.find(t => t.id === 'dependent')?.state, 'cancelled');
    assert.equal(outcome.tasks.find(t => t.id === 'independent')?.state, 'verified');
    assert.equal(outcome.outcome, 'blocked');
    const profile = projectMissionExecution(outcome);
    const branch = profile.attempts.find(attempt => attempt.taskId === 'branch')!;
    const [cancel] = profile.work.cancellations;
    assert.equal(cancel.kind, 'cancel-branch');
    assert.equal(cancel.targetTaskId, 'branch');
    assert.deepEqual(cancel.attempts, [{ taskId: 'branch', attemptId: branch.id, outcome: 'cancelled',
      settlement: branch.end, requestToSettlementMs: branch.end!.monotonicMs! - cancel.request.monotonicMs! }]);
    const legacy = structuredClone(outcome);
    delete legacy.events.find(event => event.seq === cancel.request.eventSeq)!.cancellationRequestedAttemptIds;
    assert.equal(projectMissionExecution(legacy).work.cancellations[0].attempts, null);
    const afterRestart = structuredClone(outcome);
    afterRestart.events.find(event => event.seq === branch.end!.eventSeq)!.timing!.domain = 'after-restart';
    assert.equal(projectMissionExecution(afterRestart).work.cancellations[0].attempts?.[0].requestToSettlementMs, null);
    const cancelled = profile.work.occupancyByOutcome.find(item => item.outcome === 'cancelled');
    assert.equal(cancelled?.attempts, 1);
    assert.equal(cancelled?.measuredAttempts, 1);
    assert.deepEqual(cancelled?.clockSegments[0].attemptIds, [branch.id]);
    f.pressure(true);
    const queued = service.create('cancel-before-dispatch', plan(task('queued')));
    const stopped = service.control(queued.id, scope, queued.revision, { type: 'cancel' });
    assert.deepEqual(projectMissionExecution(stopped).work.cancellations[0].attempts, []);
  } finally { await service.close(); f.db.close(); }
});

test('host admission holds queued work, preserves running workers and records only dispatched attempts', async () => {
  const f = fixture(), demand: boolean[] = [];
  const observedAt = new Date().toISOString();
  const memory: MissionAdmission = { workerLimit: 0, reasons: ['physical-memory'],
    readings: { availableMemoryBytes: { value: 256 * 1024 * 1024, observedAt } } };
  const cpu: MissionAdmission = { workerLimit: 1, reasons: ['cpu-load'], readings: { cpuPercent: { value: 95, observedAt } } };
  const normal: MissionAdmission = { workerLimit: 3, reasons: [], readings: { cpuPercent: { value: 40, observedAt } } };
  let policy = memory;
  const service = new MissionService({ ...f.host, admission: needed => { demand.push(needed); return policy; } });
  try {
    const { id } = service.create('sampled-admission', plan(task('first'), task('second'), task('third')));
    const read = () => service.read(id, scope);
    await flush();
    const samples = demand.length;
    const held = read();
    assert.equal(held.waits.first, 'resource-pressure');
    assert.deepEqual(held.admission, memory);
    assert.ok(held.tasks.every(task => !task.attempts.length));
    const heldPolicy = projectMissionExecution(held).resourcePolicy;
    assert.equal(heldPolicy.currentAdmission?.workerLimit, 0);
    assert.deepEqual(heldPolicy.currentAdmission?.reasons, ['physical-memory']);
    assert.equal(heldPolicy.currentAdmission?.observedAt.availableMemoryBytes, observedAt);
    assert.equal(heldPolicy.admittedAttemptsWithSample, 0);
    assert.equal(demand.length, samples, 'projection must not trigger admission sampling');

    policy = normal;
    service.capacityChanged();
    await flush();
    assert.deepEqual([...f.active.keys()], ['first', 'second']);
    assert.deepEqual(read().tasks[0].attempts[0].admission, normal);
    policy = cpu;
    service.capacityChanged();
    await flush();
    assert.deepEqual([...f.active.keys()], ['first', 'second']);
    assert.ok([...f.active.values()].every(worker => !worker.context.signal.aborted));
    f.active.get('first')!.release();
    await flush();
    assert.equal(read().waits.third, 'resource-pressure');
    assert.deepEqual(read().admission, cpu);
    assert.deepEqual([...f.active.keys()], ['second']);
    f.active.get('second')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['third']);
    const started = read().tasks[2].attempts[0];
    assert.deepEqual(started.admission, cpu);
    const phases = started.timing?.phases;
    assert.ok(phases?.readyQueue);
    assert.ok(phases.readyQueue.firstObservedMs <= phases.contextAssembly[0]);
    assert.ok(phases.readyQueue.blockers['worker-budget']!.samples >= 1);
    assert.ok(phases.readyQueue.blockers['worker-budget']!.lastObservedMs < phases.contextAssembly[0]);
    assert.equal(demand.at(-1), false);
    f.active.get('third')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
    const profile = projectMissionExecution(read());
    const third = profile.attempts.find(attempt => attempt.taskId === 'third')!;
    assert.deepEqual(third.resourceAdmission?.reasons, ['cpu-load']);
    assert.equal(third.resourceAdmission?.observedAt.cpuPercent, observedAt);
    assert.equal(third.resourceAdmission?.observedAt.gpuEnginePercent, null);
    assert.deepEqual(profile.resourcePolicy, { currentAdmission: null, admittedAttemptsWithSample: 3,
      admittedAttemptsWithoutSample: 0, admittedAttemptsWithReasons: 1, attemptsByReason: { 'cpu-load': 1 },
      leaseCoverage: { withReceipt: 0, withoutReceipt: 3, attemptsByKind: {} } });
    assert.equal(third.readyQueueMs, phases.contextAssembly[0] - phases.readyQueue.firstObservedMs);
    assert.equal(read().admission, undefined);
    assert.deepEqual(read().tasks[2].attempts[0].admission, cpu);
  } finally { await service.close(); f.db.close(); }
});

test('queued admission resamples and recovers without an external wake signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let workerLimit = 0;
  const service = new MissionService({ ...f.host, admission: () => ({ workerLimit, reasons: [], readings: {} }) });
  try {
    const { id } = service.create('admission-recheck', plan(task('waiting')));
    await flush();
    assert.equal(service.read(id, scope).waits.waiting, 'resource-pressure');
    workerLimit = 1;
    t.mock.timers.tick(1500);
    await flush();
    assert.deepEqual([...f.active.keys()], ['waiting']);
    f.active.get('waiting')!.release();
    await flush();
    assert.equal(service.read(id, scope).outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('ready tasks honor aging, explicit priority and the longest feasible dependency path', async () => {
  const f = fixture();
  let limit = 0;
  const service = new MissionService({ ...f.host, admission: () => ({ workerLimit: limit, reasons: [], readings: {} }) });
  try {
    const { id } = service.create('admission-order', plan(task('ordinary'), task('urgent'), task('critical'),
      task('tail', ['critical']), task('aged')));
    const read = () => service.read(id, scope);
    const priority = service.control(id, scope, read().revision, { type: 'priority', taskId: 'urgent', priority: 2 });
    service.control(id, scope, priority.revision, { type: 'priority', taskId: 'aged', priority: -2 });
    const row = f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(id)!;
    const stored = JSON.parse(String(row.json)) as Mission;
    stored.tasks.find(task => task.id === 'aged')!.queuedAt = new Date(Date.now() - 31_000).toISOString();
    f.db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(stored), id);
    limit = 1;
    service.capacityChanged();
    await flush();
    for (const id of ['aged', 'urgent', 'critical']) {
      assert.deepEqual([...f.active.keys()], [id]);
      f.active.get(id)!.release();
      await flush();
    }
    assert.deepEqual([...f.active.keys()], ['ordinary']);
    f.active.get('ordinary')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['tail']);
    f.active.get('tail')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed replacement preserves failed evidence and rewires dispatch after reopening', async () => {
  const f = revisionFixture();
  let service = f.create();
  const original = plan(revisionTask('prerequisite', 'sample.cpu'),
    { ...revisionTask('probe', 'sample.ram', ['prerequisite']), claims: [{ resource: 'memory', mode: 'exclusive' }] },
    revisionTask('report', 'join.samples', ['probe']));
  const change = { type: 'replace', taskId: 'probe' } as const;
  try {
    const { id } = service.create('reviewed-replacement', original);
    const read = () => service.read(id, scope);
    await flush();
    f.active.get('prerequisite')!.release();
    await flush();
    const paused = service.control(id, scope, read().revision, { type: 'pause' });
    assert.throws(() => service.previewRevision(id, scope, paused.revision, change), /mission_revision_denied/);
    f.active.get('probe')!.release(false);
    await flush();
    const failed = read();
    const originalProbe = failed.tasks.find(node => node.id === 'probe')!;
    assert.equal(originalProbe.state, 'failed');
    const trigger = failed.events.findLast(event => event.kind === 'settled')!;
    const executive = await proposeMissionExecutiveRevision(trigger.seq, {
      read,
      disclose: async packet => ({
        version: 1, action: 'replace', target: packet.trigger.task, related: [],
        reason: 'The probe failed verification with a known outcome.',
      }),
      preview: (revision, proposal) => service.previewRevision(id, scope, revision, proposal),
    });
    assert.equal(executive.state, 'reviewable');
    if (executive.state !== 'reviewable') assert.fail('expected a reviewable proposal');
    assert.deepEqual(executive.change, change);
    const review = executive.preview;
    assert.deepEqual(read(), failed, 'Preview does not change the journal');
    assert.throws(() => service.applyRevision(id, scope, failed.revision, change, '0'.repeat(64)), /mission_revision_preview_changed/);
    const revised = service.applyRevision(id, scope, failed.revision, change, review.fingerprint);
    const replacement = revised.tasks.find(node => node.criterion === originalProbe.criterion)!;
    assert.ok(replacement && replacement.id !== originalProbe.id);
    assert.deepEqual(replacement.dependencies, ['prerequisite']);
    assert.deepEqual(replacement.claims, originalProbe.claims);
    assert.equal(replacement.objective, originalProbe.objective);
    assert.equal(replacement.executor, originalProbe.executor);
    assert.equal(replacement.maxAttempts, originalProbe.maxAttempts - originalProbe.attempts.length);
    assert.deepEqual(revised.tasks.find(node => node.id === 'report')?.dependencies, [replacement.id]);
    assert.deepEqual(revised.retiredTasks?.find(node => node.id === 'probe')?.attempts, originalProbe.attempts);
    assert.deepEqual(revised.criteria, original.criteria);
    assert.equal(revised.objective, original.objective);
    assert.equal(revised.planRevision, failed.planRevision + 1);
    assert.deepEqual(revised.events.find(event => event.kind === 'revised')?.change, change);
    assert.throws(() => service.applyRevision(id, scope, failed.revision, change, review.fingerprint), /mission_revision_changed/);

    await service.close();
    service = f.create();
    assert.deepEqual(read().retiredTasks, revised.retiredTasks);
    assert.equal(read().disposition, 'paused');
    await flush();
    assert.equal(f.active.size, 0);
    service.control(id, scope, read().revision, { type: 'resume' });
    await flush();
    assert.deepEqual([...f.active.keys()], [replacement.id]);
    assert.equal(f.active.get(replacement.id)?.context.dependencies[0]?.attemptId, failed.tasks[0].attempts[0].id);
    f.active.get(replacement.id)!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['report']);
    assert.equal(f.active.get('report')?.context.dependencies[0]?.attemptId,
      read().tasks.find(node => node.id === replacement.id)?.attempts[0].id);
    f.active.get('report')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed edges enforce origin, revision, graph validity and dependency order', async () => {
  const f = revisionFixture();
  const workroomScope = { ...scope, workspaceId: 'workroom' };
  const service = new MissionService({ ...f.host, authorized: candidate => f.host.authorized(candidate) ||
    candidate.projectId === workroomScope.projectId && candidate.workspaceId === workroomScope.workspaceId });
  const change = { type: 'dependencies' as const, taskId: 'ram', dependencies: ['cpu'] };
  try {
    const { id, revision } = service.create('reviewed-edges', plan(revisionTask('cpu', 'sample.cpu'),
      revisionTask('ram', 'sample.ram'), revisionTask('report', 'join.samples', ['ram']),
      revisionTask('project-tests', 'codex.project-check')));
    const read = () => service.read(id, scope);
    assert.throws(() => service.previewRevision(id, scope, revision, change), /mission_revision_denied/);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const attached = service.attachWorkroom(id, scope, { kind: 'workroom', workspaceId: workroomScope.workspaceId,
      title: 'Synthetic workroom', templateId: 'fixture' });
    assert.equal(service.read(id, workroomScope).id, id);
    assert.throws(() => service.previewRevision(id, workroomScope, attached.revision, change), /mission_revision_denied/);
    assert.throws(() => service.previewRevision(id, { ...scope, projectId: 'other' }, attached.revision, change), /mission_not_found|mission_revision_denied/);
    assert.throws(() => service.previewRevision(id, scope, paused.revision, change), /mission_revision_changed/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['report'] }), /mission_dependency_cycle/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['missing'] }), /missing_mission_dependency/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['cpu', 'cpu'] }), /invalid_mission_revision/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, taskId: 'report', dependencies: [] }), /mission_revision_dependency_denied/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { type: 'replace', taskId: 'project-tests' }), /mission_revision_task_denied/);
    const review = service.previewRevision(id, scope, attached.revision, change);
    assert.throws(() => service.applyRevision(id, scope, attached.revision, { ...change, taskId: 'cpu', dependencies: ['ram'] },
      review.fingerprint), /mission_revision_preview_changed/);
    const revised = service.applyRevision(id, scope, attached.revision, change, review.fingerprint);
    await flush();
    assert.equal(f.active.size, 0);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    assert.deepEqual([...f.active.keys()].sort(), ['cpu', 'project-tests']);
    f.active.get('cpu')!.release();
    await flush();
    assert.equal(f.active.get('ram')?.context.dependencies[0]?.attemptId, read().tasks[0].attempts[0].id);
    assert.ok(!f.active.has('report'));
    f.active.get('ram')!.release();
    f.active.get('project-tests')!.release();
    await flush();
    f.active.get('report')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed changes consume the existing mission revision budget', async () => {
  const f = revisionFixture(), service = f.create();
  try {
    const { id, revision } = service.create('reviewed-revision-budget', plan(revisionTask('cpu', 'sample.cpu'), revisionTask('ram', 'sample.ram')));
    let current = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'dependencies' as const, taskId: 'ram' };
    for (let index = 0; index < MISSION_LIMITS.revisions; index++) {
      const next = { ...change, dependencies: index % 2 === 0 ? ['cpu'] : [] };
      const preview = service.previewRevision(id, scope, current.revision, next);
      current = service.applyRevision(id, scope, current.revision, next, preview.fingerprint);
    }
    assert.equal(current.events.filter(event => event.kind === 'revised').length, MISSION_LIMITS.revisions);
    assert.throws(() => service.previewRevision(id, scope, current.revision, { ...change, dependencies: ['cpu'] }), /mission_revision_denied/);
    await flush();
    assert.equal(f.active.size, 0);
  } finally { await service.close(); f.db.close(); }
});

test('retiring an equivalent task preserves acceptance and the successor prerequisites', async () => {
  const f = revisionFixture(), service = f.create();
  const obsolete = revisionTask('obsolete', 'sample.ram', ['required']);
  const original = plan(revisionTask('required', 'sample.cpu'), revisionTask('extra', 'sample.cpu'), obsolete,
    { ...obsolete, id: 'weaker', dependencies: [] }, { ...obsolete, id: 'successor', dependencies: ['required', 'extra'] },
    revisionTask('report', 'join.samples', ['obsolete']));
  original.criteria = [...new Set(original.criteria)];
  try {
    const { id, revision } = service.create('reviewed-retirement', original);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'retire', taskId: 'obsolete', successorId: 'successor' } as const;
    assert.throws(() => service.previewRevision(id, scope, paused.revision, { ...change, successorId: 'weaker' }),
      /mission_revision_task_denied|mission_revision_dependency_denied/);
    const preview = service.previewRevision(id, scope, paused.revision, change);
    const revised = service.applyRevision(id, scope, paused.revision, change, preview.fingerprint);
    assert.ok(!revised.tasks.some(node => node.id === 'obsolete'));
    assert.equal(revised.retiredTasks?.at(-1)?.id, 'obsolete');
    assert.deepEqual(revised.criteria, original.criteria);
    assert.deepEqual(revised.tasks.find(node => node.id === 'report')?.dependencies, ['successor']);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    f.active.get('required')!.release();
    await flush();
    assert.ok(!f.active.has('successor'));
    assert.ok(!f.active.has('report'));
    f.active.get('extra')!.release();
    f.active.get('weaker')!.release();
    await flush();
    assert.ok(!f.active.has('obsolete'));
    assert.equal(f.active.get('successor')?.context.dependencies.length, 2);
    f.active.get('successor')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['report']);
    f.active.get('report')!.release();
    await flush();
    assert.equal(service.read(id, scope).outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed specialist reassignment binds the current trusted profile and refuses attempted work', async () => {
  const specialist = (id: string, version: number): NonNullable<MissionTaskPlan['specialist']> => ({
    role: id, instructions: `Synthetic instructions for ${id}`, provider: 'chatgpt-plan-responses', model: 'fixture-model',
    connectionVersion: 1, settingsStamp: 'synthetic-settings', profile: { id, title: id,
      profileVersion: version, resourceVersion: version, instructions: `Synthetic profile ${version}` },
  });
  let version = 1;
  const f = revisionFixture((_mission, _task, id) => id === 'approved' ? specialist(id, version) : undefined);
  const service = f.create();
  try {
    const original = plan({ ...revisionTask('analysis', 'chatgpt.specialist'), specialist: specialist('original', 1) },
      revisionTask('report', 'join.samples', ['analysis']));
    const { id, revision } = service.create('reviewed-reassignment', original);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'reassign', taskId: 'analysis', agentProfileId: 'approved' } as const;
    assert.throws(() => service.previewRevision(id, scope, paused.revision, { ...change, agentProfileId: 'unavailable' }),
      /mission_revision_reassignment_unavailable/);
    const review = service.previewRevision(id, scope, paused.revision, change);
    version++;
    assert.throws(() => service.applyRevision(id, scope, paused.revision, change, review.fingerprint), /mission_revision_preview_changed/);
    const fresh = service.previewRevision(id, scope, paused.revision, change);
    const revised = service.applyRevision(id, scope, paused.revision, change, fresh.fingerprint);
    assert.deepEqual(revised.tasks[0].specialist, specialist('approved', 2));
    assert.deepEqual(revised.criteria, original.criteria);
    assert.equal(revised.tasks[0].objective, original.tasks[0].objective);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    assert.deepEqual(f.active.get('analysis')?.context.task.specialist, specialist('approved', 2));
    service.control(id, scope, service.read(id, scope).revision, { type: 'pause' });
    f.active.get('analysis')!.release();
    await flush();
    const verified = service.read(id, scope);
    assert.equal(verified.tasks[0].state, 'verified');
    assert.throws(() => service.previewRevision(id, scope, verified.revision, change), /mission_revision_task_denied/);
  } finally { await service.close(); f.db.close(); }
});
