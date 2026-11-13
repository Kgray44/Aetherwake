import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createAepNativeHost } from '../src/aep-native-host.mts';
import { MissionService } from '../src/mission-service.mts';
import { nativeMissionExecutors } from '../src/mission-native.mts';
import { nativeTrialProtocol } from '../src/aep-native-trial.mts';

test('native authority rejects forged promotion, foreign scope, and changed governor configuration', async () => {
  const db = new DatabaseSync(':memory:');
  const scope = { workspaceId: 'lab', projectId: null };
  const other = { workspaceId: 'other', projectId: null };
  let configVersion = 1;
  let authorized = true;
  const atomic = <T,>(work: () => T) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const permits = (requested: typeof scope) => authorized && requested.workspaceId === scope.workspaceId;
  const missions = new MissionService({ db, atomic, authorized: permits, executors: nativeMissionExecutors, laneLimit: () => 2 });
  const createHost = () => createAepNativeHost(db, missions, {
    atomic, authorized: current => current.projectId === null && permits({ ...current, projectId: null }),
    governorVersion: () => configVersion, admit: () => {},
  });
  const host = createHost();
  try {
    const record = await host.command(scope, { name: 'propose', candidate: 'parallel' });
    assert.ok(record && 'experiment' in record);
    const { id, revision } = record.experiment;
    assert.equal(createHost().list(scope).experiments[0]?.id, id);
    assert.equal(host.finding(scope, id, nativeTrialProtocol), null);
    await assert.rejects(host.command(scope, { name: 'promote', id, revision, policyVersion: 1 }), /aep_promotion_unqualified/);
    await assert.rejects(host.command(scope, { name: 'promote', id, revision, policyVersion: 1, passed: true } as never),
      /aep_invalid_native_request/);
    assert.throws(() => host.evidence(other, id), /aep_scope_denied/);
    configVersion = 2;
    await assert.rejects(host.command(scope, { name: 'test', id }), /aep_trial_environment_changed/);
    assert.equal(host.evidence(scope, id).trials.length, 0);
    const review = { name: 'rollback-reviewed' as const, ...scope, experimentId: id, policyVersion: 1 };
    await assert.rejects(host.command(scope, review), /aep_policy_review_changed/);
    missions.experiencePolicy.promote(scope, 1, id, 'test-cohort', configVersion, Date.now());
    await assert.rejects(host.command(scope, { ...review, policyVersion: 2, workspaceId: other.workspaceId }),
      /aep_policy_review_changed/);
    await assert.rejects(host.command(scope, { ...review, policyVersion: 2, experimentId: 'different' }),
      /aep_policy_review_changed/);
    await assert.rejects(host.command(scope, review), /aep_policy_review_changed/);
    assert.equal(missions.experiencePolicy.read(scope).experimentId, id);
    await assert.rejects(host.command(scope, { ...review, policyVersion: 2 }), /aep_policy_transition_unavailable/);
    assert.equal(missions.experiencePolicy.read(scope).version, 2);
    assert.equal(missions.experiencePolicy.read(scope).experimentId, id);
    authorized = false;
    assert.throws(() => host.finding(scope, id, nativeTrialProtocol), /aep_scope_denied/);
  } finally { await missions.close(); db.close(); }
});
