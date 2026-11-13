import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createMissionExperiencePolicy } from '../src/mission-experience-policy.mts';
import { retrieveExperientialContext } from '../../vela-core/src/experiential-context.mts';
import { NativeExperimentLedger } from '../src/aep-native-experiment.mts';

test('registers a durable exact-scope protocol without accepting imported results or caller-controlled gates', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const scope = { workspaceId: 'lab', projectId: null };
    const other = { workspaceId: 'other', projectId: null };
    const owner = new NativeExperimentLedger(db, () => true);
    const record = owner.propose(scope, 'parallel');
    assert.equal(record.state, 'proposed');
    assert.equal(record.experiment.revision, 1);
    assert.equal(new NativeExperimentLedger(db, () => true).read(scope, record.experiment.id).state, 'proposed');
    assert.throws(() => owner.read(other, record.experiment.id), /aep_experiment_unavailable/);
    assert.throws(() => new NativeExperimentLedger(db, () => false).read(scope, record.experiment.id), /aep_scope_denied/);
    assert.throws(() => owner.propose(scope, 'caller-controlled' as never), /aep_candidate_unsupported/);
  } finally { db.close(); }
});

test('MissionService policy compare-and-set is exact-scope and rollback invalidates the old version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const scope = { workspaceId: 'lab', projectId: null };
    const other = { ...scope, projectId: 'other-project' };
    const first = createMissionExperiencePolicy(db), reopened = createMissionExperiencePolicy(db);
    assert.throws(() => first.promote(scope, 4, 'e', 'device', 1, 10), /aep_policy_version_changed/);
    const promoted = first.promote(scope, 1, 'e', 'device', 1, 10);
    assert.equal(promoted.version, 2);
    assert.equal(reopened.read(scope).experimentId, 'e');
    assert.equal(reopened.read(other).experimentId, null);
    assert.throws(() => reopened.promote(scope, 1, 'different', 'device', 1, 10), /aep_policy_version_changed/);
    assert.throws(() => first.rollback(scope, 1), /aep_policy_rollback_unavailable/);
    const rolledBack = reopened.rollback(scope, promoted.version);
    assert.equal(rolledBack.version, 3);
    assert.equal(first.read(scope).experimentId, null);
  } finally { db.close(); }
});

test('CIE exact lookup skips the source owner for unrelated cohorts', () => {
  const scope = { workspaceId: 'lab', projectId: null };
  const seen: unknown[] = [];
  const source = { cohort: 'exact', resolve: (s: typeof scope, id: string) => { seen.push(s); return { id }; } };
  assert.equal(retrieveExperientialContext({ scope, experimentId: 'x', cohort: 'other' }, source), null);
  assert.deepEqual(seen, []);
  assert.deepEqual(retrieveExperientialContext({ scope, experimentId: 'x', cohort: 'exact' }, source), { id: 'x' });
  assert.deepEqual(seen, [scope]);
});
