import type { VelaApiLedgerProfile } from '../../../prototypes/integrated-backend/src/vela-api-runtime.mts';
import { BLIND_INPUT_SHA256, readBlindInputs, type BlindCheckpoint } from './blind-runner.mts';

/** Projection of an exact owner review. Validation alone confers no authority. */
export interface NativeCieActivationScope {
  candidate: BlindCheckpoint['candidate'];
  inputSha256: string;
  profileId: string;
  configurationVersion: number;
  catalogDigest: string;
  provider: 'openai-api-vela';
  model: string;
  caseIds: readonly string[];
  maxCalls: number;
  expiresAt: number;
}

type NativeCiePreflight = {
  candidate: BlindCheckpoint['candidate'];
  profile: VelaApiLedgerProfile | null;
  catalog: { configurationVersion: number; digest: string; models: readonly string[] };
  now: number;
};

/** Pure refusal seam. The canonical host must still authorize and account for
 * every stage. No credential, transport, grant or persistence enters here. */
export function validateNativeCieActivation(
  bytes: Buffer, reviewed: Readonly<NativeCieActivationScope> | null, current: Readonly<NativeCiePreflight>,
) {
  if (!reviewed) throw Error('blind_native_live_activation_required');
  const cases = readBlindInputs(bytes);
  if (reviewed.inputSha256 !== BLIND_INPUT_SHA256 ||
      ![reviewed.candidate.commit, reviewed.candidate.tree].every(value => /^[a-f0-9]{40}$/u.test(value)) ||
      reviewed.candidate.commit !== current.candidate.commit || reviewed.candidate.tree !== current.candidate.tree ||
      !Number.isSafeInteger(current.now) || !Number.isSafeInteger(reviewed.expiresAt) || current.now >= reviewed.expiresAt)
    throw Error('blind_native_activation_scope_changed');
  const { profile, catalog } = current;
  if (!profile || !/^[a-f0-9-]{36}$/u.test(reviewed.profileId) || profile.profileId !== reviewed.profileId ||
      !Number.isSafeInteger(reviewed.configurationVersion) || reviewed.configurationVersion < 1 ||
      profile.configurationVersion !== reviewed.configurationVersion ||
      profile.usage.configurationVersion !== reviewed.configurationVersion || !profile.usage.enabled)
    throw Error('blind_native_profile_changed');
  if (reviewed.provider !== 'openai-api-vela' || !reviewed.model.trim() ||
      catalog.configurationVersion !== reviewed.configurationVersion ||
      !/^[a-f0-9]{64}$/u.test(reviewed.catalogDigest) || reviewed.catalogDigest !== catalog.digest ||
      !catalog.models.includes(reviewed.model))
    throw Error('blind_native_catalog_changed');
  const caseIds = new Set(reviewed.caseIds);
  const selected = cases.filter(item => caseIds.has(item.id));
  if (!selected.length || caseIds.size !== reviewed.caseIds.length ||
      selected.length !== caseIds.size || !selected.every((item, index) => item.id === reviewed.caseIds[index]))
    throw Error('blind_native_activation_cases_invalid');
  const requiredCalls = selected.reduce((sum, item) => sum + (item.sources.length ? 6 : 1), 0);
  const { requestsPerDay, usedToday } = profile.usage;
  if (!Number.isSafeInteger(reviewed.maxCalls) || reviewed.maxCalls !== requiredCalls ||
      !Number.isSafeInteger(requestsPerDay) || !Number.isSafeInteger(usedToday) ||
      requestsPerDay < 1 || usedToday < 0 || requestsPerDay - usedToday < requiredCalls)
    throw Error('blind_native_budget_unavailable');
  return Object.freeze({ requiredCalls, caseCount: selected.length });
}
