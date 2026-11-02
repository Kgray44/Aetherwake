import { check, identifier, isRecord } from './capabilities.ts';
import type { AdaptationState, AppAttentionEvent, ExplicitPreference, PreferenceHypothesis, PreferenceKey, PreferenceScope, PreferenceValue } from './contracts.ts';

export const samePreferenceScope = (a: PreferenceScope, b: PreferenceScope) => a.kind === b.kind && a.id === b.id;
export const preferenceCategory = (key: PreferenceKey) => key === 'presentation.density' ? 'presentation' as const : 'organization' as const;
export function validatePreference(key: unknown, value: unknown, scope: unknown): asserts key is PreferenceKey {
  check(isRecord(scope) && Object.keys(scope).length === 2 && Object.hasOwn(scope, 'kind') && Object.hasOwn(scope, 'id') && ((scope.kind === 'global' && scope.id === null) || (scope.kind === 'workspace' && identifier(scope.id))), 'invalid_preference_scope');
  check((key === 'presentation.density' && ['comfortable', 'compact'].includes(String(value))) || (key === 'organization.defaultPreset' && ['balanced', 'focus', 'development', 'research'].includes(String(value))), 'unsupported_preference');
}
export function defaultAdaptation(now: string, available: boolean): AdaptationState {
  return { policy: { version: 1, enabled: false, updatedAt: now, categories: {
    presentation: { enabled: false, level: 'manual' }, organization: { enabled: false, level: 'manual' },
  } }, hypotheses: [], explicit: [], suppressions: [], receipts: [], applicationAvailable: available };
}
export function effectivePreference(data: AdaptationState, key: PreferenceKey, scope: PreferenceScope) {
  const explicit = data.explicit.find(p => p.active && p.key === key && samePreferenceScope(p.scope, scope));
  if (explicit) return { source: 'explicit' as const, value: explicit.value, recordId: explicit.id };
  if (scope.kind === 'workspace') {
    const global = data.explicit.find(p => p.active && p.key === key && p.scope.kind === 'global');
    if (global) return { source: 'explicit' as const, value: global.value, recordId: global.id };
  }
  const inferred = data.hypotheses.findLast(p => p.key === key && samePreferenceScope(p.scope, scope) && p.state === 'applied');
  return inferred ? { source: 'inferred' as const, value: inferred.value, recordId: inferred.id } : null;
}
/** Only explicitly recorded, user-origin application actions count. Model suggestions never become observations. */
export function observePreference(data: AdaptationState, input: {
  key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; event: AppAttentionEvent;
}, id: string): PreferenceHypothesis | null {
  validatePreference(input.key, input.value, input.scope);
  const category = data.policy.categories[preferenceCategory(input.key)];
  if (!data.policy.enabled || !category.enabled || category.level === 'manual') return null;
  const event = input.event;
  check(event.classification === 'observed' && event.actor === 'user', 'unobserved_preference_evidence');
  check(event.preferenceSignal?.key === input.key && event.preferenceSignal.value === input.value, 'preference_evidence_value_mismatch');
  check(event.type === (input.key === 'presentation.density' ? 'presentation.densitySelected' : 'workspace.presetSelected'), 'unrelated_preference_evidence');
  check(input.scope.kind === 'global' ? event.subject === null : event.subject?.kind === 'workspace' && event.subject.id === input.scope.id, 'preference_evidence_scope_mismatch');
  const prior = data.hypotheses.find(h => h.key === input.key && h.evidence.some(e => e.eventId === event.id));
  if (prior) { check(prior.value === input.value && samePreferenceScope(prior.scope, input.scope), 'preference_evidence_conflict'); return prior; }
  if (data.suppressions.some(s => s.key === input.key && s.value === input.value && samePreferenceScope(s.scope, input.scope))) return null;
  let hypothesis = data.hypotheses.find(h => h.key === input.key && h.value === input.value && samePreferenceScope(h.scope, input.scope) && h.state === 'suggested');
  if (!hypothesis) {
    hypothesis = { id, key: input.key, value: input.value, scope: structuredClone(input.scope), source: 'inferred', state: 'suggested',
      evidence: [], confidence: 'low', explanation: '', firstObservedAt: event.occurredAt, lastObservedAt: event.occurredAt };
    data.hypotheses.push(hypothesis);
  }
  hypothesis.evidence.push({ eventId: event.id, source: event.source, occurredAt: event.occurredAt,
    observedValue: input.value, subject: structuredClone(event.subject), classification: 'observed', actor: 'user' });
  hypothesis.lastObservedAt = event.occurredAt;
  const count = hypothesis.evidence.length;
  hypothesis.confidence = count >= 5 ? 'high' : count >= 3 ? 'medium' : 'low';
  hypothesis.explanation = count + ' distinct authorized user application action(s) selected this value in this scope. Confidence is a count-based heuristic, not a model probability. Inferred preferences do not override explicit choices.';
  return hypothesis;
}
export function setExplicitPreference(data: AdaptationState, input: {
  key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; expectedVersion: number;
}, id: string, now: string): ExplicitPreference {
  validatePreference(input.key, input.value, input.scope);
  const current = data.explicit.find(p => p.key === input.key && samePreferenceScope(p.scope, input.scope));
  check((current?.version ?? 0) === input.expectedVersion, 'stale_explicit_preference_version');
  if (current) { current.value = input.value; current.version++; current.active = true; current.updatedAt = now; return current; }
  const record: ExplicitPreference = { id, key: input.key, value: input.value, scope: structuredClone(input.scope), version: 1, source: 'explicit', active: true, updatedAt: now };
  data.explicit.push(record); return record;
}
