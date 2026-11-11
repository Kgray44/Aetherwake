import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compileMissionContext, createMissionContextCache, validateMissionContext, validateMissionContextSources,
  type MissionContextSource } from '../../vela-core/src/mission-context.mts';
import { historyDigest } from '../../vela-core/src/bounded-history.mts';
import { ServiceError } from './contracts.mts';
import { missionMeasurementAnswer } from './mission-native.mts';
import { buildMissionRevision } from './mission-revision.mts';
import type { ResourceLease, ResourceLeaseRequest } from './resource-policy.mts';
import { MISSION_CONTRACT, MISSION_LIMITS as L, type Mission, type MissionControl, type MissionEvent,
  type MissionExecutionContext, type MissionExecutor, type MissionPlan, type MissionProjection,
  type MissionAdmission, type MissionAttempt, type MissionAttemptPhaseTiming, type MissionReadyBlocker, type MissionReadyQueueEvidence,
  type MissionRevisionChange, type MissionRevisionPreview, type MissionScope, type MissionTask,
  type MissionTaskPlan, type MissionWorkroom, type MissionWorkroomCard, type MissionWorkroomDashboard,
  type MissionWorkroomResource, type MissionAgentAttempt, type MissionAgentDashboard } from './mission-contracts.mts';

export interface MissionServiceHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  authorized(scope: MissionScope): boolean;
  planningContextCurrent?(mission: Pick<MissionPlan, 'scope' | 'planning'>): boolean;
  executors: Readonly<Record<string, MissionExecutor>>;
  laneLimit(lane: string): number;
  underPressure?(): boolean;
  admission?(demand: boolean): MissionAdmission;
  resources?: {
    canAcquire(lane: string, executorId: string): boolean;
    prepare?(lane: string, executorId: string): void;
    acquire(lane: string, identity: Omit<ResourceLeaseRequest, 'kind' | 'estimatedRamBytes'>, executorId: string): ResourceLease | undefined;
  };
  contextSource?(mission: Mission, task: MissionTaskPlan): MissionContextSource | undefined;
  profilerMode?: 'off' | 'minimal' | 'full';
  reassign?(mission: Mission, task: MissionTask, agentProfileId: string): MissionTaskPlan['specialist'];
  replan?(mission: Mission, task: MissionTask): { additions: MissionTaskPlan[]; dependents: Record<string, string[]>; reason: string } | undefined;
  /** Stage only newly appended events inside the journal transaction. */
  stagePublication?(mission: Mission, from: number): void;
  observe?(mission: Mission, event: MissionEvent): void;
}

const check: (ok: unknown, code: string) => asserts ok = (ok, code) => { if (!ok) throw new ServiceError(code); };
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[\w.:-]{1,120}$/.test(s);
const bounded = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && Buffer.byteLength(s) <= max;
const stamp = () => new Date().toISOString();
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const makeTask = (plan: MissionTaskPlan): MissionTask => ({ ...plan, queuedAt: stamp(), state: 'queued', priority: 0, attempts: [] });
const own = (table: object, key: string) => Object.hasOwn(table, key);
/** Shared scoped evidence summary. Evidence bodies and profile instructions stay with their owners. */
function workroomEvidence(task: MissionTask, attempt?: MissionAttempt): Pick<MissionAgentAttempt,
  'evidenceId' | 'source' | 'observedAt' | 'verification' | 'passed' | 'findings' | 'citations'> {
  const evidence = attempt?.evidence, verification = attempt?.verification;
  const report = (task.executor === 'chatgpt.specialist' && evidence?.source === 'chatgpt-plan-responses:reported' ||
    task.executor === 'api.specialist' && evidence?.source === 'openai-api-vela:reported') &&
    verification?.passed && verification.evidenceIds.includes(evidence.id) && evidence.attemptId === attempt?.id
    ? evidence.value as { observations?: unknown; citations?: unknown } : undefined;
  const findings = Array.isArray(report?.observations)
    ? report.observations.filter((item): item is string => bounded(item, 240)).slice(0, 3)
    : attempt ? missionMeasurementAnswer([{ ...task, attempts: [attempt] }]) : [];
  const citations = Array.isArray(report?.citations) ? report.citations.flatMap(item => {
    const url = bounded(item, 256) ? URL.parse(item) : null;
    return url?.protocol === 'https:' && !url.username && !url.password ? [url.href] : [];
  }).slice(0, 3) : [];
  return { ...(evidence ? { evidenceId: evidence.id, source: evidence.source, observedAt: evidence.observedAt } : {}),
    ...(verification ? { verification: verification.detail, passed: verification.passed } : {}),
    ...(findings.length ? { findings } : {}), ...(citations.length ? { citations } : {}) };
}
const blockedState = (task: MissionTask) => ['failed', 'uncertain', 'cancelled', 'blocked'].includes(task.state);
const scheduled = (m: Mission) => m.disposition === 'active' && m.tasks.some(task => task.state === 'queued');
const taskOf = (m: Mission, id: string) => m.tasks.find(task => task.id === id);
const sameScope = (a: MissionScope, b: MissionScope) => a.workspaceId === b.workspaceId && a.projectId === b.projectId;
const busy = (m: Mission) => m.tasks.some(task => task.state === 'running' || task.state === 'cancelling');
const active = (m: Mission) => busy(m) || m.disposition !== 'cancelled' && m.tasks.some(task => task.state === 'queued');
const recordLimitBytes = 160 * 1024;
const admissionLimitBytes = 1024;
const priorityAgingMs = 30_000;
type ReadyObservation = { planRevision: number; queuedAt: string; attemptCount: number; evidence: MissionReadyQueueEvidence };

function readyTasks(mission: Mission): MissionTask[] {
  const tasks = new Map(mission.tasks.map(task => [task.id, task]));
  return mission.tasks.filter(task => task.state === 'queued' &&
    task.dependencies.every(id => tasks.get(id)?.state === 'verified'));
}

function orderReadyTasks(mission: Mission, ready: MissionTask[], now: number): MissionTask[] {
  const tasks = new Map(mission.tasks.map(task => [task.id, task]));
  const feasible = new Map<string, boolean>();
  const canComplete = (task: MissionTask): boolean => {
    if (!feasible.has(task.id)) feasible.set(task.id, !blockedState(task) &&
      task.dependencies.every(id => canComplete(tasks.get(id)!)));
    return feasible.get(task.id)!;
  };
  const dependents = new Map<string, MissionTask[]>();
  for (const task of mission.tasks) if (task.state === 'queued' && canComplete(task)) {
    for (const id of task.dependencies) {
      const children = dependents.get(id) ?? [];
      children.push(task);
      dependents.set(id, children);
    }
  }
  const paths = new Map<string, number>();
  const pathLength = (task: MissionTask): number => {
    if (!paths.has(task.id)) paths.set(task.id, 1 + Math.max(0, ...(dependents.get(task.id) ?? []).map(pathLength)));
    return paths.get(task.id)!;
  };
  const aged = (task: MissionTask) => now - Date.parse(task.queuedAt) >= priorityAgingMs;
  return ready.sort((a, b) => {
    const aAged = aged(a), bAged = aged(b), queuedOrder = a.queuedAt.localeCompare(b.queuedAt);
    return Number(bAged) - Number(aAged) || (aAged && bAged ? queuedOrder : 0) ||
      b.priority - a.priority || pathLength(b) - pathLength(a) || queuedOrder;
  });
}

export function validateMissionPlan(plan: MissionPlan, executors: MissionServiceHost['executors']): void {
  check(plan && bounded(plan.objective, 4096) && plan.scope && identifier(plan.scope.workspaceId) &&
    (plan.scope.projectId === null || identifier(plan.scope.projectId)), 'invalid_mission_scope');
  check(Array.isArray(plan.criteria) && plan.criteria.length > 0 && plan.criteria.length <= L.tasks &&
    plan.criteria.every(x => identifier(x)) && new Set(plan.criteria).size === plan.criteria.length, 'invalid_mission_criteria');
  check(Array.isArray(plan.tasks) && plan.tasks.length > 0 && plan.tasks.length <= L.tasks, 'invalid_mission_tasks');
  check(!plan.coverage||plan.coverage.status==='partial'&&Array.isArray(plan.coverage.limitations)&&plan.coverage.limitations.length>0&&plan.coverage.limitations.length<=8&&plan.coverage.limitations.every(reason=>bounded(reason,480)),'invalid_mission_coverage');
  const tasks = new Map<string, MissionTaskPlan>();
  for (const t of plan.tasks) {
    check(t && identifier(t.id) && !tasks.has(t.id) && bounded(t.objective, 1024) &&
      identifier(t.executor) && own(executors, t.executor) && plan.criteria.includes(t.criterion), 'invalid_mission_task');
    check(Number.isInteger(t.timeoutMs) && t.timeoutMs >= 20 && t.timeoutMs <= 120_000 &&
      Number.isInteger(t.maxAttempts) && t.maxAttempts >= 1 && t.maxAttempts <= L.attempts, 'invalid_mission_budget');
    check(Array.isArray(t.dependencies) && t.dependencies.length < L.tasks && t.dependencies.every(identifier) &&
      new Set(t.dependencies).size === t.dependencies.length, 'invalid_mission_dependencies');
    check(Array.isArray(t.claims) && t.claims.length <= 8 && t.claims.every(c => c && identifier(c.resource) &&
      (c.mode === 'read' || c.mode === 'exclusive')) && new Set(t.claims.map(c => c.resource)).size === t.claims.length, 'invalid_mission_claims');
    tasks.set(t.id, t);
  }
  check(plan.criteria.every(criterion => plan.tasks.some(task => task.criterion === criterion)), 'uncovered_mission_criterion');
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    check(!visiting.has(id), 'mission_dependency_cycle');
    if (visited.has(id)) return;
    const task = tasks.get(id);
    check(task, 'missing_mission_dependency');
    visiting.add(id);
    task.dependencies.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  tasks.forEach(task => visit(task.id));
}

interface Running {
  missionId: string;
  task: MissionTaskPlan;
  lane: string;
  abort: AbortController;
  settled: Promise<void>;
  cancellation?: 'timeout' | 'user' | 'close';
}

/** Single owner (the canonical Core worker). Every dispatch follows a committed journal write. */
export class MissionService {
  private running = new Map<string, Running>();
  private readonly contextCache = createMissionContextCache();
  private closed = false;
  private healthy = true;
  private scheduled = false;
  private wakeTimer?: NodeJS.Timeout;
  private admissionSnapshot?: MissionAdmission;
  private lastAdmitted = new Map<string, number>();
  private turn = 0;
  private readonly host: MissionServiceHost;
  private readonly profilerClock = randomUUID();
  private readyObservations = new Map<string, ReadyObservation>();

  constructor(host: MissionServiceHost) {
    this.host = host;
    host.atomic(() => {
      host.db.exec(`CREATE TABLE IF NOT EXISTS vela_missions (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
        scope_key TEXT NOT NULL, pending INTEGER NOT NULL CHECK(pending IN (0,1)),
        active INTEGER NOT NULL CHECK(active IN (0,1)), json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS vela_missions_pending ON vela_missions(pending);
      CREATE INDEX IF NOT EXISTS vela_missions_scope ON vela_missions(scope_key);
      CREATE INDEX IF NOT EXISTS vela_missions_workroom ON vela_missions(json_extract(json,'$.workroom.workspaceId'));`);
      for (const row of host.db.prepare('SELECT json FROM vela_missions WHERE active=1').all()) {
        const m = this.decode(row.json);
        const before = m.events.length;
        for (const task of m.tasks) if (task.state === 'running' || task.state === 'cancelling') {
          const executor = own(host.executors, task.executor) ? host.executors[task.executor] : undefined;
          task.state = executor?.replaySafe ? 'failed' : 'uncertain';
          task.detail = 'interrupted_by_restart';
          const attempt = task.attempts.at(-1)!;
          attempt.finishedAt = stamp(); attempt.outcome = task.state;
          this.event(m, { kind: 'recovered', taskId: task.id, attemptId: attempt.id, detail: task.state });
        }
        // Startup never starts work with a previous process's authority.
        if (m.disposition === 'active' && m.tasks.some(t => t.state === 'queued')) {
          m.disposition = 'paused'; this.event(m, { kind: 'recovered', detail: 'paused_on_restart' });
        }
        this.store(m, before);
      }
    });
  }

  private decode(json: unknown): Mission {
    check(typeof json === 'string' && Buffer.byteLength(json) <= recordLimitBytes, 'invalid_mission_record');
    const m = JSON.parse(json) as Mission;
    check(m.contract === MISSION_CONTRACT, 'unsupported_mission_contract');
    return m;
  }
  private event(m: Mission, event: Omit<MissionEvent, 'seq' | 'time' | 'timing'>, intakeMonotonicMs?: number) {
    check(m.events.length < L.events, 'mission_journal_full');
    const mode = this.host.profilerMode ?? 'full';
    const capture = mode === 'full' || mode === 'minimal' &&
      (event.kind === 'started' || event.kind === 'settled' && !!event.attemptId);
    const recorded: MissionEvent = { ...event, seq: ++m.revision, time: stamp(),
      ...(capture ? { timing: { domain: this.profilerClock, monotonicMs: performance.now(), planRevision: m.planRevision,
        ...(intakeMonotonicMs !== undefined ? { intakeMonotonicMs } : {}) } } : {}) };
    m.events.push(recorded);
    return recorded;
  }
  fullProfilingClock() {
    return (this.host.profilerMode ?? 'full') === 'full' ? this.profilerClock : null;
  }

  private encode(m: Mission) {
    let json = JSON.stringify(m);
    if (Buffer.byteLength(json) > recordLimitBytes) {
      let trimmed = false;
      for (const task of [...m.tasks, ...(m.retiredTasks ?? [])]) {
        for (const attempt of task.attempts) if (attempt.timing?.phases) {
          delete attempt.timing.phases;
          trimmed = true;
        }
      }
      if (trimmed) json = JSON.stringify(m);
    }
    if (Buffer.byteLength(json) > recordLimitBytes && m.events.some(event => event.timing)) {
      // Mission evidence takes priority at the existing storage limit.
      m.events = m.events.map(({ timing: _timing, ...event }) => event);
      json = JSON.stringify(m);
    }
    return json;
  }
  private store(m: Mission, from: number) {
    const json = this.encode(m);
    check(Buffer.byteLength(json) <= recordLimitBytes, 'mission_record_full');
    this.host.db.prepare('UPDATE vela_missions SET pending=?,active=?,json=? WHERE id=?')
      .run(Number(scheduled(m)), Number(active(m)), json, m.id);
    if (from < m.events.length) this.host.stagePublication?.(m, from);
  }
  private lookup(id: string) {
    check(identifier(id), 'invalid_mission_id');
    const row = this.host.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(id);
    check(row, 'mission_not_found');
    return this.decode(row.json);
  }
  private notify(m: Mission, from: number) {
    for (const event of m.events.slice(from)) {
      try { this.host.observe?.(structuredClone(m), structuredClone(event)); } catch { /* The durable journal remains authoritative. */ }
    }
  }
  private update(id: string, change: (m: Mission) => void) {
    let before = 0;
    const m = this.host.atomic(() => {
      const value = this.lookup(id);
      before = value.events.length;
      change(value);
      this.store(value, before);
      return value;
    });
    this.notify(m, before);
    return m;
  }
  private requireOpen() { check(!this.closed && this.healthy, 'mission_scheduler_unavailable'); }
  private requireAccess(m: Mission, scope: MissionScope) {
    check((sameScope(m.scope, scope) || m.workroom?.workspaceId === scope.workspaceId && m.scope.projectId === scope.projectId) &&
      this.host.authorized(scope) && this.host.authorized(m.scope), 'mission_not_found');
  }
  private capacity() {
    check(Number(this.host.db.prepare('SELECT count(*) AS n FROM vela_missions WHERE active=1').get()!.n) < L.active,
      'mission_queue_full');
  }

  create(requestId: string, plan: MissionPlan, intakeMonotonicMs?: number): MissionProjection {
    this.requireOpen();
    check(identifier(requestId), 'invalid_mission_request');
    validateMissionPlan(plan, this.host.executors);
    check(this.host.authorized(plan.scope), 'mission_scope_denied');
    check(this.host.planningContextCurrent?.(plan) !== false, 'mission_planning_context_changed');
    const fingerprint = digest(plan);
    let created = false;
    const m = this.host.atomic(() => {
      const existing = this.host.db.prepare('SELECT request_digest,json FROM vela_missions WHERE request_id=?').get(requestId);
      if (existing) {
        const value = this.decode(existing.json);
        this.requireAccess(value, plan.scope);
        const { originConversationId: _origin, ...legacyPlan } = plan;
        check(existing.request_digest === fingerprint ||
          value.originConversationId === undefined && existing.request_digest === digest(legacyPlan), 'mission_request_conflict');
        return value;
      }
      this.capacity();
      check(Number(this.host.db.prepare('SELECT count(*) AS n FROM vela_missions').get()!.n) < L.missions, 'mission_store_full');
      const value: Mission = { contract: MISSION_CONTRACT, id: randomUUID(), requestId, objective: plan.objective, scope: plan.scope,
        criteria: [...plan.criteria], createdAt: stamp(), disposition: 'active', revision: 0, planRevision: 1, concurrency: 2,
        tasks: plan.tasks.map(makeTask), events: [], ...(plan.planning ? { planning: plan.planning } : {}),
        ...(plan.coverage?{coverage:structuredClone(plan.coverage)}:{}),
        ...(plan.team ? { team: plan.team } : {}),
        ...(plan.originConversationId ? { originConversationId: plan.originConversationId } : {}) };
      this.event(value, { kind: 'created' }, intakeMonotonicMs);
      this.host.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,1,1,?)')
        .run(value.id, requestId, fingerprint, digest(value.scope), JSON.stringify(value));
      this.host.stagePublication?.(value, 0);
      created = true;
      return value;
    });
    if (created) this.notify(m, 0);
    this.wake();
    return this.project(m);
  }

  read(id: string, scope: MissionScope) {
    const m = this.lookup(id);
    this.requireAccess(m, scope);
    return this.project(m);
  }

  /** Trusted outbox lookup. Publication ports enforce their own disclosure boundaries. */
  publicationEvent(id: string, seq: number): { mission: Mission; event: MissionEvent } {
    const mission = this.lookup(id);
    const event = mission.events.find(item => item.seq === seq);
    check(event, 'mission_publication_event_not_found');
    return { mission, event };
  }
  list(scope: MissionScope): Pick<MissionProjection, 'id' | 'objective' | 'outcome' | 'createdAt' | 'revision'>[] {
    check(this.host.authorized(scope), 'mission_scope_denied');
    return this.host.db.prepare(`SELECT json FROM vela_missions WHERE scope_key=?
      OR (json_extract(json,'$.workroom.workspaceId')=? AND json_extract(json,'$.scope.projectId') IS ?)
      ORDER BY rowid DESC LIMIT ?`)
      .all(digest(scope), scope.workspaceId, scope.projectId, L.missions).flatMap(row => {
        const mission = this.decode(row.json);
        if (!this.host.authorized(mission.scope)) return [];
        const { id, objective, outcome, createdAt, revision } = this.project(mission);
        return [{ id, objective, outcome, createdAt, revision }];
      });
  }
  attachWorkroom(id: string, scope: MissionScope, workroom: MissionWorkroom) {
    this.requireOpen();
    return this.update(id, m => {
      check(sameScope(m.scope, scope) && this.host.authorized(scope) && !m.workroom &&
        this.host.authorized({ ...scope, workspaceId: workroom.workspaceId }), 'mission_workroom_scope_changed');
      m.workroom = workroom;
      this.event(m, { kind: 'workroom', detail: 'created' });
    });
  }

  private boundWorkroom(scope: MissionScope) {
    if (!this.host.authorized(scope)) return;
    const row = this.host.db.prepare(`SELECT json FROM vela_missions
      WHERE json_extract(json,'$.workroom.workspaceId')=?
        AND json_extract(json,'$.scope.projectId') IS ? LIMIT 1`).get(scope.workspaceId, scope.projectId);
    if (!row) return;
    const mission = this.decode(row.json);
    if (mission.workroom && this.host.authorized(mission.scope)) return { mission, workroom: mission.workroom };
  }

  workroomCardIds(scope: MissionScope): string[] {
    const workroom = this.boundWorkroom(scope)?.workroom;
    return [...Object.values(workroom?.missionCards ?? {}), ...Object.values(workroom?.missionAgentCards ?? {})];
  }

  workroomResource(resourceId: string, scope: MissionScope): MissionWorkroomResource | null {
    const linked = this.boundWorkroom(scope);
    if (!linked) return null;
    const { mission, workroom } = linked;
    const agentTaskId = Object.entries(workroom.missionAgentCards ?? {}).find(([, id]) => id === resourceId)?.[0];
    if (agentTaskId !== undefined) {
      const projection = this.project(mission);
      const task = projection.tasks.find(task => task.id === agentTaskId) ??
        projection.retiredTasks?.find(task => task.id === agentTaskId);
      if (!task?.specialist) return null;
      return { kind: 'workroom-resource', missionId: projection.id, outcome: projection.outcome,
        revision: projection.revision, dashboard: this.workroomAgent(projection, task) };
    }
    const card = workroom.missionChecklistResourceId === resourceId ? 'checklist' :
      workroom.missionTimelineResourceId === resourceId ? 'timeline' :
        (Object.keys(workroom.missionCards ?? {}) as MissionWorkroomCard[]).find(kind => workroom.missionCards?.[kind] === resourceId);
    if (!card) return null;
    const projection = this.project(mission);
    const { id, outcome, revision, tasks, events } = projection;
    const binding = { kind: 'workroom-resource' as const, missionId: id, outcome, revision };
    if (card === 'checklist') return { ...binding, checklist: tasks.map(task => ({ taskId: task.id, title: task.objective, state: task.state })) };
    if (card === 'timeline') return { ...binding, timeline: events };
    return { ...binding, dashboard: this.workroomDashboard(projection, card) };
  }

  private workroomAgent(mission: MissionProjection, task: MissionTask): MissionAgentDashboard {
    const specialist = task.specialist!;
    const profile = specialist.profile;
    return { kind: 'agent', taskId: task.id, title: task.objective, role: specialist.role,
      responsibility: task.teamMember?.responsibility ?? task.objective, state: task.state,
      executor: task.executor, provider: specialist.provider, model: specialist.model,
      criterion: task.criterion, dependencies: task.dependencies, maxAttempts: task.maxAttempts,
      timeoutMs: task.timeoutMs, webSearch: specialist.webSearch === true,
      ...(mission.retiredTasks?.some(retired => retired.id === task.id) ? { retired: true } : {}),
      ...(own(mission.waits, task.id) ? { wait: mission.waits[task.id] } : {}),
      ...(profile ? { profile: { id: profile.id, title: profile.title,
        profileVersion: profile.profileVersion, resourceVersion: profile.resourceVersion } } : {}),
      attempts: task.attempts.map((attempt, index) => ({ id: attempt.id, admittedAt: attempt.admittedAt,
        ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt } : {}),
        ...(attempt.outcome ? { outcome: attempt.outcome } : {}),
        ...(index === task.attempts.length - 1 && task.detail ? { detail: task.detail } : {}),
        ...workroomEvidence(task, attempt),
        ...(attempt.context ? { context: attempt.context } : {}),
        ...(attempt.timing ? { timing: attempt.timing } : {}),
        ...(attempt.telemetry ? { telemetry: attempt.telemetry } : {}) })) };
  }

  private workroomDashboard(mission: MissionProjection, kind: MissionWorkroomCard): MissionWorkroomDashboard {
    switch (kind) {
      case 'graph': return { kind, objective: mission.objective, planRevision: mission.planRevision,
        tasks: mission.tasks.map(task => ({ id: task.id, title: task.objective, state: task.state,
          dependencies: task.dependencies, executor: task.executor,
          ...(task.specialist ? { role: task.specialist.role } : {}),
          ...(own(mission.waits, task.id) ? { wait: mission.waits[task.id] } : {}) })) };
      case 'team': return { kind, ...(mission.team ? { title: mission.team.title } : {}),
        members: mission.tasks.flatMap(task => task.specialist ? [{
          taskId: task.id, role: task.specialist.role, responsibility: task.teamMember?.responsibility ?? task.objective,
          state: task.state, provider: task.specialist.provider, model: task.specialist.model, attempts: task.attempts.length,
        }] : []) };
      case 'evidence': return { kind, criteria: mission.criteria, rows: mission.tasks.map(task => {
        return { taskId: task.id, title: task.objective, state: task.state, criterion: task.criterion,
          ...workroomEvidence(task, task.attempts.at(-1)) };
      }) };
      case 'performance': return { kind, profile: mission.profile, ...(mission.admission ? { admission: mission.admission } : {}) };
      case 'stream': return { kind, events: [] };
    }
  }

  control(id: string, scope: MissionScope, revision: number, control: MissionControl): MissionProjection {
    this.requireOpen();
    const aborts: string[] = [];
    const m = this.update(id, value => {
      this.requireAccess(value, scope);
      check(value.revision === revision, 'mission_revision_changed');
      check(control && value.events.filter(e => e.kind === 'control').length < 48, 'mission_control_unavailable');
      const stopTask = (task: MissionTask) => {
        if (task.state === 'running') {
          task.state = 'cancelling'; aborts.push(task.attempts.at(-1)!.id);
        } else if (task.state === 'queued' || task.state === 'blocked') task.state = 'cancelled';
      };
      const task = 'taskId' in control ? taskOf(value, control.taskId) : undefined;
      const prior = task?.attempts.at(-1);
      const stale = control.type === 'retry' && task?.state === 'verified' && prior?.context &&
        !this.contextIsCurrent(value, task, prior, new Map());
      check(value.disposition !== 'cancelled' && (stale || !value.tasks.every(t => t.state === 'verified')), 'mission_terminal');
      switch (control.type) {
        case 'pause': check(value.disposition === 'active', 'mission_not_active'); value.disposition = 'paused'; break;
        case 'resume': {
          check(value.disposition === 'paused', 'mission_not_paused');
          this.recoverPendingReplans(value);
          value.disposition = 'active';
          break;
        }
        case 'cancel': value.disposition = 'cancelled'; value.tasks.forEach(stopTask); break;
        case 'cancel-branch': {
          check(task, 'mission_task_not_found');
          check(task.state === 'queued' || task.state === 'running' || task.state === 'blocked', 'mission_task_terminal');
          const branch = new Set([task.id]);
          for (let i = 0; i < value.tasks.length; i++) for (const candidate of value.tasks)
            if (candidate.dependencies.some(dep => branch.has(dep))) branch.add(candidate.id);
          value.tasks.filter(t => branch.has(t.id)).forEach(stopTask);
          break;
        }
        case 'retry': {
          check(task && (task.state === 'failed' || task.state === 'blocked' || stale) && task.attempts.length < task.maxAttempts &&
            own(this.host.executors, task.executor) && this.host.executors[task.executor].replaySafe, 'mission_retry_denied');
          if (!active(value)) this.capacity();
          task.state = 'queued'; task.queuedAt = stamp(); delete task.detail;
          break;
        }
        case 'priority': check(task && task.state === 'queued' && Number.isInteger(control.priority) &&
          control.priority >= -2 && control.priority <= 2, 'invalid_mission_priority'); task.priority = control.priority; break;
        case 'concurrency': check(Number.isInteger(control.concurrency) && control.concurrency >= 1 &&
          control.concurrency <= L.workers, 'invalid_mission_concurrency'); value.concurrency = control.concurrency; break;
        default: throw new ServiceError('invalid_mission_control');
      }
      this.event(value, { kind: 'control', detail: control.type, ...(task ? { taskId: task.id } : {}),
        ...(control.type === 'cancel' || control.type === 'cancel-branch' ? { cancellationRequestedAttemptIds: aborts } : {}) });
    });
    for (const attempt of aborts) this.abort(attempt, 'user');
    this.wake();
    return this.project(m);
  }

  private prepareRevision(mission: Mission, scope: MissionScope, revision: number, change: MissionRevisionChange) {
    this.requireAccess(mission, scope);
    check(mission.revision === revision, 'mission_revision_changed');
    check(sameScope(mission.scope, scope) && mission.disposition === 'paused' && !busy(mission) &&
      mission.events.filter(event => event.kind === 'revised').length < L.revisions, 'mission_revision_denied');
    const candidate = buildMissionRevision(mission, change, {
      executors: this.host.executors,
      reassign: this.host.reassign,
      evidenceCurrent: task => {
        const attempt = task.attempts.at(-1);
        return !!attempt?.verification?.passed && this.contextIsCurrent(mission, task, attempt, new Map());
      },
    });
    validateMissionPlan({ ...mission, tasks: candidate.tasks }, this.host.executors);
    const { summary, externalReview } = candidate;
    const preview: MissionRevisionPreview = { kind: 'revision-preview', missionId: mission.id, revision, summary,
      fingerprint: digest({ missionId: mission.id, scope, revision, change, tasks: candidate.tasks }),
      ...(externalReview ? { externalReview } : {}) };
    return { candidate, preview };
  }

  previewRevision(id: string, scope: MissionScope, revision: number, change: MissionRevisionChange): MissionRevisionPreview {
    this.requireOpen();
    return this.prepareRevision(this.lookup(id), scope, revision, change).preview;
  }

  applyRevision(id: string, scope: MissionScope, revision: number, change: MissionRevisionChange, fingerprint: string): MissionProjection {
    this.requireOpen();
    const mission = this.update(id, current => {
      const { candidate, preview } = this.prepareRevision(current, scope, revision, change);
      check(preview.fingerprint === fingerprint, 'mission_revision_preview_changed');
      if (!active(current) && candidate.tasks.some(task => task.state === 'queued')) this.capacity();
      current.tasks = candidate.tasks;
      if (candidate.retired) (current.retiredTasks ??= []).push(candidate.retired);
      current.planRevision++;
      this.event(current, { kind: 'revised', detail: candidate.summary, taskId: change.taskId, change,
        ...(candidate.replacementTaskId ? { replacementTaskId: candidate.replacementTaskId } : {}) });
    });
    return this.project(mission);
  }

  /** Host-only amendment. Replays require a reviewed capability and cannot expand acceptance or authority. */
  revise(id: string, scope: MissionScope, revision: number, additions: MissionTaskPlan[], reason: string,
    dependents: Record<string, string[]> = {}, trigger?: { taskId: string; attemptId: string }) {
    this.requireOpen();
    const m = this.update(id, value => {
      this.requireAccess(value, scope);
      check(value.revision === revision, 'mission_revision_changed');
      this.amend(value, additions, reason, dependents, trigger);
    });
    this.wake();
    return this.project(m);
  }

  /** Validate a separate candidate before replacing any part of the current journal. */
  private amend(value: Mission, additions: MissionTaskPlan[], reason: string, dependents: Record<string, string[]>,
    trigger?: { taskId: string; attemptId: string }) {
    check(value.disposition !== 'cancelled' && Array.isArray(additions) && additions.length > 0 && bounded(reason, 160) &&
      value.events.filter(e => e.kind === 'revised').length < L.revisions, 'mission_revision_denied');
    check(additions.every(task => own(this.host.executors, task?.executor) && this.host.executors[task.executor].replaySafe &&
      value.tasks.some(existing => existing.executor === task.executor &&
        task.claims?.every(claim => existing.claims.some(current => current.resource === claim.resource &&
        (current.mode === 'exclusive' || claim.mode === 'read'))))), 'mission_revision_expands_authority');
    if (trigger) {
      const task = taskOf(value, trigger.taskId), attempt = task?.attempts.at(-1);
      check(task?.state === 'verified' && attempt?.id === trigger.attemptId &&
        this.contextIsCurrent(value, task, attempt, new Map()), 'mission_revision_evidence_changed');
    }
    const rewired = new Map<string, MissionTask>();
    for (const [id, added] of Object.entries(dependents)) {
      const task = taskOf(value, id);
      check(task?.state === 'queued' && !task.attempts.length && Array.isArray(added) &&
        added.every(dep => additions.some(t => t.id === dep)), 'mission_revision_dependency_denied');
      rewired.set(id, { ...task, dependencies: [...task.dependencies, ...added] });
    }
    const tasks = [...value.tasks.map(task => rewired.get(task.id) ?? task), ...additions.map(makeTask)];
    validateMissionPlan({ ...value, tasks }, this.host.executors);
    if (!active(value)) this.capacity();
    const amended = { ...value, tasks, planRevision: value.planRevision + 1, events: [...value.events] };
    this.event(amended, { kind: 'revised', detail: reason, ...trigger });
    check(Buffer.byteLength(this.encode(amended)) <= recordLimitBytes, 'mission_record_full');
    Object.assign(value, amended);
  }

  private applyAutomaticReplan(mission: Mission, task: MissionTask, attemptId: string): boolean {
    if (!this.host.replan) return true;
    try {
      const draft = structuredClone(mission);
      const amendment = this.host.replan(draft, taskOf(draft, task.id)!);
      if (amendment) {
        this.requireAccess(mission, mission.scope);
        this.amend(mission, amendment.additions, amendment.reason, amendment.dependents, { taskId: task.id, attemptId });
      }
      return true;
    } catch {
      task.state = 'blocked';
      task.detail = 'mission_required_replan_blocked';
      return false;
    }
  }

  private recoverPendingReplans(mission: Mission) {
    if (!this.host.replan || busy(mission) || !mission.tasks.some(task => task.state === 'queued')) return;
    // Older journals could commit the sample just before losing the separate amendment write.
    const amended = new Set(mission.events.filter(event => event.kind === 'revised').map(event => event.attemptId));
    for (const task of mission.tasks) {
      const attempt = task.attempts.at(-1);
      if (task.state === 'verified' && attempt?.outcome === 'verified' && attempt.verification?.passed &&
        !amended.has(attempt.id) && !this.applyAutomaticReplan(mission, task, attempt.id)) {
        this.event(mission, { kind: 'recovered', taskId: task.id, detail: 'blocked' });
      }
    }
  }

  private conflict(task: MissionTaskPlan) {
    return [...this.running.values()].some(other => task.claims.some(claim => other.task.claims.some(activeClaim =>
      activeClaim.resource === claim.resource && (claim.mode === 'exclusive' || activeClaim.mode === 'exclusive'))));
  }
  private capacityFor(m: Mission, lane: string) {
    const running = [...this.running.values()];
    return running.length < L.workers && running.filter(r => r.missionId === m.id).length < m.concurrency &&
      running.filter(r => r.lane === lane).length < this.host.laneLimit(lane);
  }
  private sampleAdmission(demand: boolean): MissionAdmission | undefined {
    try {
      const value = this.host.admission?.(demand);
      if (value && Number.isInteger(value.workerLimit) && value.workerLimit >= 0 && value.workerLimit <= L.workers &&
        Buffer.byteLength(JSON.stringify(value)) <= admissionLimitBytes) return structuredClone(value);
    } catch { /* An unavailable reading does not fabricate a measurement. */ }
  }
  private clearAdmissionDemand() {
    if (this.admissionSnapshot || this.wakeTimer) this.sampleAdmission(false);
    this.admissionSnapshot = undefined;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
  }
  private contextIsCurrent(m: Mission, task: MissionTask, attempt: MissionAttempt, checked: Map<string, boolean>): boolean {
    const cached = checked.get(attempt.id);
    if (cached !== undefined) return cached;
    checked.set(attempt.id, false);
    const { context } = attempt;
    try {
      check(this.host.planningContextCurrent?.(m) !== false, 'mission_planning_context_changed');
      check(context && context.binding.missionId === m.id && context.binding.taskId === task.id &&
        sameScope(context.binding.scope, m.scope), 'mission_context_changed');
      validateMissionContextSources(context, this.host.contextSource?.(m, task));
      for (const proof of context.dependencies) {
        const predecessor = taskOf(m, proof.taskId), parent = predecessor?.attempts.at(-1);
        const evidence = parent?.evidence;
        check(predecessor?.state === 'verified' && parent && evidence && parent.id === proof.attemptId && evidence.id === proof.evidenceId &&
          historyDigest({ source: evidence.source, observedAt: evidence.observedAt, value: evidence.value }) === proof.digest &&
          this.contextIsCurrent(m, predecessor, parent, checked), 'mission_dependency_context_changed');
      }
      checked.set(attempt.id, true);
      return true;
    } catch { return false; }
  }
  private project(m: Mission): MissionProjection {
    const checked = new Map<string, boolean>();
    const visibleTask = (task: MissionTask): MissionTask => {
      let staleLatest = false;
      const attempts = task.attempts.map((attempt, index) => {
        if (!attempt.context || this.contextIsCurrent(m, task, attempt, checked)) return attempt;
        const { context: _context, evidence: _evidence, verification: _verification, ...metadata } = attempt;
        staleLatest = index === task.attempts.length - 1;
        return metadata;
      });
      return task.state === 'verified' && staleLatest
        ? { ...task, attempts, state: 'blocked' as const, detail: 'mission_source_changed_since_verification' }
        : { ...task, attempts };
    };
    m = { ...m, tasks: m.tasks.map(visibleTask),
      ...(m.retiredTasks ? { retiredTasks: m.retiredTasks.map(visibleTask) } : {}) };
    const outcome = m.tasks.some(t => t.state === 'cancelling') ? 'cancelling' :
      busy(m) ? 'running' : m.tasks.some(t => t.state === 'uncertain') ? 'uncertain' :
      m.disposition === 'cancelled' ? 'cancelled' : m.tasks.every(t => t.state === 'verified') ? m.coverage?'blocked':'verified' :
      m.disposition === 'paused' ? 'paused' :
      m.tasks.some(t => t.state === 'failed') ? 'failed' :
      m.tasks.some(t => t.state === 'blocked' || t.state === 'cancelled') ? 'blocked' : 'queued';
    const waits: MissionProjection['waits'] = {};
    const admission = m.disposition === 'active' && readyTasks(m).length ? this.admissionSnapshot : undefined;
    const pressure = this.host.underPressure?.() || (admission && this.running.size >= admission.workerLimit && admission.workerLimit < L.workers);
    for (const task of m.tasks) if (task.state === 'queued') {
      const executor = own(this.host.executors, task.executor) ? this.host.executors[task.executor] : undefined;
      if (!task.dependencies.every(id => taskOf(m, id)?.state === 'verified')) waits[task.id] = 'dependencies';
      else if (this.conflict(task)) waits[task.id] = 'resource-conflict';
      else if (executor && !this.capacityFor(m, executor.lane)) waits[task.id] = 'capacity';
      else if (this.host.resources ?
        this.host.underPressure?.() || executor && !this.host.resources.canAcquire(executor.lane, task.executor) : pressure)
        waits[task.id] = 'resource-pressure';
    }
    const allTasks = [...m.tasks, ...(m.retiredTasks ?? [])];
    const attempts = allTasks.flatMap(task => task.attempts);
    const expectedRemote = attempts.filter(attempt => this.host.executors[attempt.executor]?.lane !== 'native');
    const usage = expectedRemote.flatMap(attempt => attempt.telemetry?.usage ? [attempt.telemetry.usage] : []);
    if (m.planning?.usage) usage.push(m.planning.usage);
    if (m.planning?.context) usage.push(...m.planning.context.usage);
    const reportedTotalTokens = usage.length ? usage.reduce((total, reading) => total + reading.totalTokens, 0) : null;
    const providerCalls = expectedRemote.every(attempt => attempt.telemetry) ?
      expectedRemote.reduce((total, attempt) => total + attempt.telemetry!.providerCalls,
        (m.planning ? 1 : 0) + (m.planning?.context?.providerCalls ?? 0)) : null;
    let peakWorkers = 0, admitted = 0;
    for (const event of m.events) {
      if (event.kind === 'started') peakWorkers = Math.max(peakWorkers, ++admitted);
      if (event.attemptId && (event.kind === 'settled' || event.kind === 'recovered')) admitted--;
    }
    const ended = ['queued', 'running', 'cancelling'].includes(outcome) ? Date.now() :
      Date.parse(m.events.findLast(event => event.kind !== 'workroom')!.time);
    const answer = missionMeasurementAnswer(m.tasks);
    return { ...m, outcome, ...(answer.length ? { answer } : {}), waits,
      ...(admission ? { admission: structuredClone(admission) } : {}), profile: {
      elapsedMs: Math.max(0, ended - Date.parse(m.createdAt)) + (m.planning?.durationMs ?? 0) +
        (m.planning?.context?.elapsedMs ?? 0), peakWorkers, attempts: attempts.length,
      retries: allTasks.reduce((total, task) => total + Math.max(0, task.attempts.length - 1), 0),
      providerCalls, usageReports: usage.length, reportedTotalTokens,
      verifiedObjectivesPerReportedToken: outcome === 'verified' && providerCalls === usage.length &&
        reportedTotalTokens && reportedTotalTokens > 0 ? 1 / reportedTotalTokens : null,
    } };
  }

  capacityChanged() { this.wake(); }

  private wake() {
    if (this.closed || !this.healthy || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed || !this.healthy) return;
      try { this.drain(); } catch { this.healthy = false; }
    });
  }
  private drain() {
    const rows = this.host.db.prepare('SELECT json FROM vela_missions WHERE pending=1 ORDER BY rowid LIMIT ?').all(L.active);
    const ready = rows.map(row => this.decode(row.json)).map(mission => ({ mission, tasks: readyTasks(mission) }))
      .filter(entry => entry.tasks.length);
    this.observeReadyQueue(ready);
    const monitorRunning = !!this.host.resources && this.running.size > 0;
    if (!ready.length && !monitorRunning) { this.clearAdmissionDemand(); return; }
    const demand = monitorRunning || ready.some(({ mission }) => this.host.authorized(mission.scope));
    const admission = this.sampleAdmission(demand);
    this.admissionSnapshot = demand ? admission : undefined;
    const workerLimit = this.host.underPressure?.() ? 0 :
      this.host.resources ? L.workers : admission?.workerLimit ?? L.workers;
    if (workerLimit === 0 || demand && this.host.admission)
      this.wakeTimer ??= setTimeout(() => { this.wakeTimer = undefined; this.wake(); }, 1500).unref();
    if (workerLimit === 0) {
      if (this.readyObservations.size) for (const { mission, tasks } of ready)
        for (const task of tasks) this.observeReadyBlocker(mission.id, task.id, 'worker-budget');
      return;
    }
    ready.sort((a, b) => (this.lastAdmitted.get(a.mission.id) ?? 0) - (this.lastAdmitted.get(b.mission.id) ?? 0));
    const now = Date.now();
    for (const { mission: m, tasks } of ready) {
      if (this.running.size >= workerLimit) {
        if (this.readyObservations.size) for (const task of tasks) this.observeReadyBlocker(m.id, task.id, 'worker-budget');
        return;
      }
      for (const task of orderReadyTasks(m, tasks, now)) {
        const executor = own(this.host.executors, task.executor) ? this.host.executors[task.executor] : undefined;
        if (!this.host.authorized(m.scope) || !executor?.available(m.scope, task)) {
          this.update(m.id, current => {
            const t = taskOf(current, task.id)!;
            t.state = 'blocked'; t.detail = 'executor_or_scope_unavailable';
            this.event(current, { kind: 'settled', taskId: t.id, detail: t.detail });
          });
          continue;
        }
        if (!this.capacityFor(m, executor.lane)) {
          this.observeReadyBlocker(m.id, task.id, 'capacity');
          continue;
        }
        if (this.conflict(task)) {
          this.observeReadyBlocker(m.id, task.id, 'resource-conflict');
          continue;
        }
        const resources = this.host.resources;
        if (resources && !resources.canAcquire(executor.lane, task.executor)) {
          resources.prepare?.(executor.lane, task.executor);
          continue;
        }
        if (!this.start(m, task, executor, admission)) continue;
        this.lastAdmitted.set(m.id, ++this.turn);
        this.wake();
        break;
      }
    }
  }

  private observeReadyQueue(ready: { mission: Mission; tasks: MissionTask[] }[]) {
    if (!this.fullProfilingClock()) return;
    if (!ready.length) { this.readyObservations.clear(); return; }
    const now = performance.now();
    const next = new Map<string, ReadyObservation>();
    for (const { mission, tasks } of ready) for (const task of tasks) {
      const key = mission.id + '/' + task.id;
      const prior = this.readyObservations.get(key);
      next.set(key, prior?.planRevision === mission.planRevision && prior.queuedAt === task.queuedAt &&
        prior.attemptCount === task.attempts.length ? prior : {
          planRevision: mission.planRevision, queuedAt: task.queuedAt, attemptCount: task.attempts.length,
          evidence: { firstObservedMs: now, blockers: {} },
        });
    }
    this.readyObservations = next;
  }
  private observeReadyBlocker(missionId: string, taskId: string, blocker: MissionReadyBlocker) {
    if (!this.readyObservations.size) return;
    const evidence = this.readyObservations.get(missionId + '/' + taskId)?.evidence;
    if (!evidence) return;
    evidence.blockers[blocker] = { samples: (evidence.blockers[blocker]?.samples ?? 0) + 1, lastObservedMs: performance.now() };
  }

  private start(m: Mission, task: MissionTask, executor: MissionExecutor, admission?: MissionAdmission) {
    const id = randomUUID();
    const compilingAt = performance.now();
    const queueKey = this.readyObservations.size ? m.id + '/' + task.id : undefined;
    const readyQueue = queueKey ? this.readyObservations.get(queueKey)?.evidence : undefined;
    const abort = new AbortController();
    const dependencies = task.dependencies.map(dep => taskOf(m, dep)!.attempts.at(-1)!.evidence!);
    const { attempts: _attempts, queuedAt: _queued, state: _state, priority: _priority, detail: _detail, ...plan } = task;
    const source = this.host.contextSource?.(m, plan);
    const reviewedNotes = task.executor === 'inspect.workspace-notes' ? m.planning?.context?.notes : undefined;
    const request = { missionId: m.id, revision: m.planRevision, taskId: task.id, scope: m.scope,
      missionObjective: m.objective, taskObjective: task.objective, criteria: m.criteria, dependencyTaskIds: task.dependencies,
      ...(reviewedNotes ? { requiredSources: reviewedNotes.map(note => ({
        kind: 'resource' as const, id: note.id, expectedVersion: note.version,
      })) } : {}),
      dependencies: dependencies.map((e, i) => ({ taskId: task.dependencies[i], evidenceId: e.id,
        source: e.source, attemptId: e.attemptId, observedAt: e.observedAt, value: e.value })), maxTokens: 48 * 1024 };
    let context: MissionExecutionContext;
    try {
      const validateDependencies = () => {
        const checked = new Map<string, boolean>();
        for (const dep of task.dependencies) {
          const parent = taskOf(m, dep)!;
          check(this.contextIsCurrent(m, parent, parent.attempts.at(-1)!, checked), 'mission_dependency_context_changed');
        }
      };
      validateDependencies();
      const pkg = compileMissionContext(request, source, this.contextCache);
      context = { missionId: m.id, task: plan, scope: m.scope, attemptId: id, dependencies, context: pkg, signal: abort.signal,
        ...(m.planning?.context ? { validatePlanningContext: () =>
          check(this.host.planningContextCurrent?.(m) !== false, 'mission_planning_context_changed') } : {}) };
    } catch {
      this.update(m.id, current => {
        const value = taskOf(current, task.id)!;
        value.state = 'blocked'; value.detail = 'mission_context_unavailable';
        this.event(current, { kind: 'settled', taskId: task.id, detail: value.detail });
      });
      this.wake();
      return false;
    }
    const assembledAt = performance.now(), clock = this.fullProfilingClock();
    const phases: MissionAttemptPhaseTiming | undefined =
      clock ? { clock, contextAssembly: [compilingAt, assembledAt], ...(readyQueue ? { readyQueue } : {}) } : undefined;
    const timing: NonNullable<MissionAttempt['timing']> = {
      queueMs: Math.max(0, Date.now() - Date.parse(task.queuedAt)),
      contextPreparationMs: assembledAt - compilingAt,
    };
    const resources = this.host.resources;
    const lease = resources?.acquire(executor.lane,
      { missionId: m.id, taskId: task.id, attemptId: id, timeoutMs: task.timeoutMs }, task.executor);
    if (resources && !lease) return false;
    if (queueKey) this.readyObservations.delete(queueKey);
    if (lease) context.resourceCheckpoint = lease.checkpointRequested;
    try {
      this.update(m.id, current => {
        const value = taskOf(current, task.id)!;
        check(value.state === 'queued' && value.attempts.length < value.maxAttempts, 'mission_dispatch_denied');
        const attempt: MissionAttempt = { id, executor: task.executor, admittedAt: stamp(), context: context.context.manifest, timing };
        value.state = 'running'; value.attempts.push(attempt);
        this.event(current, { kind: 'started', taskId: task.id, attemptId: id });
        if (lease) {
          attempt.resourceLease = lease.receipt;
          if (Buffer.byteLength(JSON.stringify(current)) > recordLimitBytes) delete attempt.resourceLease;
        }
        if (admission) {
          attempt.admission = admission;
          if (Buffer.byteLength(JSON.stringify(current)) > recordLimitBytes) delete attempt.admission;
        }
        if (phases) timing.phases = phases;
      });
    } catch (error) {
      lease?.release();
      throw error;
    }
    const timer = setTimeout(() => this.abort(id, 'timeout'), task.timeoutMs).unref();
    const started = performance.now();
    const settled = Promise.resolve().then(async () => {
      let evidence: MissionTask['attempts'][number]['evidence'];
      let verification: MissionTask['attempts'][number]['verification'];
      let telemetry: MissionTask['attempts'][number]['telemetry'];
      let reportedOutcome: 'blocked' | 'failed' | 'uncertain' | undefined;
      let detail: string | undefined;
      try {
        abort.signal.throwIfAborted();
        check(this.host.authorized(m.scope), 'mission_scope_revoked');
        const validateInputs = () => {
          context.validatePlanningContext?.();
          validateMissionContext(context.context, request, source);
          const current = this.lookup(m.id), checked = new Map<string, boolean>();
          for (const [i, dep] of task.dependencies.entries()) {
            const parent = taskOf(current, dep), attempt = parent?.attempts.at(-1);
            check(parent?.state === 'verified' && attempt?.evidence?.id === dependencies[i].id &&
              this.contextIsCurrent(current, parent, attempt, checked), 'mission_dependency_context_changed');
          }
        };
        const recheckingAt = performance.now();
        try { validateInputs(); }
        catch (error) { reportedOutcome = 'blocked'; detail = 'mission_context_unavailable'; throw error; }
        finally {
          const validatedAt = performance.now();
          timing.contextPreparationMs += validatedAt - recheckingAt;
          if (phases) phases.dispatchValidation = [recheckingAt, validatedAt];
        }
        const executingAt = performance.now();
        let result: Awaited<ReturnType<MissionExecutor['run']>>;
        try { result = await executor.run(context); }
        finally {
          const executedAt = performance.now();
          timing.executionMs = executedAt - executingAt;
          if (phases) phases.execution = [executingAt, executedAt];
        }
        telemetry = result.telemetry;
        const verifyingAt = performance.now();
        let verifyingEvidenceAt: number | undefined;
        try {
          try { validateInputs(); }
          catch (error) { reportedOutcome = executor.replaySafe || telemetry?.providerCalls === 0 ? 'blocked' : 'uncertain'; detail = 'mission_context_changed_during_execution'; throw error; }
          finally { if (phases) phases.postExecutionContextValidation = [verifyingAt, performance.now()]; }
          verifyingEvidenceAt = phases?.postExecutionContextValidation?.[1];
          check(bounded(result.source, 128) && JSON.stringify(result.value) !== undefined &&
            Buffer.byteLength(JSON.stringify(result.value)) <= 2048, 'invalid_mission_evidence');
          evidence = { source: result.source, value: result.value, id: randomUUID(), attemptId: id, observedAt: stamp() };
          reportedOutcome = result.outcome;
          const verdict = executor.verify(structuredClone(evidence), context);
          check(typeof verdict.passed === 'boolean' && bounded(verdict.detail, 160), 'invalid_mission_verification');
          verification = { ...verdict, criterion: task.criterion, evidenceIds: [evidence.id] };
          detail = verdict.detail;
        } finally {
          const verifiedAt = performance.now();
          timing.verificationMs = verifiedAt - verifyingAt;
          if (phases && verifyingEvidenceAt !== undefined) phases.verification = [verifyingEvidenceAt, verifiedAt];
        }
      } catch { detail ??= 'executor_failed_or_evidence_invalid'; }
      const cancellation = this.running.get(id)?.cancellation;
      const authorized = this.host.authorized(m.scope);
      const outcome = cancellation || !authorized ? (!executor.replaySafe ? 'uncertain' :
        !authorized ? 'blocked' : cancellation === 'user' ? 'cancelled' : 'failed') :
        reportedOutcome ?? (verification?.passed ? 'verified' : executor.replaySafe || evidence ? 'failed' : 'uncertain');
      this.update(m.id, current => {
        const value = taskOf(current, task.id)!;
        const attempt = value.attempts.at(-1)!;
        check(attempt.id === id, 'mission_attempt_changed');
        value.state = outcome; value.detail = cancellation ?? (!authorized ? 'mission_scope_revoked' : detail);
        attempt.outcome = outcome; attempt.finishedAt = stamp();
        attempt.timing = timing;
        if (authorized) attempt.telemetry = telemetry ??
          (executor.lane === 'native' ? { durationMs: performance.now() - started, providerCalls: 0 } : undefined);
        if (authorized && !cancellation && evidence) attempt.evidence = evidence;
        if (authorized && !cancellation && verification) attempt.verification = verification;
        const settlement = this.event(current, { kind: 'settled', taskId: task.id, attemptId: id, detail: outcome });
        if (outcome === 'verified' && !this.closed && !this.applyAutomaticReplan(current, value, id)) {
          attempt.outcome = 'blocked';
          settlement.detail = 'blocked';
        }
      });
    }).catch(() => { this.healthy = false; }).finally(() => {
      clearTimeout(timer); lease?.release(); this.running.delete(id); this.wake();
    });
    this.running.set(id, { missionId: m.id, task: plan, lane: executor.lane, abort, settled });
    return true;
  }
  private abort(id: string, reason: NonNullable<Running['cancellation']>) {
    const current = this.running.get(id);
    if (!current || current.cancellation) return;
    current.cancellation = reason; current.abort.abort();
  }
  async close() {
    this.closed = true;
    this.clearAdmissionDemand();
    for (const id of this.running.keys()) this.abort(id, 'close');
    await Promise.all([...this.running.values()].map(r => r.settled));
  }
}
