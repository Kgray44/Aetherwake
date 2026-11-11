import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspaceRecoveryPreview, WorkspaceRecoveryReceipt, WorkspaceRecoveryState } from '../../application-contract/workspace-recovery.ts';
import type { Detail } from '../../conversation-product/src/contracts.ts';
import type { VelaState } from '../../vela-core/src/contracts.ts';
import { BackendCore } from '../src/core.mts';
import type { StreamEvent } from '../src/contracts.mts';
import type { MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';
import { fixtureMissionMemory } from './fixture-mission-memory.mts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-recovery-integration-'));
  const options = { path: join(directory, 'state.sqlite'), provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  const live: StreamEvent[] = [];
  let core = new BackendCore(options, event => live.push(event));
  return { get core() { return core; }, get db() { return (core as any).db; }, live,
    async reopen() { await core.command('close', {}); core = new BackendCore(options, event => live.push(event)); },
    async close() {
      await core.command('close', {});
      const target = resolve(directory), suffix = relative(resolve(tmpdir()), target);
      assert.ok(suffix.startsWith('aerynth-recovery-integration-') && !suffix.startsWith('..') && !isAbsolute(suffix));
      rmSync(target, { recursive: true, force: true });
    } };
}
type Fixture = ReturnType<typeof fixture>;
async function navigate(f: Fixture, workspaceId: string) {
  return f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
}
async function room(f: Fixture, title: string, projectId: string | null = null) {
  const desktop = await f.core.command('desktop', { type: 'createWorkspace', title, projectId });
  const id = desktop.workspaces.find(item => item.title === title)!.id;
  await navigate(f, id);
  return id;
}
async function state(f: Fixture, workspaceId: string) {
  const value = await f.core.command('workspaceRecovery', { name: 'state', input: { workspaceId } });
  assert.ok(value.kind === 'state' && value.available);
  return value;
}
async function preview(f: Fixture, workspaceId: string) {
  const current = await state(f, workspaceId);
  return await f.core.command('workspaceRecovery', { name: 'preview', input: { workspaceId, action: current.action,
    creationEventId: current.creationEventId, expectedVersion: current.version, expectedLayoutVersion: current.layoutVersion } }) as WorkspaceRecoveryPreview;
}
async function apply(f: Fixture, review: WorkspaceRecoveryPreview, commandId = randomUUID()) {
  return await f.core.command('workspaceRecovery', { name: 'apply', input: {
    previewId: review.previewId, fingerprint: review.fingerprint, commandId,
  } }) as WorkspaceRecoveryReceipt;
}
const recoveryEvent = (workspaceId: string) => (event: StreamEvent) => event.payload?.workspaceRecovery?.workspaceId === workspaceId;

test('workroom creation undo defers only its handoff while the origin mission verifies, and restore publishes once across restart', async () => {
  const f = fixture();
  try {
    const origin = await room(f, 'Synthetic mission recovery origin');
    const setAvailableMemory = fixtureMissionMemory(f.core);
    setAvailableMemory(0);
    const objective = 'Measure CPU and RAM';
    const plan = await f.core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const started = await f.core.command('missions', { name: 'start', input: {
      objective, fingerprint: plan.fingerprint, requestId: randomUUID(),
    } }) as MissionProjection;
    const proposed = await f.core.command('missions', { name: 'workroom-preview', input: { id: started.id } }) as MissionWorkroomPreview;
    const workroom = await f.core.command('missions', { name: 'workroom-apply', input: {
      id: started.id, reviewId: proposed.reviewId,
    } }) as MissionWorkroom;
    assert.ok(workroom.missionConversationResourceId);
    const initial = await f.core.command('snapshot', {}), gid = initial.resourceMap[workroom.missionConversationResourceId];
    assert.equal(initial.graph.messages.filter(message => message.conversationId === gid).length, 0);
    assert.equal((await state(f, workroom.workspaceId)).state, 'active');
    const archived = await apply(f, await preview(f, workroom.workspaceId));
    assert.equal(archived.state, 'archived');
    setAvailableMemory(1024 ** 3);
    await navigate(f, origin);
    const read = () => f.core.command('missions', { name: 'read', input: { id: started.id } }) as Promise<MissionProjection>;
    const deadline = performance.now() + 7000;
    let mission = await read();
    while (['queued', 'running'].includes(mission.outcome) && performance.now() < deadline) { await delay(15); mission = await read(); }
    assert.equal(mission.outcome, 'verified');
    assert.equal(mission.conversationPending, true);
    assert.deepEqual(mission.workroom, workroom);
    const vela = await f.core.command('vela', { name: 'state', input: {} }) as VelaState;
    const reports = vela.conversation?.messages.filter(message => message.missionReport?.missionId === mission.id) ?? [];
    assert.equal(reports.length, 1, 'The originating Vela result does not depend on workroom visibility');
    assert.match(reports[0].content, /CPU \d+(?:\.\d+)?%/);
    assert.match(reports[0].content, /RAM \d+(?:\.\d+)?%/);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM vela_mission_conversation_outbox WHERE mission_id=?').get(mission.id).total, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM vela_mission_conversation_receipts WHERE mission_id=?').get(mission.id).total, 0);
    assert.equal((await f.core.command('snapshot', {})).graph.messages.filter(message => message.conversationId === gid).length, 0);
    const originalEvidence = mission.tasks.flatMap(task => task.attempts.at(-1)?.evidence ?? []);
    const restoreReview = await preview(f, workroom.workspaceId), restoreCommandId = randomUUID();
    const restored = await apply(f, restoreReview, restoreCommandId);
    assert.equal(restored.state, 'active');
    const detail = await f.core.command('conversation', { name: 'detail', input: { resourceId: workroom.missionConversationResourceId } }) as Detail;
    assert.equal(detail.messages.total, 1);
    const message = detail.messages.items[0], snapshot = await f.core.command('snapshot', {});
    const source = snapshot.graph.messages.find(item => item.id === message.id)!;
    for (const evidence of originalEvidence) {
      assert.ok(source.referenceIds.includes(evidence.id));
      assert.ok(message.content.includes(evidence.observedAt));
    }
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM vela_mission_conversation_outbox WHERE mission_id=?').get(mission.id).total, 0);
    const handoffEvent = (event: StreamEvent) => event.type === 'vela.mission/conversation-receipt' && event.mission?.id === mission.id;
    const retainedEvents = (await f.core.command('replay', { limit: 1000 })).events.filter(handoffEvent);
    assert.equal(retainedEvents.length, 1);
    assert.equal(f.live.filter(handoffEvent).length, 1);
    assert.equal(f.live.filter(recoveryEvent(workroom.workspaceId)).length, 2);
    await f.reopen();
    assert.deepEqual((await read()).workroom, workroom);
    assert.equal((await f.core.command('conversation', { name: 'detail', input: { resourceId: workroom.missionConversationResourceId } }) as Detail)
      .messages.items[0].id, message.id);
    assert.deepEqual(await apply(f, restoreReview, restoreCommandId), { ...restored, replayed: true });
    assert.equal(f.live.filter(recoveryEvent(workroom.workspaceId)).length, 2);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions WHERE workspace_id=?').get(workroom.workspaceId).total, 2);
    assert.deepEqual((await f.core.command('replay', { limit: 1000 })).events.filter(handoffEvent), retainedEvents);
    assert.equal(f.live.filter(handoffEvent).length, 1);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});

test('Core recovery rolls back SQL, navigation and live Stream delivery on receipt failure, then retries the same review', async () => {
  const f = fixture();
  try {
    await room(f, 'Synthetic navigation fallback');
    const workspaceId = await room(f, 'Synthetic failed recovery target');
    const review = await preview(f, workspaceId), commandId = randomUUID();
    const session = f.db.prepare('SELECT json FROM desktop_session WHERE id=1').get().json;
    const count = f.live.filter(recoveryEvent(workspaceId)).length;
    f.db.exec("CREATE TRIGGER test_core_recovery_receipt_failure BEFORE INSERT ON recovery_actions BEGIN SELECT RAISE(ABORT,'synthetic Core recovery failure'); END;");
    await assert.rejects(apply(f, review, commandId), /synthetic Core recovery failure/);
    assert.equal((await state(f, workspaceId)).state, 'active');
    assert.equal(f.db.prepare('SELECT json FROM desktop_session WHERE id=1').get().json, session);
    assert.equal(f.db.prepare('SELECT count(*) AS total FROM recovery_actions').get().total, 0);
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM change_events WHERE entity_id=? AND type='workspace.archived'").get(workspaceId).total, 0);
    assert.equal(f.live.filter(recoveryEvent(workspaceId)).length, count, 'An event rolled back with its receipt must not escape live');
    assert.equal((await f.core.command('replay', { limit: 1000 })).events.filter(recoveryEvent(workspaceId)).length, 0);
    f.db.exec('DROP TRIGGER test_core_recovery_receipt_failure');
    const result = await apply(f, review, commandId);
    assert.equal(result.state, 'archived');
    assert.equal(f.live.filter(recoveryEvent(workspaceId)).length, count + 1);
    const event = (await f.core.command('replay', { limit: 1000 })).events.find(recoveryEvent(workspaceId))!;
    assert.equal(event.classification, 'observed');
    assert.deepEqual(event.payload?.workspaceRecovery, { workspaceId, action: 'undo-creation',
      creationEventId: review.creationEventId, workspaceVersion: result.version });
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});

test('Core archived-workspace management denies an archived project and invalidates prior review when the project is restored', async () => {
  const f = fixture();
  try {
    const created = await f.core.command('desktop', { type: 'createProject', title: 'Synthetic management project' });
    const project = created.projects.find(item => item.title === 'Synthetic management project')!;
    const workspaceId = await room(f, 'Private synthetic recovery title', project.id);
    await apply(f, await preview(f, workspaceId));
    const oldRestore = await preview(f, workspaceId);
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'project', id: project.id, expectedVersion: project.version, archived: true });
    const denied = await f.core.command('workspaceRecovery', { name: 'state', input: { workspaceId } }) as WorkspaceRecoveryState;
    assert.deepEqual(denied, { kind: 'state', available: false, workspaceId, scope: 'preserve-current-content', reason: 'workspace_unavailable' });
    assert.ok(!JSON.stringify(denied).includes('Private synthetic recovery title'));
    await assert.rejects(apply(f, oldRestore), /workspace_recovery_unavailable/);
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'project', id: project.id, expectedVersion: project.version + 1, archived: false });
    await assert.rejects(apply(f, oldRestore), /workspace_recovery_stale_snapshot/);
    assert.equal((await apply(f, await preview(f, workspaceId))).state, 'active');
    const missingId = randomUUID();
    const missing = await f.core.command('workspaceRecovery', { name: 'state', input: { workspaceId: missingId } });
    assert.deepEqual(missing, { kind: 'state', available: false, workspaceId: missingId, scope: 'preserve-current-content', reason: 'workspace_unavailable' });
    await assert.rejects(f.core.command('workspaceRecovery', { name: 'preview', input: { workspaceId: missingId, action: 'restore',
      creationEventId: randomUUID(), expectedVersion: 1, expectedLayoutVersion: 1 } }), /workspace_recovery_unavailable/);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});
