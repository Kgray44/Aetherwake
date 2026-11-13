import { createHash } from 'node:crypto';
import type { BackendCore } from '../../../prototypes/integrated-backend/src/core.mts';
import { historyDigest } from '../../../prototypes/vela-core/src/bounded-history.mts';
import type { NativeCieClaim, NativeCieEvaluationHost } from './native-batch.mts';
import { readBlindInputs, type BlindCheckpoint, type BlindPayload } from './blind-runner.mts';
import { canStartReviewedCieCase } from './native-budget.mts';

type CoreReadback = Pick<BackendCore,
  'readVelaEvaluationProfile' | 'readVelaEvaluationAdmissions' | 'readVelaEvaluationResult'>;
type Route = NativeCieEvaluationHost['route'];
type Catalog = { configurationVersion: number; digest: string; models: readonly string[] };
type CanonicalAnswer = Extract<ReturnType<CoreReadback['readVelaEvaluationResult']>, { state: 'verified-answer' }>;
export type NativeCieReviewedPrediction = Pick<CanonicalAnswer, 'answer' | 'requestId' | 'messageId'> & {
  outcome?: 'no-evidence';
  calls: number;
  totalTokens: number | null;
  tokenSamples: number;
  requestedModel: string;
  transport: 'synthetic';
  admissions: NonNullable<ReturnType<CoreReadback['readVelaEvaluationAdmissions']>>;
  settlements: readonly {
    executionId: string;
    stage: 'structured' | 'answer';
    elapsedMs: number | null;
    usage: { totalTokens?: number } | null;
    reportedModel: string;
  }[];
  evidenceAudit: {
    outbound: readonly { inputDigest: string; stage: string; textSourceIds: readonly string[]; sourceSignals: readonly unknown[] }[];
    sourceBindings: readonly unknown[];
    assessments: readonly unknown[];
    compositions: readonly unknown[];
  };
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
  runReviewed(input: Readonly<BlindPayload>, signal: AbortSignal, claim: NativeCieClaim): Promise<NativeCieReviewedPrediction>;
}): NativeCieEvaluationHost {
  const { commit, tree } = candidate;
  if (![commit, tree].every(value => /^[a-f0-9]{40}$/u.test(value))) throw Error('candidate_identity');
  const route = Object.freeze({ provider: requestedRoute.provider, model: requestedRoute.model, transport: requestedRoute.transport });
  if (route.transport !== 'synthetic') throw Error('blind_native_live_activation_required');
  if (route.provider !== 'openai-api-vela' || !route.model.trim() || !hex(catalogDigest) ||
      !/^[a-f0-9-]{36}$/u.test(profileId) || !Number.isSafeInteger(configurationVersion) || configurationVersion < 1)
    throw Error('blind_native_host_binding_invalid');
  const corpusDigest = createHash('sha256').update(bytes).digest('hex');
  const cases = new Map(readBlindInputs(bytes).map(item => [item.id, item]));
  const bindings = new Map([...cases.values()].map(item => [bindingFor(item.id), item.sources.length === 0]));
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
  function reconciles(claim: NativeCieClaim, prediction: NativeCieReviewedPrediction): boolean {
    readUsage();
    const admissions = core.readVelaEvaluationAdmissions(claim);
    if (!admissions?.length || admissions.length > 6 ||
        new Set(admissions.map(item => item.executionId)).size !== admissions.length) return false;
    const result = core.readVelaEvaluationResult(claim, admissions);
    const audit = prediction?.evidenceAudit;
    if (result.state !== 'verified-answer' || result.receipts.length !== admissions.length ||
        result.requestId !== admissions.at(-1)?.requestId || historyDigest(result.answer) !== result.answerDigest ||
        prediction?.answer !== result.answer || prediction.requestId !== result.requestId || prediction.messageId !== result.messageId ||
        prediction.requestedModel !== route.model || prediction.transport !== route.transport || prediction.calls !== admissions.length ||
        !Array.isArray(prediction.admissions) || prediction.admissions.length !== admissions.length ||
        !Array.isArray(prediction.settlements) || prediction.settlements.length !== admissions.length ||
        !Array.isArray(audit?.outbound) || audit.outbound.length !== admissions.length ||
        !audit.outbound.every(item => item && hex(item.inputDigest) && Array.isArray(item.textSourceIds) && Array.isArray(item.sourceSignals)) ||
        !Array.isArray(audit.sourceBindings) || !Array.isArray(audit.assessments) || !Array.isArray(audit.compositions)) return false;
    const empty = bindings.get(claim.bindingDigest);
    if (empty ? prediction.outcome !== 'no-evidence' || admissions.length !== 1 || audit.outbound[0].stage !== 'other' || audit.sourceBindings.length ||
        audit.assessments.length || audit.compositions.length || audit.outbound[0].textSourceIds.length ||
        audit.outbound[0].sourceSignals.length : prediction.outcome === 'no-evidence') return false;
    const tokens = result.receipts.flatMap(row => row.totalTokens === null ? [] : [row.totalTokens]);
    return prediction.tokenSamples === tokens.length &&
      prediction.totalTokens === (tokens.length === admissions.length ? tokens.reduce((total, n) => total + n, 0) : null) &&
      result.receipts.every((row, index) => {
        const ref = admissions[index], observed = prediction.admissions[index], stage = prediction.settlements[index];
        return row.outcome === 'completed' && row.requestId === ref.requestId && row.executionId === ref.executionId &&
          observed?.requestId === ref.requestId && observed.executionId === ref.executionId &&
          stage?.executionId === row.executionId && stage.stage === (index === admissions.length - 1 ? 'answer' : 'structured') &&
          stage.reportedModel === route.model && stage.elapsedMs === row.elapsedMs &&
          (stage.usage?.totalTokens ?? null) === row.totalTokens;
      });
  }
  return {
    profileId, configurationVersion, route,
    async readUsage() { return readUsage(); },
    async runReviewedCase(input, signal, claim) {
      signal.throwIfAborted();
      const frozen = structuredClone(input);
      const original = cases.get(frozen.id);
      if (!exactClaim(claim) || claim.bindingDigest !== bindingFor(frozen.id) ||
          !original || payloadDigest(original) !== payloadDigest(frozen)) throw Error('blind_native_case_binding_invalid');
      if (attempted.has(claim.claimToken) || core.readVelaEvaluationAdmissions(claim) !== null)
        throw Error('blind_case_unreconciled');
      attempted.add(claim.claimToken);
      await requireCatalog(signal);
      if (!await canStartReviewedCieCase(async () => readUsage(), signal)) throw Error('blind_native_budget_unavailable');
      const prediction = structuredClone(await runReviewed(frozen, signal, { ...claim }));
      signal.throwIfAborted();
      if (!reconciles(claim, prediction)) throw Error('blind_case_unreconciled');
      return prediction;
    },
    async verifyRetainedCase(claim, retained, signal) {
      if (!exactClaim(claim)) return false;
      await requireCatalog(signal);
      return reconciles(claim, retained as NativeCieReviewedPrediction);
    },
  };
}
