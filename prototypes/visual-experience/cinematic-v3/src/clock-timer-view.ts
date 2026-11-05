import type { ClockTimerDocument, ClockTimerPort, TimerOperation, TimerView } from '../../../timer-product/contracts.ts';
import { CLOCK_TIMER_CONTRACT, TIMER_LIMITS } from '../../../timer-product/contracts.ts';
import type { BlockConfiguration, BlockInstanceSettings, BlockLibraryHostPort } from '../../../block-library/contracts.ts';
import { validateConfiguration } from '../../../block-library/registry.ts';
import type { TimelineExperience } from '../../../block-library/timeline-view.ts';

export type ClockTimerViewState = NonNullable<BlockConfiguration['clockTimer']>;
export interface ClockTimerExperience extends TimelineExperience {
  setConfiguration(configuration: BlockConfiguration): void;
}
export interface ClockTimerExperienceOptions {
  active?: boolean;
  presentation?: 'workspace' | 'focused';
  showTitle?: boolean;
  configuration?: BlockConfiguration;
  placement?: {
    placementId: string;
    host: Pick<BlockLibraryHostPort, 'getBlockSettings' | 'configureBlock'>;
    onSaved?(settings: BlockInstanceSettings): void;
  };
  onProjection?(document: ClockTimerDocument | null): void;
  /** Display interpolation only. Canonical elapsed time and completion remain native. */
  displayNow?(): number;
}

export function formatClockTimerDuration(milliseconds: number, tenths = false): string {
  const value = Math.max(0, milliseconds);
  const seconds = tenths ? Math.floor(value / 1000) : Math.ceil(value / 1000);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  const base = (hours ? String(hours) + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  return base + (tenths ? '.' + Math.floor(value % 1000 / 100) : '');
}

const handFormatters = new Map<string, Intl.DateTimeFormat>();
/** Geometry projects the host's sampled epoch in the named zone, including DST.
 * It never reads the renderer wall clock or owns canonical time. */
export function clockHandAngles(epochMs: number, timeZone: string) {
  let formatter = handFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB-u-nu-latn', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (handFormatters.size >= 32) handFormatters.delete(handFormatters.keys().next().value!);
    handFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(epochMs), value = (name: string) => Number(parts.find(part => part.type === name)?.value ?? 0);
  const second = value('second'), minute = value('minute') + second / 60, hour = value('hour') % 12 + minute / 60;
  return { hour: hour * 30, minute: minute * 6, second: second * 6 };
}

const stateLabel = { ready: 'Ready', running: 'Running', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
const modes = ['timer', 'stopwatch', 'clock'] as const;
const errorMessage = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  if (/timer_version_conflict|CONFLICT/u.test(value)) return 'This resource changed in another view. The latest state was loaded; review it before trying again.';
  if (/timer_read_only/u.test(value)) return 'This resource is read only. No change was applied.';
  if (/timer_unavailable|denied|forbidden|unauthorized/u.test(value)) return 'Clock and timers are unavailable with the current access.';
  if (/invalid_timer_time_zone/u.test(value)) return 'Enter a valid IANA time zone, such as Europe/London.';
  if (/timer_invalid_transition/u.test(value)) return 'The timer state changed. Review the latest state before trying again.';
  if (/capacity/u.test(value)) return 'This resource reached its supported limit. Remove an existing item before adding another.';
  if (/invalid_timer/u.test(value)) return 'Enter a name and a valid positive duration.';
  return 'The change could not be confirmed. Refresh to inspect the saved state.';
};

/** One presentation of a canonical resource. It never owns timer scheduling, completion, or data lifetime. */
export function mountClockTimerExperience(
  root: HTMLElement,
  resourceId: string,
  port: ClockTimerPort,
  options: ClockTimerExperienceOptions = {},
): ClockTimerExperience {
  const doc = root.ownerDocument, now = options.displayNow ?? (() => performance.now());
  const viewId = 'aw-clock-' + crypto.randomUUID();
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
    const element = doc.createElement(tag); element.textContent = text; element.className = className;
    if (['button', 'input', 'select'].includes(tag)) element.dataset.aerynthMotionControl = 'true';
    return element;
  };
  const dial = (className = '') => {
    const face = node('div', '', 'aw-clock-timer-dial ' + className); face.setAttribute('aria-hidden', 'true');
    const hour = node('span', '', 'aw-clock-timer-hand aw-clock-timer-hand--hour'), minute = node('span', '', 'aw-clock-timer-hand aw-clock-timer-hand--minute'),
      second = node('span', '', 'aw-clock-timer-hand aw-clock-timer-hand--second');
    face.append(node('span', '12', 'aw-clock-timer-dial-noon'), hour, minute, second, node('span', '', 'aw-clock-timer-dial-hub'));
    return { face, hour, minute, second };
  };
  const paintDial = (face: ReturnType<typeof dial>, epochMs: number, timeZone: string) => {
    const angles = clockHandAngles(epochMs, timeZone);
    for (const hand of ['hour', 'minute', 'second'] as const) face[hand].style.transform = `rotate(${angles[hand]}deg)`;
    face.face.dataset.clockZone = timeZone;
  };
  const section = node('section', '', 'aw-clock-timer');
  section.dataset.noCardDrag = 'true'; section.dataset.clockTimerResource = resourceId;
  section.setAttribute('aria-label', 'Clock and timers');
  const heading = node('h3', 'Clock & timers'), tabs = node('div', '', 'aw-clock-timer-tabs');
  heading.hidden = options.showTitle === false; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Clock and timer mode');
  const status = node('p', '', 'aw-clock-timer-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const panels = node('div', '', 'aw-clock-timer-panels');
  const timerPanel = node('section'), watchPanel = node('section'), clockPanel = node('section');
  const panelMap = { timer: timerPanel, stopwatch: watchPanel, clock: clockPanel };
  const tabMap = new Map<ClockTimerViewState['mode'], HTMLButtonElement>();
  const refreshButton = node('button', 'Refresh', 'aw-clock-timer-refresh'); refreshButton.type = 'button';
  const tools = node('div', '', 'aw-clock-timer-heading'); tools.append(tabs, refreshButton);
  section.append(heading, tools, status, panels); panels.append(timerPanel, watchPanel, clockPanel); root.append(section);

  let active = options.active ?? true, presentation = options.presentation ?? 'workspace', disposed = false;
  let current: ClockTimerDocument | null = null, sampleAt = now(), lastPaint = -Infinity, lastRead = -Infinity;
  let busy = false, pendingRead: Promise<void> | null = null, pendingMutation: Promise<void> | null = null;
  let settingsPending: Promise<void> | null = null, settings: BlockInstanceSettings | null = null;
  let config = validateConfiguration(options.configuration), view: ClockTimerViewState = { ...(config.clockTimer ?? { mode: 'timer' }) };
  let minVersion = 0, readGeneration = 0, renameTimerId: string | null = null, renameDirty = false;
  let deleteTimerId: string | null = null;
  const visible = () => active && !disposed && !doc.hidden;
  const canEdit = () => visible() && current?.canEdit === true && !busy;
  const writable = <T extends HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(element: T): T => { element.dataset.clockWrite = 'true'; return element; };
  const field = (text: string, input: HTMLInputElement | HTMLSelectElement) => {
    const label = node('label', text, 'aw-clock-timer-field'); input.setAttribute('aria-label', text); label.append(input); return label;
  };
  const numeric = (label: string, value: string, max: number) => {
    const input = writable(node('input')); input.type = 'number'; input.value = value; input.min = '0.001'; input.max = String(max); input.step = '0.001';
    return { input, label: field(label, input) };
  };
  const button = (label: string, action: string, work: () => void, edit = true) => {
    const element = node('button', label); element.type = 'button'; element.dataset.clockAction = action;
    if (edit) writable(element);
    element.onclick = () => { if (disposed || !active || (edit && !canEdit())) return; work(); }; return element;
  };
  const operation = (type: TimerOperation['type']) => {
    const timer = selected(); if (!timer) return;
    void mutate([{ type, timerId: timer.id } as TimerOperation]);
  };
  const inputMs = (input: HTMLInputElement, scale: number): number | null => {
    const value = Number(input.value) * scale, rounded = Math.round(value);
    if (!input.value.trim() || !Number.isFinite(value) || rounded < 1 || rounded > TIMER_LIMITS.maxDurationMs) {
      status.textContent = 'Enter a positive duration of at most 365 days.'; return null;
    }
    return rounded;
  };

  for (const mode of modes) {
    const tab = node('button', mode === 'timer' ? 'Timers' : mode === 'stopwatch' ? 'Stopwatch' : 'Clock'); tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.id = viewId + '-tab-' + mode; tab.setAttribute('aria-controls', viewId + '-panel-' + mode);
    const panel = panelMap[mode]; panel.id = viewId + '-panel-' + mode; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
    tab.dataset.clockMode = mode;
    tab.onclick = () => { if (visible() && !settingsPending) changeView({ ...view, mode }); };
    tab.onkeydown = event => {
      const index = modes.indexOf(view.mode);
      const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : -1;
      if (next < 0 || !visible() || settingsPending) return;
      event.preventDefault(); changeView({ ...view, mode: modes[next] }); tabMap.get(modes[next])!.focus();
    };
    tabs.append(tab); tabMap.set(mode, tab);
  }

  const timerSelect = node('select'); timerSelect.dataset.clockTimerSelect = 'true';
  timerSelect.onchange = () => { if (visible() && !settingsPending) changeView({ ...view, selectedTimerId: timerSelect.value }); };
  const selectorField = field('Selected timer', timerSelect);
  const empty = node('p', 'Add a named timer to begin.', 'aw-clock-timer-empty');
  const timerBody = node('div', '', 'aw-clock-timer-countdown'), ring = node('div', '', 'aw-clock-timer-ring'); ring.setAttribute('aria-hidden', 'true');
  const remaining = node('output', '', 'aw-clock-timer-value'); remaining.setAttribute('role', 'timer'); remaining.setAttribute('aria-live', 'off');
  remaining.dataset.clockRemaining = 'true'; remaining.setAttribute('aria-label', 'Timer remaining');
  const timerName = node('strong'), timerState = node('p'), durationText = node('small'), uncertainty = node('p', '', 'aw-clock-timer-uncertainty');
  timerName.dataset.clockTimerName = 'true'; timerState.dataset.clockTimerState = 'true';
  const face = node('div', '', 'aw-clock-timer-face'); face.append(remaining, timerName); timerBody.append(ring, face, timerState, durationText, uncertainty);
  const timerActions = node('div', '', 'aw-clock-timer-actions');
  const timerButtons = new Map<string, HTMLButtonElement>();
  for (const [type, label] of [['startTimer', 'Start'], ['pauseTimer', 'Pause'], ['resumeTimer', 'Resume'], ['resetTimer', 'Reset'], ['cancelTimer', 'Cancel']] as const) {
    const control = button(label, type, () => operation(type)); timerButtons.set(type, control); timerActions.append(control);
  }
  timerActions.append(button('Delete timer', 'deleteTimer', () => {
    const timer = selected(); if (!timer) return; deleteTimerId = timer.id; deleteReview.hidden = false;
    deleteMessage.textContent = `Delete “${timer.name}”? Its saved countdown will be removed.`;
  }));
  const deleteReview = node('div', '', 'aw-clock-timer-review'), deleteMessage = node('p'); deleteReview.hidden = true;
  deleteReview.append(deleteMessage, button('Delete this timer', 'confirmDeleteTimer', () => {
    if (!deleteTimerId || selected()?.id !== deleteTimerId) return;
    void mutate([{ type: 'deleteTimer', timerId: deleteTimerId }]);
  }), button('Keep timer', 'keepTimer', () => { deleteTimerId = null; deleteReview.hidden = true; }));
  const editDetails = node('details', '', 'aw-clock-timer-details'); editDetails.append(node('summary', 'Name & duration'));
  const renameForm = node('form'), rename = writable(node('input')); rename.type = 'text'; rename.maxLength = 256;
  rename.oninput = () => { renameDirty = true; };
  const renameButton = button('Save name', 'renameTimer', () => {
    const timer = selected(); if (!timer) return;
    void mutate([{ type: 'renameTimer', timerId: timer.id, name: rename.value }], () => { renameDirty = false; });
  });
  renameForm.append(field('Timer name', rename), renameButton);
  renameForm.onsubmit = event => { event.preventDefault(); renameButton.click(); };
  const adjust = numeric('Adjust by seconds', '60', TIMER_LIMITS.maxDurationMs / 1000), adjustment = node('div', '', 'aw-clock-timer-adjustment');
  adjustment.append(adjust.label);
  for (const [type, label] of [['extendTimer', 'Extend'], ['shortenTimer', 'Shorten']] as const) adjustment.append(button(label, type, () => {
    const timer = selected(), amountMs = inputMs(adjust.input, 1000); if (timer && amountMs !== null) void mutate([{ type, timerId: timer.id, amountMs }]);
  }));
  editDetails.append(renameForm, adjustment);
  const addDetails = node('details', '', 'aw-clock-timer-details'); addDetails.append(node('summary', 'Add a timer'));
  const createForm = node('form'), newName = writable(node('input')); newName.type = 'text'; newName.maxLength = 256; newName.value = 'New timer';
  const newDuration = numeric('Duration in minutes', '5', TIMER_LIMITS.maxDurationMs / 60000);
  const createTimer = (start: boolean) => {
    const durationMs = inputMs(newDuration.input, 60000); if (durationMs === null) return;
    void mutate([{ type: 'createTimer', key: 'timer', name: newName.value, durationMs, start }], (_document, result) => {
      if (result.createdIds.timer) changeView({ ...view, selectedTimerId: result.createdIds.timer });
    });
  };
  createForm.append(field('New timer name', newName), newDuration.label,
    button('Add timer', 'createTimer', () => createTimer(false)), button('Start new timer', 'createAndStartTimer', () => createTimer(true)));
  const presets = node('div', '', 'aw-clock-timer-presets'); presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Named countdown presets');
  for (const [label, name, minutes] of [['Focus · 25 min', 'Focus', 25], ['Short break · 5 min', 'Short break', 5]] as const) {
    presets.append(button(label, minutes === 25 ? 'presetFocus' : 'presetBreak', () => {
      newName.value = name; newDuration.input.value = String(minutes);
      status.textContent = `${name} preset selected. This is a normal named countdown; choose Add timer or Start new timer to save it.`;
    }));
  }
  createForm.prepend(presets, node('small', 'Presets fill the form only. Focus uses a normal countdown, without session tracking.', 'aw-clock-timer-preset-note'));
  createForm.onsubmit = event => { event.preventDefault(); if (canEdit()) createTimer(false); };
  addDetails.append(createForm);
  const expiryList = node('ul', '', 'aw-clock-timer-expiries'); expiryList.setAttribute('aria-label', 'Unacknowledged timer completions');
  const expiryRows = new Map<string, HTMLLIElement>();
  timerPanel.append(selectorField, empty, timerBody, timerActions, deleteReview, editDetails, addDetails, expiryList);

  const watchValue = node('output', '00:00.0', 'aw-clock-timer-stopwatch-value'); watchValue.dataset.clockStopwatch = 'true';
  watchValue.setAttribute('role', 'timer'); watchValue.setAttribute('aria-live', 'off'); watchValue.setAttribute('aria-label', 'Stopwatch elapsed');
  const watchState = node('p'), watchUncertainty = node('p', '', 'aw-clock-timer-uncertainty');
  const watchActions = node('div', '', 'aw-clock-timer-actions'), watchButtons = new Map<string, HTMLButtonElement>();
  for (const [type, label] of [['stopwatchStart', 'Start stopwatch'], ['stopwatchPause', 'Pause stopwatch'], ['stopwatchResume', 'Resume stopwatch'],
    ['stopwatchLap', 'Record lap'], ['stopwatchReset', 'Reset stopwatch']] as const) {
    const control = button(label, type, () => { void mutate([{ type }]); }); watchActions.append(control); watchButtons.set(type, control);
  }
  const laps = node('ol', '', 'aw-clock-timer-laps'); laps.setAttribute('aria-label', 'Stopwatch laps');
  const watchOrbit = node('div', '', 'aw-clock-timer-watch-orbit'); watchOrbit.setAttribute('aria-hidden', 'true'); watchOrbit.dataset.clockWatchOrbit = 'true';
  const watchNeedle = node('span', '', 'aw-clock-timer-watch-needle'); watchOrbit.append(watchNeedle);
  const watchFace = node('div', '', 'aw-clock-timer-watch-face'); watchFace.append(watchOrbit, watchValue);
  watchPanel.append(watchFace, node('small', 'Minute cycle · one orbit per 60 elapsed seconds', 'aw-clock-timer-cycle-label'), watchState, watchUncertainty, watchActions, laps);

  const localTime = node('time', '', 'aw-clock-timer-local-time'), localDate = node('p'), localZone = node('small');
  const localDial = dial(); localDial.face.dataset.clockLocalDial = 'true';
  localTime.dataset.clockLocal = 'true'; localTime.setAttribute('aria-live', 'off');
  const worldList = node('ul', '', 'aw-clock-timer-world-list'); worldList.setAttribute('aria-label', 'World clocks');
  const worldRows = new Map<string, { row: HTMLLIElement; time: HTMLTimeElement; name: HTMLInputElement; dirty: boolean; dial: ReturnType<typeof dial> }>();
  const worldDetails = node('details', '', 'aw-clock-timer-details'); worldDetails.append(node('summary', 'Add a world clock'));
  const worldForm = node('form'), zoneName = writable(node('input')), zoneInput = writable(node('input'));
  zoneName.type = 'text'; zoneName.maxLength = 256; zoneInput.type = 'text'; zoneInput.maxLength = 256; zoneInput.placeholder = 'Europe/London';
  worldForm.append(field('World clock name', zoneName), field('IANA time zone', zoneInput), button('Add world clock', 'addWorldClock', () => {
    void mutate([{ type: 'addWorldClock', key: 'clock', timeZone: zoneInput.value, label: zoneName.value }]);
  }));
  worldForm.onsubmit = event => { event.preventDefault(); if (canEdit()) void mutate([{ type: 'addWorldClock', key: 'clock', timeZone: zoneInput.value, label: zoneName.value }]); };
  worldDetails.append(worldForm); clockPanel.append(localDial.face, localTime, localDate, localZone, worldList, worldDetails);
  let formatterLocale = '';
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const format = (epochMs: number, timeZone: string, date = false) => {
    const locale = current?.localClock.locale ?? 'en-US';
    if (locale !== formatterLocale) { formatters.clear(); formatterLocale = locale; }
    const key = timeZone + ':' + date;
    let formatter = formatters.get(key);
    if (!formatter) { formatter = new Intl.DateTimeFormat(locale, date ? { timeZone, dateStyle: 'full' } :
      { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }); formatters.set(key, formatter); }
    return formatter.format(epochMs);
  };
  const selected = (): TimerView | undefined => current?.timers.find(timer => timer.id === view.selectedTimerId) ?? current?.timers[0];

  function syncDisabled() {
    const editable = canEdit();
    for (const control of section.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('[data-clock-write]')) control.disabled = !editable;
    refreshButton.disabled = !visible() || busy || !!pendingRead;
    timerSelect.disabled = !visible() || !current || !!settingsPending;
    for (const tab of tabMap.values()) tab.disabled = !visible() || !!settingsPending;
    section.inert = !active;
    section.setAttribute('aria-busy', String(busy || !!pendingRead));
  }
  function renderModes() {
    for (const mode of modes) {
      const tab = tabMap.get(mode)!; tab.setAttribute('aria-selected', String(mode === view.mode)); tab.tabIndex = mode === view.mode ? 0 : -1;
      panelMap[mode].hidden = mode !== view.mode;
    }
    section.dataset.clockMode = view.mode;
  }
  function render() {
    if (disposed) return;
    renderModes(); syncDisabled();
    panels.hidden = !current;
    if (!current) {
      heading.textContent = 'Clock & timers'; timerSelect.replaceChildren(); expiryList.replaceChildren(); expiryRows.clear();
      laps.replaceChildren(); worldList.replaceChildren(); worldRows.clear(); formatters.clear();
      timerName.textContent = ''; timerState.textContent = ''; remaining.textContent = ''; watchValue.textContent = '';
      delete localDial.face.dataset.clockZone;
      for (const hand of ['hour', 'minute', 'second'] as const) localDial[hand].style.transform = '';
      watchOrbit.style.setProperty('--aw-watch-phase', '0%'); watchNeedle.style.transform = '';
      localTime.textContent = ''; localDate.textContent = ''; localZone.textContent = ''; deleteMessage.textContent = '';
      if (!renameDirty) rename.value = '';
      delete section.dataset.timerId; delete section.dataset.timerRunId; delete section.dataset.timerState; return;
    }
    heading.textContent = current.resource.title;
    const timer = selected();
    timerSelect.replaceChildren(...current.timers.map(value => {
      const option = node('option', value.name + ' · ' + stateLabel[value.state]); option.value = value.id; return option;
    }));
    timerSelect.value = timer?.id ?? ''; selectorField.hidden = !timer; timerBody.hidden = !timer; timerActions.hidden = !timer; editDetails.hidden = !timer; empty.hidden = !!timer;
    if (!timer) addDetails.open = true;
    if (timer) {
      timerName.textContent = timer.name; timerState.textContent = stateLabel[timer.state]; durationText.textContent = 'Duration ' + formatClockTimerDuration(timer.durationMs);
      section.dataset.timerId = timer.id; section.dataset.timerRunId = timer.runId; section.dataset.timerState = timer.state;
      uncertainty.textContent = timer.timing.wallRecovery ? 'Recovered using the saved wall-clock deadline. Elapsed time across the interruption may be uncertain.' :
        timer.timing.clockAdjusted ? 'A clock change was detected; elapsed time uses the host elapsed clock.' : '';
      uncertainty.hidden = !uncertainty.textContent;
      if (renameTimerId !== timer.id || !renameDirty) { rename.value = timer.name; renameDirty = false; renameTimerId = timer.id; }
      for (const [type, control] of timerButtons) control.hidden = type === 'startTimer' ? timer.state !== 'ready' :
        type === 'pauseTimer' ? timer.state !== 'running' : type === 'resumeTimer' ? timer.state !== 'paused' :
        type === 'cancelTimer' ? timer.state === 'cancelled' || timer.state === 'completed' : false;
      for (const control of adjustment.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !canEdit() || !['ready', 'running', 'paused'].includes(timer.state);
    } else { delete section.dataset.timerId; delete section.dataset.timerRunId; delete section.dataset.timerState; }
    if (!timer || deleteTimerId !== timer.id) { deleteTimerId = null; deleteReview.hidden = true; }
    for (const [id, row] of expiryRows) if (!current.pendingExpiries.some(expiry => expiry.id === id)) { row.remove(); expiryRows.delete(id); }
    for (const expiry of current.pendingExpiries) {
      let row = expiryRows.get(expiry.id);
      if (!row) {
        row = node('li'); row.dataset.clockExpiry = expiry.id;
        row.append(node('span'), button('Dismiss completion', 'acknowledgeExpiry', () => { void mutate([{ type: 'acknowledgeExpiry', expiryId: expiry.id }]); }));
        expiryRows.set(expiry.id, row); expiryList.append(row);
      }
      const title = current.timers.find(item => item.id === expiry.timerId)?.name ?? 'Timer';
      row.querySelector('span')!.textContent = title + ' completed' + (expiry.wallRecovery ? ' · recovered from saved wall time' : '');
    }
    const watch = current.stopwatch;
    watchState.textContent = stateLabel[watch.state]; watchUncertainty.textContent = watch.timing.wallRecovery ? 'Recovered using wall time; elapsed time across the interruption may be uncertain.' : '';
    watchUncertainty.hidden = !watchUncertainty.textContent;
    for (const [type, control] of watchButtons) control.hidden = type === 'stopwatchStart' ? watch.state !== 'ready' :
      type === 'stopwatchPause' || type === 'stopwatchLap' ? watch.state !== 'running' : type === 'stopwatchResume' ? watch.state !== 'paused' : false;
    laps.replaceChildren(...watch.laps.map(lap => {
      const row = node('li'); row.dataset.clockLap = lap.id;
      row.append(node('span', 'Lap ' + lap.number), node('strong', formatClockTimerDuration(lap.elapsedMs, true)),
        node('small', 'Split ' + formatClockTimerDuration(lap.splitMs, true) + (lap.wallRecovery ? ' · wall-time recovery' : ''))); return row;
    }));
    for (const [id, row] of worldRows) if (!current.worldClocks.some(clock => clock.id === id)) { row.row.remove(); worldRows.delete(id); }
    for (const clock of current.worldClocks) {
      let saved = worldRows.get(clock.id);
      if (!saved) {
        const row = node('li'), time = node('time'), name = writable(node('input'));
        name.type = 'text'; name.maxLength = 256; name.setAttribute('aria-label', 'World clock label');
        const worldDial = dial('aw-clock-timer-dial--world');
        saved = { row, time, name, dirty: false, dial: worldDial }; const reference = saved;
        name.oninput = () => { reference.dirty = true; };
        row.dataset.clockWorld = clock.id; time.setAttribute('aria-live', 'off');
        row.append(worldDial.face, field('World clock label', name), time, node('small', clock.timeZone),
          button('Save label', 'renameWorldClock', () => { void mutate([{ type: 'renameWorldClock', clockId: clock.id, label: name.value }], () => { reference.dirty = false; }); }),
          button('Remove world clock', 'removeWorldClock', () => { void mutate([{ type: 'removeWorldClock', clockId: clock.id }]); }));
        worldRows.set(clock.id, saved); worldList.append(row);
      }
      if (!saved.dirty) saved.name.value = clock.label;
    }
    const allowedFormatterKeys = new Set([current.localClock.timeZone + ':false', current.localClock.timeZone + ':true',
      ...current.worldClocks.map(clock => clock.timeZone + ':false')]);
    for (const key of formatters.keys()) if (!allowedFormatterKeys.has(key)) formatters.delete(key);
    syncDisabled(); paintTimes(); reflow();
  }
  function paintTimes() {
    if (!visible() || !current) return;
    const elapsed = Math.max(0, now() - sampleAt), timer = selected();
    if (timer && view.mode === 'timer') {
      const value = Math.max(0, timer.remainingMs - (timer.state === 'running' ? elapsed : 0));
      remaining.textContent = formatClockTimerDuration(value);
      ring.style.setProperty('--aw-timer-progress', String(Math.max(0, Math.min(100, value / timer.durationMs * 100))) + '%');
      timerState.textContent = timer.state === 'running' && value === 0 ? 'Awaiting host completion confirmation' : stateLabel[timer.state];
    }
    if (view.mode === 'stopwatch') {
      const watch = current.stopwatch, elapsedMs = watch.elapsedMs + (watch.state === 'running' ? elapsed : 0);
      watchValue.textContent = formatClockTimerDuration(elapsedMs, true);
      const phase = (elapsedMs % 60000) / 60000;
      watchOrbit.style.setProperty('--aw-watch-phase', String(phase * 100) + '%');
      watchNeedle.style.transform = `rotate(${phase * 360}deg)`;
    }
    if (view.mode === 'clock') {
      const epochMs = current.localClock.epochMs + elapsed;
      localTime.dateTime = new Date(epochMs).toISOString(); localTime.textContent = format(epochMs, current.localClock.timeZone);
      paintDial(localDial, epochMs, current.localClock.timeZone);
      localDate.textContent = format(epochMs, current.localClock.timeZone, true); localZone.textContent = current.localClock.timeZone;
      for (const clock of current.worldClocks) {
        const row = worldRows.get(clock.id); if (row) { row.time.dateTime = localTime.dateTime; row.time.textContent = format(epochMs, clock.timeZone); paintDial(row.dial, epochMs, clock.timeZone); }
      }
    }
    lastPaint = now();
  }
  async function refresh(force = false): Promise<void> {
    if (!visible()) return;
    if (pendingRead) { await pendingRead; if (force && visible()) return refresh(); return; }
    const generation = ++readGeneration; lastRead = now();
    const work = (async () => {
      try {
        const document = await port.read(resourceId);
        if (disposed || !active || generation !== readGeneration) return;
        if (document.contract !== CLOCK_TIMER_CONTRACT || document.resource.id !== resourceId || document.resource.kind !== 'clock_timer') throw new Error('timer_unavailable');
        if (document.resource.version < minVersion || (current && document.resource.version < current.resource.version)) return;
        current = document; sampleAt = now(); status.textContent = document.canEdit ? '' : 'Read only';
        options.onProjection?.(document); render();
      } catch (error) {
        if (disposed || generation !== readGeneration) return;
        current = null; status.textContent = errorMessage(error); options.onProjection?.(null); render();
      }
    })();
    pendingRead = work; syncDisabled();
    try { await work; } finally { if (pendingRead === work) pendingRead = null; if (!disposed) syncDisabled(); }
  }
  function mutate(operations: TimerOperation[], after?: (document: ClockTimerDocument | null, result: Awaited<ReturnType<ClockTimerPort['mutate']>>) => void): Promise<void> {
    if (!canEdit() || !current) return Promise.resolve();
    const input = { commandId: crypto.randomUUID(), resourceId, expectedVersion: current.resource.version, operations };
    busy = true; status.textContent = 'Saving…'; syncDisabled();
    const work = (async () => {
      try {
        const result = await port.mutate(input); minVersion = Math.max(minVersion, result.version);
        if (disposed) return;
        deleteReview.hidden = true; deleteTimerId = null;
        await refresh(true); if (!disposed) { after?.(current, result); render(); }
      } catch (error) {
        if (disposed) return;
        await refresh(true); if (!disposed) status.textContent = errorMessage(error);
      } finally { busy = false; if (!disposed) render(); }
    })();
    pendingMutation = work; return work.finally(() => { if (pendingMutation === work) pendingMutation = null; });
  }
  async function loadSettings() {
    const placement = options.placement;
    if (!placement?.host.getBlockSettings || disposed) return;
    const result = await placement.host.getBlockSettings(placement.placementId);
    if (disposed) return;
    if (result.placementId !== placement.placementId || result.resourceId !== resourceId || result.kind !== 'clock_timer') throw new Error('timer_unavailable');
    settings = result; config = validateConfiguration(result.configuration); view = { ...(config.clockTimer ?? { mode: 'timer' }) }; render();
  }
  function changeView(next: ClockTimerViewState) {
    if (!visible()) return;
    view = { ...next }; render();
    const placement = options.placement;
    if (!placement || settingsPending) return;
    const work = (async () => {
      try {
        if (!placement.host.getBlockSettings || !placement.host.configureBlock) throw new Error('settings_unavailable');
        if (!settings) await loadSettings();
        if (disposed || !active || !settings) return;
        const configuration = validateConfiguration({ ...config, clockTimer: next });
        const result = await placement.host.configureBlock({ placementId: placement.placementId, expectedVersion: settings.version, configuration });
        if (disposed) return;
        if (result.placementId !== placement.placementId || result.resourceId !== resourceId || result.kind !== 'clock_timer') throw new Error('timer_unavailable');
        settings = result; config = validateConfiguration(result.configuration); view = { ...(config.clockTimer ?? next) };
        placement.onSaved?.(result); render();
      } catch {
        if (disposed) return;
        try { await loadSettings(); } catch { /* The canonical timer data remains independently readable. */ }
        if (!disposed) status.textContent = 'View preferences could not be saved. Review this placement before trying again.';
      }
    })();
    settingsPending = work; syncDisabled();
    void work.finally(() => { if (settingsPending === work) settingsPending = null; if (!disposed) syncDisabled(); });
  }
  function reflow() {
    if (disposed) return;
    const bounds = root.getBoundingClientRect();
    section.dataset.compact = String(config.contentMode === 'compact' || (config.contentMode !== 'reading' && presentation === 'workspace' && (bounds.width < 360 || bounds.height < 380)));
    section.dataset.presentation = presentation;
  }
  const visibilityChanged = () => { if (visible()) void refresh(true); else syncDisabled(); };
  doc.addEventListener?.('visibilitychange', visibilityChanged);
  refreshButton.onclick = () => { if (visible() && !busy) void refresh(true); };
  render();
  if (options.placement) {
    const initialSettings = loadSettings().catch(() => { if (!disposed) status.textContent = 'Saved placement preferences are unavailable.'; });
    settingsPending = initialSettings; syncDisabled();
    void initialSettings.finally(() => { if (settingsPending === initialSettings) settingsPending = null; if (!disposed) syncDisabled(); });
  }
  void refresh();
  return {
    refresh: () => refresh(),
    setActive(value) {
      if (disposed || active === value) return;
      active = value; if (!active) readGeneration++; render();
      if (visible()) void refresh(true);
    },
    setPresentation(value) { presentation = value; reflow(); },
    setConfiguration(value) { config = validateConfiguration(value); view = { ...(config.clockTimer ?? { mode: 'timer' }) }; render(); },
    frame() {
      if (!visible() || !current) return;
      const instant = now(), running = current.timers.some(timer => timer.state === 'running') || current.stopwatch.state === 'running';
      const selectedTimer = selected(), due = selectedTimer?.state === 'running' && selectedTimer.remainingMs <= instant - sampleAt;
      if (!pendingRead && instant - lastRead >= (due ? 1000 : running ? 15000 : 60000)) void refresh();
      if (instant - lastPaint >= (view.mode === 'stopwatch' && current.stopwatch.state === 'running' ? 100 : view.mode === 'timer' ? 250 : 1000)) paintTimes();
    },
    reflow,
    async flush() { await pendingMutation; await settingsPending; },
    dispose() {
      if (disposed) return; disposed = true; readGeneration++; current = null;
      doc.removeEventListener?.('visibilitychange', visibilityChanged);
      options.onProjection?.(null); section.remove(); worldRows.clear(); expiryRows.clear(); formatters.clear();
    },
  };
}
