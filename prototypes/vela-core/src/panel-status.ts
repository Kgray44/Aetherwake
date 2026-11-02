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
  if (!request) return { requestState: 'idle', message: 'Ready. Plans are proposals until host receipts confirm application.' };
  const plan = state.plans.find(p => p.id === request.planId && p.requestId === request.id);
  const receipts = state.receipts.filter(r => r.requestId === request.id && r.planId === plan?.id);
  const appliedCount = receipts.filter(r => r.state === 'applied' && r.hostReceiptId).length;
  const priorEffects = appliedCount ? ' ' + appliedCount + ' earlier command outcome(s) were confirmed; inspect their receipts.' : '';
  const result = (message: string): VelaPanelStatus => ({ requestState: request.state, requestId: request.id, ...(plan ? { planState: plan.state } : {}), message });
  if (request.state === 'unknown' || plan?.state === 'unknown') return result('The request outcome is unknown. Inspect receipts before retrying.' + priorEffects);
  if (request.state === 'failed' || plan?.state === 'failed') return result('The request failed. Review recorded details and receipts before retrying.' + priorEffects);
  if (request.state === 'cancelled' || plan?.state === 'cancelled') return result('The request was cancelled. Inspect receipts for any earlier applied actions.' + priorEffects);
  if (request.state === 'invalid-plan') return result('The provider proposal was invalid and was not applied. Inspect the saved proposal.');
  if (request.state === 'provider-unavailable') {
    if (request.errorCode === 'provider_authorization_required') return result('Planning was not authorized for this request. Local actions remain available.');
    if (request.errorCode === 'provider_busy') return result('The planning provider is busy. This request did not start a planning turn. Local actions remain available.');
    return result('Planning is unavailable for this request. Local actions remain available.');
  }
  if (plan?.state === 'rejected') return result('The plan was rejected. Its proposed actions were not applied.');
  if (plan?.state === 'applying') return result('Applying the reviewed plan. Inspect receipts for confirmed command outcomes.' + priorEffects);
  if (request.state === 'completed' || plan?.state === 'applied') {
    const confirmed = plan?.state === 'applied' && plan.steps.length > 0 && plan.steps.every(step => receipts.some(r => r.stepId === step.id && r.state === 'applied' && r.hostReceiptId));
    if (!confirmed) return result('The plan is recorded complete, but complete host receipts are unavailable. Review the outcome before retrying.');
    return result('The plan was applied. Host receipts confirm the recorded command outcomes.' + (plan.steps.some(step => step.action.type === 'delegateTask') ? ' Delegated task completion remains unverified.' : ''));
  }
  if (plan?.state === 'approved') return result('The plan is approved and ready to apply. Its proposed actions have not run.');
  if (request.state === 'awaiting-review') return result('The plan is ready for review. Its proposed actions have not been applied.');
  if (request.state === 'native-ready') return result('The local action is ready for authorized application.');
  return result('The planning request is running' + (request.providerId ? ' with ' + request.providerId : '') + '. Proposed actions have not been applied.');
}
