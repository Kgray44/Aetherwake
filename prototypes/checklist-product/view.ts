import type { ChecklistDocument, ChecklistEntry, ChecklistOperation, ChecklistPort, ChecklistReference, ChecklistReferenceView, MutateChecklist } from '../application-contract/checklist.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const element = document.createElement(tag); element.className = cls; element.textContent = text;
  if (['button', 'input', 'textarea', 'select'].includes(tag)) element.dataset.aerynthMotionControl = 'true';
  return element;
};
const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });
const editable = (entry: ChecklistEntry) => ({ text: entry.text, description: entry.description, priority: entry.priority, dueDate: entry.dueDate, groupId: entry.groupId });
type Values = ReturnType<typeof editable>;
type Row = {
  element: HTMLLIElement; core: HTMLElement; panel: HTMLElement; checkbox: HTMLInputElement; text: HTMLInputElement;
  description: HTMLTextAreaElement; priority: HTMLSelectElement; due: HTMLInputElement; group: HTMLSelectElement;
  metadata: HTMLElement; references: HTMLElement; disclosure: HTMLButtonElement; conflict: HTMLElement;
  controls: HTMLButtonElement[]; conflictControls: HTMLButtonElement[]; reference: HTMLButtonElement; key: string; baseHeight: number; open: boolean; visible: boolean; draft?: { base: Values; values: Values }; submitted?: Values;
};
export interface ChecklistExperience {
  update(document: ChecklistDocument): void;
  setActive(active: boolean): void;
  setPresentation(presentation: 'workspace' | 'focused'): void;
  refresh(): Promise<void>;
  flush(): Promise<void>;
  /** Host calls after a surface resize; no independent observer/frame loop. */
  reflow(): void;
  /** Called only by Root's existing frame; this component has no scheduler. */
  frame(): void;
  dispose(): void;
}

/** One retained reader/editor for workspace and independent direct focus.
 * Root supplies canonical commands, navigation and its existing coordinator. */
export function mountChecklistExperience(root: HTMLElement, resourceId: string, port: ChecklistPort, options: {
  viewId: string; motion: ExperienceMotionPort; active?: boolean; presentation?: 'workspace' | 'focused';
  chooseReference?(): Promise<ChecklistReference | null>;
  openReference?(reference: ChecklistReference): void | Promise<void>;
}): ChecklistExperience {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const motion = options.motion, prefix = 'checklist:' + options.viewId, keys = new Set<string>(), rows = new Map<string, Row>();
  const section = node('section', '', 'aw-checklist'), header = node('header'), title = node('h3'), summary = node('p', '', 'aw-checklist-summary');
  const tools = node('div', '', 'aw-checklist-tools'), search = node('input'), filter = node('select'), groupFilter = node('select');
  const form = node('form', '', 'aw-checklist-add'), addText = node('input'), list = node('ol', '', 'aw-checklist-items');
  const sources = node('div', '', 'aw-checklist-sources'), status = node('p', '', 'aw-checklist-status');
  let current: ChecklistDocument | null = null, active = options.active ?? true, disposed = false, pending = false, unavailable = false, sequence = 0;
  let operation: Promise<void> | null = null, groupsOpen = false, needsRefresh = false;
  let retryRequest: { input: MutateChecklist; done?: () => void } | null = null;
  const addMotion = (key: string, initial: ExperiencePose) => { motion.add(key, initial); keys.add(key); };
  const target = (key: string, value: ExperiencePose, cause: string) => { motion.target(key, value, cause); motion.wake(); };
  addMotion(prefix, pose({ opacity: 0, y: 6 })); addMotion(prefix + ':list', pose({ h: 0 })); addMotion(prefix + ':groups', pose({ h: 0, opacity: 0 }));
  section.dataset.resourceId = resourceId; section.dataset.noCardDrag = 'true'; section.dataset.presentation = options.presentation ?? 'focused'; section.setAttribute('aria-label', 'Checklist');
  section.style.opacity = '0'; list.style.height = '0px';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const report = (error: unknown) => {
    if (disposed || !active) return;
    const code = (error as { code?: string })?.code;
    status.textContent = code === 'checklist_version_conflict' ? 'This checklist changed elsewhere. Refresh to review it; your local edits are retained.'
      : code === 'checklist_reference_unavailable' ? 'That source is unavailable or outside the permitted scope.'
      : code === 'checklist_read_only' ? 'This checklist is read-only.' : 'The change could not be saved. Your local edits are retained.';
  };
  const action = (label: string, work: () => void | Promise<void>) => {
    const value = node('button', label); value.type = 'button'; value.onclick = () => {
      if (disposed || !active) return;
      try { void Promise.resolve(work()).catch(report); } catch (error) { report(error); }
    }; return value;
  };
  const field = (label: string, input: HTMLElement) => { const wrapper = node('label', label); wrapper.append(input); return wrapper; };
  const canEdit = () => !!current?.canEdit && active && !pending && !unavailable && !needsRefresh && !retryRequest && !disposed;
  const currentEntry = (entryId: string) => current?.entries.find(entry => entry.id === entryId);
  const rowConflict = (row: Row, entry: ChecklistEntry) => !!row.draft && JSON.stringify(row.draft.base) !== JSON.stringify(editable(entry)) &&
    (!row.submitted || JSON.stringify(row.submitted) !== JSON.stringify(editable(entry)));
  const setDisabled = () => {
    addText.disabled = add.disabled = !canEdit(); groupTitle.disabled = addGroup.disabled = !canEdit();
    section.setAttribute('aria-busy', String(pending));
    for (const [id, row] of rows) {
      const entry = currentEntry(id), disabled = !canEdit() || !entry;
      for (const control of [row.checkbox, row.text, row.description, row.priority, row.due, row.group, ...row.controls]) control.disabled = disabled;
      row.reference.disabled = disabled || !options.chooseReference;
    }
    section.querySelectorAll<HTMLButtonElement>('[data-checklist-edit-control]').forEach(button => { button.disabled = !canEdit(); });
    link.disabled = !canEdit() || !options.chooseReference;
    manageGroup.disabled = !canEdit(); groupName.disabled = !canEdit() || !current?.groups.some(group => group.id === manageGroup.value);
    for (const control of groupControls) control.disabled = groupName.disabled;
    retry.hidden = !retryRequest; retry.disabled = !active || pending || !current?.canEdit || unavailable;
  };
  const newReference = async (entryId?: string) => {
    if (!canEdit() || !options.chooseReference) return;
    const chosen = await options.chooseReference(); if (!chosen || !canEdit()) return;
    await mutate([{ type: 'addReference', ...(entryId ? { entryId } : {}), reference: chosen }]);
  };
  const renderReferences = (container: HTMLElement, references: ChecklistReferenceView[], entryId?: string) => {
    const signature = JSON.stringify(references);
    if (container.dataset.referenceSignature === signature) return;
    container.dataset.referenceSignature = signature;
    container.replaceChildren();
    for (const reference of references) {
      const line = node('div', '', 'aw-checklist-reference');
      const open = action(reference.title, () => {
        if (!current || unavailable || (entryId && !currentEntry(entryId))) return;
        const latest = (entryId ? currentEntry(entryId)?.references : current.references)?.find(ref => ref.id === reference.id);
        if (latest?.available && latest.target && options.openReference) return options.openReference(latest.target);
      });
      open.disabled = !reference.available || !options.openReference;
      const remove = action('Remove source', () => mutate([{ type: 'removeReference', ...(entryId ? { entryId } : {}), referenceId: reference.id }])); remove.disabled = !canEdit();
      remove.dataset.checklistEditControl = 'true';
      line.append(open, remove); container.append(line);
    }
  };
  const refresh = async () => {
    const token = ++sequence;
    try { const value = await port.read(resourceId); if (disposed || !active || token !== sequence) return; needsRefresh = false; update(value); setDisabled(); status.textContent = pending ? 'Saving checklist change…' : retryRequest ? 'An earlier change is unconfirmed. Use Retry save to check the same attempt.' : current?.canEdit ? 'Manual checklist. Changes are saved locally.' : 'This checklist is read-only.'; }
    catch { if (!disposed && active && token === sequence) { unavailable = true; list.inert = true; list.hidden = true; sources.replaceChildren(); delete sources.dataset.referenceSignature; status.textContent = 'This checklist is unavailable. Its saved data is retained.'; setDisabled(); } }
  };
  const send = (request: { input: MutateChecklist; done?: () => void }): Promise<void> => {
    if (disposed || !active || pending || unavailable || !current?.canEdit) return Promise.reject(new Error('checklist_unavailable'));
    pending = true; status.textContent = 'Saving checklist change…'; setDisabled(); let acknowledged = false;
    operation = (async () => {
      try {
        const result = await port.mutate(request.input);
        if (result.resourceId !== resourceId || !Number.isSafeInteger(result.version) || result.version < request.input.expectedVersion) throw new Error('invalid_checklist_acknowledgment');
        acknowledged = true; retryRequest = null; if (!disposed) request.done?.();
        const document = await port.read(resourceId);
        if (document.resource.version < result.version) throw new Error('stale_checklist_refresh');
        if (!disposed) { needsRefresh = false; update(document); if (active) { paint(); status.textContent = 'Checklist saved. Checkmarks record manual or user-approved completion.'; } }
      } catch (error) {
        const code = (error as { code?: string })?.code, rejected = typeof code === 'string' && (code.startsWith('checklist_') || code === 'invalid_checklist_input' || code.startsWith('canonical_checklist_'));
        if (!disposed) { if (acknowledged) needsRefresh = true; else retryRequest = rejected ? null : request;
          if (active) { paint(); report(error); if (acknowledged) status.textContent = 'Change saved. The current list could not be refreshed; use Refresh checklist.';
            else if (!rejected) status.textContent = 'The save could not be confirmed. Retry save checks the same attempt without duplicating it.'; } }
        throw error;
      }
      finally { pending = false; operation = null; if (!disposed) setDisabled(); }
    })(); return operation;
  };
  const mutate = (operations: ChecklistOperation[], done?: () => void): Promise<void> => {
    if (!canEdit() || !current) return Promise.reject(new Error('checklist_unavailable'));
    return send({ input: { commandId: crypto.randomUUID(), resourceId, expectedVersion: current.resource.version, operations }, done });
  };
  const saveRow = (entryId: string) => {
    const row = rows.get(entryId), entry = currentEntry(entryId); if (!row?.draft || !entry) return Promise.resolve();
    if (JSON.stringify(editable(entry)) !== JSON.stringify(row.draft.base)) {
      row.conflict.textContent = 'This item changed elsewhere. Choose Use saved or Keep my edits before saving.'; return Promise.reject(new Error('checklist_entry_conflict'));
    }
    const values = { ...row.draft.values };
    row.submitted = values;
    return mutate([{ type: 'editEntry', entryId, patch: values }], () => {
      if (row.draft) {
        if (JSON.stringify(row.draft.values) === JSON.stringify(values)) row.draft = undefined;
        else row.draft.base = { ...values };
      }
      row.submitted = undefined;
    }).catch(error => { if (!retryRequest) row.submitted = undefined; if (!disposed) paint(); throw error; });
  };
  const rowFor = (entry: ChecklistEntry): Row => {
    const element = node('li', '', 'aw-checklist-entry'), core = node('div', '', 'aw-checklist-entry-core'), checkbox = node('input'), input = node('input');
    checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Check item manually'); input.maxLength = 240; input.setAttribute('aria-label', 'Checklist item text'); input.title = 'Edit text, then press Enter or Save changes.';
    const metadata = node('small', '', 'aw-checklist-entry-meta'), panel = node('div', '', 'aw-checklist-entry-details'), description = node('textarea'), priority = node('select'), due = node('input'), group = node('select'), references = node('div'), conflict = node('p', '', 'aw-checklist-conflict');
    description.maxLength = 4000; description.rows = 3; due.type = 'date';
    for (const value of ['low', 'normal', 'high', 'urgent']) { const option = node('option', value); option.value = value; priority.append(option); }
    const key = prefix + ':entry:' + entry.id; addMotion(key, pose({ opacity: 0, h: 76 }));
    element.style.opacity = '0';
    const row: Row = { element, core, panel, checkbox, text: input, description, priority, due, group, metadata, references, disclosure: null!, reference: null!, conflict, controls: [], conflictControls: [], key, baseHeight: 76, open: false, visible: true };
    const draft = () => {
      const source = currentEntry(entry.id); if (!source) return;
      row.draft ??= { base: editable(source), values: editable(source) };
      row.draft.values = { text: input.value, description: description.value, priority: priority.value as ChecklistEntry['priority'], dueDate: due.value || null, groupId: group.value || null };
    };
    for (const control of [input, description, priority, due, group]) { control.oninput = draft; control.onchange = draft; }
    input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void saveRow(entry.id).catch(report); } };
    checkbox.onchange = () => { const current = currentEntry(entry.id), checked = checkbox.checked; checkbox.checked = current?.checked ?? false; if (current) void mutate([{ type: 'setChecked', entryId: entry.id, checked }]).catch(() => {}); };
    const disclosure = row.disclosure = action('Details', () => { row.open = !row.open; panel.inert = !row.open; if (row.open) panel.hidden = false; disclosure.setAttribute('aria-expanded', String(row.open)); layout(); });
    disclosure.setAttribute('aria-expanded', 'false');
    const move = (delta: number) => {
      if (!current) return; const order = current.entries.map(item => item.id), index = order.indexOf(entry.id), next = index + delta;
      if (next >= 0 && next < order.length) { [order[index], order[next]] = [order[next], order[index]]; return mutate([{ type: 'reorderEntries', entryIds: order }]); }
    };
    const up = action('Move item up', () => move(-1)), down = action('Move item down', () => move(1)), remove = action('Remove item', () => mutate([{ type: 'removeEntry', entryId: entry.id }]));
    const save = action('Save changes', () => saveRow(entry.id)), useSaved = action('Use saved', () => {
      const source = currentEntry(entry.id); if (!source || !canEdit() || !rowConflict(row, source)) return;
      row.draft = undefined; row.submitted = undefined; paint();
    }), keep = action('Keep my edits', () => {
      const source = currentEntry(entry.id); if (source && row.draft && canEdit() && rowConflict(row, source)) {
        row.draft.base = editable(source); paint(); status.textContent = 'Your edits are retained. Save changes to apply them.';
      }
    });
    useSaved.hidden = keep.hidden = true; row.conflictControls.push(useSaved, keep);
    const reference = row.reference = action('Link source', () => newReference(entry.id)); reference.disabled = !options.chooseReference;
    if (!options.chooseReference) reference.title = 'Source selection is unavailable in this surface.';
    row.controls.push(up, down, remove, save, useSaved, keep, reference);
    core.append(checkbox, input, disclosure, metadata); panel.append(field('Description', description), field('Priority', priority), field('Due date', due), field('Group', group), save, up, down, remove, reference, conflict, useSaved, keep, references);
    panel.inert = true; panel.hidden = true; element.append(core, panel); element.dataset.checklistEntryId = entry.id; list.append(element); return row;
  };
  const layout = () => {
    if (!current || disposed) return;
    let y = 0; const query = search.value.toLocaleLowerCase();
    for (const entry of current.entries) {
      const row = rows.get(entry.id)!;
      const visible = (!query || (entry.text + ' ' + entry.description).toLocaleLowerCase().includes(query))
        && (filter.value !== 'open' || !entry.checked) && (filter.value !== 'checked' || entry.checked)
        && (!groupFilter.value || (groupFilter.value === '__none' ? !entry.groupId : entry.groupId === groupFilter.value));
      row.visible = visible; row.element.inert = !visible || !active; if (visible) row.element.hidden = false;
      const base = row.baseHeight = Math.max(64, row.core.offsetHeight || 76), height = base + (row.open ? Math.min(600, row.panel.scrollHeight || 360) : 0);
      target(row.key, pose({ y: visible ? y : motion.pose(row.key).y, h: height, opacity: visible ? 1 : 0 }), 'checklist-layout'); if (visible) y += height + 10;
    }
    target(prefix + ':list', pose({ h: y }), 'checklist-list-layout');
  };
  const paint = () => {
    if (!current || disposed) return;
    title.textContent = current.resource.title; summary.textContent = `${current.entries.filter(entry => entry.checked).length} of ${current.entries.length} checked · manual synchronization`;
    list.hidden = false; list.inert = !active;
    const selectedGroup = groupFilter.value; groupFilter.replaceChildren();
    for (const [value, label] of [['', 'All groups'], ['__none', 'Ungrouped'], ...current.groups.map(group => [group.id, group.title])]) { const option = node('option', label); option.value = value; groupFilter.append(option); } groupFilter.value = selectedGroup;
    renderReferences(sources, current.references);
    const live = new Set(current.entries.map(entry => entry.id));
    for (const [id, row] of rows) if (!live.has(id)) { row.visible = false; row.element.inert = true; target(row.key, pose({ ...motion.pose(row.key), opacity: 0 }), 'checklist-entry-removed'); }
    for (const entry of current.entries) {
      let row = rows.get(entry.id); if (!row) { row = rowFor(entry); rows.set(entry.id, row); }
      row.checkbox.checked = entry.checked;
      const values = row.draft?.values ?? editable(entry);
      for (const [field, value] of [[row.text, values.text], [row.description, values.description], [row.priority, values.priority], [row.due, values.dueDate ?? '']] as const) if (field.value !== value) field.value = value;
      const selected = values.groupId ?? '', options = [['', 'Ungrouped'], ...current.groups.map(group => [group.id, group.title])], signature = JSON.stringify(options);
      if (row.group.dataset.optionSignature !== signature) { row.group.replaceChildren(); for (const [value, label] of options) { const option = node('option', label); option.value = value; row.group.append(option); } row.group.dataset.optionSignature = signature; }
      if (row.group.value !== selected) row.group.value = selected;
      row.metadata.textContent = [current.groups.find(group => group.id === entry.groupId)?.title, entry.priority !== 'normal' ? entry.priority : '', entry.dueDate ? 'Due ' + entry.dueDate : '', entry.completion ? 'Checked state: ' + entry.completion.basis : ''].filter(Boolean).join(' · ');
      const conflict = rowConflict(row, entry);
      row.conflict.textContent = conflict ? 'This item changed elsewhere. Your local edits are retained.' : '';
      for (const control of row.conflictControls) control.hidden = !conflict;
      renderReferences(row.references, entry.references, entry.id); list.append(row.element);
    }
    setDisabled(); layout();
    const selected = manageGroup.value, signature = JSON.stringify(current.groups);
    if (manageGroup.dataset.optionSignature !== signature) {
      manageGroup.replaceChildren(); const choose = node('option', 'Choose a group'); choose.value = ''; manageGroup.append(choose);
      for (const group of current.groups) { const option = node('option', group.title); option.value = group.id; manageGroup.append(option); }
      manageGroup.dataset.optionSignature = signature; manageGroup.value = current.groups.some(group => group.id === selected) ? selected : '';
    }
    if (!groupNameDirty) groupName.value = current.groups.find(group => group.id === manageGroup.value)?.title ?? '';
    setDisabled();
    if (groupsOpen) target(prefix + ':groups', pose({ h: groupsPanel.scrollHeight || 180 }), 'checklist-groups-layout');
  };
  const update = (document: ChecklistDocument) => {
    if (disposed) return; if (document.resource.id !== resourceId || document.resource.kind !== 'checklist') throw new Error('Checklist view identity cannot change.');
    if (current && document.resource.version < current.resource.version) return;
    if (!unavailable && JSON.stringify(document) === JSON.stringify(current)) return;
    current = document; unavailable = false; if (active) { paint(); target(prefix, pose(), 'checklist-ready'); }
  };
  search.type = 'search'; search.placeholder = 'Find an item'; search.setAttribute('aria-label', 'Find checklist items'); search.oninput = layout;
  filter.setAttribute('aria-label', 'Show checklist items'); groupFilter.setAttribute('aria-label', 'Filter checklist group');
  for (const [value, label] of [['all', 'All items'], ['open', 'Unchecked'], ['checked', 'Checked']]) { const option = node('option', label); option.value = value; filter.append(option); } filter.value = 'all'; filter.onchange = groupFilter.onchange = layout;
  const reload = action('Refresh checklist', refresh), link = action('Link source', () => newReference()), retry = action('Retry save', () => retryRequest ? send(retryRequest) : undefined);
  retry.hidden = true; tools.append(search, filter, groupFilter, reload, link, retry);
  addText.required = true; addText.maxLength = 240; addText.placeholder = 'Add an actionable item'; addText.setAttribute('aria-label', 'New checklist item');
  const add = node('button', 'Add item'); add.type = 'submit'; form.append(addText, add);
  form.onsubmit = event => { event.preventDefault(); if (!addText.value.trim() || !canEdit()) return; const value = addText.value; void mutate([{ type: 'addEntry', key: 'newItem', entry: { text: value } }], () => { if (addText.value === value) addText.value = ''; }).catch(() => {}); };
  const groupForm = node('form', '', 'aw-checklist-groups'), groupTitle = node('input'), addGroup = node('button', 'Add group');
  groupTitle.maxLength = 120; groupTitle.required = true; groupTitle.placeholder = 'New group'; groupTitle.setAttribute('aria-label', 'New checklist group'); addGroup.type = 'submit'; groupForm.append(groupTitle, addGroup);
  groupForm.onsubmit = event => { event.preventDefault(); if (!groupTitle.value.trim() || !canEdit()) return; const value = groupTitle.value; void mutate([{ type: 'addGroup', key: 'newGroup', title: value }], () => { if (groupTitle.value === value) groupTitle.value = ''; }).catch(() => {}); };
  const groupsPanel = node('div', '', 'aw-checklist-group-panel'), manageGroup = node('select'), groupName = node('input'); let groupNameDirty = false;
  manageGroup.setAttribute('aria-label', 'Manage checklist group'); groupName.setAttribute('aria-label', 'Group name'); groupName.maxLength = 120;
  manageGroup.onchange = () => { groupNameDirty = false; groupName.value = current?.groups.find(group => group.id === manageGroup.value)?.title ?? ''; setDisabled(); };
  groupName.oninput = () => { groupNameDirty = true; };
  const renameGroup = action('Save group name', () => {
    if (!manageGroup.value || !groupName.value.trim()) return;
    return mutate([{ type: 'renameGroup', groupId: manageGroup.value, title: groupName.value }], () => { groupNameDirty = false; });
  });
  const moveGroup = (delta: number) => {
    if (!current) return; const ids = current.groups.map(group => group.id), index = ids.indexOf(manageGroup.value), next = index + delta;
    if (index >= 0 && next >= 0 && next < ids.length) { [ids[index], ids[next]] = [ids[next], ids[index]]; return mutate([{ type: 'reorderGroups', groupIds: ids }]); }
  };
  const upGroup = action('Move group up', () => moveGroup(-1)), downGroup = action('Move group down', () => moveGroup(1)), removeGroup = action('Remove group', () => {
    if (!manageGroup.value) return; return mutate([{ type: 'removeGroup', groupId: manageGroup.value }], () => { manageGroup.value = ''; groupNameDirty = false; });
  }), groupControls = [renameGroup, upGroup, downGroup, removeGroup];
  const groupsButton = action('Groups', () => { groupsOpen = !groupsOpen; groupsPanel.inert = !groupsOpen; if (groupsOpen) groupsPanel.hidden = false;
    groupsButton.setAttribute('aria-expanded', String(groupsOpen)); target(prefix + ':groups', pose({ h: groupsOpen ? groupsPanel.scrollHeight || 180 : 0, opacity: groupsOpen ? 1 : 0 }), 'checklist-groups-disclosure'); });
  groupsButton.setAttribute('aria-expanded', 'false'); groupsPanel.hidden = true; groupsPanel.inert = true;
  groupsPanel.append(groupForm, field('Group', manageGroup), field('Group name', groupName), ...groupControls); tools.append(groupsButton);
  if (!options.chooseReference) link.title = 'Source selection is unavailable in this surface.';
  header.append(title, summary); section.append(header, tools, sources, form, list, groupsPanel, status); root.append(section); section.inert = !active; section.hidden = !active; setDisabled(); if (active) void refresh();
  return {
    update,
    setPresentation(value) { if (!disposed) { section.dataset.presentation = value; if (active) layout(); } },
    setActive(value) { if (disposed || active === value) return; active = value; section.inert = !value; if (value) { section.hidden = false; if (current && !unavailable) paint(); void refresh(); } else sequence++; target(prefix, pose({ opacity: value ? 1 : 0, y: value ? 0 : 6 }), 'checklist-visibility'); setDisabled(); },
    refresh,
    reflow() { if (!disposed && active) { layout(); if (groupsOpen) target(prefix + ':groups', pose({ h: groupsPanel.scrollHeight || 180 }), 'checklist-groups-layout'); } },
    async flush() { if (operation) await operation; if (retryRequest || needsRefresh) throw new Error('Checklist change needs confirmation before leaving.'); for (const [entryId, row] of rows) if (row.draft) await saveRow(entryId); },
    frame() {
      if (disposed) return; const value = motion.pose(prefix); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; if (!active && value.opacity < .001) section.hidden = true;
      list.style.height = Math.max(0, motion.pose(prefix + ':list').h) + 'px';
      const groups = motion.pose(prefix + ':groups'); groupsPanel.style.height = Math.max(0, groups.h) + 'px'; groupsPanel.style.opacity = String(groups.opacity); if (!groupsOpen && groups.opacity < .001) groupsPanel.hidden = true;
      for (const [id, row] of rows) {
        const value = motion.pose(row.key); row.element.style.opacity = String(value.opacity); row.element.style.transform = `translateY(${value.y}px)`; row.element.style.height = Math.max(0, value.h) + 'px';
        if (!row.visible && value.opacity < .001) { row.element.hidden = true; if (!currentEntry(id)) { row.element.remove(); rows.delete(id); motion.remove(row.key); keys.delete(row.key); } }
        if (!row.open && value.h <= row.baseHeight + .5) row.panel.hidden = true;
      }
    },
    dispose() { if (disposed) return; disposed = true; sequence++; for (const key of keys) motion.remove(key); keys.clear(); rows.clear(); section.remove(); },
  };
}
