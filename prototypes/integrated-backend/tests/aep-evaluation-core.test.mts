import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BackendCore } from '../src/core.mts';
import { nativeMissionExecutors } from '../src/mission-native.mts';
import { AEP_EVALUATION_REFERENCE_CONTRACT } from '../src/aep-evaluation-reference.mts';
import type { MissionPreview, MissionProjection } from '../src/mission-contracts.mts';

test('Core read command resolves retained canonical proof after reopen and denies another workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-fi0-evaluation-'));
  const options = { path: join(dir, 'profile.sqlite'), provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  const cpu = nativeMissionExecutors['sample.cpu'], originalRun = cpu.run;
  cpu.run = async () => ({ source: 'node:os.cpus', value: { source: 'node:os.cpus', metric: 'cpu', percent: 12,
    sampleMs: 500, logicalCpus: 4, measuredAt: '2026-11-12T00:00:00.000Z' } });
  let core = new BackendCore(options, () => {});
  try {
    const desktop = await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic FI0', projectId: null });
    const workspaceId = desktop.workspaces[0].id;
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const activity = await core.command('providerActivity', {});
    const objective = 'Run a mission to measure CPU';
    const preview = await core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    let mission = await core.command('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint,
      requestId: 'fi0-evaluation-core' } }) as MissionProjection;
    const deadline = performance.now() + 8000;
    while (['queued', 'running'].includes(mission.outcome) && performance.now() < deadline) {
      await delay(20); mission = await core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    }
    assert.equal(mission.outcome, 'verified');
    const attempt = mission.tasks[0].attempts[0];
    const input = { contract: AEP_EVALUATION_REFERENCE_CONTRACT, namespace: 'mission-verification' as const,
      missionId: mission.id, missionRevision: mission.revision, planRevision: mission.planRevision,
      taskId: mission.tasks[0].id, attemptId: attempt.id, evidenceId: attempt.evidence!.id };
    const before = await core.command('missions', { name: 'evaluation-reference', input });
    assert.ok(before && 'kind' in before && before.kind === 'evaluation-reference');
    assert.equal(before.independentExperimentQuality, 'not-evaluated');
    assert.deepEqual(await core.command('providerActivity', {}), activity);
    await core.command('close', {});
    core = new BackendCore(options, () => {});
    assert.deepEqual(await core.command('missions', { name: 'evaluation-reference', input }), before);
    const other = await core.command('desktop', { type: 'createWorkspace', title: 'Other synthetic FI0', projectId: null });
    const otherId = other.workspaces.find(w => w.id !== workspaceId)!.id;
    await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: otherId } });
    await assert.rejects(core.command('missions', { name: 'evaluation-reference', input }), /mission_not_found/);
  } finally { cpu.run = originalRun; await core.command('close', {}); rmSync(dir, { recursive: true, force: true }); }
});
