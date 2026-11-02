import type { ResourceRef, VelaClient, VelaNativeAction, VelaState, VelaPlan, PlanStep } from './contracts.ts';
import { velaPanelStatus } from './panel-status.ts';

export interface VelaPanelOptions {
  onOpenSubject?: (subject: { id: string; kind: ResourceRef['kind'] }) => void;
  /** Explicit user action only; the host checks its actual planning connection. */
  onConnectProvider?: () => Promise<unknown>;
}
const providerName = (id: string | null | undefined) => id === 'codex-app-server' ? 'Codex' : id || 'Planning provider';
/** Content for the existing host-anchored surface. Mount/open never starts inference or applies actions. */
export function mountVelaPanel(root: HTMLElement, client: VelaClient, options: VelaPanelOptions = {}) {
  const doc = root.ownerDocument;
  let current: VelaState | null = null, disposed = false, busy = false, nativeBusy = false, composing = false, draftRevision = 0, lastDisclosure: HTMLDetailsElement | null = null;
  const selected = new Map<string, ResourceRef>(), sourceControls = new Map<string, HTMLInputElement>();
  const messages = new Map<string, { node: HTMLElement; signature: string }>(), workingPlans = new Set<string>();
  const planCards = new Map<string, { node: HTMLElement; controls: HTMLElement; signature: string }>();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  };
  const button = (text: string, action: () => unknown) => { const node = el('button', 'vela-core-button', text); node.type = 'button'; node.addEventListener('click', () => { if (!node.disabled) void run(action); }); return node; };
  const label = (text: string, control: HTMLElement) => { const node = el('label', 'vela-core-field'); node.append(el('span', undefined, text), control); return node; };
  const disclosure = (text: string, className: string) => { const node = el('details', className), summary = el('summary', undefined, text), body = el('div', 'vela-core-disclosure-body'); node.append(summary, body); node.addEventListener('toggle', () => { if (node.open) lastDisclosure = node; }); return { node, summary, body }; };
  const shell = el('section', 'vela-core'); shell.setAttribute('aria-label', 'Vela application assistant');
  const header = el('header', 'vela-core-header'); header.append(el('h2', undefined, 'Vela'), el('p', undefined, 'Find, create, and plan.'));
  const connection = disclosure('Planning connection', 'vela-core-provider-controls'), provider = el('span', 'vela-core-provider'), providerHint = el('p', 'vela-core-secondary');
  connection.summary.replaceChildren(provider); connection.body.append(providerHint);
  if (options.onConnectProvider) {
    const connect = button('Check planning connection', async () => { if (connect.disabled) return; connect.disabled = true; try { await options.onConnectProvider!(); await refresh(); } finally { connect.disabled = false; } }); connection.body.append(connect);
  }
  header.append(connection.node);
  const flow = el('div', 'vela-core-scroll'); flow.setAttribute('aria-label', 'Conversation and plans');
  const conversation = el('div', 'vela-core-conversation'); conversation.setAttribute('aria-label', 'Vela conversation');
  const plans = el('section', 'vela-core-plans'); plans.setAttribute('aria-label', 'Plans to review');
  const planHistory = disclosure('Earlier plans', 'vela-core-plan-history');
  const more = disclosure('Tools and preferences', 'vela-core-more');
  const sourcePanel = disclosure('Find and add sources', 'vela-core-source-panel');
  const searchForm = el('form', 'vela-core-search'), search = el('input'), searchButton = el('button', 'vela-core-button', 'Search');
  search.type = 'search'; search.placeholder = 'Find a note, chat, task, or workspace'; search.maxLength = 200; search.setAttribute('aria-label', 'Search your work'); searchButton.type = 'submit';
  const searchResults = el('div', 'vela-core-results'); searchResults.setAttribute('aria-live', 'polite'); searchForm.append(search, searchButton);
  sourcePanel.body.append(el('p', 'vela-core-secondary', 'Search stays in the app. Choose sources to include in a plan; you will review what is shared.'), searchForm, searchResults);
  searchForm.addEventListener('submit', event => { event.preventDefault(); void run(async () => {
    searchButton.disabled = true;
    try { const results = await client.search(search.value); if (disposed) return; sourceControls.clear(); searchResults.replaceChildren();
      if (!results.length) searchResults.append(el('p', 'vela-core-secondary', 'No matching items are available in this view.'));
      for (const ref of results) { const row = el('div', 'vela-core-result');
        if (ref.kind === 'resource') { const include = el('input'); include.type = 'checkbox'; include.checked = selected.has(ref.id); sourceControls.set(ref.id, include); include.addEventListener('change', () => { if (include.checked) selected.set(ref.id, ref); else selected.delete(ref.id); renderSelection(); }); row.append(label(ref.title, include), el('span', 'vela-core-meta', ref.resourceKind || 'Item')); }
        else row.append(el('span', undefined, ref.title), el('span', 'vela-core-meta', ref.kind));
        if (options.onOpenSubject) row.append(button('Open', () => options.onOpenSubject?.(ref))); searchResults.append(row);
      }
    } finally { searchButton.disabled = false; }
  }); });
  const native = disclosure('Create locally', 'vela-core-tools'), nativeTitle = el('input'), nativeProject = el('select'); let projectChosen = false;
  nativeTitle.maxLength = 200; nativeTitle.placeholder = 'Give it a name'; nativeProject.setAttribute('aria-label', 'New workspace project'); nativeProject.addEventListener('change', () => { projectChosen = true; updateWorkspaceAvailability(); });
  const nativeAvailability = el('p', 'vela-core-availability');
  const act = async (action: VelaNativeAction, intent: string) => { if (nativeBusy) return; nativeBusy = true; updateWorkspaceAvailability(); try { const plan = await client.native({ action, intent }); await client.apply(plan.id); await refresh(); } finally { nativeBusy = false; updateWorkspaceAvailability(); } };
  const createNote = button('Create note', () => act({ type: 'createResource', kind: 'note', title: nativeTitle.value.trim() || 'New note', workspaceId: null }, 'Create a new local note'));
  const createTask = button('Create task', () => act({ type: 'createResource', kind: 'task', title: nativeTitle.value.trim() || 'New task', workspaceId: null }, 'Create a new local task'));
  const workspaceCreate = button('Create workspace with selected resources', () => act({ type: 'workspaceFromResources', title: nativeTitle.value.trim() || 'New workspace', projectId: nativeProject.value || null, resourceIds: [...selected.keys()] }, 'Create a workspace in the explicitly chosen project containing the selected existing resources'));
  const localButtons = el('div', 'vela-core-actions'); localButtons.append(createNote, createTask);
  native.body.append(el('p', 'vela-core-secondary', 'These tools work in the app without a planning provider.'), label('Name', nativeTitle), localButtons, label('New workspace project', nativeProject), workspaceCreate, nativeAvailability);
  const settings = disclosure('Attention preferences', 'vela-core-settings'), mode = el('select'), monitor = el('input'), delegation = el('input'), eventTypes = el('input'), severity = el('select'), budget = el('input');
  for (const value of ['normal', 'quiet', 'focused', 'collaborative', 'proactive']) { const option = el('option', undefined, value[0].toUpperCase() + value.slice(1)); option.value = value; mode.append(option); }
  monitor.type = 'checkbox'; delegation.type = 'checkbox'; eventTypes.placeholder = 'task.completed, approval.required'; budget.type = 'number'; budget.min = '0'; budget.max = '60';
  for (const value of ['info', 'warning', 'critical']) { const option = el('option', undefined, value); option.value = value; severity.append(option); }
  const attentionRules = disclosure('Advanced attention rules', 'vela-core-advanced'); attentionRules.body.append(label('App event types (comma separated)', eventTypes), label('Minimum interruption severity', severity), label('Maximum interruptions per hour', budget));
  settings.body.append(label('Attention mode', mode), label('Keep an app activity digest', monitor), label('Allow separately approved delegated work', delegation), el('p', 'vela-core-secondary', 'Quiet keeps updates silent. Opening Vela does not mark them reviewed. Only selected app events are used; external monitoring is unavailable.'), attentionRules.node,
    button('Save preferences', async () => { if (!current) return; await client.preferences({ expectedVersion: current.preferences.version, patch: { mode: mode.value as VelaState['preferences']['mode'], monitoringEnabled: monitor.checked, delegationEnabled: delegation.checked, allowedEventTypes: eventTypes.value.split(',').map(s => s.trim()).filter(Boolean), minimumSeverity: severity.value as VelaState['preferences']['minimumSeverity'], maxInterruptionsPerHour: Number(budget.value) } }); await refresh(); }));
  const attentionPanel = disclosure('Attention', 'vela-core-attention'), attention = attentionPanel.body;
  const adaptationPanel = disclosure('Personalization', 'vela-core-adaptation'), adaptationBody = adaptationPanel.body;
  const contextPanel = disclosure('Request details and sources', 'vela-core-context'), contextBody = contextPanel.body;
  more.body.append(sourcePanel.node, native.node, settings.node, adaptationPanel.node, contextPanel.node);
  flow.append(conversation, plans, attentionPanel.node, more.node);
  const status = el('p', 'vela-core-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const errorBox = el('div', 'vela-core-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const form = el('form', 'vela-core-compose'), intent = el('textarea'), allowProvider = el('input');
  intent.rows = 3; intent.maxLength = 16000; intent.required = true; intent.placeholder = 'Describe a change you would like to plan…'; intent.setAttribute('aria-label', 'Describe a change to plan');
  allowProvider.type = 'checkbox'; const providerConsent = label('Use the planning provider for this request', allowProvider); providerConsent.className += ' vela-core-consent';
  const selection = el('div', 'vela-core-selection'); selection.setAttribute('aria-label', 'Selected sources');
  const send = el('button', 'vela-core-button vela-core-primary', 'Prepare plan'); send.type = 'submit';
  const stop = button('Stop planning', async () => { const state = await client.state(), pending = state.requests.findLast(request => request.state === 'planning'); if (pending) { await client.cancel(pending.id); await refresh(); } else { status.textContent = 'Planning has not started. You can cancel in the approval window if one is open.'; } }); stop.hidden = true;
  const composeActions = el('div', 'vela-core-compose-actions'); composeActions.append(send, button('Add sources', () => reveal(sourcePanel, search)), button('Local tools', () => reveal(native, nativeTitle)), stop);
  form.append(label('Plan your next step', intent), selection, providerConsent, el('p', 'vela-core-compose-hint', 'Planning is optional. You will review proposed changes before they run.'), composeActions);
  intent.addEventListener('input', () => { draftRevision++; }); intent.addEventListener('compositionstart', () => { composing = true; }); intent.addEventListener('compositionend', () => { composing = false; });
  intent.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229 && (!event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!busy && intent.value.trim()) form.requestSubmit(); } });
  form.addEventListener('submit', event => { event.preventDefault(); if (busy || !intent.value.trim() || composing) return; const submitted = { intent: intent.value, resourceIds: [...selected.keys()], authorizeProvider: allowProvider.checked }, revision = draftRevision; allowProvider.checked = false;
    void run(async () => { busy = true; send.disabled = true; stop.hidden = false; send.textContent = 'Preparing…'; errorBox.hidden = true; status.dataset.requestState = 'submitting'; delete status.dataset.planState; delete status.dataset.actionState; status.hidden = false; status.textContent = 'Preparing your request. No changes are applied by submitting.';
      try { const recorded = await client.request(submitted); if (draftRevision === revision && intent.value === submitted.intent) intent.value = ''; busy = false; renderStatus({ requests: [recorded], plans: [], receipts: [] }); await refresh(); }
      catch (error) { busy = false; try { await refresh(); } catch { status.dataset.requestState = 'unknown'; delete status.dataset.requestId; delete status.dataset.planState; status.hidden = false; status.textContent = 'The request could not be checked. Its outcome is unknown; review the activity before trying again.'; } throw error; }
      finally { busy = false; send.disabled = false; send.textContent = 'Prepare plan'; stop.hidden = !current?.requests.some(request => request.state === 'planning'); }
    });
  });
  shell.append(header, flow, errorBox, status, form); root.append(shell);
  function reveal(panel: ReturnType<typeof disclosure>, focus?: HTMLElement) { more.node.open = true; panel.node.open = true; lastDisclosure = panel.node; panel.node.scrollIntoView({ block: 'nearest' }); (focus ?? panel.summary).focus(); }
  shell.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const target = event.target as HTMLElement, opened = target.closest<HTMLDetailsElement>('details[open]') ?? (lastDisclosure?.open && shell.contains(lastDisclosure) ? lastDisclosure : null) ?? Array.from(shell.querySelectorAll<HTMLDetailsElement>('details[open]')).at(-1); if (opened) { event.preventDefault(); event.stopPropagation(); opened.open = false; opened.querySelector('summary')?.focus(); } });
  function renderSelection() {
    selection.replaceChildren(); selection.hidden = !selected.size;
    if (selected.size) { selection.append(el('span', 'vela-core-meta', selected.size + (selected.size === 1 ? ' source' : ' sources'))); for (const ref of selected.values()) { const chip = button(ref.title + ' ×', () => { selected.delete(ref.id); const control = sourceControls.get(ref.id); if (control) control.checked = false; renderSelection(); intent.focus(); }); chip.className = 'vela-core-chip'; chip.setAttribute('aria-label', 'Remove source ' + ref.title); selection.append(chip); } }
    updateWorkspaceAvailability();
  }
  async function run(action: () => unknown) { if (disposed) return; try { await action(); } catch (error) { if (!disposed) { status.dataset.actionState = 'failed'; errorBox.hidden = false; const details = disclosure('Error details', 'vela-core-error-details'); details.body.append(el('pre', undefined, error instanceof Error ? error.message : String(error))); errorBox.replaceChildren(el('p', undefined, 'That could not be completed. Your current text and selections are still here.'), details.node, button('Dismiss', () => { errorBox.hidden = true; })); } } }
  function available(action: VelaNativeAction['type']) { const advertised = (current as (VelaState & { nativeCapabilities?: Record<string, { available: boolean }> }) | null)?.nativeCapabilities; return advertised ? advertised[action]?.available === true : !!current?.capabilities.some(capability => capability.id === action); }
  function updateWorkspaceAvailability() { createNote.disabled = createTask.disabled = nativeBusy || !available('createResource'); workspaceCreate.disabled = nativeBusy || !available('workspaceFromResources') || !!nativeProject.selectedOptions[0]?.disabled || !selected.size; nativeAvailability.textContent = nativeBusy ? 'Completing the local action…' : (!available('createResource') ? 'Note and task creation is unavailable here. ' : '') + (!available('workspaceFromResources') ? 'Workspace organization is unavailable in this app.' : !selected.size ? 'Choose sources to organize them into a workspace.' : nativeProject.selectedOptions[0]?.disabled ? 'Choose an available project before creating the workspace.' : 'The selected sources keep their original identities.'); }
  function renderStatus(state: Pick<VelaState, 'requests' | 'plans' | 'receipts'>) { const recorded = velaPanelStatus(state); status.dataset.requestState = recorded.requestState; if (recorded.requestId) status.dataset.requestId = recorded.requestId; else delete status.dataset.requestId; if (recorded.planState) status.dataset.planState = recorded.planState; else delete status.dataset.planState; delete status.dataset.actionState; status.textContent = recorded.message; status.hidden = recorded.requestState === 'idle'; }
  function renderConversation(state: VelaState) {
    const items = state.conversation?.messages.slice(-80) ?? [], target: HTMLElement[] = [];
    if (!items.length) { const empty = el('div', 'vela-core-empty'); empty.append(el('h3', undefined, 'Start with your work'), el('p', undefined, 'Find your work, create something locally, or prepare a plan for a larger change.')); target.push(empty); }
    for (const message of items) { const signature = JSON.stringify(message), cached = messages.get(message.id); if (cached?.signature === signature) { target.push(cached.node); continue; }
      const entry = el('article', 'vela-core-message'); entry.dataset.messageId = message.id; entry.dataset.source = message.source;
      entry.append(el('strong', 'vela-core-message-author', message.source === 'provider' ? providerName(message.providerId) + ' · contribution' : message.role === 'user' ? 'You' : 'Vela'), el('p', undefined, message.content)); messages.set(message.id, { node: entry, signature }); target.push(entry);
    }
    for (const child of Array.from(conversation.children)) if (!target.includes(child as HTMLElement)) child.remove(); target.forEach((node, index) => { if (conversation.children[index] !== node) conversation.insertBefore(node, conversation.children[index] ?? null); });
    for (const [id, cached] of messages) if (!target.includes(cached.node)) messages.delete(id);
  }
  function effect(action: PlanStep['action'], plan: VelaPlan): string {
    const request = current?.requests.find(item => item.id === plan.requestId), refs = [...plan.targets, ...(request?.context.discovered ?? []), ...(current?.applicationContext?.references ?? [])], name = (id: string) => refs.find(ref => ref.id === id)?.title ?? 'the selected item';
    switch (action.type) {
      case 'workspaceFromResources': return 'Create “' + action.title + '” with ' + action.resourceIds.length + (action.resourceIds.length === 1 ? ' existing source · ' : ' existing sources · ') + (action.projectId ? name(action.projectId) : 'No project');
      case 'createResource': return 'Create ' + action.kind.replaceAll('_', ' ') + ' “' + action.title + '”' + (action.workspaceId ? ' in ' + name(action.workspaceId) : '');
      case 'attach': return 'Place ' + name(action.resourceId) + ' in ' + name(action.workspaceId);
      case 'navigate': return action.target.kind === 'workspace' ? 'Open ' + name(action.target.workspaceId) : 'Open the project overview';
      case 'content': return 'Replace the text in ' + name(action.resourceId);
      case 'taskStatus': return 'Mark ' + name(action.resourceId) + ' ' + (action.status === 'done' ? 'done' : 'open');
      case 'setTaskGroupMembers': return 'Update ' + name(action.groupId) + ' with ' + action.taskIds.length + (action.taskIds.length === 1 ? ' task' : ' tasks');
      case 'relate': return 'Connect ' + name(action.sourceId) + ' with ' + name(action.targetId) + ' · ' + action.kind;
      case 'applyStructuredPreset': return 'Apply the ' + action.preset + ' layout to ' + name(action.workspaceId);
      case 'delegateTask': return 'Start “' + action.title + '” with ' + providerName(action.providerId);
    }
  }
  function renderPlans(state: VelaState) {
    const latest = state.plans.at(-1), activeCards: HTMLElement[] = [], earlierCards: HTMLElement[] = [], visible = new Set<string>();
    for (const plan of [...state.plans].reverse()) {
      const active = ['prepared', 'approved', 'applying', 'failed', 'unknown'].includes(plan.state) || plan.id === latest?.id; if (!active && earlierCards.length >= 8) continue;
      const target = active ? activeCards : earlierCards, receipts = state.receipts.filter(receipt => receipt.planId === plan.id), effects = plan.steps.map(step => effect(step.action, plan));
      const signature = JSON.stringify({ plan, receipts, effects }), cached = planCards.get(plan.id); visible.add(plan.id);
      if (cached?.signature === signature) { target.push(cached.node); continue; }
      const card = el('article', 'vela-core-plan'); card.dataset.planId = plan.id; card.dataset.planState = plan.state; card.tabIndex = -1;
      const confirmed = receipts.filter(receipt => receipt.state === 'applied' && receipt.hostReceiptId).length;
      const complete = plan.steps.length > 0 && plan.steps.every(step => receipts.some(receipt => receipt.stepId === step.id && receipt.state === 'applied' && receipt.hostReceiptId));
      const stateLabel = { prepared: 'Ready for your review', approved: 'Approved · ready to apply', rejected: 'Not applied', applying: 'Applying reviewed changes', applied: complete ? 'Applied' : 'Results need review', failed: 'Stopped · review needed', cancelled: 'Cancelled', unknown: 'Outcome unknown · review needed' }[plan.state];
      card.append(el('p', 'vela-core-plan-state', stateLabel), el('h3', undefined, plan.summary), el('p', 'vela-core-meta', plan.contribution ? 'Proposed with ' + providerName(plan.contribution.providerId) : 'Local app action'));
      const steps = el('ol', 'vela-core-effects'); for (const [index, step] of plan.steps.entries()) { const item = el('li'); item.append(el('p', undefined, effects[index])); if (step.action.type === 'content') item.append(el('pre', 'vela-core-change-preview', step.action.content)); if (step.action.type === 'delegateTask') item.append(el('p', undefined, step.action.objective), el('p', 'vela-core-secondary', 'Starting this work requires a separate execution approval. A finished provider turn does not verify the task.')); steps.append(item); } card.append(steps);
      if (plan.targets.length) card.append(el('p', 'vela-core-targets', 'Uses: ' + plan.targets.map(ref => ref.title).join(', ')));
      const controls = el('div', 'vela-core-actions');
      const perform = async (approve: boolean) => { if (workingPlans.has(plan.id)) return; const previousFocus = doc.activeElement, returnFocus = controls.contains(previousFocus); workingPlans.add(plan.id); setPlanBusy(plan.id, true); try { if (approve) await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' }); await client.apply(plan.id); await refresh(); if (returnFocus && (doc.activeElement === previousFocus || doc.activeElement === doc.body)) plans.querySelector<HTMLElement>('[data-plan-id="' + plan.id + '"]')?.focus(); } finally { workingPlans.delete(plan.id); setPlanBusy(plan.id, false); } };
      if (plan.state === 'prepared') controls.append(button('Approve and apply', () => perform(true)), button('Reject plan', async () => { await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'reject' }); await refresh(); }));
      if (plan.state === 'approved') controls.append(button('Apply approved plan', () => perform(false))); card.append(controls);
      if (receipts.length) card.append(el('p', 'vela-core-receipt', confirmed + ' of ' + plan.steps.length + ' steps confirmed' + (receipts.some(receipt => ['failed', 'unknown'].includes(receipt.state)) ? ' · review details before trying again' : '')));
      const details = disclosure('Plan details and evidence', 'vela-core-plan-details'); details.node.open = cached?.node.querySelector<HTMLDetailsElement>('details')?.open ?? false; details.body.append(el('pre', undefined, JSON.stringify({ actions: plan.steps, targets: plan.targets, provider: plan.contribution, receipts }, null, 2))); card.append(details.node);
      planCards.set(plan.id, { node: card, controls, signature }); setPlanBusy(plan.id, workingPlans.has(plan.id)); target.push(card);
    }
    reconcile(planHistory.body, earlierCards); reconcile(plans, earlierCards.length ? [...activeCards, planHistory.node] : activeCards);
    for (const id of planCards.keys()) if (!visible.has(id)) planCards.delete(id);
  }
  function setPlanBusy(id: string, pending: boolean) { const controls = planCards.get(id)?.controls; if (controls) for (const child of Array.from(controls.children)) (child as HTMLButtonElement).disabled = pending; }
  function reconcile(parent: HTMLElement, children: HTMLElement[]) { for (const child of Array.from(parent.children)) if (!children.includes(child as HTMLElement)) child.remove(); children.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null); }); }
  function render(state: VelaState) {
    if (disposed) return; current = state;
    provider.textContent = state.planner.available ? providerName(state.planner.providerId) + (state.planner.busy ? ' · busy' : ' · available') : 'Planning unavailable';
    providerHint.textContent = state.planner.available ? 'Vela can ask ' + providerName(state.planner.providerId) + ' to help prepare a plan. You approve any sharing and actions.' : 'You can still find sources and use local tools. Check the planning connection when you want a provider-assisted plan.';
    providerConsent.firstElementChild!.textContent = 'Use ' + providerName(state.planner.providerId) + ' for this request';
    const chosen = projectChosen ? nativeProject.value : state.applicationContext?.currentProjectId ?? ''; nativeProject.replaceChildren(); const global = el('option', undefined, 'No project'); global.value = ''; nativeProject.append(global);
    for (const ref of state.applicationContext?.references.filter(ref => ref.kind === 'project') ?? []) { const option = el('option', undefined, ref.title); option.value = ref.id; nativeProject.append(option); }
    if (chosen && !Array.from(nativeProject.options).some(option => option.value === chosen)) { const unavailable = el('option', undefined, 'Previously selected project · unavailable'); unavailable.value = chosen; unavailable.disabled = true; nativeProject.append(unavailable); } nativeProject.value = chosen; updateWorkspaceAvailability();
    renderConversation(state); renderPlans(state); contextBody.replaceChildren();
    if (state.conversation) contextBody.append(el('p', 'vela-core-meta', 'Conversation ' + state.conversation.resourceId + ' · revision ' + state.conversation.revision));
    for (const request of state.requests.slice(-6).reverse()) { const item = disclosure(request.intent, 'vela-core-request-details'); item.body.append(el('p', undefined, velaPanelStatus({ requests: [request], plans: state.plans, receipts: state.receipts }).message), el('p', 'vela-core-meta', 'Included sources: ' + (request.context.included.map(ref => ref.title).join(', ') || 'none')), el('pre', undefined, JSON.stringify({ state: request.state, error: request.errorCode, manifest: request.context, invalidProposal: request.invalidProposal }, null, 2))); contextBody.append(item.node); }
    mode.value = state.preferences.mode; monitor.checked = state.preferences.monitoringEnabled; delegation.checked = state.preferences.delegationEnabled; eventTypes.value = state.preferences.allowedEventTypes.join(', '); severity.value = state.preferences.minimumSeverity; budget.value = String(state.preferences.maxInterruptionsPerHour); renderAdaptation(state);
    const pending = state.attention.filter(item => !item.reviewedAt && !item.dismissedAt); attentionPanel.summary.textContent = pending.length ? pending.length + (pending.length === 1 ? ' update to review' : ' updates to review') : state.preferences.monitoringEnabled ? 'No new updates in your digest' : 'Attention digest is paused'; attention.replaceChildren();
    if (!state.preferences.monitoringEnabled) attention.append(el('p', 'vela-core-secondary', 'New app activity is paused. Saved updates remain until you review them.'));
    for (const item of pending.slice(-20).reverse()) { const row = el('article', 'vela-core-update'); row.append(el('p', undefined, item.summary)); if (item.subject && options.onOpenSubject) row.append(button('Open source', () => options.onOpenSubject?.(item.subject!))); row.append(button('Mark reviewed', async () => { await client.reviewAttention([item.id]); await refresh(); })); const evidence = disclosure('Why this update', 'vela-core-update-details'); evidence.body.append(el('p', undefined, item.reason), el('pre', undefined, JSON.stringify({ source: item.source, occurredAt: item.occurredAt, classification: item.classification, disposition: item.disposition, coverageGap: item.coverageGap }, null, 2))); row.append(evidence.node); attention.append(row); }
    stop.hidden = !busy && !state.requests.some(request => request.state === 'planning'); if (!busy) renderStatus(state);
  }
  function renderAdaptation(state: VelaState) {
    adaptationBody.replaceChildren();
    const data = state.adaptation;
    if (!data) { adaptationBody.append(el('p', undefined, 'Personalization is unavailable in this app.')); return; }
    adaptationBody.append(el('p', undefined, 'Learning is ' + (data.policy.enabled ? 'enabled for the categories below' : 'disabled') + '. Inferences remain distinct from your explicit choices. Only recorded user application actions can be evidence. No sensors, provider guesses, or privilege settings are learned.'));
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = data.policy.enabled;
    adaptationBody.append(label('Learn from my app choices', enabled));
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
    adaptationBody.append(el('p', undefined, data.applicationAvailable ? 'Your saved choices can be applied here.' : 'You can save and review choices here. Applying them is unavailable in this app.'));
    const explicitSection = el('details'); explicitSection.append(el('summary', undefined, 'Set an explicit override'));
    const key = el('select'); for (const [value, title] of [['presentation.density', 'Text density'], ['organization.defaultPreset', 'Default workspace layout']]) { const option = el('option', undefined, title); option.value = value; key.append(option); }
    const value = el('select');
    const values = () => { value.replaceChildren(); for (const v of key.value === 'presentation.density' ? ['comfortable', 'compact'] : ['balanced', 'focus', 'development', 'research']) { const option = el('option', undefined, v); option.value = v; value.append(option); } }; key.addEventListener('change', values); values();
    const scopeSelect = el('select'); const globalOption = el('option', undefined, 'App default'); globalOption.value = ''; scopeSelect.append(globalOption);
    const workspaceRefs = new Map<string, string>();
    for (const plan of state.plans) for (const target of plan.targets) if (target.kind === 'workspace') workspaceRefs.set(target.id, target.title);
    for (const preference of [...data.hypotheses, ...data.explicit]) if (preference.scope.kind === 'workspace') workspaceRefs.set(preference.scope.id!, workspaceRefs.get(preference.scope.id!) ?? preference.scope.id!);
    for (const [id, title] of workspaceRefs) { const option = el('option', undefined, title); option.value = id; scopeSelect.append(option); }
    const apply = el('input'); apply.type = 'checkbox'; apply.disabled = !data.applicationAvailable;
    explicitSection.append(label('Preference', key), label('Value', value), label('Scope', scopeSelect), label('Apply this choice now', apply));
    if (client.explicitPreference) explicitSection.append(button('Save my choice', async () => {
      const scope = scopeSelect.value ? { kind: 'workspace' as const, id: scopeSelect.value } : { kind: 'global' as const, id: null };
      const previous = data.explicit.find(p => p.key === key.value && p.scope.kind === scope.kind && p.scope.id === scope.id);
      await client.explicitPreference!({ key: key.value as 'presentation.density' | 'organization.defaultPreset', value: value.value as 'comfortable' | 'compact' | 'balanced' | 'focus' | 'development' | 'research', scope, expectedVersion: previous?.version ?? 0, apply: apply.checked }); await refresh();
    }));
    adaptationBody.append(explicitSection);
    for (const preference of data.explicit.filter(p => p.active)) adaptationBody.append(el('p', undefined, 'Explicit · ' + preference.key + ' = ' + preference.value + ' · ' + (preference.scope.id ?? 'global') + ' · v' + preference.version));
    for (const hypothesis of data.hypotheses.slice(-12).reverse()) {
      const card = el('article', 'vela-core-plan'); card.append(el('h3', undefined, 'Inferred · ' + hypothesis.key + ' = ' + hypothesis.value + ' · ' + hypothesis.state),
        el('p', undefined, hypothesis.explanation), el('p', undefined, 'Scope: ' + (hypothesis.scope.id ?? 'global') + ' · confidence heuristic: ' + hypothesis.confidence));
      const evidence = el('details'); evidence.append(el('summary', undefined, 'Why this suggestion'), el('pre', undefined, JSON.stringify(hypothesis.evidence, null, 2))); card.append(evidence);
      if (hypothesis.errorCode) card.append(el('p', undefined, 'Application status: ' + hypothesis.errorCode));
      if (hypothesis.state === 'suggested' && client.reviewPreference) {
        card.append(button('Use this suggestion', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'accept', apply: false }); await refresh(); }));
        if (data.applicationAvailable) card.append(button('Use and apply', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'accept', apply: true }); await refresh(); }));
        card.append(button('Reject', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'reject', apply: false }); await refresh(); }), button('Hide this suggestion', async () => { await client.reviewPreference!({ hypothesisId: hypothesis.id, decision: 'suppress', apply: false }); await refresh(); }));
      }
      if (client.resetPreferences) card.append(button('Reset choices here', async () => { await client.resetPreferences!({ scope: hypothesis.scope, clearSuppressions: true }); await refresh(); }));
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
