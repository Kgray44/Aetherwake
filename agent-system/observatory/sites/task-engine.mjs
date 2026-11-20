import { proposedTask, validateNewTask } from '../intake.mjs';
import { operationId, priorities, proposalControl } from './proposal-controls.mjs';
import { sha256 } from './task-telemetry.mjs';

export const taskEnginePath = '/api/task-engine/v1';
const idPattern = /^task_([a-f0-9-]+)$/;
const taskId = value => typeof value === 'string' && operationId.test(value.match(idPattern)?.[1] ?? '');
const scopeLimit = 500;
const claimLimit = 2;
const leaseMs = 60_000;
const maxAttempts = 3;
const attemptTimeoutMs = 30 * 60_000;
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
const requirementKinds = ['git', 'requirement', 'document', 'artifact', 'issue', 'pull_request', 'url'];
const revisionPattern = /^[a-f0-9]{40}$/;
const agentCommands = new Set(['edit', 'associate']);
const claimStates = new Set(['admitted', 'queued', 'scheduled']);
const activeStates = new Set(['running', 'pausing', 'cancelling']);
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

function waitState(task, lifecycle, rows, now) {
  if (!claimStates.has(lifecycle.state)) return { state: lifecycle.state, blockers: [] };
  const blockers = task.prerequisites.task_ids.flatMap(id => {
    const dependency = rows.get(id);
    const state = dependency ? details(dependency).state : 'missing';
    return state === 'completed' ? [] : [{ type: 'task', id, state }];
  }).concat(task.prerequisites.capabilities.filter(id => !lifecycle.prerequisites.includes(id))
    .map(id => ({ type: 'capability', id, state: 'unsatisfied' })));
  if (blockers.length) return { state: 'blocked', blockers };
  return { state: lifecycle.start_at > now ? 'scheduled' : 'ready', blockers };
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

function publicLifecycle(row, rows, now) {
  const { attempts, event, ...lifecycle } = details(row);
  return { ...lifecycle, stored_state: lifecycle.state, ...waitState(record(row), lifecycle, rows, now) };
}

function requirementReferences(fields) {
  const references = fields.requirements;
  if (references === undefined) return undefined;
  if (!Array.isArray(references) || references.length > 50 || !references.every(ref =>
    ref && requirementKinds.includes(ref.kind) && typeof ref.uri === 'string' && ref.uri.trim() &&
    ref.uri.length <= 1000 && (ref.revision === undefined ||
      (typeof ref.revision === 'string' && revisionPattern.test(ref.revision))))) {
    throw Error('Invalid requirement references');
  }
  return references.map(({ kind, uri, revision }) => ({ kind, uri: uri.trim(), ...(revision ? { revision } : {}) }));
}

function editTask(task, fields) {
  const requirements = requirementReferences(fields);
  const input = validateNewTask(fields);
  const previous = [...task.acceptance.criteria];
  const criteria = input.accept.map(({ description }) => {
    const index = previous.findIndex(item => item.description === description);
    return index >= 0 ? previous.splice(index, 1)[0] : { id: 'criterion-' + crypto.randomUUID(), description };
  });
  return {
    ...task, title: input.title, objective: input.objective,
    ...(requirements === undefined ? {} : { requirements }),
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
    const start = action.start_at === undefined ? now : Date.parse(action.start_at);
    const prereqs = action.prerequisites ?? [];
    if (!Number.isFinite(start) || !Array.isArray(prereqs) || prereqs.length > 100 ||
        !prereqs.every(item => task.prerequisites.capabilities.includes(item))) {
      return failure(400, 'Invalid schedule or capability prerequisites');
    }
    if (action.cancel_with_dependency !== undefined && typeof action.cancel_with_dependency !== 'boolean') {
      return failure(400, 'Invalid dependency cancellation policy');
    }
    return { lifecycle: { ...lifecycle, state: 'admitted', executor: action.executor,
      start_at: start, prerequisites: unique(prereqs), cancel_with_dependency: action.cancel_with_dependency === true } };
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
  if (type === 'retry' && current === 'failed' && lifecycle.attempts.length > 0 && lifecycle.attempts.length < maxAttempts) {
    if (typeof action.changed_assumption !== 'string' || !action.changed_assumption.trim() || action.changed_assumption.length > 500) {
      return failure(400, 'A changed assumption is required before retrying');
    }
    return { lifecycle: { ...lifecycle, state: 'queued', changed_assumption: action.changed_assumption.trim() } };
  }
  if (type === 'pause' && ['admitted', 'queued', 'scheduled', 'running'].includes(current)) {
    return { lifecycle: { ...lifecycle, state: current === 'running' ? 'pausing' : 'paused' } };
  }
  if (type === 'resume' && current === 'paused' && lifecycle.attempts.length < maxAttempts) {
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
  if (type === 'archive' && ['proposed', 'blocked', 'failed', 'cancelled', 'superseded'].includes(current)) {
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
    attempt.failure = 'Executor lease expired. Reconcile possible effects before retrying.';
    attempt.finished_at = timestamp(now);
    lifecycle.state = 'failed';
    const version = row.version + 1;
    lifecycle.event = {
      operation_id: crypto.randomUUID(), digest: 'scheduler', kind: 'lease_expired', actor: 'scheduler',
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
    task: record(row), version: row.version, priority: row.priority, lifecycle: publicLifecycle(row, rows, now),
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
      ? item.lifecycle.state !== 'archived' : item.lifecycle.state === body.state) });
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
      return success({ claim: { task: record(row), attempt: exposeAttempt(attempt), lease: attempt.lease } });
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
  const save = async (row, task, lifecycle, { priority = row.priority, kind, id = body.operation_id, eventDigest, attemptId, fenceGraph = true } = {}) => {
    task = { ...task, state: stateForV1[lifecycle.state] ?? lifecycle.state };
    if (!validate(task)) return null;
    const version = row.version + 1;
    const next = { ...lifecycle, event: event(id, kind, version, lifecycle.state, attemptId, eventDigest) };
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
      const requirements = requirementReferences(body.fields);
      if (requirements !== undefined) task.requirements = requirements;
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
          ['cancelled', 'archived', 'superseded'].includes(details(rows.get(id)).state))) {
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
    const attempt = {
      id: 'attempt_' + crypto.randomUUID(), attempt_number: lifecycle.attempts.length + 1, executor: lifecycle.executor,
      revision: task.revision, state: 'running', started_at: timestamp(now), lease: crypto.randomUUID(),
      lease_until: now + leaseMs, deadline: now + attemptTimeoutMs,
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
    return success({ claim: { task: record(rows.get(candidate.task_id)), attempt: exposeAttempt(attempt), lease: attempt.lease } });
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
  const updated = await save(currentRow, nextTask, change.lifecycle ?? lifecycle, {
    priority: change.priority, kind: body.action?.type ?? body.report.type, attemptId: body.attempt_id,
    fenceGraph: body.op !== 'report',
  });
  return updated ? success(await view(updated)) : conflict();
}
