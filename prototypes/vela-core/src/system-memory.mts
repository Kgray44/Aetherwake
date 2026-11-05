import { totalmem, freemem, platform } from 'node:os';
import { SYSTEM_MEMORY_CONTRACT, validateSystemMemoryMeasurement, type SystemMemoryMeasurement } from './system-information.ts';

/** Trusted Node only. No ambient polling, process-memory proxy, general command,
 * file, network, renderer bridge or provider capability is exposed here.
 * Windows libuv reads GlobalMemoryStatusEx ullTotalPhys/ullAvailPhys:
 * https://github.com/libuv/libuv/blob/v1.x/src/win/util.c
 * https://nodejs.org/docs/latest-v24.x/api/os.html#osfreemem
 */
export function createSystemMemoryReader(source: { totalmem(): number; freemem(): number; platform(): string }, now: () => number = Date.now): () => SystemMemoryMeasurement {
  return () => {
    const totalBytes = source.totalmem(), availableBytes = source.freemem(), usedBytes = totalBytes - availableBytes, operatingSystem = source.platform();
    const reading: SystemMemoryMeasurement = {
      contract: SYSTEM_MEMORY_CONTRACT, totalBytes, availableBytes, usedBytes,
      utilizationPercent: Math.round((usedBytes / totalBytes) * 10000) / 100,
      measuredAt: new Date(now()).toISOString(),
      source: { kind: 'node:os', api: 'totalmem+freemem', scope: 'host-physical-memory', platform: operatingSystem },
      interpretation: { available: operatingSystem === 'win32' ? 'windows-available-physical' : 'os-reported-free-physical', used: 'total-minus-available', excludes: 'process-and-committed-memory' },
    };
    validateSystemMemoryMeasurement(reading); return reading;
  };
}
/** The actual host is sampled only when this function is explicitly called. */
export const readSystemMemory = createSystemMemoryReader({ totalmem, freemem, platform });
