import { CLOCK_TIMER_CONTRACT, TIMER_LIMITS, type ClockTimerDocument, type TimerOperation, type TimerState, type TimerView } from '../../timer-product/contracts.ts';

export interface TimerIntentRef { resourceId: string; timerId: string }
export interface TimerIntentContext {
  /** Current authorized canonical documents, not placement copies or provider-supplied history. */
  documents: readonly ClockTimerDocument[];
  focused?: { resourceId: string; timerId?: string; mode?: 'timer' | 'stopwatch' | 'clock' } | null;
  lastResourceId?: string | null;
  /** Caller-owned canonical operation journal. The parser never invents a last timer. */
  lastTimer?: TimerIntentRef | null;
}
export interface TimerIntentCandidate {
  resourceId: string; resourceTitle: string;
  timerId?: string; timerName?: string;
  clockId?: string; clockLabel?: string;
}
export type TimerIntentClarificationReason = 'invalid-context' | 'missing-duration' | 'invalid-duration' | 'missing-target' |
  'ambiguous-timer' | 'ambiguous-resource' | 'ambiguous-clock' | 'unavailable-target' | 'read-only' | 'invalid-transition' |
  'invalid-time-zone' | 'invalid-name' | 'ambiguous-action';
export type VelaTimerIntentPlan =
  | { kind: 'unmatched' }
  | { kind: 'clarification'; reason: TimerIntentClarificationReason; message: string; candidates: TimerIntentCandidate[]; truncated: boolean }
  | { kind: 'list'; target: 'timers' | 'world-clocks'; resourceIds: string[]; states?: TimerState[] }
  | { kind: 'read'; target: 'timer' | 'stopwatch' | 'clock'; resourceId: string | null; expectedVersion?: number;
      timerId?: string; timeZone?: string; label?: string }
  | { kind: 'create'; resourceTitle: string; operations: TimerOperation[]; focus: { mode: 'timer' | 'stopwatch' | 'clock'; timerKey?: string } }
  | { kind: 'mutate'; resourceId: string; expectedVersion: number; operations: TimerOperation[]; requiresConfirmation: boolean;
      focus: { mode: 'timer' | 'stopwatch' | 'clock'; timerId?: string } };

/** Deliberately finite aliases. No geolocation, network, fuzzy city lookup, or DST-offset guessing. */
export const TIMER_CITY_ZONES = Object.freeze({
  tokyo: 'Asia/Tokyo', london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', rome: 'Europe/Rome', madrid: 'Europe/Madrid',
  'new york': 'America/New_York', nyc: 'America/New_York', chicago: 'America/Chicago', denver: 'America/Denver',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', toronto: 'America/Toronto', vancouver: 'America/Vancouver',
  honolulu: 'Pacific/Honolulu', sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', auckland: 'Pacific/Auckland',
  singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', seoul: 'Asia/Seoul',
  delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata', dubai: 'Asia/Dubai', cairo: 'Africa/Cairo',
  johannesburg: 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg', utc: 'UTC', gmt: 'UTC',
} as const);
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,200}$/u.test(value);
const name = (value: string) => value.trim().length > 0 && Buffer.byteLength(value) <= 256 && !/[\x00-\x1f]/u.test(value);
const clean = (value: string) => value.normalize('NFKC').replaceAll('’', "'").replace(/[“”]/gu, '"').trim().replace(/\s+/gu, ' ');
const unquote = (value: string) => value.trim().replace(/^(?:"([^"]+)"|'([^']+)')$/u, (_all, double, single) => double ?? single).trim();
const referenceName = (value: string) => unquote(clean(value).replace(/^(?:my|the|a|an)\s+/iu, '').replace(/\s+timer$/iu, '')).toLocaleLowerCase('en-US');
const clockName = (value: string) => unquote(clean(value).replace(/^(?:my|the|a|an)\s+/iu, '').replace(/\s+(?:world\s+)?clock$/iu, '')).toLocaleLowerCase('en-US');
const empty = (): VelaTimerIntentPlan => ({ kind: 'unmatched' });
function clarify(reason: TimerIntentClarificationReason, message: string, candidates: TimerIntentCandidate[] = []): VelaTimerIntentPlan {
  return { kind: 'clarification', reason, message, candidates: candidates.slice(0, 16), truncated: candidates.length > 16 };
}
const small = Object.freeze({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 } as Record<string, number>);
const tens = Object.freeze({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 } as Record<string, number>);
function underHundred(words: string[]): number | null {
  if (words.length === 1 && Object.hasOwn(small, words[0])) return small[words[0]];
  if (words.length === 1 && Object.hasOwn(tens, words[0])) return tens[words[0]];
  if (words.length === 2 && Object.hasOwn(tens, words[0]) && Object.hasOwn(small, words[1]) && small[words[1]] > 0 && small[words[1]] < 10)
    return tens[words[0]] + small[words[1]];
  return null;
}
function underThousand(words: string[]): number | null {
  if (words.length >= 2 && small[words[0]] > 0 && small[words[0]] < 10 && words[1] === 'hundred') {
    let tail = words.slice(2); if (tail[0] === 'and') tail = tail.slice(1);
    const remainder = tail.length ? underHundred(tail) : 0;
    return remainder === null ? null : small[words[0]] * 100 + remainder;
  }
  return underHundred(words);
}
function integerWords(value: string): number | null {
  const words = value.replace(/-/gu, ' ').split(/\s+/u);
  if (words.length > 16 || !words.length) return null;
  let remaining = words, total = 0;
  for (const [word, factor] of [['million', 1000000], ['thousand', 1000]] as const) {
    const position = remaining.indexOf(word);
    if (position >= 0) {
      const prefix = underThousand(remaining.slice(0, position));
      if (prefix === null || prefix === 0) return null;
      total += prefix * factor; remaining = remaining.slice(position + 1);
      if (remaining[0] === 'and') remaining = remaining.slice(1);
    }
  }
  if (!remaining.length) return total || null;
  const tail = underThousand(remaining); return tail === null ? null : total + tail;
}
function quantity(value: string): number | null {
  const input = value.trim().toLowerCase().replace(/-/gu, ' ');
  if (/^(?:\d{1,11}(?:\.\d{1,6})?|\.\d{1,6})$/u.test(input)) return Number(input);
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?$/u.test(input)) return Number(input.replaceAll(',', ''));
  if (/^(?:a|an)$/u.test(input)) return 1;
  if (/^(?:(?:a|an) )?half(?: (?:a|an))?$/u.test(input)) return .5;
  if (/^(?:a )?quarter(?: of (?:a|an))?$/u.test(input)) return .25;
  const fraction = /^(.+) and (?:a |one )?(half|quarter)$/u.exec(input);
  if (fraction) { const whole = quantity(fraction[1]); return whole === null || !Number.isInteger(whole) ? null : whole + (fraction[2] === 'half' ? .5 : .25); }
  return integerWords(input.replace(/^(?:a|an) /u, 'one '));
}
const unitPattern = /\b(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|y)\b/giu;
const factor = (unit: string) => /^ms$|^millisecond/u.test(unit) ? 1 : /^s$|^sec/u.test(unit) ? 1000 : /^m$|^min/u.test(unit) ? 60000 :
  /^h$|^hr|^hour/u.test(unit) ? 3600000 : /^d$|^day/u.test(unit) ? 86400000 : /^w$|^week/u.test(unit) ? 604800000 : 31536000000;
/** Complete bounded duration only. Unsupported units and leftover words are never discarded. */
export function parseTimerDuration(value: string): number | null {
  if (typeof value !== 'string' || value.length > 180) return null;
  const input = clean(value).toLowerCase().replace(/(?<=\d)-(?=[a-z])/gu, ' ').replace(/(?<=\d)(?=[a-z])/gu, ' ');
  const units = [...input.matchAll(unitPattern)]; if (!units.length || units.length > 8) return null;
  let position = 0, total = 0;
  for (const unit of units) {
    const raw = input.slice(position, unit.index).trim().replace(/^(?:and|,)\s*/u, ''), amount = quantity(raw);
    if (amount === null) return null;
    total += amount * factor(unit[1].toLowerCase()); position = unit.index! + unit[0].length;
  }
  const rounded = Math.round(total);
  return input.slice(position).trim() || !Number.isFinite(total) || Math.abs(total - rounded) > .000001 || rounded < 1 || rounded > TIMER_LIMITS.maxDurationMs ? null : rounded;
}
function durationPrefix(value: string): { durationMs: number; rest: string } | null {
  const input = value.replace(/(?<=\d)-(?=[a-z])/giu, ' ').replace(/(?<=\d)(?=[a-z])/giu, ' ');
  let result: { durationMs: number; rest: string } | null = null;
  for (const unit of input.matchAll(unitPattern)) {
    const end = unit.index! + unit[0].length, durationMs = parseTimerDuration(input.slice(0, end));
    if (durationMs !== null) result = { durationMs, rest: input.slice(end).trim() };
  }
  return result;
}
function timeZone(value: string): { timeZone: string; label: string } | null {
  const label = unquote(clean(value).replace(/\s+(?:right now|now)$/iu, ''));
  const alias = TIMER_CITY_ZONES[label.toLocaleLowerCase('en-US') as keyof typeof TIMER_CITY_ZONES];
  if (!name(label) || /^[+-]/u.test(label)) return null;
  try { return { timeZone: new Intl.DateTimeFormat('en-US', { timeZone: alias ?? label }).resolvedOptions().timeZone, label }; }
  catch { return null; }
}
type TimerMatch = { document: ClockTimerDocument; timer: TimerView };
const candidate = (document: ClockTimerDocument, timer?: TimerView): TimerIntentCandidate => ({ resourceId: document.resource.id,
  resourceTitle: document.resource.title, ...(timer ? { timerId: timer.id, timerName: timer.name } : {}) });
const mutatePlan = (document: ClockTimerDocument, operations: TimerOperation[], mode: 'timer' | 'stopwatch' | 'clock', timerId?: string,
  requiresConfirmation = false): VelaTimerIntentPlan => document.canEdit !== true ? clarify('read-only', 'That clock resource is read only.', [candidate(document)]) :
  { kind: 'mutate', resourceId: document.resource.id, expectedVersion: document.resource.version, operations, requiresConfirmation,
    focus: { mode, ...(timerId ? { timerId } : {}) } };

/** Pure intent/target planning. No clock observation, execution, new canonical IDs, or receipts are produced. */
export function parseVelaTimerIntent(intent: unknown, context: TimerIntentContext): VelaTimerIntentPlan {
  if (typeof intent !== 'string' || Buffer.byteLength(intent) > 2048 || /[\x00-\x1f]/u.test(intent)) return empty();
  const input = clean(intent).replace(/^vela[,:]?\s+/iu, '').replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/iu, '').replace(/[?!.]+$/u, '').trim();
  if (!input) return empty();
  if (!context || !Array.isArray(context.documents) || context.documents.length > TIMER_LIMITS.resources * 2)
    return clarify('invalid-context', 'Refresh the authorized clock resources before choosing a timer.');
  const canonical = new Map<string, ClockTimerDocument>();
  for (const document of context.documents) {
    if (!document || document.contract !== CLOCK_TIMER_CONTRACT || !document.resource || document.resource.kind !== 'clock_timer' ||
        !id(document.resource.id) || !Number.isSafeInteger(document.resource.version) || document.resource.version < 1 ||
        typeof document.resource.title !== 'string' || !name(document.resource.title) || typeof document.canEdit !== 'boolean' ||
        !document.stopwatch || !['ready', 'running', 'paused'].includes(document.stopwatch.state) ||
        !Array.isArray(document.timers) || document.timers.length > TIMER_LIMITS.timersPerResource ||
        !Array.isArray(document.worldClocks) || document.worldClocks.length > TIMER_LIMITS.worldClocks)
      return clarify('invalid-context', 'Refresh the authorized clock resources before choosing a timer.');
    if (document.resource.state !== 'active') continue;
    if (document.timers.some((timer: TimerView) => !timer || !id(timer.id) || typeof timer.name !== 'string' || !name(timer.name) ||
          !Number.isSafeInteger(timer.version) || timer.version < 1 || !['ready', 'running', 'paused', 'completed', 'cancelled'].includes(timer.state)) ||
        document.worldClocks.some((clock: ClockTimerDocument['worldClocks'][number]) => !clock || !id(clock.id) || typeof clock.label !== 'string' || !name(clock.label) || typeof clock.timeZone !== 'string') ||
        new Set(document.timers.map((timer: TimerView) => timer.id)).size !== document.timers.length)
      return clarify('invalid-context', 'Refresh the authorized timer state before choosing a timer.');
    const previous = canonical.get(document.resource.id);
    if (!previous || previous.resource.version < document.resource.version) canonical.set(document.resource.id, document);
  }
  const documents = [...canonical.values()];
  if (documents.length > TIMER_LIMITS.resources) return clarify('invalid-context', 'Narrow the authorized clock resource scope.');
  const timers: TimerMatch[] = documents.flatMap(document => document.timers.map(timer => ({ document, timer })));
  const findRef = (ref: TimerIntentRef): TimerMatch | undefined => timers.find(value => value.document.resource.id === ref.resourceId && value.timer.id === ref.timerId);
  function resolveTimer(reference = ''): TimerMatch | VelaTimerIntentPlan {
    const key = referenceName(reference), pronoun = !key || ['timer', 'this', 'that', 'it', 'this timer', 'that timer'].includes(key);
    if (!pronoun) {
      const matches = timers.filter(value => referenceName(value.timer.name) === key);
      return matches.length === 1 ? matches[0] : matches.length > 1 ? clarify('ambiguous-timer', 'Several timers have that name. Which one should I use?', matches.map(value => candidate(value.document, value.timer))) :
        clarify('unavailable-target', 'No currently authorized timer has that exact name. I have not selected another timer.');
    }
    const focusRef = context.focused?.timerId ? { resourceId: context.focused.resourceId, timerId: context.focused.timerId } : null;
    const refs = key.startsWith('that') ? [context.lastTimer, focusRef] : [focusRef, context.lastTimer];
    for (const ref of refs) if (ref) {
      const match = findRef(ref);
      return match ?? clarify('unavailable-target', 'The referenced timer is no longer in the authorized current state. Choose a timer again.');
    }
    for (const resourceId of [context.focused?.resourceId, context.lastResourceId]) if (resourceId) {
      const document = canonical.get(resourceId);
      if (!document) return clarify('unavailable-target', 'The referenced clock resource is no longer available. Choose a timer again.');
      const matches = timers.filter(value => value.document === document);
      if (matches.length === 1) return matches[0];
      return clarify(matches.length ? 'ambiguous-timer' : 'missing-target', matches.length ? 'Which timer in that resource should I use?' : 'That resource has no saved timer.', matches.map(value => candidate(value.document, value.timer)));
    }
    return timers.length === 1 ? timers[0] : clarify(timers.length ? 'ambiguous-timer' : 'missing-target', timers.length ? 'Which timer should I use?' : 'There is no authorized saved timer to use.', timers.map(value => candidate(value.document, value.timer)));
  }
  function resolveResource(): ClockTimerDocument | VelaTimerIntentPlan | null {
    for (const resourceId of [context.focused?.resourceId, context.lastResourceId, context.lastTimer?.resourceId]) if (resourceId)
      return canonical.get(resourceId) ?? clarify('unavailable-target', 'The referenced clock resource is no longer available. Choose a clock resource again.');
    return documents.length === 1 ? documents[0] : documents.length > 1 ? clarify('ambiguous-resource', 'Which clock resource should I use?', documents.map(document => candidate(document))) : null;
  }
  function addOperation(operation: TimerOperation, mode: 'timer' | 'stopwatch' | 'clock'): VelaTimerIntentPlan {
    const target = resolveResource();
    if (target && 'kind' in target) return target;
    return target ? mutatePlan(target, [operation], mode) : { kind: 'create', resourceTitle: 'Clock & timers', operations: [operation],
      focus: { mode, ...(operation.type === 'createTimer' ? { timerKey: operation.key } : {}) } };
  }
  function timerOperation(type: TimerOperation['type'], reference: string, value?: number | string): VelaTimerIntentPlan {
    const resolved = resolveTimer(reference); if ('kind' in resolved) return resolved;
    const { document, timer } = resolved;
    if (type === 'startTimer' && timer.state !== 'ready' || type === 'pauseTimer' && timer.state !== 'running' || type === 'resumeTimer' && timer.state !== 'paused' ||
      (type === 'extendTimer' || type === 'shortenTimer') && !['ready', 'running', 'paused'].includes(timer.state))
      return clarify('invalid-transition', `“${timer.name}” is ${timer.state}. Choose an operation valid for that state.`, [candidate(document, timer)]);
    if (type === 'extendTimer' || type === 'shortenTimer') {
      const nextDuration = timer.durationMs + (type === 'extendTimer' ? Number(value) : -Number(value));
      if (!Number.isSafeInteger(nextDuration) || nextDuration < 1 || nextDuration > TIMER_LIMITS.maxDurationMs)
        return clarify('invalid-duration', 'The configured duration must remain positive and at most 365 days.', [candidate(document, timer)]);
    }
    const operation = type === 'extendTimer' || type === 'shortenTimer' ? { type, timerId: timer.id, amountMs: value as number } :
      type === 'renameTimer' ? { type, timerId: timer.id, name: value as string } : { type, timerId: timer.id };
    return mutatePlan(document, [operation as TimerOperation], 'timer', timer.id, type === 'deleteTimer');
  }

  if (/^(?:show|list|display|inspect)(?: me)? (?:all )?(?:my |the )?timers$/iu.test(input) || /^what timers (?:do i have|are there)$/iu.test(input))
    return { kind: 'list', target: 'timers', resourceIds: documents.map(document => document.resource.id) };
  if (/^(?:show|list)(?: me)? (?:all )?(?:my |the )?running timers$/iu.test(input) || /^what timers are running$/iu.test(input))
    return { kind: 'list', target: 'timers', states: ['running'], resourceIds: documents.map(document => document.resource.id) };
  if (/^(?:show|list|display)(?: me)? (?:all )?(?:my |the )?world clocks$/iu.test(input))
    return { kind: 'list', target: 'world-clocks', resourceIds: documents.map(document => document.resource.id) };
  if (/^(?:delete|remove|cancel|reset) (?:all|every) (?:my )?timers$/iu.test(input))
    return clarify('ambiguous-action', 'Choose a timer explicitly. This command will not modify every timer.', timers.map(value => candidate(value.document, value.timer)));

  const clockQuery = /^(?:what(?:'s| is) (?:the )?(?:current )?time in|what time is it in|show(?: me)? (?:the )?(?:current )?time in|time in) (.+)$/iu.exec(input);
  if (clockQuery) {
    const zone = timeZone(clockQuery[1]);
    return zone ? { kind: 'read', target: 'clock', resourceId: null, ...zone } : clarify('invalid-time-zone', 'Use a supported city name or a valid IANA time zone, such as Asia/Tokyo.');
  }
  const worldAdd = /^(?:add|create) (?:(?:a|an|the) )?(?:world )?clock (?:for|in) (.+?)(?: (?:called|named) (.+))?$/iu.exec(input) ??
    /^(?:add|create) (?:(?:a|an|the) )?(.+?) (?:world )?clock$/iu.exec(input);
  if (worldAdd) {
    const zone = timeZone(worldAdd[1]); if (!zone) return clarify('invalid-time-zone', 'Use a supported city name or a valid IANA time zone.');
    const label = unquote(worldAdd[2] ?? zone.label); if (!name(label)) return clarify('invalid-name', 'Enter a short nonempty world clock name.');
    return addOperation({ type: 'addWorldClock', key: 'clock', timeZone: zone.timeZone, label }, 'clock');
  }
  const worldRename = /^rename (.+? (?:world )?clock) to (.+)$/iu.exec(input), worldRemove = /^(?:remove|delete) (.+? (?:world )?clock)$/iu.exec(input);
  if (worldRename || worldRemove) {
    const ref = clockName((worldRename ?? worldRemove)![1]), zone = timeZone(ref);
    const matches = documents.flatMap(document => document.worldClocks.filter(clock => clockName(clock.label) === ref || clock.timeZone.toLowerCase() === ref || zone?.timeZone === clock.timeZone).map(clock => ({ document, clock })));
    if (matches.length !== 1) return clarify(matches.length ? 'ambiguous-clock' : 'unavailable-target', matches.length ? 'Which saved world clock should I use?' : 'No authorized saved world clock matches that name or zone.',
      matches.map(({ document, clock }) => ({ ...candidate(document), clockId: clock.id, clockLabel: clock.label })));
    const { document, clock } = matches[0];
    if (worldRename) { const label = unquote(worldRename[2]); return name(label) ? mutatePlan(document, [{ type: 'renameWorldClock', clockId: clock.id, label }], 'clock') : clarify('invalid-name', 'Enter a short nonempty world clock name.'); }
    return mutatePlan(document, [{ type: 'removeWorldClock', clockId: clock.id }], 'clock', undefined, true);
  }

  const watch = /^(start|begin|pause|stop|resume|continue|reset|restart|lap|show|inspect|open) (?:(?:a|an|the|my|this|that) )?stopwatch$/iu.exec(input) ??
    /^(record(?: a)? lap)(?: (?:on|in))? (?:(?:the|my|this|that) )?stopwatch$/iu.exec(input) ??
    (/^(?:lap|record(?: a)? lap)$/iu.test(input) ? [input, 'lap'] : context.focused?.mode === 'stopwatch' && /^(?:start|pause|stop|resume|reset|restart)$/iu.test(input) ? [input, input] : null);
  if (watch) {
    const verb = watch[1].toLowerCase(), target = resolveResource(); if (target && 'kind' in target) return target;
    if (['show', 'inspect', 'open'].includes(verb)) return target ? { kind: 'read', target: 'stopwatch', resourceId: target.resource.id, expectedVersion: target.resource.version } : clarify('missing-target', 'There is no authorized saved stopwatch.');
    const type = /lap/u.test(verb) ? 'stopwatchLap' : /^(?:start|begin)$/u.test(verb) ? 'stopwatchStart' : /^(?:pause|stop)$/u.test(verb) ? 'stopwatchPause' :
      /^(?:resume|continue)$/u.test(verb) ? 'stopwatchResume' : 'stopwatchReset';
    if (!target) return type === 'stopwatchStart' || verb === 'restart' ? { kind: 'create', resourceTitle: 'Clock & timers', operations: [{ type: 'stopwatchStart' }], focus: { mode: 'stopwatch' } } : clarify('missing-target', 'There is no authorized saved stopwatch.');
    if (verb === 'restart') return mutatePlan(target, [{ type: 'stopwatchReset' }, { type: 'stopwatchStart' }], 'stopwatch');
    const state = target.stopwatch.state;
    if (type === 'stopwatchStart' && state !== 'ready' || type === 'stopwatchPause' && state !== 'running' || type === 'stopwatchResume' && state !== 'paused' || type === 'stopwatchLap' && state !== 'running')
      return clarify('invalid-transition', `That stopwatch is ${state}. Choose an operation valid for that state.`, [candidate(target)]);
    return mutatePlan(target, [{ type }], 'stopwatch');
  }

  const create = /^(set|start|create|add|make) (?:(?:a|an|new) )?(.*?)\btimer\b(?: (.*))?$/iu.exec(input);
  if (create) {
    const head = create[2].trim(), tail = create[3]?.trim() ?? '', prefix = durationPrefix(head);
    let durationText = '', timerName = prefix?.rest ?? head;
    const afterName = /^(?:called|named) (.+?) for (.+)$/iu.exec(tail), afterDuration = /^for (.+?) (?:called|named) (.+)$/iu.exec(tail);
    if (afterName) { timerName = afterName[1]; durationText = afterName[2]; }
    else if (afterDuration) { durationText = afterDuration[1]; timerName = afterDuration[2]; }
    else if (/^for /iu.test(tail)) durationText = tail.slice(4);
    else if (/^(?:called|named) /iu.test(tail)) timerName = tail.replace(/^(?:called|named) /iu, '');
    else if (tail) return clarify('invalid-duration', 'Use one complete duration and, optionally, an explicit timer name.');
    if (prefix && durationText) return clarify('invalid-duration', 'Specify one duration for the new timer.');
    const durationMs = durationText ? parseTimerDuration(durationText) : prefix?.durationMs ?? null;
    if (durationMs !== null) {
      timerName = unquote(timerName || 'Timer'); if (!name(timerName)) return clarify('invalid-name', 'Enter a short nonempty timer name.');
      return addOperation({ type: 'createTimer', key: 'timer', name: timerName, durationMs, start: /^(?:set|start)$/iu.test(create[1]) }, 'timer');
    }
    if (durationText || prefix || /\d|\b(?:seconds?|minutes?|hours?|days?|weeks?|years?)\b/iu.test(head))
      return clarify('invalid-duration', 'Use a positive duration of at most 365 days, in milliseconds, seconds, minutes, hours, days, or weeks.');
    if (create[1].toLowerCase() !== 'start') return clarify('missing-duration', 'How long should the new timer run?');
  }

  const remaining = /^(?:how much time (?:is )?(?:left|remaining)|how long is left|time left|remaining time|what(?:'s| is) the remaining time)(?: (?:on|for|in) (.+))?$/iu.exec(input);
  if (remaining) {
    const resolved = resolveTimer(remaining[1] ?? ''); return 'kind' in resolved ? resolved : { kind: 'read', target: 'timer', resourceId: resolved.document.resource.id,
      expectedVersion: resolved.document.resource.version, timerId: resolved.timer.id };
  }
  const rename = /^rename (.+?\btimer) to (.+)$/iu.exec(input) ?? /^(?:name|call) ((?:this|that|the|my) timer) (.+)$/iu.exec(input);
  if (rename) { const value = unquote(rename[2]); return name(value) ? timerOperation('renameTimer', rename[1], value) : clarify('invalid-name', 'Enter a short nonempty timer name.'); }
  const adjustNamed = /^(?:extend|lengthen|shorten|reduce) (.+?) by (.+)$/iu.exec(input);
  const add = /^(?:add|subtract|remove) (.+?)(?: (?:to|from) (.+))?$/iu.exec(input);
  const extend = /^(?:extend|lengthen|shorten|reduce)(?: (?:it|that timer|this timer|the timer))? by (.+)$/iu.exec(input);
  if (adjustNamed || add || extend) {
    const amountText = adjustNamed ? adjustNamed[2] : add ? add[1] : extend![1];
    const amountMs = parseTimerDuration(amountText);
    if (amountMs !== null) return timerOperation(/^(?:shorten|reduce|subtract|remove)\b/iu.test(input) ? 'shortenTimer' : 'extendTimer', adjustNamed?.[1] ?? add?.[2] ?? '', amountMs);
    if (/\b(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?|years?)\b/iu.test(amountText)) return clarify('invalid-duration', 'Enter a positive duration to add or subtract.');
  }
  const lifecycle = /^(start|pause|resume|continue|reset|restart|cancel|delete|remove|stop|inspect|show|open) (.+)$/iu.exec(input);
  if (lifecycle && (/\btimer$/iu.test(lifecycle[2]) || /^(?:it|this|that)$/iu.test(lifecycle[2]) && !!(context.focused?.timerId || context.lastTimer))) {
    const verb = lifecycle[1].toLowerCase(), reference = lifecycle[2];
    if (verb === 'stop') return clarify('ambiguous-action', 'Do you want to pause or cancel that timer?');
    if (['inspect', 'show', 'open'].includes(verb)) {
      const resolved = resolveTimer(reference); return 'kind' in resolved ? resolved : { kind: 'read', target: 'timer', resourceId: resolved.document.resource.id,
        expectedVersion: resolved.document.resource.version, timerId: resolved.timer.id };
    }
    if (verb === 'restart') {
      const resolved = resolveTimer(reference); return 'kind' in resolved ? resolved : mutatePlan(resolved.document,
        [{ type: 'resetTimer', timerId: resolved.timer.id }, { type: 'startTimer', timerId: resolved.timer.id }], 'timer', resolved.timer.id);
    }
    const type = ({ start: 'startTimer', pause: 'pauseTimer', resume: 'resumeTimer', continue: 'resumeTimer', reset: 'resetTimer', cancel: 'cancelTimer',
      delete: 'deleteTimer', remove: 'deleteTimer' } as const)[verb as 'start'];
    return timerOperation(type, reference);
  }
  return empty();
}
