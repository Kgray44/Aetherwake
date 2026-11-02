import type { ResourceRef, VelaClient, VelaNativeAction, VelaState } from './contracts.ts';

export interface VelaPanelOptions {
  onOpenSubject?: (subject: { id: string; kind: ResourceRef['kind'] }) => void;
}
/** Mounts into the host's existing Vela dialog. No inference or native actions occur on mount/open. */
export function mountVelaPanel(root: HTMLElement, client: VelaClient, options: VelaPanelOptions = {}) {
  const doc = root.ownerDocument;
  let current: VelaState | null = null, disposed = false, busy = false;
  const selected = new Map<string, ResourceRef>();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, content?: string) => {
    const node = doc.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node;
  };
  const button = (label: string, action: () => unknown) => {
    const b = el('button', 'vela-core-button', label); b.type = 'button'; b.addEventListener('click', () => void run(action)); return b;
  };
  const label = (name: string, control: HTMLElement) => { const l = el('label', 'vela-core-field'); l.append(el('span', undefined, name), control); return l; };
  const shell = el('section', 'vela-core'); shell.setAttribute('aria-label', 'Vela application assistant');
  const header = el('header', 'vela-core-header');
  header.append(el('h2', undefined, 'Vela'), el('p', undefined, 'Your application assistant · native actions, scoped context, and reviewed plans'));
  const provider = el('p', 'vela-core-provider');
  const status = el('p', 'vela-core-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const conversation = el('div', 'vela-core-conversation'); conversation.setAttribute('aria-label', 'Vela conversation');
  const searchForm = el('form', 'vela-core-search');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Find notes, chats, tasks, workspaces'; search.maxLength = 200;
  const searchButton = el('button', 'vela-core-button', 'Search'); searchButton.type = 'submit';
  const searchResults = el('div', 'vela-core-results');
  const selection = el('p', 'vela-core-selection', 'No content selected. Search discovers metadata locally.');
  searchForm.append(label('Search application resources', search), searchButton);
  searchForm.addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    const results = await client.search(search.value); if (disposed) return;
    searchResults.replaceChildren();
    if (!results.length) searchResults.append(el('p', undefined, 'No authorized matches.'));
    for (const ref of results) {
      const row = el('div', 'vela-core-result');
      if (ref.kind === 'resource') {
        const include = el('input'); include.type = 'checkbox'; include.checked = selected.has(ref.id);
        include.addEventListener('change', () => { if (include.checked) selected.set(ref.id, ref); else selected.delete(ref.id); renderSelection(); });
        row.append(label(ref.title + ' · ' + (ref.resourceKind ?? ref.kind) + ' · v' + ref.version, include));
      } else row.append(el('span', undefined, ref.title + ' · ' + ref.kind + ' · v' + ref.version));
      if (options.onOpenSubject) row.append(button('Open', () => options.onOpenSubject?.(ref)));
      searchResults.append(row);
    }
  }); });
  const form = el('form', 'vela-core-compose');
  const intent = el('textarea'); intent.rows = 3; intent.maxLength = 16000; intent.placeholder = 'What would you like to do?'; intent.required = true;
  const allowProvider = el('input'); allowProvider.type = 'checkbox';
  const disclosure = label('Allow this request and selected content to be sent to the identified planning provider', allowProvider);
  const send = el('button', 'vela-core-button vela-core-primary', 'Prepare plan'); send.type = 'submit';
  const stop = button('Stop planning', async () => {
    const state = await client.state(); const pending = state.requests.findLast(r => r.state === 'planning');
    if (pending) { await client.cancel(pending.id); status.textContent = 'Cancellation requested. No proposed actions will be applied.'; await refresh(); }
    else status.textContent = 'No planning request is currently running.';
  });
  form.append(label('Ask Vela', intent), disclosure, send, stop);
  form.addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    if (busy) return; busy = true; send.disabled = true; status.textContent = 'Waiting for the identified planning provider. Native actions have not run.';
    try { const request = await client.request({ intent: intent.value, resourceIds: [...selected.keys()], authorizeProvider: allowProvider.checked }); intent.value = ''; allowProvider.checked = false; busy = false; await refresh(); status.textContent = 'Request: ' + request.state + (request.errorCode ? ' · ' + request.errorCode : '') + '. Proposed actions require review.'; }
    finally { busy = false; send.disabled = false; }
  }); });
  const native = el('details', 'vela-core-tools'); native.append(el('summary', undefined, 'Local actions · available without a model'));
  const nativeTitle = el('input'); nativeTitle.maxLength = 200; nativeTitle.placeholder = 'New resource or workspace title';
  native.append(label('Title', nativeTitle));
  const act = async (action: VelaNativeAction, description: string) => {
    const plan = await client.native({ action, intent: description }); await client.apply(plan.id); await refresh();
  };
  native.append(button('Create note', () => act({ type: 'createResource', kind: 'note', title: nativeTitle.value.trim() || 'New note', workspaceId: null }, 'Create a new local note')),
    button('Create task', () => act({ type: 'createResource', kind: 'task', title: nativeTitle.value.trim() || 'New task', workspaceId: null }, 'Create a new local task')),
    button('Create workspace with selected resources', () => act({ type: 'workspaceFromResources', title: nativeTitle.value.trim() || 'New workspace', projectId: null, resourceIds: [...selected.keys()] }, 'Create a workspace containing the explicitly selected existing resources')));
  const plans = el('section', 'vela-core-plans'); plans.setAttribute('aria-label', 'Plan review and receipts');
  const contextDetails = el('details', 'vela-core-context'); contextDetails.append(el('summary', undefined, 'Inspect request context and provenance'));
  const contextBody = el('div'); contextDetails.append(contextBody);
  const settings = el('details', 'vela-core-settings'); settings.append(el('summary', undefined, 'Attention and permissions'));
  const mode = el('select'); for (const value of ['normal', 'quiet', 'focused', 'collaborative', 'proactive']) { const option = el('option', undefined, value); option.value = value; mode.append(option); }
  const monitor = el('input'); monitor.type = 'checkbox';
  const delegation = el('input'); delegation.type = 'checkbox';
  const eventTypes = el('input'); eventTypes.placeholder = 'task.completed, approval.required';
  const severity = el('select'); for (const value of ['info', 'warning', 'critical']) { const option = el('option', undefined, value); option.value = value; severity.append(option); }
  const budget = el('input'); budget.type = 'number'; budget.min = '0'; budget.max = '60';
  settings.append(label('Attention mode', mode), label('Collect authorized application events', monitor), label('Allow separately authorized task delegation', delegation),
    label('Allowed event types (comma separated)', eventTypes), label('Minimum interruption severity', severity), label('Maximum interruptions per hour', budget),
    el('p', undefined, 'Only authorized application events are considered. Quiet permits silence. Opening Vela does not mark events reviewed. External monitoring is unavailable. Adaptive preferences have separate controls.'),
    button('Save preferences', async () => {
      if (!current) return;
      await client.preferences({ expectedVersion: current.preferences.version, patch: {
        mode: mode.value as VelaState['preferences']['mode'], monitoringEnabled: monitor.checked, delegationEnabled: delegation.checked,
        allowedEventTypes: eventTypes.value.split(',').map(s => s.trim()).filter(Boolean),
        minimumSeverity: severity.value as VelaState['preferences']['minimumSeverity'], maxInterruptionsPerHour: Number(budget.value),
      } }); await refresh();
    }));
  const attention = el('section', 'vela-core-attention'); attention.setAttribute('aria-label', 'Unreviewed application events');
  const adaptation = el('details', 'vela-core-adaptation'); adaptation.append(el('summary', undefined, 'Adaptive preferences · inspect, override, reject, or reset'));
  const adaptationBody = el('div'); adaptation.append(adaptationBody);
  shell.append(header, provider, status, conversation, searchForm, searchResults, selection, form, native, plans, contextDetails, settings, adaptation, attention);
  root.append(shell);
  function renderSelection() {
    selection.textContent = selected.size ? selected.size + ' resource(s) selected for explicit content retrieval: ' + [...selected.values()].map(r => r.title).join(', ') : 'No content selected. Search discovers metadata locally.';
  }
  async function run(action: () => unknown) {
    if (disposed) return;
    try { await action(); }
    catch (e) { if (!disposed) status.textContent = 'Vela could not complete that action: ' + (e instanceof Error ? e.message : 'unavailable'); }
  }
  function render(state: VelaState) {
    if (disposed) return; current = state;
    provider.textContent = state.planner.available ? 'Planning provider: ' + state.planner.providerId + (state.planner.busy ? ' · busy' : ' · available') : 'Planning unavailable · local actions are available';
    conversation.replaceChildren();
    for (const message of state.conversation?.messages.slice(-80) ?? []) {
      const entry = el('article', 'vela-core-message');
      entry.append(el('strong', undefined, message.source === 'provider' ? 'Provider contribution · ' + message.providerId : message.role === 'user' ? 'You' : 'Vela · native application service'), el('p', undefined, message.content)); conversation.append(entry);
    }
    plans.replaceChildren();
    for (const plan of state.plans.slice(-8).reverse()) {
      const card = el('article', 'vela-core-plan');
      card.append(el('h3', undefined, (plan.contribution ? 'Provider proposal' : 'Native command') + ' · ' + plan.state), el('p', undefined, plan.summary));
      const steps = el('ol'); for (const step of plan.steps) { const li = el('li'); li.append(el('p', undefined, step.explanation), el('pre', undefined, JSON.stringify(step.action, null, 2))); steps.append(li); } card.append(steps);
      card.append(el('p', undefined, 'Targets: ' + (plan.targets.map(t => t.title + ' v' + t.version).join(', ') || 'New local objects only')));
      if (plan.state === 'prepared') card.append(button('Approve and apply reviewed plan', async () => { await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' }); await client.apply(plan.id); await refresh(); }), button('Reject', async () => { await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'reject' }); await refresh(); }));
      if (plan.state === 'approved') card.append(button('Apply approved plan', async () => { await client.apply(plan.id); await refresh(); }));
      const receipts = state.receipts.filter(r => r.planId === plan.id);
      for (const receipt of receipts) card.append(el('p', 'vela-core-receipt', receipt.stepId + ' · ' + receipt.state + ' · host receipt ' + (receipt.hostReceiptId ?? 'pending') + (receipt.errorCode ? ' · ' + receipt.errorCode : '')));
      plans.append(card);
    }
    contextBody.replaceChildren();
    for (const request of state.requests.slice(-6).reverse()) {
      const block = el('article'); block.append(el('h3', undefined, request.state + (request.errorCode ? ' · ' + request.errorCode : '')),
        el('p', undefined, 'Content included: ' + (request.context.included.map(r => r.title + ' v' + r.version).join(', ') || 'none') + '. Exact UTF-8 bytes: ' + request.context.contentBytes + '. Metadata discovered: ' + request.context.discovered.length + '.'),
        el('p', undefined, 'Context coverage: explicit resources only. Source content is untrusted data.'));
      const inspect = el('details'); inspect.append(el('summary', undefined, 'Inspect stored manifest and invalid proposal'), el('pre', undefined, JSON.stringify({ manifest: request.context, invalidProposal: request.invalidProposal }, null, 2))); block.append(inspect); contextBody.append(block);
    }
    mode.value = state.preferences.mode; monitor.checked = state.preferences.monitoringEnabled; delegation.checked = state.preferences.delegationEnabled;
    eventTypes.value = state.preferences.allowedEventTypes.join(', '); severity.value = state.preferences.minimumSeverity; budget.value = String(state.preferences.maxInterruptionsPerHour);
    renderAdaptation(state);
    attention.replaceChildren(el('h3', undefined, 'Unreviewed application events'));
    const pending = state.attention.filter(item => !item.reviewedAt && !item.dismissedAt);
    if (!pending.length) attention.append(el('p', undefined, 'No unreviewed events in recorded coverage.'));
    for (const item of pending.slice(-20).reverse()) {
      const row = el('article'); row.append(el('p', undefined, item.summary), el('p', undefined, item.classification + ' · ' + item.source + ' · ' + item.occurredAt + ' · ' + item.disposition + ' · ' + item.reason));
      if (item.coverageGap) row.append(el('p', undefined, 'Coverage gap: ' + item.coverageGap));
      if (item.subject && options.onOpenSubject) row.append(button('Open source', () => options.onOpenSubject?.(item.subject!)));
      row.append(button('Mark reviewed', async () => { await client.reviewAttention([item.id]); await refresh(); })); attention.append(row);
    }
    if (!busy) status.textContent = 'Ready. Plans are proposals until host receipts confirm application.';
  }
  function renderAdaptation(state: VelaState) {
    adaptationBody.replaceChildren();
    const data = state.adaptation;
    if (!data) { adaptationBody.append(el('p', undefined, 'Adaptive preference storage is not available in this host version.')); return; }
    adaptationBody.append(el('p', undefined, 'Learning is ' + (data.policy.enabled ? 'enabled for the categories below' : 'disabled') + '. Inferences remain distinct from your explicit choices. Only recorded user application actions can be evidence. No sensors, provider guesses, or privilege settings are learned.'));
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = data.policy.enabled;
    adaptationBody.append(label('Enable preference inference', enabled));
    const categories = {} as Record<'presentation' | 'organization', { enabled: HTMLInputElement; level: HTMLSelectElement }>;
    for (const category of ['presentation', 'organization'] as const) {
      const allow = el('input'); allow.type = 'checkbox'; allow.checked = data.policy.categories[category].enabled;
      const level = el('select'); for (const value of ['manual', 'suggestive', 'assisted', 'adaptive']) { const option = el('option', undefined, value); option.value = value; level.append(option); } level.value = data.policy.categories[category].level;
      categories[category] = { enabled: allow, level };
      adaptationBody.append(label('Learn ' + category + ' preferences', allow), label(category + ' level', level));
    }
    adaptationBody.append(el('p', undefined, 'Manual records explicit choices only. Suggestive prepares hypotheses. Assisted applies only after your acceptance. Adaptive may apply supported low-risk changes after three distinct observed actions and host authorization; explicit choices always take precedence.'));
    if (client.adaptationPolicy) adaptationBody.append(button('Save learning policy', async () => {
      await client.adaptationPolicy!({ expectedVersion: data.policy.version, enabled: enabled.checked, categories: {
        presentation: { enabled: categories.presentation.enabled.checked, level: categories.presentation.level.value as typeof data.policy.categories.presentation.level },
        organization: { enabled: categories.organization.enabled.checked, level: categories.organization.level.value as typeof data.policy.categories.organization.level },
      } }); await refresh();
    }));
    adaptationBody.append(el('p', undefined, data.applicationAvailable ? 'Canonical preference application is available.' : 'This host can store and review preferences; applying them to the application is unavailable.'));
    const explicitSection = el('details'); explicitSection.append(el('summary', undefined, 'Set an explicit override'));
    const key = el('select'); for (const value of ['presentation.density', 'organization.defaultPreset']) { const option = el('option', undefined, value); option.value = value; key.append(option); }
    const value = el('select');
    const values = () => { value.replaceChildren(); for (const v of key.value === 'presentation.density' ? ['comfortable', 'compact'] : ['balanced', 'focus', 'development', 'research']) { const option = el('option', undefined, v); option.value = v; value.append(option); } }; key.addEventListener('change', values); values();
    const scopeSelect = el('select'); const globalOption = el('option', undefined, 'Global'); globalOption.value = ''; scopeSelect.append(globalOption);
    const workspaceRefs = new Map<string, string>();
    for (const plan of state.plans) for (const target of plan.targets) if (target.kind === 'workspace') workspaceRefs.set(target.id, target.title);
    for (const preference of [...data.hypotheses, ...data.explicit]) if (preference.scope.kind === 'workspace') workspaceRefs.set(preference.scope.id!, workspaceRefs.get(preference.scope.id!) ?? preference.scope.id!);
    for (const [id, title] of workspaceRefs) { const option = el('option', undefined, title); option.value = id; scopeSelect.append(option); }
    const apply = el('input'); apply.type = 'checkbox'; apply.disabled = !data.applicationAvailable;
    explicitSection.append(label('Preference', key), label('Value', value), label('Scope', scopeSelect), label('Apply through the canonical application command port', apply));
    if (client.explicitPreference) explicitSection.append(button('Save explicit choice', async () => {
      const scope = scopeSelect.value ? { kind: 'workspace' as const, id: scopeSelect.value } : { kind: 'global' as const, id: null };
      const previous = data.explicit.find(p => p.key === key.value && p.scope.kind === scope.kind && p.scope.id === scope.id);
      await client.explicitPreference!({ key: key.value as 'presentation.density' | 'organization.defaultPreset', value: value.value as 'comfortable' | 'compact' | 'balanced' | 'focus' | 'development' | 'research', scope, expectedVersion: previous?.version ?? 0, apply: apply.checked }); await refresh();
    }));
    adaptationBody.append(explicitSection);
    for (const preference of data.explicit.filter(p => p.active)) adaptationBody.append(el('p', undefined, 'Explicit · ' + preference.key + ' = ' + preference.value + ' · ' + (preference.scope.id ?? 'global') + ' · v' + preference.version));
    for (const hypothesis of data.hypotheses.slice(-12).reverse()) {
      const card = el('article', 'vela-core-plan'); card.append(el('h3', undefined, 'Inferred · ' + hypothesis.key + ' = ' + hypothesis.value + ' · ' + hypothesis.state),
        el('p', undefined, hypothesis.explanation), el('p', undefined, 'Scope: ' + (hypothesis.scope.id ?? 'global') + ' · confidence heuristic: ' + hypothesis.confidence));
      const evidence = el('details'); evidence.append(el('summary', undefined, 'Inspect source app-event evidence'), el('pre', undefined, JSON.stringify(hypothesis.evidence, null, 2))); card.append(evidence);
      if (hypothesis.errorCode) card.append(el('p', undefined, 'Application status: ' + hypothesis.errorCode));
      if (hypothesis.state === 'suggested' && client.reviewPreference) {
        card.append(button('Accept as explicit choice', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'accept', apply: false }); await refresh(); }));
        if (data.applicationAvailable) card.append(button('Accept and apply', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'accept', apply: true }); await refresh(); }));
        card.append(button('Reject', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'reject', apply: false }); await refresh(); }), button('Suppress this suggestion', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'suppress', apply: false }); await refresh(); }));
      }
      if (client.resetPreferences) card.append(button('Reset preferences in this scope', async () => { await client.resetPreferences!({ scope: hypothesis.scope, clearSuppressions: true }); await refresh(); }));
      adaptationBody.append(card);
    }
    for (const receipt of data.receipts.slice(-6)) adaptationBody.append(el('p', undefined, 'Preference command · ' + receipt.key + ' · ' + receipt.state + ' · ' + (receipt.hostReceiptId ?? 'pending')));
    adaptationBody.append(el('p', undefined, 'Reset disables saved overrides and supersedes hypotheses in the chosen scope; it preserves evidence and does not claim to undo a prior application effect. Use an explicit opposite setting to change the application again.'));
  }
  async function refresh() { const state = await client.state(); render(state); return state; }
  void run(refresh);
  return {
    async open() { const state = await client.open(); render(state); return state; },
    refresh,
    dispose() { disposed = true; shell.remove(); },
  };
}
