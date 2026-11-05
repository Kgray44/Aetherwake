import type { ClockTimerAction, ClockTimerDocument, TimerView } from '../../timer-product/contracts.ts';
import type { TimerCanonicalRequest, TimerCanonicalResult } from './timer-domain.mts';
import type { VelaTimerIntentPlan } from './vela-timer-intents.mts';

export interface VelaTimerExecutionFocus { mode: 'timer' | 'stopwatch' | 'clock'; resourceId?: string; timerId?: string; timerKey?: string }
export type VelaTimerQuery =
  | { target: 'timer'; timerId: string }
  | { target: 'stopwatch' | 'clock' | 'world-clocks' }
  | { target: 'timers'; states?: TimerView['state'][] };
export interface VelaTimerExecutionAction {
  kind: 'execute'; request: TimerCanonicalRequest;
  expectedVersions: { resourceId: string; version: number }[];
  requiresConfirmation: boolean;
  focus?: VelaTimerExecutionFocus;
  query?: VelaTimerQuery;
}
export type VelaTimerExecutionRecipe = Extract<VelaTimerIntentPlan, { kind: 'unmatched' | 'clarification' }> | VelaTimerExecutionAction;

export function velaClockTimerAction(recipe: VelaTimerExecutionAction, workspaceId: string | null): ClockTimerAction {
  const request=structuredClone(recipe.request);
  let actionRequest:ClockTimerAction['request'];
  if(request.name==='create'||request.name==='mutate') {
    const {commandId:_commandId,...input}=request.input;
    actionRequest={name:request.name,input} as ClockTimerAction['request'];
  } else actionRequest=request;
  return {type:'clockTimer',request:actionRequest,workspaceId:request.name==='create'?workspaceId:null,
    focus:recipe.focus?{mode:recipe.focus.mode,timerId:recipe.focus.timerId??null,timerKey:recipe.focus.timerKey??null}:null,query:recipe.query??null};
}
export function velaClockTimerRecipe(action: ClockTimerAction, commandId: string): VelaTimerExecutionAction {
  const request=structuredClone(action.request);
  const canonical:TimerCanonicalRequest=request.name==='create'?{name:'create',input:{...request.input,commandId}}:
    request.name==='mutate'?{name:'mutate',input:{...request.input,commandId}}:request;
  return {kind:'execute',request:canonical,expectedVersions:canonical.name==='mutate'||canonical.name==='read'&&canonical.input.expectedVersion!==undefined?
    [{resourceId:canonical.input.resourceId,version:canonical.input.expectedVersion!}]:[],requiresConfirmation:false,
    ...(action.focus?{focus:{mode:action.focus.mode,...(action.focus.timerId?{timerId:action.focus.timerId}:{}),...(action.focus.timerKey?{timerKey:action.focus.timerKey}:{})}}:{}),
    ...(action.query?{query:structuredClone(action.query)}:{})};
}

/** Pure translation only. The native host owns review/grant checks and calls
 * TimerDomain.prepareCanonical with a synchronous authority validator at apply. */
export function createVelaTimerExecutionRecipe(plan: VelaTimerIntentPlan,
  input: { commandId: string; projectId?: string | null }): VelaTimerExecutionRecipe {
  if (plan.kind === 'unmatched' || plan.kind === 'clarification') return structuredClone(plan);
  if (plan.kind === 'create') return { kind: 'execute', request: { name: 'create', input: { commandId: input.commandId,
    title: plan.resourceTitle, operations: structuredClone(plan.operations), ...(input.projectId !== undefined ? { projectId: input.projectId } : {}) } },
    expectedVersions: [], requiresConfirmation: false, focus: structuredClone(plan.focus) };
  if (plan.kind === 'mutate') {
    const createdTimer = plan.operations.find(operation => operation.type === 'createTimer');
    return { kind: 'execute', request: { name: 'mutate', input: { commandId: input.commandId,
      resourceId: plan.resourceId, expectedVersion: plan.expectedVersion, operations: structuredClone(plan.operations) } },
      expectedVersions: [{ resourceId: plan.resourceId, version: plan.expectedVersion }],
      // Removal remains review-required even if an untrusted serialized plan drops its flag.
      requiresConfirmation: plan.requiresConfirmation || plan.operations.some(operation => operation.type === 'deleteTimer' || operation.type === 'removeWorldClock'),
      focus: { ...structuredClone(plan.focus), resourceId: plan.resourceId, ...(createdTimer ? { timerKey: createdTimer.key } : {}) } };
  }
  if (plan.kind === 'list') return { kind: 'execute', request: { name: 'list', input: { resourceIds: [...plan.resourceIds] } },
    expectedVersions: [], requiresConfirmation: false, query: plan.target === 'timers' ? { target: 'timers', ...(plan.states ? { states: [...plan.states] } : {}) } : { target: 'world-clocks' } };
  if (plan.resourceId === null) return { kind: 'execute', request: { name: 'readClock', input: { ...(plan.timeZone ? { timeZone: plan.timeZone } : {}) } },
    expectedVersions: [], requiresConfirmation: false, query: { target: 'clock' }, focus: { mode: 'clock' } };
  return { kind: 'execute', request: { name: 'read', input: { resourceId: plan.resourceId,
    ...(plan.expectedVersion !== undefined ? { expectedVersion: plan.expectedVersion } : {}) } },
    expectedVersions: plan.expectedVersion === undefined ? [] : [{ resourceId: plan.resourceId, version: plan.expectedVersion }],
    requiresConfirmation: false, focus: { mode: plan.target, resourceId: plan.resourceId, ...(plan.timerId ? { timerId: plan.timerId } : {}) },
    query: plan.target === 'timer' && plan.timerId ? { target: 'timer', timerId: plan.timerId } : { target: plan.target === 'timer' ? 'timers' : plan.target } };
}

/** Resolve only IDs actually returned by the canonical command; never guess a new/last timer. */
export function resolveVelaTimerExecutionFocus(recipe: VelaTimerExecutionAction, result: TimerCanonicalResult): VelaTimerExecutionFocus | null {
  if (!recipe.focus) return null;
  if (result.name === 'readClock') return { mode: 'clock' };
  if (result.name === 'list') return null;
  const document = result.document, { timerKey, ...focus } = recipe.focus;
  const timerId = timerKey && (result.name === 'create' || result.name === 'mutate') ? result.mutation.createdIds[timerKey] : focus.timerId;
  if (timerId && !document.timers.some(timer => timer.id === timerId)) return { mode: focus.mode, resourceId: document.resource.id };
  return { mode: focus.mode, resourceId: document.resource.id, ...(timerId ? { timerId } : {}) };
}

const duration = (milliseconds: number, rounding: (value: number) => number = Math.ceil) => {
  const seconds = Math.max(0, rounding(milliseconds / 1000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s` :
    seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};
const describeTimer = (timer: TimerView) => `${timer.name}: ${timer.state}, ${duration(timer.remainingMs)} remaining${timer.due && timer.state === 'running' ? ' (due; native completion is pending)' : ''}`;
const describeStopwatch = (document: ClockTimerDocument) => {
  const watch = document.stopwatch;
  return `Stopwatch: ${watch.state}, ${duration(watch.elapsedMs, Math.floor)} elapsed, ${watch.laps.length} ${watch.laps.length === 1 ? 'lap' : 'laps'}`;
};

/** Response text is derived solely from the actual canonical result, never the planned outcome. */
export function describeVelaTimerExecution(recipe: VelaTimerExecutionAction, result: TimerCanonicalResult): string {
  if (result.name === 'readClock') return `${result.clock.timeZone}: ${result.clock.formatted}`;
  const documents: ClockTimerDocument[] = result.name === 'list' ? result.documents : [result.document];
  if (recipe.query?.target === 'timer') {
    const timerId = recipe.query.timerId, timer = documents.flatMap(document => document.timers).find(value => value.id === timerId);
    return timer ? describeTimer(timer) : 'The requested timer is no longer present in the canonical clock document.';
  }
  if (recipe.query?.target === 'timers') {
    const states = recipe.query.states, timers = documents.flatMap(document => document.timers).filter(timer => !states || states.includes(timer.state));
    return timers.length ? timers.map(describeTimer).join('\n') : 'No matching authorized saved timers.';
  }
  if (recipe.query?.target === 'world-clocks') {
    const clocks = documents.flatMap(document => document.worldClocks);
    return clocks.length ? clocks.map(clock => `${clock.label} (${clock.timeZone}): ${clock.formatted}`).join('\n') : 'No authorized saved world clocks.';
  }
  if (recipe.query?.target === 'clock') return documents.map(document => document.localClock.formatted).join('\n');
  if (recipe.query?.target === 'stopwatch') return documents.map(describeStopwatch).join('\n');
  if (result.name === 'create' || result.name === 'mutate') {
    const focus = resolveVelaTimerExecutionFocus(recipe, result);
    if (!result.postconditions.receiptMatchesCurrent) return `That timer command was already applied at version ${result.mutation.version}; the canonical resource is now version ${result.document.resource.version}.`;
    if (focus?.timerId) return describeTimer(result.document.timers.find(timer => timer.id === focus.timerId)!);
    if (focus?.mode === 'stopwatch') return describeStopwatch(result.document);
    return `Updated ${result.document.resource.title} (version ${result.document.resource.version}).`;
  }
  return documents.map(document => document.resource.title).join('\n');
}
