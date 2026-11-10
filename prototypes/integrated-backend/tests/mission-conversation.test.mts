import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProductCommandMap } from '../../conversation-product/src/contracts.ts';
import type { NoteDocument } from '../../block-library/note-contracts.ts';
import { BackendCore } from '../src/core.mts';
import type { ConversationProductRequest, StreamEvent } from '../src/contracts.mts';
import type { MissionAdmission, MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';
import type { VelaState } from '../../vela-core/src/contracts.ts';

function fixture(emit?: (event: StreamEvent) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-conversation-'));
  const options = { path: join(directory, 'state.sqlite'), provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let core = new BackendCore(options, emit);
  return {
    get core() { return core; },
    async reopen(afterClose?: (path: string) => void) {
      await core.command('close', {});
      afterClose?.(options.path);
      core = new BackendCore(options, emit);
    },
    async close() {
      await core.command('close', {});
      const target = resolve(directory), suffix = relative(resolve(tmpdir()), target);
      assert.ok(suffix.startsWith('aerynth-mission-conversation-') && !suffix.startsWith('..') && !isAbsolute(suffix));
      rmSync(target, { recursive: true, force: true });
    },
  };
}

function product<K extends keyof ProductCommandMap>(core: BackendCore, name: K, input: ProductCommandMap[K]['input']) {
  return core.command('conversation', { name, input } as ConversationProductRequest) as Promise<ProductCommandMap[K]['output']>;
}
async function navigate(core: BackendCore, workspaceId: string) {
  return core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
}
async function origin(core: BackendCore, project = false) {
  let projectId: string | null = null;
  if (project) {
    const desktop = await core.command('desktop', { type: 'createProject', title: 'Synthetic continuity project' });
    projectId = desktop.projects.find(item => item.title === 'Synthetic continuity project')!.id;
  }
  const desktop = await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic mission origin', projectId });
  const workspaceId = desktop.workspaces.find(item => item.title === 'Synthetic mission origin')!.id;
  await navigate(core, workspaceId);
  return workspaceId;
}
async function start(core: BackendCore, objective = 'Measure CPU and RAM') {
  const preview = await core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
  assert.ok(preview.plan);
  return core.command('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } }) as Promise<MissionProjection>;
}
async function verified(core: BackendCore, id: string) {
  // Hosted Windows can spend several seconds on SQLite and OS scheduling.
  // This bounds test observation only. The mission's own deadlines still apply.
  const deadline = performance.now() + (process.platform === 'win32' ? 20_000 : 7000);
  let mission: MissionProjection;
  do {
    mission = await core.command('missions', { name: 'read', input: { id } }) as MissionProjection;
    if (mission.outcome === 'verified') return mission;
    assert.ok(['queued', 'running'].includes(mission.outcome), JSON.stringify(mission.tasks.map(task => [task.id, task.state, task.detail])));
    await delay(15);
  } while (performance.now() < deadline);
  assert.fail('Native mission did not verify within its bounded test window: ' +
    JSON.stringify(mission.tasks.map(task => [task.id, task.state, task.detail, task.attempts.at(-1)?.timing])));
}
async function workroom(core: BackendCore, id: string) {
  const preview = await core.command('missions', { name: 'workroom-preview', input: { id } }) as MissionWorkroomPreview;
  const room = await core.command('missions', { name: 'workroom-apply', input: { id, reviewId: preview.reviewId } }) as MissionWorkroom;
  assert.ok(room.missionConversationResourceId, 'The reviewed workroom must retain its canonical conversation identity');
  return room;
}
async function receipt(core: BackendCore, room: MissionWorkroom) {
  const deadline = performance.now() + 3000;
  do {
    const detail = await product(core, 'detail', { resourceId: room.missionConversationResourceId! });
    if (detail.messages.total) {
      assert.equal(detail.messages.total, 1, 'One historical receipt is seeded into this mission conversation');
      return detail;
    }
    await delay(15);
  } while (performance.now() < deadline);
  assert.fail('Verified mission receipt was not delivered');
}
async function assertHidden(core: BackendCore, resourceId: string, messageId: string, query: string) {
  try {
    const detail = await product(core, 'detail', { resourceId });
    assert.ok(!detail.messages.items.some(message => message.id === messageId), 'A revoked receipt must not escape detail');
  } catch (error) {
    assert.match(String(error), /unavailable|denied|not_found/);
  }
  const search = await product(core, 'search', { text: query, searchMode: 'messages' });
  assert.ok(!search.items.some(item => item.messageId === messageId), 'A revoked receipt must not escape search');
}

test('verified mission seeds one isolated canonical receipt and branches preserve exact selected provenance without inference', async () => {
  const f = fixture();
  try {
    await origin(f.core);
    const beforeActivity = await f.core.command('providerActivity', {});
    const mission = await verified(f.core, (await start(f.core)).id);
    const sibling = await verified(f.core, (await start(f.core, 'Run a mission to measure CPU')).id);
    const room = await workroom(f.core, mission.id);
    const detail = await receipt(f.core, room);
    assert.equal(detail.conversation.providerId, 'local');
    assert.deepEqual(detail.lineage, [], 'The mission chat must not inherit the global Vela transcript');
    const message = detail.messages.items[0];
    assert.equal(message.role, 'assistant');
    assert.equal(message.provenance, 'application');
    assert.equal(message.inherited, false);
    assert.ok(message.content.includes(mission.id));
    assert.ok(message.content.includes(mission.objective));
    assert.match(message.content, /CPU \d+(?:\.\d+)?%/);
    assert.match(message.content, /RAM \d+(?:\.\d+)?%/);
    assert.ok(!message.content.includes(sibling.id));
    const snapshot = await f.core.command('snapshot', {});
    const canonical = snapshot.graph.messages.find(item => item.id === message.id)!;
    const evidence = mission.tasks.flatMap(task => task.attempts.at(-1)?.evidence ?? []);
    assert.ok(canonical.referenceIds.includes(mission.id));
    for (const item of evidence) {
      assert.ok(canonical.referenceIds.includes(item.id), `Missing source reference ${item.id}`);
      assert.ok(message.content.includes(item.observedAt), 'Receipt retains original evidence time');
    }
    for (const item of sibling.tasks.flatMap(task => task.attempts.at(-1)?.evidence ?? []))
      assert.ok(!canonical.referenceIds.includes(item.id));
    assert.deepEqual(await f.core.command('providerActivity', {}), beforeActivity);

    for (const providerId of ['local', 'fixture-codex']) {
      const branch = await product(f.core, 'branch', { resourceId: detail.conversation.resourceId, messageId: message.id,
        includeMessageIds: [message.id], providerId, title: 'Synthetic reviewed mission continuation', commandId: randomUUID(),
        tokenBudget: 32768, expectedRevision: detail.conversation.revision });
      assert.notEqual(branch.resourceId, detail.conversation.resourceId);
      assert.equal(branch.mode, 'application_continuation');
      const branched = await f.core.command('snapshot', {});
      const handoff = branched.graph.handoffs.find(item => item.id === branch.handoffId)!;
      assert.equal(handoff.items.length, 1);
      assert.equal(handoff.items[0].sourceMessageId, message.id);
      assert.equal(handoff.items[0].sourceConversationId, detail.conversation.conversationId);
      assert.equal(handoff.items[0].digest, createHash('sha256').update(message.content).digest('hex'));
      assert.deepEqual(handoff.items[0].referenceIds, canonical.referenceIds);
      assert.equal(branched.conversations.find(item => item.resourceId === branch.resourceId)!.providerId, providerId);
      await product(f.core, 'reviewBranch', { handoffId: branch.handoffId, fingerprint: branch.fingerprint, approve: true });
    }
    assert.deepEqual(await f.core.command('providerActivity', {}), beforeActivity);
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 0);
    await f.reopen();
    const restored = await receipt(f.core, room);
    assert.equal(restored.messages.items[0].id, message.id);
    assert.equal(restored.conversation.resourceId, room.missionConversationResourceId);
    assert.equal((await f.core.command('snapshot', {})).graph.messages.filter(item => item.conversationId === detail.conversation.conversationId).length, 1);
  } finally { await f.close(); }
});

test('a workroom created while work is held receives exactly one receipt after actual verification', async () => {
  const f = fixture();
  try {
    await origin(f.core);
    const missions = (f.core as any).missions;
    // Control admission for both phases so host pressure cannot undo the fixture's release.
    let admission: MissionAdmission = { workerLimit: 0, reasons: ['physical-memory'], readings: {} };
    missions.host.admission = () => admission;
    const mission = await start(f.core);
    const room = await workroom(f.core, mission.id);
    assert.equal((await product(f.core, 'detail', { resourceId: room.missionConversationResourceId! })).messages.total, 0);
    admission = { workerLimit: 1, reasons: [], readings: {} };
    missions.capacityChanged();
    await verified(f.core, mission.id);
    const delivered = await receipt(f.core, room);
    await f.reopen();
    assert.deepEqual((await receipt(f.core, room)).messages, delivered.messages);
  } finally { await f.close(); }
});

for (const revoke of ['origin', 'workroom', 'chat', 'placement', 'project'] as const) {
  test(`mission receipt reads and prepared branch reviews recheck ${revoke} scope`, async () => {
    const f = fixture();
    try {
      const workspaceId = await origin(f.core, true);
      // This fixture tests source scope. Keep worker admission independent of host pressure.
      const admission: MissionAdmission = { workerLimit: 2, reasons: [], readings: {} };
      (f.core as any).missions.host.admission = () => admission;
      const mission = await verified(f.core, (await start(f.core)).id);
      const room = await workroom(f.core, mission.id);
      const detail = await receipt(f.core, room), message = detail.messages.items[0];
      const prepared = await product(f.core, 'branch', { resourceId: detail.conversation.resourceId, messageId: message.id,
        includeMessageIds: [message.id], providerId: 'local', title: 'Synthetic pending review', commandId: randomUUID(),
        tokenBudget: 32768, expectedRevision: detail.conversation.revision });
      const desktop = await f.core.command('desktop', { type: 'snapshot' });
      if (revoke === 'origin' || revoke === 'workroom') {
        const id = revoke === 'origin' ? workspaceId : room.workspaceId;
        await f.core.command('desktop', { type: 'archiveWorkspace', workspaceId: id,
          expectedVersion: desktop.workspaces.find(item => item.id === id)!.version, archived: true });
      } else if (revoke === 'chat') {
        await product(f.core, 'archive', { resourceId: detail.conversation.resourceId,
          expectedVersion: detail.conversation.version, archived: true });
      } else if (revoke === 'placement') {
        const block = desktop.blocks.find(item => item.workspace_id === room.workspaceId && item.resource_id === detail.conversation.resourceId)!;
        await f.core.command('desktop', { type: 'detach', blockId: block.id, expectedVersion: block.version });
      } else {
        const other = await f.core.command('desktop', { type: 'createProject', title: 'Synthetic unrelated project' });
        const projectId = other.projects.find(item => item.title === 'Synthetic unrelated project')!.id;
        await product(f.core, 'organize', { type: 'associateProject', resourceId: detail.conversation.resourceId,
          projectId, expectedVersion: detail.conversation.version });
      }
      await assertHidden(f.core, detail.conversation.resourceId, message.id, mission.id);
      await assert.rejects(product(f.core, 'reviewBranch', { handoffId: prepared.handoffId, fingerprint: prepared.fingerprint, approve: true }),
        /unavailable|denied|stale|not_found/, revoke);
      assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 0);
      if (revoke === 'origin') {
        const version = Number((f.core as any).db.prepare('SELECT version FROM workspaces WHERE id=?').get(workspaceId).version);
        await f.core.command('desktop', { type: 'archiveWorkspace', workspaceId, expectedVersion: version, archived: false });
        assert.equal((await receipt(f.core, room)).messages.items[0].id, message.id, 'Restoring the same source reopens its original receipt');
        await product(f.core, 'reviewBranch', { handoffId: prepared.handoffId, fingerprint: prepared.fingerprint, approve: true });
      }
    } finally { await f.close(); }
  });
}

test('editing mission source evidence withdraws its receipt from detail, search and prepared branch review', async () => {
  const f = fixture();
  try {
    const workspaceId = await origin(f.core, true);
    const desktop = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Backend performance notes', workspaceId });
    const noteId = desktop.blocks.find(item => item.workspace_id === workspaceId && item.resource_id)!.resource_id!;
    const edit = async (content: string) => {
      const note = (await f.core.command('notes', { name: 'readNote', input: noteId })).result as NoteDocument;
      await f.core.command('notes', { name: 'commitNote', input: { resourceId: noteId, expectedResourceVersion: note.resource.version,
        expectedDraftVersion: note.draftRevision, content } });
    };
    await edit('Synthetic backend performance timing baseline from the selected workspace.');
    const mission = await verified(f.core, (await start(f.core, 'Investigate Aerynth backend performance using workspace notes')).id);
    const room = await workroom(f.core, mission.id), detail = await receipt(f.core, room), message = detail.messages.items[0];
    assert.ok(!message.content.includes('timing baseline'), 'Mission handoff cites evidence without copying note bodies');
    const prepared = await product(f.core, 'branch', { resourceId: detail.conversation.resourceId, messageId: message.id,
      includeMessageIds: [message.id], providerId: 'local', title: 'Synthetic source-bound review', commandId: randomUUID(),
      tokenBudget: 32768, expectedRevision: detail.conversation.revision });
    await edit('Edited synthetic backend performance timing baseline.');
    assert.equal((await f.core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection).outcome, 'blocked');
    await assertHidden(f.core, detail.conversation.resourceId, message.id, mission.id);
    await assert.rejects(product(f.core, 'reviewBranch', { handoffId: prepared.handoffId, fingerprint: prepared.fingerprint, approve: true }),
      /unavailable|denied|stale|not_found/);
    const rejected = await product(f.core, 'reviewBranch', {
      handoffId: prepared.handoffId, fingerprint: prepared.fingerprint, approve: false,
    }) as { state: string };
    assert.equal(rejected.state, 'rejected', 'Unavailable source evidence must not prevent rejecting its prepared context');
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 0);
  } finally { await f.close(); }
});

test('failed conversation acknowledgement rolls back its message and live event while Vela reports independently, then startup retries once', async () => {
  const live: StreamEvent[] = [];
  const f = fixture(event => live.push(event));
  try {
    const workspaceId = await origin(f.core);
    const host = (f.core as any).missions.host, admission = host.admission;
    host.admission = () => ({ workerLimit: 0, reasons: ['physical-memory'], readings: {} });
    const started = await start(f.core);
    const room = await workroom(f.core, started.id);
    const db: DatabaseSync = (f.core as any).db;
    db.exec(`CREATE TRIGGER test_conversation_ack_failure BEFORE DELETE ON vela_mission_conversation_outbox
      WHEN OLD.mission_id='${started.id}' BEGIN SELECT RAISE(ABORT,'synthetic conversation acknowledgement fault'); END;`);
    host.admission = admission;
    (f.core as any).missions.capacityChanged();
    const mission = await verified(f.core, started.id);
    await navigate(f.core, workspaceId);
    const reportDeadline = performance.now() + 3000;
    let reports: NonNullable<VelaState['conversation']>['messages'] = [];
    do {
      const state = await f.core.command('vela', { name: 'state', input: {} }) as VelaState;
      reports = state.conversation?.messages.filter(message => message.missionReport?.missionId === mission.id) ?? [];
      if (reports.length) break;
      await delay(15);
    } while (performance.now() < reportDeadline);
    assert.equal(reports.length, 1, 'Vela completion must publish despite a separate handoff fault');
    assert.match(reports[0].content, /CPU \d+(?:\.\d+)?%/);
    assert.match(reports[0].content, /RAM \d+(?:\.\d+)?%/);
    assert.ok(db.prepare('SELECT 1 FROM vela_mission_conversation_outbox WHERE mission_id=?').get(mission.id));
    assert.equal(db.prepare('SELECT count(*) AS count FROM vela_mission_conversation_receipts WHERE mission_id=?').get(mission.id)!.count, 0);
    assert.equal((await product(f.core, 'detail', { resourceId: room.missionConversationResourceId! })).messages.total, 0,
      'An append before failed acknowledgement must roll back the canonical graph');
    const conversationEvent = (event: StreamEvent) => event.type === 'vela.mission/conversation-receipt' && event.mission?.id === mission.id;
    assert.ok(!live.some(conversationEvent), 'An event from the rolled-back handoff must never be delivered live');
    assert.ok(!(await f.core.command('replay', { limit: 1000 })).events.some(conversationEvent));
    const originalEvidence = mission.tasks.flatMap(task => task.attempts.at(-1)?.evidence ?? []);
    await f.reopen(path => {
      const maintenance = new DatabaseSync(path);
      try { maintenance.exec('DROP TRIGGER test_conversation_ack_failure'); }
      finally { maintenance.close(); }
    });
    const restoredDb: DatabaseSync = (f.core as any).db;
    assert.equal(restoredDb.prepare('SELECT count(*) AS count FROM vela_mission_conversation_outbox WHERE mission_id=?').get(mission.id)!.count, 0,
      'Startup drains the persisted handoff before any projection asks for it');
    assert.equal(restoredDb.prepare('SELECT count(*) AS count FROM vela_mission_conversation_receipts WHERE mission_id=?').get(mission.id)!.count, 1);
    const delivered = await receipt(f.core, room), message = delivered.messages.items[0];
    for (const evidence of originalEvidence) {
      assert.ok(message.content.includes(evidence.id));
      assert.ok(message.content.includes(evidence.observedAt));
    }
    const events = (await f.core.command('replay', { limit: 1000 })).events.filter(conversationEvent);
    assert.equal(events.length, 1);
    assert.equal(live.filter(conversationEvent).length, 1);
    const recoveredState = await f.core.command('vela', { name: 'state', input: {} }) as VelaState;
    assert.deepEqual(recoveredState.conversation?.messages.filter(item => item.missionReport?.missionId === mission.id), reports);
    await f.reopen();
    assert.equal((await receipt(f.core, room)).messages.items[0].id, message.id);
    assert.deepEqual((await f.core.command('replay', { limit: 1000 })).events.filter(conversationEvent), events);
    assert.equal(live.filter(conversationEvent).length, 1);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});
