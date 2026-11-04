import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { CLOCK_TIMER_CONTRACT, TIMER_LIMITS as L, type ClockTimerDocument, type ClockTimerResource,
  type CreateClockTimer, type CreateClockTimerWithOperations, type MutateClockTimer, type StopwatchLap, type TimerClockReading, type TimerDomainEvent,
  type TimerExpiry, type TimerHostPort, type TimerMutationResult, type TimerOperation, type TimerReconcileResult,
  type TimerState, type TimerTiming, type TimerView, type TimerWake } from './contracts.ts';

interface Anchor { epochMs: number; monotonicMs: number; sessionId: string }
interface StoredTimer {
  id: string; version: number; name: string; state: TimerState; durationMs: number; remainingMs: number;
  runId: string; anchor: Anchor | null; deadlineEpochMs: number | null; wallRecovery: boolean;
}
interface StoredStopwatch {
  state: 'ready' | 'running' | 'paused'; elapsedMs: number; runId: string; anchor: Anchor | null;
  wallRecovery: boolean; laps: StopwatchLap[];
}
interface StoredBody {
  schemaVersion: 1;
  timers: StoredTimer[];
  stopwatch: StoredStopwatch;
  worldClocks: { id: string; timeZone: string; label: string }[];
}
export class TimerError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'TimerError'; this.code = code; }
}
function check(condition: unknown, code = 'invalid_timer_input'): asserts condition {
  if (!condition) throw new TimerError(code);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,200}$/u.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 &&
  Buffer.byteLength(value) <= 256 && !/[\x00-\x1f]/u.test(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const duration = (value: unknown): value is number => version(value) && value <= L.maxDurationMs;
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  check(record(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const anchor = (clock: TimerClockReading): Anchor => ({ epochMs: clock.epochMs, monotonicMs: clock.monotonicMs, sessionId: clock.sessionId });
const freshStopwatch = (): StoredStopwatch => ({ state: 'ready', elapsedMs: 0, runId: randomUUID(), anchor: null, wallRecovery: false, laps: [] });
function zone(timeZone: unknown): string {
  check(text(timeZone) && !/^[+-]/u.test(timeZone), 'invalid_timer_time_zone');
  try { return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone; }
  catch { throw new TimerError('invalid_timer_time_zone'); }
}
function validAnchor(value: unknown): value is Anchor {
  return record(value) && Number.isSafeInteger(value.epochMs) && number(value.monotonicMs) && id(value.sessionId);
}
function elapsed(value: Anchor | null, clock: TimerClockReading, recovered: boolean): { delta: number; timing: TimerTiming } {
  if (!value) return { delta: 0, timing: { basis: 'held', wallRecovery: recovered, clockAdjusted: false } };
  const comparable = value.sessionId === clock.sessionId && clock.monotonicMs >= value.monotonicMs;
  const wallDelta = clock.epochMs - value.epochMs;
  const delta = Math.max(0, comparable ? clock.monotonicMs - value.monotonicMs : wallDelta);
  return { delta, timing: { basis: comparable ? 'monotonic' : 'wall-recovery', wallRecovery: recovered || !comparable,
    clockAdjusted: comparable && Math.abs(wallDelta - delta) > L.clockDriftToleranceMs } };
}
function timerView(timer: StoredTimer, clock: TimerClockReading): TimerView {
  const { delta, timing } = elapsed(timer.anchor, clock, timer.wallRecovery);
  const remainingMs = Math.max(0, timer.remainingMs - delta);
  return { id: timer.id, version: timer.version, name: timer.name, state: timer.state, durationMs: timer.durationMs,
    remainingMs, runId: timer.runId, deadlineEpochMs: timer.state === 'running' ? clock.epochMs + remainingMs : null,
    due: timer.state === 'running' && remainingMs === 0, timing };
}
function stopwatchView(watch: StoredStopwatch, clock: TimerClockReading) {
  const { delta, timing } = elapsed(watch.anchor, clock, watch.wallRecovery);
  check(number(watch.elapsedMs + delta), 'timer_clock_out_of_range');
  return { state: watch.state, elapsedMs: watch.elapsedMs + delta, runId: watch.runId, laps: watch.laps, timing };
}

/** Canonical domain only. The native host owns its single wake signal and notification delivery. */
export class TimerService {
  private readonly host: TimerHostPort;
  constructor(kernel: WorkspaceKernel, host: TimerHostPort) {
    kernel.withTransaction(db => check(db === host.db, 'canonical_timer_connection_required'));
    this.host = host;
    host.atomic(() => {
      host.db.exec(`CREATE TABLE IF NOT EXISTS timer_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS timer_documents(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS timer_receipts(command_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,result_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS timer_expiries(id TEXT NOT NULL UNIQUE,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
          timer_id TEXT NOT NULL,run_id TEXT NOT NULL,expired_at TEXT NOT NULL,wall_recovery INTEGER NOT NULL,acknowledged_at TEXT,
          PRIMARY KEY(timer_id,run_id));`);
      const rows = host.db.prepare('SELECT version FROM timer_schema').all();
      if (!rows.length) host.db.prepare('INSERT INTO timer_schema VALUES(1)').run();
      else check(rows.length === 1 && rows[0].version === 1, 'unsupported_timer_schema');
    });
  }
  private clock(): TimerClockReading {
    const sample = this.host.clock();
    check(sample && Number.isSafeInteger(sample.epochMs) && Math.abs(sample.epochMs) <= 8.64e15 &&
      number(sample.monotonicMs) && id(sample.sessionId) && text(sample.locale), 'invalid_timer_clock');
    const timeZone = zone(sample.timeZone);
    try { new Intl.DateTimeFormat(sample.locale).format(sample.epochMs); }
    catch { throw new TimerError('invalid_timer_clock'); }
    return { ...sample, timeZone };
  }
  private resource(resourceId: string, write = false): ClockTimerResource {
    check(id(resourceId));
    const entry = this.host.readResource(resourceId);
    check(entry?.authorized === true && entry.resource.id === resourceId && entry.resource.kind === 'clock_timer' &&
      entry.resource.state === 'active', 'timer_unavailable');
    check(!write || entry.writable === true, 'timer_read_only');
    const canonical = this.host.db.prepare('SELECT kind,title,version,state,project_id FROM resources WHERE id=?').get(resourceId);
    check(canonical?.kind === 'generic' && canonical.title === entry.resource.title && canonical.version === entry.resource.version &&
      canonical.state === entry.resource.state && canonical.project_id === entry.resource.projectId, 'canonical_timer_resource_required');
    return entry.resource;
  }
  private body(resourceId: string): StoredBody {
    const json = this.host.db.prepare('SELECT json FROM timer_documents WHERE resource_id=?').get(resourceId)?.json;
    check(typeof json === 'string' && Buffer.byteLength(json) <= L.documentBytes, 'timer_unavailable');
    let body: StoredBody;
    try { body = JSON.parse(json) as StoredBody; } catch { throw new TimerError('corrupt_timer_document'); }
    check(body?.schemaVersion === 1 && Array.isArray(body.timers) && body.timers.length <= L.timersPerResource &&
      Array.isArray(body.worldClocks) && body.worldClocks.length <= L.worldClocks, 'corrupt_timer_document');
    const ids = new Set<string>();
    for (const timer of body.timers) {
      check(timer && id(timer.id) && !ids.has(timer.id) && version(timer.version) && text(timer.name) && duration(timer.durationMs) &&
        number(timer.remainingMs) && timer.remainingMs <= timer.durationMs && id(timer.runId) && typeof timer.wallRecovery === 'boolean' &&
        ['ready', 'running', 'paused', 'completed', 'cancelled'].includes(timer.state) &&
        (timer.state === 'running' ? validAnchor(timer.anchor) && typeof timer.deadlineEpochMs === 'number' &&
          Number.isFinite(timer.deadlineEpochMs) && Math.abs(timer.deadlineEpochMs) <= 8.64e15 :
          timer.anchor === null && timer.deadlineEpochMs === null), 'corrupt_timer_document');
      ids.add(timer.id);
    }
    const watch = body.stopwatch;
    check(watch && ['ready', 'running', 'paused'].includes(watch.state) && id(watch.runId) && number(watch.elapsedMs) &&
      typeof watch.wallRecovery === 'boolean' && (watch.state === 'running' ? validAnchor(watch.anchor) : watch.anchor === null) &&
      Array.isArray(watch.laps) && watch.laps.length <= L.laps, 'corrupt_timer_document');
    let previous = 0;
    for (const [index, lap] of watch.laps.entries()) {
      check(lap && id(lap.id) && !ids.has(lap.id) && lap.number === index + 1 && number(lap.elapsedMs) &&
        lap.elapsedMs >= previous && lap.splitMs === lap.elapsedMs - previous && typeof lap.wallRecovery === 'boolean' &&
        typeof lap.recordedAt === 'string' && Number.isFinite(Date.parse(lap.recordedAt)), 'corrupt_timer_document');
      ids.add(lap.id); previous = lap.elapsedMs;
    }
    const zones = new Set<string>();
    for (const item of body.worldClocks) {
      check(item && id(item.id) && !ids.has(item.id) && text(item.label) && zone(item.timeZone) === item.timeZone &&
        !zones.has(item.timeZone), 'corrupt_timer_document');
      ids.add(item.id); zones.add(item.timeZone);
    }
    return body;
  }
  private save(resourceId: string, body: StoredBody) {
    const json = JSON.stringify(body);
    check(Buffer.byteLength(json) <= L.documentBytes, 'timer_document_capacity');
    this.host.db.prepare('UPDATE timer_documents SET json=? WHERE resource_id=?').run(json, resourceId);
  }
  private once(commandId: string, input: unknown, resourceId: string | null, work: () => TimerMutationResult): TimerMutationResult {
    check(id(commandId));
    const fingerprint = hash(input), previous = this.host.db.prepare('SELECT * FROM timer_receipts WHERE command_id=?').get(commandId);
    if (previous) {
      check(previous.fingerprint === fingerprint && (resourceId === null || previous.resource_id === resourceId), 'timer_command_conflict');
      this.resource(String(previous.resource_id), true);
      return JSON.parse(String(previous.result_json)) as TimerMutationResult;
    }
    check(Number(this.host.db.prepare('SELECT count(*) AS n FROM timer_receipts').get()!.n) < L.receipts, 'timer_receipt_capacity');
    const result = work();
    this.host.db.prepare('INSERT INTO timer_receipts VALUES(?,?,?,?)').run(commandId, fingerprint, result.resourceId, JSON.stringify(result));
    return result;
  }
  private persist(resource: ClockTimerResource, body: StoredBody, type: TimerDomainEvent['type'], commandId: string | null,
    timerIds: string[], expiries: TimerExpiry[], operations: string[]): ClockTimerResource {
    this.save(resource.id, body);
    const updated = this.host.touchResource({ resourceId: resource.id, expectedVersion: resource.version });
    check(updated.id === resource.id && updated.version === resource.version + 1, 'canonical_timer_version_required');
    this.resource(updated.id, true);
    this.host.recordEvent({ type, resourceId: resource.id, resourceVersion: updated.version, commandId,
      timerIds: [...new Set(timerIds)], expiryIds: expiries.map(expiry => expiry.id), operations });
    return updated;
  }
  private expire(resourceId: string, timer: StoredTimer, clock: TimerClockReading): TimerExpiry {
    const previous = this.host.db.prepare('SELECT * FROM timer_expiries WHERE timer_id=? AND run_id=?').get(timer.id, timer.runId);
    check(!previous, 'timer_expiry_state_conflict');
    check(Number(this.host.db.prepare('SELECT count(*) AS n FROM timer_expiries').get()!.n) < L.expiries, 'timer_expiry_capacity');
    const expiry: TimerExpiry = { id: randomUUID(), timerId: timer.id, runId: timer.runId,
      expiredAt: new Date(clock.epochMs).toISOString(), wallRecovery: timer.wallRecovery };
    this.host.db.prepare('INSERT INTO timer_expiries VALUES(?,?,?,?,?,?,NULL)').run(expiry.id, resourceId, expiry.timerId,
      expiry.runId, expiry.expiredAt, Number(expiry.wallRecovery));
    timer.state = 'completed'; timer.remainingMs = 0; timer.anchor = null; timer.deadlineEpochMs = null; timer.version++;
    return expiry;
  }
  private reconcileBody(resourceId: string, body: StoredBody, clock: TimerClockReading) {
    const changed = new Set<string>(), expiries: TimerExpiry[] = [];
    for (const timer of body.timers) if (timer.state === 'running') {
      const current = timerView(timer, clock);
      if (current.timing.basis === 'wall-recovery' || current.timing.clockAdjusted || current.due) {
        timer.remainingMs = current.remainingMs; timer.wallRecovery = current.timing.wallRecovery;
        timer.anchor = anchor(clock); timer.deadlineEpochMs = clock.epochMs + timer.remainingMs;
        if (current.due) expiries.push(this.expire(resourceId, timer, clock));
        else timer.version++;
        changed.add(timer.id);
      }
    }
    const watch = stopwatchView(body.stopwatch, clock);
    const watchChanged = body.stopwatch.state === 'running' && (watch.timing.basis === 'wall-recovery' || watch.timing.clockAdjusted);
    if (watchChanged) {
      body.stopwatch.elapsedMs = watch.elapsedMs; body.stopwatch.anchor = anchor(clock);
      body.stopwatch.wallRecovery = watch.timing.wallRecovery;
    }
    return { timerIds: [...changed], expiries, changed: changed.size > 0 || watchChanged };
  }
  create(input: CreateClockTimer): TimerMutationResult {
    fields(input, ['commandId', 'title'], ['projectId']);
    check(id(input.commandId) && text(input.title) && (input.projectId === undefined || input.projectId === null || id(input.projectId)));
    return this.host.atomic(() => this.once(input.commandId, { operation: 'create', input }, null, () => {
      check(Number(this.host.db.prepare('SELECT count(*) AS n FROM timer_documents').get()!.n) < L.resources, 'timer_resource_capacity');
      const previousRow = Number(this.host.db.prepare('SELECT coalesce(max(rowid),0) AS n FROM resources').get()!.n);
      const resource = this.host.createResource({ kind: 'clock_timer', title: input.title, projectId: input.projectId ?? null });
      this.resource(resource.id, true);
      const canonical = this.host.db.prepare('SELECT rowid FROM resources WHERE id=?').get(resource.id);
      check(Number(canonical?.rowid) > previousRow && resource.version === 1 && resource.title === input.title &&
        resource.projectId === (input.projectId ?? null) && !this.host.db.prepare('SELECT 1 FROM notes WHERE resource_id=?').get(resource.id),
        'canonical_timer_factory_required');
      const body: StoredBody = { schemaVersion: 1, timers: [], stopwatch: freshStopwatch(), worldClocks: [] };
      this.host.db.prepare('INSERT INTO timer_documents VALUES(?,?)').run(resource.id, JSON.stringify(body));
      this.host.recordEvent({ type: 'clock_timer.created', resourceId: resource.id, resourceVersion: resource.version,
        commandId: input.commandId, timerIds: [], expiryIds: [], operations: ['create'] });
      return { resourceId: resource.id, version: resource.version, createdIds: {}, expiries: [] };
    }));
  }
  /** Compose creation and initial operations in the SAME owning transaction and replay identity. */
  createWithOperations(input: CreateClockTimerWithOperations): TimerMutationResult {
    fields(input, ['commandId', 'title', 'operations'], ['projectId']);
    check(id(input.commandId) && text(input.title) && (input.projectId === undefined || input.projectId === null || id(input.projectId)) &&
      Array.isArray(input.operations) && input.operations.length <= L.operations);
    return this.host.atomic(() => this.once(input.commandId, { operation: 'createWithOperations', input }, null, () => {
      const created = this.create({ commandId: 'timer:create:' + hash(input.commandId), title: input.title,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}) });
      return input.operations.length ? this.mutate({ commandId: 'timer:initial:' + hash(input.commandId), resourceId: created.resourceId,
        expectedVersion: created.version, operations: input.operations }) : created;
    }));
  }
  read(resourceId: string): ClockTimerDocument {
    return this.host.atomic(() => {
      const resource = this.resource(resourceId), body = this.body(resource.id), clock = this.clock();
      const format = (timeZone: string) => new Intl.DateTimeFormat(clock.locale, { timeZone, hour: 'numeric', minute: '2-digit',
        second: '2-digit', year: 'numeric', month: 'short', day: 'numeric', timeZoneName: 'short' }).format(clock.epochMs);
      const pending = this.host.db.prepare(`SELECT * FROM timer_expiries WHERE resource_id=? AND acknowledged_at IS NULL
        ORDER BY expired_at,id LIMIT ?`).all(resource.id, L.timersPerResource);
      return { contract: CLOCK_TIMER_CONTRACT, resource, canEdit: this.host.readResource(resource.id)!.writable,
        sampledAt: new Date(clock.epochMs).toISOString(), localClock: { epochMs: clock.epochMs, timeZone: clock.timeZone, locale: clock.locale,
          formatted: format(clock.timeZone) }, timers: body.timers.map(timer => timerView(timer, clock)),
        stopwatch: stopwatchView(body.stopwatch, clock), worldClocks: body.worldClocks.map(item => ({ ...item, formatted: format(item.timeZone) })),
        pendingExpiries: pending.map(row => ({ id: String(row.id), timerId: String(row.timer_id), runId: String(row.run_id),
          expiredAt: String(row.expired_at), wallRecovery: row.wall_recovery === 1 })) };
    });
  }
  list(): ClockTimerResource[] {
    return this.host.atomic(() => this.resources());
  }
  private resources() {
    const rows = this.host.db.prepare('SELECT resource_id FROM timer_documents ORDER BY resource_id LIMIT ?').all(L.resources + 1);
    check(rows.length <= L.resources, 'timer_resource_capacity');
    return rows.flatMap(row => {
      const entry = this.host.readResource(String(row.resource_id));
      return entry?.authorized && entry.resource.kind === 'clock_timer' && entry.resource.state === 'active' ? [this.resource(entry.resource.id)] : [];
    });
  }
  nextWake(): TimerWake | null {
    return this.host.atomic(() => {
      const clock = this.clock();
      let next: TimerWake | null = null;
      for (const resource of this.resources()) {
        if (!this.host.readResource(resource.id)!.writable) continue;
        for (const timer of this.body(resource.id).timers) if (timer.state === 'running') {
          const current = timerView(timer, clock);
          const wake = { resourceId: resource.id, timerId: timer.id, runId: timer.runId, timerVersion: timer.version,
            delayMs: Math.min(current.remainingMs, L.maxWakeDelayMs), deadlineEpochMs: clock.epochMs + current.remainingMs };
          if (!next || wake.deadlineEpochMs < next.deadlineEpochMs) next = wake;
        }
      }
      return next;
    });
  }
  reconcile(resourceId: string, wake?: TimerWake): TimerReconcileResult {
    return this.host.atomic(() => {
      const resource = this.resource(resourceId, true), body = this.body(resource.id);
      if (wake) {
        const timer = body.timers.find(item => item.id === wake.timerId);
        if (wake.resourceId !== resource.id || timer?.runId !== wake.runId || timer.version !== wake.timerVersion || timer.state !== 'running')
          return { resourceId, version: resource.version, changed: false, expiries: [] };
      }
      const result = this.reconcileBody(resourceId, body, this.clock());
      const updated = result.changed ? this.persist(resource, body, result.expiries.length ? 'clock_timer.expired' : 'clock_timer.reconciled',
        null, result.timerIds, result.expiries, ['reconcile']) : resource;
      return { resourceId, version: updated.version, changed: result.changed, expiries: result.expiries };
    });
  }
  mutate(input: MutateClockTimer): TimerMutationResult {
    fields(input, ['commandId', 'resourceId', 'expectedVersion', 'operations']);
    check(id(input.commandId) && id(input.resourceId) && version(input.expectedVersion) && Array.isArray(input.operations) &&
      input.operations.length > 0 && input.operations.length <= L.operations);
    return this.host.atomic(() => this.once(input.commandId, { operation: 'mutate', input }, input.resourceId, () => {
      const resource = this.resource(input.resourceId, true);
      check(resource.version === input.expectedVersion, 'timer_version_conflict');
      const body = this.body(resource.id), clock = this.clock(), reconciliation = this.reconcileBody(resource.id, body, clock);
      const createdIds: Record<string, string> = {}, timerIds = [...reconciliation.timerIds], expiries = [...reconciliation.expiries];
      const created = (key: string, value: string) => {
        check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(key) && !Object.hasOwn(createdIds, key));
        createdIds[key] = value;
      };
      for (const operation of input.operations) {
        check(record(operation) && typeof operation.type === 'string');
        if (operation.type === 'createTimer') {
          fields(operation, ['type', 'key', 'name', 'durationMs'], ['start']);
          check(text(operation.name) && duration(operation.durationMs) && (operation.start === undefined || typeof operation.start === 'boolean'));
          check(body.timers.length < L.timersPerResource && Number(this.host.db.prepare("SELECT coalesce(sum(json_array_length(json,'$.timers')),0) AS n FROM timer_documents").get()!.n) + body.timers.length - this.body(resource.id).timers.length < L.timers, 'timer_capacity');
          const timer: StoredTimer = { id: randomUUID(), version: 1, name: operation.name, state: operation.start ? 'running' : 'ready',
            durationMs: operation.durationMs, remainingMs: operation.durationMs, runId: randomUUID(), wallRecovery: false,
            anchor: operation.start ? anchor(clock) : null, deadlineEpochMs: operation.start ? clock.epochMs + operation.durationMs : null };
          body.timers.push(timer); created(operation.key, timer.id); timerIds.push(timer.id);
        } else if ('timerId' in operation) {
          const timer = body.timers.find(item => item.id === operation.timerId);
          check(timer, 'timer_not_found');
          this.timerOperation(resource.id, timer, operation, clock, expiries);
          if (operation.type === 'deleteTimer') body.timers = body.timers.filter(item => item !== timer);
          timerIds.push(timer.id);
        } else if (operation.type.startsWith('stopwatch')) {
          fields(operation, ['type']);
          this.stopwatchOperation(body.stopwatch, operation.type, clock);
        } else if (operation.type === 'addWorldClock') {
          fields(operation, ['type', 'key', 'timeZone', 'label']); check(text(operation.label));
          const timeZone = zone(operation.timeZone);
          check(body.worldClocks.length < L.worldClocks && !body.worldClocks.some(item => item.timeZone === timeZone), 'timer_world_clock_capacity');
          const item = { id: randomUUID(), timeZone, label: operation.label };
          body.worldClocks.push(item); created(operation.key, item.id);
        } else if (operation.type === 'renameWorldClock' || operation.type === 'removeWorldClock') {
          fields(operation, ['type', 'clockId'], operation.type === 'renameWorldClock' ? ['label'] : []);
          const item = body.worldClocks.find(item => item.id === operation.clockId); check(item, 'timer_world_clock_unavailable');
          if (operation.type === 'renameWorldClock') { check(text(operation.label)); item.label = operation.label; }
          else body.worldClocks = body.worldClocks.filter(value => value !== item);
        } else if (operation.type === 'acknowledgeExpiry') {
          fields(operation, ['type', 'expiryId']); check(id(operation.expiryId));
          check(this.host.db.prepare('SELECT 1 FROM timer_expiries WHERE id=? AND resource_id=?').get(operation.expiryId, resource.id), 'timer_expiry_unavailable');
          this.host.db.prepare('UPDATE timer_expiries SET acknowledged_at=coalesce(acknowledged_at,?) WHERE id=? AND resource_id=?')
            .run(new Date(clock.epochMs).toISOString(), operation.expiryId, resource.id);
        } else throw new TimerError('invalid_timer_operation');
      }
      const updated = this.persist(resource, body, 'clock_timer.changed', input.commandId, timerIds, expiries, input.operations.map(item => item.type));
      return { resourceId: resource.id, version: updated.version, createdIds, expiries };
    }));
  }
  private timerOperation(resourceId: string, timer: StoredTimer, operation: TimerOperation & { timerId: string }, clock: TimerClockReading,
    expiries: TimerExpiry[]) {
    const adjusted = operation.type === 'extendTimer' || operation.type === 'shortenTimer';
    fields(operation, ['type', 'timerId'], adjusted ? ['amountMs'] : operation.type === 'renameTimer' ? ['name'] : []);
    const current = timerView(timer, clock);
    timer.remainingMs = current.remainingMs; timer.wallRecovery = current.timing.wallRecovery;
    if (timer.state === 'running') { timer.anchor = anchor(clock); timer.deadlineEpochMs = clock.epochMs + timer.remainingMs; }
    switch (operation.type) {
      case 'startTimer': check(timer.state === 'ready', 'timer_invalid_transition'); timer.state = 'running'; timer.runId = randomUUID(); break;
      case 'resumeTimer': check(timer.state === 'paused', 'timer_invalid_transition'); timer.state = 'running'; break;
      case 'pauseTimer': check(timer.state === 'running', 'timer_invalid_transition'); timer.state = 'paused'; break;
      case 'resetTimer': timer.state = 'ready'; timer.remainingMs = timer.durationMs; timer.runId = randomUUID(); timer.wallRecovery = false; break;
      case 'cancelTimer': timer.state = 'cancelled'; timer.runId = randomUUID(); break;
      case 'deleteTimer': break;
      case 'renameTimer': check(text(operation.name)); timer.name = operation.name; break;
      case 'extendTimer': case 'shortenTimer': {
        check(['ready', 'running', 'paused'].includes(timer.state), 'timer_invalid_transition');
        check(duration(operation.amountMs));
        const delta = operation.type === 'extendTimer' ? operation.amountMs : -operation.amountMs;
        check(duration(timer.durationMs + delta), 'invalid_timer_duration');
        timer.durationMs += delta; timer.remainingMs = Math.max(0, timer.remainingMs + delta);
        if (!timer.remainingMs) expiries.push(this.expire(resourceId, timer, clock));
        break;
      }
      default: throw new TimerError('invalid_timer_operation');
    }
    timer.version++;
    timer.anchor = timer.state === 'running' ? anchor(clock) : null;
    timer.deadlineEpochMs = timer.state === 'running' ? clock.epochMs + timer.remainingMs : null;
  }
  private stopwatchOperation(watch: StoredStopwatch, type: string, clock: TimerClockReading) {
    const current = stopwatchView(watch, clock);
    watch.elapsedMs = current.elapsedMs; watch.wallRecovery = current.timing.wallRecovery;
    switch (type) {
      case 'stopwatchStart': check(watch.state === 'ready', 'timer_invalid_transition'); watch.state = 'running'; break;
      case 'stopwatchPause': check(watch.state === 'running', 'timer_invalid_transition'); watch.state = 'paused'; break;
      case 'stopwatchResume': check(watch.state === 'paused', 'timer_invalid_transition'); watch.state = 'running'; break;
      case 'stopwatchReset': Object.assign(watch, freshStopwatch()); break;
      case 'stopwatchLap': {
        check(watch.state === 'running', 'timer_invalid_transition'); check(watch.laps.length < L.laps, 'timer_lap_capacity');
        watch.laps.push({ id: randomUUID(), number: watch.laps.length + 1, elapsedMs: watch.elapsedMs,
          splitMs: watch.elapsedMs - (watch.laps.at(-1)?.elapsedMs ?? 0), recordedAt: new Date(clock.epochMs).toISOString(),
          wallRecovery: watch.wallRecovery });
        break;
      }
      default: throw new TimerError('invalid_timer_operation');
    }
    watch.anchor = watch.state === 'running' ? anchor(clock) : null;
  }
}
