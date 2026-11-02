import type { TimelineDocument, TimelinePort, TimelineView, TimelineWindow, TimelineSelection, RecordedTimelineItem, SaveTimeline, TimelineGapReason } from '../timeline-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export interface TimelineExperience {
  refresh(): Promise<void>;
  setActive(active: boolean): void;
  setPresentation(presentation: 'workspace' | 'focused'): void;
  reflow(): void;
  frame(): void;
  flush(): Promise<void>;
  dispose(): void;
}
const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });
const gapLabels: Record<TimelineGapReason, string> = {
  'source-unavailable': 'The retained event source is unavailable.',
  'before-retained-cursor': 'Earlier activity is outside the retained source range.',
  'cursor-discontinuity': 'The capture sequence has a gap of unknown cause.',
  'unsupported-event-schema': 'Some retained events use an unsupported format.',
  'invalid-event': 'Some retained event headers could not be read.',
  'access-filtered': 'Current access rules exclude some source evidence.',
  'scan-limit': 'This query reached its scan limit; more retained evidence may exist.',
  'selection-unavailable': 'The saved event selection is unavailable.',
};
const sameSelection = (a: TimelineSelection | null, b: TimelineSelection | null) => a?.eventId === b?.eventId && a?.cursor === b?.cursor;
const keyOf = (item: RecordedTimelineItem) => item.event.cursor + ':' + item.event.eventId;

/** Retained-header viewer. Root owns time/event storage, current authority,
 * canonical mutations, source navigation and the existing shared frame. */
export function mountTimelineExperience(root: HTMLElement, resourceId: string, port: TimelinePort, options: {
  motion: ExperienceMotionPort; viewId: string; active?: boolean; presentation?: 'workspace' | 'focused';
  onOpenResource?(resourceId: string): void | Promise<void>;
  resourceTitle?(resourceId: string): string | undefined;
  onProjection?(document: TimelineDocument | null, window: TimelineWindow | null): void;
}): TimelineExperience {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const motion = options.motion, prefix = 'timeline:' + options.viewId, owned = new Set<string>();
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const element = document.createElement(tag); element.textContent = text; element.className = cls;
    if (['button', 'input', 'select'].includes(tag)) element.dataset.aerynthMotionControl = 'true'; return element;
  };
  const section = node('section', '', 'aw-timeline'), title = node('h3'), range = node('p', '', 'aw-timeline-range');
  const toolbar = node('div', '', 'aw-timeline-tools'), filterPanel = node('form', '', 'aw-timeline-filters');
  const mode = node('select'), from = node('input'), to = node('input'), provider = node('select'), eventType = node('select'), classification = node('select');
  const track = node('div', '', 'aw-timeline-track'), legend = node('p', '', 'aw-timeline-legend'), items = node('ol', '', 'aw-timeline-items');
  const selection = node('section', '', 'aw-timeline-selection'), gaps = node('ul', '', 'aw-timeline-gaps'), coverage = node('p', '', 'aw-timeline-coverage');
  const status = node('p', '', 'aw-timeline-status'), review = node('div', '', 'aw-timeline-review');
  let current: TimelineDocument | null = null, window: TimelineWindow | null = null, active = options.active ?? true, disposed = false, busy = false, sequence = 0, unavailable = false;
  let selected: TimelineSelection | null = null, filtersOpen = false, dirty = false, baseVersion = 0, baseView: TimelineView | null = null, needsReview = false, needsRefresh = false;
  let request: { input: SaveTimeline; previous: TimelineView; remember: boolean } | null = null, operation: Promise<void> | null = null;
  const previousViews: TimelineView[] = [], rows = new Map<string, { item: RecordedTimelineItem; row: HTMLLIElement; core: HTMLButtonElement; dot: HTMLButtonElement; key: string; height: number }>();
  let retainedFields: string[] | null = null;
  const addMotion = (key: string, value: ExperiencePose) => { motion.add(key, value); owned.add(key); };
  const target = (key: string, value: ExperiencePose, cause: string) => { motion.target(key, value, cause); motion.wake(); };
  addMotion(prefix, pose({ opacity: 0, y: 6 })); addMotion(prefix + ':list', pose({ h: 0 })); addMotion(prefix + ':filters', pose({ h: 0, opacity: 0 }));
  const canEdit = () => active && !disposed && current?.canEdit === true && !busy && !request && !needsRefresh && !needsReview;
  const formatTime = (value: string) => { try { return new Intl.DateTimeFormat(undefined, { timeZone: current?.view.viewport.displayTimeZone ?? 'UTC', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)); } catch { return value; } };
  const label = (text: string, control: HTMLElement) => { const value = node('label', text); control.setAttribute('aria-label', text); value.append(control); return value; };
  const action = (text: string, work: () => void | Promise<void>) => {
    const value = node('button', text); value.type = 'button'; value.onclick = () => {
      if (disposed || !active) return;
      try { void Promise.resolve(work()).catch(() => { if (!disposed) status.textContent = 'This action did not finish. You can try again.'; }); }
      catch { status.textContent = 'Enter a valid capture-time interval before applying this view.'; }
    }; return value;
  };
  const markDirty = () => { if (!dirty && current) { baseVersion = current.resource.version; baseView = structuredClone(current.view); } dirty = true; setDisabled(); };
  const readFilter = (control: HTMLSelectElement, saved: string[]) => control.value === '__saved' ? [...saved] : control.value ? [control.value] : [];
  const collect = (): TimelineView => {
    if (!current) throw new Error('Timeline unavailable');
    const base = dirty && baseView ? baseView : current.view;
    const start = new Date(from.value + 'Z'), end = new Date(to.value + 'Z');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('Invalid capture interval');
    return { ...structuredClone(base), mode: mode.value as TimelineView['mode'], viewport: { ...base.viewport, from: start.toISOString(), to: end.toISOString() },
      sources: { providerIds: readFilter(provider, base.sources.providerIds), eventTypes: readFilter(eventType, base.sources.eventTypes), classifications: classification.value ? readFilter(classification, base.sources.classifications) as TimelineView['sources']['classifications'] : ['observed', 'reported', 'inferred', 'simulated'] }, selection: selected ? { ...selected } : null };
  };
  const apply = action('Save view', () => { if (canEdit()) return save(collect()); });
  const pan = (direction: number) => {
    if (!canEdit()) return; const view = collect(), start = Date.parse(view.viewport.from), end = Date.parse(view.viewport.to), shift = (end - start) * direction;
    view.viewport = { ...view.viewport, from: new Date(start + shift).toISOString(), to: new Date(end + shift).toISOString() }; view.selection = null; return save(view);
  };
  const zoom = (factor: number) => {
    if (!canEdit()) return; const view = collect(), start = Date.parse(view.viewport.from), end = Date.parse(view.viewport.to), half = Math.max(500, Math.min(315360000000, (end - start) * factor / 2)), center = (start + end) / 2;
    view.viewport = { ...view.viewport, from: new Date(center - half).toISOString(), to: new Date(center + half).toISOString() }; return save(view);
  };
  const earlier = action('Earlier', () => pan(-1)), later = action('Later', () => pan(1)), closer = action('Zoom in', () => zoom(.5)), wider = action('Zoom out', () => zoom(2));
  const back = action('Previous view', () => { if (canEdit() && previousViews.length) return save(structuredClone(previousViews.at(-1)!), false); });
  const refreshButton = action('Refresh timeline', () => load(false)), more = action('Next events', () => load(true));
  const retry = action('Retry save', () => send()), filterButton = action('Filters', () => {
    filtersOpen = !filtersOpen; filterPanel.inert = !filtersOpen; if (filtersOpen) filterPanel.hidden = false;
    filterButton.setAttribute('aria-expanded', String(filtersOpen)); reflow();
  });
  const useSaved = action('Use saved view', () => { if (!current) return; dirty = needsReview = false; baseView = null; selected = current.view.selection; paintFields(); paint(); });
  const keepMine = action('Keep my view', () => { if (current) { baseVersion = current.resource.version; needsReview = false; paint(); } });
  review.append(node('p', 'This view changed elsewhere. Review its current events, then choose which settings to keep.'), useSaved, keepMine);
  const setOptions = (control: HTMLSelectElement, saved: string[], choices: string[], empty: string) => {
    control.replaceChildren(); const all = node('option', empty); all.value = ''; control.append(all);
    if (saved.length > 1) { const value = node('option', 'Saved selection (' + saved.length + ')'); value.value = '__saved'; control.append(value); }
    for (const item of [...new Set([...saved, ...choices])].sort()) { const option = node('option', item.replaceAll('_', ' ').replaceAll('.', ' ')); option.value = item; control.append(option); }
    control.value = saved.length > 1 ? '__saved' : saved[0] ?? '';
  };
  function redactFields() {
    if (dirty && !retainedFields) retainedFields = [mode.value, from.value, to.value, provider.value, eventType.value, classification.value];
    from.value = to.value = ''; for (const control of [provider, eventType, classification]) { control.replaceChildren(); const value = node('option', 'No source data loaded'); value.value = ''; control.append(value); control.value = ''; }
  }
  function restoreFields() {
    if (!retainedFields || !current) return;
    const values = retainedFields; retainedFields = null;
    for (const [index, control] of [mode, from, to, provider, eventType, classification].entries()) {
      if (index >= 3 && !Array.from((control as HTMLSelectElement).options).some(option => option.value === values[index])) {
        const value = node('option', 'Previous draft selection'); value.value = values[index]; control.append(value);
      }
      control.value = values[index];
    }
  }
  function paintFields() {
    if (!current || dirty) return;
    mode.value = current.view.mode; from.value = current.view.viewport.from.slice(0, 19); to.value = current.view.viewport.to.slice(0, 19);
    setOptions(provider, current.view.sources.providerIds, window?.items.map(item => item.event.providerId) ?? [], 'All sources');
    setOptions(eventType, current.view.sources.eventTypes, window?.items.map(item => item.event.type) ?? [], 'All event types');
    setOptions(classification, current.view.sources.classifications, ['observed', 'reported', 'inferred', 'simulated'], 'All evidence classes');
    baseVersion = current.resource.version; baseView = structuredClone(current.view);
  }
  function setDisabled() {
    const editable = canEdit(); for (const control of [mode, from, to, provider, eventType, classification, apply, earlier, later, closer, wider]) control.disabled = !editable;
    back.disabled = !editable || !previousViews.length; refreshButton.disabled = busy; more.disabled = busy || !window?.next;
    more.hidden = !window?.next; retry.hidden = !request; retry.disabled = busy || current?.canEdit !== true;
    review.hidden = !needsReview; section.setAttribute('aria-busy', String(busy));
    useSaved.disabled = keepMine.disabled = busy || !current || !!request || needsReview && baseVersion === current.resource.version;
    for (const row of rows.values()) row.core.disabled = row.dot.disabled = busy;
  }
  function inspectSelection() {
    selection.replaceChildren(); const item = window?.items.find(item => sameSelection(selected, { eventId: item.event.eventId, cursor: item.event.cursor }));
    if (!item) { selection.append(node('p', selected ? 'The selected event is not loaded or is unavailable in this window.' : 'Select an event to inspect its source.')); return; }
    const event = item.event, values = node('dl'); selection.append(node('h4', event.type.replaceAll('.', ' ').replaceAll('_', ' ')));
    for (const [name, value] of [['Captured', formatTime(event.receivedAt)], ['Evidence', item.evidenceClass], ['Source', event.providerId], ['Source status', event.status ?? 'Not provided'], ['Event type', event.type], ['Event reference', event.eventId], ['Capture cursor', String(event.cursor)]]) values.append(node('dt', name), node('dd', value));
    selection.append(values, node('p', 'An event does not establish verified task completion. Capture order does not establish global causality.'));
    if (item.navigation && options.onOpenResource) {
      const open = action(item.navigation.state === 'archived' ? 'Inspect archived source' : 'Open source', () => options.onOpenResource!(item.navigation!.resourceId));
      open.title = options.resourceTitle?.(item.navigation.resourceId) ?? 'Open the canonical source resource'; selection.append(open);
    }
  }
  function paint() {
    if (disposed) return;
    title.textContent = current?.resource.title ?? (unavailable ? 'Timeline unavailable' : 'Loading timeline…');
    range.textContent = current ? `${formatTime(current.view.viewport.from)} — ${formatTime(current.view.viewport.to)} · capture time (${current.view.viewport.displayTimeZone})` : '';
    const live = new Set(window?.items.map(keyOf) ?? []);
    for (const [id, row] of rows) if (!live.has(id)) { row.row.remove(); row.dot.remove(); motion.remove(row.key); motion.remove(row.key + ':dot'); owned.delete(row.key); owned.delete(row.key + ':dot'); rows.delete(id); }
    for (const item of window?.items ?? []) {
      const id = keyOf(item), selectedNow = sameSelection(selected, { eventId: item.event.eventId, cursor: item.event.cursor }); let row = rows.get(id);
      if (!row) {
        const element = node('li'), core = action('', () => selectEvent(id)), dot = action('', () => selectEvent(id)), key = prefix + ':event:' + id;
        element.dataset.eventId = item.event.eventId; element.dataset.eventCursor = String(item.event.cursor); dot.className = 'aw-timeline-dot'; dot.setAttribute('aria-label', item.event.type + ', ' + formatTime(item.event.receivedAt));
        element.append(core); items.append(element); track.append(dot); addMotion(key, pose({ opacity: 0 })); addMotion(key + ':dot', pose({ opacity: 0 })); row = { item, row: element, core, dot, key, height: 72 }; rows.set(id, row);
      }
      row.item = item; row.core.replaceChildren(node('time', formatTime(item.event.receivedAt)), node('strong', item.event.type.replaceAll('.', ' ').replaceAll('_', ' ')), node('small', item.evidenceClass + ' · ' + item.event.providerId));
      row.core.setAttribute('aria-pressed', String(selectedNow)); row.dot.setAttribute('aria-pressed', String(selectedNow)); row.row.dataset.evidenceClass = item.evidenceClass;
    }
    gaps.replaceChildren(...[...new Set(window?.gaps.map(value => value.reason) ?? [])].map(reason => node('li', gapLabels[reason])));
    coverage.textContent = !window ? 'No retained window loaded.' : window.source.state === 'unavailable' ? 'Retained history is unavailable.'
      : `${window.items.length} events shown · ${window.coverage.matchingItems === 'bounded' ? 'bounded retained page' : 'retained page scanned'}. Only currently authorized retained evidence is shown.`;
    if (window?.hasNewEvents) coverage.textContent += ' New captures are available; refresh to open a new window.';
    if (current?.selectionUnavailable || window?.selectionUnavailable) coverage.textContent += ' The saved selection is unavailable.';
    if (current?.canEdit !== true) coverage.textContent += ' This view is read-only in this surface.';
    inspectSelection(); setDisabled(); reflow();
  }
  function selectEvent(key: string) {
    const item = rows.get(key)?.item; if (!item || !active || disposed || busy) return;
    markDirty(); selected = { eventId: item.event.eventId, cursor: item.event.cursor }; paint();
  }
  function reflow() {
    if (disposed || !active) return; let y = 0; const width = track.clientWidth || 640, view = current?.view, start = view ? Date.parse(view.viewport.from) : 0, span = view ? Date.parse(view.viewport.to) - start : 1;
    const providers = [...new Set(window?.items.map(item => item.event.providerId) ?? [])];
    legend.textContent = providers.length ? 'Capture positions · ' + providers.slice(0, 4).join(' · ') + (providers.length > 4 ? ' · Other sources' : '') : 'Capture positions';
    track.style.height = 16 + Math.max(1, Math.min(5, providers.length)) * 20 + 'px';
    for (const row of rows.values()) { row.height = Math.max(64, row.core.scrollHeight || 72); const chosen = sameSelection(selected, { eventId: row.item.event.eventId, cursor: row.item.event.cursor });
      target(row.key, pose({ y, h: row.height, opacity: 1 }), 'timeline-event-layout'); y += row.height + 6;
      target(row.key + ':dot', pose({ x: Math.max(0, Math.min(width - 14, (Date.parse(row.item.event.receivedAt) - start) / span * (width - 14))), y: 8 + Math.min(4, providers.indexOf(row.item.event.providerId)) * 20, lift: chosen ? 1 : 0 }), 'timeline-capture-position'); }
    target(prefix + ':list', pose({ h: y }), 'timeline-list-layout'); target(prefix + ':filters', pose({ h: filtersOpen ? filterPanel.scrollHeight || 240 : 0, opacity: filtersOpen ? 1 : 0 }), 'timeline-filter-disclosure');
  }
  async function load(append: boolean): Promise<void> {
    if (disposed || !active || append && (!current || !window?.next)) return;
    const token = ++sequence, prior = window; busy = true; setDisabled();
    try {
      const document = await port.read(resourceId);
      if (disposed || !active || token !== sequence) return;
      if (document.resource.id !== resourceId) throw new Error('Timeline identity mismatch');
      const next = await port.query({ resourceId, expectedVersion: document.resource.version, limit: 50, ...(append ? { page: prior!.next! } : {}) });
      if (disposed || !active || token !== sequence) return;
      if (next.resourceId !== resourceId || next.resourceVersion !== document.resource.version || next.viewDigest !== document.viewDigest) throw new Error('Timeline window mismatch');
      if (append && (next.viewDigest !== prior!.viewDigest || next.source.throughCursor !== prior!.source.throughCursor)) throw new Error('Timeline continuation mismatch');
      // Each page replaces the previous authorized projection. Retaining old
      // pages here would retain headers that policy may revoke between queries.
      current = document; unavailable = false; window = next;
      if (!dirty) selected = document.view.selection; else if (baseVersion !== document.resource.version) needsReview = true;
      needsRefresh = false; paintFields(); restoreFields(); paint(); options.onProjection?.(document, window);
      status.textContent = request ? 'An earlier save is unconfirmed. Retry save checks the same attempt.' : needsReview ? 'View settings changed elsewhere. Your local settings are retained.' : '';
    } catch {
      if (disposed || !active || token !== sequence) return;
      current = null; window = null; unavailable = true; redactFields(); paint(); options.onProjection?.(null, null); status.textContent = 'Timeline history could not be read or is no longer accessible. Your local view settings are retained.';
    } finally { if (!disposed && active && token === sequence) { busy = false; paint(); target(prefix, pose(), 'timeline-read'); } }
  }
  function save(view: TimelineView, remember = true) {
    if (!canEdit() || !current) return Promise.resolve();
    request = { input: { commandId: 'timeline-view:' + crypto.randomUUID(), resourceId, expectedVersion: dirty ? baseVersion : current.resource.version, view: structuredClone(view) }, previous: structuredClone(current.view), remember };
    return send();
  }
  async function send() {
    if (!request || disposed || !active || busy || current?.canEdit !== true) return;
    const attempt = request; busy = true; setDisabled();
    const saving = (async () => {
      let acknowledged = false;
      try {
        await port.save(structuredClone(attempt.input)); acknowledged = true; request = null;
        if (attempt.remember) { previousViews.push(attempt.previous); if (previousViews.length > 12) previousViews.shift(); } else previousViews.pop();
        dirty = needsReview = false; baseView = null; retainedFields = null; selected = attempt.input.view.selection;
        if (!disposed && active) { await load(false); if (!current) { needsRefresh = true; status.textContent = 'View saved. Refresh to read its updated history.'; } }
      } catch (error) {
        const code = (error as { code?: string })?.code, rejected = typeof code === 'string' && code.startsWith('timeline_');
        if (rejected) request = null;
        if (!disposed && active) {
          if (code === 'timeline_read_only' && current) current = { ...current, canEdit: false };
          if (['timeline_unavailable', 'timeline_scope_unavailable', 'timeline_identity_unavailable'].includes(code ?? '')) {
            current = null; window = null; unavailable = true; redactFields(); paint(); options.onProjection?.(null, null);
          }
          if (code === 'timeline_version_conflict') needsReview = true;
          status.textContent = acknowledged ? 'View saved. Refresh to read its updated history.' : rejected ? 'The view could not be saved. Refresh to review current access or competing changes; your local settings are retained.' : 'The save could not be confirmed. Retry save checks the same attempt.';
        }
      } finally { busy = false; if (!disposed) setDisabled(); }
    })(); operation = saving; await saving; if (operation === saving) operation = null;
  }
  section.dataset.resourceId = resourceId; section.dataset.noCardDrag = 'true'; section.dataset.presentation = options.presentation ?? 'focused'; section.setAttribute('aria-label', 'Timeline');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); track.setAttribute('aria-label', 'Captured event positions');
  for (const value of ['activity', 'execution']) { const option = node('option', value === 'activity' ? 'Activity' : 'Execution'); option.value = value; mode.append(option); }
  from.type = to.type = 'datetime-local'; from.step = to.step = '1';
  for (const control of [mode, from, to, provider, eventType, classification]) control.onchange = markDirty;
  filterPanel.append(label('Timeline mode', mode), label('From (UTC)', from), label('To (UTC)', to), label('Source', provider), label('Event type', eventType), label('Evidence class', classification), apply);
  filterPanel.onsubmit = event => { event.preventDefault(); if (canEdit()) { try { void save(collect()); } catch { status.textContent = 'Enter a valid capture-time interval.'; } } };
  filterPanel.hidden = true; filterPanel.inert = true; filterButton.setAttribute('aria-expanded', 'false');
  toolbar.append(earlier, later, closer, wider, back, filterButton, refreshButton, retry);
  section.append(title, range, toolbar, filterPanel, review, legend, track, items, selection, gaps, coverage, more, status); root.append(section);
  section.inert = !active; section.hidden = !active; section.style.opacity = '0'; items.style.height = '0px'; paint(); if (active) void load(false);
  return {
    refresh: () => load(false),
    setActive(value) { if (disposed || active === value) return; active = value; section.inert = !value; if (value) { section.hidden = false; void load(false); } else { sequence++; busy = false; } target(prefix, pose({ opacity: value ? 1 : 0, y: value ? 0 : 6 }), 'timeline-visibility'); setDisabled(); },
    setPresentation(value) { if (!disposed) { section.dataset.presentation = value; reflow(); } },
    reflow,
    frame() { if (disposed) return; const value = motion.pose(prefix), filters = motion.pose(prefix + ':filters'); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; if (!active && value.opacity < .001) section.hidden = true;
      items.style.height = Math.max(0, motion.pose(prefix + ':list').h) + 'px'; filterPanel.style.height = Math.max(0, filters.h) + 'px'; filterPanel.style.opacity = String(filters.opacity); if (!filtersOpen && filters.h < .5) filterPanel.hidden = true;
      for (const row of rows.values()) { const position = motion.pose(row.key), dot = motion.pose(row.key + ':dot'); row.row.style.transform = `translateY(${position.y}px)`; row.row.style.height = Math.max(0, position.h) + 'px'; row.row.style.opacity = String(position.opacity); row.dot.style.transform = `translate(${dot.x}px,${dot.y}px) scale(${1 + dot.lift * .2})`; row.dot.style.opacity = String(dot.opacity); }
    },
    async flush() { if (operation) await operation; if (request || needsRefresh) throw new Error('Timeline view save needs confirmation before leaving.'); },
    dispose() { if (disposed) return; disposed = true; sequence++; section.inert = true; section.remove(); for (const key of owned) motion.remove(key); owned.clear(); rows.clear(); },
  };
}
