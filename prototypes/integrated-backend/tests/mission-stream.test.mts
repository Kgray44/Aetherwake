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
import { nativeMissionDiagnostics } from './fixtures/native-mission-diagnostics.mts';
import type { StreamEvent } from '../src/contracts.mts';
import type { MissionExecutor, MissionPreview, MissionProjection } from '../src/mission-contracts.mts';
import type { VelaState } from '../../vela-core/src/contracts.ts';

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
    const rendererReplay = async () => (await core.command('rendererEventPage', { recent: true, limit: 250 }))
      .events.filter(event => event.type.startsWith('vela.mission/'));
    assert.deepEqual(await rendererReplay(), retained, 'Renderer replay applies the same legacy proof and scope');
    await navigate(sibling);
    assert.deepEqual(await replay(), []);
    assert.deepEqual(await rendererReplay(), []);
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
    assert.equal(held.streamPending, true);
    assert.ok((await backend.call('replay', { after: 0 })).events.every(event => event.mission?.id !== mission.id));

    backend.observeMissionHostSignal({ storageAdmitted: true });
    let result = await read();
    const deadline = performance.now() + 4000;
    while (['queued', 'running'].includes(result.outcome) && performance.now() < deadline) {
      await delay(20);
      result = await read();
    }
    assert.equal(result.outcome, 'verified');
    assert.equal(result.streamPending, undefined);
    const published = (await backend.call('replay', { after: 0 })).events.filter(event => event.mission?.id === mission.id);
    assert.deepEqual(published.filter(event => event.mission?.kind !== 'report-posted').map(event => event.mission?.seq),
      result.events.map(event => event.seq));
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

for (const fault of ['lifecycle', 'acknowledgement', 'report'] as const) {
  test(`mission ${fault} publication recovers after worker termination without duplicate receipts`, { timeout: 15_000 }, async t => {
    let stage = 'worker and SQLite setup';
    const reportStage = () => t.diagnostic(`Publication fixture stage at abort: ${stage}`);
    t.signal.addEventListener('abort', reportStage, { once: true });
    const directory = mkdtempSync(join(tmpdir(), 'aerynth-mission-publication-'));
    const options = { path: join(directory, 'state.sqlite'), contentPolicy: 'synthetic-only' as const };
    let backend = new Backend(options);
    const live: StreamEvent[] = [];
    backend.subscribe(event => live.push(event));
    const firstRequestId = `publication-${fault}`;
    const navigate = (workspaceId: string) => backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const stream = async (id: string) => (await backend.call('replay', { limit: 1000 })).events.filter(event => event.mission?.id === id);
    const reports = async (id: string) => {
      const state = await backend.call('vela', { name: 'state', input: {} }) as VelaState;
      return state.conversation?.messages.filter(message => message.missionReport?.missionId === id) ?? [];
    };
    const start = async (requestId: string) => {
      const objective = 'Measure CPU and RAM';
      const preview = await backend.call('missions', { name: 'preview', input: { objective } }) as MissionPreview;
      return await backend.call('missions', { name: 'start', input: {
        objective, fingerprint: preview.fingerprint, requestId,
      } }) as MissionProjection;
    };
    const verified = async (id: string) => {
      const read = () => backend.call('missions', { name: 'read', input: { id } }) as Promise<MissionProjection>;
      let mission = await read();
      const deadline = performance.now() + 5000;
      while (['queued', 'running'].includes(mission.outcome) && performance.now() < deadline) {
        await delay(20);
        mission = await read();
      }
      assert.equal(mission.outcome, 'verified', nativeMissionDiagnostics(mission));
      return mission;
    };
    const pending = (id: string) => {
      const db = new DatabaseSync(options.path, { readOnly: true });
      try {
        db.exec('PRAGMA busy_timeout=1000');
        return {
          lifecycle: Number(db.prepare('SELECT count(*) AS count FROM vela_mission_lifecycle_outbox WHERE mission_id=?').get(id)?.count),
          report: Number(db.prepare('SELECT count(*) AS count FROM vela_mission_report_outbox WHERE mission_id=?').get(id)?.count),
        };
      } finally { db.close(); }
    };
    try {
      const project = (await backend.call('desktop', { type: 'createProject', title: 'Synthetic publication project' })).projects[0];
      const workspace = async (title: string) => {
        const view = await backend.call('desktop', { type: 'createWorkspace', title, projectId: project.id });
        return view.workspaces.find(item => item.title === title)!.id;
      };
      const origin = await workspace('Synthetic publication origin');
      const sibling = await workspace('Synthetic publication sibling');
      await navigate(origin);
      const db = new DatabaseSync(options.path);
      try {
        const selected = `(SELECT id FROM vela_missions WHERE request_id='${firstRequestId}')`;
        const trigger = {
          lifecycle: `BEFORE INSERT ON intelligence_events
            WHEN json_extract(NEW.json,'$.mission.id')=${selected}
              AND json_extract(NEW.json,'$.type')='vela.mission/settled'
              AND json_extract(NEW.json,'$.mission.taskId')='cpu'`,
          acknowledgement: `BEFORE DELETE ON vela_mission_lifecycle_outbox
            WHEN OLD.mission_id=${selected} AND EXISTS (SELECT 1 FROM vela_missions AS mission, json_each(mission.json,'$.events') AS event
              WHERE mission.id=OLD.mission_id AND json_extract(event.value,'$.seq')=OLD.seq
                AND json_extract(event.value,'$.kind')='settled' AND json_extract(event.value,'$.taskId')='cpu')`,
          report: `BEFORE INSERT ON vela_mission_report_links WHEN NEW.mission_id=${selected}`,
        }[fault];
        db.exec(`CREATE TRIGGER test_mission_publication_fault ${trigger}
          BEGIN SELECT RAISE(ABORT,'test mission publication failure'); END;`);
      } finally { db.close(); }

      stage = 'first native mission verification';
      const first = await verified((await start(firstRequestId)).id);
      stage = 'outbox fault assertions';
      const retained = await stream(first.id);
      assert.ok(retained.some(event => event.mission?.kind === 'created'));
      const beforeLoss = pending(first.id);
      assert.equal(beforeLoss.report, 1);
      assert.equal(first.reportPending, true);
      assert.equal(first.streamPending, fault === 'report' ? undefined : true);
      assert.deepEqual(await reports(first.id), []);
      let independent: MissionProjection | undefined;
      if (fault !== 'report') {
        assert.ok(beforeLoss.lifecycle > 0);
        const cpuSettled = (event: StreamEvent) => event.mission?.id === first.id &&
          event.mission.kind === 'settled' && event.mission.taskId === 'cpu';
        assert.ok(!retained.some(cpuSettled));
        assert.ok(!live.some(cpuSettled), 'A rolled-back event must never be delivered live');
      } else {
        assert.equal(beforeLoss.lifecycle, 0);
        assert.deepEqual(retained.map(event => event.mission?.seq), first.events.map(event => event.seq));
        stage = 'independent native mission verification';
        independent = await verified((await start('publication-independent')).id);
        assert.equal((await reports(independent.id)).length, 1, 'A failed report must not block another mission');
        assert.deepEqual(pending(independent.id), { lifecycle: 0, report: 0 });
        assert.deepEqual(pending(first.id), beforeLoss);
      }

      stage = 'worker termination and restart';
      await backend.terminate();
      const maintenance = new DatabaseSync(options.path);
      try { maintenance.exec('DROP TRIGGER test_mission_publication_fault'); }
      finally { maintenance.close(); }
      backend = new Backend(options);
      // The first ordinary request only waits for worker startup. Inspect SQLite
      // before asking either projection to prove recovery happened at startup.
      await backend.call('providerActivity', {});
      stage = 'restored outbox and receipt assertions';
      assert.deepEqual(pending(first.id), { lifecycle: 0, report: 0 });
      const repaired = await stream(first.id);
      const lifecycle = repaired.filter(event => event.mission?.kind !== 'report-posted');
      assert.deepEqual(lifecycle.map(event => event.mission?.seq), first.events.map(event => event.seq));
      assert.deepEqual(lifecycle.map(event => event.mission?.occurredAt), first.events.map(event => event.time));
      for (const event of retained) assert.deepEqual(repaired.find(item => item.eventId === event.eventId), event);
      assert.equal(repaired.filter(event => event.mission?.kind === 'report-posted').length, 1);
      assert.equal(new Set(repaired.map(event => event.eventId)).size, repaired.length);
      const final = await reports(first.id);
      assert.equal(final.length, 1);
      assert.equal(final[0].content, first.answer!.join('\n'));
      assert.deepEqual(final[0].missionReport, { missionId: first.id, workspaceId: origin, projectId: project.id, jobsDone: 2 });
      assert.deepEqual(await backend.call('missions', { name: 'post-report', input: { id: first.id } }), {
        kind: 'mission-report', missionId: first.id, messageId: final[0].id,
      });
      assert.deepEqual(await reports(first.id), final);
      if (independent) assert.equal((await reports(independent.id)).length, 1);
      if (fault === 'report') {
        const retryRequest = 'publication-retry-live';
        const connection = new DatabaseSync(options.path);
        try {
          connection.exec('PRAGMA busy_timeout=1000');
          connection.exec(`CREATE TRIGGER test_mission_publication_retry BEFORE INSERT ON vela_mission_report_links
            WHEN NEW.mission_id=(SELECT id FROM vela_missions WHERE request_id='${retryRequest}')
            BEGIN SELECT RAISE(ABORT,'test temporary report publication failure'); END;`);
          stage = 'live retry native mission verification';
          const delayed = await verified((await start(retryRequest)).id);
          assert.equal(delayed.reportPending, true);
          connection.exec('DROP TRIGGER test_mission_publication_retry');
          stage = 'live report retry after fault removal';
          const retryDeadline = performance.now() + 5500;
          while (pending(delayed.id).report && performance.now() < retryDeadline) await delay(25);
          assert.deepEqual(pending(delayed.id), { lifecycle: 0, report: 0 });
          assert.equal((await reports(delayed.id)).length, 1);
        } finally { connection.close(); }
      }
      stage = 'sibling isolation assertions';
      await navigate(sibling);
      assert.deepEqual(await stream(first.id), []);
      assert.deepEqual(await reports(first.id), []);
      assert.equal((await backend.call('providerActivity', {})).providerRequests, 0);
    } finally {
      stage = 'worker and fixture cleanup';
      await backend.close();
      const target = resolve(directory);
      assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-publication-'));
      rmSync(target, { recursive: true, force: true });
      t.signal.removeEventListener('abort', reportStage);
    }
  });
}
