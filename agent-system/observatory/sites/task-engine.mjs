import { proposedTask, validateNewTask } from '../intake.mjs';
import { operationId, priorities, proposalControl } from './proposal-controls.mjs';
import { sha256 } from './task-telemetry.mjs';

export const taskEnginePath = '/api/task-engine/v1';
export const isTaskWorkerKey = value => typeof value==='string' && value.length>=32 && value.length<=256;
const idPattern = /^task_([a-f0-9-]+)$/;
const taskId = value => typeof value === 'string' && operationId.test(value.match(idPattern)?.[1] ?? '');
const scopeLimit = 500;
const claimLimit = 2;
const leaseMs = 60_000;
const maxAttempts = 3;
const defaultAttemptMinutes = 30;
const attemptLimit = lifecycle => lifecycle.max_attempt_minutes ?? defaultAttemptMinutes;
const terminal = new Set(['completed', 'failed', 'cancelled', 'superseded', 'archived']);
function safeReference(value) {
  if (typeof value !== 'string' || value.length > 1000 || !/^https:\/\/[^\s]+$/.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname && !url.username && !url.password && !url.search);
  } catch { return false; }
}
const refKinds = ['branch', 'commit', 'pull_request', 'review', 'ci_run', 'test', 'artifact', 'investigation'];
const sessionPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const agentCommands = new Set(['edit', 'associate']);
const claimStates = new Set(['admitted', 'queued', 'scheduled']);
const activeStates = new Set(['running', 'pausing', 'cancelling']);
const canConfigureExecution = lifecycle => lifecycle.executor === 'codex' &&
  (claimStates.has(lifecycle.state) || lifecycle.state === 'paused');
const failure = (status, error) => ({ status, body: { error } });
const success = (body, status = 200) => ({ status, body });
const timestamp = now => new Date(now).toISOString();
const record = row => JSON.parse(row.record);
const details = row => row.engine ? JSON.parse(row.engine) : {
  state: record(row).state, attempts: [], prerequisites: [], evidence: [],
};
const stateForV1 = {
  admitted: 'ready', scheduled: 'ready', queued: 'ready', pausing: 'running', cancelling: 'running',
  paused: 'blocked', completed: 'accepted', archived: 'cancelled',
};
const unique = items => [...new Set(items)];
const cycleAttempts = lifecycle => lifecycle.attempts.length - (lifecycle.cycle_start ?? 0);

function prerequisiteStatus(task,lifecycle,rows) {
  const dependencies=task.prerequisites.task_ids.map(id=>{
    const row=rows.get(id);
    const state=row?details(row).state:'missing';
    const acceptedArchive=state==='archived'&&record(row).owner_acceptance==='accepted';
    const status=state==='completed'||acceptedArchive?'satisfied':row?'unsatisfied':'unverified';
    return {type:'task',id,state,status};
  });
  return dependencies.concat(task.prerequisites.capabilities.map(id=>{
    const attested=lifecycle.prerequisites.includes(id);
    return {type:'capability',id,state:attested?'attested':'unsatisfied',status:attested?'satisfied':'unverified'};
  }));
}

function waitState(task,lifecycle,rows,now,checks) {
  if (!claimStates.has(lifecycle.state)) return {state:lifecycle.state,blockers:[]};
  const blockers=(checks??prerequisiteStatus(task,lifecycle,rows))
    .filter(check=>check.status!=='satisfied').map(({type,id,state})=>({type,id,state}));
  return {state:blockers.length?'blocked':lifecycle.start_at>now?'scheduled':'ready',blockers};
}

function hasCycle(id, task, rows) {
  const visited = new Set();
  const queue = [...task.prerequisites.task_ids];
  while (queue.length) {
    const next = queue.pop();
    if (next === id) return true;
    if (visited.has(next)) continue;
    visited.add(next);
    const dependency = rows.get(next);
    if (dependency) queue.push(...record(dependency).prerequisites.task_ids);
  }
  return false;
}

function exposeAttempt({ lease, ...attempt }) {
  return attempt;
}

export function taskAttemptRecord(task, attempt) {
  const states = { orphaned: 'failed', interrupted: 'blocked', paused: 'blocked' };
  return {
    schema_version: 1, record_type: 'attempt', id: attempt.id,
    repository: task.repository, revision: attempt.revision, task_id: task.id,
    attempt_number: attempt.attempt_number, started_at: attempt.started_at,
    created_at: attempt.started_at, state: states[attempt.state] ?? attempt.state,
    provider: attempt.executor,
    ...(attempt.finished_at ? { finished_at: attempt.finished_at } : {}),
    ...(attempt.failure ? { failure_category: 'environment', failure_diagnosis: attempt.failure } : {}),
    ...(attempt.branch ? { branch: attempt.branch } : {}),
  };
}

function publicLifecycle(row,rows,now,includePrerequisites=false) {
  const stored=details(row);
  const {attempts,event,cycle_start,...lifecycle}=stored;
  const task=record(row);
  const checks=includePrerequisites?prerequisiteStatus(task,lifecycle,rows):undefined;
  return {...lifecycle,cycle_attempts:cycleAttempts(stored),max_attempt_minutes:attemptLimit(stored),
    can_configure_execution:canConfigureExecution(stored),stored_state:lifecycle.state,
    ...waitState(task,lifecycle,rows,now,checks),...(checks?{prerequisite_status:checks}:{})};
}

function validateReferenceRevisions(requirements) {
  if ((requirements??[]).some(ref=>ref.revision!==undefined&&!revisionPattern.test(ref.revision))) {
    throw Error('Task requirement and input revisions must be 40-character Git hashes');
  }
}

function editTask(task, fields) {
  const input = validateNewTask(fields);
  validateReferenceRevisions(input.requirements);
  const previous = [...task.acceptance.criteria];
  const criteria = input.accept.map(({ description }) => {
    const index = previous.findIndex(item => item.description === description);
    return index >= 0 ? previous.splice(index, 1)[0] : { id: 'criterion-' + crypto.randomUUID(), description };
  });
  return {
    ...task, title: input.title, objective: input.objective,
    ...(input.requirements===undefined?{}:{requirements:input.requirements}),
    ...(input.deliverables===undefined?{}:{deliverables:input.deliverables}),
    classification: { ...task.classification, primary: input.primary },
    prerequisites: { task_ids: unique(input.ids), capabilities: unique(input.capabilities) },
    acceptance: { profile_id: input.profile, criteria },
  };
}

function reviewedEvidence(task, evidence, revision) {
  return Array.isArray(evidence) && evidence.length === task.acceptance.criteria.length &&
    task.acceptance.criteria.every(criterion => evidence.some(item =>
      item?.criterion_id === criterion.id && safeReference(item.uri) && item.revision === revision));
}

function executionSettings(lifecycle,action,now) {
  const start=action.start_at===undefined ? lifecycle.start_at??now
    : action.start_at===null ? now
    : typeof action.start_at==='string' ? Date.parse(action.start_at) : NaN;
  const minutes=action.max_attempt_minutes===undefined ? attemptLimit(lifecycle) : action.max_attempt_minutes;
  const cancel=action.cancel_with_dependency===undefined ? !!lifecycle.cancel_with_dependency : action.cancel_with_dependency;
  if (!Number.isFinite(start)) throw Error('Invalid execution start time');
  if (!Number.isSafeInteger(minutes) || minutes<1 || minutes>defaultAttemptMinutes) {
    throw Error('Maximum attempt duration must be a whole number from 1 to 30 minutes');
  }
  if (typeof cancel!=='boolean') throw Error('Invalid dependency cancellation policy');
  return {start_at:start,max_attempt_minutes:minutes,cancel_with_dependency:cancel};
}

function commandChange(task, lifecycle, { action, now, rows }) {
  const type = action?.type;
  const current = lifecycle.state;
  if (type === 'associate') {
    const { kind, uri, revision } = action.reference ?? {};
    const links = lifecycle.links ?? [];
    if (!refKinds.includes(kind) || !safeReference(uri) || typeof revision !== 'string' ||
        !revisionPattern.test(revision) || links.length >= 100) return failure(400, 'Invalid or excessive Task reference');
    const link = { kind, uri, revision };
    const exists = links.some(item => item.kind === kind && item.uri === uri && item.revision === revision);
    return { lifecycle: { ...lifecycle, links: exists ? links : [...links, link] } };
  }
  if (type === 'edit') {
    if (!['proposed', 'blocked'].includes(current) || lifecycle.executor) return failure(409, 'Only unadmitted Tasks can be edited');
    if (!priorities.includes(action.fields?.priority)) return failure(400, 'Invalid priority');
    try { return { task: editTask(task, action.fields), priority: action.fields.priority }; }
    catch (error) { return failure(400, error.message); }
  }
  if (type === 'admit' && ['proposed', 'blocked'].includes(current) && !lifecycle.executor) {
    if (action.executor !== 'codex') return failure(400, 'Unsupported executor');
    const prereqs=action.prerequisites??[];
    if (!Array.isArray(prereqs) || prereqs.length>100 ||
        !prereqs.every(item=>task.prerequisites.capabilities.includes(item))) {
      return failure(400,'Invalid capability prerequisites');
    }
    if (action.start_at===null) return failure(400,'Invalid execution start time');
    try {
      return {lifecycle:{...lifecycle,...executionSettings(lifecycle,action,now),state:'admitted',
        executor:action.executor,prerequisites:unique(prereqs)}};
    } catch (error) { return failure(400,error.message); }
  }
  if (type==='configure_execution' && canConfigureExecution(lifecycle)) {
    if (!['start_at','max_attempt_minutes','cancel_with_dependency'].some(key=>Object.hasOwn(action,key))) {
      return failure(400,'Choose an execution setting to update');
    }
    try { return {lifecycle:{...lifecycle,...executionSettings(lifecycle,action,now)}}; }
    catch (error) { return failure(400,error.message); }
  }
  if (type === 'satisfy' && ['admitted', 'queued', 'scheduled'].includes(current)) {
    if (!task.prerequisites.capabilities.includes(action.prerequisite)) return failure(400, 'Unknown prerequisite');
    return { lifecycle: { ...lifecycle, prerequisites: unique([...lifecycle.prerequisites, action.prerequisite]) } };
  }
  if (type === 'reject' && current === 'verifying') {
    if (typeof action.reason !== 'string' || !action.reason.trim() || action.reason.length > 500) return failure(400, 'Review reason required');
    const last = lifecycle.attempts.at(-1);
    last.state = 'failed';
    last.failure = action.reason.trim();
    return { lifecycle: { ...lifecycle, state: 'failed' } };
  }
  if (type === 'accept' && current === 'verifying') {
    const last = lifecycle.attempts.at(-1);
    if (!reviewedEvidence(task, action.evidence, last.candidate_revision)) return failure(409, 'Reviewed evidence is required for every criterion at the attempt revision');
    last.state = 'succeeded';
    return { task: { ...task, owner_acceptance: 'accepted' }, lifecycle: { ...lifecycle, state: 'completed',
      evidence: action.evidence.map(({ criterion_id, uri, revision }) => ({ criterion_id, uri, revision })) } };
  }
  if (type === 'retry' && current === 'failed' && cycleAttempts(lifecycle) > 0 && cycleAttempts(lifecycle) < maxAttempts) {
    if (typeof action.changed_assumption !== 'string' || !action.changed_assumption.trim() || action.changed_assumption.length > 500) {
      return failure(400, 'A changed assumption is required before retrying');
    }
    return { lifecycle: { ...lifecycle, state: 'queued', changed_assumption: action.changed_assumption.trim() } };
  }
  if (type === 'pause' && ['admitted', 'queued', 'scheduled', 'running'].includes(current)) {
    return { lifecycle: { ...lifecycle, state: current === 'running' ? 'pausing' : 'paused' } };
  }
  if (type === 'resume' && current === 'paused' && cycleAttempts(lifecycle) < maxAttempts) {
    const paused = lifecycle.attempts.at(-1);
    if (paused?.state === 'paused' && !(paused.session_id && paused.checkpoint_revision)) {
      return failure(409, 'Paused execution has no recoverable Codex checkpoint');
    }
    return { lifecycle: { ...lifecycle, state: 'queued', resume_attempt_id: paused?.state === 'paused' ? paused.id : undefined } };
  }
  if (type === 'cancel' && !terminal.has(current)) {
    const active = ['running', 'pausing', 'cancelling'].includes(current);
    return { lifecycle: { ...lifecycle, state: active ? 'cancelling' : 'cancelled' } };
  }
  if (type === 'supersede' && ['proposed', 'blocked', 'paused', 'failed'].includes(current)) {
    if (!taskId(action.successor) || action.successor === task.id || !rows.has(action.successor)) return failure(400, 'Unknown replacement Task');
    return { task: { ...task, superseded_by: action.successor }, lifecycle: { ...lifecycle, state: 'superseded' } };
  }
  if (type === 'reopen' && ['completed','archived'].includes(current) && task.owner_acceptance === 'accepted') {
    const accepted = lifecycle.attempts.at(-1);
    if (!accepted || accepted.state !== 'succeeded' || !revisionPattern.test(accepted.candidate_revision)) {
      return failure(409, 'An accepted candidate revision is required to reopen this Task');
    }
    if (typeof action.feedback !== 'string' || !action.feedback.trim() || action.feedback.length > 2000) {
      return failure(400, 'Owner feedback must contain 1 to 2000 characters');
    }
    return { task:{ ...task, owner_acceptance:'not_reviewed' }, lifecycle:{
      ...lifecycle, state:'queued', start_at:now, cycle_start:lifecycle.attempts.length,
      evidence:[], feedback:action.feedback.trim(), followup_revision:accepted.candidate_revision,
    } };
  }
  if (type === 'archive' && ['completed','proposed','blocked','failed','cancelled','superseded'].includes(current)) {
    return { lifecycle: { ...lifecycle, state: 'archived' } };
  }
  return failure(409, 'Invalid Task transition from ' + current);
}

function workerChange(lifecycle, body, now) {
  const active = lifecycle.attempts.at(-1);
  if (!active || active.id !== body.attempt_id || active.lease !== body.lease ||
      active.lease_until <= now || !activeStates.has(lifecycle.state)) {
    return failure(409, 'Attempt lease is stale or invalid');
  }
  const report = body.report;
  if (!report || !['heartbeat', 'finished', 'failed', 'stopped'].includes(report.type)) return failure(400, 'Invalid attempt report');
  if (report.session_id !== undefined && (typeof report.session_id !== 'string' ||
      !sessionPattern.test(report.session_id) || (active.session_id && active.session_id !== report.session_id))) {
    return failure(400, 'Invalid or changed executor session');
  }
  if (report.session_id) active.session_id = report.session_id;
  if (report.branch !== undefined && (typeof report.branch !== 'string' || report.branch.length > 200 ||
      !/^[\w/.-]+$/.test(report.branch) || (active.branch && active.branch !== report.branch))) {
    return failure(400, 'Invalid or changed workspace branch');
  }
  if (report.branch) active.branch = report.branch;
  if (report.type === 'heartbeat') {
    active.lease_until = Math.min(now + leaseMs, active.deadline);
    return { lifecycle };
  }
  if (report.type === 'finished' && lifecycle.state === 'running' && report.result === 'candidate') {
    if (typeof report.revision !== 'string' || !revisionPattern.test(report.revision)) return failure(400, 'Candidate revision required');
    active.candidate_revision = report.revision;
    active.state = 'verifying';
    active.finished_at = timestamp(now);
    return { lifecycle: { ...lifecycle, state: 'verifying' } };
  }
  if (report.type === 'stopped' && ['pausing', 'cancelling'].includes(lifecycle.state)) {
    const state = lifecycle.state === 'pausing' ? 'paused' : 'cancelled';
    if (typeof report.revision === 'string' && revisionPattern.test(report.revision)) active.checkpoint_revision = report.revision;
    active.state = state;
    active.finished_at = timestamp(now);
    return { lifecycle: { ...lifecycle, state } };
  }
  if (report.type === 'failed' && typeof report.failure === 'string' && report.failure.trim() && report.failure.length <= 500) {
    active.state = 'failed';
    active.failure = report.failure.trim();
    active.finished_at = timestamp(now);
    return { lifecycle: { ...lifecycle, state: 'failed' } };
  }
  return failure(409, 'Report conflicts with current Task state');
}

export async function readTaskRows({ db, owner, namespace, now = Date.now() }) {
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const result = await query('SELECT * FROM proposals WHERE owner_id = ? AND namespace = ? ORDER BY created_at DESC, task_id DESC',
    owner, namespace).all();
  return Promise.all(result.results.map(async row => {
    if (!row.engine) return row;
    const lifecycle = details(row);
    const attempt = lifecycle.attempts.at(-1);
    if (attempt?.state !== 'running' || attempt.lease_until > now) return row;

    attempt.state = 'orphaned';
    const deadlineReached = attempt.lease_until === attempt.deadline;
    attempt.failure = deadlineReached
      ? 'Attempt time limit reached. Reconcile possible effects before retrying.'
      : 'Executor lease expired. Reconcile possible effects before retrying.';
    attempt.finished_at = timestamp(now);
    lifecycle.state = 'failed';
    const version = row.version + 1;
    lifecycle.event = {
      operation_id: crypto.randomUUID(), digest: 'scheduler', kind: deadlineReached ? 'attempt_time_limit_reached' : 'lease_expired', actor: 'scheduler',
      reason: attempt.failure,
      version, state: 'failed', at: timestamp(now), attempt_id: attempt.id,
    };
    const next = { ...row, record: JSON.stringify({ ...record(row), state: 'failed' }), engine: JSON.stringify(lifecycle), version };
    const updated = await query(
      'UPDATE proposals SET record = ?, engine = ?, version = ? WHERE owner_id = ? AND namespace = ? AND task_id = ? AND version = ? RETURNING *',
      next.record, next.engine, version, owner, namespace, row.task_id, row.version,
    ).first();
    // A late heartbeat or another reader may have advanced the row first.
    return updated ?? await query(
      'SELECT * FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?', owner, namespace, row.task_id,
    ).first();
  }));
}

function taskForExecution(task,lifecycle) {
  if (!lifecycle.feedback) return task;
  return {...task, objective: task.objective+'\n\nOwner feedback for this follow-up attempt\n'+lifecycle.feedback};
}

export async function taskOperation({ db, owner, namespace, body, access, validate, revision, now = Date.now() }) {
  if (!body || !['list', 'get', 'register', 'command', 'claim', 'report'].includes(body.op)) return failure(400, 'Invalid Task operation');
  if (['claim', 'report'].includes(body.op) && access !== 'worker') return failure(403, 'Executor authorization required');
  if (body.op === 'command' && access !== 'owner' && !agentCommands.has(body.action?.type)) return failure(403, 'Owner action required');
  if (access === 'worker' && !['claim', 'report'].includes(body.op)) return failure(403, 'Executor scope does not allow this operation');
  if (!['list', 'get'].includes(body.op) && !operationId.test(body.operation_id)) return failure(400, 'Operation UUID required');
  if (['get', 'command', 'report'].includes(body.op) && !taskId(body.task_id)) return failure(400, 'Invalid Task ID');

  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const rows = new Map((await readTaskRows({ db, owner, namespace, now })).map(row => [row.task_id, row]));
  const currentRow = rows.get(body.task_id);
  const receipts = id => query('SELECT event FROM task_engine_events WHERE owner_id = ? AND namespace = ? AND task_id = ? ORDER BY version',
    owner, namespace, id).all();
  const view = async row => ({
    task: record(row), version: row.version, priority: row.priority, lifecycle: publicLifecycle(row, rows, now, true),
    attempts: details(row).attempts.map(exposeAttempt),
    events: [...proposalControl(row).history, ...(await receipts(row.task_id)).results
      .map(({ event }) => { const { digest, ...receipt } = JSON.parse(event); return receipt; })],
  });
  const summary = row => ({
    task: record(row), version: row.version, priority: row.priority, lifecycle: publicLifecycle(row, rows, now),
  });
  if (body.op === 'list') {
    const tasks = [...rows.values()].map(summary);
    return success({ tasks: tasks.filter(item => body.state === undefined
      ? body.include_archived === true || item.lifecycle.state !== 'archived' : item.lifecycle.state === body.state) });
  }
  if (body.op === 'get') return currentRow ? success(await view(currentRow)) : failure(404, 'Task not found');

  if (body.op === 'claim' && body.task_ids !== undefined && (!Array.isArray(body.task_ids) ||
      body.task_ids.length > scopeLimit || !body.task_ids.every(taskId))) return failure(400, 'Invalid executor Task scope');
  const digest = await sha256(JSON.stringify({ access, body }));
  const prior = await query('SELECT task_id, event FROM task_engine_events WHERE owner_id = ? AND namespace = ? AND operation_id = ?',
    owner, namespace, body.operation_id).first();
  if (prior) {
    const previous = JSON.parse(prior.event);
    if (previous.digest !== digest) return failure(409, 'Operation ID already used for a different request');
    const row = rows.get(prior.task_id);
    if (!row) return failure(409, 'Task changed during replay');
    if (body.op === 'claim') {
      const attempt = details(row).attempts.at(-1);
      if (attempt?.id !== previous.attempt_id || !activeStates.has(details(row).state) || attempt.lease_until <= now) return success({ claim: null });
      return success({ claim: { task: taskForExecution(record(row), details(row)), attempt: exposeAttempt(attempt), lease: attempt.lease } });
    }
    return success(await view(row));
  }

  const event = (operation_id, kind, version, state, attempt_id, eventDigest = digest) => ({
    operation_id, digest: eventDigest, kind, actor: access, version, state,
    at: timestamp(now), ...(attempt_id ? { attempt_id } : {}),
  });
  // Fence the complete graph snapshot, including concurrent legacy edits, registration and claims.
  const snapshot = () => JSON.stringify([...rows.values()].map(row => [row.task_id, row.version]));
  const unchangedGraph = `
    (SELECT COUNT(*) FROM proposals p WHERE p.owner_id = ? AND p.namespace = ?) = ?
    AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
      LEFT JOIN proposals p ON p.owner_id = ? AND p.namespace = ?
        AND p.task_id = json_extract(expected.value, '$[0]')
      WHERE p.version IS NOT json_extract(expected.value, '$[1]'))
  `;
  const snapshotArgs = () => [owner, namespace, rows.size, snapshot(), owner, namespace];
  const save = async (row, task, lifecycle, { priority = row.priority, kind, id = body.operation_id, eventDigest, attemptId, receipt = {}, fenceGraph = true } = {}) => {
    task = { ...task, state: stateForV1[lifecycle.state] ?? lifecycle.state };
    if (!validate(task)) return null;
    const version = row.version + 1;
    const next = { ...lifecycle, event: { ...event(id, kind, version, lifecycle.state, attemptId, eventDigest), ...receipt } };
    const guard = fenceGraph ? unchangedGraph : 'version = ?';
    const args = fenceGraph ? snapshotArgs() : [row.version];
    const result = await query(`
      UPDATE proposals SET record = ?, engine = ?, version = ?, priority = ?
      WHERE owner_id = ? AND namespace = ? AND task_id = ? AND github_state IS ? AND ${guard}
      RETURNING *
    `, JSON.stringify(task), JSON.stringify(next), version, priority, owner, namespace, row.task_id, row.github_state, ...args).first();
    if (result) rows.set(row.task_id, result);
    return result;
  };
  const conflict = () => failure(409, 'Task graph changed. Reload or replay the same operation ID.');

  if (body.op === 'register') {
    const id = 'task_' + body.operation_id;
    if (rows.has(id) || rows.size >= scopeLimit) return failure(409, 'Task ID already used or registry limit reached');
    const source = await revision();
    if (!source) return failure(503, 'Known repository revision required');
    let task;
    try {
      task = proposedTask(body.fields, source.revision ?? source, () => body.operation_id);
      validateReferenceRevisions(task.requirements);
    }
    catch (error) { return failure(400, error.message); }
    if (!validate(task) || task.prerequisites.task_ids.some(id => !taskId(id))) return failure(400, 'Invalid Task record');
    if (hasCycle(id, task, rows)) return failure(409, 'Dependency cycle');
    const priority = body.fields.priority ?? 'normal';
    if (!priorities.includes(priority)) return failure(400, 'Invalid priority');
    const lifecycle = { state: 'proposed', attempts: [], prerequisites: [], evidence: [], event: event(body.operation_id, 'register', 1, 'proposed') };
    const result = await query(`
      INSERT OR IGNORE INTO proposals (owner_id, namespace, task_id, created_at, record, engine, priority, stale_revision)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${unchangedGraph}
      RETURNING *
    `, owner, namespace, id, task.created_at, JSON.stringify(task), JSON.stringify(lifecycle), priority,
    Number(source.status === 'stale'), ...snapshotArgs()).first();
    return result ? success(await view(result), 201) : conflict();
  }

  if (body.op === 'claim') {
    const running = [...rows.values()].filter(row => details(row).attempts.at(-1)?.state === 'running');

    const admitted = [...rows.values()].filter(row => row.engine && details(row).executor === 'codex' &&
      claimStates.has(details(row).state));
    for (const row of admitted) {
      const lifecycle = details(row);
      const task = record(row);
      if (lifecycle.cancel_with_dependency && task.prerequisites.task_ids.some(id => rows.has(id) &&
          ['cancelled','archived','superseded'].includes(details(rows.get(id)).state) && record(rows.get(id)).owner_acceptance !== 'accepted')) {
        lifecycle.state = 'cancelled';
        if (!await save(row, task, lifecycle, { kind: 'dependency_cancelled', id: crypto.randomUUID(), eventDigest: 'scheduler' })) return conflict();
      }
    }
    if (running.length >= claimLimit) return success({ claim: null });
    const candidate = admitted.filter(row => !body.task_ids || body.task_ids.includes(row.task_id)).map(row => rows.get(row.task_id))
      .filter(row => waitState(record(row), details(row), rows, now).state === 'ready')
      .sort((a, b) => priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
        a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id))[0];
    if (!candidate) return success({ claim: null });
    const task = record(candidate);
    const lifecycle = details(candidate);
    const deadline = now + attemptLimit(lifecycle) * 60_000;
    const attempt = {
      id: 'attempt_' + crypto.randomUUID(), attempt_number: lifecycle.attempts.length + 1, executor: lifecycle.executor,
      revision: lifecycle.followup_revision ?? task.revision, state: 'running', started_at: timestamp(now), lease: crypto.randomUUID(),
      lease_until: Math.min(now + leaseMs, deadline), deadline,
    };
    const checkpoint = lifecycle.attempts.find(item => item.id === lifecycle.resume_attempt_id);
    if (checkpoint?.session_id && checkpoint.checkpoint_revision) {
      attempt.resume_session_id = checkpoint.session_id;
      attempt.revision = checkpoint.checkpoint_revision;
    }
    delete lifecycle.resume_attempt_id;
    lifecycle.state = 'running';
    lifecycle.attempts.push(attempt);
    if (!await save(candidate, task, lifecycle, { kind: 'claim', attemptId: attempt.id })) return conflict();
    return success({ claim: { task: taskForExecution(record(rows.get(candidate.task_id)),lifecycle), attempt: exposeAttempt(attempt), lease: attempt.lease } });
  }

  if (!currentRow) return failure(404, 'Task not found');
  if (currentRow.github_state && !currentRow.engine &&
      (currentRow.github_state !== 'published' || body.action?.type !== 'admit')) {
    return failure(409, 'Published proposal must be admitted before execution controls are available');
  }
  if (body.op === 'command' && body.expected_version !== currentRow.version) return conflict();
  const task = record(currentRow);
  const lifecycle = details(currentRow);
  const change = body.op === 'command'
    ? commandChange(task, lifecycle, { action: body.action, now, rows })
    : workerChange(lifecycle, body, now);
  if (change.status) return change;
  const nextTask = change.task ?? task;
  if (nextTask.prerequisites.task_ids.some(id => !taskId(id))) return failure(400, 'Invalid dependency ID');
  if (['admit', 'edit'].includes(body.action?.type) && hasCycle(task.id, nextTask, rows)) return failure(409, 'Dependency cycle');
  const action = body.action;
  const latest = lifecycle.attempts.at(-1);
  const receipt = {
    ...(['admit','configure_execution'].includes(action?.type) ? { max_attempt_minutes:attemptLimit(change.lifecycle),
      start_at:timestamp(change.lifecycle.start_at),cancel_with_dependency:change.lifecycle.cancel_with_dependency } : {}),
    ...(['reject','retry'].includes(action?.type) ? { reason:(action.reason??action.changed_assumption).trim() } : {}),
    ...(action?.type === 'edit' ? { fields:[
      ...['title','objective','classification','prerequisites','requirements','deliverables','acceptance'].filter(key =>
        JSON.stringify(task[key]) !== JSON.stringify(nextTask[key])),
      ...(change.priority!==currentRow.priority?['priority']:[]),
    ] } : {}),
    ...(action?.type === 'associate' ? { reference:{
      kind:action.reference.kind, uri:action.reference.uri, revision:action.reference.revision,
    } } : {}),
    ...(action?.type === 'reopen' ? { feedback:change.lifecycle.feedback, revision:change.lifecycle.followup_revision,
      evidence:lifecycle.evidence } : {}),
    ...(action?.type === 'accept' ? { revision:latest.candidate_revision, evidence:change.lifecycle.evidence } : {}),
  };
  const updated = await save(currentRow, nextTask, change.lifecycle ?? lifecycle, {
    priority: change.priority, kind: action?.type ?? body.report.type, receipt,
    attemptId:body.attempt_id ?? (['accept','reject','reopen'].includes(action?.type)?latest?.id:undefined),
    fenceGraph: body.op !== 'report',
  });
  return updated ? success(await view(updated)) : conflict();
}
