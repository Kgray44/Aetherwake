import type { DatabaseSync } from 'node:sqlite';

export const CLOCK_TIMER_CONTRACT = 'aerynth.clock-timer@1' as const;
export const TIMER_LIMITS = Object.freeze({ resources: 64, timersPerResource: 64, timers: 4096,
  laps: 128, worldClocks: 16, operations: 32, receipts: 8192, expiries: 8192,
  documentBytes: 65536, maxDurationMs: 365 * 24 * 60 * 60 * 1000,
  maxWakeDelayMs: 60000, clockDriftToleranceMs: 1000 });

/** A trusted elapsed clock includes suspended time. Change sessionId whenever its origin becomes incomparable. */
export interface TimerClockReading {
  epochMs: number;
  monotonicMs: number;
  sessionId: string;
  timeZone: string;
  locale: string;
}
export interface ClockTimerResource {
  id: string;
  kind: 'clock_timer';
  title: string;
  projectId: string | null;
  version: number;
  state: 'active' | 'archived';
}
export type TimerState = 'ready' | 'running' | 'paused' | 'completed' | 'cancelled';
export interface TimerTiming {
  basis: 'held' | 'monotonic' | 'wall-recovery';
  wallRecovery: boolean;
  clockAdjusted: boolean;
}
export interface TimerView {
  id: string;
  version: number;
  name: string;
  state: TimerState;
  durationMs: number;
  remainingMs: number;
  runId: string;
  deadlineEpochMs: number | null;
  due: boolean;
  timing: TimerTiming;
}
export interface StopwatchLap {
  id: string;
  number: number;
  elapsedMs: number;
  splitMs: number;
  recordedAt: string;
  wallRecovery: boolean;
}
export interface StopwatchView {
  state: 'ready' | 'running' | 'paused';
  runId: string;
  elapsedMs: number;
  laps: StopwatchLap[];
  timing: TimerTiming;
}
export interface WorldClockView { id: string; label: string; timeZone: string; formatted: string }
export interface TimerExpiry {
  id: string;
  timerId: string;
  runId: string;
  expiredAt: string;
  wallRecovery: boolean;
}
export interface ClockTimerDocument {
  contract: typeof CLOCK_TIMER_CONTRACT;
  resource: ClockTimerResource;
  canEdit: boolean;
  sampledAt: string;
  localClock: { epochMs: number; timeZone: string; locale: string; formatted: string };
  timers: TimerView[];
  stopwatch: StopwatchView;
  worldClocks: WorldClockView[];
  pendingExpiries: TimerExpiry[];
}
export type TimerOperation =
  | { type: 'createTimer'; key: string; name: string; durationMs: number; start?: boolean }
  | { type: 'startTimer' | 'pauseTimer' | 'resumeTimer' | 'resetTimer' | 'cancelTimer' | 'deleteTimer'; timerId: string }
  | { type: 'extendTimer' | 'shortenTimer'; timerId: string; amountMs: number }
  | { type: 'renameTimer'; timerId: string; name: string }
  | { type: 'stopwatchStart' | 'stopwatchPause' | 'stopwatchResume' | 'stopwatchReset' | 'stopwatchLap' }
  | { type: 'addWorldClock'; key: string; timeZone: string; label: string }
  | { type: 'renameWorldClock'; clockId: string; label: string }
  | { type: 'removeWorldClock'; clockId: string }
  | { type: 'acknowledgeExpiry'; expiryId: string };
export interface CreateClockTimer { commandId: string; title: string; projectId?: string | null }
/** One idempotent canonical command, including the initial timer/watch/clock operations. */
export interface CreateClockTimerWithOperations extends CreateClockTimer { operations: TimerOperation[] }
export interface MutateClockTimer {
  commandId: string;
  resourceId: string;
  expectedVersion: number;
  operations: TimerOperation[];
}
export type TimerCanonicalRequest =
  | { name: 'create'; input: CreateClockTimerWithOperations }
  | { name: 'mutate'; input: MutateClockTimer }
  | { name: 'read'; input: { resourceId: string; expectedVersion?: number } }
  | { name: 'list'; input: { resourceIds: string[] } }
  | { name: 'readClock'; input: { timeZone?: string } };
/** Host injects command identity; a provider can never choose a persistence receipt key. */
export type TimerCanonicalActionRequest =
  | { name: 'create'; input: Omit<CreateClockTimerWithOperations, 'commandId'> }
  | { name: 'mutate'; input: Omit<MutateClockTimer, 'commandId'> }
  | Extract<TimerCanonicalRequest, { name: 'read' | 'list' | 'readClock' }>;
export type ClockTimerQuery = { target: 'timer'; timerId: string } | { target: 'stopwatch' | 'clock' | 'world-clocks' } |
  { target: 'timers'; states?: TimerState[] };
export interface ClockTimerAction {
  type: 'clockTimer'; request: TimerCanonicalActionRequest; workspaceId: string | null;
  focus: { mode: 'timer' | 'stopwatch' | 'clock'; timerId: string | null; timerKey: string | null } | null;
  query: ClockTimerQuery | null;
}
/** Verified historical command facts, without a document or second transcript. */
export interface VelaClockTimerReceipt {
  contract: 'aerynth.vela-clock-timer@1'; operation: TimerCanonicalRequest['name'];
  resourceId: string | null; resourceVersion: number | null; timerId: string | null;
  workspaceId: string | null; blockId: string | null; observedAt: string;
  operationIds: { timerIds: string[]; clockIds: string[]; expiryIds: string[] };
  verification: { canonicalDocumentBound: boolean; receiptVersion: number | null; observedVersion: number | null; receiptMatchesCurrent: boolean };
}
export interface TimerMutationResult {
  resourceId: string;
  version: number;
  createdIds: Record<string, string>;
  expiries: TimerExpiry[];
}
/** A wake request has no authority. The service rechecks the current run and version. */
export interface TimerWake {
  resourceId: string;
  timerId: string;
  runId: string;
  timerVersion: number;
  delayMs: number;
  deadlineEpochMs: number;
}
export interface TimerReconcileResult { resourceId: string; version: number; changed: boolean; expiries: TimerExpiry[] }
export interface TimerDomainEvent {
  type: 'clock_timer.created' | 'clock_timer.changed' | 'clock_timer.expired' | 'clock_timer.reconciled';
  resourceId: string;
  resourceVersion: number;
  commandId: string | null;
  timerIds: string[];
  expiryIds: string[];
  operations: string[];
}
/** All callbacks compose in the owning kernel transaction. Notification delivery belongs to the native host. */
export interface TimerHostPort {
  readonly db: DatabaseSync;
  atomic<T>(work: () => T): T;
  clock(): TimerClockReading;
  createResource(input: { kind: 'clock_timer'; title: string; projectId: string | null }): ClockTimerResource;
  readResource(resourceId: string): { resource: ClockTimerResource; authorized: boolean; writable: boolean } | null;
  touchResource(input: { resourceId: string; expectedVersion: number }): ClockTimerResource;
  recordEvent(event: TimerDomainEvent): void;
}
export interface ClockTimerPort {
  create(input: CreateClockTimer): Promise<TimerMutationResult>;
  read(resourceId: string): Promise<ClockTimerDocument>;
  mutate(input: MutateClockTimer): Promise<TimerMutationResult>;
  list(): Promise<ClockTimerResource[]>;
}
