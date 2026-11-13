import { createRequire } from 'node:module';
import type { CommandMap } from '../../../prototypes/integrated-backend/src/contracts.mts';
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

export function checkNativeCieOwnerReview({
  bytes, ownerReview, current, caseId, preview, review, ownerCurrent,
}: {
  bytes: Buffer;
  ownerReview: Readonly<NativeCieOwnerReview> | null;
  current: Current;
  caseId: string;
  preview: Preview;
  review: Review;
  ownerCurrent: () => boolean;
}): Readonly<GrantInput> {
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
      review.history || review.context.discovered?.length ||
      !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= current.now)
    throw Error('blind_native_owner_review_scope_changed');
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
