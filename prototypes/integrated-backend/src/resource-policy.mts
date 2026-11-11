import { randomUUID } from 'node:crypto';
import type { MissionAdmission } from './mission-contracts.mts';

export type ResourceKind = 'cpu' | 'build' | 'gpu' | 'host_io' | 'remote';
export type ResourceMode = 'balanced' | 'gaming_focus' | 'max_throughput';
export type ResourcePolicyConfig = {
  mode: ResourceMode;
  limits: Readonly<Record<ResourceKind, number>>;
  monitorWindows?: boolean;
  protectExternalActivity?: boolean;
};
type PolicyPreference = { config: ResourcePolicyConfig; origin: 'default' | 'host' | 'user' };
type SavedPreferences = { schemaVersion: 1; current: PolicyPreference; previous: PolicyPreference | null; appliedAtUtc: string };
export interface ResourcePolicyPersistence {
  load(): { version: number; value: unknown } | null;
  save(expectedVersion: number | null, version: number, value: SavedPreferences): void;
}
export type ResourcePolicyNativeRequest = { name: 'inspect' } |
  { name: 'set-mode'; mode: ResourceMode; expectedVersion: number } |
  { name: 'set-cpu-limit'; limit: number; expectedVersion: number } |
  { name: 'set-gpu-limit'; limit: 0 | 1; expectedVersion: number } |
  { name: 'set-windows-monitoring'; enabled: boolean; expectedVersion: number } |
  { name: 'set-external-activity-protection'; enabled: boolean; expectedVersion: number } |
  { name: 'restore-defaults' | 'rollback'; expectedVersion: number };
export type ResourcePolicyNativeView = ReturnType<ReturnType<typeof createResourcePolicy>['inspect']> & {
  windowsCountersSupported: boolean;
  dedicatedVramEstimate: { bytes: number; ageMs: number } | null;
  externalDesktopActivity: { active: boolean; ageMs: number } | null;
  windowsLowMemory: { active: boolean; ageMs: number } | null;
  windowsCommitHeadroom: { bytes: number; ageMs: number } | null;
  nvidiaGpuThermals: { temperatureCelsius: number | null; slowdown: boolean | null; ageMs: number } | null;
};
export type ResourceAdjustment = {
  schemaVersion: 1;
  policyEpoch: string;
  baseRevision: number;
  evidenceRefs: readonly string[];
  expiresAtMs: number;
  changes: Readonly<Partial<Record<ResourceKind, number>>>;
};
export type ResourceLeaseRequest = {
  missionId: string;
  taskId: string;
  attemptId: string;
  kind: ResourceKind;
  timeoutMs: number;
  estimatedRamBytes?: number;
  gpuContextId?: string;
  estimatedVramBytes?: number;
};
/** Private host observation from the process that owns the GPU device. */
export type GpuProcessBudget = { contextId: string; budgetBytes: number; usedBytes: number };
const gpuBudgetFreshMs = 5000;
export type ResourceLease = {
  readonly active: boolean;
  readonly receipt: Readonly<{
    schemaVersion: 1;
    epoch: string;
    leaseId: string;
    policyRevision: number;
    configVersion: number;
    kind: ResourceKind;
    reservedRamBytes: number;
    gpuContextId?: string;
    reservedVramBytes?: number;
    gpuBudgetBytes?: number;
    expiresAt: string;
  }>;
  readonly checkpointRequested: AbortSignal;
  release(): void;
};

const kinds = ['cpu', 'build', 'gpu', 'host_io', 'remote'] as const;
const adjustmentFields = ['schemaVersion', 'policyEpoch', 'baseRevision', 'evidenceRefs', 'expiresAtMs', 'changes'];
const identifier = (value: string) => typeof value === 'string' && /^[\w.:-]{1,120}$/u.test(value);
const finiteCount = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;

/** Private admission bookkeeping for the Performance Governor. MissionService owns the queue and attempts. */
export function createResourcePolicy(maxWorkers: number, memoryFloor: number, now: () => number, wallNow: () => number,
  initial?: ResourcePolicyConfig, persistence?: ResourcePolicyPersistence) {
  if (!finiteCount(maxWorkers, 1024) || maxWorkers === 0) throw Error('invalid_resource_worker_ceiling');
  const epoch = randomUUID();
  const defaults: ResourcePolicyConfig = { mode: 'balanced',
    limits: { cpu: maxWorkers, build: 1, gpu: 0, host_io: maxWorkers, remote: maxWorkers } };
  function validate(config: ResourcePolicyConfig): ResourcePolicyConfig {
    if (!config || !config.limits || !['balanced', 'gaming_focus', 'max_throughput'].includes(config.mode) ||
        config.monitorWindows !== undefined && typeof config.monitorWindows !== 'boolean' ||
        config.protectExternalActivity !== undefined && typeof config.protectExternalActivity !== 'boolean' ||
        !kinds.every(kind => finiteCount(config.limits[kind], maxWorkers))) throw Error('invalid_resource_policy');
    return { mode: config.mode, monitorWindows: config.monitorWindows ?? true,
      protectExternalActivity: config.protectExternalActivity ?? false,
      limits: Object.fromEntries(kinds.map(kind => [kind, config.limits[kind]])) as ResourcePolicyConfig['limits'] };
  }
  function restorePreference(value: PolicyPreference): PolicyPreference {
    if (!value || !['default', 'host', 'user'].includes(value.origin)) throw Error('invalid_resource_policy');
    return { config: validate(value.config), origin: value.origin };
  }
  let preference: PolicyPreference = { config: validate(initial ?? defaults), origin: initial ? 'host' : 'default' };
  let previousPreference: PolicyPreference | null = null;
  const saved = persistence?.load() ?? null;
  let storedVersion = saved?.version ?? null, configurationHealth: 'valid' | 'fallback' = 'valid';
  let configVersion = storedVersion ?? 1;
  let appliedAtUtc: string | null = null;
  if (saved) {
    try {
      const value = saved.value as SavedPreferences;
      if (value?.schemaVersion !== 1 || typeof value.appliedAtUtc !== 'string' || !Number.isFinite(Date.parse(value.appliedAtUtc)))
        throw Error('invalid_resource_policy');
      const current = restorePreference(value.current);
      previousPreference = value.previous === null ? null : restorePreference(value.previous);
      preference = current;
      appliedAtUtc = value.appliedAtUtc;
    } catch {
      configurationHealth = 'fallback';
      preference = { config: { ...defaults, monitorWindows: false }, origin: 'default' };
      previousPreference = null;
    }
  }
  let latest: MissionAdmission | undefined;
  let effective = { cpu: 0, build: 0, gpu: 0, host_io: 0, remote: preference.config.limits.remote };
  let previous: typeof effective | null = null;
  let revision = 1, reason = 'awaiting_native_sample', freeForReservations = 0;
  let localFreshUntil = -Infinity, lastProtection = -Infinity;
  let disposed = false;
  let gpuPreparationAllowed = false;
  let gpuBudget: (GpuProcessBudget & { at: number }) | undefined;
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
  const freshGpuBudget = () => gpuBudget && now() - gpuBudget.at <= gpuBudgetFreshMs ? gpuBudget : undefined;
  let idleSeconds: number | null = null;
  function update(admission: MissionAdmission | undefined, memoryFreshUntil = localFreshUntil, nativeIdleSeconds = idleSeconds) {
    if (disposed) return;
    latest = admission;
    idleSeconds = nativeIdleSeconds;
    const { config } = preference;
    localFreshUntil = memoryFreshUntil;
    const readings = admission?.readings ?? {};
    const reasons: readonly MissionAdmission['reasons'][number][] = admission?.reasons ?? [];
    const free = readings.availableMemoryBytes?.value;
    const commit = readings.windowsCommitHeadroomBytes?.value;
    const suspended = reasons.includes('suspended');
    const osMemoryPressure = reasons.includes('os-memory-pressure');
    const commitPressure = commit !== undefined && commit < memoryFloor;
    const critical = suspended || osMemoryPressure || commitPressure || free === undefined || free < memoryFloor || reasons.includes('storage-reserve');
    freeForReservations = critical ? 0 : Math.min(free, commit ?? Infinity) - memoryFloor;
    const rendererPressure = reasons.includes('renderer-latency');
    const gpuPressure = reasons.includes('gpu-load');
    const gpuThermalPressure = reasons.includes('gpu-thermal-throttling');
    const externalActivity = config.protectExternalActivity && reasons.includes('external-desktop-activity');
    const protecting = config.mode === 'gaming_focus' || reasons.includes('active-input') || rendererPressure || externalActivity;
    const powerLimited = reasons.includes('battery-power') || reasons.includes('cpu-speed-limit');
    const contention = protecting || powerLimited || reasons.includes('cpu-load') || reasons.includes('disk-io');
    if (critical || contention) lastProtection = now();
    const recovering = now() - lastProtection < 3_000;
    const cpuLimited = protecting || powerLimited || reasons.includes('cpu-load') || !readings.cpuPercent || recovering;
    const idleHeadroom = config.mode === 'max_throughput' && !cpuLimited && idleSeconds !== null && idleSeconds >= 15 &&
      !gpuPressure && !reasons.includes('disk-io');
    const balancedCeiling = Math.max(1, maxWorkers - 1);
    const cpu = critical ? 0 : Math.min(config.limits.cpu, cpuLimited ? 1 : idleHeadroom ? maxWorkers : balancedCeiling);
    gpuPreparationAllowed = !critical && !contention && !recovering && !gpuPressure && !gpuThermalPressure && config.limits.gpu > 0;
    const next = {
      cpu,
      build: protecting || reasons.includes('disk-io') ? 0 : Math.min(cpu, config.limits.build),
      gpu: gpuPreparationAllowed && freshGpuBudget() ?
        Math.min(1, config.limits.gpu) : 0,
      host_io: critical ? 0 : config.limits.host_io,
      remote: config.limits.remote,
    };
    const nextReason = suspended ? 'system_suspended' : osMemoryPressure ? 'os_memory_pressure' :
      commitPressure ? 'windows_commit_pressure' :
      critical ? (free === undefined ? 'memory_unavailable' : 'safety_floor') :
      rendererPressure ? 'renderer_latency' : externalActivity ? 'external_desktop_activity' : protecting ? 'foreground_protection' :
        powerLimited ? 'power_protection' : recovering && !contention ? 'recovery_dwell' : cpuLimited ? 'cpu_conservative' :
      reasons.includes('disk-io') ? 'disk_contention' : gpuThermalPressure ? 'gpu_thermal_pressure' : gpuPressure ? 'gpu_contention' :
        idleHeadroom ? 'throughput_profile' : 'balanced';
    if (nextReason !== reason || kinds.some(kind => next[kind] !== effective[kind])) {
      previous = effective;
      effective = next;
      reason = nextReason;
      revision++;
    }
    // Keep reservations until execution actually exits. A signal requests a safe point.
    for (const kind of ['build', 'cpu', 'gpu', 'host_io'] as const) {
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
      (kind !== 'gpu' || !!freshGpuBudget()) &&
      (kind !== 'build' || used('cpu') < effective.cpu) &&
      (kind === 'remote' || now() <= localFreshUntil && bytes <= Math.max(0, freeForReservations - reservedRam()));
  }
  function commit(expectedVersion: number, current: PolicyPreference, prior: PolicyPreference | null) {
    if (disposed || expectedVersion !== configVersion) throw Error('stale_resource_policy');
    const nextVersion = configVersion + 1;
    if (!Number.isSafeInteger(nextVersion)) throw Error('invalid_resource_policy');
    const savedAt = new Date(wallNow()).toISOString();
    persistence?.save(storedVersion, nextVersion, { schemaVersion: 1, current, previous: prior, appliedAtUtc: savedAt });
    if (persistence) storedVersion = nextVersion;
    preference = current;
    previousPreference = prior;
    configVersion = nextVersion;
    appliedAtUtc = savedAt;
    configurationHealth = 'valid';
    const previousRevision = revision;
    update(latest);
    if (revision === previousRevision) revision++;
  }
  return {
    update,
    canLease,
    mayPrepareGpu: () => !disposed && gpuPreparationAllowed && now() <= localFreshUntil && used('gpu') === 0,
    noteGpuBudget(budget: GpuProcessBudget | null) {
      if (disposed || budget && (!identifier(budget.contextId) || !finiteCount(budget.budgetBytes, Number.MAX_SAFE_INTEGER) ||
          !finiteCount(budget.usedBytes, budget.budgetBytes) || budget.budgetBytes === budget.usedBytes ||
          used('gpu') > 0 && gpuBudget?.contextId !== budget.contextId)) return false;
      gpuBudget = budget ? { ...budget, at: now() } : undefined;
      update(latest);
      return true;
    },
    windowsMonitoring: () => preference.config.monitorWindows ?? true,
    externalActivityProtection: () => preference.config.protectExternalActivity ?? false,
    inspect() {
      const { config, origin } = preference;
      return { schemaVersion: 1 as const, epoch, revision, configVersion, mode: config.mode,
        limits: { ...config.limits }, effective: { ...effective }, previous: previous && { ...previous }, reason,
        active: Object.fromEntries(kinds.map(kind => [kind, used(kind)])), reservedRamBytes: reservedRam(),
        origin, configurationHealth, maxCpuWorkers: maxWorkers, canRollback: !!previousPreference,
        windowsMonitoring: config.monitorWindows ?? true, externalActivityProtection: config.protectExternalActivity ?? false, appliedAtUtc,
        previousMode: previousPreference?.config.mode ?? null };
    },
    /** AEP owns the cited evidence. A preview performs structural and budget checks only. */
    previewAdjustment(proposal: ResourceAdjustment) {
      if (!proposal || typeof proposal !== 'object' || Object.keys(proposal).some(key => !adjustmentFields.includes(key)))
        return { status: 'invalid_proposal' as const };
      if (proposal.schemaVersion !== 1 || !Number.isSafeInteger(proposal.expiresAtMs) || proposal.expiresAtMs <= wallNow() ||
          !identifier(proposal.policyEpoch) || !finiteCount(proposal.baseRevision, Number.MAX_SAFE_INTEGER) ||
          !Array.isArray(proposal.evidenceRefs) || proposal.evidenceRefs.length === 0 || proposal.evidenceRefs.length > 16 ||
          !Array.from(proposal.evidenceRefs).every(identifier) ||
          !proposal.changes || typeof proposal.changes !== 'object' || Array.isArray(proposal.changes))
        return { status: 'invalid_proposal' as const };
      if (disposed || proposal.policyEpoch !== epoch || proposal.baseRevision !== revision)
        return { status: 'stale_policy' as const };
      const changes = Object.entries(proposal.changes);
      if (!changes.length || !changes.every(([kind, delta]) => kinds.includes(kind as ResourceKind) &&
          Number.isSafeInteger(delta) && Math.abs(delta) <= maxWorkers)) return { status: 'invalid_proposal' as const };
      if (changes.some(([, delta]) => delta > 0)) return { status: 'increase_requires_review' as const };
      const prediction = { ...effective };
      for (const [name, delta] of changes) {
        const kind = name as ResourceKind;
        prediction[kind] = Math.max(0, effective[kind] + delta);
      }
      prediction.build = Math.min(prediction.cpu, prediction.build);
      return { status: 'preview' as const, policyEpoch: epoch, baseRevision: revision, current: { ...effective },
        prediction, evidenceRefs: [...proposal.evidenceRefs] };
    },
    configure(expectedVersion: number, next: ResourcePolicyConfig) {
      commit(expectedVersion, { config: validate(next), origin: 'user' }, preference);
    },
    restoreDefaults(expectedVersion: number) {
      commit(expectedVersion, { config: defaults, origin: 'default' }, preference);
    },
    rollback(expectedVersion: number) {
      if (disposed || expectedVersion !== configVersion || !previousPreference) throw Error('resource_policy_rollback_unavailable');
      commit(expectedVersion, previousPreference, null);
    },
    tryLease(request: ResourceLeaseRequest): ResourceLease | undefined {
      const { kind, attemptId, missionId, taskId, timeoutMs, estimatedRamBytes = 0, gpuContextId, estimatedVramBytes } = request;
      if (!identifier(attemptId) || !identifier(missionId) || !identifier(taskId) || !kinds.includes(kind) ||
          !finiteCount(estimatedRamBytes, Number.MAX_SAFE_INTEGER) || kind === 'remote' && estimatedRamBytes !== 0 ||
          !finiteCount(timeoutMs, 0x7fffffff) || timeoutMs === 0 || active.has(attemptId) ||
          !canLease(kind, estimatedRamBytes)) return;
      const budget = kind === 'gpu' ? freshGpuBudget() : undefined;
      if (kind === 'gpu' ? !budget || gpuContextId !== budget.contextId || typeof estimatedVramBytes !== 'number' ||
          estimatedVramBytes === 0 || !finiteCount(estimatedVramBytes, budget.budgetBytes - budget.usedBytes) :
          gpuContextId !== undefined || estimatedVramBytes !== undefined) return;
      const checkpoint = new AbortController();
      const timer = setTimeout(() => checkpoint.abort('lease-expired'), timeoutMs).unref();
      const lease: ResourceLease = {
        get active() { return active.get(attemptId)?.lease === lease; },
        receipt: Object.freeze({ schemaVersion: 1, epoch, leaseId: randomUUID(), policyRevision: revision, kind,
          configVersion, reservedRamBytes: estimatedRamBytes, expiresAt: new Date(wallNow() + timeoutMs).toISOString(),
          ...(budget ? { gpuContextId: budget.contextId, reservedVramBytes: estimatedVramBytes, gpuBudgetBytes: budget.budgetBytes } : {}) }),
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
