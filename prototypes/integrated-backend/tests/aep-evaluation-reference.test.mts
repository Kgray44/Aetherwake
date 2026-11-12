import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService } from '../src/mission-service.mts';
import { createSystemMemoryReader } from '../../vela-core/src/system-memory.mts';
import { nativeMissionExecutors } from '../src/mission-native.mts';
import { AEP_EVALUATION_REFERENCE_CONTRACT, aepEvaluationReferenceId, readAepEvaluationReference,
  resolveAepEvaluationReference } from '../src/aep-evaluation-reference.mts';
import type { MissionScope } from '../src/mission-contracts.mts';

const scope = { workspaceId: 'workspace-fi0', projectId: 'project-fi0' };
async function fixture(executor = 'sample.cpu') {
  const db = new DatabaseSync(':memory:');
  let access = true, sourceVersion = 'v1';
  const service = new MissionService({ db,
    atomic<T>(fn: () => T) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    authorized: (requested: MissionScope) => access && requested.workspaceId === scope.workspaceId && requested.projectId === scope.projectId,
    contextSource: () => ({ scopeVersion: () => sourceVersion, retrieve: () => [], read: () => null }),
    executors: { [executor]: { ...nativeMissionExecutors[executor],
      async run() { if (executor === 'sample.ram') return { source: 'node:os.totalmem+freemem',
        value: createSystemMemoryReader({ totalmem: () => 8 * 2 ** 30, freemem: () => 4 * 2 ** 30, platform: () => 'linux' }, () => 1_800_000_000_000)() };
        return { source: 'node:os.cpus', value: { source: 'node:os.cpus', metric: 'cpu', percent: 10,
        sampleMs: 500, logicalCpus: 4, measuredAt: '2026-11-12T00:00:00.000Z' } }; } } },
    laneLimit: () => 1,
  });
  const created = service.create('fi0-reference-test', { scope, objective: 'Synthetic native sample', criteria: ['cpu'],
    tasks: [{ id: 'cpu', objective: 'Synthetic native sample', executor, criterion: 'cpu', dependencies: [],
      claims: [{ resource: 'host.cpu', mode: 'read' }], timeoutMs: 1000, maxAttempts: 1 }] });
  for (let i = 0; i < 20 && service.read(created.id, scope).outcome !== 'verified'; i++) await flush();
  const mission = service.read(created.id, scope), attempt = mission.tasks[0].attempts[0];
  assert.equal(mission.outcome, 'verified');
  const reference = { contract: AEP_EVALUATION_REFERENCE_CONTRACT, namespace: 'mission-verification' as const,
    missionId: mission.id, missionRevision: mission.revision, planRevision: mission.planRevision,
    taskId: 'cpu', attemptId: attempt.id, evidenceId: attempt.evidence!.id };
  return { db, service, reference, revoke: () => { access = false; }, changeSource: () => { sourceVersion = 'v2'; },
    close: async () => { await service.close(); db.close(); } };
}

test('closed versioned references reject invented namespaces, authority and incomplete identities', () => {
  const ref = { contract: AEP_EVALUATION_REFERENCE_CONTRACT, namespace: 'mission-verification',
    missionId: 'm', missionRevision: 1, planRevision: 1, taskId: 't', attemptId: 'a', evidenceId: 'e' };
  assert.equal(aepEvaluationReferenceId(ref), aepEvaluationReferenceId(Object.fromEntries(Object.entries(ref).reverse())));
  for (const change of [{ contract: 'unknown' }, { namespace: 'model-review' }, { evaluator: 'independent' },
    { missionRevision: 0 }, { planRevision: 1.5 }, { evidenceId: '' }]) {
    assert.throws(() => readAepEvaluationReference({ ...ref, ...change }), /aep_evaluation_reference/);
  }
});
test('real MissionService resolves exact host verification without certifying independent experiment quality', async () => {
  const f = await fixture(); try {
    const result = resolveAepEvaluationReference(f.reference, f.service, scope);
    assert.equal(result.id, aepEvaluationReferenceId(f.reference));
    assert.equal(result.authority.owner, 'MissionService');
    assert.equal(result.coverage, 'native-task-evidence-only');
    assert.equal(result.independentExperimentQuality, 'not-evaluated');
    assert.equal(result.policyPromotion, 'not-authorized');
    assert.match(result.assessed.evidenceDigest, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(result).includes('logicalCpus'), false);
    assert.throws(() => resolveAepEvaluationReference({ ...f.reference, missionRevision: 1 }, f.service, scope), /stale/);
    assert.throws(() => resolveAepEvaluationReference({ ...f.reference, planRevision: 2 }, f.service, scope), /stale/);
    assert.throws(() => resolveAepEvaluationReference({ ...f.reference, taskId: 'other' }, f.service, scope), /unsupported/);
    assert.throws(() => resolveAepEvaluationReference({ ...f.reference, attemptId: 'other' }, f.service, scope), /unavailable/);
    assert.throws(() => resolveAepEvaluationReference({ ...f.reference, evidenceId: 'other' }, f.service, scope), /unavailable/);
    assert.throws(() => resolveAepEvaluationReference(f.reference, f.service, { ...scope, workspaceId: 'other' }), /mission_not_found/);
  } finally { await f.close(); }
});
test('source correction and authorization withdrawal invalidate subsequent canonical reads', async () => {
  const f = await fixture(); try {
    resolveAepEvaluationReference(f.reference, f.service, scope);
    f.changeSource();
    assert.throws(() => resolveAepEvaluationReference(f.reference, f.service, scope), /unavailable/);
    f.revoke();
    assert.throws(() => resolveAepEvaluationReference(f.reference, f.service, scope), /mission_not_found/);
  } finally { await f.close(); }
});

test('unsupported canonical task authority and mismatched source cannot masquerade as a host oracle', async () => {
  const f = await fixture(); try {
    const row = f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(f.reference.missionId)!;
    const original = JSON.parse(String(row.json));
    const save = (value: unknown) => f.db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(value), f.reference.missionId);
    const changed = structuredClone(original);
    changed.tasks[0].executor = 'chatgpt.specialist';
    save(changed);
    assert.throws(() => resolveAepEvaluationReference(f.reference, f.service, scope), /authority_unsupported/);
    changed.tasks[0].executor = 'sample.cpu';
    changed.tasks[0].attempts[0].evidence.source = 'openai-api-vela:reported';
    save(changed);
    assert.throws(() => resolveAepEvaluationReference(f.reference, f.service, scope), /unavailable/);
    save(original);
  } finally { await f.close(); }
});

test('supported RAM oracle uses canonical physical-memory verification and never projects sample bodies', async () => {
  const f = await fixture('sample.ram'); try {
    const result = resolveAepEvaluationReference(f.reference, f.service, scope);
    assert.equal(result.authority.executor, 'sample.ram');
    assert.equal(result.result, 'passed');
    assert.equal(JSON.stringify(result).includes('availableBytes'), false);
  } finally { await f.close(); }
});
