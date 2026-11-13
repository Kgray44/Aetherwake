import { createHash } from 'node:crypto';
import type { MissionExecutionProfile } from '../../../prototypes/integrated-backend/src/execution-profiler.mts';

type Run = NonNullable<MissionExecutionProfile['cognition']>['runs'][number];
export interface Repetition {
  id: string;
  arm: string;
  /** Measured from before qualification/context preparation until verified result. */
  endToEndMs: number | null;
  quality: { evaluator: string; artifactSha256: string; passed: boolean } | null;
  profile: Pick<MissionExecutionProfile, 'cognition'>;
}
export interface Rate {
  model: string;
  currency: string;
  source: string;
  effectiveAt: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const tokens = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
function cost(run: Run, rates: readonly Rate[]) {
  const candidates = rates.filter(rate => rate.model === run.reportedModel);
  if (run.providerEvidence !== 'reported' || candidates.length !== 1 || !run.usage) return null;
  const rate = candidates[0], usage = run.usage;
  if (!rate.source || !rate.effectiveAt || !rate.currency ||
    ![rate.inputPerMillion, rate.cachedInputPerMillion, rate.outputPerMillion].every(nonnegative) ||
    ![usage.inputTokens, usage.outputTokens, usage.cachedInputTokens].every(tokens) ||
    usage.cachedInputTokens! > usage.inputTokens! || !tokens(usage.totalTokens) ||
    usage.inputTokens! + usage.outputTokens! !== usage.totalTokens) return null;
  return { kind: 'estimate' as const, currency: rate.currency,
    amount: ((usage.inputTokens! - usage.cachedInputTokens!) * rate.inputPerMillion +
      usage.cachedInputTokens! * rate.cachedInputPerMillion + usage.outputTokens! * rate.outputPerMillion) / 1e6,
    rate: { ...rate }, scope: 'reported cognitive token usage only; not an invoice or subscription quota' };
}
function distribution(values: number[]) {
  if (!values.length) return { samples: 0, p50: null, p95: null };
  values.sort((a, b) => a - b);
  return { samples: values.length, p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1] };
}
/** Offline derived view of canonical AEP receipts, never a second ledger or promotion authority. */
export function reportCognitiveRepetitions(repetitions: readonly Repetition[], rates: readonly Rate[] = []) {
  if (new Set(repetitions.map(row => row.id)).size !== repetitions.length) throw new Error('duplicate_repetition');
  const seen = new Set<string>();
  const rows = repetitions.map(repetition => {
    const cognition = repetition.profile.cognition;
    const issues: string[] = [];
    if (!cognition) issues.push('cognition-unavailable');
    if (cognition?.truncated) issues.push('cognition-truncated');
    if (!nonnegative(repetition.endToEndMs)) issues.push('end-to-end-unavailable');
    const byId = new Map<string, Run>();
    for (const run of cognition?.runs ?? []) {
      const prior = byId.get(run.executionId);
      if (prior && digest(prior) !== digest(run)) throw new Error('conflicting_execution_receipts');
      byId.set(run.executionId, run);
    }
    const calls = [...byId.values()].map(run => {
      if (seen.has(run.executionId)) throw new Error('execution_reused_across_repetitions');
      seen.add(run.executionId);
      if (run.providerEvidence !== 'reported') issues.push('simulated-provider');
      if (run.dispatched === null) issues.push('dispatch-unknown');
      if (!run.usage) issues.push('usage-unavailable');
      return { ...run, cost: cost(run, rates),
        qualityContribution: 'not causally identified; independent ablation evidence required' };
    });
    return { id: repetition.id, arm: repetition.arm, endToEndMs: nonnegative(repetition.endToEndMs) ? repetition.endToEndMs : null,
      quality: repetition.quality, calls, issues: [...new Set(issues)] };
  });
  const arms = [...new Set(rows.map(row => row.arm))].map(arm => {
    const selected = rows.filter(row => row.arm === arm);
    return { arm, repetitions: selected.length,
      endToEndMs: distribution(selected.flatMap(row => row.endToEndMs === null ? [] : [row.endToEndMs])),
      independentQualityKnown: selected.filter(row => row.quality !== null).length,
      independentQualityPassed: selected.filter(row => row.quality?.passed).length,
      incomplete: selected.filter(row => row.issues.length > 0).length };
  });
  return { contract: 'aerynth.cie-cognitive-repetitions@1', inputDigest: digest(repetitions), rows, arms,
    promotion: 'not authorized by this report; requires independent matched quality and security evaluation' };
}
