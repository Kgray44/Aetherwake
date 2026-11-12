import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { freemem, availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { setTimeout as wait } from 'node:timers/promises';
import { createMissionAdmission } from './mission-admission.mts';
import { createMissionCpuPool, missionCpuInspectionRamBytes } from './mission-cpu-pool.mts';
import { inspectBackendSource } from './mission-cpu-worker.mts';

const protocol = 'aerynth.arie-host-occupancy-worker@1';
type Interval = { startNs: string; endNs: string; threadId: number };
type TimedEvidence = Awaited<ReturnType<typeof inspectBackendSource>> & { interval: Omit<Interval, 'threadId'> };

/** Worker-side elapsed operation overlap, including file I/O. Not CPU core residency. */
export function occupancy(intervals: readonly Interval[]) {
  const latestEnd = new Map<number, bigint>();
  for (const interval of [...intervals].sort((a, b) => BigInt(a.startNs) < BigInt(b.startNs) ? -1 : 1)) {
    assert.ok(Number.isSafeInteger(interval.threadId) && interval.threadId > 0, 'invalid_worker_identity');
    const start = BigInt(interval.startNs), end = BigInt(interval.endNs);
    assert.ok(start >= 0n && end >= start, 'invalid_worker_interval');
    assert.ok(start >= (latestEnd.get(interval.threadId) ?? 0n), 'overlapping_same_worker_intervals');
    latestEnd.set(interval.threadId, end);
  }
  const events = intervals.flatMap(interval => {
    const start = BigInt(interval.startNs), end = BigInt(interval.endNs);
    assert.ok(end >= start, 'invalid_worker_interval');
    return start === end ? [] : [{ at: start, change: 1 }, { at: end, change: -1 }];
  }).sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.change - b.change);
  let active = 0, peak = 0, overlap = 0n, previous = events[0]?.at ?? 0n;
  for (const event of events) {
    if (active >= 2) overlap += event.at - previous;
    active += event.change;
    peak = Math.max(peak, active);
    previous = event.at;
  }
  return { peak, overlappingOperationMs: Number(overlap) / 1e6 };
}

if (parentPort && workerData === protocol) {
  const port = parentPort;
  port.on('message', async message => {
    if (message !== 'inspect-backend-source') return;
    const startNs = process.hrtime.bigint().toString();
    try {
      const evidence = await inspectBackendSource();
      port.postMessage({ ...evidence, interval: { startNs, endNs: process.hrtime.bigint().toString() } });
    } catch { port.postMessage(null); }
  });
}

/** Fixed public controller paths only; no process lists, host paths or settings changes. */
export async function readContainerLimits() {
  const constrained = process.constrainedMemory();
  const read = async (path: string) => {
    try { return { status: 'observed' as const, value: (await readFile(path, 'utf8')).trim() }; }
    catch (error) { return { status: 'unavailable' as const, reason: (error as NodeJS.ErrnoException).code ?? 'unknown' }; }
  };
  return { constrainedMemoryBytes: constrained > 0 ? constrained : null,
    constrainedMemorySource: 'process.constrainedMemory; zero means unknown or unconstrained',
    cpuQuotaV2: await read('/sys/fs/cgroup/cpu.max'),
    cpuQuotaV1: await read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    cpuPeriodV1: await read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    memoryLimitV2: await read('/sys/fs/cgroup/memory.max'),
    memoryLimitV1: await read('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    note: 'Root controller visibility does not establish nested effective limits. Unknown limits do not mean unlimited capacity.' };
}

export async function verifyHostOccupancy() {
  const available = () => Math.min(freemem(), process.availableMemory());
  assert.ok(available() >= 4 * 2 ** 30, 'host_start_requires_4GiB_available');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(Error('host_verification_deadline')), 15_000);
  let minimumAvailableBytes = available();
  const guard = () => {
    minimumAvailableBytes = Math.min(minimumAvailableBytes, available());
    if (minimumAvailableBytes < 3 * 2 ** 30) controller.abort(Error('host_stop_requires_3GiB_available'));
    controller.signal.throwIfAborted();
  };
  const monitor = setInterval(() => {
    try { guard(); } catch { /* Shared abort signal stops work at the next safe point. */ }
  }, 50);
  const governor = createMissionAdmission({ maxWorkers: 3, readWindowsPressure: null, readWindowsThermals: null });
  const pool = createMissionCpuPool(2, () => new Worker(new URL(import.meta.url), {
    workerData: protocol, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 32 },
  }));
  let sequence = 0, dispatched = 0, verified = 0;
  const lease = (kind: 'cpu' | 'remote', timeoutMs = 2_000) => governor.tryLease({
    missionId: 'host-occupancy', taskId: `task-${++sequence}`, attemptId: `attempt-${sequence}`,
    kind, timeoutMs, estimatedRamBytes: kind === 'cpu' ? missionCpuInspectionRamBytes : 0,
  });
  const round = (n: number) => Math.round(n * 1000) / 1000;
  try {
    const expected = await inspectBackendSource();
    const containerLimits = await readContainerLimits();
    governor.read(true);
    await wait(550, undefined, { signal: controller.signal });
    const admission = governor.read(true);
    const initialPolicy = governor.inspectPolicy();
    if (initialPolicy.effective.cpu < 2) return { status: 'unqualified' as const,
      reason: initialPolicy.reason, effectiveCpu: initialPolicy.effective.cpu,
      cpuPercent: admission.readings.cpuPercent?.value ?? null, containerLimits, minimumAvailableBytes, dispatched: 0 };
    const remote = lease('remote');
    assert.ok(remote);
    const rows = [];
    async function inspect() {
      guard(); governor.read(true);
      const acquired = lease('cpu');
      assert.ok(acquired, 'live_policy_denied_cpu_admission');
      assert.equal(acquired.receipt.reservedRamBytes, missionCpuInspectionRamBytes);
      dispatched++;
      try {
        const result = await pool.inspect(AbortSignal.any([controller.signal, acquired.checkpointRequested]));
        const { interval, ...evidence } = result.evidence as TimedEvidence;
        assert.deepEqual(evidence, expected);
        verified++;
        return { ...interval, threadId: result.threadId };
      } finally { acquired.release(); }
    }
    // Warm both bounded workers once; keep these observations separate from measured arms.
    await Promise.all([inspect(), inspect()]);
    for (const cap of [1, 2]) {
      const policy = governor.inspectPolicy();
      governor.configurePolicy(policy.configVersion, { mode: 'balanced', limits: { ...policy.limits, cpu: cap } });
      governor.read(true);
      const intervals: Interval[] = [];
      const started = performance.now();
      for (let count = 0; count < 8; count += cap) intervals.push(...await Promise.all(Array.from({ length: cap }, inspect)));
      rows.push({ cap, operations: intervals.length, elapsedMs: round(performance.now() - started),
        distinctWorkers: new Set(intervals.map(row => row.threadId)).size,
        ...occupancy(intervals), intervals });
      assert.equal(governor.inspectPolicy().active.cpu, 0);
    }
    // A deliberate mode change, not a claim of sampled CPU pressure or physical focus.
    const a = lease('cpu'), b = lease('cpu');
    assert.ok(a && b);
    const policy = governor.inspectPolicy();
    governor.configurePolicy(policy.configVersion, { mode: 'gaming_focus', limits: policy.limits });
    governor.read(true);
    assert.ok(a.checkpointRequested.aborted || b.checkpointRequested.aborted);
    assert.equal(governor.inspectPolicy().active.cpu, 2);
    assert.equal(governor.canLease('cpu'), false);
    assert.equal(governor.inspectPolicy().effective.remote, 3);
    assert.ok(remote.active);
    a.release(); b.release(); remote.release();
    const expiring = lease('cpu', 100);
    assert.ok(expiring);
    await wait(140, undefined, { signal: controller.signal });
    assert.equal(expiring.checkpointRequested.reason, 'lease-expired');
    assert.ok(expiring.active, 'expiry retains reservation until safe-point settlement');
    expiring.release();
    assert.equal(governor.inspectPolicy().reservedRamBytes, 0);
    const bytes = await readFile(new URL('./core.mts', import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.value.sha256);
    guard();
    return { contract: 'aerynth.arie-host-occupancy@1', status: rows[1].peak === 2 ? 'observed' : 'unqualified',
      platform: process.platform, node: process.version, availableParallelism: availableParallelism(), containerLimits,
      workload: 'instrumented shipped-source inspection; operation intervals include file I/O',
      cpuAtAdmissionPercent: admission.readings.cpuPercent?.value ?? null,
      minimumAvailableBytes, dispatched, verified, warmupOperations: 2, rows,
      sourceSha256: expected.value.sha256,
      checks: { remoteAdmissionPreserved: true, modeCheckpointRetainsReservations: true,
        expiryCheckpointRetainsReservation: true, exactReadback: true, finalReservedRamBytes: 0 },
      limitations: ['No MissionService dispatch or restart exercised', 'No causal speedup claim from one ordered pair',
        'No CPU core residency, multiprocess build, physical input, GPU or audio qualification',
        'Windows supplemental counters disabled; native OS CPU/RAM sampling remains active'] };
  } finally {
    clearTimeout(deadline); clearInterval(monitor);
    await pool.close(); governor.dispose();
  }
}

if (!parentPort && process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert.equal(process.env.AERYNTH_VERIFY_HOST_OCCUPANCY, '1', 'explicit host verification opt-in required');
  assert.equal(process.argv.length, 2, 'unsupported host verification arguments');
  console.log(JSON.stringify(await verifyHostOccupancy(), null, 2));
}
