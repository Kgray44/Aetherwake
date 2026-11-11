import { execFile } from 'node:child_process';
import { freemem, platform, totalmem } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { aggregateGpuEngines, readCpuCounters } from '../../vela-core/src/system-utilization.mts';
import type { MissionAdmission, MissionAdmissionReading } from './mission-contracts.mts';
import { createResourcePolicy, type ResourcePolicyConfig, type ResourcePolicyPersistence } from './resource-policy.mts';
import type { HostPower, ResourceSignal } from './resource-signals.mts';
import { createWindowsGpuCapacityCache, estimateDedicatedHeadroom } from './windows-gpu-memory.mts';

const memoryFloorBytes = 512 * 1024 * 1024;
const cpuIntervalMs = 500;
const demandGapMs = 5_000;
const windowsWarmupMs = 2_000;
const windowsIntervalMs = 20_000;
const windowsFreshMs = 30_000;
const inputFreshMs = 3_000;
const rendererFreshMs = 6_000;
const powerFreshMs = 15_000;
const desktopActivityFreshMs = 6_500;

type CpuCounters = Omit<ReturnType<typeof readCpuCounters>, 'logicalProcessors'> &
  Partial<Pick<ReturnType<typeof readCpuCounters>, 'logicalProcessors'>>;
const windowsMetrics = {
  gpuEnginePercent: ['percent', 'Windows GPU Engine counters (busiest engine)'],
  gpuDedicatedCapacityBytes: ['bytes', 'DXGI adapter dedicated capacity (selected adapter)'],
  gpuDedicatedInUseBytes: ['bytes', 'Windows WDDM GPU Adapter Memory dedicated usage (selected adapter)'],
  vramAvailableBytes: ['bytes', 'DXGI dedicated capacity minus WDDM dedicated usage (selected adapter estimate)'],
  diskQueueLength: ['requests', 'Windows PhysicalDisk counters (busiest device)'],
  diskBytesPerSecond: ['bytes/s', 'Windows PhysicalDisk counters (_Total)'],
  networkBytesPerSecond: ['bytes/s', 'Windows Network Interface counters (busiest interface)'],
  physicalCores: ['cores', 'Win32_Processor.NumberOfCores (sum across packages)'],
  pagesPerSecond: ['pages/s', 'Windows Memory.PagesPersec'],
  windowsLowMemory: ['0=clear, 1=low physical memory', 'Windows QueryMemoryResourceNotification'],
  windowsCommitHeadroomBytes: ['bytes', 'Windows GetPerformanceInfo commit limit minus committed pages'],
} as const;
type WindowsPressure = Partial<Record<keyof typeof windowsMetrics, number>>;
const earlyMemoryMetrics = ['windowsLowMemory', 'windowsCommitHeadroomBytes'] as const;
type EarlyMemoryMetric = typeof earlyMemoryMetrics[number];
type WindowsProbeStage = 'memory' | 'utilization';
type ObserveWindowsPressure = (value: WindowsPressure, stage: WindowsProbeStage) => void;
type WindowsProbeLine = WindowsPressure & { gpu?: unknown; disk?: unknown; gpuMemory?: unknown };
type TimedReading = { reading: MissionAdmissionReading; time: number };
type MetricValue = number | readonly number[];
type MetricSample = { value: MetricValue; observedAt: string; time: number; windowMs: number | null };
type Availability = 'observed' | 'derived' | 'estimated' | 'unsupported' | 'disabled' | 'stale' | 'error' | 'not_sampled';
type Pressure = { sample?: TimedReading; highSamples: number; pressured: boolean };
type AdmissionOptions = {
  maxWorkers: number;
  onChange?(): void;
  now?(): number;
  wallNow?(): number;
  availableMemory?(): number;
  cpuCounters?(): CpuCounters;
  readWindowsPressure?: ((signal: AbortSignal, observe: ObserveWindowsPressure) => Promise<WindowsPressure>) | null;
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
$memoryPressure = $null
$commitHeadroom = $null
try {
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class AerynthMemoryPressure {
  [StructLayout(LayoutKind.Sequential)]
  private struct PerformanceInformation {
    public uint Size;
    public System.UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable, SystemCache;
    public System.UIntPtr KernelTotal, KernelPaged, KernelNonpaged, PageSize;
    public uint HandleCount, ProcessCount, ThreadCount;
  }
  [DllImport("kernel32.dll", ExactSpelling = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool K32GetPerformanceInfo(out PerformanceInformation information, uint size);
  [DllImport("kernel32.dll", ExactSpelling = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  private static extern SafeWaitHandle CreateMemoryResourceNotification(int notificationType);
  [DllImport("kernel32.dll", ExactSpelling = true)]
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool QueryMemoryResourceNotification(SafeWaitHandle handle, [MarshalAs(UnmanagedType.Bool)] out bool low);
  public static int? ReadLow() {
    using (var handle = CreateMemoryResourceNotification(0)) {
      bool low;
      if (handle.IsInvalid || !QueryMemoryResourceNotification(handle, out low)) return null;
      return low ? 1 : 0;
    }
  }
  public static ulong? ReadCommitHeadroom() {
    PerformanceInformation information;
    if (!K32GetPerformanceInfo(out information, (uint)Marshal.SizeOf(typeof(PerformanceInformation)))) return null;
    ulong limit = information.CommitLimit.ToUInt64(), total = information.CommitTotal.ToUInt64();
    ulong pageSize = information.PageSize.ToUInt64();
    if (limit == 0 || pageSize == 0) return null;
    return checked((limit > total ? limit - total : 0UL) * pageSize);
  }
}
'@
  $memoryPressure = [AerynthMemoryPressure]::ReadLow()
} catch {}
try { $commitHeadroom = [AerynthMemoryPressure]::ReadCommitHeadroom() } catch {}
ConvertTo-Json -InputObject @{windowsLowMemory=$memoryPressure; windowsCommitHeadroomBytes=$commitHeadroom} -Compress
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
$gpuMemory = $null
try {
  $gpuMemory = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory |
    Select-Object -First 65 -Property Name,DedicatedUsage)
} catch {}
ConvertTo-Json -InputObject @{gpuMemory=$gpuMemory} -Compress
`;

function windowsUtilization({ gpu, disk, diskBytesPerSecond }: WindowsProbeLine): WindowsPressure {
  let gpuEnginePercent: number | undefined;
  try { gpuEnginePercent = aggregateGpuEngines(gpu).percent; } catch { /* Disk counters may still be valid. */ }
  const diskQueueLength = Array.isArray(disk) && disk.length > 0 && disk.length <= 128 &&
    disk.every(value => numeric(value, Number.MAX_SAFE_INTEGER)) ? Math.max(...disk) : undefined;
  return { gpuEnginePercent, diskQueueLength, diskBytesPerSecond };
}

async function sampleWindowsPressure(signal: AbortSignal, topology: ReturnType<typeof createWindowsGpuCapacityCache>,
  observe: ObserveWindowsPressure): Promise<WindowsPressure> {
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) return {};
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const capacity = topology.get(powershell, signal);
  const execution = exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', countersScript],
    { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8', signal });
  const parse = (line: string): WindowsProbeLine => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === 'object' && !Array.isArray(value) ? value as WindowsProbeLine : {};
    }
    catch { return {}; }
  };
  let buffered = '', lines = 0;
  let earlyUtilization: WindowsPressure | undefined;
  const receive = (chunk: string) => {
    buffered += chunk;
    while (lines < 2) {
      const end = buffered.indexOf('\n');
      if (end === -1) break;
      const line = parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (++lines === 1) observe(line, 'memory');
      else observe(earlyUtilization = windowsUtilization(line), 'utilization');
    }
    if (lines === 2 || buffered.length >= 1024 * 1024) execution.child.stdout?.off('data', receive);
  };
  execution.child.stdout?.on('data', receive);
  const { stdout } = await execution.catch((error: { killed?: boolean; stdout?: string }) => {
      if (!signal.aborted && error.killed && typeof error.stdout === 'string') return { stdout: error.stdout };
      throw error;
    });
  // Keep complete primary observations even if optional counters time out.
  const parts = stdout.split(/\r?\n/u).slice(0, 4).map(parse);
  const { gpu, disk, gpuMemory, ...counters } = Object.assign({}, ...parts) as WindowsProbeLine;
  const utilization = earlyUtilization ?? windowsUtilization({ gpu, disk, diskBytesPerSecond: counters.diskBytesPerSecond });
  return { ...counters, ...utilization, ...estimateDedicatedHeadroom(await capacity, gpuMemory) };
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
  const topology = platform() === 'win32' && options.readWindowsPressure === undefined ? createWindowsGpuCapacityCache() : undefined;
  const readWindows = options.readWindowsPressure ?? (topology ?
    (signal: AbortSignal, observe: ObserveWindowsPressure) => sampleWindowsPressure(signal, topology, observe) : undefined);
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
  let focused: boolean | null = null;
  let power: { value: HostPower; time: number } | undefined;
  let frame: { timing: TimedReading; ratio: number } | undefined;
  let framePressure: Pressure = { highSamples: 0, pressured: false };
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

  function applyWindowsUtilization(result: WindowsPressure, startedAt: number, startedAtUtc: string) {
    const time = now(), recentDemand = time - lastDemand <= demandGapMs;
    const previousGpu = fresh(gpu.sample, time, windowsFreshMs);
    const previousDisk = fresh(disk.sample, time, windowsFreshMs);
    const windowsReading = (value: number) => ({ reading: { value, observedAt: startedAtUtc }, time: startedAt });
    const gpuReading = numeric(result.gpuEnginePercent, 100) ? windowsReading(result.gpuEnginePercent) : undefined;
    const diskReading = numeric(result.diskQueueLength, Number.MAX_SAFE_INTEGER) ? windowsReading(result.diskQueueLength) : undefined;
    for (const name of ['gpuEnginePercent', 'diskQueueLength', 'diskBytesPerSecond'] as const) {
      const value = result[name];
      capture(name, numeric(value, name === 'gpuEnginePercent' ? 100 : Number.MAX_SAFE_INTEGER) ? value : undefined,
        startedAt, null, startedAtUtc);
    }
    gpu = observePressure(previousGpu ? gpu : { highSamples: 0, pressured: false }, gpuReading, 95, 85);
    disk = observePressure(previousDisk ? disk : { highSamples: 0, pressured: false }, diskReading, 8, 4);
    if (recentDemand && (gpuReading || diskReading || previousGpu || previousDisk)) notifyWindowsObservation();
  }

  function notifyWindowsObservation() {
    try { options.onChange?.(); } catch { /* Optional telemetry cannot break the host. */ }
  }

  function refreshWindows(time: number) {
    if (!policy.windowsMonitoring() || !readWindows || probe ||
        time - demandSince < windowsWarmupMs || time - lastProbe < windowsIntervalMs) return;
    const controller = new AbortController();
    const startedAtUtc = new Date(wallNow()).toISOString();
    probe = controller;
    lastProbe = time;
    const reported = new Set<WindowsProbeStage>();
    const observe: ObserveWindowsPressure = (observation, stage) => {
      if (reported.has(stage) || controller.signal.aborted || disposed) return;
      reported.add(stage);
      if (stage === 'utilization') {
        applyWindowsUtilization(observation, time, startedAtUtc);
        return;
      }
      const observedAt = now();
      let changed = false;
      for (const name of earlyMemoryMetrics) {
        const value = observation[name];
        const previous = samples.get(name);
        const before = previous && observedAt - previous.time <= windowsFreshMs ? previous.value : undefined;
        const valid = name === 'windowsLowMemory' ? value === 0 || value === 1 :
          numeric(value, Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(value);
        capture(name, valid ? value : undefined, time, 0, startedAtUtc);
        if (valid && value !== before) changed = true;
      }
      if (changed && observedAt - lastDemand <= demandGapMs) {
        notifyWindowsObservation();
      }
    };
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return readWindows(controller.signal, observe);
    }).catch((): WindowsPressure => ({})).then(result => {
      if (!controller.signal.aborted && !disposed) {
        observe(result, 'memory');
        observe(result, 'utilization');
        for (const name of ['gpuDedicatedCapacityBytes', 'gpuDedicatedInUseBytes', 'vramAvailableBytes',
          'networkBytesPerSecond', 'physicalCores', 'pagesPerSecond'] as const) {
          const value = result[name];
          capture(name, numeric(value, Number.MAX_SAFE_INTEGER) ? value : undefined, time, null, startedAtUtc);
        }
      }
    }).catch(() => {
      // Optional telemetry and a failed observer cannot stall scheduler admission.
    }).finally(() => { probe = undefined; });
  }

  function reconcileWindowsMonitoring() {
    if (policy.windowsMonitoring()) return;
    probe?.abort();
    topology?.reset();
    gpu = { highSamples: 0, pressured: false };
    disk = { highSamples: 0, pressured: false };
    for (const name of Object.keys(windowsMetrics)) {
      samples.delete(name);
      errors.delete(name);
    }
  }

  function clearRendererTiming() {
    frame = undefined;
    framePressure = { highSamples: 0, pressured: false };
    samples.delete('frameTime');
    samples.delete('frameBudgetRatio');
    samples.delete('rendererTimingSamples');
  }

  function externalDesktopActivity(time: number) {
    if (!policy.externalActivityProtection() || focused === null || !power || power.value.suspended ||
        power.value.idleSeconds === null || time - power.time > desktopActivityFreshMs) return undefined;
    return !focused && power.value.idleSeconds * 1000 < inputFreshMs;
  }

  function windowsMemoryReading(name: EarlyMemoryMetric, time: number) {
    const sample = samples.get(name);
    return sample && time - sample.time <= windowsFreshMs && typeof sample.value === 'number' ?
      { value: sample.value, observedAt: sample.observedAt } : undefined;
  }

  const governor = {
    read(demand: boolean): MissionAdmission {
      if (disposed) return { workerLimit: options.maxWorkers, reasons: [], readings: {} };
      const time = now();
      if (demand && !power?.value.suspended) {
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
      const windowsLowMemory = windowsMemoryReading('windowsLowMemory', time);
      const windowsCommitHeadroomBytes = windowsMemoryReading('windowsCommitHeadroomBytes', time);
      const gpuEnginePercent = fresh(gpu.sample, time, windowsFreshMs)?.reading;
      const diskQueueLength = fresh(disk.sample, time, windowsFreshMs)?.reading;
      const rendererFrameP95Ms = fresh(frame?.timing, time, rendererFreshMs)?.reading;
      const nativePower = power && time - power.time <= powerFreshMs ? power.value : undefined;
      const reasons: MissionAdmission['reasons'] = [];
      if (availableMemoryBytes && availableMemoryBytes.value < memoryFloorBytes) reasons.push('physical-memory');
      if (windowsLowMemory?.value === 1) reasons.push('os-memory-pressure');
      if (windowsCommitHeadroomBytes && windowsCommitHeadroomBytes.value < memoryFloorBytes) reasons.push('windows-commit-pressure');
      if (cpuPercent && cpu.pressured) reasons.push('cpu-load');
      if (gpuEnginePercent && gpu.pressured) reasons.push('gpu-load');
      if (diskQueueLength && disk.pressured) reasons.push('disk-io');
      if (rendererFrameP95Ms && focused && framePressure.pressured) reasons.push('renderer-latency');
      if (nativePower?.battery === true) reasons.push('battery-power');
      if (nativePower && nativePower.speedLimitPercent !== null && nativePower.speedLimitPercent < 100) reasons.push('cpu-speed-limit');
      if (power?.value.suspended) reasons.push('suspended');
      if ((cpuPercent?.value ?? -1) >= 80 || (gpuEnginePercent?.value ?? -1) >= 85) {
        if (time - lastInput <= inputFreshMs) reasons.push('active-input');
        if (externalDesktopActivity(time)) reasons.push('external-desktop-activity');
      }
      const workerLimit = reasons.includes('physical-memory') || reasons.includes('os-memory-pressure') ||
        reasons.includes('windows-commit-pressure') || reasons.includes('suspended') ?
        0 : reasons.length ? Math.min(1, options.maxWorkers) : options.maxWorkers;
      const snapshot = { workerLimit, reasons, readings: {
        ...(cpuPercent ? { cpuPercent: { ...cpuPercent } } : {}),
        ...(availableMemoryBytes ? { availableMemoryBytes: { ...availableMemoryBytes } } : {}),
        ...(windowsLowMemory ? { windowsLowMemory } : {}),
        ...(windowsCommitHeadroomBytes ? { windowsCommitHeadroomBytes } : {}),
        ...(gpuEnginePercent ? { gpuEnginePercent: { ...gpuEnginePercent } } : {}),
        ...(diskQueueLength ? { diskQueueLength: { ...diskQueueLength } } : {}),
        ...(rendererFrameP95Ms ? { rendererFrameP95Ms: { ...rendererFrameP95Ms } } : {}),
      } };
      policy.update(snapshot, memory ? memory.time + demandGapMs : -Infinity, nativePower?.idleSeconds ?? null);
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
    noteGpuBudget: policy.noteGpuBudget,
    mayPrepareGpu: policy.mayPrepareGpu,
    telemetry() {
      const time = now();
      function metric(name: string, unit: string, source: string, maxAge: number, derived = false, supported = true, enabled = true) {
        const sample = samples.get(name);
        const ageMs = sample ? Math.max(0, time - sample.time) : null;
        const availability: Availability = !supported ? 'unsupported' : !enabled ? 'disabled' : errors.has(name) ? 'error' :
          ageMs === null ? 'not_sampled' : ageMs > maxAge ? 'stale' : name === 'vramAvailableBytes' ? 'estimated' :
            derived ? 'derived' : 'observed';
        return { availability, unit, source, ageMs, observedAt: sample?.observedAt ?? null,
          windowMs: sample?.windowMs ?? null,
          value: availability === 'observed' || availability === 'derived' || availability === 'estimated' ?
            structuredClone(sample!.value) : null };
      }
      const windows = Object.fromEntries((Object.keys(windowsMetrics) as (keyof typeof windowsMetrics)[]).map(name => {
        const [unit, source] = windowsMetrics[name];
        return [name, metric(name, unit, source, windowsFreshMs, name !== 'windowsLowMemory', !!readWindows, policy.windowsMonitoring())];
      })) as Record<keyof typeof windowsMetrics, ReturnType<typeof metric>>;
      const activity = externalDesktopActivity(time);
      const activitySource = metric('idleSeconds', '0=inactive, 1=recent input outside Aerynth',
        'Electron system idle time and Aerynth window focus', desktopActivityFreshMs, true, true, policy.externalActivityProtection());
      return { schemaVersion: 1 as const, scope: 'local-host' as const, metrics: {
        ...windows,
        logicalProcessors: metric('logicalProcessors', 'logical processors', 'node:os.cpus', demandGapMs),
        logicalProcessorCpuPercent: metric('logicalProcessorCpuPercent', 'percent per logical processor', 'node:os.cpus', demandGapMs, true),
        cpuPercent: metric('cpuPercent', 'percent of logical capacity', 'node:os.cpus', demandGapMs, true),
        hostProcessCpuPercent: metric('hostProcessCpuPercent', 'percent of one logical processor', 'node:process.cpuUsage', demandGapMs, true),
        availableMemoryBytes: metric('availableMemoryBytes', 'bytes', 'node:os.freemem', demandGapMs),
        totalMemoryBytes: metric('totalMemoryBytes', 'bytes', 'node:os.totalmem', demandGapMs),
        batteryPower: metric('batteryPower', '0=not on battery, 1=battery', 'Electron powerMonitor.isOnBatteryPower', powerFreshMs),
        idleSeconds: metric('idleSeconds', 's', 'Electron powerMonitor.getSystemIdleTime', powerFreshMs),
        suspended: metric('suspended', '0=awake, 1=suspended', 'Electron powerMonitor suspend/resume', Infinity),
        cpuSpeedLimitPercent: metric('cpuSpeedLimitPercent', 'percent of rated CPU speed', 'Electron powerMonitor speed-limit-change', powerFreshMs),
        thermalTemperature: metric('thermalTemperature', 'degrees Celsius', 'No qualified thermal sensor', 0, false, false),
        foregroundApp: metric('foregroundApp', 'state', 'No authorized foreground OS source', 0, false, false),
        externalDesktopActivity: { ...activitySource,
          availability: activity === undefined && activitySource.availability === 'derived' ? 'not_sampled' : activitySource.availability,
          value: activity === undefined ? null : Number(activity) },
        aerynthFocused: metric('aerynthFocused', '0=unfocused, 1=focused', 'Electron BrowserWindow focus/blur', Infinity),
        frameTime: metric('frameTime', 'ms, callback interval p95', 'Aerynth renderer animation-frame timestamps', rendererFreshMs, true),
        frameBudgetRatio: metric('frameBudgetRatio', 'ratio to target cadence, p95', 'Aerynth renderer animation-frame timestamps', rendererFreshMs, true),
        rendererTimingSamples: metric('rendererTimingSamples', 'callback intervals', 'Aerynth renderer animation-frame timestamps', rendererFreshMs),
      } };
    },
    noteResourceSignal(signal: ResourceSignal) {
      if (disposed) return;
      const time = now();
      if ('aerynthFocused' in signal) {
        focused = signal.aerynthFocused;
        if (!focused) clearRendererTiming();
        capture('aerynthFocused', Number(focused), time);
      } else if ('hostPower' in signal) {
        const next = signal.hostPower;
        if (next.suspended !== (power?.value.suspended ?? false)) {
          probe?.abort();
          topology?.reset();
          policy.noteGpuBudget(null);
          memory = undefined;
          cpuBaseline = processBaseline = undefined;
          cpu = gpu = disk = { highSamples: 0, pressured: false };
          samples.clear();
          errors.clear();
          clearRendererTiming();
          lastDemand = lastProbe = lastInput = -Infinity;
          if (focused !== null) capture('aerynthFocused', Number(focused), time);
        }
        power = { value: { ...next }, time };
        if (next.battery === null) samples.delete('batteryPower');
        else capture('batteryPower', Number(next.battery), time);
        if (next.idleSeconds === null) samples.delete('idleSeconds');
        else capture('idleSeconds', next.idleSeconds, time);
        if (next.speedLimitPercent === null) samples.delete('cpuSpeedLimitPercent');
        else capture('cpuSpeedLimitPercent', next.speedLimitPercent, time);
        capture('suspended', Number(next.suspended), time);
      } else {
        if (!focused || power?.value.suspended || frame && time - frame.timing.time < 1_500) return;
        const { frameP95Ms, budgetRatioP95, samples: count, windowMs } = signal.rendererTiming;
        const previous = fresh(frame?.timing, time, rendererFreshMs) ? frame : undefined;
        const ratio = previous ? previous.ratio * 0.7 + budgetRatioP95 * 0.3 : budgetRatioP95;
        frame = { timing: reading(frameP95Ms, time), ratio };
        framePressure = observePressure(previous ? framePressure : { highSamples: 0, pressured: false }, reading(ratio, time), 1.5, 1.2);
        capture('frameTime', frameP95Ms, time, windowMs);
        capture('frameBudgetRatio', budgetRatioP95, time, windowMs);
        capture('rendererTimingSamples', count, time, windowMs);
      }
      const before = policy.inspect().revision;
      governor.read(false);
      if (policy.inspect().revision !== before) options.onChange?.();
    },
    noteActivity() { if (!disposed) lastInput = now(); },
    stopDemand() { lastDemand = -Infinity; probe?.abort(); },
    dispose() { disposed = true; probe?.abort(); policy.dispose(); samples.clear(); errors.clear(); },
  };
  return governor;
}
