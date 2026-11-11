import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createMissionCpuPool } from './mission-cpu-pool.mts';
import { inspectBackendSource } from './mission-cpu-worker.mts';

const modes = ['inline', 'pool-1', 'pool-2'] as const;
const pools = { 'pool-1': createMissionCpuPool(1), 'pool-2': createMissionCpuPool(2) };
const signal = new AbortController().signal;
const expected = (await inspectBackendSource()).value.sha256;
const count = 24;
const round = (value: number) => Math.round(value * 100) / 100;

async function run(mode: typeof modes[number]) {
  const pool = mode === 'inline' ? undefined : pools[mode];
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  try {
    await delay(10);
    const start = performance.now(), cpuStart = process.cpuUsage();
    const queue: number[] = [];
    let next = 0, verified = 0;
    await Promise.all(Array.from({ length: mode === 'pool-2' ? 2 : 1 }, async () => {
      while (next++ < count) {
        queue.push(performance.now() - start);
        const evidence = pool ? (await pool.inspect(signal)).evidence : await inspectBackendSource(signal);
        if (evidence.value.sha256 !== expected) throw Error('benchmark_source_changed');
        verified++;
      }
    }));
    const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
    return { mode, verified, elapsedMs: round(elapsedMs), jobsPerSec: round(1000 * verified / elapsedMs),
      queueP95Ms: round(queue.sort((a, b) => a - b)[Math.ceil(count * 0.95) - 1]!),
      eventLoopP95Ms: histogram.count ? round(histogram.percentile(95) / 1e6) : null,
      processCpuMs: round((cpu.user + cpu.system) / 1000) };
  } finally { histogram.disable(); }
}

try {
  for (const mode of modes) await run(mode);
  const rows: Awaited<ReturnType<typeof run>>[] = [];
  for (let index = 0; index < modes.length; index++) {
    for (const mode of [...modes.slice(index), ...modes.slice(0, index)]) rows.push(await run(mode));
  }
  console.log(JSON.stringify({ contract: 'aerynth.mission-cpu-benchmark@1', platform: process.platform,
    node: process.version, jobsPerRun: count, warmupsPerArm: 1, rows }));
} finally { await Promise.all(Object.values(pools).map(pool => pool.close())); }
