import { execFile } from 'node:child_process';
import { freemem, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { aggregateGpuEngines, readCpuCounters } from '../../vela-core/src/system-utilization.mts';
import type { MissionAdmission, MissionAdmissionReading } from './mission-contracts.mts';

const memoryFloorBytes = 512 * 1024 * 1024;
const cpuIntervalMs = 500;
const demandGapMs = 5_000;
const windowsWarmupMs = 2_000;
const windowsIntervalMs = 20_000;
const windowsFreshMs = 30_000;
const inputFreshMs = 3_000;

type CpuCounters = ReturnType<typeof readCpuCounters>;
type WindowsPressure = { gpuEnginePercent?: number; diskQueueLength?: number };
type TimedReading = { reading: MissionAdmissionReading; time: number };
type Pressure = { sample?: TimedReading; highSamples: number; pressured: boolean };
type AdmissionOptions = {
  maxWorkers: number;
  onChange?(): void;
  now?(): number;
  wallNow?(): number;
  availableMemory?(): number;
  cpuCounters?(): CpuCounters;
  readWindowsPressure?: ((signal: AbortSignal) => Promise<WindowsPressure>) | null;
};

const numeric = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

const exec = promisify(execFile);
const countersScript = `
$ErrorActionPreference = 'Stop'
$gpu = $null
$disk = $null
try {
  $gpu = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object -First 8193 -Property Name,UtilizationPercentage)
} catch {}
try {
  $disk = @(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object Name -ne '_Total' | Select-Object -First 129 -ExpandProperty AvgDiskQueueLength)
} catch {}
ConvertTo-Json -InputObject @{gpu=$gpu; disk=$disk} -Compress
`;

async function sampleWindowsPressure(signal: AbortSignal): Promise<WindowsPressure> {
  const windows = process.env.SystemRoot;
  if (!windows || !isAbsolute(windows)) return {};
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', countersScript],
    { windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024, encoding: 'utf8', signal });
  const { gpu, disk } = JSON.parse(stdout) as { gpu?: unknown; disk?: unknown };
  let gpuEnginePercent: number | undefined;
  try { gpuEnginePercent = aggregateGpuEngines(gpu).percent; } catch { /* The disk reading can still be valid. */ }
  const diskQueueLength = Array.isArray(disk) && disk.length > 0 && disk.length <= 128 &&
    disk.every(value => numeric(value, Number.MAX_SAFE_INTEGER)) ? Math.max(...disk) : undefined;
  return { gpuEnginePercent, diskQueueLength };
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

  function reading(value: number, time: number): TimedReading {
    return { reading: { value, observedAt: new Date(wallNow()).toISOString() }, time };
  }

  function refreshCpu(time: number) {
    const before = cpuBaseline;
    if (before && time - before.time < cpuIntervalMs) return;
    try {
      const after = readCpu();
      cpuBaseline = { counters: after, time };
      if (!before) return;
      const total = after.total - before.counters.total, idle = after.idle - before.counters.idle;
      const valid = time - before.time <= demandGapMs && after.logicalCpus > 0 && after.logicalCpus === before.counters.logicalCpus &&
        total > 0 && Number.isFinite(total) && numeric(idle, total);
      const utilization = valid ? reading(Math.round(10_000 * ((total - idle) / total)) / 100, time) : undefined;
      cpu = observePressure(cpu, utilization, 90, 82);
    } catch {
      cpuBaseline = undefined;
      cpu = observePressure(cpu, undefined, 90, 82);
    }
  }

  function applyWindowsPressure(result: WindowsPressure) {
    if (disposed) return;
    const time = now(), recentDemand = time - lastDemand <= demandGapMs;
    const previousGpu = fresh(gpu.sample, time, windowsFreshMs);
    const previousDisk = fresh(disk.sample, time, windowsFreshMs);
    const gpuReading = numeric(result.gpuEnginePercent, 100) ? reading(result.gpuEnginePercent, time) : undefined;
    const diskReading = numeric(result.diskQueueLength, Number.MAX_SAFE_INTEGER) ? reading(result.diskQueueLength, time) : undefined;
    gpu = observePressure(previousGpu ? gpu : { highSamples: 0, pressured: false }, gpuReading, 95, 85);
    disk = observePressure(previousDisk ? disk : { highSamples: 0, pressured: false }, diskReading, 8, 4);
    if (recentDemand && (gpuReading || diskReading || previousGpu || previousDisk)) options.onChange?.();
  }

  function refreshWindows(time: number) {
    if (!readWindows || probe || time - demandSince < windowsWarmupMs || time - lastProbe < windowsIntervalMs) return;
    const controller = new AbortController();
    probe = controller;
    lastProbe = time;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return readWindows(controller.signal);
    }).catch((): WindowsPressure => ({})).then(result => {
      if (!controller.signal.aborted) applyWindowsPressure(result);
    }).catch(() => {
      // Optional telemetry and a failed observer cannot stall scheduler admission.
    }).finally(() => { probe = undefined; });
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
      return { workerLimit, reasons, readings: {
        ...(cpuPercent ? { cpuPercent: { ...cpuPercent } } : {}),
        ...(availableMemoryBytes ? { availableMemoryBytes: { ...availableMemoryBytes } } : {}),
        ...(gpuEnginePercent ? { gpuEnginePercent: { ...gpuEnginePercent } } : {}),
        ...(diskQueueLength ? { diskQueueLength: { ...diskQueueLength } } : {}),
      } };
    },
    noteActivity() { if (!disposed) lastInput = now(); },
    stopDemand() { lastDemand = -Infinity; probe?.abort(); },
    dispose() { disposed = true; probe?.abort(); },
  };
}
