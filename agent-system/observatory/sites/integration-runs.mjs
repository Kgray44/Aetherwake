import { isRevision, REPO } from './github.mjs';
import { operationId } from './proposal-controls.mjs';
import { sha256 } from './task-telemetry.mjs';
import { activeRepair, repairablePath, safeDiagnostic, sourceBudget, validRepairUsage } from './source-repair.mjs';

export const integrationPath = '/api/integrations/v1';
const errors = (status, error) => ({ status, body: { error } });
const success = body => ({ status: 200, body });
const uuid = value => typeof value === 'string' && operationId.test(value);
const taskId = value => typeof value === 'string' && value.startsWith('task_') && uuid(value.slice(5));
const positive = value => Number.isSafeInteger(value) && value > 0;
const merged = run => ['merged', 'deployed'].includes(run.state);
const decode = row => row ? JSON.parse(row.record) : null;
const mergeMethods = new Set(['merge', 'squash', 'rebase']);
const finishedRequests = new Set(['failed', 'rejected', 'unavailable']);
const canSubmit = run => !run.merge_attempt || finishedRequests.has(run.merge_attempt.status);
const repairBackoff = 30_000;
const maxEvents = 100;
const transferLeaseMs = 3 * 60_000;
const repairWorkerOps = new Set(['repair_tick', 'repair_claim', 'repair_begin', 'repair_status', 'repair_report']);
export const integrationWorkerOps = new Set(['integration_claim', 'integration_begin', 'integration_report', 'ci_tick', ...repairWorkerOps]);
const sourceFor = run => run.reviewed_source ?? run.task;
const branchFor = run => 'aads/integration/' + (run.reviewed_source?.repair_id ?? run.id);
const repairsUsed = run => (run.source_repairs?.length ?? 0) + (run.repair_attempts?.length ?? 0);
const modelIdentity = /^[a-zA-Z0-9_.:-]{1,100}$/;
const unresolvedCI = new Set(['reserved','unknown','submitted']);
const stopAutomation = new Set(['policy','identity','permission','repository_or_credential','head_drift','base_drift','merge_conflict','pr_state']);
const repairFingerprint = diagnosis => sha256(JSON.stringify([diagnosis.head_sha, diagnosis.base_sha, diagnosis.pr_number,
  diagnosis.jobs.map(job=>({...job,steps:job.steps.map(({log,...step})=>step)}))]));

function applyEvidence(run, evidence) {
  const workflows = new Map((run.workflow_history ?? []).map(item => [item.run_id + ':' + item.attempt, item]));
  for (const item of evidence.workflows ?? []) {
    const key = item.run_id + ':' + item.attempt;
    // Never replace a previously recorded terminal observation with a delayed pending read.
    if (workflows.get(key)?.status === 'completed' && item.status !== 'completed') continue;
    workflows.set(key, item);
  }
  if (workflows.size) run.workflow_history = [...workflows.values()].slice(-75);
  run.evidence = evidence;
  run.state = evidence.state;
}

export function integrationAccess(env, owner, namespace) {
  const token = env.GITHUB_INTEGRATION_MERGE_TOKEN;
  const publishToken = env.GITHUB_INTEGRATION_PUBLISH_TOKEN;
  const existing = [env.GITHUB_READ_TOKEN, env.GITHUB_PROPOSAL_TOKEN, env.GITHUB_ACTIONS_TOKEN];
  const scopedToken = value => typeof value === 'string' && /^(github_pat_|ghs_|ghu_)[A-Za-z0-9_]{20,}$/.test(value) &&
    !existing.includes(value);
  const enabled = namespace === 'live' && env.OBSERVATORY_INTEGRATION_MERGE_OWNER_ID === owner &&
    scopedToken(token) && token !== publishToken;
  const publish = namespace === 'live' && env.OBSERVATORY_INTEGRATION_PUBLISH_OWNER_ID === owner &&
    scopedToken(publishToken) && publishToken !== token;
  return { merge_enabled: enabled, publish_enabled: publish,
    ...(publish && env.OBSERVATORY_INTEGRATION_TRANSFER_ENABLED === 'true' ? { transfer_enabled: true } : {}),
    ...(namespace === 'live' && env.OBSERVATORY_INTEGRATION_SOURCE_REPAIR_OWNER_ID === owner ? { repair_enabled: true } : {}) };
}

function acceptedCandidate(row) {
  if (!row?.engine) return null;
  const task = JSON.parse(row.record);
  const lifecycle = JSON.parse(row.engine);
  const attempt = lifecycle.attempts.at(-1);
  if (task.repository !== REPO || task.owner_acceptance !== 'accepted' ||
      !['completed', 'archived'].includes(lifecycle.state) || attempt?.state !== 'succeeded' ||
      !isRevision(attempt.revision) || !isRevision(attempt.candidate_revision) ||
      typeof attempt.branch !== 'string' || !/^codex\/[a-zA-Z0-9/_-]+$/.test(attempt.branch)) return null;
  return { id: task.id, attempt_id: attempt.id, head_sha: attempt.candidate_revision,
    parent_sha: attempt.revision, branch: attempt.branch, accepted_at: lifecycle.accepted_at ?? null };
}

function actionFor(body) {
  if (!uuid(body?.operation_id)) return null;
  const { op, operation_id } = body;
  if (op === 'start') {
    const { task_id, pr_number, head_sha } = body;
    const repairLimit = body.repair_limit ?? 3;
    if ((task_id !== undefined && !taskId(task_id)) || (pr_number !== undefined && !positive(pr_number)) ||
        (!task_id && (!positive(pr_number) || !isRevision(head_sha))) ||
        (head_sha !== undefined && !isRevision(head_sha)) || !positive(repairLimit) || repairLimit > 5) return null;
    return { op, operation_id, task_id, pr_number, head_sha, repair_limit: repairLimit };
  }
  if (!uuid(body.id) || !positive(body.expected_version)) return null;
  const action = { op, operation_id, id: body.id, expected_version: body.expected_version };
  if (['repair_claim','repair_tick','ci_tick'].includes(op) && uuid(body.worker_id)) return { ...action, worker_id: body.worker_id };
  if (['repair_begin','repair_report'].includes(op) && uuid(body.worker_id) && uuid(body.claim_id) && uuid(body.repair_id)) {
    const details = { ...action, worker_id: body.worker_id, claim_id: body.claim_id, repair_id: body.repair_id };
    if (op === 'repair_begin') return details;
    if (!['candidate','failed'].includes(body.status)) return null;
    if (body.status === 'candidate' && (!isRevision(body.candidate_sha) || !isRevision(body.tree_sha) ||
        !Array.isArray(body.changed_paths) || !body.changed_paths.length || body.changed_paths.length > 12 ||
        !body.changed_paths.every(repairablePath))) return null;
    if ((body.session_id !== undefined && !uuid(body.session_id)) || (body.turn_id !== undefined && !uuid(body.turn_id))) return null;
    const usage = validRepairUsage(body.usage);
    const identity = body.execution_identity;
    const execution_identity = identity?.source === 'codex_app_server_thread_start' &&
      typeof identity.model === 'string' && modelIdentity.test(identity.model) &&
      typeof identity.provider === 'string' && modelIdentity.test(identity.provider)
      ? { model:identity.model, provider:identity.provider, source:identity.source } : undefined;
    if (body.status === 'candidate' && (!uuid(body.session_id) || !uuid(body.turn_id) || !usage?.complete)) return null;
    return { ...details, status: body.status, session_id: body.session_id, turn_id: body.turn_id, usage, execution_identity,
      candidate_sha: body.candidate_sha, tree_sha: body.tree_sha, changed_paths: body.changed_paths };
  }
  if (['repair_source','arm_repair'].includes(op) && Array.isArray(body.paths) && body.paths.length && body.paths.length <= 12 &&
      body.paths.every(repairablePath) && (body.feedback === undefined || typeof body.feedback === 'string' && body.feedback.length <= 1000)) {
    const paths = [...new Set(body.paths)].sort();
    if (new Set(paths.map(path=>path.toLowerCase())).size !== paths.length) return null;
    if (op === 'arm_repair' && (!isRevision(body.head_sha) || !isRevision(body.base_sha))) return null;
    return { ...action, paths, feedback: safeDiagnostic(body.feedback, 1000)?.trim() || null,
      ...(op === 'arm_repair' ? {head_sha:body.head_sha,base_sha:body.base_sha} : {}) };
  }
  if (op === 'review_repair' && uuid(body.repair_id) && isRevision(body.candidate_sha) && isRevision(body.tree_sha) &&
      ['approve','reject'].includes(body.decision)) {
    return { ...action, repair_id: body.repair_id, candidate_sha: body.candidate_sha, tree_sha: body.tree_sha, decision: body.decision };
  }
  if (op === 'integration_claim' && uuid(body.worker_id)) return { ...action, worker_id: body.worker_id };
  if (['integration_begin', 'integration_report'].includes(op) && uuid(body.worker_id) && uuid(body.claim_id) &&
      (op === 'integration_begin' ? isRevision(body.tree_sha) && (body.shallow_base === undefined || isRevision(body.shallow_base)) :
        ['submitted', 'failed', 'unknown'].includes(body.status))) {
    return { ...action, worker_id: body.worker_id, claim_id: body.claim_id, tree_sha: body.tree_sha, shallow_base: body.shallow_base, status: body.status };
  }
  if (op === 'attach' && positive(body.pr_number)) return { ...action, pr_number: body.pr_number };
  if (op === 'publish' && isRevision(body.head_sha)) return { ...action, head_sha: body.head_sha };
  if (['refresh','stop','inspect_logs','disarm_ci_reruns'].includes(op)) return action;
  if (op === 'arm_ci_reruns' && isRevision(body.head_sha) && isRevision(body.base_sha)) {
    return { ...action, head_sha:body.head_sha, base_sha:body.base_sha };
  }
  if (op === 'retry' && (body.feedback === undefined || (typeof body.feedback === 'string' && body.feedback.length <= 1000))) {
    return { ...action, feedback: body.feedback?.trim() || null };
  }
  if (op === 'rerun_job' && positive(body.job_id) &&
      (body.feedback === undefined || typeof body.feedback === 'string' && body.feedback.length <= 1000)) {
    return { ...action, job_id: body.job_id, feedback: body.feedback?.trim() || null };
  }
  if (op === 'merge' && mergeMethods.has(body.method) && isRevision(body.head_sha) && isRevision(body.base_sha)) {
    return { ...action, method: body.method, head_sha: body.head_sha, base_sha: body.base_sha };
  }
  return null;
}

export async function integrationOperation({ db, owner, namespace, github, access, rerunJob, worker = false, body, now = Date.now() }) {
  const scope = [owner, namespace];
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  const get = async id => decode(await query(
    'SELECT record FROM integration_runs WHERE owner_id = ? AND namespace = ? AND id = ?', ...scope, id,
  ).first());
  const receipt = id => query(
    'SELECT integration_id, event FROM integration_events WHERE owner_id = ? AND namespace = ? AND operation_id = ?', ...scope, id,
  ).first();
  const candidateRow = id => query(
    'SELECT version, record, engine FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?', ...scope, id,
  ).first();

  if (integrationWorkerOps.has(body?.op) && !worker) return errors(403, 'Executor authorization required');
  if (worker && !integrationWorkerOps.has(body?.op)) return errors(403, 'Executor scope does not allow this operation');
  const repairing = repairWorkerOps.has(body?.op);
  const ciTick = body?.op === 'ci_tick';
  if (worker && !(ciTick ? access.ci_enabled && rerunJob : repairing ? access.repair_enabled : access.transfer_enabled)) {
    return errors(403, 'Integration work authorization is unavailable');
  }
  if (body?.op === 'repair_status') {
    if (!uuid(body.id) || !uuid(body.repair_id) || !uuid(body.worker_id) || !uuid(body.claim_id)) return errors(400, 'Invalid repair claim');
    const run = await get(body.id);
    const repair = run?.source_repairs?.find(item=>item.id === body.repair_id && item.worker_id === body.worker_id &&
      item.claim_id === body.claim_id);
    const current = repair?.status === 'running' && Date.parse(repair.expires_at) > now &&
      (!run.task || acceptedCandidate(await candidateRow(run.task.id))?.attempt_id === run.task.attempt_id);
    return success({ active: Boolean(current), ...(repair ? { version:run.version } : {}) });
  }
  const tick = body?.op === 'repair_tick' || ciTick;
  const claimOperation = ['integration_claim','repair_claim'].includes(body?.op) || tick;
  const asJob = (run, job) => ({ ...job, ...(job.kind === 'source_repair' ? { task_id: run.task?.id ?? null } :
    { task: sourceFor(run), ref_id: run.reviewed_source?.repair_id ?? run.id }),
    integration_id: run.id, version: run.version });
  if (claimOperation && body.id !== undefined) return errors(400, 'Integration work selection belongs to the queue');
  if (claimOperation) {
    if (!uuid(body.worker_id) || !uuid(body.operation_id) ||
        (body.task_ids !== undefined && (!Array.isArray(body.task_ids) || body.task_ids.length > 500 || !body.task_ids.every(taskId)))) {
      return errors(400, 'Invalid transfer claim');
    }
    const previous = await receipt(body.operation_id);
    if (previous) {
      const run = await get(previous.integration_id);
      if (tick) return success({ run, replayed:true });
      const job = run && (repairing ? activeRepair(run) : run.transfer);
      return job?.worker_id === body.worker_id && job.claim_id === body.operation_id &&
        job.status === 'claimed' && Date.parse(job.expires_at) > now
        ? success({ job: asJob(run, job) })
        : success({ job: null });
    }
    const tickPolicy = ciTick ? '$.policy.auto_ci_reruns' : '$.policy.auto_source_repair';
    const pending = await query(`SELECT record FROM integration_runs WHERE owner_id = ? AND namespace = ?
      AND state NOT IN ('merged','deployed')
      AND json_extract(record, ?) = ? AND (? = 0 OR json_extract(record, ?) <= ?)
      ORDER BY updated_at LIMIT 100`, ...scope,
    tick ? tickPolicy+'.status' : repairing ? '$.source_repairs[#-1].status' : '$.transfer.status',
    tick ? 'armed' : 'queued', Number(tick), tickPolicy+'.next_poll_at', now).all();
    const run = pending.results.map(decode).find(item => !body.task_ids || body.task_ids.includes(item.task?.id));
    if (!run) return success({ job: null });
    body = { ...body, id: run.id, expected_version: run.version };
  }
  if (body?.op === 'list') {
    if (body.task_id !== undefined && !taskId(body.task_id)) return errors(400, 'Invalid Task identity');
    const rows = await query(`SELECT record FROM integration_runs WHERE owner_id = ? AND namespace = ?
      AND (? IS NULL OR task_id = ?) ORDER BY updated_at DESC, id DESC LIMIT 100`,
    ...scope, body.task_id ?? null, body.task_id ?? null).all();
    return success({ access, runs: rows.results.map(decode) });
  }
  if (body?.op === 'get' && uuid(body.id)) {
    const run = await get(body.id);
    if (!run) return errors(404, 'Integration run not found');
    const history = await query(`SELECT event FROM integration_events WHERE owner_id = ? AND namespace = ?
      AND integration_id = ? ORDER BY version DESC LIMIT ?`, ...scope, run.id, maxEvents).all();
    return success({ access, run, events: history.results.map(row => JSON.parse(row.event)).map(({ digest, ...event }) => event) });
  }

  const action = actionFor(body);
  if (!action) return errors(400, 'Invalid integration operation');
  if (action.op === 'merge' && !access.merge_enabled) return errors(403, 'Merge write authorization is unavailable');
  if (action.op === 'publish' && !access.publish_enabled) return errors(403, 'Pull request publication authorization is unavailable');
  if (['repair_source','arm_repair'].includes(action.op) && !access.repair_enabled) return errors(403, 'Codex source repair authorization is unavailable');
  if (action.op === 'rerun_job' && (!access.ci_enabled || !rerunJob)) return errors(403, 'CI rerun authorization is unavailable');
  if (action.op === 'arm_ci_reruns' && (!access.ci_enabled || !rerunJob)) return errors(403, 'CI rerun authorization is unavailable');
  const digest = await sha256(JSON.stringify(action));
  const replay = async () => {
    const previous = await receipt(action.operation_id);
    if (!previous) return null;
    if (JSON.parse(previous.event).digest !== digest) return errors(409, 'Operation identity already used');
    return success({ access, run: await get(previous.integration_id), replayed: true });
  };
  const previous = await replay();
  if (previous) return previous;
  const at = new Date(now).toISOString();
  const makeEvent = (run, operation, kind, inputDigest) => ({
    operation_id: operation, digest: inputDigest, actor: worker ? 'executor' : kind.endsWith('_response') ? 'github' : 'owner',
    at, kind, state: run.state, reason: run.evidence?.reason ?? null, head_sha: run.head_sha,
    base_sha: run.evidence?.base_sha ?? null, pr_number: run.pr_number, version: run.version,
    ...(run.merge_attempt ? { merge_attempt: run.merge_attempt } : {}),
    ...(kind.startsWith('publication_') ? { publication: run.publication } : {}),
    ...(kind.startsWith('transfer_') ? { transfer_status: run.transfer?.status } : {}),
    ...(kind.startsWith('source_repair_') ? { source_repair: run.source_repairs?.at(-1) } : {}),
    ...(kind.startsWith('source_repair_') && run.policy.auto_source_repair ? { automatic_policy:run.policy.auto_source_repair } : {}),
    ...(kind.startsWith('ci_auto_') ? { automatic_policy:run.policy.auto_ci_reruns } : {}),
    ...(kind === 'ci_logs_observed' ? { log_diagnostics:run.log_diagnostics } : {}),
    ...(['repair_reserved','repair_response'].includes(kind) ? { ci_repair:run.repair_attempts?.at(-1) } : {}),
    ...(['retry', 'rerun_job'].includes(action.op) ? { feedback: action.feedback } : {}),
    ...(kind.startsWith('repair_') ? { repair_attempt: run.repair_attempts?.at(-1) } : {}),
  });
  const update = async (run, version, operation = action.operation_id, kind = action.op, inputDigest = digest) => query(
    `UPDATE integration_runs SET pr_number = ?, head_sha = ?, state = ?, version = ?, updated_at = ?, record = ?, event = ?
      WHERE owner_id = ? AND namespace = ? AND id = ? AND version = ? RETURNING record`,
    run.pr_number, run.head_sha, run.state, run.version, at, JSON.stringify(run), JSON.stringify(makeEvent(run, operation, kind, inputDigest)),
    ...scope, run.id, version,
  ).first();
  const conflict = async () => await replay() ?? errors(409, 'Integration changed or the exact source already has an integration run');

  if (action.op === 'start') {
    const source = action.task_id ? await candidateRow(action.task_id) : null;
    const task = acceptedCandidate(source);
    if (action.task_id && (!task || (action.head_sha && action.head_sha !== task.head_sha))) {
      return errors(409, 'A current owner-accepted Task candidate is required');
    }
    const run = {
      id: action.operation_id, version: 1, repository: REPO, target: 'main', created_at: at,
      task, head_sha: task?.head_sha ?? action.head_sha, pr_number: action.pr_number ?? null,
      state: 'awaiting_pr', policy: { approval: 'explicit_owner_confirmation', repair_limit: action.repair_limit },
    };
    if (run.pr_number) {
      applyEvidence(run, await github.inspect(run));
    }
    try {
      const inserted = await query(`INSERT INTO integration_runs
        (owner_id, namespace, id, task_id, task_attempt_id, head_sha, pr_number, state, version, updated_at, record, event)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? IS NULL OR EXISTS (SELECT 1 FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ? AND version = ?)
        RETURNING record`, ...scope, run.id, task?.id ?? null, task?.attempt_id ?? null, run.head_sha, run.pr_number,
      run.state, run.version, at, JSON.stringify(run), JSON.stringify(makeEvent(run, action.operation_id, 'start', digest)),
      task?.id ?? null, ...scope, task?.id ?? null, source?.version ?? null).first();
      return inserted ? { status: 201, body: { access, run } } : conflict();
    } catch (error) {
      if (!/unique constraint/i.test(String(error))) throw error;
      return conflict();
    }
  }

  const current = await get(action.id);
  if (!current) return errors(404, 'Integration run not found');
  if (current.version !== action.expected_version) return conflict();
  if (merged(current)) return errors(409, 'The integration already has verified merge evidence');
  const sameCandidate = async () => !current.task ||
    acceptedCandidate(await candidateRow(current.task.id))?.attempt_id === current.task.attempt_id;
  if (!await sameCandidate() && !['stop', 'refresh','repair_tick','ci_tick','disarm_ci_reruns','repair_claim','integration_claim'].includes(action.op)) {
    return errors(409, 'Task acceptance changed. A new review and integration run are required');
  }
  const next = { ...current, version: current.version + 1 };
  const repair = activeRepair(current);
  const ciPolicy = current.policy.auto_ci_reruns;
  const ciRepair = current.repair_attempts?.at(-1);
  const setCIPolicy = (status, reason, nextPoll = now+60_000) => {
    if (ciPolicy) next.policy = { ...current.policy, auto_ci_reruns:{ ...ciPolicy, status, reason,
      next_poll_at:nextPoll } };
  };
  const reconcileCI = () => {
    if (ciRepair && unresolvedCI.has(ciRepair.status) && next.evidence?.workflows?.some(run =>
      run.run_id === ciRepair.run_id && run.workflow_id === ciRepair.workflow_id && run.head_sha === ciRepair.head_sha &&
      run.attempt > ciRepair.run_attempt)) {
      next.repair_attempts = [...current.repair_attempts.slice(0,-1), {...ciRepair,status:'observed'}];
    }
    return unresolvedCI.has(next.repair_attempts?.at(-1)?.status);
  };
  const stoppedRepair = action.op === 'repair_report' && current.source_repairs?.find(item =>
    item.status === 'stopped' && item.id === action.repair_id && item.worker_id === action.worker_id &&
    item.claim_id === action.claim_id && item.started_at && !item.usage);
  const replaceRepair = changes => {
    next.source_repairs = current.source_repairs.map(item => item.id === repair.id ? { ...item, ...changes } : item);
    return next.source_repairs.find(item => item.id === repair.id);
  };
  async function planRepair(paths, feedback, auto, inspected = current) {
    if (repair || current.stopped || inspected.state !== 'blocked' || !current.pr_number || !canSubmit(current) ||
        unresolvedCI.has(ciRepair?.status) ||
        inspected.evidence?.reason !== 'ci_failure') return errors(409, 'A confirmed source failure and an idle integration are required');
    const attempts = current.source_repairs ?? [];
    if (repairsUsed(current) >= current.policy.repair_limit) return errors(409, 'Integration repair limit reached');
    if (attempts.some(item => ['failed','stopped'].includes(item.status) && item.started_at && !item.usage?.complete)) {
      return errors(409, 'Earlier source repair usage is incomplete and its budget cannot be reconciled');
    }
    const tokens = attempts.reduce((sum,item)=>sum+(item.usage?.total_tokens ?? 0),0);
    const tokenBudget = Math.min(sourceBudget.tokens, current.policy.repair_limit * sourceBudget.tokens - tokens);
    if (tokenBudget < 10_000) return errors(409, 'The integration source repair token budget is exhausted');
    const diagnostics = await github.repairSource(inspected,{includeLogs:true,allowedPaths:paths});
    if (!diagnostics || !paths.every(path => diagnostics.paths.includes(path)) || !await sameCandidate()) {
      return errors(409, 'Source diagnostics or the approved paths no longer match the exact GitHub head');
    }
    const fingerprint = await repairFingerprint(diagnostics);
    if (attempts.some(item => item.fingerprint === fingerprint && item.feedback === feedback)) {
      return errors(409, 'This source failure already has a repair with the same owner feedback');
    }
    next.source_repairs = [...attempts, { id:action.operation_id, kind:'source_repair', status:'queued', at,
      head_sha:current.head_sha, base_sha:diagnostics.base_sha, pr_number:current.pr_number, paths, feedback,
      jobs:diagnostics.jobs, fingerprint, max_tokens:tokenBudget, max_minutes:sourceBudget.minutes,
      ...(auto ? { authorization_id:auto.id } : {}) }];
    next.state = 'repairing';
    return null;
  }
  function eligibleCIJobs(evidence) {
    return (evidence.jobs ?? []).filter(job => job.infrastructure && job.head_sha === current.head_sha &&
      !(current.repair_attempts ?? []).some(item => item.job_id === job.job_id && item.run_id === job.run_id &&
        item.run_attempt === job.attempt && item.head_sha === job.head_sha));
  }
  function withinBackoff() {
    const attempts = current.repair_attempts ?? [];
    return attempts.length && now - Date.parse(attempts.at(-1).at) < repairBackoff * 2 ** (attempts.length - 1);
  }
  async function submitIntegrationRerun(job, evidence, authorization) {
    const receipt = { id:action.operation_id, kind:'ci_job_rerun', status:'reserved', at,
      head_sha:job.head_sha, base_sha:evidence.base_sha, run_id:job.run_id, workflow_id:job.workflow_id,
      job_id:job.job_id, run_attempt:job.attempt, ...(authorization ? {authorization_id:authorization.id} : {}) };
    const prior = next.repair_attempts ?? [];
    applyEvidence(next, evidence);
    next.state = 'repairing';
    next.repair_attempts = [...prior, receipt];
    if (!await update(next,current.version,action.operation_id,'repair_reserved')) return conflict();
    let status = 'unknown';
    try {
      if (!await sameCandidate() || (github.rerunTarget && !await github.rerunTarget(next))) status = 'rejected';
      else {
        const result = await rerunJob(job,receipt.id);
        if (['accepted','observed'].includes(result.body?.operation?.state)) status = 'submitted';
        if (result.body?.operation?.state === 'rejected' || [400,401,403,404,422].includes(result.status)) status = 'rejected';
      }
    } catch { /* An uncertain write remains fenced until a new exact workflow attempt is observed. */ }
    next.repair_attempts = [...prior, {...receipt,status}];
    if (status === 'rejected') {
      next.state = 'blocked';
      if (ciPolicy?.status === 'armed') setCIPolicy('disarmed','rerun_rejected');
    }
    next.version += 1;
    return await update(next,next.version-1,crypto.randomUUID(),'repair_response','ci-operation-receipt')
      ? success({access,run:next}) : success({access,run:await get(current.id)});
  }

  try {
    if (stoppedRepair && action.status === 'failed' && action.usage && action.session_id && action.turn_id) {
      next.source_repairs = current.source_repairs.map(item => item.id === stoppedRepair.id ? { ...item,
        session_id:action.session_id, turn_id:action.turn_id, usage:action.usage, execution_identity:action.execution_identity } : item);
      return await update(next, current.version, action.operation_id, 'source_repair_usage_reconciled')
        ? success({ access, run: next }) : conflict();
    }
    if (action.op === 'arm_ci_reruns') {
      if (repair || current.stopped || !current.pr_number || !['checking','blocked'].includes(current.state) ||
          !canSubmit(current) || unresolvedCI.has(ciRepair?.status) || repairsUsed(current) >= current.policy.repair_limit ||
          current.head_sha !== action.head_sha || current.evidence?.base_sha !== action.base_sha ||
          stopAutomation.has(current.evidence?.reason) || current.evidence?.reason === 'ci_failure') {
        return errors(409,'Confirm an eligible head and base before authorizing automatic infrastructure reruns');
      }
      next.policy = {...current.policy, auto_ci_reruns:{id:action.operation_id,status:'armed',armed_at:at,
        expires_at:now+30*60_000,next_poll_at:now,head_sha:action.head_sha,base_sha:action.base_sha}};
      return await update(next,current.version,action.operation_id,'ci_auto_armed') ? success({access,run:next}) : conflict();
    }
    if (action.op === 'disarm_ci_reruns') {
      if (ciPolicy?.status !== 'armed') return conflict();
      if (ciRepair?.status === 'reserved' && now - Date.parse(ciRepair.at) < 45_000) {
        return errors(409,'The reserved rerun is being submitted. Disarm after submission returns.');
      }
      setCIPolicy('disarmed','owner_disarmed');
      return await update(next,current.version,action.operation_id,'ci_auto_disarmed') ? success({access,run:next}) : conflict();
    }
    if (action.op === 'ci_tick') {
      if (ciPolicy?.status !== 'armed') return conflict();
      if (ciPolicy.expires_at <= now || ciPolicy.head_sha !== current.head_sha || current.stopped || repair ||
          !canSubmit(current) || !await sameCandidate()) setCIPolicy('disarmed','scope_ended');
      else if (ciRepair?.status === 'reserved' && now - Date.parse(ciRepair.at) < 45_000) {
        return success({run:current});
      } else {
        const evidence = await github.inspect({...current,expected_base:ciPolicy.base_sha});
        applyEvidence(next,evidence);
        const unresolved = reconcileCI();
        if (unresolved && evidence.state==='merge_ready') next.state = 'repairing';
        if (stopAutomation.has(evidence.reason) || evidence.reason === 'ci_failure' ||
            ['merge_ready','merged'].includes(evidence.state)) setCIPolicy('disarmed',evidence.reason ?? evidence.state);
        else if (evidence.reason==='rate_limited') {
          if (unresolved) next.state='repairing';
          const retryAt = Number.isSafeInteger(evidence.retry_at) && evidence.retry_at>now ? evidence.retry_at : now+5*60_000;
          setCIPolicy('armed','rate_limited',Math.min(ciPolicy.expires_at,Math.max(now+60_000,retryAt)));
        }
        else if (unresolved) {
          next.state = 'repairing';
          setCIPolicy('armed','awaiting_rerun_readback');
        } else if (repairsUsed(current) >= current.policy.repair_limit) setCIPolicy('exhausted','repair_limit');
        else if (evidence.reason === 'ci_infrastructure' && evidence.base_sha !== ciPolicy.base_sha) {
          setCIPolicy('disarmed','base_drift');
        } else if (evidence.reason === 'ci_infrastructure') {
          const job = eligibleCIJobs(evidence).find(item=>item.required_check === true);
          if (!job) setCIPolicy('disarmed','no_new_required_transient_job');
          else if (!withinBackoff()) {
            setCIPolicy('armed','rerun_reserved');
            return submitIntegrationRerun(job,evidence,ciPolicy);
          } else setCIPolicy('armed','backoff');
        } else setCIPolicy('armed',evidence.reason ?? 'checking');
      }
      return await update(next,current.version,action.operation_id,'ci_auto_checked') ? success({access,run:next}) : conflict();
    }
    if (action.op === 'inspect_logs') {
      if (repair || current.stopped || current.evidence?.reason !== 'ci_failure' || !current.pr_number) {
        return errors(409,'Confirm the failed source checks before reading failed-step diagnostics');
      }
      const evidence = await github.repairSource(current,{includeLogs:true});
      if (!evidence || !await sameCandidate()) return errors(409,'The exact PR head, base or workflow attempt could not be reconfirmed');
      next.log_diagnostics = { ...evidence, observed_at:at };
      return await update(next,current.version,action.operation_id,'ci_logs_observed') ? success({access,run:next}) : conflict();
    }
    if (action.op === 'arm_repair') {
      if (repair || current.stopped || !current.pr_number || !['checking','blocked'].includes(current.state) ||
          !canSubmit(current) || current.head_sha !== action.head_sha || current.evidence?.base_sha !== action.base_sha ||
          repairsUsed(current) >= current.policy.repair_limit ||
          ['policy','identity','permission','repository_or_credential','head_drift','base_drift','merge_conflict']
            .includes(current.evidence?.reason)) return errors(409, 'Confirm an eligible pending source head and base');
      next.policy = { ...current.policy, auto_source_repair: { id:action.operation_id, status:'armed', armed_at:at,
        expires_at:now+30*60_000, next_poll_at:now, head_sha:action.head_sha, base_sha:action.base_sha,
        paths:action.paths, feedback:action.feedback } };
      return await update(next, current.version, action.operation_id, 'source_repair_armed') ? success({ access, run: next }) : conflict();
    }
    if (action.op === 'repair_tick') {
      const policy = current.policy.auto_source_repair;
      if (policy?.status !== 'armed') return conflict();
      let result = 'armed';
      let reason;
      if (policy.expires_at <= now || repair || policy.head_sha !== next.head_sha || !canSubmit(current) ||
          current.stopped || !await sameCandidate()) {
        result = 'disarmed';
      } else {
        applyEvidence(next, await github.inspect({ ...current, expected_base:policy.base_sha }));
        if (next.evidence.reason === 'ci_failure') {
          const denied = await planRepair(policy.paths, policy.feedback, policy, next);
          result = denied ? 'disarmed' : 'used';
          reason = denied?.body.error;
        } else if (next.state === 'merged' || next.state === 'merge_ready' ||
            ['policy','identity','permission','repository_or_credential','head_drift','base_drift','merge_conflict']
              .includes(next.evidence.reason)) result = 'disarmed';
      }
      next.policy = { ...current.policy, auto_source_repair:{ ...policy, status:result, ...(reason ? { reason } : {}),
        next_poll_at:now+60_000 } };
      const event = result === 'used' ? 'source_repair_auto_queued' : 'source_repair_policy_checked';
      return await update(next, current.version, action.operation_id, event) ? success({ run: next }) : conflict();
    }
    if (action.op === 'repair_source') {
      const denied = await planRepair(action.paths, action.feedback, null);
      if (denied) return denied;
      if (current.policy.auto_source_repair?.status === 'armed') {
        next.policy = {...current.policy, auto_source_repair:{...current.policy.auto_source_repair,status:'disarmed'}};
      }
      return await update(next, current.version, action.operation_id, 'source_repair_queued') ? success({ access, run: next }) : conflict();
    }
    if (action.op === 'review_repair') {
      if (repair?.status !== 'awaiting_review' || repair.id !== action.repair_id || repair.candidate_sha !== action.candidate_sha ||
          repair.tree_sha !== action.tree_sha || repair.head_sha !== current.head_sha || !canSubmit(current)) {
        return errors(409, 'Confirm the exact repair candidate and tree');
      }
      if (action.decision === 'approve') {
        const diagnostics = await github.repairSource(current);
        const fingerprint = diagnostics && await repairFingerprint(diagnostics);
        if (fingerprint !== repair.fingerprint || !await sameCandidate()) return errors(409, 'The original source evidence changed before review');
      }
      replaceRepair({ status: action.decision === 'approve' ? 'approved' : 'rejected', reviewed_at: at });
      if (action.decision === 'reject') next.state = 'blocked';
      else {
        next.reviewed_source = { id: 'task_' + repair.id, repair_id: repair.id, head_sha: repair.candidate_sha,
          parent_sha: repair.head_sha, branch: 'codex/aads-task-' + repair.id, tree_sha: repair.tree_sha };
        next.original_head_sha = current.original_head_sha ?? current.head_sha;
        next.head_sha = repair.candidate_sha;
        next.pr_number = null;
        next.state = 'awaiting_pr';
        for (const field of ['published_branch','publication','transfer','merge_attempt','evidence','log_diagnostics']) delete next[field];
        if (ciPolicy?.status === 'armed') setCIPolicy('disarmed','source_changed');
      }
      return await update(next, current.version, action.operation_id, 'source_repair_reviewed') ? success({ access, run: next }) : conflict();
    }
    if (repairing) {
      if (!repair || current.stopped) return errors(409, 'No source repair is available');
      if (action.op === 'repair_claim') {
        if (repair.status !== 'queued') return conflict();
        if (!await sameCandidate()) {
          replaceRepair({status:'failed',finished_at:at,reason:'acceptance_changed'});
          next.state = 'blocked';
          return await update(next, current.version, action.operation_id, 'source_repair_scope_expired')
            ? success({job:null}) : conflict();
        }
        const claimed = replaceRepair({ status: 'claimed', worker_id: action.worker_id, claim_id: action.operation_id,
          expires_at: new Date(now + repair.max_minutes * 60_000).toISOString(),
          previous: (current.source_repairs ?? []).slice(0,-1).map(item=>({ head_sha:item.head_sha,
            status:item.status, feedback:item.feedback, candidate_sha:item.candidate_sha ?? null })) });
        return await update(next, current.version, action.operation_id, 'source_repair_claimed')
          ? success({ job: asJob(next, claimed) }) : conflict();
      }
      if (repair.id !== action.repair_id || repair.worker_id !== action.worker_id || repair.claim_id !== action.claim_id ||
          Date.parse(repair.expires_at) <= now) return errors(409, 'Source repair claim is invalid or expired');
      if (action.op === 'repair_begin') {
        if (repair.status !== 'claimed') return conflict();
        const diagnostics = await github.repairSource(current);
        const fingerprint = diagnostics && await repairFingerprint(diagnostics);
        if (fingerprint !== repair.fingerprint || !repair.paths.every(path => diagnostics.paths.includes(path)) ||
            !await sameCandidate()) return errors(409, 'The repair head or failing CI attempt has changed');
        replaceRepair({ status: 'running', started_at: at });
        return await update(next, current.version, action.operation_id, 'source_repair_begun') ? success({ run: next }) : conflict();
      }
      if (repair.status !== 'running' && !(repair.status === 'claimed' && action.status === 'failed')) return conflict();
      const valid = action.status === 'candidate' && action.candidate_sha !== repair.head_sha &&
        new Set(action.changed_paths).size === action.changed_paths.length &&
        action.changed_paths.every(path => repair.paths.includes(path)) && action.usage.total_tokens <= repair.max_tokens;
      replaceRepair({ status: valid ? 'awaiting_review' : 'failed', finished_at: at, usage: action.usage,
        session_id: action.session_id, turn_id: action.turn_id, execution_identity:action.execution_identity,
        ...(valid ? { candidate_sha: action.candidate_sha, tree_sha: action.tree_sha, changed_paths: action.changed_paths } : {}) });
      next.state = valid ? 'repairing' : 'blocked';
      return await update(next, current.version, action.operation_id, 'source_repair_finished') ? success({ run: next }) : conflict();
    }
    if (worker) {
      if (!sourceFor(current) || current.pr_number || current.stopped || !current.transfer) return errors(409, 'Transfer is no longer available');
      const transfer = current.transfer;
      if (action.op === 'integration_claim') {
        if (transfer.status !== 'queued') return conflict();
        if (!await sameCandidate()) {
          next.transfer = {...transfer,status:'failed',reason:'acceptance_changed'};
          return await update(next, current.version, action.operation_id, 'transfer_scope_expired')
            ? success({job:null}) : conflict();
        }
        next.transfer = { ...transfer, status: 'claimed', worker_id: action.worker_id, claim_id: action.operation_id,
          expires_at: new Date(now + transferLeaseMs).toISOString() };
        return await update(next, current.version, action.operation_id, 'transfer_claimed')
          ? success({ job: asJob(next, next.transfer) }) : conflict();
      }
      if (transfer.worker_id !== action.worker_id || transfer.claim_id !== action.claim_id ||
          Date.parse(transfer.expires_at) <= now) return errors(409, 'Transfer claim is invalid or expired');
      if (action.op === 'integration_begin') {
        if (transfer.status !== 'claimed') return conflict();
        const source = await github.publicationSource(sourceFor(current), transfer.branch);
        if (sourceFor(current).tree_sha && sourceFor(current).tree_sha !== action.tree_sha) return errors(409, 'Reviewed tree changed');
        if (!source.transfer_required && !(source.available && source.branch_exists && source.tree_sha === action.tree_sha)) {
          return errors(409, 'Protected candidate destination could not be reconfirmed');
        }
        if (source.branch_exists) {
          next.transfer = { ...transfer, status: 'verified', tree_sha: action.tree_sha, verified_at: at };
        } else {
          if (action.shallow_base && !await github.transferAnchor(action.shallow_base)) {
            return errors(409, 'GitHub did not confirm the shallow history boundary');
          }
          next.transfer = { ...transfer, status: 'sending', tree_sha: action.tree_sha };
        }
        if (!await sameCandidate()) return errors(409, 'Task acceptance changed before transfer');
        return await update(next, current.version, action.operation_id, 'transfer_begin')
          ? success({ run: next }) : conflict();
      }
      if (transfer.status !== 'sending' && !(transfer.status === 'claimed' && action.status === 'failed')) return conflict();
      const source = transfer.status === 'sending' ? await github.publicationSource(sourceFor(current), transfer.branch) : null;
      const verified = source?.available && source.branch_exists && source.tree_sha === transfer.tree_sha;
      next.transfer = { ...transfer, status: verified ? 'verified' : transfer.status === 'claimed' ? 'failed' : 'unknown',
        ...(verified ? { verified_at: at } : {}) };
      return await update(next, current.version, action.operation_id, 'transfer_report')
        ? success({ run: next }) : conflict();
    }
    if (action.op === 'publish') {
      if (!sourceFor(current) || current.pr_number || current.stopped || current.head_sha !== action.head_sha) {
        return errors(409, 'Confirm the current reviewed Task candidate without an attached pull request');
      }
      if (current.publication?.status === 'reserved' && now - Date.parse(current.publication.at) < 45_000) {
        return errors(409, 'Pull request publication is still in progress');
      }
      const branch = branchFor(current);
      const source = await github.publicationSource(sourceFor(current), branch);
      if (source.transfer_required && access.transfer_enabled) {
        const transfer = current.transfer;
        if (transfer && !['failed', 'queued', 'claimed'].includes(transfer.status)) {
          return errors(409, 'Prior transfer is unresolved. Confirm the exact remote ref before retrying.');
        }
        if (transfer?.status === 'queued' || (transfer?.status === 'claimed' && Date.parse(transfer.expires_at) > now)) {
          return errors(409, 'The exact candidate transfer is already awaiting the worker');
        }
        if (!await sameCandidate()) return errors(409, 'Task acceptance changed before transfer');
        next.transfer = { id: action.operation_id, branch, status: 'queued', at };
        return await update(next, current.version, action.operation_id, 'transfer_queued')
          ? success({ access, run: next }) : conflict();
      }
      if (!source.available) return errors(409, source.reason);
      if (sourceFor(current).tree_sha && source.tree_sha !== sourceFor(current).tree_sha) return errors(409, 'The published tree differs from the reviewed repair');
      if (!await sameCandidate()) return errors(409, 'Task acceptance changed during publication confirmation');
      if (current.transfer && current.transfer.status !== 'failed') {
        if (!source.branch_exists || (current.transfer.tree_sha && current.transfer.tree_sha !== source.tree_sha)) {
          return errors(409, 'The protected branch does not match the verified transfer');
        }
        next.transfer = { ...current.transfer, status: 'verified', tree_sha: source.tree_sha, verified_at: at };
      }
      if (source.pr_number) {
        next.pr_number = source.pr_number;
        next.published_branch = branch;
        applyEvidence(next, await github.inspect(next));
        if (next.evidence.tree_sha !== source.tree_sha) return errors(409, 'The opened pull request does not match the reviewed candidate');
        return await update(next, current.version, action.operation_id, 'publication_observed') ? success({ access, run: next }) : conflict();
      }
      if (current.publication && current.publication.status !== 'rejected') {
        return errors(409, 'An earlier publication result is unresolved. Reconcile the exact GitHub branch before sending another request.');
      }
      next.publication = { id: action.operation_id, at, status: 'reserved', tree_sha: source.tree_sha, branch };
      if (!await update(next, current.version, action.operation_id, 'publication_reserved')) return conflict();
      const response = await sameCandidate() ? await github.openCandidatePull(sourceFor(next), branch, source) : { status: 'rejected' };
      next.publication = { ...next.publication, status: response.status };
      if (response.pr_number) {
        const inspected = { ...next, pr_number: response.pr_number, published_branch: branch };
        const evidence = await github.inspect(inspected);
        if (evidence.tree_sha === source.tree_sha) {
          next.pr_number = response.pr_number;
          next.published_branch = branch;
          applyEvidence(next, evidence);
        }
      }
      next.version += 1;
      return await update(next, next.version - 1, crypto.randomUUID(), 'publication_response', 'github-readback')
        ? success({ access, run: next }) : success({ access, run: await get(current.id) });
    }
    if (action.op === 'rerun_job') {
      if (current.state !== 'blocked' || current.stopped || current.evidence?.reason !== 'ci_infrastructure' || !canSubmit(current)) {
        return errors(409, 'A classified infrastructure failure is required for an integration rerun');
      }
      if (repairsUsed(current) >= current.policy.repair_limit) return errors(409, 'Integration repair limit reached');
      if (unresolvedCI.has(ciRepair?.status)) return errors(409,'Reconcile the prior CI rerun first');
      if (withinBackoff()) {
        return errors(409, 'Wait for the current retry backoff window');
      }
      const evidence = await github.inspect({ ...current, expected_base: current.evidence.base_sha });
      const job = evidence.reason === 'ci_infrastructure' && eligibleCIJobs(evidence).find(item=>item.job_id === action.job_id);
      if (!job || !await sameCandidate()) return errors(409, 'The exact failed job or reviewed source changed');
      return submitIntegrationRerun(job,evidence,null);
    }
    if (action.op === 'merge') {
      if (current.state !== 'merge_ready' || !canSubmit(current) || unresolvedCI.has(ciRepair?.status) || action.head_sha !== current.head_sha ||
          action.base_sha !== current.evidence?.base_sha) return errors(409, 'Confirm the current eligible head and base');
      applyEvidence(next, await github.inspect({ ...current, expected_base: action.base_sha }));
      if (!await sameCandidate()) return errors(409, 'Task acceptance changed during merge confirmation');
      if (next.state !== 'merge_ready' || (!next.evidence.queue_required && !next.evidence.strict_base)) {
        if (next.state === 'merge_ready') {
          next.state = 'blocked';
          next.evidence = { ...next.evidence, state: 'blocked', reason: 'policy', detail: 'Direct merge requires strict base protection.' };
        }
        return await update(next, current.version, action.operation_id, 'merge_preflight') ? success({ access, run: next }) : conflict();
      }
      next.merge_attempt = { id: action.operation_id, head_sha: action.head_sha, base_sha: action.base_sha,
        method: next.evidence.queue_required ? 'repository_queue' : action.method, requested_at: at, status: 'reserved' };
      next.state = 'checking';
      if (!await update(next, current.version, action.operation_id, 'merge_reserved')) return conflict();
      let response = { status: 'unavailable' };
      if (await sameCandidate()) {
        response = await github.requestMerge(next.pr_number, next.head_sha, action.method, next.evidence.queue_required, action.base_sha);
      }
      next.merge_attempt = { ...next.merge_attempt, ...response };
      next.version += 1;
      if (['rejected', 'unavailable'].includes(response.status)) {
        next.state = 'blocked';
        next.evidence = { ...next.evidence, state: 'blocked', reason: response.reason ?? 'merge_request_failed',
          detail: response.reason ? 'The exact GitHub target could not be reconfirmed before submission.' : 'GitHub did not accept the merge request.' };
      } else {
        const observed = await github.inspect(next);
        if (observed.state === 'merged') {
          applyEvidence(next, observed);
        }
      }
      return await update(next, next.version - 1, crypto.randomUUID(), 'merge_response', 'github-readback')
        ? success({ access, run: next }) : success({ access, run: await get(current.id) });
    }
    if (action.op === 'stop') {
      if (['sending', 'unknown'].includes(current.transfer?.status)) return errors(409, 'Reconcile the remote transfer before stopping');
      if (['queued', 'claimed'].includes(current.transfer?.status)) next.transfer = { ...current.transfer, status: 'failed' };
      if (repair) replaceRepair({ status: 'stopped', finished_at: at });
      if (current.policy.auto_source_repair?.status === 'armed') {
        next.policy = {...current.policy, auto_source_repair:{...current.policy.auto_source_repair,status:'disarmed'}};
      }
      if (ciPolicy?.status === 'armed') {
        next.policy = {...next.policy,auto_ci_reruns:{...ciPolicy,status:'disarmed',reason:'owner_stopped'}};
      }
      if (!canSubmit(current)) return errors(409, 'A submitted operation requires GitHub reconciliation');
      if (current.state === 'repairing' && !repair) return errors(409, 'The submitted repair requires GitHub reconciliation');
      if (current.publication && current.publication.status !== 'rejected' && !current.pr_number) {
        return errors(409, 'The submitted publication requires GitHub reconciliation');
      }
      next.state = 'blocked';
      next.stopped = true;
      next.evidence = { ...current.evidence, state: 'blocked', reason: 'stopped', detail: 'Stopped by the owner.' };
    } else {
      if (repair) return errors(409, 'Source repair must finish or be stopped before checking the original PR again');
      if (action.op === 'attach') {
        if (current.pr_number || !sourceFor(current)) return errors(409, 'A reviewed candidate without a pull request is required');
        if (current.publication && current.publication.status !== 'rejected') {
          return errors(409, 'Reconcile the managed publication before attaching a different pull request');
        }
        next.pr_number = action.pr_number;
      }
      if (!next.pr_number) return errors(409, 'Attach the reviewed candidate pull request first');
      if (current.stopped && action.op !== 'retry') return errors(409, 'Use Retry to resume the stopped integration');
      if (current.merge_attempt?.status === 'reserved' && now - Date.parse(current.merge_attempt.requested_at) < 45_000) {
        return errors(409, 'Merge submission is still in progress');
      }
      if (ciRepair?.status === 'reserved' && now - Date.parse(ciRepair.at) < 45_000) {
        return errors(409, 'CI rerun submission is still in progress');
      }
      if (action.op === 'retry') next.stopped = false;
      applyEvidence(next, await github.inspect(next));
      if (ciPolicy?.status === 'armed' && (['merged','merge_ready'].includes(next.state) ||
          stopAutomation.has(next.evidence.reason))) setCIPolicy('disarmed',next.evidence.reason ?? next.state);
      if (reconcileCI() && next.state !== 'merged' && !stopAutomation.has(next.evidence.reason)) next.state = 'repairing';
      if (next.merge_attempt && !canSubmit(next) && next.state !== 'merged') {
        const status = await github.mergeStatus(next.pr_number, next.merge_attempt.github_request_id);
        if (status) next.merge_attempt = { ...next.merge_attempt, status };
        if (!canSubmit(next) && next.state === 'merge_ready') next.state = 'checking';
      }
      if (action.op === 'attach' && ['head_drift', 'identity', 'repository_or_credential', 'permission', 'transport', 'rate_limited']
        .includes(next.evidence.reason)) next.pr_number = null;
    }
    return await update(next, current.version) ? success({ access, run: next }) : conflict();
  } catch (error) {
    if (!/unique constraint/i.test(String(error))) throw error;
    return conflict();
  }
}
