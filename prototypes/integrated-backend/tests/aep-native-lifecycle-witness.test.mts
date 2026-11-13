import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAepNativeHost } from '../src/aep-native-host.mts';
import { nativeTrialProtocol } from '../src/aep-native-trial.mts';
import { MissionService } from '../src/mission-service.mts';
import { nativeMissionExecutors } from '../src/mission-native.mts';
import { SYSTEM_MEMORY_CONTRACT } from '../../vela-core/src/system-information.ts';
import type { MissionExecutor, MissionScope } from '../src/mission-contracts.mts';

test('synthetic paired qualification survives reopen and a monitored evidence regression rolls back', { timeout: 45_000 }, async () => {
  const scope: MissionScope = { workspaceId: 'fi5-synthetic', projectId: null };
  const root = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), 'fi5-synthetic-profile-'));
  const profile = join(root, 'profile.sqlite');
  const measuredAt = '2026-11-13T00:00:00.000Z';
  let wrongSource = false;
  const executors: Record<string, MissionExecutor> = {
    'sample.cpu': { ...nativeMissionExecutors['sample.cpu'], async run({ signal }) {
      await delay(125, undefined, { signal });
      return { source: 'node:os.cpus', value: {
        source: 'node:os.cpus', metric: 'cpu', percent: 20, sampleMs: 250, logicalCpus: 8, measuredAt,
      } };
    } },
    'sample.backend': { ...nativeMissionExecutors['sample.backend'], async run({ signal }) {
      await delay(125, undefined, { signal });
      return { source: wrongSource ? 'synthetic:wrong-backend-source' : 'aerynth.backend.node', value: {
        rssBytes: 2048, heapUsedBytes: 1024, timerOvershootMs: 0, sampleWindowMs: 100,
      } };
    } },
    'sample.ram': { ...nativeMissionExecutors['sample.ram'], async run() {
      return { source: 'node:os.totalmem+freemem', value: {
        contract: SYSTEM_MEMORY_CONTRACT, totalBytes: 8192, availableBytes: 4096, usedBytes: 4096,
        utilizationPercent: 50, measuredAt, source: {
          kind: 'node:os', api: 'totalmem+freemem', scope: 'host-physical-memory', platform: 'win32',
        }, interpretation: {
          available: 'windows-available-physical', used: 'total-minus-available', excludes: 'process-and-committed-memory',
        },
      } };
    } },
    'join.samples': nativeMissionExecutors['join.samples'],
  };
  function open() {
    const db = new DatabaseSync(profile);
    const authorized = (candidate: MissionScope) =>
      candidate.workspaceId === scope.workspaceId && candidate.projectId === scope.projectId;
    function atomic<T>(work: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    const missions = new MissionService({ db, atomic, authorized, executors, laneLimit: () => 2 });
    const host = createAepNativeHost(db, missions, {
      atomic, authorized, governorVersion: () => 1, admit: () => {},
    });
    return { host, missions, async close() { await missions.close(); db.close(); } };
  }

  let session = open();
  try {
    const proposal = await session.host.command(scope, { name: 'propose', candidate: 'parallel' });
    assert.ok(proposal && 'experiment' in proposal);
    const id = proposal.experiment.id;
    const tested = await session.host.command(scope, { name: 'test', id });
    assert.ok(tested && 'experiment' in tested);
    assert.equal(tested.state, 'accepted', JSON.stringify(tested.result));
    assert.equal(tested.trials.length, 24);
    assert.ok(tested.result?.controlled && tested.result.gatesPassed);
    const promoted = await session.host.command(scope, {
      name: 'promote', id, revision: tested.experiment.revision, policyVersion: 1,
    });
    assert.ok(promoted && 'version' in promoted);
    assert.equal(promoted.version, 2);
    const originalTrials = session.host.evidence(scope, id).trials;

    await session.close();
    session = open();
    const finding = session.host.finding(scope, id, nativeTrialProtocol);
    assert.equal(finding?.policy?.version, 2);
    assert.equal(finding?.policy?.experimentId, id);
    assert.equal(session.host.finding(scope, id, 'unrelated'), null);
    const applied = await session.host.command(scope, { name: 'start-probe' });
    assert.ok(applied && 'concurrency' in applied);
    assert.equal(applied.concurrency, 2);
    assert.equal(applied.appliedPolicy?.version, 2);
    assert.ok(Object.values(applied.assessment.gates).every(Boolean));

    // The executor verifier accepts the shape. The independent oracle rejects its provenance.
    wrongSource = true;
    const regressed = await session.host.command(scope, { name: 'start-probe' });
    assert.ok(regressed && 'concurrency' in regressed);
    assert.equal(regressed.concurrency, 2);
    assert.equal(regressed.appliedPolicy?.version, 2);
    assert.equal(session.missions.read(regressed.missionId, scope).outcome, 'verified');
    assert.equal(regressed.assessment.gates.outputQuality, false);
    assert.equal(regressed.currentPolicy.version, 3);
    assert.equal(regressed.currentPolicy.experimentId, null);
    assert.equal(session.host.finding(scope, id, nativeTrialProtocol)?.policy, null);

    wrongSource = false;
    const after = await session.host.command(scope, { name: 'start-probe' });
    assert.ok(after && 'concurrency' in after);
    assert.equal(after.concurrency, 1);
    assert.equal(after.appliedPolicy, null);
    assert.ok(Object.values(after.assessment.gates).every(Boolean));

    await session.close();
    session = open();
    const history = session.host.evidence(scope, id);
    assert.equal(history.record.state, 'rolled-back');
    assert.deepEqual(history.trials, originalTrials);
    assert.deepEqual(history.record.policyReceipts.map(receipt => [receipt.state, receipt.policy.version]), [
      ['promoted', 2], ['monitored', 2], ['monitored', 2], ['rolled-back', 3],
    ]);
    assert.equal(history.record.policyReceipts[2].monitorMissionId, regressed.missionId);
    assert.equal(session.host.finding(scope, id, nativeTrialProtocol)?.policy, null);
    console.log(JSON.stringify({ synthetic: true, result: tested.result, trialCount: originalTrials.length,
      promotedVersion: promoted.version, monitoredQuality: regressed.assessment.gates,
      restoredVersion: regressed.currentPolicy.version, nextProbeConcurrency: after.concurrency }));
  } finally {
    await session.close();
    assert.equal(dirname(root), dirname(fileURLToPath(import.meta.url)));
    rmSync(root, { recursive: true, force: true });
  }
});
