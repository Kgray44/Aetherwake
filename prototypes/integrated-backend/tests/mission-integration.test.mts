import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Backend } from '../src/service.mts';
import type { MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';

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
    assert.ok(draft.cards.some(card => card.kind === 'checklist'));
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
    assert.equal((await backend.call('desktop', { type: 'snapshot' })).workspaces.length, prior.workspaces.length + 1);
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
    const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic crash workspace', projectId: null });
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
    const id = await Promise.race([admitted, delay(1500, 'timeout', { ref: false })]);
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
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(relative(resolve(tmpdir()), target).startsWith('aerynth-mission-crash-'));
    rmSync(target, { recursive: true, force: true });
  }
});
