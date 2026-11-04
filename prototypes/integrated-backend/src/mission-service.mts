import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compileMissionContext, validateMissionContext, type MissionContextSource } from '../../vela-core/src/mission-context.mts';
import { ServiceError } from './contracts.mts';
import { MISSION_CONTRACT, MISSION_LIMITS as L, type Mission, type MissionControl, type MissionEvent,
  type MissionExecutionContext, type MissionExecutor, type MissionPlan, type MissionProjection,
  type MissionScope, type MissionTask, type MissionTaskPlan, type MissionWorkroom } from './mission-contracts.mts';

export interface MissionServiceHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  authorized(scope: MissionScope): boolean;
  executors: Readonly<Record<string, MissionExecutor>>;
  laneLimit(lane: string): number;
  underPressure(): boolean;
  contextSource?(mission: Mission, task: MissionTaskPlan): MissionContextSource | undefined;
  replan?(mission: Mission, task: MissionTask): { additions: MissionTaskPlan[]; dependents: Record<string, string[]>; reason: string } | undefined;
  observe?(mission: Mission, event: MissionEvent): void;
}

const check: (ok: unknown, code: string) => asserts ok = (ok, code) => { if (!ok) throw new ServiceError(code); };
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[\w.:-]{1,120}$/.test(s);
const bounded = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && Buffer.byteLength(s) <= max;
const stamp = () => new Date().toISOString();
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const makeTask = (plan: MissionTaskPlan): MissionTask => ({ ...plan, queuedAt: stamp(), state: 'queued', priority: 0, attempts: [] });
const own = (table: object, key: string) => Object.hasOwn(table, key);
const blockedState = (task: MissionTask) => ['failed', 'uncertain', 'cancelled', 'blocked'].includes(task.state);
const scheduled = (m: Mission) => m.disposition === 'active' && m.tasks.some(task => task.state === 'queued');
const taskOf = (m: Mission, id: string) => m.tasks.find(task => task.id === id);
const sameScope = (a: MissionScope, b: MissionScope) => a.workspaceId === b.workspaceId && a.projectId === b.projectId;
const busy = (m: Mission) => m.tasks.some(task => task.state === 'running' || task.state === 'cancelling');
const active = (m: Mission) => busy(m) || m.disposition !== 'cancelled' && m.tasks.some(task => task.state === 'queued');

export function validateMissionPlan(plan: MissionPlan, executors: MissionServiceHost['executors']): void {
  check(plan && bounded(plan.objective, 4096) && plan.scope && identifier(plan.scope.workspaceId) &&
    (plan.scope.projectId === null || identifier(plan.scope.projectId)), 'invalid_mission_scope');
  check(Array.isArray(plan.criteria) && plan.criteria.length > 0 && plan.criteria.length <= L.tasks &&
    plan.criteria.every(x => identifier(x)) && new Set(plan.criteria).size === plan.criteria.length, 'invalid_mission_criteria');
  check(Array.isArray(plan.tasks) && plan.tasks.length > 0 && plan.tasks.length <= L.tasks, 'invalid_mission_tasks');
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
  private closed = false;
  private healthy = true;
  private scheduled = false;
  private wakeTimer?: NodeJS.Timeout;
  private lastAdmitted = new Map<string, number>();
  private turn = 0;
  private readonly host: MissionServiceHost;

  constructor(host: MissionServiceHost) {
    this.host = host;
    host.atomic(() => {
      host.db.exec(`CREATE TABLE IF NOT EXISTS vela_missions (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL,
        scope_key TEXT NOT NULL, pending INTEGER NOT NULL CHECK(pending IN (0,1)),
        active INTEGER NOT NULL CHECK(active IN (0,1)), json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS vela_missions_pending ON vela_missions(pending);
      CREATE INDEX IF NOT EXISTS vela_missions_scope ON vela_missions(scope_key);`);
      for (const row of host.db.prepare('SELECT json FROM vela_missions WHERE active=1').all()) {
        const m = this.decode(row.json);
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
        this.store(m);
      }
    });
  }

  private decode(json: unknown): Mission {
    check(typeof json === 'string' && Buffer.byteLength(json) <= 160 * 1024, 'invalid_mission_record');
    const m = JSON.parse(json) as Mission;
    check(m.contract === MISSION_CONTRACT, 'unsupported_mission_contract');
    return m;
  }
  private event(m: Mission, event: Omit<MissionEvent, 'seq' | 'time'>) {
    check(m.events.length < L.events, 'mission_journal_full');
    m.events.push({ ...event, seq: ++m.revision, time: stamp() });
  }
  private store(m: Mission) {
    const json = JSON.stringify(m);
    check(Buffer.byteLength(json) <= 160 * 1024, 'mission_record_full');
    this.host.db.prepare('UPDATE vela_missions SET pending=?,active=?,json=? WHERE id=?')
      .run(Number(scheduled(m)), Number(active(m)), json, m.id);
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
      change(value); this.store(value); return value;
    });
    this.notify(m, before);
    return m;
  }
  private requireOpen() { check(!this.closed && this.healthy, 'mission_scheduler_unavailable'); }
  private requireAccess(m: Mission, scope: MissionScope) {
    check((sameScope(m.scope, scope) || m.workroom?.workspaceId === scope.workspaceId && m.scope.projectId === scope.projectId) &&
      this.host.authorized(scope), 'mission_not_found');
  }
  private capacity() {
    check(Number(this.host.db.prepare('SELECT count(*) AS n FROM vela_missions WHERE active=1').get()!.n) < L.active,
      'mission_queue_full');
  }

  create(requestId: string, plan: MissionPlan): MissionProjection {
    this.requireOpen();
    check(identifier(requestId), 'invalid_mission_request');
    validateMissionPlan(plan, this.host.executors);
    check(this.host.authorized(plan.scope), 'mission_scope_denied');
    const fingerprint = digest(plan);
    let created = false;
    const m = this.host.atomic(() => {
      const existing = this.host.db.prepare('SELECT request_digest,json FROM vela_missions WHERE request_id=?').get(requestId);
      if (existing) {
        const value = this.decode(existing.json);
        this.requireAccess(value, plan.scope);
        check(existing.request_digest === fingerprint, 'mission_request_conflict');
        return value;
      }
      this.capacity();
      check(Number(this.host.db.prepare('SELECT count(*) AS n FROM vela_missions').get()!.n) < L.missions, 'mission_store_full');
      const value: Mission = { contract: MISSION_CONTRACT, id: randomUUID(), requestId, objective: plan.objective, scope: plan.scope,
        criteria: [...plan.criteria], createdAt: stamp(), disposition: 'active', revision: 0, planRevision: 1, concurrency: 2,
        tasks: plan.tasks.map(makeTask), events: [], ...(plan.planning ? { planning: plan.planning } : {}),
        ...(plan.team ? { team: plan.team } : {}),
        ...(plan.originConversationId ? { originConversationId: plan.originConversationId } : {}) };
      this.event(value, { kind: 'created' });
      this.host.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,1,1,?)')
        .run(value.id, requestId, fingerprint, digest(value.scope), JSON.stringify(value));
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
  list(scope: MissionScope): Pick<MissionProjection, 'id' | 'objective' | 'outcome' | 'createdAt' | 'revision'>[] {
    check(this.host.authorized(scope), 'mission_scope_denied');
    return this.host.db.prepare(`SELECT json FROM vela_missions WHERE scope_key=?
      OR (json_extract(json,'$.workroom.workspaceId')=? AND json_extract(json,'$.scope.projectId') IS ?)
      ORDER BY rowid DESC LIMIT ?`)
      .all(digest(scope), scope.workspaceId, scope.projectId, L.missions).map(row => {
        const { id, objective, outcome, createdAt, revision } = this.project(this.decode(row.json));
        return { id, objective, outcome, createdAt, revision };
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
      check(value.disposition !== 'cancelled' && !value.tasks.every(t => t.state === 'verified'), 'mission_terminal');
      switch (control.type) {
        case 'pause': check(value.disposition === 'active', 'mission_not_active'); value.disposition = 'paused'; break;
        case 'resume': check(value.disposition === 'paused', 'mission_not_paused'); value.disposition = 'active'; break;
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
          check(task && (task.state === 'failed' || task.state === 'blocked') && task.attempts.length < task.maxAttempts &&
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
      this.event(value, { kind: 'control', detail: control.type, ...(task ? { taskId: task.id } : {}) });
    });
    for (const attempt of aborts) this.abort(attempt, 'user');
    this.wake();
    return this.project(m);
  }

  /** Host-only amendment: never changes acceptance, started work, or existing capabilities. */
  revise(id: string, scope: MissionScope, revision: number, additions: MissionTaskPlan[], reason: string, dependents: Record<string, string[]> = {}) {
    this.requireOpen();
    const m = this.update(id, value => {
      this.requireAccess(value, scope);
      check(value.revision === revision, 'mission_revision_changed');
      check(value.disposition !== 'cancelled' && Array.isArray(additions) && additions.length > 0 && bounded(reason, 160) &&
        value.events.filter(e => e.kind === 'revised').length < L.revisions, 'mission_revision_denied');
      check(additions.every(task => value.tasks.some(existing => existing.executor === task?.executor &&
        task.claims?.every(claim => existing.claims.some(current => current.resource === claim.resource &&
          (current.mode === 'exclusive' || claim.mode === 'read'))))), 'mission_revision_expands_authority');
      for (const [id, added] of Object.entries(dependents)) {
        const task = taskOf(value, id);
        check(task?.state === 'queued' && !task.attempts.length && Array.isArray(added) &&
          added.every(dep => additions.some(t => t.id === dep)), 'mission_revision_dependency_denied');
        task.dependencies.push(...added);
      }
      validateMissionPlan({ ...value, tasks: [...value.tasks, ...additions] }, this.host.executors);
      if (!active(value)) this.capacity();
      value.tasks.push(...additions.map(makeTask));
      value.planRevision++;
      this.event(value, { kind: 'revised', detail: reason });
    });
    this.wake();
    return this.project(m);
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
  private project(m: Mission): MissionProjection {
    const outcome = m.tasks.some(t => t.state === 'cancelling') ? 'cancelling' :
      busy(m) ? 'running' : m.tasks.some(t => t.state === 'uncertain') ? 'uncertain' :
      m.disposition === 'cancelled' ? 'cancelled' : m.tasks.every(t => t.state === 'verified') ? 'verified' :
      m.disposition === 'paused' ? 'paused' :
      m.tasks.some(t => t.state === 'failed') ? 'failed' :
      m.tasks.some(t => t.state === 'blocked' || t.state === 'cancelled') ? 'blocked' : 'queued';
    const waits: MissionProjection['waits'] = {};
    for (const task of m.tasks) if (task.state === 'queued') {
      const executor = own(this.host.executors, task.executor) ? this.host.executors[task.executor] : undefined;
      if (!task.dependencies.every(id => taskOf(m, id)?.state === 'verified')) waits[task.id] = 'dependencies';
      else if (this.conflict(task)) waits[task.id] = 'resource-conflict';
      else if (executor && !this.capacityFor(m, executor.lane)) waits[task.id] = 'capacity';
      else if (this.host.underPressure()) waits[task.id] = 'resource-pressure';
    }
    const attempts = m.tasks.flatMap(task => task.attempts);
    const expectedRemote = attempts.filter(attempt => this.host.executors[attempt.executor]?.lane !== 'native');
    const usage = expectedRemote.flatMap(attempt => attempt.telemetry?.usage ? [attempt.telemetry.usage] : []);
    if (m.planning?.usage) usage.push(m.planning.usage);
    const reportedTotalTokens = usage.length ? usage.reduce((total, reading) => total + reading.totalTokens, 0) : null;
    const providerCalls = expectedRemote.every(attempt => attempt.telemetry) ?
      expectedRemote.reduce((total, attempt) => total + attempt.telemetry!.providerCalls, m.planning ? 1 : 0) : null;
    let peakWorkers = 0, admitted = 0;
    for (const event of m.events) {
      if (event.kind === 'started') peakWorkers = Math.max(peakWorkers, ++admitted);
      if (event.attemptId && (event.kind === 'settled' || event.kind === 'recovered')) admitted--;
    }
    const ended = ['queued', 'running', 'cancelling'].includes(outcome) ? Date.now() : Date.parse(m.events.at(-1)!.time);
    return { ...m, outcome, waits, profile: {
      elapsedMs: Math.max(0, ended - Date.parse(m.createdAt)) + (m.planning?.durationMs ?? 0), peakWorkers, attempts: attempts.length,
      retries: m.tasks.reduce((total, task) => total + Math.max(0, task.attempts.length - 1), 0),
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
    const missions = rows.map(row => this.decode(row.json));
    if (!missions.length) return;
    if (this.host.underPressure()) {
      this.wakeTimer ??= setTimeout(() => { this.wakeTimer = undefined; this.wake(); }, 1500).unref();
      return;
    }
    missions.sort((a, b) => (this.lastAdmitted.get(a.id) ?? 0) - (this.lastAdmitted.get(b.id) ?? 0));
    for (const m of missions) {
      if (this.running.size >= L.workers) return;
      const queued = m.tasks.filter(t => t.state === 'queued').sort((a, b) =>
        a.queuedAt.slice(0, 16).localeCompare(b.queuedAt.slice(0, 16)) || b.priority - a.priority);
      for (const task of queued) {
        if (task.dependencies.some(id => blockedState(taskOf(m, id)!))) continue; // Preserve downstream work for a verified retry.
        if (!task.dependencies.every(id => taskOf(m, id)?.state === 'verified')) continue;
        const executor = own(this.host.executors, task.executor) ? this.host.executors[task.executor] : undefined;
        if (!this.host.authorized(m.scope) || !executor?.available(m.scope, task)) {
          this.update(m.id, current => {
            const t = taskOf(current, task.id)!;
            t.state = 'blocked'; t.detail = 'executor_or_scope_unavailable';
            this.event(current, { kind: 'settled', taskId: t.id, detail: t.detail });
          });
          continue;
        }
        if (!this.capacityFor(m, executor.lane) || this.conflict(task)) continue;
        this.start(m, task, executor);
        this.lastAdmitted.set(m.id, ++this.turn);
        this.wake();
        break;
      }
    }
  }

  private start(m: Mission, task: MissionTask, executor: MissionExecutor) {
    const id = randomUUID();
    const abort = new AbortController();
    const dependencies = task.dependencies.map(dep => taskOf(m, dep)!.attempts.at(-1)!.evidence!);
    const { attempts: _attempts, queuedAt: _queued, state: _state, priority: _priority, detail: _detail, ...plan } = task;
    const source = this.host.contextSource?.(m, plan);
    const request = { missionId: m.id, revision: m.planRevision, taskId: task.id, scope: m.scope,
      missionObjective: m.objective, taskObjective: task.objective, criteria: m.criteria, dependencyTaskIds: task.dependencies,
      dependencies: dependencies.map((e, i) => ({ taskId: task.dependencies[i], evidenceId: e.id,
        source: e.source, attemptId: e.attemptId, observedAt: e.observedAt, value: e.value })), maxTokens: 48 * 1024 };
    let context: MissionExecutionContext;
    try {
      const pkg = compileMissionContext(request, source);
      context = { missionId: m.id, task: plan, scope: m.scope, attemptId: id, dependencies, context: pkg, signal: abort.signal };
    } catch {
      this.update(m.id, current => {
        const value = taskOf(current, task.id)!;
        value.state = 'blocked'; value.detail = 'mission_context_unavailable';
        this.event(current, { kind: 'settled', taskId: task.id, detail: value.detail });
      });
      this.wake();
      return;
    }
    this.update(m.id, current => {
      const value = taskOf(current, task.id)!;
      check(value.state === 'queued' && value.attempts.length < value.maxAttempts, 'mission_dispatch_denied');
      value.state = 'running'; value.attempts.push({ id, executor: task.executor, admittedAt: stamp(), context: context.context.manifest });
      this.event(current, { kind: 'started', taskId: task.id, attemptId: id });
    });
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
        validateMissionContext(context.context, request, source);
        const result = await executor.run(context);
        check(bounded(result.source, 128) && JSON.stringify(result.value) !== undefined &&
          Buffer.byteLength(JSON.stringify(result.value)) <= 2048, 'invalid_mission_evidence');
        evidence = { source: result.source, value: result.value, id: randomUUID(), attemptId: id, observedAt: stamp() };
        telemetry = result.telemetry;
        reportedOutcome = result.outcome;
        const verdict = executor.verify(structuredClone(evidence), context);
        check(typeof verdict.passed === 'boolean' && bounded(verdict.detail, 160), 'invalid_mission_verification');
        verification = { ...verdict, criterion: task.criterion, evidenceIds: [evidence.id] };
        detail = verdict.detail;
      } catch { detail = 'executor_failed_or_evidence_invalid'; }
      const cancellation = this.running.get(id)?.cancellation;
      const authorized = this.host.authorized(m.scope);
      const outcome = cancellation || !authorized ? (!executor.replaySafe ? 'uncertain' :
        !authorized ? 'blocked' : cancellation === 'user' ? 'cancelled' : 'failed') :
        reportedOutcome ?? (verification?.passed ? 'verified' : executor.replaySafe || evidence ? 'failed' : 'uncertain');
      const next = this.update(m.id, current => {
        const value = taskOf(current, task.id)!;
        const attempt = value.attempts.at(-1)!;
        check(attempt.id === id, 'mission_attempt_changed');
        value.state = outcome; value.detail = cancellation ?? (!authorized ? 'mission_scope_revoked' : detail);
        attempt.outcome = outcome; attempt.finishedAt = stamp();
        if (authorized) attempt.telemetry = telemetry ??
          (executor.lane === 'native' ? { durationMs: performance.now() - started, providerCalls: 0 } : undefined);
        if (authorized && !cancellation && evidence) attempt.evidence = evidence;
        if (authorized && !cancellation && verification) attempt.verification = verification;
        this.event(current, { kind: 'settled', taskId: task.id, attemptId: id, detail: outcome });
      });
      if (outcome === 'verified' && !this.closed) {
        const amendment = this.host.replan?.(next, taskOf(next, task.id)!);
        if (amendment) this.revise(next.id, next.scope, next.revision, amendment.additions, amendment.reason, amendment.dependents);
      }
    }).catch(() => { this.healthy = false; }).finally(() => {
      clearTimeout(timer); this.running.delete(id); this.wake();
    });
    this.running.set(id, { missionId: m.id, task: plan, lane: executor.lane, abort, settled });
  }
  private abort(id: string, reason: NonNullable<Running['cancellation']>) {
    const current = this.running.get(id);
    if (!current || current.cancellation) return;
    current.cancellation = reason; current.abort.abort();
  }
  async close() {
    this.closed = true;
    clearTimeout(this.wakeTimer);
    for (const id of this.running.keys()) this.abort(id, 'close');
    await Promise.all([...this.running.values()].map(r => r.settled));
  }
}
