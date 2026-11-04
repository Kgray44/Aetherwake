import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BackendCore } from '../src/core.mts';
import { Backend } from '../src/service.mts';
import type { StreamEvent } from '../src/contracts.mts';
import type { MissionExecutor, MissionPreview, MissionProjection } from '../src/mission-contracts.mts';

test('native mission lifecycle events replay in the originating workspace and hide from a sibling workspace', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-stream-'));
  const options = { path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' as const };
  const live: StreamEvent[] = [];
  let core = new BackendCore(options, event => live.push(event)), closed = false;
  let releaseCpu!: () => void;
  const gate = new Promise<void>(resolve => { releaseCpu = resolve; });
  try {
    await assert.rejects(core.command('missionHostSignal', { storageAdmitted: false }), /invalid_mission_host_signal/);
    const executors = (core as unknown as { missionExecutors: Record<string, MissionExecutor> }).missionExecutors;
    const cpu = executors['sample.cpu'];
    executors['sample.cpu'] = { ...cpu, async run(context) { await gate; return cpu.run(context); } };
    const desktop = await core.command('desktop', { type: 'createProject', title: 'Synthetic stream project' });
    const projectId = desktop.projects.find(project => project.title === 'Synthetic stream project')!.id;
    async function workspace(title: string) {
      const view = await core.command('desktop', { type: 'createWorkspace', title, projectId });
      return view.workspaces.find(workspace => workspace.title === title)!.id;
    }
    const origin = await workspace('Synthetic mission stream origin');
    const sibling = await workspace('Synthetic mission stream sibling');
    const navigate = (workspaceId: string) => core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    await navigate(origin);
    const objective = 'Measure CPU and RAM';
    const preview = await core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const mission = await core.command('missions', { name: 'start', input: {
      objective, fingerprint: preview.fingerprint, requestId: randomUUID(),
    } }) as MissionProjection;
    const read = () => core.command('missions', { name: 'read', input: { id: mission.id } }) as Promise<MissionProjection>;
    const replay = async () => (await core.command('replay', { limit: 1000 })).events.filter(event => event.type.startsWith('vela.mission/'));
    const opened = (await replay()).find(event => event.mission?.kind === 'started' && event.mission.taskId === 'cpu');
    assert.ok(opened, 'CPU attempt must be recorded before dispatch leaves the origin');
    assert.equal(opened.status, 'running');
    assert.deepEqual(opened.mission?.scope, { workspaceId: origin, projectId });
    assert.equal(opened.mission?.executor, 'sample.cpu');
    assert.ok(live.some(event => event.eventId === opened.eventId));

    await navigate(sibling);
    releaseCpu();
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const db = new DatabaseSync(options.path, { readOnly: true });
      const settled = db.prepare('SELECT active FROM vela_missions WHERE id=?').get(mission.id)?.active === 0;
      db.close();
      if (settled) break;
      await delay(20);
    }
    assert.deepEqual(await replay(), []);
    assert.ok(!live.some(event => event.mission?.id === mission.id && event.mission.kind === 'settled' && event.mission.taskId === 'cpu'));
    await navigate(origin);
    assert.equal((await read()).outcome, 'verified');
    const retained = await replay();
    const finished = retained.find(event => event.mission?.kind === 'settled' && event.mission.taskId === 'cpu');
    assert.ok(finished);
    assert.equal(finished.status, 'verified');
    assert.equal(finished.mission?.attemptId, opened.mission?.attemptId);
    assert.deepEqual(finished.payload, { redacted: true, taskId: 'cpu' });
    assert.ok(retained.some(event => event.mission?.executor === 'sample.ram' && event.status === 'verified'));
    assert.equal((await core.command('providerActivity', {})).providerRequests, 0);

    await core.command('close', {});
    closed = true;
    const db = new DatabaseSync(options.path);
    try {
      db.prepare("UPDATE intelligence_events SET json=json_set(json_remove(json,'$.mission'),'$.status',NULL) WHERE cursor=?").run(finished.cursor);
      const missing = db.prepare('SELECT json FROM intelligence_events WHERE cursor=?').get(finished.cursor)!.json;
      db.prepare('INSERT INTO intelligence_events(dedupe,json) VALUES(?,?)').run('synthetic:unproven-mission-event', missing);
    } finally { db.close(); }
    core = new BackendCore(options);
    closed = false;
    assert.deepEqual(await replay(), retained, 'Legacy replay uses the exact durable lifecycle record and drops an unproven row');
    await navigate(sibling);
    assert.deepEqual(await replay(), []);
  } finally {
    releaseCpu();
    if (!closed) await core.command('close', {});
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-stream-'));
    rmSync(target, { recursive: true, force: true });
  }
});

test('trusted native reserve observations defer mission dispatch and persist the actual admission sample after release', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-host-signal-'));
  const backend = new Backend({ path: join(directory, 'state.sqlite'), privateRoot: directory,
    contentPolicy: 'local-private', provider: 'codex' }, { secrets: {
    available: async () => false,
    seal: async () => { throw Error('not_used'); },
    open: async () => { throw Error('not_used'); },
  } });
  try {
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic reserve signal room', projectId: null });
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: desktop.activeWorkspaceId! } });
    backend.observeMissionHostSignal({ storageAdmitted: false });
    const objective = 'Measure CPU and RAM';
    const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const mission = await backend.call('missions', { name: 'start', input: {
      objective, fingerprint: preview.fingerprint, requestId: randomUUID(),
    } }) as MissionProjection;
    const read = () => backend.call('missions', { name: 'read', input: { id: mission.id } }) as Promise<MissionProjection>;
    const held = await read();
    assert.equal(held.profile.attempts, 0);
    assert.equal(held.waits.cpu, 'resource-pressure');
    assert.equal(held.admission?.workerLimit, 0);
    assert.ok(held.admission?.reasons.includes('storage-reserve'));

    backend.observeMissionHostSignal({ storageAdmitted: true });
    let result = await read();
    const deadline = performance.now() + 4000;
    while (['queued', 'running'].includes(result.outcome) && performance.now() < deadline) {
      await delay(20);
      result = await read();
    }
    assert.equal(result.outcome, 'verified');
    assert.ok(result.tasks.every(task => {
      const snapshot = task.attempts.at(-1)?.admission;
      return snapshot && snapshot.workerLimit > 0 && snapshot.readings.availableMemoryBytes &&
        Number.isFinite(snapshot.readings.availableMemoryBytes.value) && !snapshot.reasons.includes('storage-reserve');
    }));
    assert.equal((await backend.call('providerActivity', {})).providerRequests, 0);
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-host-signal-'));
    rmSync(target, { recursive: true, force: true });
  }
});
