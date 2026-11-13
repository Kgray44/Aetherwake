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

/** Explicit evidence observation, separate from the grader's answer verdict. */
export interface NativeCieNoEvidence {
  outcome: 'no-evidence';
  answer: string;
  requestId: string;
  messageId: string;
  admissions: readonly { requestId: string; executionId: string }[];
  settlements: readonly { executionId: string; stage: 'structured' | 'answer' }[];
  evidenceAudit: { sourceBindings: readonly []; assessments: readonly { excerpts: readonly [] }[];
    compositions: readonly { coverage: readonly { status: 'missing' | 'inaccessible' | 'uncertain'; passages: readonly [] }[] }[] };
}

function isNoEvidenceResult(value: unknown): value is NativeCieNoEvidence {
  if (!value || typeof value !== 'object') return false;
  const { outcome, answer, requestId, messageId, admissions, settlements, evidenceAudit } = value as Partial<NativeCieNoEvidence>;
  const present = (text: unknown) => typeof text === 'string' && !!text.trim();
  const empty = (items: unknown) => Array.isArray(items) && items.length === 0;
  return outcome === 'no-evidence' && present(answer) && present(requestId) && present(messageId) &&
    Array.isArray(admissions) && admissions.length >= 2 && admissions.length <= 6 &&
    Array.isArray(settlements) && settlements.length === admissions.length &&
    new Set(admissions.map(row => row?.executionId)).size === admissions.length &&
    admissions.every((row, index) => present(row?.executionId) && present(row?.requestId) &&
      settlements[index]?.executionId === row.executionId &&
      settlements[index]?.stage === (index === admissions.length - 1 ? 'answer' : 'structured')) &&
    admissions.at(-1)?.requestId === requestId && empty(evidenceAudit?.sourceBindings) &&
    Array.isArray(evidenceAudit?.assessments) && evidenceAudit.assessments.every(row => empty(row?.excerpts)) &&
    Array.isArray(evidenceAudit?.compositions) && evidenceAudit.compositions.length === 1 &&
    Array.isArray(evidenceAudit.compositions[0]?.coverage) && evidenceAudit.compositions[0].coverage.every((row: { status: string; passages: unknown }) =>
      ['missing', 'inaccessible', 'uncertain'].includes(row?.status) && empty(row?.passages));
}

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
        verify: async (claim, result, abort, item) => {
          if (item.sources.length === 0 && !isNoEvidenceResult(result)) return false;
          if (item.sources.length > 0 && (result as { outcome?: string } | null)?.outcome === 'no-evidence') return false;
          return host.verifyRetainedCase(nativeClaim(claim), result, abort);
        } },
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
