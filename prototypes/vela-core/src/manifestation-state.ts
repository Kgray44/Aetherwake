import type { VelaMessage, VelaPlan, VelaRequest, VelaState } from './contracts.ts';

/** Presentation references only. Reopen by selecting a canonical ID and removing its dismissal. */
export interface VelaManifestationSelection {
  selectedRequestId: string | null;
  dismissedRequestIds: readonly string[];
  pinnedRequestIds: readonly string[];
}
export interface VelaManifestationState {
  kind: 'none' | 'whisper' | 'insight' | 'action';
  currentRequestId: string | null;
  currentMessageId: string | null;
  currentPlanId: string | null;
  historyResource: { resourceId: string; revision: number } | null;
  pinned: boolean;
  canDismiss: boolean;
  requiredPlanIds: readonly string[];
  selectionReason: 'none' | 'selected' | 'latest' | 'required-plan';
}
export type VelaManifestationSource = Readonly<Pick<VelaState, 'conversation' | 'requests' | 'plans' | 'receipts'>>;
const required = new Set<VelaPlan['state']>(['prepared', 'approved', 'applying', 'unknown']);
export const requiresVelaPlanAttention = (state: VelaPlan['state']): boolean => required.has(state);
const planStates = new Set<VelaPlan['state']>(['prepared', 'approved', 'rejected', 'applying', 'applied', 'failed', 'cancelled', 'unknown']);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Ambiguous duplicate IDs cannot manufacture an object selection. No body values are read. */
function unique<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const values = new Map<string, T>(), duplicates = new Set<string>();
  for (const item of items) {
    if (!id(item.id) || duplicates.has(item.id)) continue;
    if (values.has(item.id)) { values.delete(item.id); duplicates.add(item.id); } else values.set(item.id, item);
  }
  return values;
}
function responseMessage(request: VelaRequest, messages: Map<string, VelaMessage>): VelaMessage | null {
  if (request.state !== 'responded' || !request.response) return null;
  const message = messages.get(request.response.messageId);
  if (!message || message.role !== 'assistant' || message.requestId !== request.id || message.responseKind !== request.response.kind || message.planId !== undefined) return null;
  if (request.local) return request.providerId === null && request.local.schemaVersion === 1 && request.local.providerId === null && request.local.classification === 'observed' && message.source === 'vela-native' && message.classification === 'observed' && message.providerId === undefined && message.providerContribution === undefined ? message : null;
  if (request.route?.kind === 'project-check' && request.projectCheck?.kind === request.route.check && request.projectCheck.state !== 'running')
    return request.providerId === null && message.source === 'vela-native' && message.classification === 'observed' &&
      message.providerId === undefined && message.providerContribution === undefined ? message : null;
  const contribution = message.providerContribution;
  return id(request.providerId) && message.source === 'provider' && message.classification === 'reported' && message.providerId === request.providerId && contribution?.classification === 'reported' && contribution.providerId === request.providerId ? message : null;
}
function planMessage(request: VelaRequest, plan: VelaPlan, messages: readonly VelaMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]; if (message.role !== 'assistant' || message.requestId !== request.id || message.planId !== plan.id) continue;
    if (message.source === 'vela-native' && message.classification === 'observed' && message.providerContribution === undefined) return message.id;
    if (message.source === 'provider' && message.classification === 'reported' && plan.contribution?.classification === 'reported' && request.providerId === plan.contribution.providerId && message.providerId === plan.contribution.providerId && message.providerContribution?.providerId === plan.contribution.providerId && message.providerContribution.classification === 'reported') return message.id;
  }
  return null;
}
/** A compact success requires the complete host result, never a provider's completion claim. */
export function confirmedVelaPlan(state: VelaManifestationSource, request: VelaRequest, plan: VelaPlan): boolean {
  return request.state === 'completed' && request.planId === plan.id && plan.requestId === request.id &&
    plan.state === 'applied' && plan.steps.length > 0 && new Set(plan.steps.map(step => step.id)).size === plan.steps.length &&
    plan.steps.every(step => step.action.type !== 'delegateTask' && state.receipts.some(receipt =>
      receipt.requestId === request.id && receipt.planId === plan.id && receipt.stepId === step.id &&
      receipt.state === 'applied' && id(receipt.hostReceiptId)));
}
/** Pure current-field projection. Canonical supplied state remains the authority; this grants no access or action approval. */
export function projectVelaManifestation(state: VelaManifestationSource | null, selection: VelaManifestationSelection = { selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] }): VelaManifestationState {
  const conversation = state?.conversation;
  const historyResource = conversation && id(conversation.resourceId) && Number.isSafeInteger(conversation.revision) && conversation.revision >= 1 ? { resourceId: conversation.resourceId, revision: conversation.revision } : null;
  const empty = (): VelaManifestationState => ({ kind: 'none', currentRequestId: null, currentMessageId: null, currentPlanId: null, historyResource, pinned: false, canDismiss: false, requiredPlanIds: [], selectionReason: 'none' });
  if (!state || !conversation || !historyResource) return empty();
  const requests = unique(state.requests.filter(request => request.conversationId === historyResource.resourceId)), messages = unique(conversation.messages);
  const plans = unique(state.plans.filter(plan => requests.get(plan.requestId)?.planId === plan.id && planStates.has(plan.state) && plan.steps.length > 0));
  const ordered = [...requests.values()], requiredRequests = ordered.filter(request => { const plan = plans.get(request.planId ?? ''); return plan && requiresVelaPlanAttention(plan.state); });
  const requiredPlanIds = requiredRequests.map(request => request.planId!);
  const selected = selection.selectedRequestId === null ? undefined : requests.get(selection.selectedRequestId);
  const latestRequest = ordered.at(-1), latestMessage = conversation.messages.at(-1);
  if (!requiredPlanIds.length && !selected &&
    (!latestRequest || !['checking', 'planning', 'awaiting-review', 'native-ready'].includes(latestRequest.state)) &&
    latestMessage?.missionReport && messages.get(latestMessage.id) === latestMessage &&
    latestMessage.role === 'assistant' && latestMessage.source === 'vela-native' &&
    latestMessage.classification === 'observed' && latestMessage.responseKind === 'answer' &&
    latestMessage.requestId === undefined && latestMessage.planId === undefined &&
    latestMessage.providerId === undefined && latestMessage.providerContribution === undefined) {
    return { ...empty(), kind: 'insight', currentMessageId: latestMessage.id, selectionReason: 'latest' };
  }
  const request = requiredRequests.at(-1) ?? selected ?? ordered.at(-1); if (!request) return empty();
  const mustRemain = requiredRequests.includes(request);
  if (!mustRemain && selection.dismissedRequestIds.includes(request.id)) return empty();
  const plan = plans.get(request.planId ?? ''), hasReceipts = state.receipts.some(receipt => receipt.requestId === request.id);
  const message = !plan && !hasReceipts ? responseMessage(request, messages) : null;
  const completedMessage = plan && confirmedVelaPlan(state, request, plan)
    ? conversation.messages.findLast(value => messages.get(value.id) === value && value.role === 'assistant' &&
      value.requestId === request.id && value.planId === plan.id && value.source === 'vela-native' &&
      value.classification === 'observed' && value.providerId === undefined && value.providerContribution === undefined) : undefined;
  return {
    kind: plan && !completedMessage ? 'action' : request.local && message ? 'whisper' : 'insight',
    currentRequestId: request.id,
    currentMessageId: completedMessage?.id ?? (plan ? planMessage(request, plan, conversation.messages.filter(value => messages.has(value.id))) : message?.id ?? null),
    currentPlanId: plan?.id ?? null,
    historyResource, pinned: selection.pinnedRequestIds.includes(request.id), canDismiss: !mustRemain, requiredPlanIds,
    selectionReason: mustRemain ? 'required-plan' : selected ? 'selected' : 'latest',
  };
}
