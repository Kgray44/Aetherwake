import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMissionExecutiveRevision } from '../src/mission-executive.mts';
import type { MissionProjection, MissionRevisionPreview } from '../src/mission-contracts.mts';

const snapshot = (): MissionProjection => ({
  id: 'mission', revision: 8, planRevision: 1, disposition: 'paused', outcome: 'paused', objective: 'Inspect a failed fixture',
  tasks: [
    { id: 'done', objective: 'Read the fixture', state: 'verified', dependencies: [], attempts: [] },
    { id: 'failed', objective: 'Verify the fixture', state: 'failed', dependencies: ['done'],
      attempts: [{ finishedAt: '2026-11-11T00:00:00Z', outcome: 'failed', verification: { passed: false } }] },
  ],
  events: [{ seq: 7, kind: 'settled', taskId: 'failed' }],
}) as MissionProjection;

const model = { version: 1, action: 'replace', target: 't2', related: [], reason: 'Verification failed with a known result.' };

test('Executive proposals use current MissionService revision preview and preserve completed work', async () => {
  const mission = snapshot();
  const result = await proposeMissionExecutiveRevision(7, {
    read: () => structuredClone(mission),
    disclose: async packet => {
      assert.equal(packet.trigger.task, 't2');
      assert.deepEqual(packet.tasks.map(task => task.handle), ['t1', 't2']);
      return model;
    },
    preview: (revision, change) => {
      assert.equal(revision, 8);
      assert.deepEqual(change, { type: 'replace', taskId: 'failed' });
      return { missionId: mission.id, kind: 'revision-preview', revision, fingerprint: 'fixture', summary: 'Review fixture change' } satisfies MissionRevisionPreview;
    },
  });
  assert.equal(result.state, 'reviewable');
  assert.equal(mission.tasks[0].state, 'verified');
});

test('Executive refuses changes against moved state, unknown effects, or completed tasks', async () => {
  for (const scenario of ['moved', 'unknown', 'complete'] as const) {
    const mission = snapshot();
    if (scenario === 'unknown') mission.tasks[1].state = 'uncertain';
    const result = await proposeMissionExecutiveRevision(7, {
      read: () => structuredClone(mission),
      disclose: async () => {
        if (scenario === 'moved') mission.revision++;
        return { ...model, target: scenario === 'complete' ? 't1' : 't2' };
      },
      preview: () => assert.fail('unsafe model output reached MissionService'),
    });
    assert.notEqual(result.state, 'reviewable');
  }
});

test('same-revision evidence invalidation prevents stale Executive proposals', async () => {
  const mission = snapshot();
  mission.tasks[0].attempts = [structuredClone(mission.tasks[1].attempts[0])];
  mission.tasks[0].attempts[0].verification!.passed = true;
  const result = await proposeMissionExecutiveRevision(7, {
    read: () => structuredClone(mission),
    disclose: async (packet, _signal, current) => {
      assert.equal(packet.tasks[0].verified, true);
      assert.equal(current(), true);
      mission.tasks[0].attempts[0].verification = undefined;
      assert.equal(current(), false);
      return model;
    },
    preview: () => assert.fail('stale verification reached MissionService'),
  });
  assert.equal(result.state, 'stale');
});
