import { createHash } from 'node:crypto';
import type { BackendCore } from '../../../prototypes/integrated-backend/src/core.mts';
import type { NativeCieClaim, NativeCieEvaluationHost } from './native-batch.mts';
import { readBlindInputs, type BlindCheckpoint, type BlindPayload } from './blind-runner.mts';
import { canStartReviewedCieCase } from './native-budget.mts';

type CoreReadback = Pick<BackendCore,
  'readVelaEvaluationProfile' | 'readVelaEvaluationAdmissions' | 'readVelaEvaluationResult'>;
type Route = NativeCieEvaluationHost['route'];
type Catalog = { configurationVersion: number; digest: string; models: readonly string[] };
type Prediction = Extract<ReturnType<CoreReadback['readVelaEvaluationResult']>, { state: 'verified-answer' }> & {
  admissions: NonNullable<ReturnType<CoreReadback['readVelaEvaluationAdmissions']>>;
  provider: string;
  model: string;
  catalogDigest: string;
};

const hex = (value: string) => /^[a-f0-9]{64}$/u.test(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const payloadDigest = ({ id, request, sources }: Readonly<BlindPayload>) =>
  hash(JSON.stringify([id, request, sources.map(({ id, title, text }) => [id, title, text])]));

/** In-process synthetic host only. The owning adapter supplies the reviewed turn
 * and a read-only catalog projection; this module owns neither grading nor credentials. */
export function createDormantNativeCieHost({
  bytes, candidate, route: requestedRoute, profileId, configurationVersion, catalogDigest, core, readCatalog, runReviewed,
}: {
  bytes: Buffer;
  candidate: BlindCheckpoint['candidate'];
  route: Route;
  profileId: string;
  configurationVersion: number;
  catalogDigest: string;
  core: CoreReadback;
  readCatalog(): Promise<Catalog>;
  runReviewed(input: Readonly<BlindPayload>, signal: AbortSignal, claim: NativeCieClaim): Promise<void>;
}): NativeCieEvaluationHost {
  const { commit, tree } = candidate;
  if (![commit, tree].every(value => /^[a-f0-9]{40}$/u.test(value))) throw Error('candidate_identity');
  const route = Object.freeze({ provider: requestedRoute.provider, model: requestedRoute.model, transport: requestedRoute.transport });
  if (route.transport !== 'synthetic') throw Error('blind_native_live_activation_required');
  if (route.provider !== 'openai-api-vela' || !route.model.trim() || !hex(catalogDigest) ||
      !/^[a-f0-9-]{36}$/u.test(profileId) || !Number.isSafeInteger(configurationVersion) || configurationVersion < 1)
    throw Error('blind_native_host_binding_invalid');
  const corpusDigest = createHash('sha256').update(bytes).digest('hex');
  const cases = new Map(readBlindInputs(bytes).map(item => [item.id, payloadDigest(item)]));
  const bindings = new Set([...cases.keys()].map(bindingFor));
  const attempted = new Set<string>();
  function bindingFor(id: string) {
    return hash(JSON.stringify([corpusDigest, commit, tree, route, JSON.stringify([profileId, configurationVersion]), id]));
  }
  function readUsage() {
    const profile = core.readVelaEvaluationProfile();
    if (profile?.profileId !== profileId || profile.configurationVersion !== configurationVersion ||
        profile.usage.configurationVersion !== configurationVersion) throw Error('blind_native_profile_changed');
    return structuredClone(profile.usage);
  }
  function exactClaim(claim: NativeCieClaim) {
    return claim?.profileId === profileId && claim.configurationVersion === configurationVersion &&
      hex(claim.claimToken) && bindings.has(claim.bindingDigest);
  }
  async function requireCatalog(signal: AbortSignal) {
    signal.throwIfAborted();
    readUsage();
    const catalog = await readCatalog();
    signal.throwIfAborted();
    if (catalog.configurationVersion !== configurationVersion || catalog.digest !== catalogDigest ||
        !catalog.models.includes(route.model)) throw Error('blind_native_catalog_changed');
  }
  function reconcile(claim: NativeCieClaim): Prediction | null {
    readUsage();
    const admissions = core.readVelaEvaluationAdmissions(claim);
    if (!admissions?.length || admissions.length > 6 ||
        new Set(admissions.map(item => item.executionId)).size !== admissions.length) return null;
    const result = core.readVelaEvaluationResult(claim, admissions);
    if (result.state !== 'verified-answer' || result.receipts.length !== admissions.length ||
        result.requestId !== admissions.at(-1)?.requestId || hash(result.answer) !== result.answerDigest ||
        !result.receipts.every((row, index) => row.outcome === 'completed' &&
          row.requestId === admissions[index].requestId && row.executionId === admissions[index].executionId)) return null;
    return structuredClone({ ...result, admissions, provider: route.provider, model: route.model, catalogDigest });
  }
  return {
    profileId, configurationVersion, route,
    async readUsage() { return readUsage(); },
    async runReviewedCase(input, signal, claim) {
      signal.throwIfAborted();
      const frozen = structuredClone(input);
      if (!exactClaim(claim) || claim.bindingDigest !== bindingFor(frozen.id) ||
          cases.get(frozen.id) !== payloadDigest(frozen)) throw Error('blind_native_case_binding_invalid');
      if (attempted.has(claim.claimToken) || core.readVelaEvaluationAdmissions(claim) !== null)
        throw Error('blind_case_unreconciled');
      attempted.add(claim.claimToken);
      await requireCatalog(signal);
      if (!await canStartReviewedCieCase(async () => readUsage(), signal)) throw Error('blind_native_budget_unavailable');
      await runReviewed(frozen, signal, { ...claim });
      signal.throwIfAborted();
      const result = reconcile(claim);
      if (!result) throw Error('blind_case_unreconciled');
      return result;
    },
    async verifyRetainedCase(claim, retained, signal) {
      if (!exactClaim(claim)) return false;
      await requireCatalog(signal);
      const result = reconcile(claim);
      return result !== null && JSON.stringify(result) === JSON.stringify(retained);
    },
  };
}
