/** Browser-safe facts. Registration of a trusted reader is the native policy
 * boundary; renderer/model arguments never supply measurements or authority. */
export const SYSTEM_MEMORY_CONTRACT = 'aerynth.system-memory@1' as const;
export interface SystemMemoryMeasurement {
  contract: typeof SYSTEM_MEMORY_CONTRACT;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  /** (total - available) / total, rounded to two percentage decimals. */
  utilizationPercent: number;
  measuredAt: string;
  source: { kind: 'node:os'; api: 'totalmem+freemem'; scope: 'host-physical-memory'; platform: string };
  interpretation: {
    available: 'windows-available-physical' | 'os-reported-free-physical';
    used: 'total-minus-available';
    excludes: 'process-and-committed-memory';
  };
}
/** Deliberately only the implemented memory read. Additional system readers
 * require their own typed contract and native authorization; no generic exec. */
export interface VelaReadOnlySystemHost { memory(): SystemMemoryMeasurement }

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join(',') === expected.sort().join(',');
export function validateSystemMemoryMeasurement(value: unknown): asserts value is SystemMemoryMeasurement {
  if (!record(value) || !keys(value, ['contract', 'totalBytes', 'availableBytes', 'usedBytes', 'utilizationPercent', 'measuredAt', 'source', 'interpretation']) || value.contract !== SYSTEM_MEMORY_CONTRACT) throw new Error('invalid_system_memory');
  const { totalBytes: total, availableBytes: available, usedBytes: used, utilizationPercent: percent, measuredAt, source, interpretation } = value;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0 || typeof available !== 'number' || !Number.isSafeInteger(available) || available < 0 || available > total || typeof used !== 'number' || !Number.isSafeInteger(used) || used !== total - available || typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 || percent !== Math.round((used / total) * 10000) / 100) throw new Error('invalid_system_memory');
  if (typeof measuredAt !== 'string' || measuredAt.length > 40 || !Number.isFinite(Date.parse(measuredAt)) || new Date(measuredAt).toISOString() !== measuredAt) throw new Error('invalid_system_memory');
  if (!record(source) || !keys(source, ['kind', 'api', 'scope', 'platform']) || source.kind !== 'node:os' || source.api !== 'totalmem+freemem' || source.scope !== 'host-physical-memory' || typeof source.platform !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(source.platform)) throw new Error('invalid_system_memory');
  if (!record(interpretation) || !keys(interpretation, ['available', 'used', 'excludes']) || interpretation.available !== (source.platform === 'win32' ? 'windows-available-physical' : 'os-reported-free-physical') || interpretation.used !== 'total-minus-available' || interpretation.excludes !== 'process-and-committed-memory') throw new Error('invalid_system_memory');
}
