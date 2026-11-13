import type { VelaApiUsageStatus } from '../../../prototypes/integrated-backend/src/vela-api-runtime.mts';

// The native provider review permits at most six Responses calls per CIE turn.
const maxCallsPerReviewedTurn = 6;

/** Check room for the full reviewed turn using the native runtime's current ledger. */
export async function canStartReviewedCieCase(readUsage: () => Promise<VelaApiUsageStatus>, signal: AbortSignal) {
  signal.throwIfAborted();
  const status = await readUsage();
  signal.throwIfAborted();
  if (!status.enabled || status.configurationVersion === null) throw new Error('blind_native_usage_unavailable');
  if (!Number.isSafeInteger(status.requestsPerDay) || !Number.isSafeInteger(status.usedToday) ||
    status.requestsPerDay < 1 || status.usedToday < 0) throw new Error('blind_native_usage_invalid');
  return status.requestsPerDay - status.usedToday >= maxCallsPerReviewedTurn;
}
