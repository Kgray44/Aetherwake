import type { VelaApiUsageStatus } from '../../../prototypes/integrated-backend/src/vela-api-runtime.mts';
import { openBlindJournal } from './blind-journal.mts';
import { runBlindCie, type BlindCheckpoint, type BlindClaim, type BlindPayload } from './blind-runner.mts';
import { canStartReviewedCieCase } from './native-budget.mts';

/** An already admitted native host. The profile ID must come from the owner of
 * the durable usage ledger and remain stable across restarts. */
export interface NativeCieEvaluationHost {
  profileId: string;
  configurationVersion: number;
  route: NonNullable<BlindCheckpoint['route']>;
  readUsage(): Promise<VelaApiUsageStatus>;
  runReviewedCase(input: Readonly<BlindPayload>, signal: AbortSignal, claim: NativeCieClaim): Promise<unknown>;
  verifyRetainedCase(claim: NativeCieClaim, result: unknown, signal: AbortSignal): Promise<boolean>;
}

export type NativeCieClaim = BlindClaim & Pick<NativeCieEvaluationHost, 'profileId' | 'configurationVersion'>;

export async function runNativeCieBatch(input: Buffer, candidate: BlindCheckpoint['candidate'],
  host: NativeCieEvaluationHost, journalPath: string, maxCases: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const { profileId, configurationVersion } = host;
  if (host.route.transport !== 'synthetic') throw new Error('blind_native_live_activation_required');
  const nativeClaim = (claim: BlindClaim): NativeCieClaim => ({ ...claim, profileId, configurationVersion });
  const journal = openBlindJournal(journalPath, { profileId: host.profileId });
  try {
    return await runBlindCie(input, candidate, (item, abort, claim) => host.runReviewedCase(item, abort, nativeClaim(claim!)), signal, {
      journal, maxCases, route: host.route,
      recovery: { binding: JSON.stringify([profileId, configurationVersion]),
        verify: (claim, result, abort) => host.verifyRetainedCase(nativeClaim(claim), result, abort) },
      canStartCase: abort => canStartReviewedCieCase(async () => {
        const usage = await host.readUsage();
        if (usage.configurationVersion !== configurationVersion) throw new Error('blind_native_profile_changed');
        return usage;
      }, abort),
    });
  } finally {
    journal.close();
  }
}
