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
import type { MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview, MissionWorkroomResource } from '../src/mission-contracts.mts';

async function linkedCard(backend: Backend, resourceId: string): Promise<MissionWorkroomResource | null> {
  const result = await backend.call('missions', { name: 'workroom-resource', input: { resourceId } });
  assert.ok(result === null || 'kind' in result && result.kind === 'workroom-resource');
  return result;
}

test('native mission scopes Notes to its originating project and rechecks evidence after a canonical edit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-context-test-'));
  const backend = new Backend({ path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' });
  try {
    async function room(title: string) {
      const created = await backend.call('desktop', { type: 'createProject', title });
      const projectId = created.projects.find(project => project.title === title)!.id;
      const desktop = await backend.call('desktop', { type: 'createWorkspace', title: title + ' workspace', projectId });
      return desktop.workspaces.find(workspace => workspace.project_id === projectId)!.id;
    }
    const workspaceId = await room('Synthetic mission source project');
    const other = await room('Other synthetic source project');
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
    await edit(note, 'Edited synthetic backend performance timing and sampling notes.');
    const stale = await read();
    assert.equal(stale.outcome, 'blocked');
    for (const taskId of ['notes', 'report']) {
      const task = stale.tasks.find(candidate => candidate.id === taskId)!;
      assert.equal(task.state, 'blocked');
      assert.equal(task.attempts[0].evidence, undefined);
    }
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
    assert.deepEqual(await backend.call('providerActivity', {}), providerActivity);
    assert.equal(mission.profile.providerCalls, 0);
    assert.ok(mission.profile.peakWorkers >= 2);
    assert.equal(mission.profile.reportedTotalTokens, null);
    const other = await backend.call('desktop', { type: 'createWorkspace', title: 'Other synthetic workspace', projectId: null });
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: other.workspaces.find(w => w.id !== workspaceId)!.id } });
    await assert.rejects(read(), /mission_not_found/);
    await backend.close();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    assert.deepEqual(await read(), mission);
    const prior = await backend.call('desktop', { type: 'snapshot' });
    const draft = await backend.call('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
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
    assert.deepEqual(await backend.call('missions', { name: 'workroom-apply', input: { id, reviewId: draft.reviewId } }), room);
    const built = await backend.call('desktop', { type: 'snapshot' });
    assert.equal(built.workspaces.length, prior.workspaces.length + 1);
    const { missionChecklistResourceId: checklistId, missionTimelineResourceId: timelineId } = room;
    assert.ok(checklistId && timelineId && checklistId !== timelineId);
    assert.ok([checklistId, timelineId].every(resourceId => built.blocks.some(block =>
      block.workspace_id === room.workspaceId && block.resource_id === resourceId)));
    const checklistLink = await linkedCard(backend, checklistId);
    const timelineLink = await linkedCard(backend, timelineId);
    assert.deepEqual(checklistLink, { kind: 'workroom-resource', missionId: id, revision: projected.revision, outcome: 'verified',
      checklist: projected.tasks.map(task => ({ taskId: task.id, title: task.objective, state: task.state })) });
    assert.deepEqual(timelineLink, { kind: 'workroom-resource', missionId: id, revision: projected.revision,
      outcome: 'verified', timeline: projected.events });
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
    const origin = await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    await backend.call('library', { name: 'attachBlock', input: { commandId: randomUUID(), workspaceId,
      expectedLayoutVersion: origin.layoutVersion, kind: 'timeline', resourceId: timelineId,
      expectedResourceVersion: updatedTimeline.resource.version } });
    assert.equal(await linkedCard(backend, checklistId), null);
    assert.equal(await linkedCard(backend, timelineId), null);
    assert.deepEqual((await readTimeline()).view, view);
    await backend.close();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    assert.deepEqual((await read()).workroom, room);
    assert.equal((await readChecklist()).entries.find(entry => entry.id === added.createdIds.manual)?.text, 'Manual follow-up');
    assert.deepEqual((await readTimeline()).view, view);
    assert.deepEqual(await linkedCard(backend, checklistId), checklistLink);
    assert.deepEqual(await linkedCard(backend, timelineId), timelineLink);
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-test-'));
    rmSync(target, { recursive: true, force: true });
  }
});

test('a lost worker never treats its in-flight native work as verified on reopen', { timeout: 12_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-crash-'));
  const options = { path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options);
  try {
    const project = (await backend.call('desktop', { type: 'createProject', title: 'Synthetic crash project' })).projects[0];
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic crash workspace', projectId: project.id });
    const workspaceId = desktop.workspaces[0].id;
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const objective = 'Measure CPU and RAM in parallel';
    const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const admitted = new Promise<string>(resolve => {
      const stop = backend.subscribe(event => {
        if (event.type === 'vela.mission/started' && event.payload.taskId === 'cpu') {
          stop(); resolve(event.correlationId!);
        }
      });
    });
    await backend.call('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } });
    const id = await Promise.race([admitted, delay(4000, 'timeout', { ref: false })]);
    assert.notEqual(id, 'timeout');
    await backend.terminate();
    backend = new Backend(options);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const recovered = await backend.call('missions', { name: 'read', input: { id } }) as MissionProjection;
    assert.equal(recovered.disposition, 'paused');
    const cpu = recovered.tasks.find(task => task.id === 'cpu')!;
    assert.equal(cpu.state, 'failed');
    assert.equal(cpu.attempts.length, 1);
    assert.equal(cpu.attempts[0].verification, undefined);
    assert.equal(recovered.tasks.find(task => task.id === 'report')?.attempts.length, 0);
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
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-crash-'));
    rmSync(target, { recursive: true, force: true });
  }
});
