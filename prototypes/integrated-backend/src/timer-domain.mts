import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { TimerService } from '../../timer-product/service.mts';
import { TIMER_LIMITS, type ClockTimerResource, type CreateClockTimer, type MutateClockTimer, type ClockTimerDocument,
  type TimerExpiry, type TimerHostPort, type TimerMutationResult, type TimerReconcileResult, type TimerWake } from '../../timer-product/contracts.ts';
import { createTrustedTimerClock, type TrustedTimerClockPort } from './timer-clock.mts';
import type { TimerCanonicalRequest } from '../../timer-product/contracts.ts';
export type { TimerCanonicalRequest } from '../../timer-product/contracts.ts';

type Command<I, O> = { input: I; output: O };
export interface ClockTimerCommandMap {
  create: Command<CreateClockTimer, TimerMutationResult>;
  read: Command<{ resourceId: string }, ClockTimerDocument>;
  mutate: Command<MutateClockTimer, TimerMutationResult>;
  list: Command<Record<string, never>, ClockTimerResource[]>;
}
export type ClockTimerRequest = { [K in keyof ClockTimerCommandMap]: { name: K; input: ClockTimerCommandMap[K]['input'] } }[keyof ClockTimerCommandMap];
export type ClockTimerResponse = ClockTimerCommandMap[keyof ClockTimerCommandMap]['output'];
/** Serializable recipe; preparation has no mutations, reconciliation, delivery, or scheduling effects. */
export interface TimerCanonicalOperationIds { timerIds: string[]; clockIds: string[]; expiryIds: string[] }
export interface TimerCanonicalMutationResult {
  name: 'create' | 'mutate'; mutation: TimerMutationResult; document: ClockTimerDocument;
  operationIds: TimerCanonicalOperationIds;
  /** Historical idempotent receipts can precede the current canonical version. Never claim otherwise. */
  postconditions: { canonicalDocumentBound: true; receiptVersion: number; observedVersion: number; receiptMatchesCurrent: boolean };
}
export type TimerCanonicalResult = TimerCanonicalMutationResult
  | { name: 'read'; document: ClockTimerDocument }
  | { name: 'list'; documents: ClockTimerDocument[] }
  | { name: 'readClock'; sampledAt: string; clock: ClockTimerDocument['localClock'] };
export interface TimerCanonicalPreparationOptions {
  signal: AbortSignal;
  /** Host-issued action authority/policy must be checked again here, synchronously at commit. */
  validate?(): void;
}
export interface TimerDeliveryReceipt { delivered: true; deliveryId: string; receiptId: string }
export interface TimerDeliveryInput { deliveryId: string; resource: ClockTimerResource; expiry: TimerExpiry; signal: AbortSignal }
export interface TimerDomainScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface TimerDomainOptions {
  kernel: WorkspaceKernel;
  host: Omit<TimerHostPort, 'clock'>;
  clock?: TrustedTimerClockPort;
  /** Must be idempotent by deliveryId. A receipt means accepted by the native delivery system, not user attention. */
  deliverExpiry?(input: TimerDeliveryInput): Promise<TimerDeliveryReceipt | null> | TimerDeliveryReceipt | null;
  deliveryTimeoutMs?: number;
  scheduler?: TimerDomainScheduler;
  onError?(input: { phase: 'startup' | 'command' | 'wake' | 'reconcile' | 'resume' | 'delivery'; code: string }): void;
}
export class TimerDomainError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'TimerDomainError'; this.code = code; }
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w.:-]{1,200}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const schedulerDefault: TimerDomainScheduler = {
  setTimeout(callback, delayMs) { const handle = setTimeout(callback, delayMs); handle.unref(); return handle; },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

/** One native scheduling owner over the canonical timer service. UI visibility never controls timer lifetime. */
export class TimerDomain {
  readonly ready: Promise<void>;
  private readonly options: TimerDomainOptions;
  private readonly clock: TrustedTimerClockPort;
  private readonly service: TimerService;
  private readonly scheduler: TimerDomainScheduler;
  private readonly deliveryTimeoutMs: number;
  private tail: Promise<unknown> = Promise.resolve();
  private handle: unknown = null;
  private scheduleGeneration = 0;
  private disposed = false;
  private resumePending: Promise<void> | null = null;
  private deliveryAbort: AbortController | null = null;
  private readonly deliveryBacklog = new Set<string>();
  private readonly deliveryBlocked = new Set<string>();
  private lastError: string | null = null;
  private canonicalRefreshQueued = false;

  constructor(options: TimerDomainOptions) {
    this.options = options; this.clock = options.clock ?? createTrustedTimerClock(); this.scheduler = options.scheduler ?? schedulerDefault;
    this.deliveryTimeoutMs = options.deliveryTimeoutMs ?? 2000;
    if (!Number.isSafeInteger(this.deliveryTimeoutMs) || this.deliveryTimeoutMs < 50 || this.deliveryTimeoutMs > 10000)
      throw new TimerDomainError('invalid_timer_delivery_timeout');
    this.service = new TimerService(options.kernel, { ...options.host, clock: () => this.clock.read() });
    options.host.atomic(() => {
      options.host.db.exec(`CREATE TABLE IF NOT EXISTS timer_delivery_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS timer_delivery_receipts(expiry_id TEXT PRIMARY KEY REFERENCES timer_expiries(id) ON DELETE CASCADE,
          delivery_id TEXT NOT NULL UNIQUE,receipt_id TEXT NOT NULL,received_at TEXT NOT NULL);`);
      const rows = options.host.db.prepare('SELECT version FROM timer_delivery_schema').all();
      if (!rows.length) options.host.db.prepare('INSERT INTO timer_delivery_schema VALUES(1)').run();
      else if (rows.length !== 1 || rows[0].version !== 1) throw new TimerDomainError('unsupported_timer_delivery_schema');
    });
    this.ready = this.enqueue(async () => {
      try { await this.clock.ready(); if (this.disposed) return; await this.recoverAll(false); this.arm(); }
      catch (error) { this.report('startup', error); throw error; }
    });
    // Native startup may await ready; an unobserved failure still has a bounded diagnostic and no retry loop.
    void this.ready.catch(() => {});
  }
  private report(phase: Parameters<NonNullable<TimerDomainOptions['onError']>>[0]['phase'], error: unknown) {
    const raw = object(error) && typeof error.code === 'string' ? error.code : error instanceof Error ? error.message : '';
    const code = /^[\w:-]{1,120}$/u.test(raw) ? raw : 'timer_domain_operation_failed';
    this.lastError = code;
    try { this.options.onError?.({ phase, code }); } catch { /* Diagnostics cannot undo committed timer state. */ }
  }
  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    if (this.disposed) return Promise.reject(new TimerDomainError('timer_domain_disposed'));
    const result = this.tail.then(async () => {
      if (this.disposed) throw new TimerDomainError('timer_domain_disposed');
      return work();
    });
    this.tail = result.catch(() => {}); return result;
  }
  private clearWake() {
    this.scheduleGeneration++;
    if (this.handle !== null) { this.scheduler.clearTimeout(this.handle); this.handle = null; }
  }
  private arm() {
    this.clearWake(); if (this.disposed) return;
    let wake: TimerWake | null;
    try { wake = this.service.nextWake(); } catch (error) { this.report('wake', error); return; }
    const backlogId = this.deliveryBacklog.values().next().value as string | undefined;
    if (!wake && !backlogId) return;
    const deliverBacklog = !!backlogId && (!wake || wake.delayMs > 1000);
    const generation = this.scheduleGeneration, captured = deliverBacklog ? null : wake;
    const resourceId = deliverBacklog ? backlogId! : wake!.resourceId;
    this.handle = this.scheduler.setTimeout(() => {
      if (this.disposed || generation !== this.scheduleGeneration) return;
      this.handle = null;
      void this.enqueue(async () => {
        if (generation !== this.scheduleGeneration) return;
        try { this.service.reconcile(resourceId, captured ?? undefined); await this.drain(resourceId, { remaining: 16 }); }
        catch (error) { this.report('wake', error); }
        finally { this.arm(); }
      }).catch(error => { if (!this.disposed) this.report('wake', error); });
    }, captured ? Math.max(1, Math.min(TIMER_LIMITS.maxWakeDelayMs, Math.ceil(captured.delayMs))) : 1000);
  }
  private async recoverAll(deliver = true): Promise<TimerReconcileResult[]> {
    const results: TimerReconcileResult[] = [];
    const budget = { remaining: 16 };
    for (const resource of this.service.list()) {
      if (this.disposed) break;
      try {
        if (this.options.host.readResource(resource.id)?.writable !== true) continue;
        results.push(this.service.reconcile(resource.id));
        if (deliver) await this.drain(resource.id, budget);
        else if (this.options.deliverExpiry && this.service.read(resource.id).pendingExpiries.length) this.deliveryBacklog.add(resource.id);
      } catch (error) { this.report('reconcile', error); }
    }
    return results;
  }
  private async deliver(input: Omit<TimerDeliveryInput, 'signal'>): Promise<TimerDeliveryReceipt | null> {
    if (!this.options.deliverExpiry || this.disposed) return null;
    const controller = new AbortController(); this.deliveryAbort = controller;
    const deadline = AbortSignal.timeout(this.deliveryTimeoutMs);
    const stop = () => controller.abort(); deadline.addEventListener('abort', stop, { once: true });
    const aborted = new Promise<null>(resolve => controller.signal.addEventListener('abort', () => resolve(null), { once: true }));
    try {
      const result = await Promise.race([Promise.resolve().then(() => this.disposed ? null : this.options.deliverExpiry!({ ...input, signal: controller.signal })), aborted]);
      if (deadline.aborted && !this.disposed) throw new TimerDomainError('timer_delivery_timeout');
      return result;
    } finally { deadline.removeEventListener('abort', stop); if (this.deliveryAbort === controller) this.deliveryAbort = null; }
  }
  private async drain(resourceId: string, budget: { remaining: number }): Promise<void> {
    this.deliveryBacklog.delete(resourceId);
    if (!this.options.deliverExpiry || this.disposed) return;
    // Bounded delivery batches share the one wake handle. Denied/failed IDs wait for an explicit trigger.
    while (budget.remaining > 0) {
      if (this.disposed) return;
      let document: ClockTimerDocument;
      try { document = this.service.read(resourceId); }
      catch (error) { this.report('delivery', error); return; }
      if (!document.canEdit) return;
      const expiry = document.pendingExpiries.find(item => !this.deliveryBlocked.has(item.id));
      if (!expiry) return;
      budget.remaining--;
      const deliveryId = 'timer-expiry:' + expiry.id;
      try {
        const access = this.options.host.readResource(resourceId);
        if (access?.authorized !== true || access.writable !== true || access.resource.state !== 'active') return;
        const row = this.options.host.db.prepare('SELECT acknowledged_at FROM timer_expiries WHERE id=? AND resource_id=?').get(expiry.id, resourceId);
        if (!row || row.acknowledged_at !== null) continue;
        const receipt = await this.deliver({ deliveryId, resource: access.resource, expiry });
        if (this.disposed) return;
        if (!receipt) { this.deliveryBlocked.add(expiry.id); continue; }
        if (!exact(receipt, ['delivered', 'deliveryId', 'receiptId']) || receipt.delivered !== true || receipt.deliveryId !== deliveryId || !validId(receipt.receiptId))
          throw new TimerDomainError('invalid_timer_delivery_receipt');
        this.options.host.atomic(() => {
          const current = this.service.read(resourceId);
          if (!current.canEdit) throw new TimerDomainError('timer_read_only');
          const old = this.options.host.db.prepare('SELECT * FROM timer_delivery_receipts WHERE expiry_id=?').get(expiry.id);
          if (old && (old.delivery_id !== deliveryId || old.receipt_id !== receipt.receiptId)) throw new TimerDomainError('timer_delivery_receipt_conflict');
          if (!old) this.options.host.db.prepare('INSERT INTO timer_delivery_receipts VALUES(?,?,?,?)')
            .run(expiry.id, deliveryId, receipt.receiptId, current.sampledAt);
          const pending = this.options.host.db.prepare('SELECT acknowledged_at FROM timer_expiries WHERE id=? AND resource_id=?').get(expiry.id, resourceId);
          if (pending?.acknowledged_at === null) this.service.mutate({ commandId: 'timer-delivery-ack:' + expiry.id, resourceId,
            expectedVersion: current.resource.version, operations: [{ type: 'acknowledgeExpiry', expiryId: expiry.id }] });
        });
        this.deliveryBlocked.delete(expiry.id);
      } catch (error) { this.deliveryBlocked.add(expiry.id); this.report('delivery', error); }
    }
    if (!this.disposed) {
      try { if (this.service.read(resourceId).pendingExpiries.some(expiry => !this.deliveryBlocked.has(expiry.id))) this.deliveryBacklog.add(resourceId); }
      catch (error) { this.report('delivery', error); }
    }
  }
  /** Native synchronous resource-factory seam after ready/onResume has settled.
   * Creates an empty clock document in the caller's existing transaction; no timer is started.
   * host.createResource must be the primitive generic+semantic factory, never call this method recursively. */
  createCanonical(input: CreateClockTimer): TimerMutationResult {
    if (this.disposed) throw new TimerDomainError('timer_domain_disposed');
    this.clock.read(); return this.service.create(input);
  }
  private checkPreparation(options: TimerCanonicalPreparationOptions) {
    if (this.disposed) throw new TimerDomainError('timer_domain_disposed');
    if (options.signal.aborted) throw new TimerDomainError('timer_preparation_cancelled');
    this.clock.read();
  }
  private refreshAfterCanonicalTransaction() {
    if (this.canonicalRefreshQueued || this.disposed) return;
    this.canonicalRefreshQueued = true;
    // Core/kernel transactions are synchronous. This runs only after the caller's
    // entire transaction commits OR rolls back, and derives the wake from that state.
    // In particular, preparation/commit never clears the previously installed wake.
    queueMicrotask(() => {
      this.canonicalRefreshQueued = false;
      if (this.disposed) return;
      void this.enqueue(() => {
        this.deliveryBlocked.clear();
        if (this.options.deliverExpiry) for (const resource of this.service.list()) {
          if (this.service.read(resource.id).pendingExpiries.length) this.deliveryBacklog.add(resource.id);
          else this.deliveryBacklog.delete(resource.id);
        }
        this.arm();
      }).catch(error => { if (!this.disposed) this.report('wake', error); });
    });
  }
  /** Await native startup/resume and all previously queued reconcile work. The returned
   * synchronous closure belongs inside the caller's existing Core.atomic transaction,
   * alongside its Vela action receipt. It has no asynchronous side effects before commit. */
  prepareCanonical(request: TimerCanonicalRequest, options: TimerCanonicalPreparationOptions): Promise<() => TimerCanonicalResult> {
    const recipe = structuredClone(request);
    return this.enqueue(() => {
      this.checkPreparation(options);
      if (!exact(recipe, ['name', 'input']) || !['create', 'mutate', 'read', 'list', 'readClock'].includes(recipe.name))
        throw new TimerDomainError('unsupported_clock_timer_command');
      if (recipe.name === 'read' && (!object(recipe.input) || !validId(recipe.input.resourceId) ||
          Object.keys(recipe.input).some(key => !['resourceId', 'expectedVersion'].includes(key)) ||
          recipe.input.expectedVersion !== undefined && (!Number.isSafeInteger(recipe.input.expectedVersion) || recipe.input.expectedVersion < 1)))
        throw new TimerDomainError('unsupported_clock_timer_command');
      if (recipe.name === 'list' && (!exact(recipe.input, ['resourceIds']) || !Array.isArray(recipe.input.resourceIds) ||
          recipe.input.resourceIds.length > TIMER_LIMITS.resources || recipe.input.resourceIds.some(value => !validId(value)) ||
          new Set(recipe.input.resourceIds).size !== recipe.input.resourceIds.length)) throw new TimerDomainError('unsupported_clock_timer_command');
      if (recipe.name === 'readClock' && (!object(recipe.input) || Object.keys(recipe.input).some(key => key !== 'timeZone') ||
          recipe.input.timeZone !== undefined && typeof recipe.input.timeZone !== 'string')) throw new TimerDomainError('unsupported_clock_timer_command');
      // Do not call a canonical host transaction during preparation. Some hosts
      // persist their state snapshot even for a logically read-only service call.
      // All resource/operation validation occurs again at the synchronous boundary.
      return () => {
        this.checkPreparation(options);
        const mutation = recipe.name === 'create' || recipe.name === 'mutate';
        try {
          return this.options.host.atomic((): TimerCanonicalResult => {
            this.checkPreparation(options); options.validate?.(); this.checkPreparation(options);
            if (recipe.name === 'read') {
              const document = this.service.read(recipe.input.resourceId);
              if (recipe.input.expectedVersion !== undefined && document.resource.version !== recipe.input.expectedVersion)
                throw new TimerDomainError('timer_version_conflict');
              return { name: 'read', document };
            }
            if (recipe.name === 'list') return { name: 'list', documents: recipe.input.resourceIds.map(resourceId => this.service.read(resourceId)) };
            if (recipe.name === 'readClock') {
              const sample = this.clock.read(), timeZone = new Intl.DateTimeFormat('en-US', { timeZone: recipe.input.timeZone ?? sample.timeZone }).resolvedOptions().timeZone;
              return { name: 'readClock', sampledAt: new Date(sample.epochMs).toISOString(), clock: { epochMs: sample.epochMs,
                timeZone, locale: sample.locale, formatted: new Intl.DateTimeFormat(sample.locale, { timeZone, hour: 'numeric', minute: '2-digit',
                  second: '2-digit', year: 'numeric', month: 'short', day: 'numeric', timeZoneName: 'short' }).format(sample.epochMs) } };
            }
            const result = recipe.name === 'create' ? this.service.createWithOperations(recipe.input) : this.service.mutate(recipe.input);
            const document = this.service.read(result.resourceId), operations = recipe.input.operations;
            const operationIds: TimerCanonicalOperationIds = {
              timerIds: [...new Set([...operations.flatMap(op => 'timerId' in op ? [op.timerId] : []),
                ...operations.flatMap(op => op.type === 'createTimer' ? [result.createdIds[op.key]] : [])])],
              clockIds: [...new Set(operations.flatMap(op => 'clockId' in op ? [op.clockId] : op.type === 'addWorldClock' ? [result.createdIds[op.key]] : []))],
              expiryIds: [...new Set([...result.expiries.map(expiry => expiry.id), ...operations.flatMap(op => op.type === 'acknowledgeExpiry' ? [op.expiryId] : [])])],
            };
            return { name: recipe.name, mutation: result, document, operationIds, postconditions: { canonicalDocumentBound: true,
              receiptVersion: result.version, observedVersion: document.resource.version, receiptMatchesCurrent: result.version === document.resource.version } };
          });
        } finally { if (mutation) this.refreshAfterCanonicalTransaction(); }
      };
    });
  }
  command<K extends keyof ClockTimerCommandMap>(request: { name: K; input: ClockTimerCommandMap[K]['input'] }): Promise<ClockTimerCommandMap[K]['output']>;
  command(request: ClockTimerRequest): Promise<ClockTimerResponse> {
    return this.enqueue(async () => {
      this.clearWake();
      try {
        this.lastError = null;
        this.clock.read();
        if (!exact(request, ['name', 'input']) || !['create', 'read', 'mutate', 'list'].includes(request.name)) throw new TimerDomainError('unsupported_clock_timer_command');
        let result: ClockTimerResponse, resourceId: string | null = null;
        switch (request.name) {
          case 'create': result = this.service.create(request.input); resourceId = result.resourceId; break;
          case 'mutate': result = this.service.mutate(request.input); resourceId = result.resourceId; break;
          case 'read':
            if (!exact(request.input, ['resourceId'])) throw new TimerDomainError('unsupported_clock_timer_command');
            resourceId = request.input.resourceId;
            // A read remains a read; expiry is reconciled by the native loop/startup/resume.
            result = this.service.read(resourceId); break;
          case 'list':
            if (!exact(request.input, [])) throw new TimerDomainError('unsupported_clock_timer_command');
            result = this.service.list(); break;
        }
        if (resourceId && request.name !== 'read') { this.deliveryBlocked.clear(); await this.drain(resourceId, { remaining: 16 }); }
        return result;
      } catch (error) { this.report('command', error); throw error; }
      finally { this.arm(); }
    });
  }
  reconcile(resourceId?: string): Promise<TimerReconcileResult[]> {
    return this.enqueue(async () => {
      this.clearWake();
      try {
        this.clock.read();
        this.deliveryBlocked.clear();
        if (!resourceId) return await this.recoverAll();
        const result = this.service.reconcile(resourceId); await this.drain(resourceId, { remaining: 16 }); return [result];
      } finally { this.arm(); }
    });
  }
  onResume(): Promise<void> {
    if (this.resumePending) return this.resumePending;
    this.clearWake();
    const work = this.enqueue(async () => {
      try { await this.clock.onResume(); if (this.disposed) return; this.deliveryBlocked.clear(); await this.recoverAll(false); this.arm(); }
      catch (error) { this.clearWake(); this.report('resume', error); throw error; }
    });
    this.resumePending = work;
    void work.finally(() => { if (this.resumePending === work) this.resumePending = null; }).catch(() => {});
    return work;
  }
  status() { return { disposed: this.disposed, scheduled: this.handle !== null, clock: this.clock.status(), lastError: this.lastError }; }
  async dispose(): Promise<void> {
    if (!this.disposed) { this.disposed = true; this.clearWake(); this.deliveryAbort?.abort(); this.clock.dispose(); }
    await this.tail;
  }
}
export const createTimerDomain = (options: TimerDomainOptions) => new TimerDomain(options);
