import type { VelaApiUsageStatus } from '../../../prototypes/integrated-backend/src/vela-api-runtime.mts';
import { openBlindJournal } from './blind-journal.mts';
import { runBlindCie, type BlindCheckpoint, type BlindPayload } from './blind-runner.mts';
import { canStartReviewedCieCase } from './native-budget.mts';

/** An already admitted native host. The profile ID must come from the owner of
 * the durable usage ledger and remain stable across restarts. */
export interface NativeCieEvaluationHost {
  profileId: string;
  route: NonNullable<BlindCheckpoint['route']>;
  readUsage(): Promise<VelaApiUsageStatus>;
  runReviewedCase(input: Readonly<BlindPayload>, signal: AbortSignal): Promise<unknown>;
}

export async function runNativeCieBatch(input: Buffer, candidate: BlindCheckpoint['candidate'],
  host: NativeCieEvaluationHost, journalPath: string, maxCases: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const journal = openBlindJournal(journalPath, { profileId: host.profileId });
  try {
    return await runBlindCie(input, candidate, (item, abort) => host.runReviewedCase(item, abort), signal, {
      journal, maxCases, route: host.route,
      canStartCase: abort => canStartReviewedCieCase(() => host.readUsage(), abort),
    });
  } finally {
    journal.close();
  }
}
