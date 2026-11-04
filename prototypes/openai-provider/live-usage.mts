/** Public list pricing checked against the official model/pricing pages.
 * https://developers.openai.com/api/docs/models/gpt-live-1
 * https://developers.openai.com/api/docs/guides/voice-latency-cost
 * Estimates are neither invoices nor a promise of an account's contracted rate. */
export const LIVE_LIST_PRICE = Object.freeze({ model: 'gpt-live-1' as const, currency: 'USD' as const,
  perMinute: .05, checkedAt: '2026-11-04', source: 'https://developers.openai.com/api/docs/pricing' });
export interface LiveUsageInput {
  dispatched: boolean;
  usage: { seconds: number | null; source: 'provider-reported' | 'unavailable'; final: boolean };
}
export function estimateLiveUsage(input: LiveUsageInput, observedElapsedSeconds?: number) {
  const seconds = input.usage.seconds;
  if (typeof input.dispatched !== 'boolean' || typeof input.usage.final !== 'boolean' ||
      !['provider-reported','unavailable'].includes(input.usage.source) || !input.dispatched && seconds !== null ||
      seconds !== null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) ||
      (seconds === null) !== (input.usage.source === 'unavailable') || input.usage.final && seconds === null ||
      observedElapsedSeconds !== undefined && (!Number.isFinite(observedElapsedSeconds) || observedElapsedSeconds < 0 || observedElapsedSeconds > 86400))
    throw Error('live_usage_estimate_invalid');
  const exposureSeconds = input.dispatched ? 15 : 0;
  const duration = !input.dispatched ? 0 : seconds ?? observedElapsedSeconds ?? null;
  // Initialization is credited against running duration. It is not an extra
  // fifteen seconds to add to every reported session total.
  const estimatedSeconds = duration === null ? null : Math.max(exposureSeconds, duration);
  return {
    reportedSeconds: seconds, reportedFinal: input.usage.final,
    initializationExposureSeconds: exposureSeconds,
    potentialInitializationUSD: exposureSeconds * LIVE_LIST_PRICE.perMinute / 60,
    estimatedSeconds, estimatedUSD: estimatedSeconds === null ? null : estimatedSeconds * LIVE_LIST_PRICE.perMinute / 60,
    basis: !input.dispatched ? 'not-dispatched' as const : seconds !== null ? 'provider-duration' as const :
      observedElapsedSeconds !== undefined ? 'local-elapsed-estimate' as const : 'initialization-exposure-only' as const,
    price: LIVE_LIST_PRICE, billedUSD: null, backendUsageIncluded: false as const,
  };
}
