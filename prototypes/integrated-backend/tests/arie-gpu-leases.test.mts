import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourcePolicy } from '../src/resource-policy.mts';

test('GPU admission requires a fresh process budget, matching context and bounded reservation', () => {
  let time = 0;
  const mib = 2 ** 20;
  const policy = createResourcePolicy(3, 512 * mib, () => time, Date.now, { mode: 'balanced',
    limits: { cpu: 3, build: 1, gpu: 1, host_io: 3, remote: 3 } });
  const sample = { workerLimit: 3, reasons: [], readings: { availableMemoryBytes: { value: 4096 * mib, observedAt: '' } } };
  const request = { missionId: 'mission', taskId: 'gpu', attemptId: 'attempt', kind: 'gpu' as const,
    timeoutMs: 4000, gpuContextId: 'process-one', estimatedVramBytes: 256 * mib };
  try {
    policy.update(sample, Infinity);
    assert.equal(policy.tryLease(request), undefined);
    policy.noteGpuBudget({ contextId: 'process-one', budgetBytes: 1024 * mib, usedBytes: 512 * mib });
    assert.equal(policy.tryLease({ ...request, gpuContextId: 'process-two' }), undefined);
    assert.equal(policy.tryLease({ ...request, estimatedVramBytes: 600 * mib }), undefined);
    const lease = policy.tryLease(request);
    assert.ok(lease);
    assert.equal(lease.receipt.reservedVramBytes, 256 * mib);
    assert.equal(policy.tryLease({ ...request, attemptId: 'second' }), undefined);
    policy.update({ ...sample, reasons: ['renderer-latency'] }, Infinity);
    assert.equal(lease.checkpointRequested.aborted, true);
    assert.equal(policy.inspect().active.gpu, 1);
    lease.release();
    time = 6500;
    policy.update(sample, Infinity);
    assert.equal(policy.tryLease(request), undefined);
    assert.equal(policy.canLease('remote'), true);
  } finally { policy.dispose(); }
});

test('GPU contention and recovery hold preparation without reducing CPU or remote admission', () => {
  const mib = 2 ** 20;
  let now = 4000;
  const policy = createResourcePolicy(3, 512 * mib, () => now, Date.now, { mode: 'balanced',
    limits: { cpu: 3, build: 1, gpu: 1, host_io: 3, remote: 3 } });
  const sample = { workerLimit: 3, reasons: [], readings: { availableMemoryBytes: { value: 4096 * mib, observedAt: '' },
    cpuPercent: { value: 12, observedAt: '' } } };
  try {
    policy.update(sample, Infinity);
    now += 3500;
    policy.update(sample, Infinity);
    const initial = policy.inspect();
    assert.equal(initial.reason, 'balanced');
    assert.equal(policy.mayPrepareGpu(), true);
    policy.update({ ...sample, reasons: ['gpu-load'] }, Infinity);
    const held = policy.inspect();
    assert.equal(policy.mayPrepareGpu(), false);
    assert.equal(held.reason, 'gpu_contention');
    assert.ok(held.revision > initial.revision);
    assert.deepEqual(held.effective, initial.effective);
    assert.equal(policy.canLease('remote'), true);
    policy.update(sample, Infinity);
    assert.equal(policy.mayPrepareGpu(), false);
    assert.equal(policy.inspect().reason, 'gpu_recovery_dwell');
    assert.deepEqual(policy.inspect().effective, initial.effective);
    now += 2_900;
    policy.update({ ...sample, reasons: ['gpu-load'] }, Infinity);
    assert.equal(policy.inspect().reason, 'gpu_contention');
    policy.update(sample, Infinity);
    now += 2_999;
    policy.update(sample, Infinity);
    assert.equal(policy.mayPrepareGpu(), false);
    assert.equal(policy.canLease('remote'), true);
    now += 1;
    policy.update(sample, Infinity);
    assert.equal(policy.mayPrepareGpu(), true);
    assert.equal(policy.inspect().reason, 'balanced');
  } finally { policy.dispose(); }
});
