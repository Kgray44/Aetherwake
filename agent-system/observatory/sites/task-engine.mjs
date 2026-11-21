import { proposedTask, validateNewTask } from '../intake.mjs';
import { validCheckoutDiagnostic } from '../checkout-diagnostic.mjs';
import { executionFailureCategories } from '../execution-failure.mjs';
import { taskExecutionCapacity } from '../task-execution-capacity.mjs';
import { operationId, priorities, proposalControl } from './proposal-controls.mjs';
import { sha256 } from './task-telemetry.mjs';

export const taskEnginePath = '/api/task-engine/v1';
export const isTaskWorkerKey = value => typeof value==='string' && value.length>=32 && value.length<=256;
const idPattern = /^task_([a-f0-9-]+)$/;
const taskId = value => typeof value === 'string' && operationId.test(value.match(idPattern)?.[1] ?? '');
const scopeLimit = 500;
const leaseMs = 60_000;
const candidateRecoveryMs = 24 * 60 * 60 * 1000;
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
const refKinds = ['branch', 'commit', 'pull_request', 'review', 'ci_run', 'test', 'artifact', 'investigation', 'deployment', 'executor_session'];
const sessionPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const recoveryProof = /^[a-f0-9]{64}$/;
const scheduledDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const agentCommands = new Set(['edit', 'associate']);
const claimStates = new Set(['admitted', 'queued', 'scheduled']);
const activeStates = new Set(['running', 'pausing', 'cancelling']);
const futureSpecStates = new Set(['running', 'pausing', 'verifying', 'failed']);
const addendumReports = new Set(['addenda_take', 'addenda_delivered', 'addenda_acknowledged']);
const canAddendum = lifecycle => canEditSpec(lifecycle) && lifecycle.state !== 'pausing';
const specFields = ['title', 'objective', 'classification', 'prerequisites', 'requirements', 'deliverables', 'acceptance'];
const canEditSpec = lifecycle => futureSpecStates.has(lifecycle.state) || claimStates.has(lifecycle.state) ||
  ['proposed', 'blocked', 'paused'].includes(lifecycle.state);
const editableSpec = task => Object.fromEntries(specFields.filter(key => Object.hasOwn(task, key)).map(key => [key, task[key]]));
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
function canContinueCandidate(lifecycle) {
  const attempt = lifecycle.attempts.at(-1);
  return Boolean(lifecycle.state === 'verifying' && attempt?.state === 'verifying' &&
    attempt.finished_at && attempt.session_id && attempt.branch && attempt.candidate_origin !== 'recovered' &&
    revisionPattern.test(attempt.candidate_revision ?? '') && attempt.candidate_revision !== attempt.revision);
}
const validWorkerScope = scope => scope === undefined ||
  (Array.isArray(scope) && scope.length <= scopeLimit && scope.every(taskId));
const needsContinuation = lifecycle => {
  const checkpoint = lifecycle.attempts.find(item => item.id === lifecycle.resume_attempt_id);
  return Boolean(checkpoint?.session_id && checkpoint.state !== 'paused');
};

function prerequisiteStatus(task,lifecycle,rows) {
  const dependencies=task.prerequisites.task_ids.map(id=>{
    const row=rows.get(id);
    const state=row?details(row).state:'missing';
    const acceptedArchive=state==='archived'&&record(row).owner_acceptance==='accepted';
    if (task.prerequisites.merged_task_ids?.includes(id)) {
      const accepted = state === 'completed' || acceptedArchive;
      const candidate = accepted && details(row).attempts.at(-1);
      const satisfied = Boolean(candidate?.candidate_revision &&
        row.verified_main_candidates?.includes(candidate.id + ':' + candidate.candidate_revision));
      return { type: 'task', id, milestone: 'merged', state: satisfied ? 'merged' : state,
        status: satisfied ? 'satisfied' : row ? 'unsatisfied' : 'unverified' };
    }
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

function exposeAttempt({ lease, recovery_commitment, ...attempt }) {
  return attempt;
}

export function taskAttemptRecord(task, attempt) {
  const states = { orphaned: 'failed', interrupted: 'blocked', paused: 'blocked', checkpointed: 'blocked' };
  return {
    schema_version: 1, record_type: 'attempt', id: attempt.id,
    repository: task.repository, revision: attempt.revision, task_id: task.id,
    attempt_number: attempt.attempt_number, started_at: attempt.started_at,
    created_at: attempt.started_at, state: states[attempt.state] ?? attempt.state,
    provider: attempt.execution_identity?.provider??attempt.executor,
    ...(attempt.execution_identity ? {model:attempt.execution_identity.model} : {}),
    ...(attempt.finished_at ? { finished_at: attempt.finished_at } : {}),
    ...(attempt.failure ? {
      failure_category: executionFailureCategories[attempt.failure_kind] ?? 'environment',
      failure_diagnosis: attempt.failure,
    } : {}),
    ...(attempt.branch ? { branch: attempt.branch } : {}),
  };
}

function publicLifecycle(row,rows,now,includePrerequisites=false) {
  const stored=details(row);
  const {attempts,event,cycle_start,addenda,pending_spec,...lifecycle}=stored;
  const task=record(row);
  const checks=includePrerequisites?prerequisiteStatus(task,lifecycle,rows):undefined;
  return {...lifecycle,cycle_attempts:cycleAttempts(stored),max_attempt_minutes:attemptLimit(stored),
    can_configure_execution:canConfigureExecution(stored),stored_state:lifecycle.state,
    can_edit_spec: canEditSpec(stored), spec_version: stored.spec_version ?? 1,
    edit_effect: futureSpecStates.has(stored.state) ? 'next_attempt' : 'before_claim',
    can_addendum: canAddendum(stored), can_continue_candidate: canContinueCandidate(stored),
    ...(includePrerequisites ? { addenda: addenda ?? [], pending_spec } :
      { pending_spec_version: pending_spec?.version }),
    ...waitState(task,lifecycle,rows,now,checks),...(checks?{prerequisite_status:checks}:{})};
}

function validateReferenceRevisions(requirements) {
  if ((requirements??[]).some(ref=>ref.revision!==undefined&&!revisionPattern.test(ref.revision))) {
    throw Error('Task requirement and input revisions must be 40-character Git hashes');
  }
}

function editTask(task, fields) {
  const dependencies = Array.isArray(fields.dependencies) ? fields.dependencies : task.prerequisites.task_ids;
  const input = validateNewTask({
    dependencies: task.prerequisites.task_ids,
    merged_dependencies: (task.prerequisites.merged_task_ids ?? []).filter(id => dependencies.includes(id)),
    capabilities: task.prerequisites.capabilities, ...fields,
  });
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
    prerequisites: { task_ids: unique(input.ids), capabilities: unique(input.capabilities),
      ...(input.mergedIds.length ? { merged_task_ids: input.mergedIds } : {}) },
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
    : typeof action.start_at==='string' && scheduledDate.test(action.start_at) ? Date.parse(action.start_at) : NaN;
  const minutes=action.max_attempt_minutes===undefined ? attemptLimit(lifecycle) : action.max_attempt_minutes;
  const cancel=action.cancel_with_dependency===undefined ? !!lifecycle.cancel_with_dependency : action.cancel_with_dependency;
  if (!Number.isFinite(start)) throw Error('Invalid execution start time');
  if (!Number.isSafeInteger(minutes) || minutes<1 || minutes>defaultAttemptMinutes) {
    throw Error('Maximum attempt duration must be a whole number from 1 to 30 minutes');
  }
  if (typeof cancel!=='boolean') throw Error('Invalid dependency cancellation policy');
  return {start_at:start,max_attempt_minutes:minutes,cancel_with_dependency:cancel};
}

function commandChange(task, lifecycle, { action, now, rows, access, nextVersion, priority, operationId }) {
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
    if (access !== 'owner' && (lifecycle.executor || !['proposed', 'blocked'].includes(current))) {
      return failure(403, 'Owner action required for admitted Tasks');
    }
    if (!canEditSpec(lifecycle)) return failure(409, 'Reopen the Task for a new review cycle before editing');
    const nextPriority = action.fields?.priority ?? priority;
    if (!priorities.includes(nextPriority)) return failure(400, 'Invalid priority');
    try {
      const before = editableSpec(lifecycle.pending_spec?.fields ?? task);
      const edited = editTask({ ...task, ...before }, action.fields);
      const after = editableSpec(edited);
      if (lifecycle.executor && JSON.stringify(after.prerequisites) !== JSON.stringify(task.prerequisites)) {
        return failure(409, 'Changing prerequisites requires new execution admission');
      }
      const pending = futureSpecStates.has(current);
      const next = { ...lifecycle };
      if (pending) next.pending_spec = { version: nextVersion, fields: after };
      else {
        next.spec_version = nextVersion;
        delete next.pending_spec;
      }
      return {
        task: pending ? task : edited, lifecycle: next, priority: nextPriority,
        specification: { before, after, effect: pending ? 'next_attempt' : 'before_claim', version: nextVersion },
      };
    } catch (error) { return failure(400, error.message); }
  }
  if (type === 'addendum') {
    const { text, target, attempt_id } = action;
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) return failure(400, 'Provide 1 to 2000 characters of owner instructions');
    if (!['active_attempt', 'next_attempt'].includes(target)) return failure(400, 'Choose an amendment target');
    if (!canAddendum(lifecycle)) return failure(409, 'This Task cannot receive an addendum in its current state');
    const addenda = lifecycle.addenda ?? [];
    if (addenda.length >= 32) return failure(409, 'This Task has reached its addendum limit');
    const attempt = lifecycle.attempts.at(-1);
    if (target === 'active_attempt' && (!attempt || attempt.id !== attempt_id || !['running', 'verifying'].includes(current))) {
      return failure(409, 'The selected attempt is no longer available for an addendum');
    }
    if (target === 'next_attempt' && attempt_id !== undefined) return failure(400, 'A future addendum must not specify a current attempt');
    const immediate = target === 'active_attempt';
    const available = current === 'running' && attempt?.live_addenda && !attempt.addendum_checkpoint;
    const addendum = {
      id: operationId, task_id: task.id, text: text.trim(), target, version: nextVersion,
      accepted_at: timestamp(now), status: immediate && !available ? 'deferred' : 'pending',
      ...(immediate ? { attempt_id, spec_version: attempt.spec_version ?? 1,
        ...(attempt.session_id ? { session_id: attempt.session_id } : {}),
        ...(!available ? { reason: 'No delivery checkpoint remains on this attempt' } : {}) } : {}),
    };
    return { lifecycle: { ...lifecycle, addenda: [...addenda, addendum] }, addendum };
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
    last.failure_kind = 'verification';
    return { lifecycle: { ...lifecycle, state: 'failed' } };
  }
  if (type === 'recover_candidate' && current === 'failed') {
    const last = lifecycle.attempts.at(-1);
    if (last?.state !== 'orphaned' || last.id !== action.attempt_id ||
        typeof action.revision!=='string' || !revisionPattern.test(action.revision) || action.revision === last.revision) {
      return failure(409, 'Recovery requires the exact orphaned attempt and a distinct candidate revision');
    }
    if (typeof action.reason !== 'string' || !action.reason.trim() || action.reason.length > 500) {
      return failure(400, 'Describe how the recovered candidate was independently checked');
    }
    const previousFailure=last.failure;
    const previousFailureKind=last.failure_kind;
    last.state = 'verifying';
    last.candidate_revision = action.revision;
    last.candidate_origin = 'recovered';
    delete last.failure;
    delete last.failure_kind;
    delete last.recovery_commitment;
    delete last.recovery_until;
    return { lifecycle: { ...lifecycle, state: 'verifying', recovered_candidate:true }, previousFailure, previousFailureKind };
  }
  if (type === 'accept' && current === 'verifying') {
    const last = lifecycle.attempts.at(-1);
    if (!reviewedEvidence(task, action.evidence, last.candidate_revision)) return failure(409, 'Reviewed evidence is required for every criterion at the attempt revision');
    last.state = 'succeeded';
    return { task: { ...task, owner_acceptance: 'accepted' }, lifecycle: { ...lifecycle, state: 'completed', accepted_at: timestamp(now),
      evidence: action.evidence.map(({ criterion_id, uri, revision }) => ({ criterion_id, uri, revision })) } };
  }
  if (type === 'continue_candidate' && current === 'verifying') {
    const last = lifecycle.attempts.at(-1);
    if (!canContinueCandidate(lifecycle) || last.id !== action.attempt_id || last.candidate_revision !== action.revision) {
      return failure(409, 'Continuation requires the exact completed worker candidate and its retained conversation');
    }
    if (typeof action.feedback !== 'string' || !action.feedback.trim() || action.feedback.length > 2000) {
      return failure(400, 'Owner feedback must contain 1 to 2000 characters');
    }
    last.state = 'checkpointed';
    return { lifecycle:{
      ...lifecycle, state:'queued', start_at:now, cycle_start:lifecycle.attempts.length,
      feedback:action.feedback.trim(), changed_assumption:undefined, followup_revision:last.candidate_revision,
      resume_attempt_id:last.id,
    } };
  }
  if (type === 'retry' && current === 'failed' && cycleAttempts(lifecycle) > 0 && cycleAttempts(lifecycle) < maxAttempts) {
    if (typeof action.changed_assumption !== 'string' || !action.changed_assumption.trim() || action.changed_assumption.length > 500) {
      return failure(400, 'A changed assumption is required before retrying');
    }
    const assumption=action.changed_assumption.trim();
    if (lifecycle.attempts.at(-1)?.state==='orphaned' && assumption===lifecycle.changed_assumption) {
      return failure(409, 'This is the previous retry assumption. Reconcile the interrupted attempt and record what changed.');
    }
    return { lifecycle: { ...lifecycle, state: 'queued', changed_assumption: assumption,
      resume_attempt_id:lifecycle.attempts.findLast(item=>item.session_id)?.id } };
  }
  if (type === 'pause' && ['admitted', 'queued', 'scheduled', 'running'].includes(current)) {
    return { lifecycle: { ...lifecycle, state: current === 'running' ? 'pausing' : 'paused' } };
  }
  if (type === 'resume' && current === 'failed') {
    return failure(409, 'Failed Tasks require an owner Retry with a changed assumption.');
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
      evidence:[], feedback:action.feedback.trim(), changed_assumption:undefined, followup_revision:accepted.candidate_revision,
      resume_attempt_id:accepted.session_id?accepted.id:undefined,
    } };
  }
  if (type === 'archive' && ['completed','proposed','blocked','failed','cancelled','superseded'].includes(current)) {
    return { lifecycle: { ...lifecycle, state: 'archived' } };
  }
  return failure(409, 'Invalid Task transition from ' + current);
}

function deferAddenda(lifecycle, attempt) {
  const changed = [];
  for (const addendum of lifecycle.addenda ?? []) {
    if (addendum.attempt_id !== attempt.id) continue;
    if (addendum.status === 'delivered') addendum.reason = 'The executor did not acknowledge completion of this turn';
    else if (addendum.status === 'pending') {
      addendum.status = 'deferred';
      addendum.reason = addendum.reservation_id
        ? 'Delivery could not be confirmed before the attempt ended'
        : 'The attempt ended before a delivery checkpoint';
    } else continue;
    changed.push(addendum);
  }
  return changed;
}
const addendumReceipt = ({ id, status, session_id, turn_id, spec_version, reason }) =>
  ({ id, status, session_id, turn_id, spec_version, reason });

function workerAddenda(lifecycle, attempt, body, now) {
  const { report, operation_id } = body;
  if (lifecycle.state !== 'running' || !attempt.live_addenda || !attempt.session_id ||
      attempt.session_id !== report.session_id) return failure(409, 'Addendum checkpoint is unavailable');
  const addenda = (lifecycle.addenda ?? []).filter(item => item.attempt_id === attempt.id && item.status === 'pending');
  if (report.type === 'addenda_take') {
    if (attempt.addendum_checkpoint) return failure(409, 'This attempt already used its addendum checkpoint');
    attempt.addendum_checkpoint = operation_id;
    for (const item of addenda) {
      item.session_id = attempt.session_id;
      item.reservation_id = operation_id;
    }
    return { lifecycle, addenda };
  }
  const reserved = (lifecycle.addenda ?? []).filter(item => item.attempt_id === attempt.id &&
    item.session_id === attempt.session_id && item.reservation_id === report.reservation_id);
  const delivered = report.type === 'addenda_delivered';
  if (!operationId.test(report.reservation_id) || !sessionPattern.test(report.turn_id ?? '') || !reserved.length ||
      reserved.some(item => delivered ? item.status !== 'pending' : item.status !== 'delivered' || item.turn_id !== report.turn_id)) {
    return failure(409, 'Addendum receipt does not match the reserved delivery');
  }
  for (const item of reserved) {
    item.turn_id = report.turn_id;
    item.status = delivered ? 'delivered' : 'acknowledged';
    item[delivered ? 'delivered_at' : 'acknowledged_at'] = timestamp(now);
  }
  return { lifecycle, addenda: reserved };
}

function workerChange(lifecycle, body, now) {
  const active = lifecycle.attempts.at(-1);
  if (!active || active.id !== body.attempt_id || active.lease !== body.lease ||
      active.lease_until <= now || !activeStates.has(lifecycle.state)) {
    return failure(409, 'Attempt lease is stale or invalid');
  }
  const report = body.report;
  if (addendumReports.has(report?.type)) return workerAddenda(lifecycle, active, body, now);
  if (!report || !['heartbeat', 'finished', 'failed', 'stopped'].includes(report.type)) return failure(400, 'Invalid attempt report');
  if (report.session_id !== undefined && (typeof report.session_id !== 'string' ||
      !sessionPattern.test(report.session_id) || (active.session_id && active.session_id !== report.session_id) ||
      (active.resume_session_id && active.resume_session_id !== report.session_id))) {
    return failure(400, 'Invalid or changed executor session');
  }
  if (report.session_id) active.session_id = report.session_id;
  if (report.execution_identity!==undefined) {
    const {provider,model,source}=report.execution_identity??{};
    const token=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
    if (!active.session_id||!token(provider)||!token(model)||source!=='codex_app_server_thread_start'||
        (active.execution_identity&&(active.execution_identity.provider!==provider||active.execution_identity.model!==model))) {
      return failure(400,'Invalid or changed executor model identity');
    }
    active.execution_identity={provider,model,source};
  }
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
    delete active.recovery_commitment;
    return { lifecycle: { ...lifecycle, state: 'verifying' }, addenda: deferAddenda(lifecycle, active) };
  }
  if (report.type === 'stopped' && ['pausing', 'cancelling'].includes(lifecycle.state)) {
    const state = lifecycle.state === 'pausing' ? 'paused' : 'cancelled';
    if (typeof report.revision === 'string' && revisionPattern.test(report.revision)) active.checkpoint_revision = report.revision;
    active.state = state;
    active.finished_at = timestamp(now);
    delete active.recovery_commitment;
    return { lifecycle: { ...lifecycle, state }, addenda: deferAddenda(lifecycle, active) };
  }
  if (report.type === 'failed' && typeof report.failure === 'string' && report.failure.trim() && report.failure.length <= 500) {
    if (report.failure_kind !== undefined) {
      if (typeof report.failure_kind !== 'string' || !Object.hasOwn(executionFailureCategories,report.failure_kind)) {
        return failure(400, 'Invalid execution failure category');
      }
      active.failure_kind=report.failure_kind;
    }
    active.state = 'failed';
    if (report.checkout_diagnostic !== undefined) {
      if (!validCheckoutDiagnostic(report.checkout_diagnostic)) return failure(400, 'Invalid checkout diagnostic');
      active.checkout_diagnostic = report.checkout_diagnostic;
    }
    active.failure = report.failure.trim();
    active.finished_at = timestamp(now);
    delete active.recovery_commitment;
    return { lifecycle: { ...lifecycle, state: 'failed' }, addenda: deferAddenda(lifecycle, active) };
  }
  return failure(409, 'Report conflicts with current Task state');
}

async function recoverWorkerCandidate(lifecycle, body, now) {
  const attempt = lifecycle.attempts.at(-1);
  const candidate = body.candidate_recovery;
  if (!candidate || typeof candidate.key !== 'string' || !recoveryProof.test(candidate.key) ||
      typeof candidate.revision !== 'string' || !revisionPattern.test(candidate.revision) ||
      body.lease !== undefined || body.report !== undefined || body.action !== undefined) {
    return failure(400, 'Invalid candidate recovery proof');
  }
  if (lifecycle.state !== 'failed' || attempt?.state !== 'orphaned' || attempt.id !== body.attempt_id ||
      !attempt.recovery_commitment || !Number.isFinite(attempt.recovery_until) || now >= attempt.recovery_until ||
      candidate.revision === attempt.revision || !attempt.branch || candidate.branch !== attempt.branch ||
      !attempt.session_id || candidate.session_id !== attempt.session_id ||
      await sha256(candidate.key) !== attempt.recovery_commitment) {
    return failure(409, 'Candidate recovery does not match the current orphaned attempt');
  }
  const previousFailure = attempt.failure;
  const previousFailureKind = attempt.failure_kind;
  delete attempt.failure;
  delete attempt.failure_kind;
  delete attempt.recovery_commitment;
  delete attempt.recovery_until;
  attempt.state = 'verifying';
  attempt.candidate_revision = candidate.revision;
  attempt.candidate_origin = 'worker_recovered';
  return { lifecycle:{...lifecycle,state:'verifying',recovered_candidate:true}, previousFailure, previousFailureKind };
}

export async function readTaskRows({ db, owner, namespace, now = Date.now() }) {
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const result = await query('SELECT * FROM proposals WHERE owner_id = ? AND namespace = ? ORDER BY created_at DESC, task_id DESC',
    owner, namespace).all();
  if (result.results.some(row => record(row).prerequisites?.merged_task_ids?.length)) {
    const verified = await query(`SELECT task_id, task_attempt_id, COALESCE(json_extract(record, '$.task.head_sha'), head_sha) AS head_sha FROM integration_runs
      WHERE owner_id = ? AND namespace = ? AND task_id IS NOT NULL AND state IN ('merged', 'deployed')`, owner, namespace).all();
    const revisions = new Map();
    for (const { task_id, task_attempt_id, head_sha } of verified.results) {
      if (!revisions.has(task_id)) revisions.set(task_id, []);
      revisions.get(task_id).push(task_attempt_id + ':' + head_sha);
    }
    for (const row of result.results) row.verified_main_candidates = revisions.get(row.task_id);
  }
  return Promise.all(result.results.map(async row => {
    if (!row.engine) return row;
    const lifecycle = details(row);
    const attempt = lifecycle.attempts.at(-1);
    if (attempt?.state !== 'running' || attempt.lease_until > now) return row;

    if (lifecycle.state !== 'running') delete attempt.recovery_commitment;
    if (attempt.recovery_commitment) attempt.recovery_until = now + candidateRecoveryMs;
    attempt.state = 'orphaned';
    const deadlineReached = attempt.lease_until === attempt.deadline;
    attempt.failure_kind = deadlineReached ? 'time_limit' : 'lease';
    attempt.failure = deadlineReached
      ? 'Attempt time limit reached. Reconcile possible effects before retrying.'
      : 'Executor lease expired. Reconcile possible effects before retrying.';
    attempt.finished_at = timestamp(now);
    const addenda = deferAddenda(lifecycle, attempt);
    lifecycle.state = 'failed';
    const version = row.version + 1;
    lifecycle.event = {
      operation_id: crypto.randomUUID(), digest: 'scheduler', kind: deadlineReached ? 'attempt_time_limit_reached' : 'lease_expired', actor: 'scheduler',
      reason: attempt.failure, failure_kind:attempt.failure_kind,
      ...(addenda.length ? {addenda: addenda.map(addendumReceipt)} : {}),
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

function claimPayload(task,lifecycle,attempt,separateNotes) {
  const interrupted = lifecycle.attempts.find(item=>item.id===attempt.resume_interrupted_attempt_id);
  const feedback = [
    lifecycle.feedback && 'Owner feedback for this follow-up attempt\n' + lifecycle.feedback,
    attempt.changed_assumption && 'Owner retry diagnosis and changed assumption\n' + attempt.changed_assumption,
  ].filter(Boolean);
  return {
    task: separateNotes || !feedback.length ? task : {...task, objective:[task.objective, ...feedback].join('\n\n')},
    attempt:exposeAttempt(attempt), lease:attempt.lease,
    ...(interrupted ? {interrupted_checkout:{attempt_id:interrupted.id,
      recovery_commitment:interrupted.recovery_commitment,branch:interrupted.branch}} : {}),
    ...(separateNotes && feedback.length ? { execution_notes:feedback } : {}),
  };
}

const workerOperations = new Set(['claim', 'report', 'worker_pulse', 'recover_worker_candidate']);
const workerStates = new Set(['available', 'busy', 'claim_rejected', 'task_connection_unavailable',
  'storage_guard_timeout', 'storage_reserve_denied', 'storage_guard_unavailable']);
const workerFreshnessMs = 60_000;

export async function taskOperation({ db, owner, namespace, body, access, validate, revision, now = Date.now() }) {
  if (!body || !['list', 'get', 'register', 'command', ...workerOperations].includes(body.op)) return failure(400, 'Invalid Task operation');
  if (workerOperations.has(body.op) && access !== 'worker') return failure(403, 'Executor authorization required');
  if (body.op === 'command' && access !== 'owner' && !agentCommands.has(body.action?.type)) return failure(403, 'Owner action required');
  if (access === 'worker' && !workerOperations.has(body.op)) return failure(403, 'Executor scope does not allow this operation');
  if (!['list', 'get', 'worker_pulse'].includes(body.op) && !operationId.test(body.operation_id)) return failure(400, 'Operation UUID required');
  if (['get', 'command', 'report','recover_worker_candidate'].includes(body.op) && !taskId(body.task_id)) return failure(400, 'Invalid Task ID');

  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  if (body.op === 'worker_pulse') {
    if (!operationId.test(body.worker_id) || !workerStates.has(body.worker_state) || !validWorkerScope(body.task_ids) ||
        (body.conversation_continuation !== undefined && typeof body.conversation_continuation !== 'boolean')) {
      return failure(400, 'Invalid worker observation');
    }
    await query('DELETE FROM task_worker_liveness WHERE owner_id = ? AND namespace = ? AND seen_at < ?',
      owner, namespace, now - 86_400_000).run();
    await query(`
      INSERT INTO task_worker_liveness (owner_id, namespace, worker_id, seen_at, state, task_scope, conversation_continuation,
        last_error, last_error_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, namespace, worker_id) DO UPDATE SET seen_at = excluded.seen_at, state = excluded.state,
        task_scope = excluded.task_scope, conversation_continuation = excluded.conversation_continuation,
        last_error = COALESCE(excluded.last_error, task_worker_liveness.last_error),
        last_error_at = COALESCE(excluded.last_error_at, task_worker_liveness.last_error_at)
      WHERE excluded.seen_at >= task_worker_liveness.seen_at
    `, owner, namespace, body.worker_id, now, body.worker_state,
      body.task_ids ? JSON.stringify(body.task_ids) : null, body.conversation_continuation === undefined ? null : Number(body.conversation_continuation),
      ...(['available', 'busy'].includes(body.worker_state) ? [null, null] : [body.worker_state, now])).run();
    return success({ seen_at: timestamp(now) });
  }
  const rows = new Map((await readTaskRows({ db, owner, namespace, now })).map(row => [row.task_id, row]));
  const currentRow = rows.get(body.task_id);
  const slotsInUse = () => [...rows.values()].filter(row => details(row).attempts.at(-1)?.state === 'running').length;
  const observeDispatch = async row => {
    const { results } = await query(`
      SELECT seen_at, state, task_scope, conversation_continuation, last_error, last_error_at FROM task_worker_liveness
      WHERE owner_id = ? AND namespace = ? ORDER BY seen_at DESC LIMIT 20
    `, owner, namespace).all();
    const matching = row ? results.filter(worker => (!worker.task_scope || JSON.parse(worker.task_scope).includes(row.task_id)) &&
      (!needsContinuation(details(row)) || worker.conversation_continuation === 1)) : results;
    const slots = slotsInUse();
    const lastError = matching.filter(worker => worker.last_error_at != null)
      .sort((a, b) => b.last_error_at - a.last_error_at)[0];
    return {
      last_seen_at: matching.length ? timestamp(matching[0].seen_at) : null,
      states: matching.filter(worker => now - worker.seen_at < workerFreshnessMs).map(worker => worker.state),
      active_slots: slots,
      total_slots: taskExecutionCapacity,
      ...(lastError ? { last_error: { state: lastError.last_error, at: timestamp(lastError.last_error_at) } } : {}),
      ...(row && results.some(worker => now - worker.seen_at < workerFreshnessMs) &&
        !matching.some(worker => now - worker.seen_at < workerFreshnessMs) ? { no_matching_worker: true } : {}),
    };
  };
  const receipts = id => query('SELECT event FROM task_engine_events WHERE owner_id = ? AND namespace = ? AND task_id = ? ORDER BY version',
    owner, namespace, id).all();
  const view = async row => ({
    task: record(row), version: row.version, priority: row.priority, lifecycle: publicLifecycle(row, rows, now, true),
    attempts: details(row).attempts.map(exposeAttempt),
    events: [...proposalControl(row).history, ...(await receipts(row.task_id)).results
      .map(({ event }) => { const { digest, ...receipt } = JSON.parse(event); return receipt; })],
  });
  const reportView = (row, persisted) => {
    const lifecycle = details(row);
    const attempt = lifecycle.attempts.find(item => item.id === body.attempt_id);
    const { digest, ...receipt } = persisted;
    return { task: { id: row.task_id }, version: row.version,
      lifecycle: { state: lifecycle.attempts.at(-1)?.id === attempt?.id ? lifecycle.state : receipt.state },
      attempts: attempt ? [exposeAttempt(attempt)] : [], events: [receipt] };
  };
  const summary = row => ({
    task: record(row), version: row.version, priority: row.priority, lifecycle: publicLifecycle(row, rows, now),
  });
  if (body.op === 'list') {
    const tasks = [...rows.values()].map(summary);
    return success({ tasks: tasks.filter(item => body.state === undefined
      ? body.include_archived === true || item.lifecycle.state !== 'archived' : item.lifecycle.state === body.state),
    ...(access === 'owner' ? { worker_dispatch: await observeDispatch() } : {}) });
  }
  if (body.op === 'get') return currentRow ? success({
    ...await view(currentRow), ...(access === 'owner' ? { worker_dispatch: await observeDispatch(currentRow) } : {}),
  }) : failure(404, 'Task not found');

  if (body.op === 'claim' && !validWorkerScope(body.task_ids)) return failure(400, 'Invalid executor Task scope');
  if (body.op === 'claim' && body.recovery_commitment !== undefined &&
      (typeof body.recovery_commitment !== 'string' || !recoveryProof.test(body.recovery_commitment))) {
    return failure(400, 'Invalid candidate recovery commitment');
  }
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
      return success({ claim: claimPayload(record(row), details(row), attempt, body.separate_execution_notes === true) });
    }
    if (addendumReports.has(body.report?.type) || body.report?.type === 'heartbeat') {
      const lifecycle = details(row);
      const attempt = lifecycle.attempts.at(-1);
      const allowed = body.report.type === 'heartbeat' ? activeStates.has(lifecycle.state) : lifecycle.state === 'running';
      if (!allowed || attempt?.id !== body.attempt_id ||
          attempt.lease !== body.lease || attempt.lease_until <= now) return failure(409, 'Attempt lease is stale or invalid');
      if (body.report.type === 'heartbeat') return success(reportView(row, previous));
      const addenda = (lifecycle.addenda ?? []).filter(item =>
        item.reservation_id === (body.report.reservation_id ?? body.operation_id));
      return success({addenda: body.report.type === 'addenda_take' ? addenda.filter(item => item.status === 'pending') : []});
    }
    if (['report','recover_worker_candidate'].includes(body.op)) return success(reportView(row, previous));
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
    if (terminal.has(lifecycle.state) && lifecycle.state !== 'failed') {
      for (const item of lifecycle.addenda ?? []) {
        if (item.status !== 'pending' || item.attempt_id) continue;
        item.status = 'deferred';
        item.reason = 'The Task closed before another attempt was claimed';
      }
    }
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
    const running = slotsInUse();

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
    if (running >= taskExecutionCapacity) return success({ claim: null, dispatch_state:'busy' });
    const candidate = admitted.filter(row => !body.task_ids || body.task_ids.includes(row.task_id)).map(row => rows.get(row.task_id))
      .filter(row => {
        const lifecycle=details(row);
        return (!needsContinuation(lifecycle)||body.conversation_continuation===true)&&
          waitState(record(row),lifecycle,rows,now).state==='ready';
      })
      .sort((a, b) => priorities.indexOf(b.priority) - priorities.indexOf(a.priority) ||
        a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id))[0];
    if (!candidate) return success({ claim: null });
    const lifecycle = details(candidate);
    const pendingSpec = lifecycle.pending_spec;
    const task = { ...record(candidate), ...pendingSpec?.fields };
    if (pendingSpec) lifecycle.spec_version = pendingSpec.version;
    delete lifecycle.pending_spec;
    const deadline = now + attemptLimit(lifecycle) * 60_000;
    const attempt = {
      id: 'attempt_' + crypto.randomUUID(), attempt_number: lifecycle.attempts.length + 1, executor: lifecycle.executor,
      revision: lifecycle.followup_revision ?? task.revision, state: 'running', started_at: timestamp(now), lease: crypto.randomUUID(),
      lease_until: Math.min(now + leaseMs, deadline), deadline, spec_version: lifecycle.spec_version ?? 1,
      ...(body.live_addenda === true ? { live_addenda: true } : {}),
      ...(body.recovery_commitment ? {recovery_commitment:body.recovery_commitment} : {}),
      ...(lifecycle.changed_assumption ? { changed_assumption:lifecycle.changed_assumption } : {}),
    };
    const checkpoint = lifecycle.attempts.find(item => item.id === lifecycle.resume_attempt_id);
    if (checkpoint?.session_id) {
      attempt.resume_session_id = checkpoint.session_id;
      if (checkpoint.state==='paused'&&checkpoint.checkpoint_revision) attempt.revision = checkpoint.checkpoint_revision;
      else attempt.resume_requires_clean=true;
      if (checkpoint.state === 'checkpointed') attempt.branch = checkpoint.branch;
      if (checkpoint===lifecycle.attempts.at(-1) && checkpoint.state==='orphaned' &&
          checkpoint.recovery_commitment && checkpoint.branch) {
        attempt.revision=checkpoint.revision;
        attempt.resume_interrupted_attempt_id=checkpoint.id;
      }
    }
    delete lifecycle.resume_attempt_id;
    delete lifecycle.recovered_candidate;
    lifecycle.state = 'running';
    lifecycle.attempts.push(attempt);
    for (const item of lifecycle.addenda ?? []) {
      if (item.target !== 'next_attempt' || item.attempt_id || item.status !== 'pending') continue;
      item.attempt_id = attempt.id;
      item.spec_version = attempt.spec_version;
      if (!attempt.live_addenda) {
        item.status = 'deferred';
        item.reason = 'The claiming worker does not support addendum checkpoints';
      }
    }
    if (!await save(candidate, task, lifecycle, { kind: 'claim', attemptId: attempt.id })) return conflict();
    return success({ claim: claimPayload(record(rows.get(candidate.task_id)), lifecycle, attempt, body.separate_execution_notes === true) });
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
    ? commandChange(task, lifecycle, { action: body.action, now, rows, access, nextVersion: currentRow.version + 1,
      priority: currentRow.priority, operationId: body.operation_id })
    : body.op === 'recover_worker_candidate' ? await recoverWorkerCandidate(lifecycle,body,now) : workerChange(lifecycle, body, now);
  if (change.status) return change;
  const nextTask = change.task ?? task;
  if (change.specification && !validate({ ...nextTask, ...change.specification.after })) {
    return failure(400, 'Invalid Task specification');
  }
  if (nextTask.prerequisites.task_ids.some(id => !taskId(id))) return failure(400, 'Invalid dependency ID');
  if (['admit', 'edit'].includes(body.action?.type) && hasCycle(task.id, nextTask, rows)) return failure(409, 'Dependency cycle');
  const action = body.action;
  const latest = lifecycle.attempts.at(-1);
  const receipt = {
    ...(change.addendum ? { addendum: change.addendum } : {}),
    ...(change.addenda?.length ? { addenda: change.addenda.map(addendumReceipt) } : {}),
    ...(['admit','configure_execution'].includes(action?.type) ? { max_attempt_minutes:attemptLimit(change.lifecycle),
      start_at:timestamp(change.lifecycle.start_at),cancel_with_dependency:change.lifecycle.cancel_with_dependency } : {}),
    ...(action?.type === 'reject' ? { reason:action.reason.trim(), failure_kind:latest.failure_kind } : {}),
    ...(action?.type === 'retry' ? { reason:change.lifecycle.changed_assumption } : {}),
    ...(body.report?.type==='failed' && latest?.failure ? {reason:latest.failure,
      ...(latest.failure_kind ? {failure_kind:latest.failure_kind} : {}),
      ...(latest.checkout_diagnostic ? {checkout_diagnostic:latest.checkout_diagnostic} : {})}:{}),
    ...(change.specification ? { specification: change.specification, fields:[
      ...specFields.filter(key =>
        JSON.stringify(change.specification.before[key]) !== JSON.stringify(change.specification.after[key])),
      ...(change.priority!==currentRow.priority?['priority']:[]),
    ] } : {}),
    ...(action?.type === 'associate' ? { reference:{
      kind:action.reference.kind, uri:action.reference.uri, revision:action.reference.revision,
    } } : {}),
    ...(action?.type === 'reopen' ? { feedback:change.lifecycle.feedback, revision:change.lifecycle.followup_revision,
      evidence:lifecycle.evidence } : {}),
    ...(action?.type === 'continue_candidate' ? { feedback:change.lifecycle.feedback, revision:change.lifecycle.followup_revision } : {}),
    ...(action?.type === 'recover_candidate' ? { revision:action.revision, reason:action.reason.trim(),
      previous_failure:change.previousFailure, previous_failure_kind:change.previousFailureKind } : {}),
    ...(body.op === 'recover_worker_candidate' ? { revision:latest.candidate_revision,
      previous_failure:change.previousFailure, previous_failure_kind:change.previousFailureKind } : {}),
    ...(action?.type === 'accept' ? { revision:latest.candidate_revision, evidence:change.lifecycle.evidence } : {}),
  };
  const updated = await save(currentRow, nextTask, change.lifecycle ?? lifecycle, {
    priority: change.priority, kind: action?.type ?? body.report?.type ?? body.op, receipt,
    attemptId:body.attempt_id ?? (['accept','reject','reopen','recover_candidate','continue_candidate'].includes(action?.type)?latest?.id:undefined),
    fenceGraph: body.op !== 'report',
  });
  if (!updated) return conflict();
  if (addendumReports.has(body.report?.type)) return success({
    addenda: body.report.type === 'addenda_take' ? change.addenda : [],
  });
  if (['report','recover_worker_candidate'].includes(body.op)) return success(reportView(updated, details(updated).event));
  return success(await view(updated));
}
