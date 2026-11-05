import type { TaskObjectiveDocument, TaskObjectivePort, TaskDefinition, TaskSourceRef, TaskAssigneeRef, TaskDependencyRef, TaskExecutionRef, TaskObjectiveOperation, TaskObjectiveReceipt, MutateTaskObjective, TaskReviewDecision, TaskObjectiveHistory } from '../task-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

type Slot<T> = { reference: T | null; freshness: string };
type Draft = { baseDefinitionVersion: number; baseDigest: string; objective: string; requirements: TaskDefinition['requirements'];
  assignees: Slot<TaskAssigneeRef>[]; dependencies: Slot<TaskDependencyRef>[]; sources: Slot<TaskSourceRef>[] };
type Panel = { element: HTMLElement; key: string; open: boolean };
const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fromDocument = (doc: TaskObjectiveDocument): Draft => ({ baseDefinitionVersion: doc.definitionVersion, baseDigest: doc.definitionDigest,
  objective: doc.definition.objective, requirements: structuredClone(doc.definition.requirements),
  assignees: doc.assignees.map(value => ({ reference: value.reference, freshness: value.freshness })),
  dependencies: doc.dependencies.map(value => ({ reference: value.reference, freshness: value.freshness })),
  sources: doc.sources.map(value => ({ reference: value.reference, freshness: value.freshness })) });
const definitionOf = (draft: Draft): TaskDefinition | null => [...draft.assignees, ...draft.dependencies, ...draft.sources].some(value => !value.reference) ? null : ({
  objective: draft.objective, requirements: structuredClone(draft.requirements), assignees: draft.assignees.map(value => value.reference!), dependencies: draft.dependencies.map(value => value.reference!), sources: draft.sources.map(value => value.reference!),
});

/** Criterion-level reading aid over the last authorized projection. The native
 * service remains the authority for whole-object verification and acceptance. */
export function requirementReviewState(document: TaskObjectiveDocument, id: string): 'verified' | 'needs-work' | 'stale' | 'unavailable' | 'unreviewed' {
  const review = document.reviews.findLast(value => value.definitionVersion === document.definitionVersion && value.definitionDigest === document.definitionDigest && (!value.requirementIds.length || value.requirementIds.includes(id)));
  if (!review) return 'unreviewed';
  if (review.decision !== 'verified') return 'needs-work';
  const freshness = [review.freshness, ...document.sources.map(source => source.freshness)];
  return freshness.includes('unavailable') ? 'unavailable' : freshness.includes('changed') ? 'stale' : 'verified';
}

export interface TaskTrackerExperience {
  refresh(): Promise<void>;
  setActive(active: boolean): void;
  setPresentation(presentation: 'workspace' | 'focused'): void;
  reflow(): void;
  frame(): void;
  flush(): Promise<void>;
  hasUnsavedChanges(): boolean;
  dispose(): void;
}

/** One canonical objective view. Manual decisions, execution records and
 * acceptance stay separate; this component has no runner or permission grant. */
export function mountTaskTrackerExperience(root: HTMLElement, resourceId: string, port: TaskObjectivePort, options: {
  viewId: string; motion: ExperienceMotionPort; active?: boolean; presentation?: 'workspace' | 'focused'; showTitle?: boolean;
  chooseSource?(current?: TaskSourceRef): Promise<TaskSourceRef | null>;
  chooseAssignee?(current?: TaskAssigneeRef): Promise<TaskAssigneeRef | null>;
  chooseDependency?(current?: TaskDependencyRef): Promise<TaskDependencyRef | null>;
  chooseExistingExecution?(): Promise<TaskExecutionRef | null>;
  openResource?(resourceId: string): void | Promise<void>;
  resourceTitle?(resourceId: string): string | undefined;
  onProjection?(document: TaskObjectiveDocument | null): void;
}): TaskTrackerExperience {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const motion = options.motion, prefix = 'task-tracker:' + options.viewId, keys = new Set<string>(), panels: Panel[] = [];
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const element = document.createElement(tag); element.textContent = text; element.className = cls;
    if (['button', 'input', 'textarea', 'select'].includes(tag)) element.dataset.aerynthMotionControl = 'true'; return element;
  };
  const section = node('section', '', 'aw-task-tracker'), title = node('h3'), states = node('dl', '', 'aw-task-outcome-states');
  const objective = node('p', '', 'aw-task-objective'), criteria = node('ol', '', 'aw-task-requirements'), bindings = node('div', '', 'aw-task-bindings');
  const proofMap = node('section', '', 'aw-task-proof-map'), proofCounts = node('dl'), proofNote = node('p');
  proofMap.setAttribute('aria-label', 'Objective review and relationship coverage'); proofMap.append(proofCounts, proofNote);
  const actions = node('div', '', 'aw-task-actions'), attempts = node('section', '', 'aw-task-attempts'), reviews = node('section', '', 'aw-task-reviews');
  const status = node('p', '', 'aw-task-status'), caveat = node('p', 'States reflect the last authorized read. Execution records do not establish verification or acceptance.', 'aw-task-caveat');
  let current: TaskObjectiveDocument | null = null, active = options.active ?? true, disposed = false, pending = false, loading = false, sequence = 0, unavailable = false, needsRefresh = false;
  let draft: Draft | null = null, submittedDefinition: TaskDefinition | null = null, draftConflict = false;
  let retryRequest: { input: MutateTaskObjective; done?: (receipt: TaskObjectiveReceipt) => void } | null = null, operation: Promise<void> | null = null;
  let reviewDecision: TaskReviewDecision = 'needs-work', reviewAttempt = '', reviewNote = '', reviewEvidence: TaskSourceRef[] = [], reviewCriteria = new Set<string>(), acceptanceReviews = new Set<string>();
  let reviewBasis: { version: number; digest: string } | null = null;
  let history: TaskObjectiveHistory | null = null, historySequence = 0;
  let criteriaSignature = '', bindingSignature = '';
  const addMotion = (key: string, value: ExperiencePose) => { motion.add(key, value); keys.add(key); };
  const target = (key: string, value: ExperiencePose, cause: string) => { motion.target(key, value, cause); motion.wake(); };
  addMotion(prefix, pose({ opacity: 0, y: 6 }));
  const panel = (name: string) => { const value: Panel = { element: node('section', '', 'aw-task-panel'), key: prefix + ':' + name, open: false };
    value.element.dataset.taskPanel = name; value.element.hidden = true; value.element.inert = true; value.element.style.height = '0px'; addMotion(value.key, pose({ h: 0, opacity: 0 })); panels.push(value); return value; };
  const editor = panel('definition'), review = panel('review'), acceptance = panel('acceptance'), historyPanel = panel('history'), closePanel = panel('close');
  const canMutate = () => active && !disposed && current?.canEdit === true && !pending && !loading && !retryRequest && !needsRefresh;
  const openObjective = () => canMutate() && current?.disposition === 'open';
  const decisionReady = () => openObjective() && !draft;
  const action = (text: string, work: () => void | Promise<void>) => { const value = node('button', text); value.type = 'button'; value.onclick = () => {
    if (disposed || !active) return; try { void Promise.resolve(work()).catch(report); } catch (error) { report(error); }
  }; return value; };
  const field = (text: string, control: HTMLElement) => { const value = node('label', text); control.setAttribute('aria-label', text); value.append(control); return value; };
  const show = (value: Panel, open: boolean) => { value.open = open; value.element.inert = !open; if (open) value.element.hidden = false;
    if (!active && !open) { value.element.hidden = true; target(value.key, pose({ h: 0, opacity: 0 }), 'task-tracker-hidden-close'); } else reflow(); };
  function report(error: unknown) { if (disposed || !active) return; const code = (error as { code?: string })?.code;
    status.textContent = code === 'task_version_conflict' ? 'This objective changed elsewhere. Refresh before recording your change; local edits are retained.'
      : code === 'task_read_only' || code === 'task_not_authorized' ? 'This action is not permitted by the current policy. Local edits are retained.'
        : code === 'task_verification_required' || code === 'task_dependency_not_accepted_or_stale' ? 'Acceptance requires current verified evidence for every criterion and accepted current dependencies.'
          : 'The change could not be recorded. Local edits are retained.'; }
  const labelResource = (id: string, fallback: string) => options.resourceTitle?.(id) ?? fallback;
  const sourceLabel = (value: TaskSourceRef) => labelResource(value.resourceId, value.messageId ? 'Referenced message' : 'Source resource');
  const referenceName = (type: 'sources' | 'dependencies' | 'assignees', ref: TaskSourceRef | TaskDependencyRef | TaskAssigneeRef | null) => !ref ? 'Unavailable saved reference'
    : type === 'sources' ? sourceLabel(ref as TaskSourceRef) : type === 'dependencies' ? labelResource((ref as TaskDependencyRef).resourceId, 'Work objective dependency')
      : (ref as TaskAssigneeRef).kind === 'agent' ? labelResource((ref as Extract<TaskAssigneeRef, { kind: 'agent' }>).resourceId, 'Assigned agent') : 'Assigned person';
  function openReference(ref: TaskSourceRef | TaskDependencyRef | TaskAssigneeRef | null) { if (ref && 'resourceId' in ref) return options.openResource?.(ref.resourceId); }

  const objectiveInput = node('textarea'), criterionInputs = new Map<string, { row: HTMLLIElement; input: HTMLInputElement }>(), criteriaEditor = node('ol');
  objectiveInput.rows = 5; objectiveInput.maxLength = 8192;
  objectiveInput.oninput = () => { if (draft) { draft.objective = objectiveInput.value; status.textContent = pending ? 'Recording definition…' : 'Definition edits are not recorded yet.'; } };
  const editorBindings = node('div'), draftStatus = node('p', '', 'aw-task-draft-status');
  const addCriterion = action('Add requirement', () => { if (!openObjective() || !draft || draft.requirements.length >= 32) return;
    draft.requirements.push({ id: 'criterion:' + crypto.randomUUID(), text: '' }); paintEditor(); });
  async function pick(type: 'sources' | 'dependencies' | 'assignees', index?: number) {
    const limit = type === 'assignees' ? 16 : 32;
    if (!openObjective() || !draft || index === undefined && draft[type].length >= limit) return; const startingDraft = draft, startingSlot = index === undefined ? null : draft[type][index];
    const chosen = type === 'sources' ? await options.chooseSource?.(draft.sources[index ?? -1]?.reference ?? undefined)
      : type === 'dependencies' ? await options.chooseDependency?.(draft.dependencies[index ?? -1]?.reference ?? undefined) : await options.chooseAssignee?.(draft.assignees[index ?? -1]?.reference ?? undefined);
    if (!chosen || !openObjective() || draft !== startingDraft || index === undefined && draft[type].length >= limit || index !== undefined && draft[type][index] !== startingSlot) return;
    const values = draft[type] as Slot<typeof chosen>[]; if (index === undefined) values.push({ reference: structuredClone(chosen), freshness: 'current' }); else values[index] = { reference: structuredClone(chosen), freshness: 'current' };
    paintEditor();
  }
  const addSource = action('Add source', () => pick('sources')), addDependency = action('Add dependency', () => pick('dependencies')), addAssignee = action('Choose assignee', () => pick('assignees'));
  const saveDefinition = action('Record definition', () => {
    if (!openObjective() || !draft || draftConflict) return; const definition = definitionOf(draft);
    if (!definition) { status.textContent = 'Explicitly remove or replace unavailable saved references before recording this definition.'; return; }
    if (!definition.objective.trim() || definition.requirements.some(value => !value.text.trim())) { status.textContent = 'Enter an objective and text for every recorded requirement.'; return; }
    const submitted = structuredClone(definition); submittedDefinition = submitted;
    return mutate({ type: 'replaceDefinition', definition: submitted }, receipt => {
      if (draft) { if (same(definitionOf(draft), submitted)) { draft = null; show(editor, false); }
        else { draft.baseDefinitionVersion = receipt.definitionVersion; draft.baseDigest = receipt.definitionDigest; } }
      submittedDefinition = null;
    });
  });
  const discardDefinition = action('Discard definition edits', () => { if (!canMutate()) return; draft = null; submittedDefinition = null; draftConflict = false; show(editor, false); paint(); });
  const useSaved = action('Use saved definition', () => { if (!canMutate() || !current) return; draft = fromDocument(current); draftConflict = false; paintEditor(); });
  const keepMine = action('Keep my definition', () => { if (!canMutate() || !current || !draft) return; draft.baseDefinitionVersion = current.definitionVersion; draft.baseDigest = current.definitionDigest; draftConflict = false; paintEditor(); });
  editor.element.append(node('h4', 'Edit objective and requirements'), field('Objective', objectiveInput), criteriaEditor, addCriterion, editorBindings, addAssignee, addDependency, addSource, draftStatus, useSaved, keepMine, saveDefinition, discardDefinition);
  function paintEditor() {
    if (!draft || !current) return; if (objectiveInput.value !== draft.objective) objectiveInput.value = draft.objective;
    const live = new Set(draft.requirements.map(item => item.id)); for (const [id, row] of criterionInputs) if (!live.has(id)) { row.row.remove(); criterionInputs.delete(id); }
    for (const [index, criterion] of draft.requirements.entries()) { let value = criterionInputs.get(criterion.id);
      if (!value) { const row = node('li'), input = node('input'); input.maxLength = 2048; input.setAttribute('aria-label', 'Requirement text'); input.oninput = () => { const item = draft?.requirements.find(item => item.id === criterion.id); if (item) item.text = input.value; };
        row.append(input, action('Remove requirement', () => { if (openObjective() && draft) { draft.requirements = draft.requirements.filter(item => item.id !== criterion.id); paintEditor(); } })); value = { row, input }; criterionInputs.set(criterion.id, value); }
      if (value.input.value !== criterion.text) value.input.value = criterion.text;
      if (criteriaEditor.children[index] !== value.row) criteriaEditor.insertBefore(value.row, criteriaEditor.children[index] ?? null);
    }
    editorBindings.replaceChildren();
    for (const type of ['assignees', 'dependencies', 'sources'] as const) for (const [index, item] of draft[type].entries()) {
      const row = node('div', '', 'aw-task-binding'); row.append(node('span', referenceName(type, item.reference)), node('small', item.freshness === 'changed' ? 'Changed since saved' : item.freshness === 'unavailable' ? 'Unavailable; retained until explicitly removed' : 'Saved reference'));
      const replace = action('Replace reference', () => pick(type, index)); replace.dataset.taskPickerUnavailable = String(!(type === 'sources' ? options.chooseSource : type === 'dependencies' ? options.chooseDependency : options.chooseAssignee)); replace.disabled = !canMutate() || replace.dataset.taskPickerUnavailable === 'true';
      const remove = action('Remove reference', () => { if (openObjective() && draft) { draft[type].splice(index, 1); paintEditor(); } }); row.append(replace, remove); editorBindings.append(row);
    }
    const ownEcho = submittedDefinition !== null && same(definitionOf(fromDocument(current)), submittedDefinition);
    draftConflict = current.definitionVersion !== draft.baseDefinitionVersion && !ownEcho && current.definitionDigest !== draft.baseDigest;
    draftStatus.textContent = draftConflict ? 'The saved definition changed. Choose saved or local values before recording another version.'
      : definitionOf(draft) ? 'Recording a definition creates a new version; prior reviews do not automatically verify it.' : 'Unavailable saved references must be explicitly removed or replaced.';
    useSaved.hidden = keepMine.hidden = !draftConflict; setDisabled(); reflow();
  }

  const reviewDecisionInput = node('select'), reviewAttemptInput = node('select'), reviewNoteInput = node('textarea'), reviewRequirements = node('div'), reviewEvidenceList = node('div');
  const reviewChecks = new Map<string, HTMLInputElement>(); reviewNoteInput.maxLength = 2000; reviewNoteInput.rows = 3;
  for (const [value, text] of [['needs-work', 'Needs work'], ['rejected', 'Rejected'], ['verified', 'Verified by my manual review']]) { const option = node('option', text); option.value = value; reviewDecisionInput.append(option); }
  reviewDecisionInput.value = reviewDecision; reviewDecisionInput.onchange = () => { reviewDecision = reviewDecisionInput.value as TaskReviewDecision; };
  reviewAttemptInput.onchange = () => { reviewAttempt = reviewAttemptInput.value; }; reviewNoteInput.oninput = () => { reviewNote = reviewNoteInput.value; };
  const addEvidence = action('Choose review evidence', async () => { if (!decisionReady() || !options.chooseSource || reviewEvidence.length >= 16) return; const chosen = await options.chooseSource();
    if (chosen && decisionReady() && !reviewEvidence.some(value => same(value, chosen))) { reviewEvidence.push(structuredClone(chosen)); paintReview(); } });
  const reviewDefinitionChanged = () => !current || !reviewBasis || reviewBasis.version !== current.definitionVersion || reviewBasis.digest !== current.definitionDigest;
  const reviewValues = () => ({ basis: reviewBasis, decision: reviewDecision, attempt: reviewAttempt, note: reviewNote, criteria: [...reviewCriteria].sort(), evidence: structuredClone(reviewEvidence) });
  const recordReview = action('Record manual review', () => {
    if (!decisionReady() || !current || reviewDefinitionChanged()) return; const values = reviewValues(), attempt = values.attempt ? current.attempts.find(item => item.id === values.attempt) : null;
    if (values.attempt && !attempt?.execution.current) { status.textContent = 'The selected execution record is unavailable. Refresh before linking this review.'; return; }
    return mutate({ type: 'review', attemptId: attempt?.id ?? null, ...(attempt ? { executionRevision: attempt.execution.current!.revision } : {}),
      decision: values.decision, requirementIds: values.criteria, evidence: values.evidence, note: values.note }, () => {
        if (same(reviewValues(), values)) { reviewCriteria.clear(); reviewEvidence = []; reviewNote = ''; reviewBasis = null; reviewDecision = 'needs-work'; reviewAttempt = ''; reviewNoteInput.value = ''; show(review, false); }
      });
  });
  const reviewContext = node('p'), reviewCurrentDefinition = action('Review current definition', () => { if (decisionReady() && current) { reviewBasis = { version: current.definitionVersion, digest: current.definitionDigest }; reviewCriteria.clear(); paintReview(); } });
  review.element.append(node('h4', 'Record your manual review'), node('p', 'Review evidence and criteria explicitly. This records your decision without starting, stopping or completing an execution.'), reviewContext, reviewCurrentDefinition, field('Decision', reviewDecisionInput), field('Linked attempt', reviewAttemptInput), reviewRequirements, reviewEvidenceList, addEvidence, field('Review note', reviewNoteInput), recordReview);
  function paintReview() {
    if (!current) return; const selected = reviewAttempt;
    const changed = review.open && reviewDefinitionChanged(); reviewContext.textContent = changed ? 'The objective definition changed. Review its current values explicitly before recording this decision. Your note and evidence selections are retained.' : 'Reviewing definition version ' + current.definitionVersion;
    reviewCurrentDefinition.hidden = !changed;
    if (reviewNoteInput.value !== reviewNote) reviewNoteInput.value = reviewNote;
    reviewDecisionInput.value = reviewDecision;
    reviewAttemptInput.replaceChildren(); const none = node('option', 'General outcome review'); none.value = ''; reviewAttemptInput.append(none);
    current.attempts.forEach((attempt, index) => { const option = node('option', 'Linked execution ' + (index + 1) + ' · ' + (attempt.execution.current?.state.replaceAll('_', ' ') ?? 'unavailable')); option.value = attempt.id; option.disabled = !attempt.execution.current; reviewAttemptInput.append(option); });
    reviewAttemptInput.value = selected;
    const live = new Set(current.definition.requirements.map(item => item.id)); for (const [id, check] of reviewChecks) if (!live.has(id)) { check.parentElement?.remove(); reviewChecks.delete(id); reviewCriteria.delete(id); }
    for (const [index, item] of current.definition.requirements.entries()) { let check = reviewChecks.get(item.id);
      if (!check) { check = node('input'); check.type = 'checkbox'; check.dataset.requirementId = item.id; check.onchange = () => { if (check!.checked) reviewCriteria.add(item.id); else reviewCriteria.delete(item.id); }; reviewChecks.set(item.id, check); }
      check.checked = reviewCriteria.has(item.id); let label = check.parentElement;
      if (!label) { label = node('label'); label.append(check, node('span', item.text)); }
      else if (label.children[1]?.textContent !== item.text) label.children[1].textContent = item.text;
      if (reviewRequirements.children[index] !== label) reviewRequirements.insertBefore(label, reviewRequirements.children[index] ?? null);
    }
    reviewEvidenceList.replaceChildren(); reviewEvidence.forEach((source, index) => { const row = node('div', '', 'aw-task-binding'); row.append(node('span', sourceLabel(source)), action('Remove evidence', () => { if (decisionReady()) { reviewEvidence.splice(index, 1); paintReview(); } })); reviewEvidenceList.append(row); });
    setDisabled(); reflow();
  }
  const acceptanceList = node('div'), acceptanceNote = node('p');
  const eligibleReviews = () => current?.reviews.filter(value => value.decision === 'verified' && value.freshness === 'current' && value.definitionVersion === current!.definitionVersion && value.definitionDigest === current!.definitionDigest) ?? [];
  const confirmAcceptance = action('Confirm acceptance', () => {
    if (!decisionReady() || !current || current.verification !== 'verified' || current.proofCoverage !== 'complete') return;
    return mutate({ type: 'accept', reviewIds: [...acceptanceReviews] }, () => { acceptanceReviews.clear(); show(acceptance, false); });
  });
  acceptance.element.append(node('h4', 'Accept the current objective'), node('p', 'Acceptance is your separate accountable decision. Select the current verified reviews you rely on.'), acceptanceList, acceptanceNote, confirmAcceptance);
  function paintAcceptance() { acceptanceList.replaceChildren(); if (!current) return;
    const eligible = new Set(eligibleReviews().map(value => value.id)); for (const id of acceptanceReviews) if (!eligible.has(id)) acceptanceReviews.delete(id);
    for (const value of eligibleReviews()) { const check = node('input'); check.type = 'checkbox'; check.checked = acceptanceReviews.has(value.id); check.onchange = () => { if (check.checked) acceptanceReviews.add(value.id); else acceptanceReviews.delete(value.id); setDisabled(); };
      acceptanceList.append(field('Manual review · ' + value.provenance.at + ' · ' + (value.requirementIds.length ? value.requirementIds.length + ' criteria' : 'general outcome'), check)); }
    acceptanceNote.textContent = current.verification !== 'verified' ? 'Current verified evidence is required for every criterion.' : current.proofCoverage !== 'complete' ? 'Proof coverage is bounded; acceptance is not available.'
      : current.dependencies.some(value => value.acceptance !== 'valid' || value.freshness !== 'current') ? 'Every dependency must be current and accepted.' : 'The service rechecks selected reviews, evidence, dependencies and authority.';
    setDisabled(); reflow(); }
  const historyItems = node('ol'), historyStatus = node('p'), nextHistory = action('Next history page', () => loadHistory(history?.nextAfterVersion ?? undefined));
  historyPanel.element.append(node('h4', 'Recorded objective history'), historyItems, historyStatus, nextHistory);
  async function loadHistory(afterVersion?: number) { if (!active || disposed || !current) return; const token = ++historySequence;
    try { const value = await port.history({ resourceId, ...(afterVersion === undefined ? {} : { afterVersion }), limit: 8 }); if (!active || disposed || token !== historySequence) return;
      if (value.resourceId !== resourceId) throw new Error('task_history_identity_mismatch'); history = value; historyItems.replaceChildren();
      for (const item of value.items) { const row = node('li'); row.append(node('strong', 'Version ' + item.version + ' · ' + item.operation.replaceAll(/([A-Z])/g, ' $1').toLowerCase()), node('small', 'Manual decision · ' + item.provenance.at), node('p', item.snapshot.definition.objective)); historyItems.append(row); }
      historyStatus.textContent = value.items.length + ' whole versions loaded · ' + value.coverage + ' coverage. Historical execution and evidence references are rechecked with current access.'; nextHistory.hidden = value.nextAfterVersion === null; reflow();
    } catch { if (!disposed && active && token === historySequence) { history = null; historyItems.replaceChildren(); historyStatus.textContent = 'History is unavailable under the current access or response bounds.'; nextHistory.hidden = true; } }
  }
  const confirmClose = action('Confirm administrative close', () => { if (decisionReady()) return mutate({ type: 'administrativeCancel' }, () => show(closePanel, false)); });
  closePanel.element.append(node('h4', 'Close without acceptance'), node('p', 'This changes only the objective disposition. Linked executions continue; no provider stop is requested or confirmed.'), confirmClose);
  const edit = action('Edit definition', () => { if (!openObjective() || !current) return; draft ??= fromDocument(current); show(editor, !editor.open); paintEditor(); });
  const reviewButton = action('Review outcome', () => { if (!decisionReady() || !current) return; reviewBasis ??= { version: current.definitionVersion, digest: current.definitionDigest }; show(review, !review.open); paintReview(); });
  const acceptanceButton = action('Review acceptance', () => { if (!decisionReady()) return; show(acceptance, !acceptance.open); paintAcceptance(); });
  const linkAttempt = action('Link existing execution', async () => { if (!decisionReady() || !options.chooseExistingExecution) return; const chosen = await options.chooseExistingExecution(); if (chosen && decisionReady()) await mutate({ type: 'linkAttempt', execution: chosen }); });
  const historyButton = action('History', async () => { show(historyPanel, !historyPanel.open); if (historyPanel.open) await loadHistory(); });
  const closeButton = action('Close objective', () => { if (decisionReady()) show(closePanel, !closePanel.open); });
  const reopen = action('Reopen objective', () => { if (canMutate() && current?.disposition !== 'open') return mutate({ type: 'reopen' }); });
  const refreshButton = action('Refresh objective', refresh), retry = action('Retry change', () => retryRequest ? send(retryRequest) : undefined);
  actions.append(edit, reviewButton, acceptanceButton, linkAttempt, historyButton, closeButton, reopen, refreshButton, retry);
  if (!options.chooseExistingExecution) linkAttempt.title = 'Selection of actual existing execution records is unavailable in this surface.';
  for (const [control, available] of [[addSource, options.chooseSource], [addAssignee, options.chooseAssignee], [addDependency, options.chooseDependency], [addEvidence, options.chooseSource]] as const) if (!available) control.title = 'Canonical selection is unavailable in this surface.';
  function setDisabled() {
    const mutable = canMutate(), editable = openObjective(), decide = decisionReady();
    edit.disabled = !editable; reviewButton.disabled = acceptanceButton.disabled = closeButton.disabled = !decide; linkAttempt.disabled = !decide || !options.chooseExistingExecution;
    reopen.hidden = current?.disposition === 'open' || !current; reopen.disabled = !mutable; refreshButton.disabled = loading; historyButton.disabled = !current || loading;
    retry.hidden = !retryRequest; retry.disabled = pending || loading || current?.canEdit !== true || !active;
    for (const control of editor.element.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !editable || control.dataset.taskPickerUnavailable === 'true';
    saveDefinition.disabled = !editable || !draft || draftConflict || !definitionOf(draft); discardDefinition.disabled = useSaved.disabled = keepMine.disabled = !mutable;
    for (const control of editor.element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')) control.disabled = !editable;
    addCriterion.disabled = !editable || !draft || draft.requirements.length >= 32; addSource.disabled = !editable || !options.chooseSource || (draft?.sources.length ?? 0) >= 32; addAssignee.disabled = !editable || !options.chooseAssignee || (draft?.assignees.length ?? 0) >= 16; addDependency.disabled = !editable || !options.chooseDependency || (draft?.dependencies.length ?? 0) >= 32;
    for (const control of review.element.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !decide;
    for (const control of review.element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) control.disabled = !decide;
    recordReview.disabled = !decide || reviewDefinitionChanged(); addEvidence.disabled = !decide || !options.chooseSource || reviewEvidence.length >= 16;
    for (const control of acceptance.element.querySelectorAll<HTMLInputElement>('input')) control.disabled = !decide;
    confirmAcceptance.disabled = !decide || !acceptanceReviews.size || current?.verification !== 'verified' || current.proofCoverage !== 'complete' || current.dependencies.some(value => value.freshness !== 'current' || value.acceptance !== 'valid');
    confirmClose.disabled = !decide; section.setAttribute('aria-busy', String(pending || loading));
  }
  function paint() {
    if (disposed) return; title.textContent = current?.resource.title ?? (unavailable ? 'Task objective unavailable' : 'Loading task objective…'); title.hidden = options.showTitle === false;
    states.replaceChildren(); attempts.replaceChildren(); reviews.replaceChildren();
    if (!current) { objective.textContent = ''; for (const value of panels) { value.element.hidden = true; value.element.inert = true; }
      proofCounts.replaceChildren(); proofNote.textContent = ''; proofMap.hidden = true;
      objectiveInput.value = reviewNoteInput.value = ''; criteria.replaceChildren(); bindings.replaceChildren(); criteriaSignature = bindingSignature = '';
      criteriaEditor.replaceChildren(); editorBindings.replaceChildren(); reviewRequirements.replaceChildren(); reviewEvidenceList.replaceChildren(); reviewAttemptInput.replaceChildren(); acceptanceList.replaceChildren(); historyItems.replaceChildren(); historyStatus.textContent = ''; history = null; setDisabled(); return; }
    for (const [label, text] of [['Objective', current.disposition], ['Manual verification', current.verification], ['Acceptance', current.acceptance.state]]) { const group = node('div'); group.append(node('dt', label), node('dd', text.replaceAll('-', ' '))); states.append(group); }
    proofMap.hidden = false; proofCounts.replaceChildren();
    const verified = current.definition.requirements.filter(item => requirementReviewState(current!, item.id) === 'verified').length;
    for (const [label, value] of [['Criteria with current verified reviews', `${verified} of ${current.definition.requirements.length}`],
      ['Current accepted dependencies', `${current.dependencies.filter(value => value.freshness === 'current' && value.acceptance === 'valid').length} of ${current.dependencies.length}`],
      ['Current assignee references', `${current.assignees.filter(value => value.freshness === 'current' && value.reference).length} of ${current.assignees.length}`]]) {
      const cell = node('div'); cell.append(node('dt', label), node('dd', value)); proofCounts.append(cell);
    }
    proofNote.textContent = current.proofCoverage === 'bounded' ? 'Loaded proof is bounded. Counts do not establish complete verification or acceptance.' : 'Manual review coverage and saved relationships. Execution completion and acceptance remain separate.';
    if (objective.textContent !== current.definition.objective) objective.textContent = current.definition.objective;
    const nextCriteria = JSON.stringify(current.definition.requirements);
    if (criteriaSignature !== nextCriteria) { criteriaSignature = nextCriteria; criteria.replaceChildren();
      for (const item of current.definition.requirements) { const row = node('li', item.text); row.dataset.requirementId = item.id; criteria.append(row); }
      if (!current.definition.requirements.length) criteria.append(node('li', 'No separate criteria recorded. General outcome review still requires actual evidence.')); }
    for (const row of criteria.children as unknown as HTMLElement[]) {
      if (!row.dataset.requirementId) continue;
      const state = requirementReviewState(current, row.dataset.requirementId);
      row.dataset.reviewState = state;
      let badge = row.querySelector<HTMLElement>('.aw-task-requirement-state');
      if (!badge) { badge = node('small', '', 'aw-task-requirement-state'); row.append(badge); }
      const label = ({ verified: 'Current verified review', 'needs-work': 'Needs work', stale: 'Review stale', unavailable: 'Review unavailable', unreviewed: 'Unreviewed' } as const)[state];
      if (badge.textContent !== label) badge.textContent = label;
    }
    const nextBindings = JSON.stringify([current.assignees, current.dependencies, current.sources]);
    if (bindingSignature !== nextBindings) { bindingSignature = nextBindings; bindings.replaceChildren();
      for (const type of ['assignees', 'dependencies', 'sources'] as const) for (const value of current[type]) { const row = node('div', '', 'aw-task-binding'); row.dataset.bindingKind = type; row.append(node('strong', type === 'assignees' ? 'Assignee' : type === 'dependencies' ? 'Dependency' : 'Source'), node('span', referenceName(type, value.reference)), node('small', value.freshness + (type === 'dependencies' ? ' · acceptance ' + ('acceptance' in value ? value.acceptance : '') : '')));
        if (value.reference && value.freshness !== 'unavailable' && options.openResource && 'resourceId' in value.reference) row.append(action('Open reference', () => openReference(value.reference))); bindings.append(row); } }
    attempts.append(node('h4', 'Existing execution references'));
    if (!current.attempts.length) attempts.append(node('p', 'No execution references linked. This tracker does not start execution.'));
    for (const [index, value] of current.attempts.entries()) { const row = node('div', '', 'aw-task-attempt'), metadata = value.execution.current;
      row.append(node('strong', 'Linked execution ' + (index + 1)), node('p', metadata ? 'Recorded state: ' + (metadata.state === 'provider_completed' ? 'provider response complete' : metadata.state) : 'Execution metadata unavailable'), node('small', value.execution.freshness + ' · manually linked · definition version ' + value.definitionVersion));
      if (metadata && options.openResource) row.append(action('Open linked resource', () => options.openResource!(metadata.resourceId))); attempts.append(row); }
    reviews.append(node('h4', 'Manual review records'));
    if (!current.reviews.length) reviews.append(node('p', 'No manual reviews recorded.'));
    for (const value of current.reviews.slice(-4).reverse()) { const row = node('article'); row.append(node('strong', value.decision.replaceAll('-', ' ')), node('small', 'Manual review · ' + value.freshness + ' · ' + value.provenance.at), node('p', value.note)); reviews.append(row); }
    if (current.proofCoverage === 'bounded') reviews.append(node('p', 'Proof coverage is bounded. This view cannot establish complete acceptance readiness.'));
    for (const value of panels) { value.element.inert = !value.open || !active; if (value.open) value.element.hidden = false; }
    if (draft) paintEditor(); paintReview(); if (acceptance.open) paintAcceptance(); setDisabled(); reflow();
  }
  function reflow() { if (disposed || !active) return; for (const value of panels) target(value.key, pose({ h: value.open && current ? value.element.scrollHeight || 260 : 0, opacity: value.open && current ? 1 : 0 }), 'task-tracker-panel'); }
  async function refresh() {
    if (disposed || !active) return; const token = ++sequence; loading = true; historySequence++; history = null; historyItems.replaceChildren(); historyStatus.textContent = ''; nextHistory.hidden = true; setDisabled();
    try { const document = await port.read(resourceId); if (disposed || !active || token !== sequence) return; if (document.resource.id !== resourceId || document.resource.kind !== 'task_objective') throw new Error('task_identity_mismatch');
      current = document; unavailable = false; needsRefresh = false; paint(); options.onProjection?.(document);
      if (historyPanel.open) await loadHistory();
      status.textContent = pending ? 'Recording objective change…' : retryRequest ? 'An earlier change is unconfirmed. Retry change checks its original receipt.' : draftConflict ? 'The definition changed elsewhere. Your local edits are retained.' : current.canEdit ? 'Manual decisions are recorded separately from execution.' : 'This objective is read-only.';
    } catch { if (!disposed && active && token === sequence) { current = null; unavailable = true; paint(); options.onProjection?.(null); status.textContent = 'This objective is unavailable or no longer accessible. Local edits remain in this view.'; } }
    finally { if (!disposed && active && token === sequence) { loading = false; setDisabled(); target(prefix, pose(), 'task-tracker-read'); } }
  }
  function mutate(op: TaskObjectiveOperation, done?: (receipt: TaskObjectiveReceipt) => void) { if (!canMutate() || !current) return Promise.resolve(); return send({ input: { commandId: 'task-tracker:' + crypto.randomUUID(), resourceId, expectedVersion: current.resource.version, operation: structuredClone(op) }, done }); }
  function send(request: { input: MutateTaskObjective; done?: (receipt: TaskObjectiveReceipt) => void }): Promise<void> {
    if (!active || disposed || pending || loading || current?.canEdit !== true) return Promise.resolve(); pending = true; status.textContent = 'Recording objective change…'; setDisabled();
    const saving = (async () => { let acknowledged = false;
      try { const receipt = await port.mutate(structuredClone(request.input));
        if (receipt.resourceId !== resourceId || receipt.commandId !== request.input.commandId || receipt.version !== request.input.expectedVersion + 1 || receipt.executionEffects !== 'none') throw new Error('Invalid Task Objective acknowledgment');
        acknowledged = true; retryRequest = null; if (!disposed) request.done?.(receipt); await refresh();
        if (!disposed && active) { if (!current) { needsRefresh = true; status.textContent = 'Change recorded. Refresh to read the current objective.'; } else status.textContent = 'Change recorded. Execution state is unchanged by this operation.'; }
      } catch (error) { const code = (error as { code?: string })?.code, rejected = typeof code === 'string' && code.startsWith('task_');
        if (!disposed) { retryRequest = acknowledged || rejected ? null : request; if (acknowledged) needsRefresh = true; if (rejected) submittedDefinition = null;
          if (code === 'task_read_only' && current) current = { ...current, canEdit: false };
          if (['task_unavailable', 'task_project_unavailable', 'task_identity_unavailable'].includes(code ?? '')) { current = null; unavailable = true; options.onProjection?.(null); }
          if (active) { paint(); report(error); if (!acknowledged && !rejected) status.textContent = 'The change could not be confirmed. Retry change checks the same command without recording another decision.'; } }
      } finally { pending = false; if (!disposed) setDisabled(); }
    })(); operation = saving; return saving.finally(() => { if (operation === saving) operation = null; });
  }
  section.dataset.resourceId = resourceId; section.dataset.noCardDrag = 'true'; section.dataset.presentation = options.presentation ?? 'focused'; section.setAttribute('aria-label', 'Task Tracker');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  section.append(title, states, node('h4', 'Objective'), objective, proofMap, node('h4', 'Requirements'), criteria, bindings, actions, editor.element, attempts, review.element, acceptance.element, closePanel.element, reviews, historyPanel.element, caveat, status);
  root.append(section); section.inert = !active; section.hidden = !active; section.style.opacity = '0'; paint(); if (active) void refresh();
  return {
    refresh,
    setActive(value) { if (disposed || active === value) return; active = value; section.inert = !value; if (value) { section.hidden = false; void refresh(); } else { sequence++; historySequence++; loading = false; } target(prefix, pose({ opacity: value ? 1 : 0, y: value ? 0 : 6 }), 'task-tracker-visibility'); setDisabled(); },
    setPresentation(value) { if (!disposed) { section.dataset.presentation = value; reflow(); } }, reflow,
    frame() { if (disposed || !active && section.hidden) return; const value = motion.pose(prefix); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; if (!active && value.opacity < .001) section.hidden = true;
      for (const value of panels) { const body = motion.pose(value.key); value.element.style.height = Math.max(0, body.h) + 'px'; value.element.style.opacity = String(body.opacity); if ((!value.open || !current) && body.h < .5) value.element.hidden = true; } },
    async flush() { if (operation) await operation; if (retryRequest || needsRefresh) throw new Error('Task Objective change needs confirmation before leaving.'); },
    hasUnsavedChanges() { return !!draft || !!reviewNote || reviewEvidence.length > 0 || reviewCriteria.size > 0 || !!reviewBasis && (reviewDecision !== 'needs-work' || !!reviewAttempt) || !!retryRequest; },
    dispose() { if (disposed) return; disposed = true; sequence++; historySequence++; section.inert = true; section.remove(); for (const key of keys) motion.remove(key); keys.clear(); criterionInputs.clear(); reviewChecks.clear(); },
  };
}
