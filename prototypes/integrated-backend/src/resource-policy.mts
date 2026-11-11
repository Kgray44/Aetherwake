import { randomUUID } from 'node:crypto';
import type { MissionAdmission } from './mission-contracts.mts';

export type ResourceKind = 'cpu' | 'build' | 'gpu' | 'remote';
export type ResourceMode = 'balanced' | 'gaming_focus' | 'max_throughput';
export type ResourcePolicyConfig = {
  mode: ResourceMode;
  limits: Readonly<Record<ResourceKind, number>>;
};
export type ResourceLeaseRequest = {
  missionId: string;
  taskId: string;
  attemptId: string;
  kind: ResourceKind;
  timeoutMs: number;
  estimatedRamBytes?: number;
};
export type ResourceLease = {
  readonly receipt: Readonly<{
    schemaVersion: 1;
    epoch: string;
    leaseId: string;
    policyRevision: number;
    kind: ResourceKind;
    reservedRamBytes: number;
    expiresAt: string;
  }>;
  readonly checkpointRequested: AbortSignal;
  release(): void;
};

const kinds = ['cpu', 'build', 'gpu', 'remote'] as const;
const identifier = (value: string) => typeof value === 'string' && /^[\w.:-]{1,120}$/u.test(value);
const finiteCount = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;

/** Private admission bookkeeping for the Performance Governor. MissionService owns the queue and attempts. */
export function createResourcePolicy(maxWorkers: number, memoryFloor: number, now: () => number, wallNow: () => number,
  initial?: ResourcePolicyConfig) {
  if (!finiteCount(maxWorkers, 1024) || maxWorkers === 0) throw Error('invalid_resource_worker_ceiling');
  const epoch = randomUUID();
  const defaults: ResourcePolicyConfig = { mode: 'balanced',
    limits: { cpu: maxWorkers, build: 1, gpu: 0, remote: maxWorkers } };
  function validate(config: ResourcePolicyConfig): ResourcePolicyConfig {
    if (!['balanced', 'gaming_focus', 'max_throughput'].includes(config.mode) ||
        !kinds.every(kind => finiteCount(config.limits[kind], maxWorkers))) throw Error('invalid_resource_policy');
    return { mode: config.mode, limits: { ...config.limits } };
  }
  let config = validate(initial ?? defaults), previousConfig: ResourcePolicyConfig | undefined;
  let latest: MissionAdmission | undefined;
  let effective = { cpu: 0, build: 0, gpu: 0, remote: config.limits.remote };
  let previous: typeof effective | null = null;
  let revision = 1, configVersion = 1, reason = 'awaiting_native_sample', freeForReservations = 0;
  let localFreshUntil = -Infinity, lastProtection = -Infinity;
  let disposed = false;
  const active = new Map<string, {
    request: ResourceLeaseRequest; lease: ResourceLease; checkpoint: AbortController;
  }>();

  function used(kind: ResourceKind) {
    let total = 0;
    for (const { request } of active.values()) if (request.kind === kind || kind === 'cpu' && request.kind === 'build') total++;
    return total;
  }
  function reservedRam() {
    let bytes = 0;
    for (const { lease } of active.values()) bytes += lease.receipt.reservedRamBytes;
    return bytes;
  }
  function update(admission: MissionAdmission | undefined, memoryFreshUntil = localFreshUntil) {
    if (disposed) return;
    latest = admission;
    localFreshUntil = memoryFreshUntil;
    const readings = admission?.readings ?? {};
    const reasons: readonly MissionAdmission['reasons'][number][] = admission?.reasons ?? [];
    const free = readings.availableMemoryBytes?.value;
    const critical = free === undefined || free < memoryFloor || reasons.includes('storage-reserve');
    freeForReservations = critical ? 0 : free - memoryFloor;
    const protecting = config.mode === 'gaming_focus' || reasons.includes('active-input');
    const contention = protecting || reasons.includes('cpu-load') || reasons.includes('disk-io');
    if (critical || contention) lastProtection = now();
    const recovering = now() - lastProtection < 3_000;
    const cpuLimited = protecting || reasons.includes('cpu-load') || !readings.cpuPercent || recovering;
    const idleHeadroom = config.mode === 'max_throughput' && !cpuLimited &&
      !reasons.includes('gpu-load') && !reasons.includes('disk-io');
    const balancedCeiling = Math.max(1, maxWorkers - 1);
    const cpu = critical ? 0 : Math.min(config.limits.cpu, cpuLimited ? 1 : idleHeadroom ? maxWorkers : balancedCeiling);
    const next = {
      cpu,
      build: protecting || reasons.includes('disk-io') ? 0 : Math.min(cpu, config.limits.build),
      // This slice has no qualified VRAM headroom measurement.
      gpu: 0,
      remote: config.limits.remote,
    };
    const nextReason = critical ? (free === undefined ? 'memory_unavailable' : 'safety_floor') :
      protecting ? 'foreground_protection' : recovering && !contention ? 'recovery_dwell' : cpuLimited ? 'cpu_conservative' :
        reasons.includes('disk-io') ? 'disk_contention' : idleHeadroom ? 'throughput_profile' : 'balanced';
    if (nextReason !== reason || kinds.some(kind => next[kind] !== effective[kind])) {
      previous = effective;
      effective = next;
      reason = nextReason;
      revision++;
    }
    // Keep reservations until execution actually exits. A signal requests a safe point.
    for (const kind of ['build', 'cpu', 'gpu'] as const) {
      let excess = used(kind) - effective[kind];
      for (const { request, checkpoint } of [...active.values()].reverse()) {
        if (excess <= 0) break;
        if (request.kind !== kind && !(kind === 'cpu' && request.kind === 'build')) continue;
        if (!checkpoint.signal.aborted) checkpoint.abort('resource-pressure');
        excess--;
      }
    }
  }
  function canLease(kind: ResourceKind, bytes = 0) {
    return !disposed && used(kind) < effective[kind] &&
      (kind !== 'build' || used('cpu') < effective.cpu) &&
      (kind === 'remote' || now() <= localFreshUntil && bytes <= Math.max(0, freeForReservations - reservedRam()));
  }
  return {
    update,
    canLease,
    inspect() {
      return { schemaVersion: 1 as const, epoch, revision, configVersion, mode: config.mode,
        limits: { ...config.limits }, effective: { ...effective }, previous: previous && { ...previous }, reason,
        active: Object.fromEntries(kinds.map(kind => [kind, used(kind)])), reservedRamBytes: reservedRam(),
        canRollback: !!previousConfig };
    },
    configure(expectedVersion: number, next: ResourcePolicyConfig) {
      if (disposed || expectedVersion !== configVersion) throw Error('stale_resource_policy');
      const validated = validate(next);
      previousConfig = config;
      config = validated;
      configVersion++;
      update(latest);
    },
    rollback(expectedVersion: number) {
      if (disposed || expectedVersion !== configVersion || !previousConfig) throw Error('resource_policy_rollback_unavailable');
      config = previousConfig;
      previousConfig = undefined;
      configVersion++;
      update(latest);
    },
    tryLease(request: ResourceLeaseRequest): ResourceLease | undefined {
      const { kind, attemptId, missionId, taskId, timeoutMs, estimatedRamBytes = 0 } = request;
      if (!identifier(attemptId) || !identifier(missionId) || !identifier(taskId) || !kinds.includes(kind) ||
          !finiteCount(estimatedRamBytes, Number.MAX_SAFE_INTEGER) || kind === 'remote' && estimatedRamBytes !== 0 ||
          !finiteCount(timeoutMs, 0x7fffffff) || timeoutMs === 0 || active.has(attemptId) ||
          !canLease(kind, estimatedRamBytes)) return;
      const checkpoint = new AbortController();
      const timer = setTimeout(() => checkpoint.abort('lease-expired'), timeoutMs).unref();
      const lease: ResourceLease = {
        receipt: Object.freeze({ schemaVersion: 1, epoch, leaseId: randomUUID(), policyRevision: revision, kind,
          reservedRamBytes: estimatedRamBytes, expiresAt: new Date(wallNow() + timeoutMs).toISOString() }),
        checkpointRequested: checkpoint.signal,
        release() {
          if (active.get(attemptId)?.lease !== lease) return;
          clearTimeout(timer);
          active.delete(attemptId);
        },
      };
      active.set(attemptId, { request: { ...request }, lease, checkpoint });
      return lease;
    },
    dispose() {
      disposed = true;
      for (const { lease, checkpoint } of active.values()) {
        checkpoint.abort('governor-closed');
        lease.release();
      }
    },
  };
}
