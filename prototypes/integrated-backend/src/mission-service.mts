import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compileMissionContext, createMissionContextCache, validateMissionContext, validateMissionContextSources,
  type MissionContextSource } from '../../vela-core/src/mission-context.mts';
import { historyDigest } from '../../vela-core/src/bounded-history.mts';
import { ServiceError } from './contracts.mts';
import { missionMeasurementAnswer } from './mission-native.mts';
import { buildMissionRevision } from './mission-revision.mts';
import { MISSION_CONTRACT, MISSION_LIMITS as L, type Mission, type MissionControl, type MissionEvent,
  type MissionExecutionContext, type MissionExecutor, type MissionPlan, type MissionProjection,
  type MissionAttempt, type MissionRevisionChange, type MissionRevisionPreview, type MissionScope, type MissionTask,
  type MissionTaskPlan, type MissionWorkroom, type MissionWorkroomResource } from './mission-contracts.mts';

export interface MissionServiceHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  authorized(scope: MissionScope): boolean;
  executors: Readonly<Record<string, MissionExecutor>>;
  laneLimit(lane: string): number;
  underPressure(): boolean;
  contextSource?(mission: Mission, task: MissionTaskPlan): MissionContextSource | undefined;
  reassign?(mission: Mission, task: MissionTask, agentProfileId: string): MissionTaskPlan['specialist'];
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
const recordLimitBytes = 160 * 1024;

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
  private readonly contextCache = createMissionContextCache();
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
      CREATE INDEX IF NOT EXISTS vela_missions_scope ON vela_missions(scope_key);
      CREATE INDEX IF NOT EXISTS vela_missions_workroom ON vela_missions(json_extract(json,'$.workroom.workspaceId'));`);
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
    check(typeof json === 'string' && Buffer.byteLength(json) <= recordLimitBytes, 'invalid_mission_record');
    const m = JSON.parse(json) as Mission;
    check(m.contract === MISSION_CONTRACT, 'unsupported_mission_contract');
    return m;
  }
  private event(m: Mission, event: Omit<MissionEvent, 'seq' | 'time'>) {
    check(m.events.length < L.events, 'mission_journal_full');
    const recorded = { ...event, seq: ++m.revision, time: stamp() };
    m.events.push(recorded);
    return recorded;
  }
  private store(m: Mission) {
    const json = JSON.stringify(m);
    check(Buffer.byteLength(json) <= recordLimitBytes, 'mission_record_full');
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
      this.host.authorized(scope) && this.host.authorized(m.scope), 'mission_not_found');
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

  workroomResource(resourceId: string, scope: MissionScope): MissionWorkroomResource | null {
    if (!this.host.authorized(scope)) return null;
    const row = this.host.db.prepare(`SELECT json FROM vela_missions
      WHERE json_extract(json,'$.workroom.workspaceId')=?
        AND json_extract(json,'$.scope.projectId') IS ? LIMIT 1`).get(scope.workspaceId, scope.projectId);
    if (!row) return null;
    const mission = this.decode(row.json);
    const workroom = mission.workroom!;
    const checklist = workroom.missionChecklistResourceId === resourceId;
    if (!this.host.authorized(mission.scope) || (!checklist && workroom.missionTimelineResourceId !== resourceId)) return null;
    const { id, outcome, revision, tasks, events } = this.project(mission);
    const binding = { kind: 'workroom-resource' as const, missionId: id, outcome, revision };
    return checklist
      ? { ...binding, checklist: tasks.map(task => ({ taskId: task.id, title: task.objective, state: task.state })) }
      : { ...binding, timeline: events };
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
      this.event(value, { kind: 'control', detail: control.type, ...(task ? { taskId: task.id } : {}) });
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
    check(Buffer.byteLength(JSON.stringify(amended)) <= recordLimitBytes, 'mission_record_full');
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
  private contextIsCurrent(m: Mission, task: MissionTask, attempt: MissionAttempt, checked: Map<string, boolean>): boolean {
    const cached = checked.get(attempt.id);
    if (cached !== undefined) return cached;
    checked.set(attempt.id, false);
    const { context } = attempt;
    try {
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
    const allTasks = [...m.tasks, ...(m.retiredTasks ?? [])];
    const attempts = allTasks.flatMap(task => task.attempts);
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
    const answer = missionMeasurementAnswer(m.tasks);
    return { ...m, outcome, ...(answer.length ? { answer } : {}), waits, profile: {
      elapsedMs: Math.max(0, ended - Date.parse(m.createdAt)) + (m.planning?.durationMs ?? 0), peakWorkers, attempts: attempts.length,
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
    const compilingAt = performance.now();
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
      const validateDependencies = () => {
        const checked = new Map<string, boolean>();
        for (const dep of task.dependencies) {
          const parent = taskOf(m, dep)!;
          check(this.contextIsCurrent(m, parent, parent.attempts.at(-1)!, checked), 'mission_dependency_context_changed');
        }
      };
      validateDependencies();
      const pkg = compileMissionContext(request, source, this.contextCache);
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
    const timing: NonNullable<MissionAttempt['timing']> = {
      queueMs: Math.max(0, Date.now() - Date.parse(task.queuedAt)),
      contextPreparationMs: performance.now() - compilingAt,
    };
    this.update(m.id, current => {
      const value = taskOf(current, task.id)!;
      check(value.state === 'queued' && value.attempts.length < value.maxAttempts, 'mission_dispatch_denied');
      value.state = 'running'; value.attempts.push({ id, executor: task.executor, admittedAt: stamp(), context: context.context.manifest, timing });
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
        const validateInputs = () => {
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
        finally { timing.contextPreparationMs += performance.now() - recheckingAt; }
        const executingAt = performance.now();
        const result = await executor.run(context).finally(() => { timing.executionMs = performance.now() - executingAt; });
        telemetry = result.telemetry;
        const verifyingAt = performance.now();
        try { validateInputs(); }
        catch (error) { reportedOutcome = executor.replaySafe ? 'blocked' : 'uncertain'; detail = 'mission_context_changed_during_execution'; throw error; }
        check(bounded(result.source, 128) && JSON.stringify(result.value) !== undefined &&
          Buffer.byteLength(JSON.stringify(result.value)) <= 2048, 'invalid_mission_evidence');
        evidence = { source: result.source, value: result.value, id: randomUUID(), attemptId: id, observedAt: stamp() };
        reportedOutcome = result.outcome;
        const verdict = executor.verify(structuredClone(evidence), context);
        check(typeof verdict.passed === 'boolean' && bounded(verdict.detail, 160), 'invalid_mission_verification');
        verification = { ...verdict, criterion: task.criterion, evidenceIds: [evidence.id] };
        timing.verificationMs = performance.now() - verifyingAt;
        detail = verdict.detail;
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
