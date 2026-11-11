import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Backend } from '../src/service.mts';
import type { ChecklistDocument, ChecklistMutationResult } from '../../application-contract/checklist.ts';
import type { TimelineDocument } from '../../timeline-product/contracts.ts';
import type { NoteDocument } from '../../block-library/note-contracts.ts';
import type { VelaState } from '../../vela-core/src/contracts.ts';
import type { MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomDashboard, MissionWorkroomPreview, MissionWorkroomResource } from '../src/mission-contracts.mts';
import type { MissionExecutionProfile } from '../src/execution-profiler.mts';

type EvidenceRow = Extract<MissionWorkroomDashboard, { kind: 'evidence' }>['rows'][number];

async function linkedCard(backend: Backend, resourceId: string): Promise<MissionWorkroomResource | null> {
  const result = await backend.call('missions', { name: 'workroom-resource', input: { resourceId } });
  assert.ok(result === null || 'kind' in result && result.kind === 'workroom-resource');
  return result;
}

test('native mission scopes Notes to its originating project and rechecks evidence after a canonical edit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-context-test-'));
  const backend = new Backend({ path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' });
  try {
    async function createRoom(title: string) {
      const created = await backend.call('desktop', { type: 'createProject', title });
      const projectId = created.projects.find(project => project.title === title)!.id;
      const desktop = await backend.call('desktop', { type: 'createWorkspace', title: title + ' workspace', projectId });
      return desktop.workspaces.find(workspace => workspace.project_id === projectId)!.id;
    }
    const workspaceId = await createRoom('Synthetic mission source project');
    const other = await createRoom('Other synthetic source project');
    const navigate = (id: string) => backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: id } });
    async function createNote(id: string) {
      await navigate(id);
      const desktop = await backend.call('desktop', { type: 'createResource', kind: 'note', title: 'Backend performance notes', workspaceId: id });
      return desktop.blocks.find(block => block.workspace_id === id && block.resource_id)!.resource_id!;
    }
    async function edit(resourceId: string, content: string) {
      const { result } = await backend.call('notes', { name: 'readNote', input: resourceId });
      const doc = result as NoteDocument;
      await backend.call('notes', { name: 'commitNote', input: { resourceId, expectedResourceVersion: doc.resource.version,
        expectedDraftVersion: doc.draftRevision, content } });
    }
    const note = await createNote(workspaceId);
    const unrelated = await createNote(other);
    await edit(unrelated, 'Synthetic backend performance report from the other project.');
    await navigate(workspaceId);
    await edit(note, 'Synthetic backend performance timing baseline and code sampling notes.');
    const objective = 'Investigate Aerynth backend performance using workspace notes';
    const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const { id } = await backend.call('missions', { name: 'start',
      input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } }) as MissionProjection;
    await navigate(other);
    await delay(500);
    await navigate(workspaceId);
    const read = () => backend.call('missions', { name: 'read', input: { id } }) as Promise<MissionProjection>;
    let mission = await read();
    const expires = performance.now() + 3000;
    while (['running', 'queued'].includes(mission.outcome) && performance.now() < expires) { await delay(25); mission = await read(); }
    assert.equal(mission.outcome, 'verified', JSON.stringify(mission.tasks.map(task => [task.id, task.state, task.detail])));
    assert.deepEqual(mission.tasks.find(task => task.id === 'notes')?.attempts[0].context?.sources.map(source => source.ref.id), [note]);
    assert.equal(JSON.stringify(mission).includes('timing baseline'), false, 'The journal should contain references rather than note bodies');
    const review = await backend.call('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
    assert.ok(review.cards.some(card => card.title === 'Backend performance notes' && card.mode === 'reference'));
    const room = await backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: review.reviewId } }) as MissionWorkroom;
    const evidenceId = room.missionCards?.evidence;
    assert.ok(evidenceId);
    const opened = await navigate(room.workspaceId);
    assert.ok(opened.blocks.some(block => block.workspace_id === room.workspaceId && block.resource_id === note));
    assert.ok(!opened.blocks.some(block => block.workspace_id === room.workspaceId && block.resource_id === unrelated));
    const originalEvidence = (await linkedCard(backend, evidenceId))?.dashboard;
    assert.ok(originalEvidence?.kind === 'evidence');
    assert.equal(originalEvidence.rows.find(row => row.taskId === 'notes')?.evidenceId,
      mission.tasks.find(task => task.id === 'notes')?.attempts[0].evidence?.id);
    assert.equal(JSON.stringify(originalEvidence).includes('timing baseline'), false);
    await navigate(workspaceId);
    await edit(note, 'Edited synthetic backend performance timing and sampling notes.');
    const stale = await read();
    assert.equal(stale.outcome, 'blocked');
    for (const taskId of ['notes', 'report']) {
      const task = stale.tasks.find(candidate => candidate.id === taskId)!;
      assert.equal(task.state, 'blocked');
      assert.equal(task.attempts[0].evidence, undefined);
    }
    const linkedWorkspace = await navigate(room.workspaceId);
    const staleEvidence = (await linkedCard(backend, evidenceId))?.dashboard;
    assert.ok(staleEvidence?.kind === 'evidence');
    for (const taskId of ['notes', 'report']) {
      const row: EvidenceRow | undefined = staleEvidence.rows.find(item => item.taskId === taskId);
      assert.equal(row?.state, 'blocked');
      assert.equal(row?.evidenceId, undefined);
      assert.equal(row?.passed, undefined);
    }
    const originVersion = linkedWorkspace.workspaces.find(workspace => workspace.id === workspaceId)!.version;
    const archived = await backend.call('desktop', { type: 'archiveWorkspace', workspaceId, expectedVersion: originVersion, archived: true });
    assert.equal(archived.activeWorkspaceId, room.workspaceId);
    assert.deepEqual(archived.missionWorkroomCardIds ?? [], []);
    assert.equal(await linkedCard(backend, evidenceId), null);
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-context-test-'));
    rmSync(target, { recursive: true, force: true });
  }
});

test('canonical backend runs a native mission without inference, restores evidence and fences workspace scope', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-test-'));
  const options = { path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options);
  try {
    assert.equal(await backend.call('missions', { name: 'preview', input: { objective: 'Measure CPU and RAM' } }), null);
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic mission workspace', projectId: null });
    const workspaceId = desktop.workspaces[0].id;
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const objective = 'Investigate Aerynth backend performance';
    const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    assert.equal(preview.plan.scope.workspaceId, workspaceId);
    assert.equal(preview.plan.tasks.length, 5);
    const providerActivity = await backend.call('providerActivity', {});
    await assert.rejects(backend.call('missions', { name: 'start', input: { objective, fingerprint: 'stale', requestId: randomUUID() } }),
      /mission_preview_changed/);
    const { id } = await backend.call('missions', { name: 'start',
      input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } }) as MissionProjection;
    const read = async () => await backend.call('missions', { name: 'read', input: { id } }) as MissionProjection;
    let mission = await read();
    const expires = performance.now() + 7000;
    while (['running', 'queued'].includes(mission.outcome) && performance.now() < expires) {
      await delay(25); mission = await read();
    }
    assert.equal(mission.outcome, 'verified', JSON.stringify(mission.tasks.map(t => [t.id, t.state, t.detail])));
    const backendAttempt = mission.tasks.find(t => t.id === 'backend')!.attempts[0];
    const cpu = mission.tasks.find(t => t.id === 'cpu')!.attempts[0];
    assert.ok(Date.parse(cpu.admittedAt) < Date.parse(backendAttempt.finishedAt!));
    assert.ok(Date.parse(backendAttempt.admittedAt) < Date.parse(cpu.finishedAt!));
    assert.ok((mission.tasks.find(t => t.id === 'report')?.attempts[0].context?.dependencies.length ?? 0) >= 4);
    assert.equal(mission.tasks.find(t => t.id === 'code')?.attempts[0].evidence?.source, 'aerynth.shipped-backend-source');
    assert.equal(mission.tasks.find(t => t.id === 'code')?.attempts[0].resourceLease?.kind, 'cpu');
    assert.equal(mission.tasks.find(t => t.id === 'code')?.attempts[0].resourceLease?.reservedRamBytes, 64 * 2 ** 20);
    assert.deepEqual(await backend.call('providerActivity', {}), providerActivity);
    assert.equal(mission.profile.providerCalls, 0);
    assert.ok(mission.profile.peakWorkers >= 2);
    assert.equal(mission.profile.reportedTotalTokens, null);
    const readProfile = () => backend.call('missions', { name: 'execution-profile', input: { id } });
    const profile = await readProfile();
    assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
    assert.deepEqual(profile.attempts.map(attempt => attempt.id).sort(),
      mission.tasks.flatMap(task => task.attempts.map(attempt => attempt.id)).sort());
    assert.equal(profile.resourcePolicy.admittedAttemptsWithSample, profile.attempts.length);
    assert.equal(profile.resourcePolicy.currentAdmission, null);
    for (const task of mission.tasks) for (const attempt of task.attempts) {
      const admission: MissionExecutionProfile['attempts'][number]['resourceAdmission'] | undefined =
        profile.attempts.find(item => item.id === attempt.id)?.resourceAdmission;
      assert.ok(admission && attempt.admission?.readings.availableMemoryBytes);
      assert.deepEqual(admission.reasons, attempt.admission.reasons);
      assert.equal(admission.observedAt.availableMemoryBytes, attempt.admission.readings.availableMemoryBytes.observedAt);
    }
    assert.equal(profile.economics.usageCoverage, 'not-applicable');
    assert.equal(profile.economics.costCoverage, 'not-applicable');
    assert.deepEqual(profile.economics.usageGaps, []);
    assert.ok(profile.work.criticalPath);
    const readiness = profile.work.dependencyReadinessPath;
    assert.ok(readiness);
    assert.equal(readiness.attempts.at(-1)?.settledMs, profile.lastSettlement?.monotonicMs);
    assert.ok(readiness.elapsedMs <= profile.admissionToLastSettlementMs!);
    assert.ok(readiness.entry && readiness.entry.attemptId === readiness.attempts[0].attemptId);
    assert.equal(readiness.entry.admissionEventSeq, profile.admission?.eventSeq);
    assert.ok(Math.abs(readiness.entry.elapsedMs + readiness.elapsedMs - profile.admissionToLastSettlementMs!) < 0.001);
    const segment = readiness.largestMeasuredSegment;
    assert.ok(segment && readiness.attempts.some(attempt => attempt.attemptId === segment.attemptId));
    assert.equal(segment.durationMs, segment.endedMs - segment.startedMs);
    assert.ok(segment.startedMs >= readiness.attempts[0].assemblyStartedMs);
    assert.ok(segment.durationMs <= readiness.elapsedMs);
    assert.equal(readiness.readyQueueCoverage.observedEdges, readiness.readyQueueCoverage.totalEdges);
    assert.ok(readiness.readyQueueCoverage.observedEdges > 0);
    assert.ok(Math.abs(readiness.betweenAttemptsMs - readiness.observedReadyBetweenAttemptsMs! -
      readiness.unattributedBetweenAttemptsMs) < 0.001);
    assert.ok(profile.requestIntake && profile.admission && profile.requestIntake.clock === profile.admission.clock);
    assert.ok(profile.intakeToAdmissionMs! >= 0);
    assert.deepEqual(profile.requestAcknowledgement, {
      source: 'mission-created', event: profile.admission, intakeToAcknowledgementMs: profile.intakeToAdmissionMs,
    });
    const { first, last } = profile.verifiedTaskMilestones;
    assert.ok(first && last && first.settlement.eventSeq < last.settlement.eventSeq);
    assert.equal(first.intakeToSettlementMs, first.settlement.monotonicMs! - profile.requestIntake.monotonicMs);
    assert.equal(last.intakeToSettlementMs, last.settlement.monotonicMs! - profile.requestIntake.monotonicMs);
    assert.ok(last.intakeToSettlementMs! >= first.intakeToSettlementMs!);
    assert.equal(profile.userDelivery, null);
    const other = await backend.call('desktop', { type: 'createWorkspace', title: 'Other synthetic workspace', projectId: null });
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: other.workspaces.find(w => w.id !== workspaceId)!.id } });
    await assert.rejects(read(), /mission_not_found/);
    await assert.rejects(readProfile(), /mission_not_found/);
    await backend.close();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    assert.deepEqual(await read(), mission);
    assert.deepEqual(await readProfile(), profile);
    const prior = await backend.call('desktop', { type: 'snapshot' });
    const draft = await backend.call('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
    assert.deepEqual(draft.cards[0], { title: 'Mission graph', kind: 'note', mode: 'new' });
    assert.equal(draft.cards[1].kind, 'conversation');
    assert.equal(draft.cards[1].mode, 'new');
    assert.deepEqual(draft.cards.filter(card => card.kind === 'checklist' || card.kind === 'timeline'), [
      { title: 'Mission checklist', kind: 'checklist', mode: 'new' },
      { title: 'Mission timeline', kind: 'timeline', mode: 'new' },
    ]);
    assert.equal((await backend.call('desktop', { type: 'snapshot' })).workspaces.length, prior.workspaces.length);
    await assert.rejects(backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: 'wrong' } }),
      /mission_workroom_review_required/);
    const room = await backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: draft.reviewId } }) as MissionWorkroom;
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    const projected = await read();
    assert.equal(projected.scope.workspaceId, workspaceId);
    assert.deepEqual(projected.workroom, room);
    assert.deepEqual(projected.tasks, mission.tasks);
    assert.deepEqual(projected.profile, mission.profile, 'Creating a workspace must not add to completed mission elapsed time');
    assert.deepEqual(await backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: draft.reviewId } }), room);
    const built = await backend.call('desktop', { type: 'snapshot' });
    assert.equal(built.workspaces.length, prior.workspaces.length + 1);
    const { missionChecklistResourceId: checklistId, missionTimelineResourceId: timelineId } = room;
    const cardIds = room.missionCards;
    assert.ok(cardIds?.graph && cardIds.evidence && cardIds.performance && cardIds.stream && !cardIds.team);
    assert.deepEqual(new Set(built.missionWorkroomCardIds), new Set(Object.values(cardIds)));
    assert.ok(checklistId && timelineId && checklistId !== timelineId);
    assert.ok([checklistId, timelineId, ...Object.values(cardIds)].every(resourceId => built.blocks.some(block =>
      block.workspace_id === room.workspaceId && block.resource_id === resourceId)));
    const chat = built.resources.find(resource => resource.kind === 'conversation' && resource.title === draft.cards[1].title &&
      built.blocks.some(block => block.workspace_id === room.workspaceId && block.resource_id === resource.id));
    assert.equal(chat?.providerId, 'local');
    const checklistLink = await linkedCard(backend, checklistId);
    const timelineLink = await linkedCard(backend, timelineId);
    assert.deepEqual(checklistLink, { kind: 'workroom-resource', missionId: id, revision: projected.revision, outcome: 'verified',
      checklist: projected.tasks.map(task => ({ taskId: task.id, title: task.objective, state: task.state })) });
    assert.deepEqual(timelineLink, { kind: 'workroom-resource', missionId: id, revision: projected.revision,
      outcome: 'verified', timeline: projected.events });
    const graphLink = await linkedCard(backend, cardIds.graph);
    assert.deepEqual(graphLink?.dashboard, { kind: 'graph', objective, planRevision: projected.planRevision,
      tasks: projected.tasks.map(task => ({ id: task.id, title: task.objective, state: task.state,
        dependencies: task.dependencies, executor: task.executor })) });
    assert.deepEqual((await linkedCard(backend, cardIds.performance))?.dashboard, { kind: 'performance', profile: projected.profile });
    const evidenceLink = await linkedCard(backend, cardIds.evidence);
    assert.ok(evidenceLink?.dashboard?.kind === 'evidence');
    assert.deepEqual(evidenceLink.dashboard.criteria, projected.criteria);
    for (const task of projected.tasks) {
      const attempt = task.attempts.at(-1)!;
      const row: EvidenceRow | undefined = evidenceLink.dashboard.rows.find(item => item.taskId === task.id);
      assert.equal(row?.evidenceId, attempt.evidence?.id);
      assert.equal(row?.source, attempt.evidence?.source);
      assert.equal(row?.passed, attempt.verification?.passed);
    }
    const readChecklist = async () => (await backend.call('checklists', { name: 'read', input: { resourceId: checklistId } })).result as ChecklistDocument;
    const readTimeline = async () => (await backend.call('timelines', { name: 'read', input: { resourceId: timelineId } })).result as TimelineDocument;
    const checklist = await readChecklist();
    assert.deepEqual(checklist.entries, []);
    const added = (await backend.call('checklists', { name: 'mutate', input: { commandId: randomUUID(), resourceId: checklistId,
      expectedVersion: checklist.resource.version, operations: [{ type: 'addEntry', key: 'manual', entry: { text: 'Manual follow-up' } }],
    } })).result as ChecklistMutationResult;
    const timeline = await readTimeline();
    assert.equal(timeline.resource.kind, 'timeline');
    const displayTimeZone = timeline.view.viewport.displayTimeZone === 'UTC' ? 'America/New_York' : 'UTC';
    const view = { ...timeline.view, viewport: { ...timeline.view.viewport, displayTimeZone } };
    await backend.call('timelines', { name: 'save', input: { commandId: randomUUID(), resourceId: timelineId,
      expectedVersion: timeline.resource.version, view } });
    const updatedTimeline = await readTimeline();
    const graph = built.resources.find(resource => resource.id === cardIds.graph)!;
    const origin = await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    await backend.call('library', { name: 'attachBlock', input: { commandId: randomUUID(), workspaceId,
      expectedLayoutVersion: origin.layoutVersion, kind: 'timeline', resourceId: timelineId,
      expectedResourceVersion: updatedTimeline.resource.version } });
    const originWithTimeline = await backend.call('desktop', { type: 'snapshot' });
    await backend.call('library', { name: 'attachBlock', input: { commandId: randomUUID(), workspaceId,
      expectedLayoutVersion: originWithTimeline.layoutVersion, kind: 'note', resourceId: graph.id,
      expectedResourceVersion: graph.version } });
    assert.equal(await linkedCard(backend, checklistId), null);
    assert.equal(await linkedCard(backend, timelineId), null);
    assert.equal(await linkedCard(backend, graph.id), null);
    assert.deepEqual((await readTimeline()).view, view);
    await backend.close();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    assert.deepEqual((await read()).workroom, room);
    assert.equal((await readChecklist()).entries.find(entry => entry.id === added.createdIds.manual)?.text, 'Manual follow-up');
    assert.deepEqual((await readTimeline()).view, view);
    assert.deepEqual(await linkedCard(backend, checklistId), checklistLink);
    assert.deepEqual(await linkedCard(backend, timelineId), timelineLink);
    assert.deepEqual(await linkedCard(backend, cardIds.graph), graphLink);
    assert.deepEqual(await linkedCard(backend, cardIds.evidence), evidenceLink);
    const measurement = 'Measure CPU and RAM';
    const measure = async (objective = measurement) => {
      const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
      let result = await backend.call('missions', { name: 'start', input: {
        objective, fingerprint: preview.fingerprint, requestId: randomUUID(),
      } }) as MissionProjection;
      // Give the real counters and dependent join their declared attempt budgets, even if admitted serially.
      const attemptBudgetMs = preview.plan.tasks.reduce((total, task) => total + task.timeoutMs * task.maxAttempts, 0);
      const until = performance.now() + attemptBudgetMs + 3000;
      while (['queued', 'running'].includes(result.outcome) && performance.now() < until) {
        await delay(25);
        result = await backend.call('missions', { name: 'read', input: { id: result.id } }) as MissionProjection;
      }
      assert.equal(result.outcome, 'verified', JSON.stringify(result.tasks.map(task =>
        [task.id, task.state, task.detail, task.attempts.at(-1)?.timing])));
      return result;
    };
    const measured = await measure(), measuredAgain = await measure(), single = await measure('Run a mission to measure CPU');
    assert.deepEqual(single.tasks.map(task => task.id), ['cpu']);
    assert.match(measured.answer?.[0] ?? '', /^CPU [\d.]+% \(\d+ ms sample\)\.$/u);
    assert.match(measured.answer?.[1] ?? '', /^RAM [\d.]+% \([\d.]+\/[\d.]+ GiB used, [\d.]+ GiB (available|free)\)\.$/u);
    const vela = await backend.call('vela', { name: 'state', input: {} }) as VelaState;
    for (const [result, jobsDone] of [[measured, 2], [measuredAgain, 2], [single, 1]] as const) {
      const messages = vela.conversation!.messages.filter(message => message.missionReport?.missionId === result.id);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].content, result.answer!.join('\n'));
      assert.deepEqual(messages[0].missionReport, { missionId: result.id, workspaceId: room.workspaceId, projectId: null, jobsDone });
      assert.deepEqual(await backend.call('missions', { name: 'post-report', input: { id: result.id } }),
        { kind: 'mission-report', missionId: result.id, messageId: messages[0].id });
      const profile = await backend.call('missions', { name: 'execution-profile', input: { id: result.id } });
      assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
      const posted = (await backend.call('replay', { limit: 1000 })).events
        .find(event => event.mission?.id === result.id && event.type === 'vela.mission/report-posted');
      assert.ok(posted);
      const publication = profile.reportPublication;
      assert.ok(publication?.timing);
      assert.deepEqual(publication.timing, posted.mission?.reportTiming);
      assert.equal(publication.eventId, posted.eventId);
      assert.equal(publication.cursor, posted.cursor);
      assert.equal(publication.receivedAt, posted.receivedAt);
      const { compositionStartedMs, composedMs, stagedMs, clock } = publication.timing;
      assert.ok(compositionStartedMs <= composedMs && composedMs <= stagedMs);
      assert.equal(clock, profile.lastSettlement?.clock);
      assert.equal(profile.settlementToReportStagedMs, stagedMs - profile.lastSettlement!.monotonicMs!);
      assert.equal(profile.intakeToReportStagedMs, stagedMs - profile.requestIntake!.monotonicMs);
      assert.deepEqual(profile.reportLatency, {
        publicationEventId: posted.eventId,
        settlementEventSeq: profile.lastSettlement!.eventSeq,
        settlementToCompositionMs: compositionStartedMs - profile.lastSettlement!.monotonicMs!,
        compositionMs: composedMs - compositionStartedMs,
        compositionToStagingMs: stagedMs - composedMs,
        stagingToRendererReceiptMs: null,
      });
      assert.equal(profile.userDelivery, null);
      assert.equal(profile.firstMeaningfulOutput, null);
    }
    assert.deepEqual(await backend.call('providerActivity', {}), providerActivity);
    const readPublication = () => backend.call('missions', { name: 'execution-profile', input: { id: single.id } });
    const latestReport = vela.conversation!.messages.find(message => message.missionReport?.missionId === single.id)!;
    const receipt = { missionId: single.id, messageId: latestReport.id };
    assert.deepEqual(await backend.call('rendererVelaOutput', { ...receipt, missionId: measured.id }), { accepted: false });
    assert.deepEqual(await backend.call('rendererVelaOutput', receipt), { accepted: true });
    const beforeReopen = await readPublication();
    assert.ok(beforeReopen && 'kind' in beforeReopen && beforeReopen.kind === 'execution-profile');
    assert.equal(beforeReopen.userDelivery?.messageId, latestReport.id);
    assert.equal(beforeReopen.userDelivery?.source, 'renderer-visible-frame');
    assert.ok(beforeReopen.userDelivery?.stagingToReceiptMs != null && beforeReopen.userDelivery.stagingToReceiptMs >= 0);
    assert.equal(beforeReopen.intakeToUserDeliveryMs,
      beforeReopen.intakeToReportStagedMs! + beforeReopen.userDelivery.stagingToReceiptMs);
    assert.equal(beforeReopen.reportLatency?.stagingToRendererReceiptMs, beforeReopen.userDelivery.stagingToReceiptMs);
    assert.deepEqual(beforeReopen.firstMeaningfulOutput, {
      kind: 'mission-report', source: 'renderer-visible-frame', messageId: latestReport.id,
      publicationEventId: beforeReopen.reportPublication!.eventId, receivedAt: beforeReopen.userDelivery.receivedAt,
      intakeToReceiptMs: beforeReopen.intakeToUserDeliveryMs,
    });
    assert.deepEqual(await backend.call('rendererVelaOutput', receipt), { accepted: true });
    assert.deepEqual(await readPublication(), beforeReopen);
    await backend.close();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    assert.deepEqual(await readPublication(), beforeReopen);
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-test-'));
    rmSync(target, { recursive: true, force: true });
  }
});

test('a lost worker never treats its in-flight native work as verified on reopen', { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-crash-'));
  const options = { path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options);
  let stage = 'initial workspace and mission preview';
  const reportStage = () => t.diagnostic('Worker-loss fixture stage: ' + stage);
  t.signal.addEventListener('abort', reportStage, { once: true });
  try {
    const project = (await backend.call('desktop', { type: 'createProject', title: 'Synthetic crash project' })).projects[0];
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic crash workspace', projectId: project.id });
    const workspaceId = desktop.workspaces[0].id;
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const objective = 'Measure CPU and RAM in parallel';
    const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    stage = 'durable CPU attempt admission';
    let terminated: Promise<void> | undefined;
    const admitted = new Promise<string>(resolve => {
      const stop = backend.subscribe(event => {
        if (event.type === 'vela.mission/started' && event.payload.taskId === 'cpu') {
          stop();
          // Interrupt as soon as the worker publishes its durable attempt.
          // Waiting for the RPC reply gives the OS sample time to complete.
          terminated = backend.terminate();
          resolve(event.correlationId!);
        }
      });
    });
    const started = backend.call('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } })
      .catch(error => {
        if (!terminated || error.message !== 'backend_disconnected') throw error;
      });
    const id = await Promise.race([admitted, started.then(() => admitted), delay(8000, 'timeout', { ref: false })]);
    assert.notEqual(id, 'timeout', 'CPU attempt did not publish its durable start');
    assert.ok(terminated, 'Worker termination was not requested for the durable attempt');
    stage = 'worker exit and recovery';
    await terminated;
    await started;
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const recovered = await backend.call('missions', { name: 'read', input: { id } }) as MissionProjection;
    assert.equal(recovered.disposition, 'paused');
    const cpu = recovered.tasks.find(task => task.id === 'cpu')!;
    assert.equal(cpu.state, 'failed');
    assert.equal(cpu.attempts.length, 1);
    assert.equal(cpu.attempts[0].verification, undefined);
    assert.equal(recovered.tasks.find(task => task.id === 'report')?.attempts.length, 0);
    const replay = (await backend.call('replay', { limit: 1000 })).events.filter(event => event.mission?.id === id);
    const cpuJournal = recovered.events.find(event => event.kind === 'recovered' && event.taskId === 'cpu');
    assert.ok(cpuJournal);
    const cpuRecovery = replay.find(event => event.mission?.seq === cpuJournal.seq);
    assert.ok(cpuRecovery);
    assert.equal(cpuRecovery.type, 'vela.mission/recovered');
    assert.equal(cpuRecovery.status, 'failed');
    assert.equal(cpuRecovery.mission?.attemptId, cpu.attempts[0].id);
    assert.equal(cpuRecovery.mission?.occurredAt, cpuJournal.time);
    assert.deepEqual(cpuRecovery.mission?.scope, { workspaceId, projectId: project.id });
    assert.equal(replay.filter(event => event.mission?.kind === 'started' && event.mission.taskId === 'cpu').length, 1);
    assert.ok(!replay.some(event => event.mission?.kind === 'report-posted'));
    stage = 'workroom authority and recovered projection';
    const firstReview = await backend.call('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
    await backend.call('desktop', { type: 'archiveSubject', kind: 'project', id: project.id, expectedVersion: project.version, archived: true });
    await backend.call('desktop', { type: 'archiveSubject', kind: 'project', id: project.id, expectedVersion: project.version + 1, archived: false });
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const before = await backend.call('desktop', { type: 'snapshot' });
    const templates = await backend.call('library', { name: 'listTemplates', input: {} });
    await assert.rejects(backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: firstReview.reviewId } }), /project_version_conflict/);
    const after = await backend.call('desktop', { type: 'snapshot' });
    assert.deepEqual(after.resources.map(resource => resource.id), before.resources.map(resource => resource.id));
    assert.equal(after.workspaces.length, before.workspaces.length);
    assert.deepEqual(await backend.call('library', { name: 'listTemplates', input: {} }), templates);
    const review = await backend.call('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
    const room = await backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: review.reviewId } }) as MissionWorkroom;
    assert.ok(room.missionChecklistResourceId && room.missionTimelineResourceId);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    const linked = await linkedCard(backend, room.missionChecklistResourceId);
    assert.equal(linked?.outcome, 'paused');
    assert.equal(linked?.checklist?.find(task => task.taskId === 'cpu')?.state, 'failed');
    assert.equal(linked?.checklist?.find(task => task.taskId === 'report')?.state, 'queued');
  } finally {
    t.signal.removeEventListener('abort', reportStage);
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-crash-'));
    rmSync(target, { recursive: true, force: true });
  }
});
