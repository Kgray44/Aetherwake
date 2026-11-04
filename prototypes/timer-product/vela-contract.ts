import { TIMER_LIMITS, type ClockTimerAction } from './contracts.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> => object(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,200}$/u.test(value);
const label = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\x00-\x1f]/u.test(value);
const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const duration = (value: unknown) => version(value) && Number(value) <= TIMER_LIMITS.maxDurationMs;
const key = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value);
const zone = (value: unknown) => { if (!label(value) || /^[+-]/u.test(value)) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } };
const states = ['ready', 'running', 'paused', 'completed', 'cancelled'];
const ids = (value: unknown, max: number) => Array.isArray(value) && value.length <= max && value.every(id) && new Set(value).size === value.length;
function operation(value: unknown): boolean {
  if (!object(value)) return false;
  switch (value.type) {
    case 'createTimer': return fields(value, ['type', 'key', 'name', 'durationMs'], ['start']) && key(value.key) && label(value.name) && duration(value.durationMs) && (value.start === undefined || typeof value.start === 'boolean');
    case 'startTimer': case 'pauseTimer': case 'resumeTimer': case 'resetTimer': case 'cancelTimer': case 'deleteTimer': return fields(value, ['type', 'timerId']) && id(value.timerId);
    case 'extendTimer': case 'shortenTimer': return fields(value, ['type', 'timerId', 'amountMs']) && id(value.timerId) && duration(value.amountMs);
    case 'renameTimer': return fields(value, ['type', 'timerId', 'name']) && id(value.timerId) && label(value.name);
    case 'stopwatchStart': case 'stopwatchPause': case 'stopwatchResume': case 'stopwatchReset': case 'stopwatchLap': return fields(value, ['type']);
    case 'addWorldClock': return fields(value, ['type', 'key', 'timeZone', 'label']) && key(value.key) && zone(value.timeZone) && label(value.label);
    case 'renameWorldClock': return fields(value, ['type', 'clockId', 'label']) && id(value.clockId) && label(value.label);
    case 'removeWorldClock': return fields(value, ['type', 'clockId']) && id(value.clockId);
    case 'acknowledgeExpiry': return fields(value, ['type', 'expiryId']) && id(value.expiryId);
    default: return false;
  }
}
const operations = (value: unknown, minimum: number) => Array.isArray(value) && value.length >= minimum && value.length <= TIMER_LIMITS.operations && value.every(operation);
export function validClockTimerAction(value: unknown): value is ClockTimerAction {
  if (!fields(value, ['type', 'request', 'workspaceId', 'focus', 'query']) || value.type !== 'clockTimer' || !(value.workspaceId === null || id(value.workspaceId)) ||
      !fields(value.request, ['name', 'input']) || !object(value.request.input)) return false;
  const request = value.request, input = request.input as Record<string, unknown>;
  const valid = request.name === 'create' ? fields(input, ['title', 'operations'], ['projectId']) && label(input.title) && operations(input.operations, 0) && (input.projectId === undefined || input.projectId === null || id(input.projectId)) :
    request.name === 'mutate' ? fields(input, ['resourceId', 'expectedVersion', 'operations']) && id(input.resourceId) && version(input.expectedVersion) && operations(input.operations, 1) :
    request.name === 'read' ? fields(input, ['resourceId'], ['expectedVersion']) && id(input.resourceId) && (input.expectedVersion === undefined || version(input.expectedVersion)) :
    request.name === 'list' ? fields(input, ['resourceIds']) && ids(input.resourceIds, TIMER_LIMITS.resources) :
    request.name === 'readClock' ? fields(input, [], ['timeZone']) && (input.timeZone === undefined || zone(input.timeZone)) : false;
  if (!valid || request.name !== 'create' && value.workspaceId !== null) return false;
  if (value.focus !== null && (!fields(value.focus, ['mode', 'timerId', 'timerKey']) || !['timer', 'stopwatch', 'clock'].includes(String(value.focus.mode)) ||
      !(value.focus.timerId === null || id(value.focus.timerId)) || !(value.focus.timerKey === null || key(value.focus.timerKey)) || value.focus.timerId !== null && value.focus.timerKey !== null)) return false;
  if (value.query !== null) {
    if (!object(value.query)) return false;
    const query = value.query;
    if (!(query.target === 'timer' ? fields(query, ['target', 'timerId']) && id(query.timerId) :
      query.target === 'timers' ? fields(query, ['target'], ['states']) && (query.states === undefined || Array.isArray(query.states) && query.states.length <= states.length && query.states.every(state => states.includes(state)) && new Set(query.states).size === query.states.length) :
      ['stopwatch', 'clock', 'world-clocks'].includes(String(query.target)) && fields(query, ['target']))) return false;
  }
  return true;
}
export const clockTimerRequiresReview = (action: ClockTimerAction) => (action.request.name === 'create' || action.request.name === 'mutate') &&
  action.request.input.operations.some(value => value.type === 'deleteTimer' || value.type === 'removeWorldClock');
const string = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[\\w.:-]{1,200}$' };
const text = { type: 'string', minLength: 1, maxLength: 200 };
const integer = { type: 'integer', minimum: 1 };
const amount = { ...integer, maximum: TIMER_LIMITS.maxDurationMs };
const keySchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', minLength: 1, maxLength: 64 };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const schema = (properties: Record<string, unknown>, optional: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(name => !optional.includes(name)) });
const opSchema = (type: string | string[], properties: Record<string, unknown> = {}, optional: string[] = []) => schema({ type: typeof type === 'string' ? { const: type } : { enum: type }, ...properties }, optional);
const operationSchema = { oneOf: [
  opSchema('createTimer', { key: keySchema, name: text, durationMs: amount, start: { type: 'boolean' } }, ['start']),
  opSchema(['startTimer', 'pauseTimer', 'resumeTimer', 'resetTimer', 'cancelTimer', 'deleteTimer'], { timerId: string }),
  opSchema(['extendTimer', 'shortenTimer'], { timerId: string, amountMs: amount }), opSchema('renameTimer', { timerId: string, name: text }),
  opSchema(['stopwatchStart', 'stopwatchPause', 'stopwatchResume', 'stopwatchReset', 'stopwatchLap']),
  opSchema('addWorldClock', { key: keySchema, timeZone: text, label: text }), opSchema('renameWorldClock', { clockId: string, label: text }),
  opSchema('removeWorldClock', { clockId: string }), opSchema('acknowledgeExpiry', { expiryId: string }),
] };
const ops = (minItems: number) => ({ type: 'array', minItems, maxItems: TIMER_LIMITS.operations, items: operationSchema });
export const CLOCK_TIMER_ACTION_PROPERTIES = {
  type: { const: 'clockTimer' }, workspaceId: nullable(string),
  request: { oneOf: [
    schema({ name: { const: 'create' }, input: schema({ title: text, projectId: nullable(string), operations: ops(0) }, ['projectId']) }),
    schema({ name: { const: 'mutate' }, input: schema({ resourceId: string, expectedVersion: integer, operations: ops(1) }) }),
    schema({ name: { const: 'read' }, input: schema({ resourceId: string, expectedVersion: integer }, ['expectedVersion']) }),
    schema({ name: { const: 'list' }, input: schema({ resourceIds: { type: 'array', maxItems: TIMER_LIMITS.resources, uniqueItems: true, items: string } }) }),
    schema({ name: { const: 'readClock' }, input: schema({ timeZone: text }, ['timeZone']) }),
  ] },
  focus: nullable(schema({ mode: { enum: ['timer', 'stopwatch', 'clock'] }, timerId: nullable(string), timerKey: nullable(keySchema) })),
  query: nullable({ oneOf: [schema({ target: { const: 'timer' }, timerId: string }), schema({ target: { enum: ['stopwatch', 'clock', 'world-clocks'] } }),
    schema({ target: { const: 'timers' }, states: { type: 'array', uniqueItems: true, maxItems: 5, items: { enum: states } } }, ['states'])] }),
};
