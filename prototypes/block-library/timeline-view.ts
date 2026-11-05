import { temporalProjection, temporalTicks, temporalZoom, recordedReviewTime, type TemporalOrientation } from './temporal-projection.ts';
import type { TimelineDocument, TimelineView, TimelineSelection, SaveTimeline } from '../timeline-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';
import { timelineItemTime, timelineItemTitle, type TimelineExternalOpen, type TimelinePresentationGapReason, type TimelinePresentationItem, type TimelinePresentationPort, type TimelinePresentationWindow } from './timeline-presentation.ts';

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
const gapLabels: Record<TimelinePresentationGapReason, string> = {
  'source-unavailable': 'The retained event source is unavailable.',
  'before-retained-cursor': 'Earlier activity is outside the retained source range.',
  'cursor-discontinuity': 'The capture sequence has a gap of unknown cause.',
  'unsupported-event-schema': 'Some retained events use an unsupported format.',
  'invalid-event': 'Some retained event headers could not be read.',
  'access-filtered': 'Current access rules exclude some source evidence.',
  'scan-limit': 'This query reached its scan limit; more retained evidence may exist.',
  'selection-unavailable': 'The saved event selection is unavailable.',
  'reported-time-unavailable': 'Some authorized events have no usable reported time.',
};
const sameSelection = (a: TimelineSelection | null, b: TimelineSelection | null) => a?.eventId === b?.eventId && a?.cursor === b?.cursor;
const keyOf = (item: TimelinePresentationItem) => item.event.cursor + ':' + item.event.eventId;

/** Retained-header viewer. Root owns time/event storage, current authority,
 * canonical mutations, source navigation and the existing shared frame. */
export interface TimelineExperienceOptions {
  motion: ExperienceMotionPort; viewId: string; active?: boolean; presentation?: 'workspace' | 'focused'; showTitle?: boolean;
  onOpenResource?(resourceId: string): void | Promise<void>;
  onOpenExternalSource?(target: TimelineExternalOpen): void | Promise<void>;
  resourceTitle?(resourceId: string): string | undefined;
  onProjection?(document: TimelineDocument | null, window: TimelinePresentationWindow | null): void;
}
export function mountTimelineExperience(root: HTMLElement, resourceId: string, port: TimelinePresentationPort, options: TimelineExperienceOptions): TimelineExperience {
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
  const scale = node('div', '', 'aw-timeline-scale'), laneLabels = node('div', '', 'aw-timeline-lanes');
  const presentationTools = node('div', '', 'aw-timeline-tools'), orientation = node('select'), detail = node('select');
  const reviewTools = node('div', '', 'aw-timeline-review-time'), scrub = node('input'), speed = node('select'), reviewTime = node('output'), playhead = node('div', '', 'aw-timeline-playhead');
  let display: TemporalOrientation = 'horizontal', density = options.presentation === 'workspace' ? 'compact' : 'expanded', forensic = false, densityChosen = false;
  let playing = false, reviewPosition: number | null = null, reviewStarted = 0, reviewOrigin = 0;
  let orderedKeys: string[] = [];
  const sourceCoverage = node('p', '', 'aw-timeline-source-coverage');
  const status = node('p', '', 'aw-timeline-status'), review = node('div', '', 'aw-timeline-review');
  let current: TimelineDocument | null = null, window: TimelinePresentationWindow | null = null, active = options.active ?? true, disposed = false, busy = false, sequence = 0, unavailable = false;
  let selected: TimelineSelection | null = null, filtersOpen = false, dirty = false, baseVersion = 0, baseView: TimelineView | null = null, needsReview = false, needsRefresh = false;
  let request: { input: SaveTimeline; previous: TimelineView; remember: boolean } | null = null, operation: Promise<void> | null = null;
  const previousViews: TimelineView[] = [], rows = new Map<string, { item: TimelinePresentationItem; row: HTMLLIElement; core: HTMLButtonElement; dot: HTMLButtonElement; key: string; height: number }>();
  const axis = () => window?.timeAxis ?? 'receivedAt';
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
      catch { status.textContent = 'Enter a valid time interval before applying this view.'; }
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
    view.viewport = { ...view.viewport, from: new Date(start + shift).toISOString(), to: new Date(end + shift).toISOString() }; return save(view);
  };
  const zoom = (factor: number) => {
    if (!canEdit()) return; const view = collect(), start = Date.parse(view.viewport.from), end = Date.parse(view.viewport.to), selectedItem = window?.items.find(item => sameSelection(selected, { eventId: item.event.eventId, cursor: item.event.cursor })), selectedTime = selectedItem && timelineItemTime(selectedItem, axis()), bounds = temporalZoom(start, end, factor, selectedTime ? Date.parse(selectedTime) : undefined);
    view.viewport = { ...view.viewport, from: new Date(bounds.from).toISOString(), to: new Date(bounds.to).toISOString() }; return save(view);
  };
  const earlier = action('Earlier', () => pan(-1)), later = action('Later', () => pan(1)), closer = action('Zoom in', () => zoom(.5)), wider = action('Zoom out', () => zoom(2));
  const forensicButton = action('Forensic event list', () => { forensic = !forensic; forensicButton.setAttribute('aria-pressed', String(forensic)); items.hidden = !forensic; reflow(); });
  const play = action('Play recorded time', () => {
    if (!window?.items.length || busy) return;
    playing = !playing; reviewStarted = performance.now();
    const bounds = reviewBounds(); reviewOrigin = reviewPosition === null || reviewPosition >= bounds.end ? bounds.start : reviewPosition; reviewPosition = reviewOrigin;
    play.textContent = playing ? 'Pause recorded time' : 'Play recorded time'; motion.wake();
  });
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
    play.disabled = busy || !window?.items.some(item => timelineItemTime(item, axis())); scrub.disabled = play.disabled; speed.disabled = busy;
    for (const row of rows.values()) row.core.disabled = row.dot.disabled = busy;
  }
  function inspectSelection() {
    selection.replaceChildren(); const item = window?.items.find(item => sameSelection(selected, { eventId: item.event.eventId, cursor: item.event.cursor }));
    if (!item) { selection.append(node('p', selected ? 'The selected event is not loaded or is unavailable in this window.' : 'Select an event to inspect its source.')); return; }
    const event = item.event, values = node('dl');
    const external = item.externalEvidence, reportedAt = timelineItemTime(item, 'reportedAt');
    selection.append(node('h4', timelineItemTitle(item)));
    if (external) {
      const timeSource = external.timeSource === 'github-committer' ? 'GitHub committer time' : external.timeSource === 'github-author' ? 'GitHub author time' : 'Source unspecified';
      values.append(node('dt', 'Reported time'), node('dd', reportedAt ? `${formatTime(reportedAt)} Â· ${timeSource}` : 'Unavailable'));
      if (reportedAt) values.append(node('dt', 'Original timestamp'), node('dd', reportedAt));
    }
    for (const [name, value] of [['Captured', formatTime(event.receivedAt)], ['Evidence', item.evidenceClass], ['Source', external?.source.label ?? event.providerId], ['Source status', event.status ?? 'Not provided'], ['Event type', event.type], ['Event reference', event.eventId], ['Capture cursor', String(event.cursor)]]) values.append(node('dt', name), node('dd', value));
    selection.append(values, node('p', 'An event does not establish verified task completion. Capture order does not establish global causality.'));
    if (item.navigation && options.onOpenResource) {
      const open = action(item.navigation.state === 'archived' ? 'Inspect archived source' : 'Open source', () => options.onOpenResource!(item.navigation!.resourceId));
      open.title = options.resourceTitle?.(item.navigation.resourceId) ?? 'Open the canonical source resource'; selection.append(open);
    }
    if (external?.source.permalink && options.onOpenExternalSource) {
      const loadedWindow = window;
      const target = { timelineId: resourceId, eventId: event.eventId, cursor: event.cursor };
      const open = action('Open commit on GitHub', async () => {
        if (!busy && window === loadedWindow && sameSelection(selected, target)) await options.onOpenExternalSource!(target);
      });
      selection.append(open);
    }
  }
  function paint() {
    if (disposed) return;
    title.textContent = current?.resource.title ?? (unavailable ? 'Timeline unavailable' : 'Loading timelineâ€¦');
    title.hidden = options.showTitle === false;
    const basis = axis() === 'reportedAt' ? 'reported time' : 'capture time';
    range.textContent = current ? `${formatTime(current.view.viewport.from)} â€” ${formatTime(current.view.viewport.to)} Â· ${basis} (${current.view.viewport.displayTimeZone})` : '';
    const live = new Set(window?.items.map(keyOf) ?? []);
    for (const [id, row] of rows) if (!live.has(id)) { row.row.remove(); row.dot.remove(); motion.remove(row.key); motion.remove(row.key + ':dot'); owned.delete(row.key); owned.delete(row.key + ':dot'); rows.delete(id); }
    for (const item of window?.items ?? []) {
      const id = keyOf(item), selectedNow = sameSelection(selected, { eventId: item.event.eventId, cursor: item.event.cursor }); let row = rows.get(id);
      if (!row) {
        const element = node('li'), core = action('', () => selectEvent(id)), dot = action('', () => selectEvent(id)), key = prefix + ':event:' + id;
        element.dataset.eventId = item.event.eventId; element.dataset.eventCursor = String(item.event.cursor); dot.className = 'aw-timeline-dot'; dot.dataset.eventId = item.event.eventId; dot.dataset.eventCursor = String(item.event.cursor);
        element.append(core); items.append(element); track.append(dot);
        dot.onkeydown = event => navigateEvent(event, id); addMotion(key, pose({ opacity: 0 })); addMotion(key + ':dot', pose({ opacity: 0 })); row = { item, row: element, core, dot, key, height: 72 }; rows.set(id, row);
      }
      const time = timelineItemTime(item, axis());
      const when = time ? node('time', formatTime(time)) : node('span', 'Reported time unavailable', 'aw-timeline-event-time');
      if (time) when.setAttribute('datetime', time);
      row.item = item;
      row.dot.hidden = !time;
      row.dot.setAttribute('aria-label', timelineItemTitle(item) + (time ? ', ' + formatTime(time) : ''));
      row.core.replaceChildren(when, node('strong', timelineItemTitle(item)), node('small', item.evidenceClass + ' Â· ' + (item.externalEvidence?.source.label ?? item.event.providerId)));
      row.core.setAttribute('aria-pressed', String(selectedNow)); row.dot.setAttribute('aria-pressed', String(selectedNow)); row.row.dataset.evidenceClass = item.evidenceClass; row.dot.dataset.evidenceClass = item.evidenceClass;
      row.dot.title = row.dot.getAttribute('aria-label') ?? '';
    }
    gaps.replaceChildren(...[...new Set(window?.gaps.map(value => value.reason) ?? [])].map(reason => node('li', gapLabels[reason])));
    coverage.textContent = !window ? 'No retained window loaded.' : window.source.state === 'unavailable' ? 'Retained history is unavailable.'
      : `${window.items.length} events shown Â· ${window.coverage.matchingItems === 'bounded' ? 'bounded retained page' : 'retained page scanned'}. Only currently authorized retained evidence is shown.`;
    if (window?.hasNewEvents) coverage.textContent += ' New captures are available; refresh to open a new window.';
    if (current?.selectionUnavailable || window?.selectionUnavailable) coverage.textContent += ' The saved selection is unavailable.';
    if (current?.canEdit !== true) coverage.textContent += ' This view is read-only in this surface.';
    const imported = window?.sourceCoverage;
    sourceCoverage.hidden = !imported;
    sourceCoverage.textContent = imported ? [
      imported.sourceLabel + ' Â· ' + imported.status + ' source coverage',
      `${formatTime(imported.requestedFrom)} â€” ${formatTime(imported.requestedTo)}`,
      imported.fetchedAt ? 'Fetched ' + formatTime(imported.fetchedAt) : '',
      imported.omissionReason ?? '',
    ].filter(Boolean).join(' Â· ') : '';
    inspectSelection(); setDisabled(); reflow();
  }
  function selectEvent(key: string) {
    const item = rows.get(key)?.item; if (!item || !active || disposed || busy) return;
    markDirty(); selected = { eventId: item.event.eventId, cursor: item.event.cursor }; paint();
  }
  function navigateEvent(event: KeyboardEvent, key: string) {
    const index = orderedKeys.indexOf(key); let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = orderedKeys.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(orderedKeys.length - 1, index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else return;
    event.preventDefault(); const id = orderedKeys[next]; if (!id) return; selectEvent(id); rows.get(id)?.dot.focus();
  }
  function reviewBounds() {
    const times = (window?.items ?? []).flatMap(item => { const time = timelineItemTime(item, axis()); return time ? [Date.parse(time)] : []; }).filter(Number.isFinite);
    return { start: times.length ? Math.min(...times) : 0, end: times.length ? Math.max(...times) : 0 };
  }
  function stopReview() { playing = false; reviewPosition = null; play.textContent = 'Play recorded time'; playhead.hidden = true; reviewTime.textContent = ''; for (const row of rows.values()) delete row.dot.dataset.reviewState; }
  function reflow() {
    if (disposed || !active) return;
    let y = 0; const width = Math.max(80, (track.clientWidth || 640) - 28), view = current?.view;
    const start = view ? Date.parse(view.viewport.from) : 0, end = view ? Date.parse(view.viewport.to) : 1;
    const vertical = display === 'vertical', extent = vertical ? (density === 'compact' ? 220 : 420) : width;
    const selectedKey = selected ? selected.cursor + ':' + selected.eventId : undefined;
    const projection = temporalProjection(window?.items ?? [], axis(), start, end, extent, display === 'multilane', selectedKey);
    orderedKeys = projection.timed.map(value => value.key);
    section.dataset.orientation = display; section.dataset.density = density; selection.hidden = density === 'compact' && !selected;
    track.style.setProperty?.('--aw-timeline-spine', Math.min(width - 10, 160) + 7 + 'px');
    const positions = axis() === 'reportedAt' ? 'Reported event positions' : 'Capture positions';
    legend.textContent = positions + ' · ' + (view?.viewport.displayTimeZone ?? 'UTC') + ' · Arrow keys move through time; Home/End reach endpoints.';
    const laneSize = density === 'compact' ? 56 : 88;
    track.style.height = (vertical ? extent + 56 : 64 + Math.max(1, projection.lanes.length) * laneSize) + 'px';
    scale.replaceChildren(); laneLabels.replaceChildren();
    for (const tick of temporalTicks(start, end, extent, view?.viewport.displayTimeZone ?? 'UTC')) {
      const label = node('span', tick.label, 'aw-timeline-tick');
      label.style[vertical ? 'top' : 'left'] = tick.position + 14 + 'px'; scale.append(label);
    }
    for (const [index, lane] of projection.lanes.entries()) {
      const label = node('span', lane, 'aw-timeline-lane-label'); label.style.top = 40 + index * laneSize + 'px'; laneLabels.append(label);
    }
    for (const row of rows.values()) {
      row.height = Math.max(64, row.core.scrollHeight || 72);
      target(row.key, pose({ y, h: row.height, opacity: 1 }), 'timeline-event-layout'); y += row.height + 6;
      row.dot.hidden = true; row.dot.tabIndex = -1;
      const entry = projection.timed.find(value => value.key === keyOf(row.item));
      if (entry) target(row.key + ':dot', pose({ x: vertical ? Math.min(width - 10, 160) : entry.position + 7, y: vertical ? entry.position + 20 : 58 + entry.lane * laneSize }), 'timeline-cluster-position');
    }
    for (const cluster of projection.clusters) {
      const row = rows.get(cluster.representative.key)!;
      const chosen = cluster.members.some(value => value.key === selectedKey);
      row.dot.hidden = false; row.dot.tabIndex = chosen || !projection.timed.some(value => value.key === selectedKey) && cluster === projection.clusters[0] ? 0 : -1;
      row.dot.dataset.clusterCount = String(cluster.members.length);
      row.dot.textContent = cluster.members.length > 1 ? String(cluster.members.length) : '';
      row.dot.setAttribute('aria-label', timelineItemTitle(row.item) + ', ' + formatTime(new Date(cluster.representative.time).toISOString()) + (cluster.members.length > 1 ? `, cluster of ${cluster.members.length} events. Arrow keys inspect every event.` : ''));
      row.dot.title = row.dot.getAttribute('aria-label') ?? '';
      row.dot.dataset.caption = timelineItemTitle(row.item);
      target(row.key + ':dot', pose({ x: vertical ? Math.min(width - 10, 160) : cluster.position + 7, y: vertical ? cluster.position + 20 : 58 + cluster.lane * laneSize, lift: chosen ? 1 : 0 }), 'timeline-event-position');
    }
    const bounds = reviewBounds(); scrub.min = String(bounds.start); scrub.max = String(bounds.end); scrub.step = '1'; scrub.value = String(reviewPosition ?? bounds.start);
    items.hidden = !forensic;
    target(prefix + ':list', pose({ h: y }), 'timeline-list-layout'); target(prefix + ':filters', pose({ h: filtersOpen ? filterPanel.scrollHeight || 240 : 0, opacity: filtersOpen ? 1 : 0 }), 'timeline-filter-disclosure');
  }
  async function load(append: boolean): Promise<void> {
    if (disposed || !active || append && (!current || !window?.next)) return;
    stopReview(); const token = ++sequence, prior = window; busy = true; setDisabled();
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
  for (const [value, text] of [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['multilane', 'Multiple source lanes']]) { const option = node('option', text); option.value = value; orientation.append(option); }
  for (const value of ['expanded', 'compact']) { const option = node('option', value); option.value = value; detail.append(option); }
  for (const value of ['1', '10', '60']) { const option = node('option', value + '× recorded time'); option.value = value; speed.append(option); }
  speed.value = '1'; orientation.value = 'horizontal'; detail.value = density;
  orientation.onchange = () => { display = orientation.value as TemporalOrientation; reflow(); };
  detail.onchange = () => { densityChosen = true; density = detail.value; reflow(); };
  speed.onchange = () => { reviewOrigin = reviewPosition ?? reviewBounds().start; reviewStarted = performance.now(); };
  scrub.type = 'range'; scrub.setAttribute('aria-label', 'Recorded time position');
  scrub.oninput = () => { playing = false; play.textContent = 'Play recorded time'; reviewPosition = Number(scrub.value); motion.wake(); };
  reviewTime.setAttribute('aria-live', 'off');
  playhead.setAttribute('aria-hidden', 'true'); playhead.hidden = true;
  reviewTools.append(node('span', 'Recorded-time review · headers only, no state reconstruction'), play, label('Review speed', speed), scrub, reviewTime);
  presentationTools.append(label('Orientation', orientation), label('Detail', detail), forensicButton);
  track.append(scale, laneLabels, playhead);
  toolbar.append(earlier, later, closer, wider, back, filterButton, refreshButton, retry);
  section.append(title, range, toolbar, filterPanel, review, presentationTools, legend, track, reviewTools, items, selection, gaps, sourceCoverage, coverage, more, status); root.append(section);
  section.inert = !active; section.hidden = !active; section.style.opacity = '0'; items.style.height = '0px'; paint(); if (active) void load(false);
  return {
    refresh: () => load(false),
    setActive(value) { if (disposed || active === value) return; active = value; section.inert = !value; if (value) { section.hidden = false; void load(false); } else { stopReview(); sequence++; busy = false; } target(prefix, pose({ opacity: value ? 1 : 0, y: value ? 0 : 6 }), 'timeline-visibility'); setDisabled(); },
    setPresentation(value) { if (!disposed) { section.dataset.presentation = value; if (!densityChosen) { density = value === 'workspace' ? 'compact' : 'expanded'; detail.value = density; } reflow(); } },
    reflow,
    frame() { if (disposed) return;
      if (active && window && reviewPosition !== null && current) {
        const bounds = reviewBounds();
        if (playing) { reviewPosition = recordedReviewTime(reviewOrigin, performance.now() - reviewStarted, Number(speed.value) || 1, bounds.end); if (reviewPosition >= bounds.end) { playing = false; play.textContent = 'Play recorded time'; } else motion.wake(); }
        scrub.value = String(reviewPosition); reviewTime.textContent = formatTime(new Date(reviewPosition).toISOString());
        for (const row of rows.values()) { const time = timelineItemTime(row.item, axis()); row.dot.dataset.reviewState = time && Date.parse(time) <= reviewPosition ? 'reached' : 'upcoming'; }
        const start = Date.parse(current.view.viewport.from), end = Date.parse(current.view.viewport.to), fraction = (reviewPosition - start) / Math.max(1, end - start);
        playhead.hidden = fraction < 0 || fraction > 1;
        const extent = display === 'vertical' ? (density === 'compact' ? 220 : 420) : Math.max(80, (track.clientWidth || 640) - 28);
        playhead.style.transform = display === 'vertical' ? `translateY(${fraction * extent + 27}px)` : `translateX(${fraction * extent + 14}px)`;
      } const value = motion.pose(prefix), filters = motion.pose(prefix + ':filters'); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; if (!active && value.opacity < .001) section.hidden = true;
      items.style.height = Math.max(0, motion.pose(prefix + ':list').h) + 'px'; filterPanel.style.height = Math.max(0, filters.h) + 'px'; filterPanel.style.opacity = String(filters.opacity); if (!filtersOpen && filters.h < .5) filterPanel.hidden = true;
      for (const row of rows.values()) { const position = motion.pose(row.key), dot = motion.pose(row.key + ':dot'); row.row.style.transform = `translateY(${position.y}px)`; row.row.style.height = Math.max(0, position.h) + 'px'; row.row.style.opacity = String(position.opacity); row.dot.style.transform = `translate(${dot.x}px,${dot.y}px) scale(${1 + dot.lift * .2})`; row.dot.style.opacity = String(dot.opacity); }
    },
    async flush() { if (operation) await operation; if (request || needsRefresh) throw new Error('Timeline view save needs confirmation before leaving.'); },
    dispose() { if (disposed) return; disposed = true; sequence++; section.inert = true; section.remove(); for (const key of owned) motion.remove(key); owned.clear(); rows.clear(); },
  };
}
