import type { PlanState, RequestState, VelaState } from './contracts.ts';

export interface VelaPanelStatus {
  requestState: RequestState | 'idle';
  requestId?: string;
  planState?: PlanState;
  message: string;
}

/** Read-only presentation of canonical state. A provider proposal is never an applied effect. */
export function velaPanelStatus(state: Pick<VelaState, 'requests' | 'plans' | 'receipts'>): VelaPanelStatus {
  const request = state.requests.at(-1);
  if (!request) return { requestState: 'idle', message: 'Ready when you are.' };
  const plan = state.plans.find(p => p.id === request.planId && p.requestId === request.id);
  const receipts = state.receipts.filter(r => r.requestId === request.id && r.planId === plan?.id);
  const appliedCount = receipts.filter(r => r.state === 'applied' && r.hostReceiptId).length;
  const priorEffects = appliedCount ? ' ' + appliedCount + (appliedCount === 1 ? ' earlier step was confirmed.' : ' earlier steps were confirmed.') + ' Review the details.' : '';
  const result = (message: string): VelaPanelStatus => ({ requestState: request.state, requestId: request.id, ...(plan ? { planState: plan.state } : {}), message });
  if (request.state === 'unknown' || plan?.state === 'unknown') return result('The outcome is unknown. Review the activity details before trying again.' + priorEffects);
  if (request.state === 'failed' || plan?.state === 'failed') return result('This request stopped. Review what happened before trying again.' + priorEffects);
  if (request.state === 'cancelled' || plan?.state === 'cancelled') return result('This request was cancelled. Review any earlier changes in the details.' + priorEffects);
  if (request.state === 'invalid-plan') return result('The provider response could not be used. No proposed changes were applied.');
  if (request.state === 'provider-unavailable') {
    if (request.errorCode === 'provider_authorization_required') return result('Planning was not enabled for this request. Local tools are still available.');
    if (request.errorCode === 'provider_busy') return result('The planning provider is busy. This request did not start a planning turn. Local actions remain available.');
    return result('Planning is unavailable for this request. Local tools are still available.');
  }
  if (request.state === 'responded') {
    if (request.planId || plan || state.receipts.some(receipt => receipt.requestId === request.id) || !request.response?.messageId) return result('The response record needs review. No applied result is confirmed.');
    return result(request.response.kind === 'clarification' ? 'A clarification is ready.' : request.response.kind === 'inability' ? 'The provider explained its limitation.' : 'A response is ready.');
  }
  if (plan?.state === 'rejected') return result('The plan was rejected. Its proposed actions were not applied.');
  if (plan?.state === 'applying') return result('Applying the changes you reviewed.' + priorEffects);
  if (request.state === 'completed' || plan?.state === 'applied') {
    const confirmed = plan?.state === 'applied' && plan.steps.length > 0 && plan.steps.every(step => receipts.some(r => r.stepId === step.id && r.state === 'applied' && r.hostReceiptId));
    if (!confirmed) return result('The plan is marked complete, but some results are missing. Review the details before trying again.');
    return result('The reviewed plan was applied.' + (plan.steps.some(step => step.action.type === 'delegateTask') ? ' Delegated task completion remains unverified.' : ''));
  }
  if (plan?.state === 'approved') return result('Approved and ready to apply. No changes have run yet.');
  if (request.state === 'awaiting-review') return result('The plan is ready for review. Its proposed actions have not been applied.');
  if (request.state === 'native-ready') return result('The local action is ready to apply.');
  return result('The planning request is running' + (request.providerId ? ' with ' + (request.providerId === 'codex-app-server' ? 'Codex' : request.providerId) : '') + '. Proposed actions have not been applied.');
}
