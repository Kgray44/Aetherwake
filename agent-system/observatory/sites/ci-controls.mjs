import { DIAGNOSTIC, diagnosticRunName, isCancellableRun, isFailedConclusion } from '../ci-policy.mjs';
import { REPO, isRevision, readBounded } from './github.mjs';
import { operationId } from './proposal-controls.mjs';

const API = 'https://api.github.com/repos/' + REPO;
const MAX_OPERATIONS = 1000;
const LOOKUP_INTERVAL_MS = 3000;
const POSITIVE = value => Number.isSafeInteger(value) && value > 0;
const failure = (status, error) => ({ status, body: { error } });
const badRequest = () => failure(400, 'Invalid CI operation or target');
const sameRepo = value => value?.full_name === REPO;
const isPinnedRun = (run, id) => run?.id === id && sameRepo(run.repository) &&
  sameRepo(run.head_repository) && isRevision(run.head_sha) && POSITIVE(run.workflow_id) && POSITIVE(run.run_attempt);
const runPath = id => '/actions/runs/' + id;

function validSecret(env) {
  const token = env.GITHUB_ACTIONS_TOKEN;
  return typeof token === 'string' && /^(?:github_pat_|ghs_|ghu_)[A-Za-z0-9_]{20,}$/.test(token) &&
    ![env.GITHUB_PROPOSAL_TOKEN,env.GITHUB_READ_TOKEN,env.GITHUB_INTEGRATION_MERGE_TOKEN,
      env.GITHUB_INTEGRATION_PUBLISH_TOKEN].includes(token);
}

export function ciAccess(env, owner, verification) {
  if (verification !== null) return { enabled: false, reason: 'CI writes are disabled in verification namespaces.' };
  if (!env.OBSERVATORY_CI_OWNER_ID || !validSecret(env)) {
    return { enabled: false, reason: 'A separate repository-scoped GitHub Actions write credential and CI owner binding are required.' };
  }
  if (env.OBSERVATORY_CI_OWNER_ID !== owner) return { enabled: false, reason: 'The signed-in visitor is not authorized for CI actions.' };
  return { enabled: true, diagnostics: [{ key: DIAGNOSTIC.key, name: DIAGNOSTIC.name, ref: DIAGNOSTIC.ref }] };
}

export function integrationCIRerunner({env,owner,verification,fetcher}) {
  if (!ciAccess(env,owner,verification).enabled) return undefined;
  return (job,id) => submitCI({db:env.DB,owner,fetcher,token:env.GITHUB_ACTIONS_TOKEN,
    body:{type:'rerun_job',operation_id:id,expected_revision:job.head_sha,run_id:job.run_id,
      workflow_id:job.workflow_id,attempt:job.attempt,job_id:job.job_id}});
}

function parseAction(body) {
  if (!body || Array.isArray(body) || typeof body.operation_id !== 'string' || !operationId.test(body.operation_id) ||
      !isRevision(body.expected_revision)) return null;
  const { operation_id, type, expected_revision } = body;
  const action = { operation_id, type, expected_revision };
  if (type === 'dispatch') {
    if (body.diagnostic !== DIAGNOSTIC.key) return null;
    action.diagnostic = body.diagnostic;
  } else {
    if (!['rerun_job', 'rerun_failed', 'rerun_run', 'cancel'].includes(type) ||
        !POSITIVE(body.run_id) || !POSITIVE(body.attempt) || !POSITIVE(body.workflow_id)) return null;
    Object.assign(action, { run_id: body.run_id, attempt: body.attempt, workflow_id: body.workflow_id });
    if (type === 'rerun_job') {
      if (!POSITIVE(body.job_id)) return null;
      action.job_id = body.job_id;
    }
  }
  return Object.keys(body).every(key => Object.hasOwn(action, key)) ? action : null;
}

function gitHub(fetcher, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'User-Agent': 'Aetherwake-Engineering-Observatory',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  return async (path, body) => {
    const init = { redirect: 'manual', signal: AbortSignal.timeout(4000), headers, cache: 'no-store' };
    if (body !== undefined) {
      init.method = 'POST';
      init.headers = { ...headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return fetcher(API + path, init);
  };
}

async function readGitHub(send, path, max = 256 * 1024) {
  const response = await send(path);
  if (!response.ok) {
    await response.body?.cancel();
    const error = Error('GitHub target read failed');
    error.status = response.status;
    throw error;
  }
  return JSON.parse(await readBounded(response.body, max));
}

function targetError(message) {
  const error = Error(message);
  error.target = true;
  throw error;
}

function runIdentity(run) {
  return {
    run_id: run.id, workflow_id: run.workflow_id, attempt: run.run_attempt, revision: run.head_sha,
    branch: typeof run.head_branch === 'string' ? run.head_branch.slice(0, 240) : null,
    status: typeof run.status === 'string' ? run.status.slice(0, 48) : null,
    conclusion: typeof run.conclusion === 'string' ? run.conclusion.slice(0, 48) : null,
    pull_requests: Array.isArray(run.pull_requests)
      ? [...new Set(run.pull_requests.filter(pr => POSITIVE(pr?.number) && POSITIVE(run.repository.id) && pr.base?.repo?.id === run.repository.id &&
        pr.head?.sha === run.head_sha).map(pr => pr.number))].slice(0, 20) : [],
  };
}

async function preflight(send, action) {
  if (action.type === 'dispatch') {
    const [workflow, main] = await Promise.all([
      readGitHub(send, '/actions/workflows/' + DIAGNOSTIC.file),
      readGitHub(send, '/git/ref/heads/' + DIAGNOSTIC.ref),
    ]);
    if (workflow?.id !== DIAGNOSTIC.id || workflow.path !== DIAGNOSTIC.path || workflow.state !== 'active' ||
        main?.ref !== 'refs/heads/' + DIAGNOSTIC.ref || main.object?.sha !== action.expected_revision ||
        main.object?.type !== 'commit') targetError('Diagnostic workflow or main revision changed. Refresh the CI panel.');
    return {
      target: { workflow_id: workflow.id, branch: DIAGNOSTIC.ref, revision: action.expected_revision },
      key: 'dispatch:' + workflow.id + ':' + action.expected_revision,
      path: '/actions/workflows/' + workflow.id + '/dispatches',
      body: { ref: DIAGNOSTIC.ref, return_run_details: true, inputs: {
        expected_revision: action.expected_revision, observatory_operation: action.operation_id,
      } },
      expectedStatus: 200,
    };
  }
  const path = runPath(action.run_id);
  const run = await readGitHub(send, path);
  if (!isPinnedRun(run, action.run_id) || run.head_sha !== action.expected_revision ||
      run.workflow_id !== action.workflow_id || run.run_attempt !== action.attempt) {
    targetError('The workflow run is stale, belongs to a fork, or does not match the confirmed revision. Refresh the run.');
  }
  const target = runIdentity(run);
  const key = 'run:' + action.run_id + ':' + action.attempt;
  if (action.type === 'cancel') {
    if (!isCancellableRun(run.status) || run.conclusion) targetError('The workflow run is no longer eligible for cancellation.');
    return { target, key, path: path + '/cancel', body: {}, expectedStatus: 202 };
  }
  if (run.status !== 'completed' ||
      (action.type !== 'rerun_job' && !isFailedConclusion(run.conclusion)) ||
      Date.now() - Date.parse(run.created_at) > 30 * 86400000 || !Number.isFinite(Date.parse(run.created_at))) {
    targetError('The workflow run is outside the rerun eligibility window.');
  }
  if (action.type === 'rerun_job') {
    const job = await readGitHub(send, '/actions/jobs/' + action.job_id);
    if (job?.id !== action.job_id || job.run_id !== action.run_id || job.head_sha !== action.expected_revision ||
        (job.run_attempt !== undefined && job.run_attempt !== action.attempt) ||
        job.status !== 'completed' || !isFailedConclusion(job.conclusion)) {
      targetError('The failed job is stale or does not belong to the confirmed workflow attempt.');
    }
    if (job.run_attempt === undefined) {
      // The attempt-qualified endpoint proves membership when the separate job
      // response omits its redundant attempt number.
      const list = await readGitHub(send,path+'/attempts/'+action.attempt+'/jobs?per_page=100');
      if (!Array.isArray(list?.jobs) || list.total_count !== list.jobs.length || !list.jobs.some(candidate =>
        candidate.id === job.id && candidate.run_id === action.run_id && candidate.head_sha === action.expected_revision &&
        (candidate.run_attempt === undefined || candidate.run_attempt === action.attempt) &&
        candidate.status === job.status && candidate.conclusion === job.conclusion)) {
        targetError('GitHub did not confirm the failed job in the selected workflow attempt.');
      }
    }
    target.job_id = job.id;
    target.job_name = typeof job.name === 'string' ? job.name.slice(0, 240) : null;
    // A rerun is addressed by GitHub job ID. Check that it is still the latest attempt after the job read.
    const current = await readGitHub(send, path);
    if (!isPinnedRun(current, action.run_id) || current.run_attempt !== action.attempt ||
        current.head_sha !== action.expected_revision || current.workflow_id !== action.workflow_id ||
        current.status !== 'completed' || current.conclusion !== run.conclusion) targetError('The workflow attempt changed during confirmation.');
    return { target, key, path: '/actions/jobs/' + action.job_id + '/rerun', body: { enable_debug_logging: false }, expectedStatus: 201 };
  }
  return { target, key, path: path + (action.type === 'rerun_run' ? '/rerun' : '/rerun-failed-jobs'),
    body: { enable_debug_logging: false }, expectedStatus: 201 };
}

const receipt = row => ({
  operation_id: row.operation_id, created_at: row.created_at, updated_at: row.updated_at,
  type: JSON.parse(row.request).type,
  state: row.state === 'sending' && Date.now() - Date.parse(row.created_at) > 8000 ? 'unknown' : row.state,
  ...JSON.parse(row.response),
});

function operationRow(db, owner, id) {
  return db.prepare('SELECT * FROM ci_operations WHERE owner_id = ? AND operation_id = ?').bind(owner, id).first();
}

function updateOperation(db, row, state, response) {
  return db.prepare(`UPDATE ci_operations SET state = ?, response = ?, updated_at = ?
    WHERE owner_id = ? AND operation_id = ? AND updated_at = ? AND state = ?`)
    .bind(state, JSON.stringify(response), new Date().toISOString(), row.owner_id, row.operation_id, row.updated_at, row.state).run();
}

async function readback(send, body, action, accepted) {
  const { target } = body;
  let id = body.dispatched_run_id;
  if (action.type === 'dispatch' && !id) {
    const result = await readGitHub(send, '/actions/workflows/' + target.workflow_id +
      '/runs?event=workflow_dispatch&branch=' + DIAGNOSTIC.ref + '&per_page=10');
    const matches = (result.workflow_runs ?? []).filter(run => run.display_title === diagnosticRunName(action.operation_id));
    if (matches.length > 1) return { state: 'not_effective', message: 'GitHub showed multiple dispatch runs with the operation ID.' };
    if (matches.length !== 1 || !POSITIVE(matches[0].id)) return null;
    id = matches[0].id;
  }
  id ??= action.run_id;
  const rerun = action.type.startsWith('rerun_');
  const attempt = action.type === 'dispatch' ? 1 : rerun ? action.attempt + 1 : action.attempt;
  const run = await readGitHub(send, runPath(id) + '/attempts/' + attempt);
  if (!isPinnedRun(run, id) || run.workflow_id !== target.workflow_id ||
      run.run_attempt !== attempt ||
      (action.type === 'dispatch' && (run.event !== 'workflow_dispatch' ||
        run.head_branch !== DIAGNOSTIC.ref || run.display_title !== diagnosticRunName(action.operation_id)))) return null;
  const observed = runIdentity(run);
  if (run.head_sha !== target.revision) {
    return { state: 'not_effective', observed, message: 'GitHub recorded a different revision. The diagnostic requires the confirmed revision.' };
  }
  if (action.type === 'cancel' && (run.status !== 'completed' || run.conclusion !== 'cancelled')) {
    return run.status === 'completed'
      ? { state: 'not_effective', observed, message: 'GitHub recorded completion without cancellation.' }
      : null;
  }
  if (rerun && action.type === 'rerun_job') {
    const jobs = await readGitHub(send, runPath(id) + '/attempts/' + attempt + '/jobs?per_page=50', 1024 * 1024);
    const matches = (jobs.jobs ?? []).filter(job => job.run_id === id && job.run_attempt === attempt &&
      job.head_sha === target.revision && job.name === target.job_name && POSITIVE(job.id) && job.id !== target.job_id);
    if (matches.length !== 1) return null;
    observed.job_id = matches[0].id;
    observed.job_name = target.job_name;
  }
  if (!accepted && action.type !== 'dispatch') return {
    state: 'unknown', observed, message: 'GitHub shows the target effect. The response was lost, so this operation cannot be attributed.',
  };
  return { state: 'observed', observed, message: 'GitHub readback found the requested effect.' };
}

export async function ciStatus({ db, owner, id, fetcher, token }) {
  if (!id) {
    const rows = await db.prepare('SELECT * FROM ci_operations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20').bind(owner).all();
    return { status: 200, body: { operations: rows.results.map(receipt) } };
  }
  if (!operationId.test(id)) return badRequest();
  const row = await operationRow(db, owner, id);
  if (!row) return failure(404, 'CI operation not found');
  const current = receipt(row);
  const canObserve = ['accepted', 'unknown'].includes(current.state) ||
    (current.state === 'observed' && current.observed?.status !== 'completed');
  if (!canObserve || Date.now() - Date.parse(row.updated_at) < LOOKUP_INTERVAL_MS ||
      (current.observed && current.state === 'unknown')) return { status: 200, body: { operation: current } };
  const body = JSON.parse(row.response);
  const action = JSON.parse(row.request);
  // Claim a bounded readback slot across isolates. Never reissue a GitHub write.
  const claimed = await updateOperation(db, row, row.state, body);
  if (claimed.meta.changes === 1) {
    const latest = await operationRow(db, owner, id);
    // POST completion may have raced an expired sending receipt. Update only the version claimed above.
    if (latest.state === row.state) {
      let result;
      try { result = await readback(gitHub(fetcher, token), body, action, ['accepted', 'observed'].includes(row.state)); }
      catch { /* GitHub eventual consistency and read limits leave acceptance pending. */ }
      if (result) {
        const { state, ...details } = result;
        await updateOperation(db, latest, state, { ...body, ...details });
      }
    }
  }
  return { status: 200, body: { operation: receipt(await operationRow(db, owner, id)) } };
}

export async function submitCI({ db, owner, body, fetcher, token }) {
  const action = parseAction(body);
  if (!action) return badRequest();
  const serialized = JSON.stringify(action);
  const replay = async () => {
    const old = await operationRow(db, owner, action.operation_id);
    if (!old) return null;
    return old.request === serialized ? { status: 200, body: { operation: receipt(old) } }
      : failure(409, 'This operation ID is already bound to a different target.');
  };
  const previous = await replay();
  if (previous) return previous;
  const send = gitHub(fetcher, token);
  let plan;
  try { plan = await preflight(send, action); }
  catch (cause) {
    if (cause.target) return failure(409, cause.message);
    return failure(cause.status === 401 || cause.status === 403 ? 403 : 503,
      'GitHub authorization or target verification failed. No CI write was sent.');
  }
  const stamp = new Date().toISOString();
  const stored = { target: plan.target, message: 'GitHub write reserved. The result is pending.' };
  const inserted = await db.prepare(`INSERT OR IGNORE INTO ci_operations
    (owner_id, operation_id, target_key, request, created_at, updated_at, state, response)
    SELECT ?, ?, ?, ?, ?, ?, 'sending', ? WHERE
    (SELECT COUNT(*) FROM ci_operations WHERE owner_id = ?) < ?`)
    .bind(owner, action.operation_id, plan.key, serialized, stamp, stamp, JSON.stringify(stored), owner, MAX_OPERATIONS).run();
  if (inserted.meta.changes !== 1) return await replay() ??
    failure(409, 'This workflow attempt or diagnostic revision already has a recorded operation, or the audit limit was reached.');
  let state = 'unknown';
  try {
    const result = await send(plan.path, plan.body);
    stored.github_status = result.status;
    if (result.status === plan.expectedStatus) {
      state = 'accepted';
      if (action.type === 'dispatch') {
        const dispatch = JSON.parse(await readBounded(result.body, 8192));
        if (POSITIVE(dispatch?.workflow_run_id)) stored.dispatched_run_id = dispatch.workflow_run_id;
      } else await result.body?.cancel();
    } else {
      await result.body?.cancel();
      if (result.status >= 400 && result.status < 500 && result.status !== 408) state = 'rejected';
    }
  } catch { /* The operation may have reached GitHub. Never retry it. */ }
  stored.message = state === 'accepted' ? 'GitHub accepted the request. Check readback for the effect.'
    : state === 'rejected' ? 'GitHub rejected the request. Check Actions permission and current run eligibility.'
      : 'The GitHub response is unavailable. Check readback before considering further actions.';
  // A status poll never changes an active send. Persist the transport result even if a later poll
  // refreshed its timestamp after the send deadline elapsed.
  await db.prepare(`UPDATE ci_operations SET state = ?, response = ?, updated_at = ?
    WHERE owner_id = ? AND operation_id = ? AND state = 'sending'`)
    .bind(state, JSON.stringify(stored), new Date().toISOString(), owner, action.operation_id).run();
  return { status: 200, body: { operation: receipt(await operationRow(db, owner, action.operation_id)) } };
}
