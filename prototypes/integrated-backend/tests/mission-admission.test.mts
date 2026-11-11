import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setImmediate as yieldToProbe } from 'node:timers/promises';
import { createMissionAdmission } from '../src/mission-admission.mts';
import { parseNvidiaGpuThermals } from '../src/windows-gpu-thermals.mts';

const mib = 1024 * 1024;
const epoch = Date.parse('2026-01-01T00:00:00Z');

test('memory holds immediately while sustained CPU load limits concurrency and then clears', () => {
  let time = 0, total = 0, idle = 0, free = 1024 * mib;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time, wallNow: () => epoch + time,
    availableMemory: () => free, cpuCounters: () => ({ total, idle, logicalCpus: 4 }), readWindowsPressure: null });
  const sample = (idleTicks: number) => { time += 500; total += 2_000; idle += idleTicks; return admission.read(true); };
  try {
    assert.deepEqual(admission.read(false), { workerLimit: 3, reasons: [], readings: {} });
    admission.noteActivity();
    assert.equal(admission.read(true).workerLimit, 3, 'Input alone is not a host constraint');
    const corroborated = sample(350);
    assert.equal(corroborated.readings.cpuPercent?.value, 82.5);
    assert.deepEqual(corroborated.reasons, ['active-input']);
    time += 3_001;
    assert.equal(sample(100).workerLimit, 3, 'One high sample does not imply sustained load');
    const sustained = sample(100);
    assert.equal(sustained.workerLimit, 1);
    assert.deepEqual(sustained.reasons, ['cpu-load']);
    assert.equal(sustained.readings.cpuPercent?.observedAt, new Date(epoch + time).toISOString());
    assert.equal(sample(250).workerLimit, 1, 'Load inside the hysteresis band preserves the prior limit');
    assert.equal(sample(1_000).workerLimit, 3);
    free = 0;
    const held = admission.read(true);
    assert.equal(held.workerLimit, 0);
    assert.deepEqual(held.reasons, ['physical-memory']);
    assert.equal(held.readings.availableMemoryBytes?.value, 0);
    free = 512 * mib;
    assert.equal(admission.read(true).workerLimit, 3);
    time += 5_001;
    assert.deepEqual(admission.read(false).readings, {});
  } finally { admission.dispose(); }
});

test('Windows probes wait for sustained demand, enforce a cooldown and expire individual readings', async () => {
  let time = 0, notifications = 0, probes = 0;
  const responses = [
    { gpuEnginePercent: 97, diskQueueLength: 8 },
    { gpuEnginePercent: 99, diskQueueLength: 9 },
    { gpuEnginePercent: 0 },
  ];
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time, wallNow: () => epoch + time,
    availableMemory: () => 1024 * mib, cpuCounters: () => ({ idle: 0, total: 0, logicalCpus: 0 }),
    readWindowsPressure: async () => responses[probes++] ?? {}, onChange: () => { notifications++; } });
  const readAt = (at: number, demand = true) => { time = at; return admission.read(demand); };
  try {
    readAt(0);
    readAt(1_999);
    readAt(2_000, false);
    await yieldToProbe();
    assert.equal(probes, 0);
    readAt(2_000);
    readAt(2_000);
    assert.equal(notifications, 0, 'An observer does not run inside a scheduler read');
    await yieldToProbe();
    assert.equal(probes, 1);
    assert.equal(notifications, 1);
    const first = readAt(2_000, false);
    assert.equal(first.workerLimit, 3);
    assert.equal(first.readings.gpuEnginePercent?.value, 97);
    for (const at of [6_000, 10_000, 14_000, 18_000, 21_999]) readAt(at);
    await yieldToProbe();
    assert.equal(probes, 1);
    readAt(22_000);
    await yieldToProbe();
    assert.equal(probes, 2);
    const second = readAt(22_000, false);
    assert.equal(second.workerLimit, 1);
    assert.deepEqual(second.reasons, ['gpu-load', 'disk-io']);
    for (const at of [26_000, 30_000, 34_000, 38_000, 42_000]) readAt(at);
    await yieldToProbe();
    const third = readAt(42_000, false);
    assert.equal(third.workerLimit, 3);
    assert.equal(third.readings.gpuEnginePercent?.value, 0);
    assert.equal(third.readings.diskQueueLength, undefined);
    assert.deepEqual(readAt(72_001, false).readings, {});
  } finally { admission.dispose(); }
});

test('a closing admission policy aborts a pending Windows probe and ignores late results', async () => {
  let time = 0, signal: AbortSignal | undefined, notify = 0;
  let observe!: (value: { gpuEnginePercent: number }, stage: 'utilization') => void;
  let resolveProbe!: (result: { gpuEnginePercent: number }) => void;
  const pending = new Promise<{ gpuEnginePercent: number }>(resolve => { resolveProbe = resolve; });
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 * mib, cpuCounters: () => ({ idle: 0, total: 0, logicalCpus: 0 }),
    readWindowsPressure: async (probeSignal, publish) => { signal = probeSignal; observe = publish; return pending; },
    onChange: () => { notify++; } });
  admission.read(true);
  time = 2_000;
  admission.read(true);
  await yieldToProbe();
  assert.equal(signal?.aborted, false);
  admission.dispose();
  assert.equal(signal?.aborted, true);
  observe({ gpuEnginePercent: 100 }, 'utilization');
  resolveProbe({ gpuEnginePercent: 100 });
  await yieldToProbe();
  assert.equal(notify, 0);
  assert.deepEqual(admission.read(false).readings, {});
});

test('separate short missions do not combine their Windows sampler warmup', async () => {
  let time = 0, probes = 0;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 * mib, cpuCounters: () => ({ idle: 0, total: 0, logicalCpus: 0 }),
    readWindowsPressure: async () => { probes++; return {}; } });
  try {
    admission.read(true);
    time = 1_999;
    admission.stopDemand();
    admission.read(true);
    time = 3_998;
    admission.read(true);
    await yieldToProbe();
    assert.equal(probes, 0);
    time = 3_999;
    admission.read(true);
    await yieldToProbe();
    assert.equal(probes, 1);
  } finally { admission.dispose(); }
});

test('an early Windows low-memory notification checkpoints local work before the other counters finish', async () => {
  let time = 0, changes = 0, probes = 0;
  let observe!: (value: { windowsLowMemory: number }, phase: 'memory') => void;
  let finish!: (result: { windowsLowMemory: number }) => void;
  const pending = new Promise<{ windowsLowMemory: number }>(resolve => { finish = resolve; });
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time, wallNow: () => epoch + time,
    availableMemory: () => 1024 * mib, readWindowsPressure: async (_signal, onMemory) => {
      if (++probes > 1) return { windowsLowMemory: 0 };
      observe = onMemory;
      return pending;
    }, onChange: () => { changes++; } });
  try {
    admission.read(true);
    time = 2000;
    admission.read(true);
    await yieldToProbe();
    const active = admission.tryLease({ missionId: 'memory', taskId: 'observe', attemptId: 'first', kind: 'host_io', timeoutMs: 4000 });
    assert.ok(active);
    observe({ windowsLowMemory: 1 }, 'memory');
    assert.equal(changes, 1);
    const held = admission.read(true);
    assert.equal(held.workerLimit, 0);
    assert.deepEqual(held.reasons, ['os-memory-pressure']);
    assert.equal(held.readings.availableMemoryBytes?.value, 1024 * mib);
    assert.equal(held.readings.windowsLowMemory?.value, 1);
    assert.equal(admission.telemetry().metrics.windowsLowMemory.availability, 'observed');
    assert.equal(admission.inspectPolicy().reason, 'os_memory_pressure');
    assert.equal(admission.canLease('remote'), true);
    assert.equal(admission.canLease('host_io'), false);
    assert.equal(active.checkpointRequested.aborted, true);
    assert.equal(active.active, true);
    active.release();
    finish({ windowsLowMemory: 1 });
    await yieldToProbe();
    assert.equal(changes, 1);
    time = 32_001;
    assert.equal(admission.read(true).readings.windowsLowMemory, undefined);
    assert.equal(admission.telemetry().metrics.windowsLowMemory.availability, 'stale');
    assert.equal(admission.canLease('host_io'), true);
    time += 2000;
    admission.read(true);
    await yieldToProbe();
    assert.equal(admission.read(true).readings.windowsLowMemory?.value, 0);
    assert.equal(admission.telemetry().metrics.windowsLowMemory.availability, 'observed');
  } finally { finish({ windowsLowMemory: 1 }); admission.dispose(); }
});

test('GPU and disk counters are usable before optional Windows probes finish without counting a duplicate pressure sample', async () => {
  let time = 0;
  type Counters = { gpuEnginePercent: number; diskQueueLength: number };
  let publish!: (value: Counters, phase: 'utilization') => void;
  let finish!: (value: Counters) => void;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 1024 * mib, readWindowsPressure: async (_signal, observe) => {
      publish = observe;
      return new Promise<Counters>(resolve => { finish = resolve; });
    } });
  const counters = { gpuEnginePercent: 99, diskQueueLength: 10 };
  try {
    admission.read(true);
    time = 2000;
    admission.read(true);
    await yieldToProbe();
    publish(counters, 'utilization');
    assert.equal(admission.read(true).readings.gpuEnginePercent?.value, 99);
    assert.equal(admission.read(true).readings.diskQueueLength?.value, 10);
    assert.deepEqual(admission.read(true).reasons, []);
    finish(counters);
    await yieldToProbe();
    assert.deepEqual(admission.read(true).reasons, []);
    for (time = 6000; time <= 22_000; time += 4000) admission.read(true);
    await yieldToProbe();
    publish(counters, 'utilization');
    assert.deepEqual(admission.read(true).reasons, ['gpu-load', 'disk-io']);
  } finally { finish(counters); admission.dispose(); }
});

test('Windows commit headroom caps RAM reservations and can hold local admission independently of physical RAM', async () => {
  let time = 0, commitMiB = 768;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 4096 * mib, readWindowsPressure: async () => ({ windowsLowMemory: 0,
      windowsCommitHeadroomBytes: commitMiB * mib }) });
  const request = { missionId: 'commit', taskId: 'work', attemptId: 'first', kind: 'cpu' as const, timeoutMs: 4000 };
  try {
    admission.read(true);
    time = 2000;
    admission.read(true);
    await yieldToProbe();
    assert.equal(admission.read(true).readings.windowsCommitHeadroomBytes?.value, 768 * mib);
    assert.equal(admission.telemetry().metrics.windowsCommitHeadroomBytes.availability, 'derived');
    assert.equal(admission.tryLease({ ...request, estimatedRamBytes: 257 * mib }), undefined);
    const lease = admission.tryLease({ ...request, estimatedRamBytes: 256 * mib });
    assert.ok(lease);
    lease.release();

    commitMiB = 480;
    for (time = 6000; time <= 22_000; time += 4000) admission.read(true);
    await yieldToProbe();
    const held = admission.read(true);
    assert.equal(held.readings.availableMemoryBytes?.value, 4096 * mib);
    assert.equal(held.readings.windowsLowMemory?.value, 0);
    assert.deepEqual(held.reasons, ['windows-commit-pressure']);
    assert.equal(held.workerLimit, 0);
    assert.equal(admission.inspectPolicy().reason, 'windows_commit_pressure');
    assert.equal(admission.canLease('remote'), true);
    assert.equal(admission.canLease('cpu'), false);
    time = 52_001;
    assert.equal(admission.read(true).readings.windowsCommitHeadroomBytes, undefined);
    assert.equal(admission.canLease('host_io'), true);
  } finally { admission.dispose(); }
});

test('a fresh driver thermal slowdown checkpoints GPU work and leaves the CPU and remote lanes available', async () => {
  let time = 0;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 2048 * mib, cpuCounters: () => ({ total: time * 4, idle: time * 3, logicalCpus: 4 }),
    readWindowsPressure: async () => ({}), readWindowsThermals: async () => ({ temperatureCelsius: 72.5, slowdown: 1 }),
    resourcePolicy: { mode: 'balanced', limits: { cpu: 3, build: 1, gpu: 1, host_io: 3, remote: 3 } } });
  try {
    admission.read(true);
    time = 4000;
    admission.read(true);
    assert.ok(admission.noteGpuBudget({ contextId: 'thermal-gpu', budgetBytes: 2048 * mib, usedBytes: 0 }));
    const active = admission.tryLease({ missionId: 'thermal', taskId: 'gpu', attemptId: 'attempt', kind: 'gpu',
      gpuContextId: 'thermal-gpu', estimatedVramBytes: 256 * mib, timeoutMs: 4000 });
    assert.ok(active);
    await yieldToProbe();
    const snapshot = admission.read(true);
    assert.deepEqual(snapshot.reasons, ['gpu-thermal-throttling']);
    assert.equal(snapshot.workerLimit, 3);
    assert.equal(admission.telemetry().metrics.nvidiaGpuTemperatureCelsius.value, 72.5);
    assert.equal(admission.inspectPolicy().reason, 'gpu_thermal_pressure');
    assert.equal(admission.canLease('cpu'), true);
    assert.equal(admission.canLease('remote'), true);
    assert.equal(admission.mayPrepareGpu(), false);
    assert.equal(active.checkpointRequested.aborted, true);
    assert.equal(active.active, true);
    active.release();
    time += 30_001;
    admission.read(true);
    assert.equal(admission.telemetry().metrics.nvidiaGpuThermalSlowdown.availability, 'stale');
    assert.equal(admission.mayPrepareGpu(), true);
  } finally { admission.dispose(); }
});

test('thermal parsing preserves unsupported values and requires all reported devices to be clear', () => {
  assert.deepEqual(parseNvidiaGpuThermals('59.06, Not Active, Not Active'), { temperatureCelsius: 59.06, slowdown: 0 });
  assert.deepEqual(parseNvidiaGpuThermals('59.06, Not Active, N/A\nN/A, N/A, N/A'), { temperatureCelsius: 59.06, slowdown: null });
  assert.deepEqual(parseNvidiaGpuThermals('59.06, Not Active, Not Active\n77, Active, N/A'), { temperatureCelsius: 77, slowdown: 1 });
  assert.throws(() => parseNvidiaGpuThermals('unexpected output'), /nvidia_thermal_output_invalid/u);
});

test('the supplemental thermal probe does not start on known battery power', async () => {
  let time = 0, calls = 0;
  const admission = createMissionAdmission({ maxWorkers: 3, now: () => time,
    availableMemory: () => 2048 * mib, readWindowsPressure: null, readWindowsThermals: async () => {
      calls++;
      return { temperatureCelsius: null, slowdown: null };
    } });
  try {
    admission.noteResourceSignal({ hostPower: { battery: true, suspended: false, idleSeconds: 10, speedLimitPercent: null } });
    admission.read(true);
    time = 2000;
    admission.read(true);
    await yieldToProbe();
    assert.equal(calls, 0);
    admission.noteResourceSignal({ hostPower: { battery: false, suspended: false, idleSeconds: 10, speedLimitPercent: null } });
    for (time = 6000; time <= 22_000; time += 4000) admission.read(true);
    await yieldToProbe();
    assert.equal(calls, 1);
    assert.equal(admission.telemetry().metrics.nvidiaGpuThermalSlowdown.availability, 'unsupported');
  } finally { admission.dispose(); }
});
