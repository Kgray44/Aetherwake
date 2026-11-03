import { execFile } from 'node:child_process';
import { cpus, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

export type SystemUtilization =
  | { metric: 'cpu'; source: 'node:os.cpus'; measuredAt: string; percent: number; sampleMs: number; logicalCpus: number }
  | { metric: 'gpu'; source: 'windows:gpu-engine'; measuredAt: string; percent: number; observedAdapters: number; observedEngines: number };

function cpuTimes() {
  const processors = cpus();
  return {
    logicalCpus: processors.length,
    idle: processors.reduce((sum, cpu) => sum + cpu.times.idle, 0),
    total: processors.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0),
  };
}

export async function readCpuUtilization(): Promise<SystemUtilization> {
  const start = performance.now(), before = cpuTimes();
  await delay(250);
  const after = cpuTimes(), elapsed = Math.round(performance.now() - start);
  const total = after.total - before.total, idle = after.idle - before.idle;
  if (before.logicalCpus === 0 || before.logicalCpus !== after.logicalCpus || total <= 0 || idle < 0 || idle > total)
    throw Error('invalid_cpu_counters');
  return { metric: 'cpu', source: 'node:os.cpus', measuredAt: new Date().toISOString(),
    percent: Math.round(10000 * (total - idle) / total) / 100, sampleMs: elapsed, logicalCpus: after.logicalCpus };
}

export function aggregateGpuEngines(rows: unknown) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 8192) throw Error('gpu_counters_unavailable');
  const adapters = new Set<string>();
  const engines = new Map<string, number>();
  const instances = new Set<string>();
  for (const row of rows) {
    const name = row?.Name, percent = row?.UtilizationPercentage;
    if (typeof name !== 'string' || typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)
      throw Error('invalid_gpu_counter');
    const match = /^pid_(\d+)_(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)_(eng_\d+)_engtype_.+$/iu.exec(name.toLowerCase());
    if (!match) throw Error('invalid_gpu_instance');
    const [, pid, adapter, engineId] = match;
    const engine = adapter + '_' + engineId, instance = pid + '_' + engine;
    if (instances.has(instance)) throw Error('invalid_gpu_instance');
    instances.add(instance);
    adapters.add(adapter);
    engines.set(engine, (engines.get(engine) ?? 0) + percent);
  }
  // Sum process contributions per engine. Rounded counters can add slightly above 100.
  const busiest = Math.max(...engines.values());
  if (busiest > 105) throw Error('inconsistent_gpu_counters');
  return { percent: Math.min(100, busiest), observedAdapters: adapters.size, observedEngines: engines.size };
}

export async function readGpuUtilization(): Promise<SystemUtilization> {
  const windows = process.env.SystemRoot;
  if (platform() !== 'win32' || !windows || !isAbsolute(windows)) throw Error('gpu_counters_unavailable');
  const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "$ErrorActionPreference = 'Stop'; ConvertTo-Json -InputObject @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name,UtilizationPercentage) -Compress";
  const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, timeout: 4000, maxBuffer: 512 * 1024, encoding: 'utf8' });
  return { metric: 'gpu', source: 'windows:gpu-engine', measuredAt: new Date().toISOString(), ...aggregateGpuEngines(JSON.parse(stdout)) };
}
