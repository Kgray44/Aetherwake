import { LOCAL_FACT_LABELS } from './capabilities.ts';
import { VELA_PROJECT_CHECK_LABELS } from './contracts.ts';
import type { ResourceRef, VelaClient, VelaMessage, VelaNativeAction, VelaState, VelaPlan, PlanStep, VelaPresentationState, VelaPresentationPatch, VelaLocalFacts } from './contracts.ts';
import { velaPanelStatus } from './panel-status.ts';
import { confirmedVelaPlan, projectVelaManifestation, type VelaManifestationState } from './manifestation-state.ts';
import { summarizeSystemMemory } from './system-information.ts';
import { createVelaProposalView, type VelaProposalChoice } from './proposal-view.ts';
import { githubRepository } from '../../application-contract/github-timeline.ts';
import type { MissionPlanningOffer, MissionPreview } from '../../integrated-backend/src/mission-contracts.mts';

function conciseObservedAnswer(content:string|undefined,facts:VelaLocalFacts|undefined){
  if(!content)return '';
  if(facts?.kind==='system-memory')return summarizeSystemMemory(facts.measurement);
  if(facts?.kind==='system-utilization')return `${facts.measurement.metric.toUpperCase()} usage: ${facts.measurement.percent}%.`;
  if(facts?.kind==='system-performance')return facts.measurements.map(value=>`${value.metric.toUpperCase()}: ${value.percent}%`).join(' · ')+'.';
  return content;
}

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
  onOpenConnections?: () => void;
  /** Observational only. The first hydrated value is a baseline, not a history-arrival event. */
  onPresentation?: (value: VelaPanelPresentation) => void;
  /** Real stable nodes for the host's existing MotionCoordinator/geometry; observational only, null retires them. */
  onManifestation?: (value: VelaPanelManifestation | null) => void;
  listTimelineRepositories?: () => Promise<string[]>;
  voice?: { element: HTMLElement; setVisible(visible: boolean): void; start(intent?: string): Promise<void>;
    speak?(message:{id:string;content:string}):Promise<void>;stopSpeech?(attemptId:string):Promise<void>;
    subscribe?(listener: (value: { active: boolean; microphoneOn: boolean; speaking: boolean; speech?:{state:string;messageId:string|null;attemptId:string|null;contentDigest:string|null} }) => void): () => void };
  permissions?: { element: HTMLElement; setVisible(visible: boolean): void };
  missions?: {
    element: HTMLElement;
    preview(intent: string, agentProfileId?: string): Promise<MissionPreview | MissionPlanningOffer | null>;
    review(preview: MissionPreview | MissionPlanningOffer, onStarted: (missionId: string) => void, agentProfileId?: string): void;
    openReport?(id: string): void;
    setVisible(visible: boolean): void;
  };
}
export interface VelaPanelManifestation {
  projection: Readonly<VelaManifestationState>; view: 'current' | 'history'; baseline: boolean;
  elements: { shell: HTMLElement; reading: HTMLElement; manifestation: HTMLElement; composer: HTMLFormElement };
}
const providerName = (id: string | null | undefined) => id === 'codex-app-server' ? 'Codex' : id === 'chatgpt-plan-responses' ? 'ChatGPT plan' : id === 'openai-api-vela' ? 'Vela API' : id || 'Provider';
let panelSequence = 0;
/** Content for the existing host-anchored surface. Mount/open never starts inference or applies actions. */
export function mountVelaPanel(root: HTMLElement, client: VelaClient, options: VelaPanelOptions = {}) {
  const doc = root.ownerDocument;
  let current: VelaState | null = null, disposed = false, busy = false, nativeBusy = false, composing = false, draftRevision = 0, lastDisclosure: HTMLDetailsElement | null = null;
  let activeContext: string | null = null, contextTrigger: HTMLButtonElement | null = null, chosenProviderId: string | null = null, presentationSignature = '';
  let handoffSelection: { requestId: string; sourceProviderId: string } | null = null;
  let routingAgentSelection: ResourceRef | null = null;
  let manifestationSignature = '', manifestationBaseline = true, observing = true, presentationBusy = false, readSequence = 0, viewRevision = 0, transientView: 'current' | 'history' | null = null;
  const instanceId = 'vela-context-' + ++panelSequence;
  const selected = new Map<string, ResourceRef>(), sourceControls = new Map<string, HTMLInputElement>();
  const messages = new Map<string, { node: HTMLElement; signature: string }>(), workingPlans = new Set<string>(), applyingPlans = new Set<string>();
  let applyingLocally = false;
  const planCards = new Map<string, { node: HTMLElement; controls: HTMLElement; signature: string }>();
  const planReviewActions = new Map<string, {accept():Promise<void>;decline():Promise<void>}>();
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
  const fileEditActions = el('div', 'vela-manifestation-actions');
  fileEditActions.hidden = true;
  let fileEditBusy = false;
  let responseSignature = '';
  let replySpeech:{state:string;messageId:string|null;attemptId:string|null;contentDigest:string|null}|undefined;
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
  const handoffButton = button('Continue with another provider', () => {
    const request = current?.requests.find(item => item.id === project().currentRequestId);
    const destination = handoffButton.dataset.destination;
    if (busy || !request?.providerId || !destination) return;
    handoffSelection = { requestId: request.id, sourceProviderId: request.providerId };
    if (chosenProviderId !== destination) clearModelOptions();
    chosenProviderId = destination;
    if (routeMode.value === 'codex' && destination !== 'codex-app-server') routeMode.value = 'auto';
    routeHistory.checked = false;
    renderProviderChoice();
    renderSelection();
    intent.focus();
  });
  handoffButton.hidden = true;
  const rateResponse = (feedback: 'useful' | 'needs-correction') => async () => {
    const requestId = project().currentRequestId;
    if (!requestId || !client.rateRoutingResponse) return;
    await client.rateRoutingResponse({ requestId, feedback });
    await refresh();
  };
  const useful = button('Mark useful', rateResponse('useful')), needsCorrection = button('Mark needs correction', rateResponse('needs-correction'));
  useful.hidden = needsCorrection.hidden = true;
  const responseActions = el('div', 'vela-manifestation-actions'); responseActions.append(handoffButton, useful, needsCorrection, pin, dismiss);
  manifestation.tabIndex = -1; manifestation.append(manifestationKicker, localAlongsidePlan, manifestationBody, plans, fileEditActions);
  const more = el('section', 'vela-core-contextual vela-core-more'); more.hidden = true; more.id = instanceId; more.setAttribute('aria-label', 'Vela controls');
  const resultPanel = disclosure('Plan and response details', 'vela-core-result-panel');
  const resultPlans = el('div', 'vela-core-result-plans');
  const fileProposalDetails=el('section','vela-file-proposal-receipt');
  resultPanel.body.append(resultPlans, fileProposalDetails, manifestationSources, manifestationDetails.node, fileEditActions, responseActions);
  const resultControl = icon('Open response details', '▤', 'result', () => reveal('result'));
  const chooseFiles = async (choice: Readonly<VelaProposalChoice>, accept: boolean) => {
    const proposal = current?.fileProposals?.find(item => item.id + ':' + item.digest === choice.id && item.version === choice.version && item.state === 'proposed');
    if (!proposal || !client.fileProposal) throw Error('file_proposal_unavailable');
    await client.fileProposal({name:accept?'accept':'cancel',input:{id:proposal.id,digest:proposal.digest,expectedVersion:proposal.version}});
    await refresh();
  };
  const fileProposalView = createVelaProposalView(doc,{accept:choice=>chooseFiles(choice,true),decline:choice=>chooseFiles(choice,false),changed:()=>present()});
  const choosePlan = async (choice: Readonly<VelaProposalChoice>, accept: boolean) => {
    const plan=current?.plans.find(item=>item.id+':'+item.fingerprint===choice.id&&item.version===choice.version&&item.state==='prepared');
    const action=plan&&planReviewActions.get(plan.id); if(!action)throw Error('plan_proposal_unavailable');
    await (accept?action.accept():action.decline());
  };
  const planProposalView = createVelaProposalView(doc,{accept:choice=>choosePlan(choice,true),decline:choice=>choosePlan(choice,false),changed:()=>present()});
  const contextualClose = icon('Close Vela controls', '×', 'close', () => closeContext()); contextualClose.className += ' vela-core-contextual-close';
  const sourcePanel = disclosure('Find and add sources', 'vela-core-source-panel');
  const localFilesPanel=disclosure('Add files or folders','vela-core-local-files');
  const pickLocalSources=async(kind:'files'|'folder')=>{
    if(!client.pickSources)throw Error('source_picker_unavailable');
    const picked=await client.pickSources({kind,destination:'context'});
    for(const source of picked.resources){
      const version=source.version;
      if(!Number.isSafeInteger(version)||!version||version<1)throw Error('source_version_unavailable');
      selected.set(source.id,{id:source.id,kind:'resource',resourceKind:source.kind,title:source.title,version,projectId:source.projectId});
    }
    renderSelection();
  };
  localFilesPanel.body.append(button('Choose files…',()=>pickLocalSources('files')),button('Choose a folder…',()=>pickLocalSources('folder')));
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
        if (ref.resourceKind === 'agent' && current?.planningProviders) row.append(button('Use agent profile', () => {
          if (busy) return;
          routingAgentSelection = ref;
          renderSelection();
          closeContext(false);
          intent.focus();
        }));
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
      workspaceId: current?.applicationContext?.currentWorkspaceId ?? null },
      'Create ' + title + (source.kind === 'github-commits' ? ' from ' + source.repositoryUrl.trim() : ''));
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
  const missionsPanel = disclosure('Missions', 'vela-core-missions');
  if (options.missions) missionsPanel.body.append(options.missions.element);
  const voicePanel = disclosure('Voice', 'vela-core-voice');
  if (options.voice) voicePanel.body.append(options.voice.element);
  const adaptationPanel = disclosure('Personalization', 'vela-core-adaptation'), adaptationBody = adaptationPanel.body;
  const contextPanel = disclosure('Request details and sources', 'vela-core-context'), contextBody = contextPanel.body;
  const preferencesPanel = disclosure('Preferences', 'vela-core-preferences'); preferencesPanel.body.append(settings.node, adaptationPanel.node, contextPanel.node);
  if (options.permissions) preferencesPanel.body.append(options.permissions.element);
  more.append(contextualClose, resultPanel.node, sourcePanel.node, native.node, preferencesPanel.node, connection.node, attentionPanel.node);
  if(client.pickSources)more.append(localFilesPanel.node);
  if (options.missions) more.append(missionsPanel.node);
  if (options.voice) more.append(voicePanel.node);
  flow.append(manifestation, history, more);
  const status = el('p', 'vela-core-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
  const errorBox = el('div', 'vela-core-error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const form = el('form', 'vela-core-compose'), intent = el('textarea'), allowProvider = el('input');
  intent.rows = 2; intent.maxLength = 16000; intent.required = true; intent.placeholder = 'Vela…'; intent.setAttribute('aria-label', 'Message Vela');
  allowProvider.type = 'checkbox'; const providerConsent = label('Use the planning provider for this request', allowProvider); providerConsent.className += ' vela-core-consent';
  let useAutomaticOnce = false;
  connection.body.prepend(providerConsent); const providerChoice = icon('Remove planning provider from next request', '×', 'close', () => { allowProvider.checked = false; chosenProviderId = null; useAutomaticOnce = !!current?.routingSettings; routeMode.value = 'auto'; clearModelOptions(); renderProviderChoice(); intent.focus(); }); providerChoice.className += ' vela-core-provider-choice'; providerChoice.hidden = true;
  const providerChoiceName = el('span', 'vela-core-provider-choice-name'); providerChoice.prepend(providerChoiceName);
  const providerRoutes = el('div', 'vela-core-provider-routes');
  providerRoutes.hidden = true;
  const routeMode = el('select', 'vela-core-input'), routeModel = el('select', 'vela-core-input'), routeEffort = el('select', 'vela-core-input');
  const routeEscalation = el('input');
  routeEscalation.type = 'checkbox';
  const routeHistory = el('input');
  routeHistory.type = 'checkbox';
  const modes = [['auto', 'Auto'], ['fast', 'Fast'], ['deep', 'Deep'], ['codex', 'Codex'], ['custom', 'Custom']] as const;
  function setOptions(select: HTMLSelectElement, values: readonly (readonly [string, string])[]) {
    select.replaceChildren(...values.map(([id, title]) => {
      const option = el('option', undefined, title);
      option.value = id;
      return option;
    }));
  }
  setOptions(routeMode, modes);
  let modelOptions: Awaited<ReturnType<NonNullable<VelaClient['routingOptions']>>> = [];
  const updateEfforts = () => {
    const efforts = modelOptions.find(model => model.id === routeModel.value)?.reasoningEfforts ?? [];
    setOptions(routeEffort, [['', 'Provider default'], ...efforts.map(effort => [effort, effort] as const)]);
    routeEffort.disabled = efforts.length === 0;
  };
  const clearModelOptions = () => {
    modelOptions = [];
    setOptions(routeModel, [['', 'Automatic model']]);
    routeModel.disabled = true;
    updateEfforts();
  };
  clearModelOptions();
  routeModel.addEventListener('change', updateEfforts);
  const refreshModels = button('Load connected models', () => {
    const providerId = chosenProviderId ?? (routeMode.value === 'codex' ? 'codex-app-server' : null);
    if (!providerId || !client.routingOptions) return;
    void run(async () => {
      const options = await client.routingOptions!({ providerId });
      if (providerId !== (chosenProviderId ?? (routeMode.value === 'codex' ? 'codex-app-server' : null))) return;
      modelOptions = options;
      setOptions(routeModel, [['', 'Automatic model'], ...options.map(model => [model.id, model.label] as const)]);
      routeModel.disabled = options.length === 0;
      updateEfforts();
    });
  });
  routeMode.addEventListener('change', () => {
    useAutomaticOnce = routeMode.value === 'auto' && !!current?.routingSettings;
    if (routeMode.value === 'codex') chosenProviderId = 'codex-app-server';
    clearModelOptions();
    renderProviderChoice();
  });
  for (const [id, title] of [['', 'Automatic'], ['openai-api-vela', 'Vela API'], ['chatgpt-plan-responses', 'ChatGPT plan'], ['codex-app-server', 'Codex']]) {
    const route = button(title, () => {
      chosenProviderId = id || null;
      useAutomaticOnce = !id && !!current?.routingSettings;
      if (!id || routeMode.value === 'codex') routeMode.value = 'auto';
      clearModelOptions();
      renderProviderChoice();
      closeContext(false);
      intent.focus();
    });
    route.dataset.providerRoute = id;
    route.dataset.aerynthMotionControl = 'true';
    providerRoutes.append(route);
  }
  if (options.onOpenConnections) providerRoutes.append(button('Manage connections', options.onOpenConnections));
  if (client.routingOptions) providerRoutes.append(label('Routing mode', routeMode), refreshModels, label('Model', routeModel),
    label('Reasoning effort', routeEffort), label('Allow one deeper attempt if Auto hits an output limit', routeEscalation));
  providerRoutes.append(label('Start fresh for this send', routeHistory));
  const savedRoutes = disclosure('Saved routing defaults', 'vela-core-routing-defaults');
  const scopeChoice = el('select', 'vela-core-input');
  const effectiveRoute = el('p', 'vela-core-meta');
  effectiveRoute.setAttribute('aria-live', 'polite');
  const selectedRoutingProfile = () => current?.routingSettings?.profiles.find(item => item.scope === (scopeChoice.value || 'global'));
  const saveDefaults = (reset: boolean) => void run(async () => {
    const profile = selectedRoutingProfile();
    if (!profile || !client.saveRoutingSettings) return;
    const defaults: import('./routing-settings.ts').VelaRoutingDefaults = reset ? {} : {
      mode: (routeMode.value || 'auto') as typeof modes[number][0],
      providerId: chosenProviderId as import('./routing-settings.ts').VelaRoutingDefaults['providerId'] ?? null,
      model: routeModel.value || null,
      reasoningEffort: (routeEffort.value || null) as import('./routing-settings.ts').VelaRoutingDefaults['reasoningEffort'],
    };
    if (profile.defaults.attemptLimits) defaults.attemptLimits = profile.defaults.attemptLimits;
    if (profile.defaults.calibration) defaults.calibration = profile.defaults.calibration;
    await client.saveRoutingSettings({ scope: profile.scope, id: profile.id, expectedVersion: profile.version, defaults });
    chosenProviderId = null;
    useAutomaticOnce = false;
    routeMode.value = 'auto';
    clearModelOptions();
    await refresh();
  });
  savedRoutes.body.append(effectiveRoute, label('Save defaults for', scopeChoice),
    button('Save current mode and pins', () => saveDefaults(false)),
    button('Reset this scope to inherited', () => saveDefaults(true)));
  const quotaEditor = disclosure('Daily provider attempt limits', 'vela-core-routing-limits');
  const quotaUsage = el('p', 'vela-core-meta');
  const quotaFields = (['total', 'openai-api-vela', 'chatgpt-plan-responses', 'codex-app-server'] as const).map(provider => {
    const control = el('input', 'vela-core-input');
    control.type = 'number'; control.min = '0'; control.max = '10000'; control.step = '1';
    quotaEditor.body.append(label(provider === 'total' ? 'All provider attempts' : providerName(provider) + ' attempts', control));
    return { provider, control };
  });
  quotaEditor.body.append(el('p', 'vela-core-meta', 'Global and project limits both apply. Counts reset at midnight UTC. Blank leaves that limit unset.'),
    quotaUsage, button('Save attempt limits', () => void run(async () => {
      const profile = selectedRoutingProfile();
      if (!profile || !client.saveRoutingSettings || (profile.scope !== 'global' && profile.scope !== 'project')) return;
      const attemptLimits: NonNullable<import('./routing-settings.ts').VelaRoutingDefaults['attemptLimits']> = {};
      for (const { provider, control } of quotaFields) {
        if (control.value !== '') attemptLimits[provider] = Number(control.value);
      }
      const { attemptLimits: _previous, ...defaults } = profile.defaults;
      await client.saveRoutingSettings({ scope: profile.scope, id: profile.id, expectedVersion: profile.version,
        defaults: Object.keys(attemptLimits).length ? { ...defaults, attemptLimits } : defaults });
      await refresh();
    })));
  savedRoutes.body.append(quotaEditor.node);
  const calibrationEditor = disclosure('Routing measurements', 'vela-core-routing-calibration');
  const calibrationSelect = el('select', 'vela-core-input');
  setOptions(calibrationSelect, [['', 'Use inherited setting'], ['off', 'Off'], ['observe', 'Record local measurements'],
    ['shadow', 'Compare without switching'], ['adaptive', 'Choose a qualified faster model']]);
  const calibrationStatus = el('p', 'vela-core-meta');
  calibrationEditor.body.append(label('Measurement mode', calibrationSelect),
    el('p', 'vela-core-meta', 'Off by default. Eligible conversations record local timing, token counts and your feedback. Project settings can limit the global mode.'),
    calibrationStatus, button('Save measurement mode', () => void run(async () => {
      const profile = selectedRoutingProfile();
      if (!profile || !client.saveRoutingSettings || (profile.scope !== 'global' && profile.scope !== 'project')) return;
      const { calibration: _previous, ...defaults } = profile.defaults;
      const calibration = calibrationSelect.value as NonNullable<typeof profile.defaults.calibration> | '';
      await client.saveRoutingSettings({ scope: profile.scope, id: profile.id, expectedVersion: profile.version,
        defaults: calibration ? { ...defaults, calibration } : defaults });
      await refresh();
    })));
  savedRoutes.body.append(calibrationEditor.node);
  scopeChoice.addEventListener('change', () => renderRoutingQuotas());
  function renderRoutingQuotas() {
    const profile = selectedRoutingProfile();
    quotaEditor.node.hidden = !profile || (profile.scope !== 'global' && profile.scope !== 'project');
    calibrationEditor.node.hidden = quotaEditor.node.hidden;
    if (!profile || quotaEditor.node.hidden) return;
    const signature = [profile.scope, profile.id, profile.version].join(':');
    if (quotaEditor.node.dataset.settingsSignature !== signature) {
      for (const { provider, control } of quotaFields) {
        const limit = profile.defaults.attemptLimits?.[provider];
        control.value = limit === undefined ? '' : String(limit);
      }
      quotaEditor.node.dataset.settingsSignature = signature;
      calibrationSelect.value = profile.defaults.calibration ?? '';
    }
    const calibration = current?.routingSettings?.calibration;
    calibrationStatus.textContent = calibration ? 'Current mode ' + calibration.mode + ' · ' + calibration.samples + ' observed turns in this project scope.' : '';
    const usage = current?.routingSettings?.attempts;
    quotaUsage.textContent = usage?.limits.filter(item => item.scope === profile.scope).map(item =>
      (item.provider === 'total' ? 'All providers' : providerName(item.provider)) + ' ' + item.used + '/' + item.limit).join(' · ') || 'No attempt limits configured for this scope.';
  }
  savedRoutes.node.hidden = true;
  if (client.saveRoutingSettings) connection.body.append(savedRoutes.node);
  connection.body.prepend(providerRoutes);
  allowProvider.addEventListener('change', () => { chosenProviderId = allowProvider.checked ? current?.planner.providerId ?? null : null; renderProviderChoice(); });
  const selection = el('div', 'vela-core-selection'); selection.setAttribute('aria-label', 'Selected sources'); selection.hidden = true;
  const send = markIcon(el('button', 'vela-core-button vela-core-primary'), 'Send to Vela', '↑', 'send'); send.type = 'submit'; send.disabled = true;
  const stop = icon('Stop', '■', 'stop', async () => { const state = await client.state(), pending = state.requests.findLast(request => request.state === 'planning' || state.plans.some(plan => plan.requestId === request.id && plan.state === 'applying')); if (pending) { await client.cancel(pending.id); await refresh(); } else { status.textContent = 'No request is running.'; } }); stop.hidden = true;
  const sourcesControl = icon('Add sources', '+', 'sources', () => reveal('sources', search)), toolsControl = icon('Local tools', '⋯', 'tools', () => reveal('tools', nativeTitle)), preferencesControl = icon('Vela preferences', '⚙', 'preferences', () => reveal('preferences')), providerControl = icon('Provider', '◇', 'provider', () => reveal('provider', providerRoutes.hidden ? allowProvider : providerRoutes.querySelector('button') ?? undefined)), attentionControl = icon('Attention', '·', 'attention', () => reveal('attention'));
  const historyControl = icon('History', '↶', 'history', () => setView(view() === 'history' ? 'current' : 'history')); historyControl.setAttribute('aria-expanded', 'false'); historyControl.setAttribute('aria-controls', history.id);
  const missionsControl = icon('Missions', '▤', 'missions', () => reveal('missions'));
  const voiceControl = icon('Voice', '♩', 'voice', () => reveal('voice'));
  const localFilesControl=icon('Add files or folders','▤','files',()=>reveal('files'));
  const releaseVoice = options.voice?.subscribe?.(value => {
    replySpeech=value.speech;
    voiceControl.dataset.voiceActive = String(value.active); voiceControl.setAttribute('aria-pressed', String(value.active));
    const description = value.microphoneOn ? 'Microphone on' : value.active ? 'Voice connected; microphone off' : 'Voice off';
    voiceControl.setAttribute('aria-description', description); voiceControl.title = value.speaking ? 'Vela is speaking' : description;
    if(current&&observing)renderReading();
  });
  const contextPanels = new Map([
    ['result', { panel: resultPanel, trigger: resultControl }],
    ['sources', { panel: sourcePanel, trigger: sourcesControl }], ['tools', { panel: native, trigger: toolsControl }], ['preferences', { panel: preferencesPanel, trigger: preferencesControl }], ['provider', { panel: connection, trigger: providerControl }], ['attention', { panel: attentionPanel, trigger: attentionControl }],
  ]);
  if (options.missions) contextPanels.set('missions', { panel: missionsPanel, trigger: missionsControl });
  if (options.voice) contextPanels.set('voice', { panel: voicePanel, trigger: voiceControl });
  if(client.pickSources)contextPanels.set('files',{panel:localFilesPanel,trigger:localFilesControl});
  for (const [key, entry] of contextPanels) { entry.panel.node.hidden = true; entry.panel.node.id = instanceId + '-' + key; entry.trigger.setAttribute('aria-controls', entry.panel.node.id); entry.trigger.setAttribute('aria-expanded', 'false'); entry.panel.node.addEventListener('toggle', () => { if (activeContext === key && !entry.panel.node.open) closeContext(); }); }
  const composeActions = el('div', 'vela-core-compose-actions'); composeActions.append(sourcesControl, toolsControl, preferencesControl, providerControl, attentionControl, historyControl);
  if(client.pickSources)composeActions.prepend(localFilesControl);
  if (options.missions) composeActions.append(missionsControl);
  if (options.voice) composeActions.append(voiceControl);
  composeActions.append(stop, send);
  connection.body.append(providerChoice);
  form.append(intent, selection, composeActions);
  intent.addEventListener('input', () => { draftRevision++; send.disabled = busy || !intent.value.trim(); present(); }); intent.addEventListener('compositionstart', () => { composing = true; }); intent.addEventListener('compositionend', () => { composing = false; });
  intent.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229 && (!event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!busy && intent.value.trim()) form.requestSubmit(); } });
  form.addEventListener('submit', event => { event.preventDefault(); if (busy || !intent.value.trim() || composing) return;
    if (options.voice && /^\s*(?:vela[,!]?\s+)?(?:let['’]?s talk(?: instead)?|switch to voice|start (?:a )?voice(?: conversation)?)[.!?]*\s*$/iu.test(intent.value)) {
      const text = intent.value, revision = draftRevision;
      reveal('voice');
      // Call while the actual Send gesture is active; native authorization owns the start.
      const starting = options.voice.start(text);
      void run(async () => { await starting; if (draftRevision === revision && intent.value === text) { intent.value = ''; draftRevision++; send.disabled = true; } await refresh(); });
      return;
    }
    const connected = !!current?.planningProviders, submitted = { intent: intent.value, resourceIds: [...selected.keys()],...(selected.size?{resourceRefs:[...selected.values()].map(ref=>({...ref}))}:{}), authorizeProvider: connected || allowProvider.checked && chosenProviderId === current?.planner.providerId, ...(connected && chosenProviderId ? { providerId: chosenProviderId } : {}),
    ...(connected && routeMode.value && routeMode.value !== 'auto' ? { mode: routeMode.value as typeof modes[number][0] } : {}),
    ...(connected && routeModel.value ? { model: routeModel.value } : {}),
    ...(connected && routeEffort.value ? { reasoningEffort: routeEffort.value as import('../../openai-provider/model-controls.ts').ReasoningEffort } : {}),
    ...(connected && !routeEscalation.disabled && routeEscalation.checked ? { allowEscalation: true as const } : {}),
    ...(connected && routeHistory.checked ? { includeRecentHistory: false as const } : {}),
    ...(connected && handoffSelection ? { handoffSourceRequestId: handoffSelection.requestId } : {}),
    ...(connected && routingAgentSelection ? { routingAgentId: routingAgentSelection.id } : {}),
    ...(connected && (useAutomaticOnce || handoffSelection && !routingAgentSelection) ? { overrideDefaults: true as const } : {}),
  }, revision = draftRevision, submittedView = ++viewRevision;
    transientView = 'current'; allowProvider.checked = false; useAutomaticOnce = false; routeHistory.checked = routeEscalation.checked = false; if (!connected) chosenProviderId = null; renderProviderChoice(); closeContext(false); renderReading();
    void run(async () => { busy = true; send.disabled = true; stop.hidden = false; form.setAttribute('aria-busy', 'true'); errorBox.hidden = true; status.dataset.requestState = 'submitting'; delete status.dataset.planState; delete status.dataset.actionState; status.hidden = false; status.textContent = 'Checking how to handle this…'; present();
      try {
        const recorded = await client.request(submitted);
        if (disposed) return;
        if (recorded.handoff?.sourceRequestId === handoffSelection?.requestId && recorded.handoff &&
            !['provider-unavailable', 'failed', 'invalid-plan', 'unknown', 'cancelled'].includes(recorded.state)) {
          handoffSelection = null;
          renderSelection();
        }
        if (recorded.routingAgent?.resourceId === routingAgentSelection?.id && recorded.routingAgent &&
            !['provider-unavailable', 'failed', 'invalid-plan', 'unknown', 'cancelled'].includes(recorded.state)) {
          routingAgentSelection = null;
          renderSelection();
        }
        if (!['provider-unavailable','failed','invalid-plan','unknown'].includes(recorded.state) && draftRevision === revision && intent.value === submitted.intent) intent.value = '';
        observeLiveAnswer(undefined);
        await settleSubmittedView(submittedView);
      }
      catch (error) { observeLiveAnswer(undefined); busy = false; try { await refresh(); } catch { status.dataset.requestState = 'unknown'; delete status.dataset.requestId; delete status.dataset.planState; status.hidden = false; status.textContent = 'The request could not be checked. Its outcome is unknown; review the activity before trying again.'; } throw error; }
      finally { busy = false; send.disabled = !intent.value.trim(); form.setAttribute('aria-busy', 'false'); stop.hidden = !current?.requests.some(request => request.state === 'planning'); if (!disposed) renderReading(); present(); }
    });
  });
  shell.append(flow, errorBox, status, form); root.append(shell);
  function reveal(key: string, focus?: HTMLElement) { const entry = contextPanels.get(key); if (!entry) return; for (const [name, item] of contextPanels) { item.panel.node.hidden = name !== key; item.trigger.setAttribute('aria-expanded', String(name === key)); } activeContext = key; contextTrigger = entry.trigger; more.hidden = false; more.setAttribute('aria-label', entry.trigger.getAttribute('aria-label')!); entry.panel.node.open = true; lastDisclosure = entry.panel.node; options.missions?.setVisible(observing && key === 'missions'); options.voice?.setVisible(observing && key === 'voice'); options.permissions?.setVisible(observing && key === 'preferences'); updatePresence(); entry.panel.node.scrollIntoView({ block: 'nearest' }); (focus && !(focus as HTMLInputElement).disabled ? focus : entry.panel.summary).focus(); present(); }
  function closeContext(restoreFocus = true) { if (more.hidden) return; const previous = contextTrigger; for (const entry of contextPanels.values()) { entry.panel.node.hidden = true; entry.trigger.setAttribute('aria-expanded', 'false'); } activeContext = null; more.hidden = true; lastDisclosure = null; options.missions?.setVisible(false); options.voice?.setVisible(false); options.permissions?.setVisible(false); updatePresence(); if (restoreFocus) previous?.focus(); present(); }
  shell.addEventListener('keydown', event => { if (event.key !== 'Escape') return; const target = event.target as HTMLElement, opened = target.closest<HTMLDetailsElement>('details[open]') ?? (lastDisclosure?.open && shell.contains(lastDisclosure) && !lastDisclosure.closest('[hidden]') ? lastDisclosure : null); if (!more.hidden && (!opened || opened === contextPanels.get(activeContext!)?.panel.node)) { event.preventDefault(); event.stopPropagation(); closeContext(); } else if (opened) { event.preventDefault(); event.stopPropagation(); opened.open = false; opened.querySelector('summary')?.focus(); } });
  function renderSelection() {
    selection.replaceChildren(); selection.hidden = !selected.size && !handoffSelection && !routingAgentSelection;
    routeHistory.disabled = !!handoffSelection;
    if (handoffSelection) {
      const chip = button(providerName(handoffSelection.sourceProviderId) + ' exchange ×', () => {
        if (busy) return;
        handoffSelection = null;
        renderSelection();
        intent.focus();
      });
      chip.className = 'vela-core-chip';
      chip.setAttribute('aria-label', 'Remove selected provider exchange');
      selection.append(chip);
    }
    if (routingAgentSelection) {
      const chip = button(routingAgentSelection.title + ' profile ×', () => {
        if (busy) return;
        routingAgentSelection = null;
        renderSelection();
        intent.focus();
      });
      chip.className = 'vela-core-chip';
      chip.setAttribute('aria-label', 'Remove selected agent profile');
      selection.append(chip);
    }
    if (selected.size) { selection.append(el('span', 'vela-core-meta', selected.size + (selected.size === 1 ? ' source' : ' sources'))); for (const ref of selected.values()) { const chip = button(ref.title + ' ×', () => { selected.delete(ref.id); const control = sourceControls.get(ref.id); if (control) control.checked = false; renderSelection(); intent.focus(); }); chip.className = 'vela-core-chip'; chip.setAttribute('aria-label', 'Remove source ' + ref.title); selection.append(chip); } }
    updateWorkspaceAvailability();
  }
  function renderProviderChoice() {
    const connected = current?.planningProviders;
    refreshModels.disabled = !connected || (!chosenProviderId && routeMode.value !== 'codex');
    routeEscalation.disabled = !connected || !!chosenProviderId || (!!routeMode.value && routeMode.value !== 'auto');
    if (connected) {
      const selected = connected.find(route => route.providerId === chosenProviderId);
      const inherited = current?.routingSettings;
      const inheritedProvider = inherited?.effective.providerId;
      const activeMode = useAutomaticOnce ? 'auto' : routeMode.value !== 'auto' ? routeMode.value : inherited?.effective.mode ?? 'auto';
      const activeProvider = useAutomaticOnce ? null : chosenProviderId ?? inheritedProvider;
      intent.placeholder = 'Message Vela…';
      provider.textContent = selected ? providerName(selected.providerId) + (selected.available ? ' · connected' : ' · connection required')
        : useAutomaticOnce ? 'Auto for this send'
        : inheritedProvider ? providerName(inheritedProvider) + ' · ' + inherited?.origins.providerId + ' default'
        : inherited?.effective.mode && inherited.effective.mode !== 'auto' ? inherited.effective.mode + ' · ' + inherited.origins.mode + ' default'
        : 'Automatic';
    }
    const settings = current?.routingSettings;
    savedRoutes.node.hidden = !settings;
    if (settings) {
      const { effective, origins, profiles } = settings;
      const source = (key: keyof typeof origins) => ' (' + (origins[key] ?? 'default') + ')';
      effectiveRoute.textContent = [
        'Mode ' + effective.mode + source('mode'),
        'Provider ' + (effective.providerId ? providerName(effective.providerId) : 'automatic') + source('providerId'),
        'Model ' + (effective.model ?? 'automatic') + source('model'),
        'Effort ' + (effective.reasoningEffort ?? 'automatic') + source('reasoningEffort'),
      ].join(' · ');
      const choices = profiles.map(profile => {
        const name = current?.applicationContext?.references.find(item => item.kind === profile.scope && item.id === profile.id)?.title;
        const label = profile.scope === 'global' ? 'Global' : profile.scope === 'chat' ? 'Vela chat' : profile.scope;
        return [profile.scope, label + (name ? ' · ' + name : '') + (Object.keys(profile.defaults).length ? ' · customized' : '')] as const;
      });
      const signature = JSON.stringify(choices);
      if (scopeChoice.dataset.routingScopes !== signature) {
        const previous = scopeChoice.value;
        setOptions(scopeChoice, choices);
        scopeChoice.value = choices.some(([scope]) => scope === previous) ? previous : 'global';
        scopeChoice.dataset.routingScopes = signature;
      }
      renderRoutingQuotas();
    }
    const chosen = chosenProviderId && (connected || allowProvider.checked && chosenProviderId === current?.planner.providerId);
    providerChoice.hidden = !chosen;
    providerChoiceName.textContent = chosen ? providerName(chosenProviderId) : '';
    providerChoice.setAttribute('aria-label', connected ? 'Use automatic provider selection' : 'Remove planning provider from next request');
    providerControl.dataset.selected = String(!!chosen);
    for (const route of Array.from(providerRoutes.querySelectorAll<HTMLButtonElement>('[data-provider-route]'))) {
      const id = route.dataset.providerRoute;
      route.setAttribute('aria-pressed', String(id === (chosenProviderId ?? '')));
      route.title = connected?.find(item => item.providerId === id)?.available === false ? 'Connection required' : '';
    }
  }
  function presentation(): VelaPresentationState { return current?.presentation ?? { schemaVersion: 1, version: 1, view: 'current', selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] }; }
  function view() { return transientView ?? presentation().view; }
  function toggle(ids: readonly string[], id: string | null) { return id === null ? [...ids] : ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]; }
  function persistent() { return !!client.presentation && !!current?.presentation; }
  function project(): VelaManifestationState {
    return projectVelaManifestation(current, presentation());
  }
  async function updatePresentation(patch: VelaPresentationPatch) {
    if (presentationBusy || !persistent()) return;
    presentationBusy = true; renderReading();
    try { const value = await client.presentation!({ expectedVersion: presentation().version, patch }); if (disposed || !current) return; readSequence++; if (value.version >= (current.presentation?.version ?? 0)) current = { ...current, presentation: value }; transientView = null; renderReading(); await refresh(); }
    catch (error) { try { await refresh(); } catch {} throw error; }
    finally { presentationBusy = false; if (!disposed) { renderReading(); present(); } }
  }
  async function setView(value: 'current' | 'history') { viewRevision++; if (persistent()) await updatePresentation({ view: value }); else { transientView = value; renderReading(); present(); } }
  async function settleSubmittedView(revision: number) { if (viewRevision === revision && persistent() && (presentation().view !== 'current' || presentation().selectedRequestId !== null)) await updatePresentation({ view: 'current', selectedRequestId: null }); else await refresh(); }
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
    const projection = project(), selectedRequest = current?.requests.find(request => request.id === projection.currentRequestId), message = current?.conversation?.messages.find(message => message.id === projection.currentMessageId);
    const facts = selectedRequest?.local?.facts;
    const content = conciseObservedAnswer(message?.content,facts);
    const missionReport = message?.missionReport;
    const hostOperations=current?.hostOperations?.filter(operation=>operation.requestId===selectedRequest?.id)??[];
    const completedPlan = selectedRequest && current?.plans.find(plan => plan.id === projection.currentPlanId && confirmedVelaPlan(current!, selectedRequest, plan));
    const speakable=message&&view()==='current'&&projection.kind!=='action'&&(missionReport||completedPlan||selectedRequest?.state==='responded'&&selectedRequest.response?.messageId===message.id)?message:undefined;
    const actionPlan = current?.plans.find(plan => plan.id === projection.currentPlanId);
    const reviewPlan = actionPlan?.state === 'prepared' && !actionPlan.steps.some(step=>step.action.type==='delegateTask') ? actionPlan : null;
    const fileProposal = current?.fileProposals?.find(item => item.requestId === selectedRequest?.id && item.state === 'proposed' && item.count === item.files.length && item.count > 0);
    const completedFiles = current?.fileProposals?.find(item => item.requestId === selectedRequest?.id && item.state === 'applied' && item.result?.verified && item.result.workspaceId === item.target.workspaceId && item.result.importedCount + item.result.reusedCount === item.count);
    const fileDetails=fileProposal||completedFiles;
    const actionMessage = projection.kind === 'action' && actionPlan ? ({ prepared: 'Ready for your review.', approved: 'Ready to apply.', applying: 'Working…', applied: 'The result needs checking.', failed: 'That couldn’t be completed. Open details to review.', cancelled: 'Cancelled.', rejected: 'No changes made.', unknown: 'The outcome needs checking. Open details before trying again.' }[actionPlan.state]) : '';
    const signature = JSON.stringify({ id: projection.currentMessageId, kind: projection.kind,view:view(), content, actionMessage, missionReport, completedPlan: completedPlan?.id, fileProposal, completedFiles,hostOperations,replySpeech });
    manifestationBody.dataset.density = facts && ['time','date','calculator'].includes(facts.kind) && content.length <= 80 ? 'signal' : 'reading';
    shell.dataset.manifestationKind = projection.kind; shell.dataset.presentationView = view(); manifestation.dataset.requestId = projection.currentRequestId ?? ''; manifestation.dataset.currentMessageId = projection.currentMessageId ?? '';
    manifestation.hidden = projection.kind === 'none' || view() === 'history' && !projection.requiredPlanIds.length;
    const route = selectedRequest?.route;
    manifestationKicker.hidden = true;
    manifestationKicker.textContent = 'Vela';
    if (signature !== responseSignature) {
      responseSignature = signature; manifestationBody.replaceChildren();
      fileProposalDetails.replaceChildren();fileProposalDetails.hidden=!fileDetails;
      if(fileDetails){
        const list=el('ul');for(const file of fileDetails.files)list.append(el('li',undefined,file.displayName));
        fileProposalDetails.append(el('p','vela-core-meta',fileDetails.source.displayRoot),list);
        if(completedFiles&&options.onOpenSubject)fileProposalDetails.append(button('Open workspace',()=>options.onOpenSubject!({kind:'workspace',id:completedFiles.target.workspaceId})));
      }
      planProposalView.update(reviewPlan?{id:reviewPlan.id+':'+reviewPlan.fingerprint,version:reviewPlan.version,
        question:reviewPlan.steps.length===1?'Would you like me to do this?':'Would you like me to make these changes?',acceptLabel:'Yes, do that',declineLabel:'No',
        items:reviewPlan.steps.map(step=>({id:step.id,label:effect(step.action,reviewPlan)}))}:null);
      fileProposalView.update(fileProposal && client.fileProposal ? {id:fileProposal.id+':'+fileProposal.digest,version:fileProposal.version,
        question:content || 'I found these files that seem to match. Would you like me to add them?',acceptLabel:'Yes, add them',declineLabel:'No',
        items:fileProposal.files.map(file=>({id:file.id,label:file.displayName,kind:file.kind,detail:file.relativePath.split(/[\\/]/u).slice(0,-1).slice(-2).join(' / ')}))} : null);
      if (fileProposal && client.fileProposal) manifestationBody.append(fileProposalView.element);
      else if (reviewPlan) manifestationBody.append(planProposalView.element,responseFooter());
      else if (actionMessage) manifestationBody.append(el('p', undefined, actionMessage), responseFooter());
      else if (content) manifestationBody.append(el('p', projection.kind === 'whisper' ? 'vela-manifestation-value' : undefined, content));
      if (missionReport) manifestationBody.append(missionReplyFooter(missionReport,speakable));
      else if (message && projection.kind !== 'action') {
        const footer=responseFooter(completedPlan || undefined,hostOperations,completedFiles&&!completedPlan?1:0,speakable);
        manifestationBody.append(footer);
      }
    }
    manifestationBody.hidden = !content && !actionMessage && !fileProposal;
    const why = route?.kind === 'conversational' && (route.nativeMetric || route.nativeLog) ? 'Vela shared the reviewed local evidence for analysis and can offer a separate Codex review.'
      : route?.reason === 'routine-answer' ? 'A conversational response can answer this request.'
      : route?.reason === 'complex-analysis' ? 'The request calls for deeper conversational analysis.'
      : route?.reason === 'local-tools-required' ? 'This request needs access to a local repository or files.'
      : route?.reason === 'explicit-codex' ? 'You selected Codex for this request.'
      : route?.reason === 'reviewed-app-action' ? 'The requested app action needs a typed proposal and review.'
      : route?.reason === 'native-fact-and-local-inspection' ? 'Vela measured a local fact and shared the reviewed result with Codex for inspection.'
      : route?.kind === 'file-edit' ? 'Codex proposes file changes. Aerynth applies only the exact contents you approve.'
      : route?.kind === 'project-check' ? 'The approved command runs locally in the Codex read-only sandbox without inference.'
      : selectedRequest?.local ? 'An authorized native capability can answer directly.' : undefined;
    const apiEdit=current?.missionFileEdits?.find(record=>record.owner.kind==='api-selected-file-intent'&&record.owner.requestId===selectedRequest?.id);
    const edit = current?.fileEdits?.find(record => record.requestId === selectedRequest?.id);
    const standaloneCheck = selectedRequest?.projectCheck;
    const providerRecovery = selectedRequest?.providerRecovery;
    const canRecoverProvider = !!selectedRequest && !!current?.recoverableProviderRequestIds?.includes(selectedRequest.id) && !!client.reconcileProviderTurn;
    fileEditActions.hidden = !apiEdit && !edit && !standaloneCheck && !providerRecovery && !canRecoverProvider;
    const editSignature = JSON.stringify({ apiEdit,edit, standaloneCheck, providerRecovery, canRecoverProvider });
    if (fileEditActions.dataset.edit !== editSignature) {
      fileEditActions.dataset.edit = editSignature;
      fileEditActions.replaceChildren();
      if(apiEdit&&client.missionFileEdit){
        const type=apiEdit.phase==='awaiting-native-review'?'apply':apiEdit.phase==='applied'&&apiEdit.verification.state!=='passed'&&!(apiEdit.verification.state==='unknown'&&apiEdit.verification.reason==='check-outcome-unconfirmed')?'verify':null;
        if(type){const control=button(type==='apply'?'Review change':'Review required test',()=>void run(async()=>{if(fileEditBusy)return;fileEditBusy=control.disabled=true;try{await client.missionFileEdit!({type,operationId:apiEdit.id});}finally{fileEditBusy=control.disabled=false;await refresh();}}));fileEditActions.append(control);}
      }
      if (providerRecovery) {
        const outcome = { provider_completed: 'finished', failed: 'failed', interrupted: 'was interrupted' }[providerRecovery.state];
        fileEditActions.append(el('p', 'vela-core-meta', `The Codex turn ${outcome}. The original task still needs verification.`));
      } else if (canRecoverProvider) {
        const control = button('Check Codex outcome', () => void run(async () => {
          if (fileEditBusy) return;
          fileEditBusy = control.disabled = true;
          try {
            const result = await client.reconcileProviderTurn!({ requestId: selectedRequest.id });
            if (!result) throw Error('vela_provider_outcome_unavailable');
          } finally { fileEditBusy = control.disabled = false; await refresh(); }
        }));
        fileEditActions.append(control);
      }
      if (edit) {
        const verified = edit.files.filter(file => file.state === 'applied').length;
        const state = edit.state === 'applied'
          ? 'Written bytes verified for ' + verified + (verified === 1 ? ' file.' : ' files.') +
            (!edit.followUpCheck && edit.projectChecksAvailable && !edit.projectChecks?.length ? ' Project checks are available.' : '')
          : edit.state === 'awaiting-review' ? 'File changes ready for review.'
          : edit.state === 'partial' ? verified + ' of ' + edit.files.length + ' writes verified. Review each file outcome before taking further action.'
          : edit.state === 'unchanged' ? 'The selected destinations still match their state before the approved write.'
          : edit.state === 'conflict' ? 'One or more destinations conflict with the approved write. Review recovery details.'
          : 'The file outcomes need checking.';
        fileEditActions.append(el('p', 'vela-core-meta', state));
        if (edit.state === 'applied' && edit.followUpCheck && !edit.projectChecks?.some(check => check.kind === edit.followUpCheck)) {
          const label = VELA_PROJECT_CHECK_LABELS[edit.followUpCheck];
          fileEditActions.append(el('p', 'vela-core-meta', !edit.projectChecksAvailable ? 'Unavailable follow-up · ' + label
            : edit.followUpCheck === 'node-build' ? 'Send “Run the build” to review a build script and destination.' : 'Approve the requested follow-up to run it. ' + label));
        }
        if (edit.state !== 'awaiting-review') {
          const outcomes = el('ul', 'vela-core-meta');
          for (const file of edit.files) {
            const outcome = file.state === 'applied' ? 'write verified'
              : file.state === 'unchanged' ? 'unchanged'
              : file.state === 'conflict' ? 'conflict' : 'outcome unknown';
            const row = el('li', undefined, file.relativePath + ' · ' + outcome);
            if (file.change) {
              const contents = el('details', 'vela-core-meta');
              contents.append(el('summary', undefined, 'Show file changes'),
                el('p', undefined, file.change.before === null ? 'New file' : 'Before'));
              if (file.change.before !== null) contents.append(el('pre', undefined, file.change.before));
              contents.append(el('p', undefined, 'After'), el('pre', undefined, file.change.after));
              row.append(contents);
            }
            outcomes.append(row);
          }
          fileEditActions.append(outcomes);
        }
        const apply = edit.state === 'awaiting-review' ? client.applyFileEdit
          : edit.state !== 'applied' ? client.reconcileFileEdit : undefined;
        if (apply) {
          const control = button(edit.state === 'awaiting-review' ? standaloneCheck?.artifact ? 'Review generated file' : 'Review file changes' : 'Check file outcomes', () => void run(async () => {
            if (fileEditBusy) return;
            fileEditBusy = control.disabled = true;
            try { await apply({ requestId: edit.requestId }); }
            finally { fileEditBusy = control.disabled = false; await refresh(); }
          }));
          fileEditActions.append(control);
        }
        const verify = client.verifyFileEdit;
        if (verify && edit.projectChecksAvailable) {
          for (const kind of ['node-test', 'typescript', 'node-benchmark'] as const) {
            const control = button(kind === 'typescript' ? 'Type-check TypeScript' : 'Run ' + VELA_PROJECT_CHECK_LABELS[kind], () => void run(async () => {
              if (fileEditBusy) return;
              fileEditBusy = control.disabled = true;
              try { await verify({ requestId: edit.requestId, kind }); }
              finally { fileEditBusy = control.disabled = false; await refresh(); }
            }));
            fileEditActions.append(control);
          }
        }
      }
      for (const receipt of standaloneCheck ? [standaloneCheck] : edit?.projectChecks ?? []) {
        const checkLabel = VELA_PROJECT_CHECK_LABELS[receipt.kind];
        const detail = {
          running: 'running', passed: 'passed', failed: 'failed',
          stale: 'reviewed inputs or scope changed', limited: 'time or output exceeded the verification limit',
          unknown: 'outcome unavailable',
        }[receipt.state];
        const count = receipt.testCount === undefined ? '' : ' · ' + receipt.testCount + ' tests reported';
        fileEditActions.append(el('p', 'vela-core-meta', checkLabel + ' · ' + detail + count + ' · ' + receipt.inputs.join(', ')));
        if (receipt.benchmark) {
          const { samples, medianMs, p95Ms } = receipt.benchmark;
          fileEditActions.append(el('p', 'vela-core-meta', `The script reported ${samples} samples, a median of ${medianMs} ms, and a 95th percentile of ${p95Ms} ms.`));
        }
      }
    }
    const details = JSON.stringify({ requestId: selectedRequest?.id, taskId: selectedRequest?.handoff?.taskId ?? selectedRequest?.id, issue: selectedRequest?.errorCode, why,
      route, routingSettings: selectedRequest?.routingSettings, routingAgent: selectedRequest?.routingAgent,
      budget: route?.kind === 'project-check' ? 'No model usage' : route ? 'Cost and remaining allowance unknown' : undefined,
      ...(route?.kind === 'agentic' || route?.kind === 'composite' ? { verification: 'unverified' } : {}), edit,apiEdit,
      projectCheck: standaloneCheck, providerRecovery, hostOperations, handoff: selectedRequest?.handoff, local: selectedRequest?.local, response: selectedRequest?.response,
      provider: message?.providerContribution ?? selectedRequest?.providerId }, null, 2);
    if (manifestationDetails.body.firstElementChild?.textContent !== details) manifestationDetails.body.replaceChildren(el('pre', undefined, details)); manifestationDetails.node.hidden = !!missionReport || projection.kind === 'none' || projection.kind === 'action';
    const sources = selectedRequest?.context.included ?? [], sourceSignature = JSON.stringify(sources.map(ref => [ref.id, ref.kind, ref.version, ref.title]));
    if (manifestationSources.dataset.signature !== sourceSignature) { manifestationSources.dataset.signature = sourceSignature; manifestationSources.replaceChildren(); for (const ref of sources) manifestationSources.append(options.onOpenSubject ? button(ref.title, () => options.onOpenSubject?.({ id: ref.id, kind: ref.kind })) : el('span', undefined, ref.title)); } manifestationSources.hidden = !manifestationSources.children.length;
    const recent = current?.requests.at(-1), recentMessage = recent?.response && current?.conversation?.messages.find(message => message.id === recent.response!.messageId && message.requestId === recent.id && message.source === 'vela-native' && message.classification === 'observed' && message.providerId === undefined && message.providerContribution === undefined);
    const adjacentFacts = recent?.local?.facts;
    const adjacentContent = (recent?.state === 'responded' && recent.local?.classification === 'observed' && recent.providerId === null ? recentMessage?.content : undefined);
    const adjacent = conciseObservedAnswer(adjacentContent,adjacentFacts);
    localAlongsidePlan.hidden = !projection.requiredPlanIds.length || !adjacent || view() === 'history'; if (adjacent && localAlongsidePlan.textContent !== adjacent) localAlongsidePlan.textContent = adjacent;
    pin.hidden = dismiss.hidden = projection.currentRequestId === null; pin.disabled = presentationBusy || !persistent(); dismiss.disabled = presentationBusy || !persistent() || !projection.canDismiss;
    const sourceProvider = selectedRequest?.providerId;
    const destination = (sourceProvider === 'chatgpt-plan-responses' || sourceProvider === 'codex-app-server') &&
      selectedRequest?.provenance && selectedRequest.response?.kind === 'answer' && message?.source === 'provider'
      ? current?.planningProviders?.find(item => item.providerId !== sourceProvider &&
        (item.providerId === 'chatgpt-plan-responses' || item.providerId === 'codex-app-server')) : undefined;
    handoffButton.hidden = !destination;
    handoffButton.disabled = busy;
    handoffButton.title = destination?.available === false ? 'The destination connection will be checked on Send.' : '';
    handoffButton.dataset.destination = destination?.providerId ?? '';
    if (destination) handoffButton.textContent = 'Continue with ' + providerName(destination.providerId);
    const canRate = !!client.rateRoutingResponse && !!selectedRequest &&
      current?.routingSettings?.calibration?.feedbackRequestIds.includes(selectedRequest.id) === true;
    useful.hidden = needsCorrection.hidden = !canRate;
    useful.disabled = needsCorrection.disabled = busy;
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
    if (projection.kind !== 'action' && projection.currentMessageId && !busy) status.hidden = true;
    if (actionMessage && !busy) status.hidden = true;
    if (missionReport) status.hidden = true;
    updatePresence(); emitManifestation();
  }
  function present() {
    if (disposed) return;
    const latest = current?.requests.at(-1), pendingAttention = current?.attention.some(item => !item.reviewedAt && !item.dismissedAt);
    let phase: VelaPanelPresentation['phase'] = 'idle';
    if (!errorBox.hidden) phase = 'error';
    else if (applyingLocally || applyingPlans.size || current?.plans.some(plan => plan.state === 'applying')) phase = 'applying';
    else if (current?.requests.some(request => request.state === 'planning')) phase = 'planning';
    else if (busy && status.dataset.requestState === 'submitting') phase = 'receiving';
    else if (latest && ['failed', 'unknown', 'invalid-plan', 'provider-unavailable'].includes(latest.state)) phase = 'error';
    else if (current?.plans.some(plan => ['prepared', 'approved'].includes(plan.state))) phase = 'review';
    else if (activeContext === 'attention' && pendingAttention) phase = 'attention';
    else if (nativeBusy || intent.value.length) phase = 'receiving';
    shell.dataset.phase = phase;
    stop.hidden = !busy && phase !== 'planning' && phase !== 'applying';
    const value: VelaPanelPresentation = Object.freeze({ phase, context: activeContext, messageIds: Object.freeze([...new Set([...(current?.conversation?.messages.slice(-80).map(message => message.id) ?? [])])]), planIds: Object.freeze(current?.plans.filter(plan => planCards.has(plan.id)).map(plan => plan.id) ?? []) });
    const signature = JSON.stringify(value); if (signature === presentationSignature) return; presentationSignature = signature;
    try { options.onPresentation?.(value); } catch { /* Presentation observers cannot fail a canonical request or editor action. */ }
    emitManifestation();
  }
  async function run(action: () => unknown) {
    if (disposed) return;
    try { await action(); }
    catch (error) {
      if (disposed) return;
      status.dataset.actionState = 'failed'; errorBox.hidden = false;
      const code = error instanceof Error ? error.message : String(error);
      const messages: Record<string, string> = {
        vela_planner_unavailable: 'Vela couldn’t reach the AI. Your draft is still here.',
        mission_scope_denied: 'The mission workspace changed. Review the current workspace and try again.',
        vela_planner_sign_in_required: 'Connect Codex or choose ChatGPT plan. Your draft is still here.',
        vela_chatgpt_sign_in_required: 'Connect your ChatGPT plan in Connections. Your draft is still here.',
        vela_deep_model_unavailable: 'The connected catalog has no verified deep reasoning controls. Choose an available model or reconnect. Your draft is still here.',
        vela_pinned_provider_cannot_execute: 'This request needs local tools. Choose Codex or Auto in Provider. Your draft is still here.',
        vela_codex_write_unavailable: 'Vela can review eligible repository edits. This request needs an execution capability that is unavailable here. Your draft is still here.',
        vela_codex_inspection_target_unavailable: 'Choose the root folder of an accessible Git repository with at least one commit.',
        vela_codex_inspection_target_changed: 'The selected repository changed after review. Review the current checkout to continue.',
        vela_edit_file_ineligible: 'Choose a supported source file or destination. Existing files must be tracked UTF-8 text of 8 KiB or less.',
        vela_edit_file_limit: 'Choose up to four destinations with at most 10 KiB of text total.',
        vela_edit_repository_mismatch: 'Choose distinct files from the same repository checkout.',
        vela_edit_reconciliation_required: 'Check the earlier file outcomes before reviewing another edit to the same files.',
        vela_edit_path_ineligible: 'Choose a tracked file to replace or an unused filename to create in an eligible local repository.',
        vela_edit_destination_exists: 'That destination now exists. Choose an unused filename and review the change again.',
        vela_edit_destination_tracked: 'That name belongs to a tracked file. Choose an unused filename.',
        vela_edit_destination_ignored: 'Git ignores that filename. Choose a destination that is eligible for this repository edit.',
        vela_edit_file_changed: 'The selected file changed since review. Send the edit request again to review its current contents.',
        vela_edit_review_required: 'Open a fresh file review before applying.',
        vela_handoff_same_provider: 'Choose a different provider to carry over this exchange.',
        vela_handoff_context_limit: 'The selected exchange exceeds the handoff limit. Use a shorter exchange.',
        vela_handoff_source_unavailable: 'This exchange cannot be shared under the current scope or its source evidence is unavailable.',
        vela_handoff_history_conflict: 'Choose one exchange or recent messages for this send.',
        vela_project_check_unavailable: 'Project checks are unavailable on this execution host.',
        vela_project_check_sandbox_unavailable: 'A ready Windows Codex sandbox is required for this check.',
        vela_project_check_invalid_input: 'Choose tracked Node test files or a tracked tsconfig file for this check.',
        vela_project_check_repository_mismatch: 'Choose project check files from the same checkout as the applied edit.',
        vela_project_check_stale: 'The checkout changed since approval. Review the current files and check again.',
        vela_project_check_review_required: 'Open a fresh project check review.',
        vela_project_check_busy: 'A project check is already running.',
        vela_project_check_wait_for_result: 'This Windows project check is bounded by the sandbox deadline. Wait for its result.',
        vela_project_check_model_pin: 'Clear the model and reasoning pins to run this local check.',
        vela_project_check_attached_sources: 'Remove attached sources and select the project check files in the native picker.',
        vela_project_check_handoff_conflict: 'Remove the selected exchange before running a standalone project check.',
        vela_project_check_agent_conflict: 'Remove the selected agent profile before running a standalone project check.',
        vela_project_check_native_review_required: 'Use Vela’s desktop Send to select and review this local check.',
        vela_typescript_compiler_unavailable: 'An installed TypeScript compiler in this checkout is required.',
        vela_edit_log_source_required: 'Use Add sources to select one note with the log excerpt you want Vela to inspect.',
        vela_build_destination_required: 'Choose a tracked build script and an unused destination in the same checkout.',
        vela_native_weather_unavailable: 'The local forecast is unavailable from this app connection.',
        unsupported_model: 'The selected model is unavailable in the connected catalog. Your draft is still here.',
        vela_codex_model_unavailable: 'Codex did not offer a model for this request. Check its connection and try again.',
        vela_provider_outcome_unavailable: 'Codex could not confirm the outcome. The task was not restarted.',
        vela_workflow_scope_changed: 'The approved files, check, or workspace changed. Review the latest state before running the workflow again.',
        vela_workflow_check_scope_conflict: 'Select check files in the same checkout that the workflow will leave as they are.',
        vela_workflow_review_required: 'Review the workflow again to start it.',
        vela_workflow_busy: 'A Vela workflow is already running.',
        vela_workflow_auto_required: 'Use Auto to run this request across ChatGPT plan and Codex.',
        vela_workflow_context_conflict: 'Start this sequence without an agent or shared history. Attach a note only when the sequence starts with log inspection.',
        unsupported_reasoning_effort: 'The selected model does not advertise this effort. Your draft is still here.',
        vela_workspace_unavailable: 'Choose an accessible workspace and try again. Your draft is still here.',
        vela_workspace_ambiguous: 'More than one accessible workspace has that name. Open the intended workspace from the workspace list.',
        vela_custom_provider_required: 'Choose a provider before using Custom routing.',
        vela_budget_unverifiable: 'The selected provider cannot verify this spending cap. Local capabilities remain available.',
        vela_native_stage_unavailable: 'The local reading is unavailable. The inspection has not started.',
        stale_vela_routing_defaults: 'The saved routing defaults changed. Review the current settings and try again.',
        stale_vela_agent_routing: 'The selected agent profile changed. Review its current settings and send again.',
        vela_routing_agent_unavailable: 'The selected agent is unavailable in the current project.',
        vela_agent_capability_unavailable: 'A required capability in the selected agent profile could not be verified for this route.',
        vela_routing_feedback_unavailable: 'Feedback is available for measured responses in the current project.',
        vela_routing_scope_unavailable: 'The settings scope is no longer active. Open it again before saving.',
        vela_routing_pin_requires_provider_model: 'Choose a connected provider and model before saving an effort pin.',
        vela_daily_attempt_limit_reached: 'Vela has reached a daily provider attempt limit. Local tools remain available.',
        invalid_vela_attempt_limit: 'Enter a whole-number daily attempt limit between 0 and 10,000.',
        vela_planner_busy: 'The AI is busy. Your draft is ready to send when it frees up.',
        authorization_cancelled: 'Your request wasn’t shared. Your draft is still here.',
      };
      const details = disclosure('Error details', 'vela-core-error-details');
      details.body.append(el('pre', undefined, code));
      errorBox.replaceChildren(el('p', undefined, (Object.hasOwn(messages, code) ? messages[code] : undefined) ?? 'That could not be completed. Your text is still here.'), details.node, button('Dismiss', () => { errorBox.hidden = true; present(); }));
      present();
    }
  }
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
  function missionReplyFooter(link: NonNullable<VelaMessage['missionReport']>,message?:VelaMessage) {
    const footer = el('div', 'vela-mission-reply-footer');
    if (link.jobsDone !== undefined) footer.append(el('span', 'vela-mission-jobs-done', `${link.jobsDone} ${link.jobsDone === 1 ? 'job' : 'jobs'} done`));
    if (options.missions?.openReport) {
      const openPlan = icon('Open mission plan', '▤', 'missions', () => {
        reveal('missions');
        contextTrigger = openPlan;
        options.missions?.openReport?.(link.missionId);
      });
      openPlan.setAttribute('aria-controls', more.id);
      openPlan.dataset.missionReportLink = link.missionId;
      footer.append(openPlan);
    }
    appendSpeechAction(footer,message);return footer;
  }
  function appendSpeechAction(footer:HTMLElement,message?:VelaMessage){
    if(message&&options.voice?.speak){
      const speech=replySpeech,stopping=!!speech?.attemptId&&speech.messageId===message.id&&['starting','speaking'].includes(speech.state);
      const speak=icon(stopping?'Stop speaking':'Speak response',stopping?'■':'♩','speak',()=>void run(async()=>{
        speak.disabled=true;
        try{if(stopping&&speech?.attemptId&&options.voice?.stopSpeech)await options.voice.stopSpeech(speech.attemptId);else await options.voice!.speak!({id:message.id,content:message.content});}
        finally{speak.disabled=false;}
      }));
      speak.dataset.speechMessageId=message.id;footer.append(speak);
    }
  }
  function responseFooter(plan?: VelaPlan,hostOperations:NonNullable<VelaState['hostOperations']>=[],additionalJobs=0,message?:VelaMessage) {
    const footer = el('div', 'vela-mission-reply-footer');
    const hostJobs=new Map(hostOperations.filter(operation=>operation.state==='observed'&&operation.receiptId&&Number.isSafeInteger(operation.jobsDone)&&operation.jobsDone!>0).map(operation=>[operation.receiptId,operation.jobsDone!]));
    const jobs=(plan?.steps.length??0)+additionalJobs+[...hostJobs.values()].reduce((total,count)=>total+count,0);
    if (jobs) footer.append(el('span', 'vela-mission-jobs-done', `${jobs} ${jobs === 1 ? 'job' : 'jobs'} done`));
    appendSpeechAction(footer,message);
    const pending=hostOperations.find(operation=>operation.state==='awaiting-review'&&operation.reviewAvailable);
    if(pending&&client.hostOperation){
      const review=button('Review options',()=>void run(async()=>{
        if(fileEditBusy)return;fileEditBusy=review.disabled=true;
        try{await client.hostOperation!({operationId:pending.id});}
        finally{fileEditBusy=review.disabled=false;await refresh();}
      }));review.dataset.hostOperationId=pending.id;footer.append(review);
    }
    const open = icon(plan ? 'Open completed plan' : 'Open response details', '▤', 'result', () => {
      reveal('result'); contextTrigger = open;
    });
    open.setAttribute('aria-controls', resultPanel.node.id);
    if (plan) open.dataset.completedPlanId = plan.id;
    footer.append(open);
    return footer;
  }
  function renderConversation(state: VelaState) {
    const items = state.conversation?.messages.slice(-80) ?? [], target: HTMLElement[] = [];
    for (const message of items) { const signature = JSON.stringify(message), cached = messages.get(message.id); if (cached?.signature === signature) { target.push(cached.node); continue; }
      const entry = el('article', 'vela-core-message'); entry.dataset.messageId = message.id; entry.dataset.source = message.source;
      if (message.missionReport) {
        entry.setAttribute('aria-label', 'Vela');
        entry.append(el('p', undefined, message.content), missionReplyFooter(message.missionReport));
      } else entry.append(el('strong', 'vela-core-message-author', message.role === 'user' ? 'You' : 'Vela'), el('p', undefined, message.content));
      messages.set(message.id, { node: entry, signature }); target.push(entry);
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
      case 'clockTimer': return action.request.name==='create'?'Create clock and timer controls':action.request.name==='mutate'?(action.request.input.operations.some(operation=>operation.type==='deleteTimer')?'Delete the selected timer from ':action.request.input.operations.some(operation=>operation.type==='removeWorldClock')?'Remove the selected world clock from ':'Update timers or stopwatch in ')+name(action.request.input.resourceId,'resource'): 'Read the requested time, stopwatch or timers';
      case 'constructWorkspace': return 'Build “' + action.title + '” with functional blocks' + (action.projectId ? ' in ' + name(action.projectId, 'project') : action.newProjectTitle ? ' in a new project “' + action.newProjectTitle + '”' : '');
      case 'inspectVelaOperation': return 'Check the recorded operation and current blocks in ' + name(action.workspaceId, 'workspace');
      case 'repairWorkspace': return 'Restore missing declared blocks in ' + name(action.workspaceId, 'workspace') + ' while keeping current content and placements';
      case 'adjustWorkspace': return 'Rearrange and resize the selected cards in ' + name(action.workspaceId, 'workspace');
      case 'recoverCreation': return action.action === 'undo-creation' ? 'Undo creating ' + name(action.workspaceId, 'workspace') : 'Restore ' + name(action.workspaceId, 'workspace');
      case 'openResource': return 'Open “' + action.query + '”';
      case 'search': return 'Find Aerynth resources matching “' + action.query + '”';
      case 'readLocalFact': return 'Read ' + LOCAL_FACT_LABELS[action.capabilityId];
      case 'readWeather': return 'Read your Windows location once and send an approximate point to the US National Weather Service for ' + (action.period === 'now' ? 'the current hour' : action.period.replace('-', ' '));
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
      case 'applyStructuredPreset': return 'Arrange cards in ' + name(action.workspaceId, 'workspace') + ' with the ' + action.preset + ' preset and switch to Structured';
      case 'delegateTask': return 'Start “' + action.title + '” with ' + providerName(action.providerId);
    }
  }
  function renderPlans(state: VelaState) {
    const projection = project(), activeCards: HTMLElement[] = [], earlierCards: HTMLElement[] = [], resultCards: HTMLElement[] = [], visible = new Set<string>();
    for (const plan of [...state.plans].reverse()) {
      if (!state.conversation || !state.requests.some(request => request.id === plan.requestId && request.planId === plan.id && request.conversationId === state.conversation!.resourceId)) continue;
      const currentPlan = plan.id === projection.currentPlanId && view() === 'current';
      const required = projection.requiredPlanIds.includes(plan.id), active = required || currentPlan && projection.kind === 'action'; if (!active && !currentPlan && earlierCards.length >= 8) continue;
      const target = active || currentPlan ? resultCards : earlierCards, receipts = state.receipts.filter(receipt => receipt.planId === plan.id), effects = plan.steps.map(step => effect(step.action, plan));
      const lookup = plan.steps.length === 1 && ['readLocalFact', 'readWeather'].includes(plan.steps[0].action.type);
      const observation = lookup && ['applied', 'failed'].includes(plan.state) ? state.conversation.messages.findLast(message =>
        message.requestId === plan.requestId && message.planId === plan.id && message.source === 'vela-native' && message.classification === 'observed') : undefined;
      const matches = receipts.flatMap(receipt => state.searchResults?.[receipt.id] ?? []);
      const searched = receipts.some(receipt => state.searchResults?.[receipt.id] !== undefined);
      const signature = JSON.stringify({ plan, receipts, effects, observationId: observation?.id, matches, searched }), cached = planCards.get(plan.id); visible.add(plan.id);
      if (cached?.signature === signature) { target.push(cached.node); continue; }
      const card = el('article', 'vela-core-plan'); card.dataset.planId = plan.id; card.dataset.planState = plan.state; card.tabIndex = -1;
      const confirmed = receipts.filter(receipt => receipt.state === 'applied' && receipt.hostReceiptId).length;
      const complete = plan.steps.length > 0 && plan.steps.every(step => receipts.some(receipt => receipt.stepId === step.id && receipt.state === 'applied' && receipt.hostReceiptId));
      const stateLabel = { prepared: 'Ready for your review', approved: 'Approved · ready to apply', rejected: 'Not applied', applying: 'Applying reviewed changes', applied: complete ? (searched ? 'Search complete' : 'Applied') : 'Results need review', failed: 'Stopped · review needed', cancelled: 'Cancelled', unknown: 'Outcome unknown · review needed' }[plan.state];
      card.append(el('p', 'vela-core-plan-state', stateLabel), el('h3', undefined, plan.summary), el('p', 'vela-core-meta', plan.contribution ? 'Proposed with ' + providerName(plan.contribution.providerId) : 'Local app action'));
      if (observation) card.append(el('p', 'vela-manifestation-value', observation.content));
      if (searched) {
        const results = el('div', 'vela-core-actions');
        for (const ref of matches) results.append(options.onOpenSubject
          ? button(ref.title, () => options.onOpenSubject?.(ref)) : el('span', undefined, ref.title));
        if (!matches.length) results.append(el('p', undefined, 'No matching resources are available in this scope.'));
        card.append(results);
      }
      const steps = el('ol', 'vela-core-effects'); for (const [index, step] of plan.steps.entries()) { const item = el('li'); item.append(el('p', undefined, effects[index])); if (step.action.type === 'content') item.append(el('pre', 'vela-core-change-preview', step.action.content)); if (step.action.type === 'delegateTask') item.append(el('p', undefined, step.action.objective), el('p', 'vela-core-secondary', 'Starting this work requires a separate execution approval. A finished provider turn does not verify the task.')); steps.append(item); } card.append(steps);
      if (plan.targets.length) card.append(el('p', 'vela-core-targets', 'Uses: ' + plan.targets.map(ref => ref.title).join(', ')));
      const controls = el('div', 'vela-core-actions');
      const workspaceId = receipts.find(receipt => receipt.state === 'applied' && receipt.hostReceiptId && (receipt.workspaceConstruction || receipt.createdWorkspaceId));
      const workspace = workspaceId?.workspaceConstruction?.workspaceId ?? workspaceId?.createdWorkspaceId;
      if (workspace && options.onOpenSubject) {
        const openWorkspace = button('Open workspace', () => options.onOpenSubject?.({ kind: 'workspace', id: workspace }));
        openWorkspace.dataset.openWorkspace = workspace; controls.append(openWorkspace);
      }
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
            resultPlans.querySelector<HTMLElement>('[data-plan-id="' + plan.id + '"]')?.focus();
        } finally {
          workingPlans.delete(plan.id); applyingPlans.delete(plan.id); setPlanBusy(plan.id, false); present();
        }
      };
      if(plan.state==='prepared')planReviewActions.set(plan.id,{accept:()=>perform(true),decline:async()=>{await client.review({planId:plan.id,fingerprint:plan.fingerprint,decision:'reject'});await refresh();}});
      else planReviewActions.delete(plan.id);
      if (plan.state === 'prepared') controls.append(button('Approve and apply', () => perform(true)), button('Reject plan', async () => { await client.review({ planId: plan.id, fingerprint: plan.fingerprint, decision: 'reject' }); await refresh(); }));
      if (plan.state === 'approved') controls.append(button('Apply approved plan', () => perform(false))); card.append(controls);
      if (timelineResult()) controls.append(button('Open saved Timeline', () => { const id = timelineResult(); if (id) options.onOpenSubject?.({ kind: 'resource', id }); }));
      if (receipts.length) card.append(el('p', 'vela-core-receipt', confirmed + ' of ' + plan.steps.length + ' steps confirmed' + (receipts.some(receipt => ['failed', 'unknown'].includes(receipt.state)) ? ' · review details before trying again' : '')));
      const details = disclosure('Plan details and evidence', 'vela-core-plan-details'); details.node.open = cached?.node.querySelector<HTMLDetailsElement>('details')?.open ?? false; details.body.append(el('pre', undefined, JSON.stringify({ actions: plan.steps, targets: plan.targets, provider: plan.contribution, receipts }, null, 2))); card.append(details.node);
      planCards.set(plan.id, { node: card, controls, signature }); setPlanBusy(plan.id, workingPlans.has(plan.id)); target.push(card);
    }
    reconcile(planHistory.body, earlierCards); planHistory.node.hidden = !earlierCards.length; reconcile(plans, activeCards); reconcile(resultPlans, resultCards);
    for (const id of planCards.keys()) if (!visible.has(id)) {planCards.delete(id);planReviewActions.delete(id);}
  }
  function setPlanBusy(id: string, pending: boolean) { const controls = planCards.get(id)?.controls; if (controls) for (const child of Array.from(controls.children)) (child as HTMLButtonElement).disabled = pending; }
  function reconcile(parent: HTMLElement, children: HTMLElement[]) { for (const child of Array.from(parent.children)) if (!children.includes(child as HTMLElement)) child.remove(); children.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null); }); }
  function render(state: VelaState) {
    if (disposed) return; current = state;
    provider.textContent = state.planner.available ? providerName(state.planner.providerId) + (state.planner.busy ? ' · busy' : ' · available') : 'Provider unavailable';
    providerRoutes.hidden = !state.planningProviders;
    providerConsent.hidden = !!state.planningProviders;
    providerHint.textContent = state.planningProviders ? 'Auto uses local capabilities, a connected conversational model, or Codex according to the request. Attached sources and Codex work require review.' : state.planner.available ? 'Context sharing needs approval.' : 'Provider unavailable.';
    providerConsent.firstElementChild!.textContent = 'Use ' + providerName(state.planner.providerId) + ' for this request';
    allowProvider.disabled = !state.planner.available || state.planner.busy; if (!state.planningProviders && chosenProviderId !== state.planner.providerId) { allowProvider.checked = false; chosenProviderId = null; } renderProviderChoice();
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
  function observeLiveAnswer(answer: VelaState['activeAnswer']) {
    if (answer && observing && busy && status.dataset.requestState === 'submitting') {
      const message = 'Live ChatGPT-plan response · ' + answer.text + (answer.truncated ? '…' : '');
      if (status.textContent === message) return;
      status.dataset.liveAnswer = answer.requestId;
      status.setAttribute('aria-live', 'off');
      status.textContent = message;
    } else if (status.dataset.liveAnswer) {
      delete status.dataset.liveAnswer;
      status.setAttribute('aria-live', 'polite');
      if (status.dataset.requestState === 'submitting') status.textContent = 'Waiting for the response…';
    }
  }
  void run(refresh);
  return {
    async open() { observing = true; options.missions?.setVisible(activeContext === 'missions'); options.voice?.setVisible(activeContext === 'voice'); options.permissions?.setVisible(activeContext === 'preferences'); const sequence = ++readSequence, state = await client.open(); if (sequence === readSequence) render(state); return state; },
    showMission(id: string) { reveal('missions'); options.missions?.openReport?.(id); },
    refresh,
    observeLiveAnswer,
    /** Host visibility notification only; no canonical mutation or inference. */
    close() { observing = false; options.missions?.setVisible(false); options.voice?.setVisible(false); options.permissions?.setVisible(false); observeLiveAnswer(undefined); manifestationSignature = ''; manifestationBaseline = true; try { options.onManifestation?.(null); } catch {} },
    dispose() { disposed = true; observing = false; fileProposalView.dispose(); planProposalView.dispose(); planReviewActions.clear(); releaseVoice?.(); options.missions?.setVisible(false); options.voice?.setVisible(false); options.permissions?.setVisible(false); readSequence++; shell.remove(); try { options.onManifestation?.(null); } catch {} },
  };
}
