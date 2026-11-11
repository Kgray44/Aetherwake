import { execFile } from 'node:child_process';
import { freemem, platform, totalmem } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { aggregateGpuEngines, readCpuCounters } from '../../vela-core/src/system-utilization.mts';
import type { MissionAdmission, MissionAdmissionReading } from './mission-contracts.mts';
import { createResourcePolicy, type ResourcePolicyConfig, type ResourcePolicyPersistence } from './resource-policy.mts';

const memoryFloorBytes = 512 * 1024 * 1024;
const cpuIntervalMs = 500;
const demandGapMs = 5_000;
const windowsWarmupMs = 2_000;
const windowsIntervalMs = 20_000;
const windowsFreshMs = 30_000;
const inputFreshMs = 3_000;

type CpuCounters = Omit<ReturnType<typeof readCpuCounters>, 'logicalProcessors'> &
  Partial<Pick<ReturnType<typeof readCpuCounters>, 'logicalProcessors'>>;
const windowsMetrics = {
  gpuEnginePercent: ['percent', 'Windows GPU Engine counters (busiest engine)'],
  diskQueueLength: ['requests', 'Windows PhysicalDisk counters (busiest device)'],
  diskBytesPerSecond: ['bytes/s', 'Windows PhysicalDisk counters (_Total)'],
  networkBytesPerSecond: ['bytes/s', 'Windows Network Interface counters (busiest interface)'],
  physicalCores: ['cores', 'Win32_Processor.NumberOfCores (sum across packages)'],
  pagesPerSecond: ['pages/s', 'Windows Memory.PagesPersec'],
} as const;
type WindowsPressure = Partial<Record<keyof typeof windowsMetrics, number>>;
type TimedReading = { reading: MissionAdmissionReading; time: number };
type MetricValue = number | readonly number[];
type MetricSample = { value: MetricValue; observedAt: string; time: number; windowMs: number | null };
type Availability = 'observed' | 'derived' | 'unsupported' | 'disabled' | 'stale' | 'error' | 'not_sampled';
type Pressure = { sample?: TimedReading; highSamples: number; pressured: boolean };
type AdmissionOptions = {
  maxWorkers: number;
  onChange?(): void;
  now?(): number;
  wallNow?(): number;
  availableMemory?(): number;
  cpuCounters?(): CpuCounters;
  readWindowsPressure?: ((signal: AbortSignal) => Promise<WindowsPressure>) | null;
  resourcePolicy?: ResourcePolicyConfig;
  resourcePolicyPersistence?: ResourcePolicyPersistence;
};

const numeric = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

const exec = promisify(execFile);
const countersScript = `
$ErrorActionPreference = 'Stop'
$gpu = $null
$disk = $null
$diskRate = $null
$network = $null
$cores = $null
$pages = $null
try {
  $gpu = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object -First 8193 -Property Name,UtilizationPercentage)
} catch {}
try {
  $disks = @(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Select-Object -First 130 -Property Name,AvgDiskQueueLength,DiskBytesPersec)
  if ($disks.Count -lt 130) {
    $disk = @($disks | Where-Object Name -ne '_Total' | Select-Object -ExpandProperty AvgDiskQueueLength)
    $diskRate = $disks | Where-Object Name -eq '_Total' | Select-Object -First 1 -ExpandProperty DiskBytesPersec
  }
} catch {}
ConvertTo-Json -InputObject @{gpu=$gpu; disk=$disk; diskBytesPerSecond=$diskRate} -Compress
try {
  $interfaces = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Tcpip_NetworkInterface | Select-Object -First 129 -ExpandProperty BytesTotalPersec)
  if ($interfaces.Count -gt 0 -and $interfaces.Count -le 128) { $network = ($interfaces | Measure-Object -Maximum).Maximum }
} catch {}
try {
  $packages = @(Get-CimInstance -ClassName Win32_Processor | Select-Object -First 65 -ExpandProperty NumberOfCores)
  if ($packages.Count -gt 0 -and $packages.Count -le 64 -and -not ($packages -contains 0) -and -not ($packages -contains $null)) {
    $cores = ($packages | Measure-Object -Sum).Sum
  }
} catch {}
try {
  $pages = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory | Select-Object -First 1 -ExpandProperty PagesPersec
} catch {}
ConvertTo-Json -InputObject @{networkBytesPerSecond=$network; physicalCores=$cores; pagesPerSecond=$pages} -Compress
`;

async function sampleWindowsPressure(signal: AbortSignal): Promise<WindowsPressure> {
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) return {};
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', countersScript],
    { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8', signal })
    .catch((error: { killed?: boolean; stdout?: string }) => {
      if (!signal.aborted && error.killed && typeof error.stdout === 'string') return { stdout: error.stdout };
      throw error;
    });
  // Keep complete primary observations even if optional counters time out.
  const parts = stdout.split(/\r?\n/u).slice(0, 2).map(line => {
    try { return JSON.parse(line) as { gpu?: unknown; disk?: unknown } & WindowsPressure; }
    catch { return {}; }
  });
  const { gpu, disk, ...counters } = { ...parts[0], ...parts[1] };
  let gpuEnginePercent: number | undefined;
  try { gpuEnginePercent = aggregateGpuEngines(gpu).percent; } catch { /* The disk reading can still be valid. */ }
  const diskQueueLength = Array.isArray(disk) && disk.length > 0 && disk.length <= 128 &&
    disk.every(value => numeric(value, Number.MAX_SAFE_INTEGER)) ? Math.max(...disk) : undefined;
  return { gpuEnginePercent, diskQueueLength, ...counters };
}

function cpuPercentBetween(before: { total: number; idle: number }, after: { total: number; idle: number }) {
  const total = after.total - before.total, idle = after.idle - before.idle;
  return total > 0 && Number.isFinite(total) && numeric(idle, total) ?
    Math.round(10_000 * (total - idle) / total) / 100 : undefined;
}

const fresh = (sample: TimedReading | undefined, now: number, maxAge: number) =>
  sample && now - sample.time <= maxAge ? sample : undefined;

function observePressure(previous: Pressure, sample: TimedReading | undefined, high: number, low: number): Pressure {
  if (!sample) return { highSamples: 0, pressured: false };
  const { value } = sample.reading;
  const highSamples = value >= high ? Math.min(2, previous.highSamples + 1) : 0;
  return { sample, highSamples, pressured: value > low && (previous.pressured || highSamples === 2) };
}

/** Scheduler demand drives sampling. Passive snapshots only return fresh readings. */
export function createMissionAdmission(options: AdmissionOptions) {
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;
  const policy = createResourcePolicy(options.maxWorkers, memoryFloorBytes, now, wallNow,
    options.resourcePolicy, options.resourcePolicyPersistence);
  const availableMemory = options.availableMemory ?? freemem;
  const readCpu = options.cpuCounters ?? readCpuCounters;
  const readWindows = options.readWindowsPressure === null ? undefined :
    options.readWindowsPressure ?? (platform() === 'win32' ? sampleWindowsPressure : undefined);
  let memory: TimedReading | undefined;
  let cpu: Pressure = { highSamples: 0, pressured: false };
  let gpu: Pressure = { highSamples: 0, pressured: false };
  let disk: Pressure = { highSamples: 0, pressured: false };
  let cpuBaseline: { counters: CpuCounters; time: number } | undefined;
  let demandSince = 0;
  let lastDemand = -Infinity;
  let lastInput = -Infinity;
  let lastProbe = -Infinity;
  let probe: AbortController | undefined;
  let disposed = false;
  const samples = new Map<string, MetricSample>();
  const errors = new Set<string>();
  let processBaseline: { usage: NodeJS.CpuUsage; time: number } | undefined;

  function capture(name: string, value: MetricValue | undefined, time: number, windowMs: number | null = 0,
    observedAt = new Date(wallNow()).toISOString()) {
    if (value === undefined) { errors.add(name); return; }
    samples.set(name, { value, time, windowMs, observedAt });
    errors.delete(name);
  }

  function reading(value: number, time: number): TimedReading {
    return { reading: { value, observedAt: new Date(wallNow()).toISOString() }, time };
  }

  function refreshCpu(time: number) {
    const before = cpuBaseline;
    if (before && time - before.time < cpuIntervalMs) return;
    try {
      const after = readCpu();
      cpuBaseline = { counters: after, time };
      capture('logicalProcessors', after.logicalCpus > 0 ? after.logicalCpus : undefined, time);
      const usage = process.cpuUsage(), previousProcess = processBaseline;
      processBaseline = { usage, time };
      if (previousProcess && time - previousProcess.time <= demandGapMs) {
        const elapsed = time - previousProcess.time;
        const percent = (usage.user - previousProcess.usage.user + usage.system - previousProcess.usage.system) / (elapsed * 10);
        capture('hostProcessCpuPercent', numeric(percent, Number.MAX_SAFE_INTEGER) ? percent : undefined, time, elapsed);
      }
      if (!before || time - before.time > demandGapMs) return;
      const valid = after.logicalCpus > 0 && after.logicalCpus === before.counters.logicalCpus;
      const percent = valid ? cpuPercentBetween(before.counters, after) : undefined;
      const elapsed = time - before.time;
      capture('cpuPercent', percent, time, elapsed);
      const previousCores = before.counters.logicalProcessors;
      if (valid && previousCores?.length === after.logicalProcessors?.length && previousCores) {
        const loads = after.logicalProcessors?.map((ticks, i) => cpuPercentBetween(previousCores[i]!, ticks));
        capture('logicalProcessorCpuPercent', loads?.every(value => value !== undefined) ? loads : undefined, time, elapsed);
      }
      const utilization = percent === undefined ? undefined : reading(percent, time);
      cpu = observePressure(cpu, utilization, 90, 82);
    } catch {
      cpuBaseline = undefined;
      cpu = observePressure(cpu, undefined, 90, 82);
      for (const name of ['cpuPercent', 'logicalProcessors', 'logicalProcessorCpuPercent']) capture(name, undefined, time);
    }
  }

  function applyWindowsPressure(result: WindowsPressure, startedAt: number, startedAtUtc: string) {
    if (disposed) return;
    const time = now(), recentDemand = time - lastDemand <= demandGapMs;
    const previousGpu = fresh(gpu.sample, time, windowsFreshMs);
    const previousDisk = fresh(disk.sample, time, windowsFreshMs);
    const windowsReading = (value: number) => ({ reading: { value, observedAt: startedAtUtc }, time: startedAt });
    const gpuReading = numeric(result.gpuEnginePercent, 100) ? windowsReading(result.gpuEnginePercent) : undefined;
    const diskReading = numeric(result.diskQueueLength, Number.MAX_SAFE_INTEGER) ? windowsReading(result.diskQueueLength) : undefined;
    for (const name of Object.keys(windowsMetrics) as (keyof typeof windowsMetrics)[]) {
      const value = result[name];
      capture(name, numeric(value, name === 'gpuEnginePercent' ? 100 : Number.MAX_SAFE_INTEGER) ? value : undefined,
        startedAt, null, startedAtUtc);
    }
    gpu = observePressure(previousGpu ? gpu : { highSamples: 0, pressured: false }, gpuReading, 95, 85);
    disk = observePressure(previousDisk ? disk : { highSamples: 0, pressured: false }, diskReading, 8, 4);
    if (recentDemand && (gpuReading || diskReading || previousGpu || previousDisk)) options.onChange?.();
  }

  function refreshWindows(time: number) {
    if (!policy.windowsMonitoring() || !readWindows || probe ||
        time - demandSince < windowsWarmupMs || time - lastProbe < windowsIntervalMs) return;
    const controller = new AbortController();
    const startedAtUtc = new Date(wallNow()).toISOString();
    probe = controller;
    lastProbe = time;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return readWindows(controller.signal);
    }).catch((): WindowsPressure => ({})).then(result => {
      if (!controller.signal.aborted) applyWindowsPressure(result, time, startedAtUtc);
    }).catch(() => {
      // Optional telemetry and a failed observer cannot stall scheduler admission.
    }).finally(() => { probe = undefined; });
  }

  function reconcileWindowsMonitoring() {
    if (policy.windowsMonitoring()) return;
    probe?.abort();
    gpu = { highSamples: 0, pressured: false };
    disk = { highSamples: 0, pressured: false };
    for (const name of Object.keys(windowsMetrics)) {
      samples.delete(name);
      errors.delete(name);
    }
  }

  return {
    read(demand: boolean): MissionAdmission {
      if (disposed) return { workerLimit: options.maxWorkers, reasons: [], readings: {} };
      const time = now();
      if (demand) {
        if (time - lastDemand > demandGapMs) {
          demandSince = time;
          cpuBaseline = undefined;
          cpu = observePressure(cpu, undefined, 90, 82);
        }
        lastDemand = time;
        try {
          const bytes = availableMemory();
          memory = numeric(bytes, Number.MAX_SAFE_INTEGER) ? reading(bytes, time) : undefined;
        } catch { memory = undefined; }
        capture('availableMemoryBytes', memory?.reading.value, time);
        capture('totalMemoryBytes', totalmem() || undefined, time);
        refreshCpu(time);
        if (memory && memory.reading.value >= memoryFloorBytes) refreshWindows(time);
      }
      const cpuPercent = fresh(cpu.sample, time, demandGapMs)?.reading;
      const availableMemoryBytes = fresh(memory, time, demandGapMs)?.reading;
      const gpuEnginePercent = fresh(gpu.sample, time, windowsFreshMs)?.reading;
      const diskQueueLength = fresh(disk.sample, time, windowsFreshMs)?.reading;
      const reasons: MissionAdmission['reasons'] = [];
      if (availableMemoryBytes && availableMemoryBytes.value < memoryFloorBytes) reasons.push('physical-memory');
      if (cpuPercent && cpu.pressured) reasons.push('cpu-load');
      if (gpuEnginePercent && gpu.pressured) reasons.push('gpu-load');
      if (diskQueueLength && disk.pressured) reasons.push('disk-io');
      if (time - lastInput <= inputFreshMs && ((cpuPercent?.value ?? -1) >= 80 || (gpuEnginePercent?.value ?? -1) >= 85))
        reasons.push('active-input');
      const workerLimit = reasons.includes('physical-memory') ? 0 : reasons.length ? Math.min(1, options.maxWorkers) : options.maxWorkers;
      const snapshot = { workerLimit, reasons, readings: {
        ...(cpuPercent ? { cpuPercent: { ...cpuPercent } } : {}),
        ...(availableMemoryBytes ? { availableMemoryBytes: { ...availableMemoryBytes } } : {}),
        ...(gpuEnginePercent ? { gpuEnginePercent: { ...gpuEnginePercent } } : {}),
        ...(diskQueueLength ? { diskQueueLength: { ...diskQueueLength } } : {}),
      } };
      policy.update(snapshot, memory ? memory.time + demandGapMs : -Infinity);
      return snapshot;
    },
    inspectPolicy() { return { ...policy.inspect(), windowsCountersSupported: !!readWindows }; },
    configurePolicy(expectedVersion: number, config: ResourcePolicyConfig) {
      policy.configure(expectedVersion, config);
      reconcileWindowsMonitoring();
    },
    restorePolicyDefaults(expectedVersion: number) {
      policy.restoreDefaults(expectedVersion);
      reconcileWindowsMonitoring();
    },
    rollbackPolicy(expectedVersion: number) {
      policy.rollback(expectedVersion);
      reconcileWindowsMonitoring();
    },
    previewAdjustment: policy.previewAdjustment,
    canLease: policy.canLease,
    tryLease: policy.tryLease,
    telemetry() {
      const time = now();
      function metric(name: string, unit: string, source: string, maxAge: number, derived = false, supported = true, enabled = true) {
        const sample = samples.get(name);
        const ageMs = sample ? Math.max(0, time - sample.time) : null;
        const availability: Availability = !supported ? 'unsupported' : !enabled ? 'disabled' : errors.has(name) ? 'error' :
          ageMs === null ? 'not_sampled' : ageMs > maxAge ? 'stale' : derived ? 'derived' : 'observed';
        return { availability, unit, source, ageMs, observedAt: sample?.observedAt ?? null,
          windowMs: sample?.windowMs ?? null,
          value: availability === 'observed' || availability === 'derived' ? structuredClone(sample!.value) : null };
      }
      const windows = Object.fromEntries((Object.keys(windowsMetrics) as (keyof typeof windowsMetrics)[]).map(name => {
        const [unit, source] = windowsMetrics[name];
        return [name, metric(name, unit, source, windowsFreshMs, true, !!readWindows, policy.windowsMonitoring())];
      })) as Record<keyof typeof windowsMetrics, ReturnType<typeof metric>>;
      return { schemaVersion: 1 as const, scope: 'local-host' as const, metrics: {
        ...windows,
        logicalProcessors: metric('logicalProcessors', 'logical processors', 'node:os.cpus', demandGapMs),
        logicalProcessorCpuPercent: metric('logicalProcessorCpuPercent', 'percent per logical processor', 'node:os.cpus', demandGapMs, true),
        cpuPercent: metric('cpuPercent', 'percent of logical capacity', 'node:os.cpus', demandGapMs, true),
        hostProcessCpuPercent: metric('hostProcessCpuPercent', 'percent of one logical processor', 'node:process.cpuUsage', demandGapMs, true),
        availableMemoryBytes: metric('availableMemoryBytes', 'bytes', 'node:os.freemem', demandGapMs),
        totalMemoryBytes: metric('totalMemoryBytes', 'bytes', 'node:os.totalmem', demandGapMs),
        vramAvailableBytes: metric('vramAvailableBytes', 'bytes', 'No qualified adapter budget sensor', 0, false, false),
        powerState: metric('powerState', 'state', 'No qualified power sensor', 0, false, false),
        thermalTemperature: metric('thermalTemperature', 'degrees Celsius', 'No qualified thermal sensor', 0, false, false),
        foregroundApp: metric('foregroundApp', 'state', 'No authorized foreground OS source', 0, false, false),
        frameTime: metric('frameTime', 'ms', 'No renderer sample attached', 0, false, false),
      } };
    },
    noteActivity() { if (!disposed) lastInput = now(); },
    stopDemand() { lastDemand = -Infinity; probe?.abort(); },
    dispose() { disposed = true; probe?.abort(); policy.dispose(); samples.clear(); errors.clear(); },
  };
}
