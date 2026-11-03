import type { ResourceRef, VelaClient, VelaNativeAction, VelaState, VelaPlan, PlanStep, VelaPresentationState, VelaPresentationPatch, VelaLocalDispatch } from './contracts.ts';
import { velaPanelStatus } from './panel-status.ts';
import { projectVelaManifestation, type VelaManifestationState } from './manifestation-state.ts';
import { summarizeSystemMemory } from './system-information.ts';
import { githubRepository } from '../../application-contract/github-timeline.ts';

export interface VelaPanelPresentation {
  phase: 'idle' | 'receiving' | 'thinking' | 'planning' | 'review' | 'applying' | 'attention' | 'error';
  context: string | null;
  messageIds: readonly string[];
  planIds: readonly string[];
}
export interface VelaPanelOptions {
  onOpenSubject?: (subject: { id: string; kind: ResourceRef['kind'] }) => void;
  /** Explicit user action only; the host checks its actual planning connection. */
  onConnectProvider?: () => Promise<unknown>;
  /** Observational only. The first hydrated value is a baseline, not a history-arrival event. */
  onPresentation?: (value: VelaPanelPresentation) => void;
  /** Real stable nodes for the host's existing MotionCoordinator/geometry; observational only, null retires them. */
  onManifestation?: (value: VelaPanelManifestation | null) => void;
  listTimelineRepositories?: () => Promise<string[]>;
}
export interface VelaPanelManifestation {
  projection: Readonly<VelaManifestationState>; view: 'current' | 'history'; baseline: boolean;
  elements: { shell: HTMLElement; reading: HTMLElement; manifestation: HTMLElement; composer: HTMLFormElement };
}
const providerName = (id: string | null | undefined) => id === 'codex-app-server' ? 'Codex' : id || 'Provider';
let panelSequence = 0;
/** Content for the existing host-anchored surface. Mount/open never starts inference or applies actions. */
export function mountVelaPanel(root: HTMLElement, client: VelaClient, options: VelaPanelOptions = {}) {
  const doc = root.ownerDocument;
  let current: VelaState | null = null, disposed = false, busy = false, nativeBusy = false, composing = false, draftRevision = 0, lastDisclosure: HTMLDetailsElement | null = null;
  let activeContext: string | null = null, contextTrigger: HTMLButtonElement | null = null, chosenProviderId: string | null = null, presentationSignature = '';
  let manifestationSignature = '', manifestationBaseline = true, observing = true, presentationBusy = false, readSequence = 0, viewRevision = 0, transientView: 'current' | 'history' | null = null;
  let immediateLocal: Extract<VelaLocalDispatch, { matched: true }> | null = null;
  const instanceId = 'vela-context-' + ++panelSequence;
  const selected = new Map<string, ResourceRef>(), sourceControls = new Map<string, HTMLInputElement>();
  const messages = new Map<string, { node: HTMLElement; signature: string }>(), workingPlans = new Set<string>(), applyingPlans = new Set<string>();
  let applyingLocally = false;
  const planCards = new Map<string, { node: HTMLElement; controls: HTMLElement; signature: string }>();
  const historyRows = new Map<string, { node: HTMLElement; signature: string }>();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  };
  const button = (text: string, action: () => unknown) => { const node = el('button', 'vela-core-button', text); node.type = 'button'; node.addEventListener('click', () => { if (!node.disabled) void run(action); }); return node; };
  const markIcon = (node: HTMLButtonElement, name: string, glyph: string, key: string) => { node.className += ' vela-core-icon'; node.setAttribute('aria-label', name); node.title = name; const mark = el('span', 'vela-core-icon-mark', glyph); mark.setAttribute('aria-hidden', 'true'); mark.dataset.icon = key; node.append(mark); return node; };
  const icon = (name: string, glyph: string, key: string, action: () => unknown) => markIcon(button('', action), name, glyph, key);
  const label = (text: string, control: HTMLElement) => { const node = el('label', 'vela-core-field'); node.append(el('span', undefined, text), control); return node; };
  const disclosure = (text: string, className: string) => { const node = el('details', className), summary = el('summary', undefined, text), body = el('div', 'vela-core-disclosure-body'); node.append(summary, body); node.addEventListener('toggle', () => { if (node.open) lastDisclosure = node; }); return { node, summary, body }; };
  const shell = el('section', 'vela-core'); shell.setAttribute('aria-label', 'Vela application assistant');
  shell.dataset.view = 'empty'; shell.dataset.context = 'none'; shell.dataset.phase = 'idle';
  const connection = disclosure('Provider connection', 'vela-core-provider-controls'), provider = el('span', 'vela-core-provider'), providerHint = el('p', 'vela-core-secondary');
  connection.summary.replaceChildren(provider); connection.body.append(providerHint);
  if (options.onConnectProvider) {
    const connect = button('Check connection', async () => { if (connect.disabled) return; connect.disabled = true; try { await options.onConnectProvider!(); await refresh(); } finally { connect.disabled = false; } }); connection.body.append(connect);
  }
  const flow = el('div', 'vela-core-scroll'); flow.setAttribute('aria-label', 'Conversation and plans'); flow.hidden = true;
  const manifestation = el('section', 'vela-manifestation'); manifestation.setAttribute('aria-label', 'Current Vela response'); manifestation.hidden = true;
  const manifestationKicker = el('p', 'vela-manifestation-kicker'), manifestationBody = el('div', 'vela-manifestation-content'), manifestationSources = el('div', 'vela-manifestation-sources');
  const localAlongsidePlan = el('p', 'vela-manifestation-inline-local vela-manifestation-value'); localAlongsidePlan.setAttribute('aria-label', 'Latest local response'); localAlongsidePlan.hidden = true;
  const manifestationDetails = disclosure('Response details', 'vela-core-response-details');
  let responseSignature = '';
  const conversation = el('div', 'vela-core-conversation'); conversation.setAttribute('aria-label', 'Vela conversation');
  const plans = el('section', 'vela-core-plans'); plans.setAttribute('aria-label', 'Plans to review');
  const planHistory = disclosure('Earlier plans', 'vela-core-plan-history');
  const history = el('section', 'vela-core-history'); history.id = instanceId + '-history'; history.setAttribute('aria-label', 'Vela history'); history.hidden = true;
  const historyRequests = el('nav'); historyRequests.setAttribute('aria-label', 'Saved responses');
  const historyEmpty = el('p', 'vela-core-secondary', 'No saved history yet.');
  const historyBack = button('Current response', () => setView('current'));
  const openHistory = button('Open conversation', () => { const ref = project().historyResource; if (ref) options.onOpenSubject?.({ id: ref.resourceId, kind: 'resource' }); });
  history.append(historyBack, openHistory, historyRequests, conversation, planHistory.node, historyEmpty);
  const pin = icon('Pin response', '◇', 'pin', () => updatePresentation({ pinnedRequestIds: toggle(presentation().pinnedRequestIds, project().currentRequestId) }));
  const dismiss = icon('Dismiss response', '×', 'dismiss', () => { const id = project().currentRequestId; if (id) return updatePresentation({ dismissedRequestIds: [...new Set([...presentation().dismissedRequestIds, id])], selectedRequestId: null }); });
  const responseActions = el('div', 'vela-manifestation-actions'); responseActions.append(pin, dismiss);
  manifestation.tabIndex = -1; manifestation.append(manifestationKicker, localAlongsidePlan, manifestationBody, plans, manifestationSources, manifestationDetails.node, responseActions);
  const more = el('section', 'vela-core-contextual vela-core-more'); more.hidden = true; more.id = instanceId; more.setAttribute('aria-label', 'Vela controls');
  const contextualClose = icon('Close Vela controls', '×', 'close', () => closeContext()); contextualClose.className += ' vela-core-contextual-close';
  const sourcePanel = disclosure('Find and add sources', 'vela-core-source-panel');
  const searchForm = el('form', 'vela-core-search'), search = el('input'), searchButton = el('button', 'vela-core-button', 'Search');
  search.type = 'search'; search.placeholder = 'Find a note, chat, task, or workspace'; search.maxLength = 200; search.setAttribute('aria-label', 'Search your work'); searchButton.type = 'submit';
  const searchResults = el('div', 'vela-core-results'); searchResults.setAttribute('aria-live', 'polite'); searchForm.append(search, searchButton);
  sourcePanel.body.append(searchForm, searchResults);
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
  const act = async (action: VelaNativeAction, intent: string) => {
    if (nativeBusy) return;
    nativeBusy = true; updateWorkspaceAvailability(); present();
    try {
      const plan = await client.native({ action, intent });
      if (plan.state === 'prepared') { transientView = 'current'; closeContext(false); }
      else { applyingLocally = true; present(); await client.apply(plan.id); }
      await refresh();
    } finally { nativeBusy = applyingLocally = false; updateWorkspaceAvailability(); present(); }
  };
  const createNote = button('Create note', () => act({ type: 'createResource', kind: 'note', title: nativeTitle.value.trim() || 'New note', workspaceId: null }, 'Create a new local note'));
  const createTask = button('Create task', () => act({ type: 'createResource', kind: 'task', title: nativeTitle.value.trim() || 'New task', workspaceId: null }, 'Create a new local task'));
  const workspaceCreate = button('Create workspace with selected resources', () => act({ type: 'workspaceFromResources', title: nativeTitle.value.trim() || 'New workspace', projectId: nativeProject.value || null, resourceIds: [...selected.keys()] }, 'Create a workspace in the explicitly chosen project containing the selected existing resources'));
  const localButtons = el('div', 'vela-core-actions'); localButtons.append(createNote, createTask);
  native.body.append(label('Name', nativeTitle), localButtons, label('New workspace project', nativeProject), workspaceCreate, nativeAvailability);
  const timelineTools = disclosure('Timeline', 'vela-core-timeline-tools');
  const repositoryInput = el('input');
  repositoryInput.type = 'url'; repositoryInput.maxLength = 180; repositoryInput.placeholder = 'https://github.com/owner/repository';
  const timelineAction = (source: Extract<VelaNativeAction, { type: 'createTimeline' }>['source']) => {
    const title = nativeTitle.value.trim() || (source.kind === 'github-commits' ? 'Development Timeline' : 'Activity Timeline');
    return act({ type: 'createTimeline', title, source, projectId: current?.applicationContext?.currentProjectId ?? null,
      workspaceId: current?.applicationContext?.currentWorkspaceId ?? null }, 'Create ' + title);
  };
  const activityTimeline = button('Review activity Timeline', () => timelineAction({ kind: 'application-activity' }));
  const developmentTimeline = button('Review GitHub Timeline', () => timelineAction({ kind: 'github-commits', repositoryUrl: repositoryInput.value }));
  activityTimeline.dataset.aerynthMotionControl = developmentTimeline.dataset.aerynthMotionControl = 'true';
  timelineTools.body.append(activityTimeline, label('Public GitHub repository', repositoryInput), developmentTimeline);
  timelineTools.node.hidden = true;
  timelineTools.node.addEventListener('toggle', () => {
    if (!timelineTools.node.open || repositoryInput.value || !options.listTimelineRepositories) return;
    void options.listTimelineRepositories().then(repositories => {
      if (!disposed && !repositoryInput.value && repositories.length === 1) { repositoryInput.value = repositories[0]!; updateWorkspaceAvailability(); }
    }).catch(() => {});
  });
  repositoryInput.addEventListener('input', () => updateWorkspaceAvailability());
  native.body.append(timelineTools.node);
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
  const preferencesPanel = disclosure('Preferences', 'vela-core-preferences'); preferencesPanel.body.append(settings.node, adaptationPanel.node, contextPanel.node);
  more.append(contextualClose, sourcePanel.node, native.node, preferencesPanel.node, connection.node, attentionPanel.node);
  flow.append(manifestation, history, more);
  const status = el('p', 'vela-core-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
  const errorBox = el('div', 'vela-core-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const form = el('form', 'vela-core-compose'), intent = el('textarea'), allowProvider = el('input');
  intent.rows = 2; intent.maxLength = 16000; intent.required = true; intent.placeholder = 'Vela…'; intent.setAttribute('aria-label', 'Message Vela');
  allowProvider.type = 'checkbox'; const providerConsent = label('Use the planning provider for this request', allowProvider); providerConsent.className += ' vela-core-consent';
  connection.body.prepend(providerConsent); const providerChoice = icon('Remove planning provider from next request', '×', 'close', () => { allowProvider.checked = false; chosenProviderId = null; renderProviderChoice(); intent.focus(); }); providerChoice.className += ' vela-core-provider-choice'; providerChoice.hidden = true;
  const providerChoiceName = el('span', 'vela-core-provider-choice-name'); providerChoice.prepend(providerChoiceName);
  allowProvider.addEventListener('change', () => { chosenProviderId = allowProvider.checked ? current?.planner.providerId ?? null : null; renderProviderChoice(); });
  const selection = el('div', 'vela-core-selection'); selection.setAttribute('aria-label', 'Selected sources'); selection.hidden = true;
  const send = markIcon(el('button', 'vela-core-button vela-core-primary'), 'Send to Vela', '↑', 'send'); send.type = 'submit'; send.disabled = true;
  const stop = icon('Stop', '■', 'stop', async () => { const state = await client.state(), pending = state.requests.findLast(request => request.state === 'planning' || state.plans.some(plan => plan.requestId === request.id && plan.state === 'applying')); if (pending) { await client.cancel(pending.id); await refresh(); } else { status.textContent = 'No request is running.'; } }); stop.hidden = true;
  const sourcesControl = icon('Add sources', '+', 'sources', () => reveal('sources', search)), toolsControl = icon('Local tools', '⋯', 'tools', () => reveal('tools', nativeTitle)), preferencesControl = icon('Vela preferences', '⚙', 'preferences', () => reveal('preferences')), providerControl = icon('Provider', '◇', 'provider', () => reveal('provider', allowProvider)), attentionControl = icon('Attention', '·', 'attention', () => reveal('attention'));
  const historyControl = icon('History', '↶', 'history', () => setView(view() === 'history' ? 'current' : 'history')); historyControl.setAttribute('aria-expanded', 'false'); historyControl.setAttribute('aria-controls', history.id);
  const contextPanels = new Map([
    ['sources', { panel: sourcePanel, trigger: sourcesControl }], ['tools', { panel: native, trigger: toolsControl }], ['preferences', { panel: preferencesPanel, trigger: preferencesControl }], ['provider', { panel: connection, trigger: providerControl }], ['attention', { panel: attentionPanel, trigger: attentionControl }],
  ]);
  for (const [key, entry] of contextPanels) { entry.panel.node.hidden = true; entry.panel.node.id = instanceId + '-' + key; entry.trigger.setAttribute('aria-controls', entry.panel.node.id); entry.trigger.setAttribute('aria-expanded', 'false'); entry.panel.node.addEventListener('toggle', () => { if (activeContext === key && !entry.panel.node.open) closeContext(); }); }
  const composeActions = el('div', 'vela-core-compose-actions'); composeActions.append(sourcesControl, toolsControl, preferencesControl, providerControl, attentionControl, historyControl, stop, send);
  form.append(intent, selection, providerChoice, composeActions);
  intent.addEventListener('input', () => { draftRevision++; send.disabled = busy || !intent.value.trim(); present(); }); intent.addEventListener('compositionstart', () => { composing = true; }); intent.addEventListener('compositionend', () => { composing = false; });
  intent.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229 && (!event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!busy && intent.value.trim()) form.requestSubmit(); } });
  form.addEventListener('submit', event => { event.preventDefault(); if (busy || !intent.value.trim() || composing) return; const submitted = { intent: intent.value, resourceIds: [...selected.keys()], authorizeProvider: allowProvider.checked && chosenProviderId === current?.planner.providerId }, revision = draftRevision, submittedView = ++viewRevision; transientView = 'current'; allowProvider.checked = false; chosenProviderId = null; renderProviderChoice(); closeContext(false); renderReading();
    void run(async () => { busy = true; send.disabled = true; stop.hidden = false; form.setAttribute('aria-busy', 'true'); errorBox.hidden = true; status.dataset.requestState = 'submitting'; delete status.dataset.planState; delete status.dataset.actionState; status.hidden = false; status.textContent = 'Thinking…'; present();
      try {
        const commandId = globalThis.crypto.randomUUID(), local = client.local ? await client.local({ intent: submitted.intent, commandId }) : undefined;
        const recorded = local?.matched ? local.request : await client.request({ ...submitted, ...(client.local ? { commandId } : {}) });
        if (disposed) return;
        if (local?.matched) showLocal(local, submitted.intent, commandId);
        if (draftRevision === revision && intent.value === submitted.intent) intent.value = ''; renderStatus({ requests: [recorded], plans: [], receipts: [] });
        if (local?.matched) { void settleSubmittedView(submittedView).catch(() => { if (!disposed && immediateLocal?.request.id === recorded.id) { status.dataset.refreshState = 'unavailable'; status.textContent = 'The saved local response is shown. History could not be refreshed.'; } }); return; }
        await settleSubmittedView(submittedView);
      }
      catch (error) { busy = false; try { await refresh(); } catch { status.dataset.requestState = 'unknown'; delete status.dataset.requestId; delete status.dataset.planState; status.hidden = false; status.textContent = 'The request could not be checked. Its outcome is unknown; review the activity before trying again.'; } throw error; }
      finally { busy = false; send.disabled = !intent.value.trim(); form.setAttribute('aria-busy', 'false'); stop.hidden = !current?.requests.some(request => request.state === 'planning'); present(); }
    });
  });
  shell.append(flow, errorBox, status, form); root.append(shell);
  function reveal(key: string, focus?: HTMLElement) { const entry = contextPanels.get(key); if (!entry) return; for (const [name, item] of contextPanels) { item.panel.node.hidden = name !== key; item.trigger.setAttribute('aria-expanded', String(name === key)); } activeContext = key; contextTrigger = entry.trigger; more.hidden = false; more.setAttribute('aria-label', entry.trigger.getAttribute('aria-label')!); entry.panel.node.open = true; lastDisclosure = entry.panel.node; updatePresence(); entry.panel.node.scrollIntoView({ block: 'nearest' }); (focus && !(focus as HTMLInputElement).disabled ? focus : entry.panel.summary).focus(); present(); }
  function closeContext(restoreFocus = true) { if (more.hidden) return; const previous = contextTrigger; for (const entry of contextPanels.values()) { entry.panel.node.hidden = true; entry.trigger.setAttribute('aria-expanded', 'false'); } activeContext = null; more.hidden = true; lastDisclosure = null; updatePresence(); if (restoreFocus) previous?.focus(); present(); }
  shell.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const target = event.target as HTMLElement, opened = target.closest<HTMLDetailsElement>('details[open]') ?? (lastDisclosure?.open && shell.contains(lastDisclosure) && !lastDisclosure.closest('[hidden]') ? lastDisclosure : null); if (!more.hidden && (!opened || opened === contextPanels.get(activeContext!)?.panel.node)) { event.preventDefault(); event.stopPropagation(); closeContext(); } else if (opened) { event.preventDefault(); event.stopPropagation(); opened.open = false; opened.querySelector('summary')?.focus(); } });
  function renderSelection() {
    selection.replaceChildren(); selection.hidden = !selected.size;
    if (selected.size) { selection.append(el('span', 'vela-core-meta', selected.size + (selected.size === 1 ? ' source' : ' sources'))); for (const ref of selected.values()) { const chip = button(ref.title + ' ×', () => { selected.delete(ref.id); const control = sourceControls.get(ref.id); if (control) control.checked = false; renderSelection(); intent.focus(); }); chip.className = 'vela-core-chip'; chip.setAttribute('aria-label', 'Remove source ' + ref.title); selection.append(chip); } }
    updateWorkspaceAvailability();
  }
  function renderProviderChoice() { const chosen = allowProvider.checked && chosenProviderId && chosenProviderId === current?.planner.providerId; providerChoice.hidden = !chosen; providerChoiceName.textContent = chosen ? providerName(chosenProviderId) : ''; providerChoice.setAttribute('aria-label', 'Remove ' + providerName(chosenProviderId) + ' from next request'); providerControl.dataset.selected = String(!!chosen); }
  function presentation(): VelaPresentationState { return current?.presentation ?? { schemaVersion: 1, version: 1, view: 'current', selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] }; }
  function view() { return transientView ?? presentation().view; }
  function toggle(ids: readonly string[], id: string | null) { return id === null ? [...ids] : ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]; }
  function persistent() { return !!client.presentation && !!current?.presentation; }
  function project(): VelaManifestationState {
    const value = projectVelaManifestation(current, presentation());
    // A post-commit local DTO can precede the first full history read. No revision is invented.
    if (!immediateLocal || value.requiredPlanIds.length) return value;
    const id = immediateLocal.request.id;
    if (presentation().dismissedRequestIds.includes(id)) return { ...value, kind: 'none', currentRequestId: null, currentMessageId: null, currentPlanId: null, canDismiss: false };
    return { ...value, kind: 'whisper', currentRequestId: id, currentMessageId: immediateLocal.result.messageId, currentPlanId: null, historyResource: null, pinned: presentation().pinnedRequestIds.includes(id), canDismiss: true, selectionReason: 'latest' };
  }
  async function updatePresentation(patch: VelaPresentationPatch) {
    if (presentationBusy || !persistent()) return;
    presentationBusy = true; renderReading();
    try { const value = await client.presentation!({ expectedVersion: presentation().version, patch }); if (disposed || !current) return; readSequence++; if (value.version >= (current.presentation?.version ?? 0)) current = { ...current, presentation: value }; if (patch.selectedRequestId) immediateLocal = null; transientView = null; renderReading(); await refresh(); }
    catch (error) { try { await refresh(); } catch {} throw error; }
    finally { presentationBusy = false; if (!disposed) { renderReading(); present(); } }
  }
  async function setView(value: 'current' | 'history') { viewRevision++; if (persistent()) await updatePresentation({ view: value }); else { transientView = value; renderReading(); present(); } }
  async function settleSubmittedView(revision: number) { if (viewRevision === revision && persistent() && (presentation().view !== 'current' || presentation().selectedRequestId !== null)) await updatePresentation({ view: 'current', selectedRequestId: null }); else await refresh(); }
  function showLocal(value: Extract<VelaLocalDispatch, { matched: true }>, submitted: string, commandId: string) {
    const request = value.request, result = value.result, local = request.local;
    if (request.intent !== submitted || request.state !== 'responded' || request.providerId !== null || request.planId || !local || local.schemaVersion !== 1 || local.providerId !== null || local.classification !== 'observed' || !request.response || request.response.messageId !== result.messageId || !['answer', 'inability'].includes(request.response.kind) || result.schemaVersion !== 1 || result.providerId !== null || result.classification !== 'observed' || result.commandId !== commandId || typeof result.content !== 'string' || !result.content.length || result.content.length > 16000 || local.commandId !== result.commandId || local.capabilityId !== result.capabilityId || local.observedAt !== result.observedAt || JSON.stringify(local.facts) !== JSON.stringify(result.facts)) throw new Error('The local response could not be verified. Review history before trying again.');
    immediateLocal = value; readSequence++; renderReading(); present();
  }
  function updatePresence() { shell.dataset.view = !manifestation.hidden || !history.hidden ? 'conversation' : 'empty'; shell.dataset.context = activeContext ?? 'none'; flow.hidden = manifestation.hidden && history.hidden && more.hidden; }
  function emitManifestation() {
    if (disposed || !observing) return;
    const projection = project(), signature = JSON.stringify({ projection, view: view(), context: shell.dataset.context }); if (signature === manifestationSignature) return;
    manifestationSignature = signature;
    const baseline = manifestationBaseline; manifestationBaseline = false;
    const value: VelaPanelManifestation = { projection: Object.freeze({ ...projection, requiredPlanIds: Object.freeze([...projection.requiredPlanIds]) }), view: view(), baseline, elements: { shell, reading: flow, manifestation, composer: form } };
    try { options.onManifestation?.(value); } catch { /* Geometry cannot block useful content or grant an action. */ }
  }
  function renderReading() {
    const projection = project(), selectedRequest = immediateLocal?.request.id === projection.currentRequestId ? immediateLocal.request : current?.requests.find(request => request.id === projection.currentRequestId), message = current?.conversation?.messages.find(message => message.id === projection.currentMessageId), local = immediateLocal?.request.id === projection.currentRequestId ? immediateLocal.result : null;
    const facts = selectedRequest?.local?.facts;
    const content = facts?.kind === 'system-memory' && (local || message) ? summarizeSystemMemory(facts.measurement) : local?.content ?? message?.content ?? '';
    const signature = JSON.stringify({ id: projection.currentMessageId, kind: projection.kind, content });
    manifestationBody.dataset.density = content.length > 140 ? 'reading' : 'signal';
    shell.dataset.manifestationKind = projection.kind; shell.dataset.presentationView = view(); manifestation.dataset.requestId = projection.currentRequestId ?? ''; manifestation.dataset.currentMessageId = projection.currentMessageId ?? '';
    manifestation.hidden = projection.kind === 'none' || view() === 'history' && !projection.requiredPlanIds.length;
    manifestationKicker.textContent = projection.kind === 'insight' && message?.source === 'provider' ? providerName(message.providerId) + ' · contribution' : 'Vela';
    if (signature !== responseSignature) { responseSignature = signature; manifestationBody.replaceChildren(); if (content) manifestationBody.append(el('p', projection.kind === 'whisper' ? 'vela-manifestation-value' : undefined, content)); }
    manifestationBody.hidden = projection.kind === 'action' || !content;
    const details = JSON.stringify({ requestId: selectedRequest?.id, local: selectedRequest?.local, response: selectedRequest?.response, provider: message?.providerContribution }, null, 2);
    if (manifestationDetails.body.firstElementChild?.textContent !== details) manifestationDetails.body.replaceChildren(el('pre', undefined, details)); manifestationDetails.node.hidden = projection.kind === 'none' || projection.kind === 'action';
    const sources = selectedRequest?.context.included ?? [], sourceSignature = JSON.stringify(sources.map(ref => [ref.id, ref.kind, ref.version, ref.title]));
    if (manifestationSources.dataset.signature !== sourceSignature) { manifestationSources.dataset.signature = sourceSignature; manifestationSources.replaceChildren(); for (const ref of sources) manifestationSources.append(options.onOpenSubject ? button(ref.title, () => options.onOpenSubject?.({ id: ref.id, kind: ref.kind })) : el('span', undefined, ref.title)); } manifestationSources.hidden = !manifestationSources.children.length;
    const recent = current?.requests.at(-1), recentMessage = recent?.response && current?.conversation?.messages.find(message => message.id === recent.response!.messageId && message.requestId === recent.id && message.source === 'vela-native' && message.classification === 'observed' && message.providerId === undefined && message.providerContribution === undefined);
    const adjacentFacts = immediateLocal?.result.facts ?? recent?.local?.facts;
    const adjacentContent = immediateLocal?.result.content ?? (recent?.state === 'responded' && recent.local?.classification === 'observed' && recent.providerId === null ? recentMessage?.content : undefined);
    const adjacent = adjacentContent && adjacentFacts?.kind === 'system-memory' ? summarizeSystemMemory(adjacentFacts.measurement) : adjacentContent;
    localAlongsidePlan.hidden = !projection.requiredPlanIds.length || !adjacent || view() === 'history'; if (adjacent && localAlongsidePlan.textContent !== adjacent) localAlongsidePlan.textContent = adjacent;
    pin.hidden = dismiss.hidden = projection.currentRequestId === null; pin.disabled = presentationBusy || !persistent(); dismiss.disabled = presentationBusy || !persistent() || !projection.canDismiss;
    pin.setAttribute('aria-label', projection.pinned ? 'Unpin response' : 'Pin response'); pin.setAttribute('aria-pressed', String(projection.pinned)); pin.title = persistent() ? (projection.pinned ? 'Unpin response' : 'Pin response') : 'Saved response choices are unavailable in this host'; dismiss.title = !projection.canDismiss ? 'This plan needs review before it can be dismissed' : persistent() ? 'Dismiss response' : 'Saved response choices are unavailable in this host';
    history.hidden = view() !== 'history'; historyControl.disabled = presentationBusy; historyControl.setAttribute('aria-expanded', String(!history.hidden)); historyControl.title = persistent() ? 'History' : 'History · view changes are temporary in this host';
    historyEmpty.hidden = !!current?.conversation?.messages.length || !!current?.requests.length; openHistory.hidden = !options.onOpenSubject || !projection.historyResource;
    historyBack.disabled = presentationBusy;
    const rows: HTMLElement[] = [], retained = new Set<string>();
    const saved = current?.requests ?? [], pinnedIds = new Set(presentation().pinnedRequestIds), ordered = [...saved.filter(request => pinnedIds.has(request.id)).reverse(), ...saved.slice(-80).reverse().filter(request => !pinnedIds.has(request.id))];
    for (const request of ordered) {
      if (current?.conversation?.resourceId !== request.conversationId) continue;
      retained.add(request.id); const pinned = presentation().pinnedRequestIds.includes(request.id), signature = JSON.stringify([request.intent, pinned, persistent()]), cached = historyRows.get(request.id);
      if (cached?.signature === signature) { rows.push(cached.node); for (const control of Array.from(cached.node.children)) if (control.tagName.toLowerCase() === 'button') (control as HTMLButtonElement).disabled = presentationBusy || !persistent(); continue; }
      const row = el('div', 'vela-core-history-item'); row.dataset.requestId = request.id; row.dataset.pinned = String(pinned); row.append(el('span', 'vela-core-secondary', (pinned ? 'Pinned · ' : '') + request.intent));
      const reopen = button('Reopen response', async () => { viewRevision++; await updatePresentation({ view: 'current', selectedRequestId: request.id, dismissedRequestIds: presentation().dismissedRequestIds.filter(id => id !== request.id) }); if (!disposed) manifestation.focus(); }); reopen.disabled = presentationBusy || !persistent(); reopen.title = persistent() ? 'Reopen this saved response' : 'Saved response choices are unavailable in this host'; row.append(reopen); historyRows.set(request.id, { node: row, signature }); rows.push(row);
    }
    reconcile(historyRequests, rows); for (const id of historyRows.keys()) if (!retained.has(id)) historyRows.delete(id);
    if (current) renderPlans(current);
    if (!busy && (selectedRequest || current)) { renderStatus({ requests: selectedRequest ? [selectedRequest] : current!.requests, plans: current?.plans ?? [], receipts: current?.receipts ?? [] }); if (selectedRequest?.state === 'responded' && projection.kind === 'insight' && !projection.currentMessageId) { status.textContent = 'This response is unavailable or its attribution could not be verified. Review history before using it.'; status.hidden = false; } if (projection.kind === 'none' && current?.requests.at(-1) && presentation().dismissedRequestIds.includes(current.requests.at(-1)!.id)) status.hidden = true; }
    updatePresence(); emitManifestation();
  }
  function present() {
    if (disposed) return;
    const latest = immediateLocal?.request ?? current?.requests.at(-1), pendingAttention = current?.attention.some(item => !item.reviewedAt && !item.dismissedAt);
    let phase: VelaPanelPresentation['phase'] = 'idle';
    if (!errorBox.hidden) phase = 'error';
    else if (applyingLocally || applyingPlans.size || current?.plans.some(plan => plan.state === 'applying')) phase = 'applying';
    else if (current?.requests.some(request => request.state === 'planning')) phase = 'planning';
    else if (busy && status.dataset.requestState === 'submitting') phase = 'thinking';
    else if (latest && ['failed', 'unknown', 'invalid-plan', 'provider-unavailable'].includes(latest.state)) phase = 'error';
    else if (current?.plans.some(plan => ['prepared', 'approved'].includes(plan.state))) phase = 'review';
    else if (activeContext === 'attention' && pendingAttention) phase = 'attention';
    else if (nativeBusy || intent.value.length) phase = 'receiving';
    shell.dataset.phase = phase;
    stop.hidden = !busy && phase !== 'planning' && phase !== 'applying';
    const value: VelaPanelPresentation = Object.freeze({ phase, context: activeContext, messageIds: Object.freeze([...new Set([...(current?.conversation?.messages.slice(-80).map(message => message.id) ?? []), ...(immediateLocal ? [immediateLocal.result.messageId] : [])])]), planIds: Object.freeze(current?.plans.filter(plan => planCards.has(plan.id)).map(plan => plan.id) ?? []) });
    const signature = JSON.stringify(value); if (signature === presentationSignature) return; presentationSignature = signature;
    try { options.onPresentation?.(value); } catch { /* Presentation observers cannot fail a canonical request or editor action. */ }
    emitManifestation();
  }
  async function run(action: () => unknown) { if (disposed) return; try { await action(); } catch (error) { if (!disposed) { status.dataset.actionState = 'failed'; errorBox.hidden = false; const details = disclosure('Error details', 'vela-core-error-details'); details.body.append(el('pre', undefined, error instanceof Error ? error.message : String(error))); errorBox.replaceChildren(el('p', undefined, 'That could not be completed. Your text is still here.'), details.node, button('Dismiss', () => { errorBox.hidden = true; present(); })); present(); } } }
  function available(action: VelaNativeAction['type']) { const advertised = (current as (VelaState & { nativeCapabilities?: Record<string, { available: boolean }> }) | null)?.nativeCapabilities; return advertised ? advertised[action]?.available === true : !!current?.capabilities.some(capability => capability.id === action); }
  function updateWorkspaceAvailability() {
    createNote.disabled = createTask.disabled = nativeBusy || !available('createResource');
    workspaceCreate.disabled = nativeBusy || !available('workspaceFromResources') || !!nativeProject.selectedOptions[0]?.disabled || !selected.size;
    nativeAvailability.textContent = nativeBusy ? 'Completing the local action…' : (!available('createResource') ? 'Note and task creation is unavailable here. ' : '') + (!available('workspaceFromResources') ? 'Workspace organization is unavailable in this app.' : !selected.size ? 'Choose sources to organize them into a workspace.' : nativeProject.selectedOptions[0]?.disabled ? 'Choose an available project before creating the workspace.' : 'The selected sources keep their original identities.');
    timelineTools.node.hidden = !available('createTimeline');
    activityTimeline.disabled = nativeBusy || timelineTools.node.hidden;
    developmentTimeline.disabled = activityTimeline.disabled || !githubRepository(repositoryInput.value);
  }
  function renderStatus(state: Pick<VelaState, 'requests' | 'plans' | 'receipts'>) { const recorded = velaPanelStatus(state); status.dataset.requestState = recorded.requestState; if (recorded.requestId) status.dataset.requestId = recorded.requestId; else delete status.dataset.requestId; if (recorded.planState) status.dataset.planState = recorded.planState; else delete status.dataset.planState; delete status.dataset.actionState; delete status.dataset.refreshState; status.textContent = recorded.message; status.hidden = recorded.requestState === 'idle'; }
  function renderConversation(state: VelaState) {
    const items = state.conversation?.messages.slice(-80) ?? [], target: HTMLElement[] = [];
    for (const message of items) { const signature = JSON.stringify(message), cached = messages.get(message.id); if (cached?.signature === signature) { target.push(cached.node); continue; }
      const entry = el('article', 'vela-core-message'); entry.dataset.messageId = message.id; entry.dataset.source = message.source;
      entry.append(el('strong', 'vela-core-message-author', message.source === 'provider' ? providerName(message.providerId) + ' · contribution' : message.role === 'user' ? 'You' : 'Vela'), el('p', undefined, message.content)); messages.set(message.id, { node: entry, signature }); target.push(entry);
    }
    for (const child of Array.from(conversation.children)) if (!target.includes(child as HTMLElement)) child.remove(); target.forEach((node, index) => { if (conversation.children[index] !== node) conversation.insertBefore(node, conversation.children[index] ?? null); });
    for (const [id, cached] of messages) if (!target.includes(cached.node)) messages.delete(id);
  }
  function effect(action: PlanStep['action'], plan: VelaPlan): string {
    const request = current?.requests.find(item => item.id === plan.requestId), refs = [...plan.targets, ...(request?.context.discovered ?? []), ...(current?.applicationContext?.references ?? [])], name = (id: string, kind?: ResourceRef['kind']) => refs.find(ref => ref.id === id && (!kind || ref.kind === kind))?.title ?? 'the selected item';
    switch (action.type) {
      case 'setAttentionMode': return 'Set Vela attention to ' + action.mode;
      case 'createCollection': return 'Create collection “' + action.title + '”' + (action.projectId ? ' in ' + name(action.projectId, 'project') : '');
      case 'renameCollection': return 'Rename ' + name(action.collectionId, 'collection') + ' to “' + action.title + '”';
      case 'archiveCollection': return (action.archived ? 'Archive ' : 'Restore ') + name(action.collectionId, 'collection');
      case 'collectionMembership': return (action.member ? 'Add ' : 'Remove ') + name(action.resourceId, 'resource') + (action.member ? ' to ' : ' from ') + name(action.collectionId, 'collection');
      case 'createConversation': return 'Create an empty ' + (action.providerId === 'codex-app-server' ? 'Codex' : 'local') + ' conversation “' + action.title + '”';
      case 'conversationFavorite': return (action.favorite ? 'Favorite ' : 'Remove favorite from ') + name(action.resourceId);
      case 'renameConversation': return 'Rename ' + name(action.resourceId) + ' to “' + action.title + '”';
      case 'associateConversationProject': return 'Associate ' + name(action.resourceId) + ' with ' + (action.projectId ? name(action.projectId) : 'No project');
      case 'createProject': return 'Create project “' + action.title + '”';
      case 'renameProject': return 'Rename project ' + name(action.projectId, 'project') + ' to “' + action.title + '”';
      case 'renameResource': return 'Rename ' + name(action.resourceId, 'resource') + ' to “' + action.title + '”';
      case 'associateResourceProject': return 'Change ' + name(action.resourceId, 'resource') + ' project to ' + (action.projectId ? name(action.projectId, 'project') : 'No project');
      case 'createWorkspace': return 'Create workspace “' + action.title + '”' + (action.projectId ? ' in ' + name(action.projectId) : '');
      case 'createTimeline': {
        const destination = action.workspaceId ? name(action.workspaceId, 'workspace') : action.projectId ? name(action.projectId, 'project') : 'Resources';
        const source = action.source.kind === 'application-activity' ? 'recent Aerynth activity' :
          'up to 30 default-branch commits from the past 90 days at ' + action.source.repositoryUrl;
        return 'Save “' + action.title + '” in ' + destination + ' using ' + source;
      }
      case 'renameWorkspace': return 'Rename ' + name(action.workspaceId) + ' to “' + action.title + '”';
      case 'taskPriority': return 'Set ' + name(action.resourceId) + ' priority to ' + action.priority;
      case 'bringAllIntoView': return 'Bring all blocks in ' + name(action.workspaceId) + ' into the current view';
      case 'resolveLayout': return 'Resolve block overlaps in ' + name(action.workspaceId);
      case 'setOrganization': return 'Set ' + name(action.workspaceId) + ' organization to ' + action.organization.mode;
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
    const projection = project(), activeCards: HTMLElement[] = [], earlierCards: HTMLElement[] = [], visible = new Set<string>();
    for (const plan of [...state.plans].reverse()) {
      if (!state.conversation || !state.requests.some(request => request.id === plan.requestId && request.planId === plan.id && request.conversationId === state.conversation!.resourceId)) continue;
      const required = projection.requiredPlanIds.includes(plan.id), active = required || plan.id === projection.currentPlanId && view() === 'current'; if (!active && earlierCards.length >= 8) continue;
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
      const timelineResult = (state = current) => {
        const steps = new Set(plan.steps.filter(step => step.action.type === 'createTimeline').map(step => step.id));
        return state?.receipts.find(receipt => receipt.planId === plan.id && steps.has(receipt.stepId) && receipt.state === 'applied' && receipt.hostReceiptId)?.createdResourceId;
      };
      const perform = async (approve: boolean) => {
        if (workingPlans.has(plan.id)) return;
        const previousFocus = doc.activeElement, returnFocus = controls.contains(previousFocus);
        workingPlans.add(plan.id); setPlanBusy(plan.id, true);
        try {
          if (approve) await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
          applyingPlans.add(plan.id); present();
          await client.apply(plan.id);
          const timelineId = timelineResult(await refresh());
          if (timelineId && observing) options.onOpenSubject?.({ kind: 'resource', id: timelineId });
          else if (returnFocus && (doc.activeElement === previousFocus || doc.activeElement === doc.body))
            plans.querySelector<HTMLElement>('[data-plan-id="' + plan.id + '"]')?.focus();
        } finally {
          workingPlans.delete(plan.id); applyingPlans.delete(plan.id); setPlanBusy(plan.id, false); present();
        }
      };
      if (plan.state === 'prepared') controls.append(button('Approve and apply', () => perform(true)), button('Reject plan', async () => { await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'reject' }); await refresh(); }));
      if (plan.state === 'approved') controls.append(button('Apply approved plan', () => perform(false))); card.append(controls);
      if (timelineResult()) controls.append(button('Open saved Timeline', () => { const id = timelineResult(); if (id) options.onOpenSubject?.({ kind: 'resource', id }); }));
      if (receipts.length) card.append(el('p', 'vela-core-receipt', confirmed + ' of ' + plan.steps.length + ' steps confirmed' + (receipts.some(receipt => ['failed', 'unknown'].includes(receipt.state)) ? ' · review details before trying again' : '')));
      const details = disclosure('Plan details and evidence', 'vela-core-plan-details'); details.node.open = cached?.node.querySelector<HTMLDetailsElement>('details')?.open ?? false; details.body.append(el('pre', undefined, JSON.stringify({ actions: plan.steps, targets: plan.targets, provider: plan.contribution, receipts }, null, 2))); card.append(details.node);
      planCards.set(plan.id, { node: card, controls, signature }); setPlanBusy(plan.id, workingPlans.has(plan.id)); target.push(card);
    }
    reconcile(planHistory.body, earlierCards); planHistory.node.hidden = !earlierCards.length; reconcile(plans, activeCards);
    for (const id of planCards.keys()) if (!visible.has(id)) planCards.delete(id);
  }
  function setPlanBusy(id: string, pending: boolean) { const controls = planCards.get(id)?.controls; if (controls) for (const child of Array.from(controls.children)) (child as HTMLButtonElement).disabled = pending; }
  function reconcile(parent: HTMLElement, children: HTMLElement[]) { for (const child of Array.from(parent.children)) if (!children.includes(child as HTMLElement)) child.remove(); children.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null); }); }
  function render(state: VelaState) {
    if (disposed) return; current = state; immediateLocal = null;
    provider.textContent = state.planner.available ? providerName(state.planner.providerId) + (state.planner.busy ? ' · busy' : ' · available') : 'Provider unavailable';
    providerHint.textContent = state.planner.available ? 'Context sharing needs approval.' : 'Provider unavailable.';
    providerConsent.firstElementChild!.textContent = 'Use ' + providerName(state.planner.providerId) + ' for this request';
    allowProvider.disabled = !state.planner.available || state.planner.busy; if (chosenProviderId !== state.planner.providerId) { allowProvider.checked = false; chosenProviderId = null; } renderProviderChoice();
    const chosen = projectChosen ? nativeProject.value : state.applicationContext?.currentProjectId ?? ''; nativeProject.replaceChildren(); const global = el('option', undefined, 'No project'); global.value = ''; nativeProject.append(global);
    for (const ref of state.applicationContext?.references.filter(ref => ref.kind === 'project') ?? []) { const option = el('option', undefined, ref.title); option.value = ref.id; nativeProject.append(option); }
    if (chosen && !Array.from(nativeProject.options).some(option => option.value === chosen)) { const unavailable = el('option', undefined, 'Previously selected project · unavailable'); unavailable.value = chosen; unavailable.disabled = true; nativeProject.append(unavailable); } nativeProject.value = chosen; updateWorkspaceAvailability();
    renderConversation(state); contextBody.replaceChildren();
    if (state.conversation) contextBody.append(el('p', 'vela-core-meta', 'Conversation ' + state.conversation.resourceId + ' · revision ' + state.conversation.revision));
    for (const request of state.requests.slice(-6).reverse()) { const item = disclosure(request.intent, 'vela-core-request-details'); item.body.append(el('p', undefined, velaPanelStatus({ requests: [request], plans: state.plans, receipts: state.receipts }).message), el('p', 'vela-core-meta', 'Included sources: ' + (request.context.included.map(ref => ref.title).join(', ') || 'none')), el('pre', undefined, JSON.stringify({ state: request.state, error: request.errorCode, manifest: request.context, invalidProposal: request.invalidProposal }, null, 2))); contextBody.append(item.node); }
    mode.value = state.preferences.mode; monitor.checked = state.preferences.monitoringEnabled; delegation.checked = state.preferences.delegationEnabled; eventTypes.value = state.preferences.allowedEventTypes.join(', '); severity.value = state.preferences.minimumSeverity; budget.value = String(state.preferences.maxInterruptionsPerHour); renderAdaptation(state);
    const pending = state.attention.filter(item => !item.reviewedAt && !item.dismissedAt); attentionPanel.summary.textContent = pending.length ? pending.length + (pending.length === 1 ? ' update to review' : ' updates to review') : state.preferences.monitoringEnabled ? 'No new updates in your digest' : 'Attention digest is paused'; attention.replaceChildren();
    attentionControl.dataset.pendingCount = String(pending.length); attentionControl.setAttribute('aria-label', pending.length ? 'Attention, ' + pending.length + (pending.length === 1 ? ' update' : ' updates') : 'Attention');
    if (!state.preferences.monitoringEnabled) attention.append(el('p', 'vela-core-secondary', 'New app activity is paused. Saved updates remain until you review them.'));
    for (const item of pending.slice(-20).reverse()) { const row = el('article', 'vela-core-update'); row.append(el('p', undefined, item.summary)); if (item.subject && options.onOpenSubject) row.append(button('Open source', () => options.onOpenSubject?.(item.subject!))); row.append(button('Mark reviewed', async () => { await client.reviewAttention([item.id]); await refresh(); })); const evidence = disclosure('Why this update', 'vela-core-update-details'); evidence.body.append(el('p', undefined, item.reason), el('pre', undefined, JSON.stringify({ source: item.source, occurredAt: item.occurredAt, classification: item.classification, disposition: item.disposition, coverageGap: item.coverageGap }, null, 2))); row.append(evidence.node); attention.append(row); }
    stop.hidden = !busy && !state.requests.some(request => request.state === 'planning'); renderReading(); present();
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
  async function refresh() { const sequence = ++readSequence, state = await client.state(); if (sequence === readSequence) render(state); return state; }
  void run(refresh);
  return {
    async open() { observing = true; const sequence = ++readSequence, state = await client.open(); if (sequence === readSequence) render(state); return state; },
    refresh,
    /** Host visibility notification only; no canonical mutation or inference. */
    close() { observing = false; manifestationSignature = ''; manifestationBaseline = true; try { options.onManifestation?.(null); } catch {} },
    dispose() { disposed = true; observing = false; readSequence++; shell.remove(); try { options.onManifestation?.(null); } catch {} },
  };
}
