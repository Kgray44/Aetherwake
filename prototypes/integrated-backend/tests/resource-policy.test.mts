import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMissionAdmission } from '../src/mission-admission.mts';
import type { ResourceKind } from '../src/resource-policy.mts';

test('local memory pressure preserves the independent remote budget', () => {
  const governor = createMissionAdmission({ maxWorkers: 3, availableMemory: () => 0, readWindowsPressure: null });
  try {
    governor.read(true);
    const lease = (kind: ResourceKind, attemptId: string) => governor.tryLease({
      missionId: 'mission', taskId: attemptId, attemptId, kind, timeoutMs: 1000,
    });
    assert.equal(lease('cpu', 'cpu'), undefined);
    const remote = lease('remote', 'remote');
    assert.ok(remote);
    assert.equal(lease('remote', 'remote'), undefined);
    remote.release();
    assert.ok(lease('remote', 'remote'));
  } finally { governor.dispose(); }
});

test('policy changes request a safe point, retain reservations, and roll back with a version check', () => {
  let time = 0;
  const governor = createMissionAdmission({ maxWorkers: 3, now: () => time, availableMemory: () => 1024 ** 3,
    readWindowsPressure: null });
  const request = { missionId: 'mission', taskId: 'build', attemptId: 'build', kind: 'build' as const,
    timeoutMs: 1000, estimatedRamBytes: 256 * 1024 ** 2 };
  try {
    governor.read(true);
    const lease = governor.tryLease(request)!;
    assert.ok(lease);
    const current = governor.inspectPolicy();
    governor.configurePolicy(current.configVersion, { mode: 'gaming_focus', limits: current.limits });
    assert.equal(lease.checkpointRequested.reason, 'resource-pressure');
    assert.equal(governor.inspectPolicy().reservedRamBytes, request.estimatedRamBytes);
    assert.throws(() => governor.rollbackPolicy(current.configVersion), /resource_policy_rollback_unavailable/u);
    governor.rollbackPolicy(current.configVersion + 1);
    assert.equal(governor.inspectPolicy().mode, 'balanced');
    assert.equal(governor.tryLease({ ...request, attemptId: 'second' }), undefined);
    lease.release();
    assert.ok(governor.tryLease({ ...request, attemptId: 'second' }));
    time = 5_001;
    assert.equal(governor.canLease('cpu'), false, 'stale RAM samples cannot admit local work');
  } finally { governor.dispose(); }
});

test('bounded host observations preserve overlap during CPU warmup and obey the local memory floor', () => {
  let free = 1024 ** 3;
  const governor = createMissionAdmission({ maxWorkers: 3, availableMemory: () => free, readWindowsPressure: null });
  const request = { missionId: 'mission', taskId: 'observe', kind: 'host_io' as const, timeoutMs: 1000 };
  try {
    governor.read(true);
    assert.equal(governor.inspectPolicy().effective.cpu, 1);
    const first = governor.tryLease({ ...request, attemptId: 'first' });
    const second = governor.tryLease({ ...request, attemptId: 'second' });
    assert.ok(first && second);
    free = 0;
    governor.read(true);
    assert.equal(governor.canLease('host_io'), false);
    assert.equal(first.checkpointRequested.reason, 'resource-pressure');
    assert.equal(second.checkpointRequested.reason, 'resource-pressure');
  } finally { governor.dispose(); }
});
