import { createRequire } from 'node:module';
import type { CommandMap } from '../../../prototypes/integrated-backend/src/contracts.mts';
import { planningDigest } from '../../../prototypes/vela-core/src/codex-planning-adapter.mts';
import { validateNativeCieActivation, type NativeCieActivationScope } from './native-activation.mts';
import { readBlindInputs } from './blind-runner.mts';

type Preview = CommandMap['velaRequestPreview']['output'];
type Review = CommandMap['velaNativeReview']['output'];
type GrantInput = CommandMap['authorizeVelaRequest']['input'];
type Current = Parameters<typeof validateNativeCieActivation>[2];
const { validateReview } = createRequire(import.meta.url)(
  '../../../prototypes/visual-experience/cinematic-v3/native/vela-review.cjs',
) as { validateReview(preview: Preview, review: Review): Review };

/** This projection must come from the same native owner that reviewed the
 * exact preview. The check produces no grant and has no dispatch capability. */
export type NativeCieOwnerReview = {
  scope: NativeCieActivationScope;
  caseId: string;
  previewId: string;
  signature: string;
  reviewDigest: string;
  promptDigest: string;
};

type OwnerReviewInput = {
  bytes: Buffer;
  ownerReview: Readonly<NativeCieOwnerReview> | null;
  current: Current;
  caseId: string;
  preview: Preview;
  review: Review;
  ownerCurrent: () => boolean;
};

function checkedCase({ bytes, ownerReview, current, caseId, preview, review, ownerCurrent }: OwnerReviewInput) {
  if (!ownerReview || ownerCurrent() !== true) throw Error('blind_native_owner_review_unavailable');
  validateNativeCieActivation(bytes, ownerReview.scope, current);
  const frozen = readBlindInputs(bytes).find(item => item.id === caseId);
  if (ownerReview.caseId !== caseId || !ownerReview.scope.caseIds.includes(caseId) ||
      !frozen || preview.intent !== frozen.request ||
      ownerReview.previewId !== preview.id || ownerReview.signature !== preview.signature ||
      ownerReview.reviewDigest !== review.reviewDigest || ownerReview.promptDigest !== review.promptDigest ||
      preview.providerId !== ownerReview.scope.provider || preview.sendDisposition !== 'review-required' ||
      preview.semanticContext !== true || preview.route?.kind !== 'conversational' ||
      preview.route.model !== ownerReview.scope.model || preview.route.escalation ||
      preview.route.nativeLog || preview.route.nativeMetric || preview.workflowScope ||
      preview.handoff || preview.routingAgent || preview.projectEvidence || preview.workspaceState || preview.missionCheckpoint ||
      review.history || review.context?.discovered?.length ||
      !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= current.now)
    throw Error('blind_native_owner_review_scope_changed');
  return frozen;
}

export function checkNativeCieOwnerReview(input: OwnerReviewInput): Readonly<GrantInput> {
  const { preview, review, ownerCurrent } = input;
  const frozen = checkedCase(input);
  // The existing native review validator declines empty semantic context.
  // Until its owner can project exact no-evidence disclosure, leave this closed.
  if (!preview.resourceIds.length) throw Error('blind_native_empty_owner_review_unavailable');
  validateReview(preview, review);
  if (review.context.included.length !== frozen.sources.length || preview.resourceIds.length !== frozen.sources.length ||
      new Set(preview.resourceIds).size !== preview.resourceIds.length ||
      !review.context.included.every((source, index) => source.id === preview.resourceIds[index] &&
        source.title === frozen.sources[index].title && source.content === frozen.sources[index].text))
    throw Error('blind_native_owner_review_scope_changed');
  if (ownerCurrent() !== true) throw Error('blind_native_owner_review_unavailable');
  return Object.freeze({ previewId: preview.id, signature: preview.signature, reviewDigest: review.reviewDigest });
}

/** A source-free disclosure for the CIE owner to inspect. Its result cannot
 * be passed to authorizeVelaRequest and never enters the generic Send path. */
export function prepareSourceFreeCieOwnerReview(input: OwnerReviewInput) {
  const frozen = checkedCase(input);
  const { ownerReview, preview, review, ownerCurrent } = input;
  const prompt = JSON.stringify({ request: frozen.request, evidence: [] });
  const { reviewDigest, ...content } = review;
  const reviewKeys = new Set(['previewId', 'signature', 'providerId', 'prompt', 'promptDigest',
    'reviewDigest', 'context', 'semanticContext', 'route', 'historyOmissions', 'routingSettings']);
  const previewKeys = new Set(['id', 'intent', 'resourceIds', 'context', 'signature', 'scopeStamp',
    'providerId', 'expiresAt', 'semanticContext', 'nativeReviewRequired', 'sendDisposition', 'route', 'routingSettings']);
  const routeKeys = new Set(['kind', 'depth', 'reason', 'model', 'effort']);
  const contextKeys = new Set(['id', 'createdAt', 'policyVersion', 'discovered', 'included',
    'omitted', 'contentBytes', 'coverage', 'activeSurface']);
  const emptyContext = (context: Preview['context']) =>
    context && Object.keys(context).every(key => contextKeys.has(key)) &&
    [context.discovered, context.included, context.omitted].every(items => Array.isArray(items) && items.length === 0) &&
    context.contentBytes === 0 && context.coverage === 'explicit-resources-only' &&
    (context.activeSurface === undefined ||
      Object.keys(context.activeSurface).length === 2 && context.activeSurface.projectId === null &&
      context.activeSurface.workspaceId === null);
  if (frozen.sources.length !== 0 || !Array.isArray(preview.resourceIds) || preview.resourceIds.length !== 0 ||
      !Object.keys(preview).every(key => previewKeys.has(key)) ||
      !Object.keys(preview.route!).every(key => routeKeys.has(key)) ||
      !Object.keys(review).every(key => reviewKeys.has(key)) ||
      review.previewId !== preview.id || review.signature !== preview.signature || review.providerId !== preview.providerId ||
      review.semanticContext !== true || planningDigest(review.route) !== planningDigest(preview.route) ||
      (review.routingSettings !== undefined || preview.routingSettings !== undefined) &&
        planningDigest(review.routingSettings ?? null) !== planningDigest(preview.routingSettings ?? null) ||
      !emptyContext(preview.context) || !emptyContext(review.context) ||
      planningDigest(review.context) !== planningDigest(preview.context) ||
      !Array.isArray(review.historyOmissions) || review.historyOmissions.length !== 0 ||
      review.prompt !== prompt || review.promptDigest !== planningDigest(prompt) ||
      reviewDigest !== planningDigest(content))
    throw Error('blind_native_empty_owner_review_invalid');
  if (ownerCurrent() !== true) throw Error('blind_native_owner_review_unavailable');
  return Object.freeze({
    contract: 'aerynth.cie-source-free-disclosure@1' as const,
    caseId: frozen.id, prompt, promptDigest: review.promptDigest,
    scope: structuredClone(ownerReview!.scope), expiresAt: Math.min(ownerReview!.scope.expiresAt, Date.parse(preview.expiresAt)),
  });
}
