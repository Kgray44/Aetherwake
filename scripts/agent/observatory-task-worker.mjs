import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, open, readdir, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { taskExecutionCapacity } from '../../agent-system/observatory/task-execution-capacity.mjs';
import { taskDigest, writeSnapshot } from './context.mjs';
import { createClaimTelemetryHooks, retainActiveClaim, reconcileAbandonedClaim } from './claim-telemetry.mjs';
import { observeCodexStream } from './provider-events.mjs';
import { openObservatoryConnector } from './observatory-connector.mjs';
import { readObservatoryConnection, recoverWorkerTelemetry } from './observatory-sync.mjs';

const runFile = promisify(execFile);
const verificationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const taskIdPattern = new RegExp('^task_' + verificationId.source.slice(1));
const attemptIdPattern = new RegExp('^attempt_' + verificationId.source.slice(1));
const repoUrl = /^(?:https:\/\/github\.com\/|git@github\.com:)Kgray44\/Aetherwake(?:\.git)?$/i;
const tool = 'aetherwake_engineering_observatory.task_engine_v1';
const reportSafetyMarginMs = 1_500;
const reportTimeoutMs = 5_000;

function storageReceipt(output) {
  try {
    const data = JSON.parse(output);
    const keys = ['cFreeBytes','dFreeBytes','estimatedCBytes','estimatedDBytes','floorBytesEach'];
    const measured = Date.parse(data.utc);
    const age = Date.now() - measured;
    if (typeof data.allowed !== 'boolean' || !Number.isFinite(age) || age < -2000 || age > 60_000 ||
        !keys.every(key => Number.isSafeInteger(data[key]) && data[key] >= 0) ||
        data.floorBytesEach < 32_212_254_720 ||
        data.allowed !== (data.cFreeBytes - data.estimatedCBytes > data.floorBytesEach &&
                         data.dFreeBytes - data.estimatedDBytes > data.floorBytesEach)) return null;
    return Object.fromEntries(keys.map(key => [key,data[key]]));
  } catch {
    return null;
  }
}

export async function checkWorkerStorage(command, cwd, run = runFile) {
  const hasReserveReceipt = command.some(arg => /(?:^|[\\/])ReserveGuard\.ps1$/i.test(arg));
  try {
    const output = await run(command[0], command.slice(1), { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 8192 });
    if (hasReserveReceipt && (!storageReceipt(output?.stdout) || JSON.parse(output.stdout).allowed !== true)) {
      throw Error('Storage receipt missing, stale or inconsistent');
    }
  } catch (error) {
    const reason = error.killed ? 'storage_guard_timeout' : error.code === 2 ? 'storage_reserve_denied' : 'storage_guard_unavailable';
    throw Object.assign(Error('The worker storage guard did not confirm safe writes.'), {
      code:reason, reserve:hasReserveReceipt ? storageReceipt(error.stdout) : null,
    });
  }
}

function git(cwd, ...args) {
  return runFile('git', ['--no-optional-locks', '-C', cwd, ...args], {
    windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
  }).then(({ stdout }) => stdout.trim());
}

async function checkoutLocation(read, fastReadback) {
  if (fastReadback) {
    const lines = (await read('rev-parse', '--show-toplevel', 'HEAD', '--absolute-git-dir')).split(/\r?\n/);
    if (lines.length===3 && isAbsolute(lines[0]) && /^[a-f0-9]{40}$/.test(lines[1]) && isAbsolute(lines[2])) {
      return lines;
    }
  }
  return Promise.all(['--show-toplevel','HEAD','--absolute-git-dir'].map(arg=>read('rev-parse',arg)));
}

export async function checkoutIdentity(path, base, { fastReadback = process.env.AADS_GIT_FAST_READBACK==='1', readGit = git } = {}) {
  const read = (...args) => readGit(path,...args);
  const [[root, revision, gitDir], origin, branch, dirty] = await Promise.all([
    checkoutLocation(read,fastReadback), read('remote', 'get-url', 'origin'),
    read('symbolic-ref', '--short', 'HEAD'), read('status', '--porcelain', '--untracked-files=normal'),
  ]);
  if (await realpath(root) !== path || !repoUrl.test(origin) || !branch.startsWith('codex/aads-task-') ||
      relative(path, await realpath(gitDir)) !== '.git') {
    throw Error('Executor requires a dedicated Aetherwake checkout and task branch');
  }
  await read('merge-base', '--is-ancestor', base, revision);
  return { branch, revision, dirty: Boolean(dirty) };
}

const provisionRevision = /^[a-f0-9]{40}$/;
const provisionOrigin = 'https://github.com/Kgray44/Aetherwake.git';

// Git can report raw paths, credentials and remote output even on a local fetch.
// Classify that output here and retain only approved descriptions.
function checkoutFailure(operation, error) {
  if (error?.checkoutFailure) return error;
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  let category = 'operation_failed';
  if (error?.checkoutCategory) category = error.checkoutCategory;
  else if (error?.killed) category = 'timeout';
  else if (/lazy fetching disabled|from promisor remote/i.test(stderr)) category = 'incomplete_cache';
  else if (/authentication failed|terminal prompts disabled|permission denied \(publickey\)|returned error: (401|403)\b/i.test(stderr)) category = 'authentication';
  else if (/not our ref|couldn't find remote ref|no such ref/i.test(stderr)) category = 'revision_unavailable';
  else if (/could not resolve host|couldn't connect|connection (?:reset|timed out)|unexpected disconnect|returned error: (429|500|502|503|504)\b/i.test(stderr)) category = 'temporary_transport';
  else if (/\.lock['"]?: File exists|another git process/i.test(stderr)) category = 'git_lock_contention';
  else if (['EPERM','EACCES','EBUSY'].includes(error?.code)) category = 'filesystem_access';
  else if (error?.code === 'ENOSPC' || /no space left on device/i.test(stderr)) category = 'storage_exhausted';
  const retryable = ['temporary_transport','timeout','git_lock_contention'].includes(category);
  const exitCode = Number.isInteger(error?.code) ? error.code : undefined;
  const failure = Error('Checkout ' + operation + ' failed (' + category +
    (exitCode === undefined ? '' : ', exit ' + exitCode) + ').');
  return Object.assign(failure, { checkoutFailure:true, operation, category, retryable, exitCode });
}

async function existingPrivateDirectory(path) {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function workerTelemetryDirectory(root, taskId, workspace) {
  const current = join(root,'.aads-observatory',taskId);
  const legacy = join(workspace??join(root,taskId),'.git','agent-harness');
  return !await existingPrivateDirectory(current) && await existingPrivateDirectory(legacy) ? legacy : current;
}

function gitProvisioningIdentity(settings) {
  const { name, email } = settings ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\r\n\0]/.test(name) ||
      typeof email !== 'string' || email.length > 160 || !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) {
    throw Error('Automatic checkout provisioning requires a Git author name and email');
  }
  return { name, email };
}

// Only worker-approved claims can reach this provisioner. The Task controls the
// pinned revision; the worker owns the origin and every filesystem destination.
export async function provisionTaskWorkspace({ root, task, attempt, author, signal,
  cloneOrigin = provisionOrigin, gitCache, observe = (_name, action) => action() }) {
  if (!taskIdPattern.test(task?.id ?? '') || task.repository !== 'Kgray44/Aetherwake' ||
      !provisionRevision.test(attempt?.revision ?? '')) throw Error('Invalid Task checkout identity');
  const { name, email } = gitProvisioningIdentity(author);
  const parent = await realpath(root);
  const destination = join(parent, task.id);
  const branch = 'codex/aads-task-' + task.id.slice(5);
  const checkExisting = async () => {
    const existing = await lstat(destination).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!existing) return false;
    try {
      if (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(destination) !== destination) {
        throw Error('Task checkout is not an isolated directory');
      }
      const identity = await checkoutIdentity(destination, attempt.revision);
      if (identity.branch !== branch || identity.revision !== attempt.revision ||
          (identity.dirty && (!attempt.resume_session_id || attempt.resume_requires_clean))) {
        throw Error('Existing Task checkout requires reconciliation');
      }
    } catch (error) {
      throw checkoutFailure('validate retained checkout', {code:error.code, checkoutCategory:'reconciliation_required'});
    }
    return true;
  };
  signal?.throwIfAborted();
  if (await checkExisting()) return destination;
  if (attempt.resume_session_id) {
    throw checkoutFailure('resume existing checkout', {checkoutCategory:'original_checkout_missing'});
  }

  const label = attemptIdPattern.test(attempt.id ?? '') ? attempt.id.slice(8,16) : task.id.slice(5,13);
  const staging = await mkdtemp(join(parent, '.aads-provision-' + label + '-'))
    .catch(error => { throw checkoutFailure('allocate staging directory',error); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT:'0' };
  delete env.AADS_TASK_WORKER_KEY;
  const run = async (operation, ...args) => {
    try {
      return await runFile('git', args, {
        cwd:staging, env, signal, windowsHide:true, timeout:180_000, maxBuffer:64 * 1024,
      });
    } catch (error) {
      signal?.throwIfAborted();
      throw checkoutFailure(operation, error);
    }
  };
  try {
    await run('initialize repository', '-c', 'core.longpaths=true', 'init', '--quiet');
    if (process.platform==='win32') await run('configure long paths', 'config','--local','core.longpaths','true');
    await observe('checkout_fetch',async () => {
      const fetchPinned = (source, origin) => run(source, 'fetch','--quiet','--depth=1','--no-tags',origin,attempt.revision);
      // A promisor clone may contain the commit but lack trees or blobs. Its
      // upload-pack deliberately cannot fetch those objects on our behalf.
      const completeCache = gitCache && await git(gitCache,'config','--get-regexp','^remote\\..*\\.promisor$')
        .then(() => false, error => error.code === 1);
      const available = completeCache && await git(gitCache,'cat-file','-t',attempt.revision).catch(() => null);
      if (available === 'commit') {
        try {
          await fetchPinned('fetch from cache', pathToFileURL(gitCache).href);
          return;
        } catch (error) {
          signal?.throwIfAborted();
          if (error.category === 'storage_exhausted' || error.category === 'filesystem_access') throw error;
        }
      }
      for (let attemptNumber=1; ; attemptNumber++) {
        try {
          await fetchPinned('fetch from configured origin', cloneOrigin);
          return;
        } catch (error) {
          error.tries = attemptNumber;
          if (!error.retryable || attemptNumber >= 3) throw error;
          await sleep(500 * 2 ** (attemptNumber - 1), undefined, { signal });
        }
      }
    });
    const pinned = await run('verify pinned commit', 'cat-file', '-t', attempt.revision);
    if (pinned.stdout.trim() !== 'commit') {
      throw checkoutFailure('verify pinned commit', {checkoutCategory:'revision_unavailable'});
    }
    await run('set repository origin', 'remote', 'add', 'origin', provisionOrigin);
    await run('set Git author name', 'config', '--local', 'user.name', name);
    await run('set Git author email', 'config', '--local', 'user.email', email);
    await observe('checkout_materialization',() => run('materialize pinned branch', '-c',
      'core.hooksPath=' + join(staging, '.git', 'aads-disabled-hooks'), 'switch', '--quiet', '-c', branch, attempt.revision));
    const candidate = await checkoutIdentity(staging, attempt.revision)
      .catch(error=>{ throw checkoutFailure('verify materialized checkout',error); });
    if (candidate.branch !== branch || candidate.revision !== attempt.revision || candidate.dirty) {
      throw checkoutFailure('verify materialized checkout', {checkoutCategory:'identity_mismatch'});
    }
    signal?.throwIfAborted();
    for (let retry = 0; ; retry++) {
      try {
        await rename(staging, destination);
        break;
      } catch (error) {
        if (await checkExisting()) break;
        if (retry === 6 || !['EBUSY','EPERM','EACCES','EEXIST','ENOTEMPTY'].includes(error.code)) {
          throw checkoutFailure('publish staged checkout',error);
        }
        await sleep(250, undefined, { signal });
      }
    }
    return destination;
  } finally {
    try {
      const leftover = await realpath(staging).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (leftover === staging && dirname(leftover) === parent) {
        await rm(staging, { recursive:true, force:true, maxRetries:6, retryDelay:250 });
      }
    } catch {
      console.error('The worker retained an incomplete provisioning directory for inspection.');
    }
  }
}

async function checkpointCandidate(workspace, { branch, revision }, task, attempt) {
  const noHooks = 'core.hooksPath=' + join(workspace, '.git', 'aads-disabled-hooks-' + randomUUID());
  const writeGit = (...args) => git(workspace, '-c', noHooks, '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgsign=false', ...args);
  await writeGit('add', '-A', '--', '.');
  const tree = await writeGit('write-tree');
  const candidate = await writeGit('commit-tree', tree, '-p', revision, '-m',
    'Checkpoint AADS Task ' + task.id + ' attempt ' + attempt.id);
  await writeGit('update-ref', 'refs/heads/' + branch, candidate, revision);
}

function termination(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const program = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    return runFile(program, ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 5000 }).catch(() => {});
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function prepareObjectiveSource(workspace, task, attempt) {
  if (task.objective.length <= 6000) return;
  if (!attemptIdPattern.test(attempt.id ?? '')) throw Error('Invalid objective source identity');
  const path = '.git/aads-objective-' + attempt.id + '.json';
  const document = { task_id:task.id, attempt_id:attempt.id, revision:attempt.revision,
    spec_version:attempt.spec_version, task_digest:taskDigest(task), objective:task.objective };
  const absolute = join(workspace,path);
  try {
    await writeSnapshot(absolute, document);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const entry = await lstat(absolute);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1024 * 1024 ||
        await readFile(absolute,'utf8') !== JSON.stringify(document,null,2)+'\n') {
      throw Error('Existing objective source does not match this claim');
    }
  }
  return path;
}

export function codexTaskPrompt(task, attempt, { objectiveSource, executionNotes = [] } = {}) {
  const references = [...new Set((task.requirements??[]).map(({kind,uri,revision})=>
    '- '+kind+' '+uri+(revision?' @ '+revision:'')))];
  const deliverables = [...new Set(task.deliverables??[])];
  return [
    'Carry out the approved Aetherwake engineering Task in this dedicated checkout only.',
    'Follow repository governance and the current sandbox. Make scoped changes and run relevant tests.',
    'Use targeted repository searches and governance sections. Keep command output focused and reuse facts already read unless the source changed or needs independent verification.',
    'Leave changes in the checkout. The Task worker will create the local candidate commit.',
    'External actions, publication, acceptance and changes to execution authorization require explicit separate approval.',
    'Only when useful, share a standalone progress message: Development note [finding|warning|follow_up|decision]: <one short sentence>. Pick one category. No secrets, paths, URLs or raw outputs.',
    'Task: ' + task.id + ' (' + attempt.id + ')',
    task.title,
    objectiveSource
      ? 'Read the complete objective field from the claim-scoped JSON file '+objectiveSource+
        ' before acting. If output is bounded, read it in consecutive chunks through the end. Retain all mandatory requirements and refer back to the same source when needed.'
      : task.objective,
    ...executionNotes,
    ...(references.length ? ['Task requirements and input references:', ...references,
      'Consult these references through permitted tools and existing access. A reference does not grant access.'] : []),
    ...(deliverables.length ? ['Planned deliverables:', ...deliverables.map(item=>'- '+item)] : []),
    'Acceptance criteria:',
    ...task.acceptance.criteria.map(item => item.id + ' ' + item.description),
  ].join('\n');
}

export async function executeCodex({ executable, cwd, task, attempt, onSession, onUsage, onDevelopmentNote, onTurnStarted, onTurnFinished, signal, objectiveSource, executionNotes }) {
  const prompt = codexTaskPrompt(task,attempt,{objectiveSource,executionNotes});
  const env = { ...process.env };
  delete env.AADS_TASK_WORKER_KEY;
  const args = [
    '--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--sandbox', 'workspace-write', '--cd', cwd, '--json',
    ...(attempt.resume_session_id ? ['resume', attempt.resume_session_id] : []), '-',
  ];
  if (signal.aborted) return { ok: false, stopped: true };
  const child = spawn(executable, args, {
    cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'],
  });
  const exited = new Promise(resolveExit => {
    child.once('error', () => resolveExit({ ok: false, stopped: false }));
    child.once('close', code => resolveExit({ ok: code === 0, stopped: signal.aborted }));
  });
  const abort = () => { void termination(child); };
  signal.addEventListener('abort', abort, { once: true });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let session;
  const observed = observeCodexStream(child.stdout, {
    onSession(id) {
      session = id;
      return onSession(id);
    },
    onUsage,onDevelopmentNote,onTurnStarted,onTurnFinished,
  });
  try {
    const [result, measurements] = await Promise.all([exited, observed]);
    const completed = measurements.find(item => item.name === 'provider_turn_completed_event_count');
    return { ...result, measurements, ok: result.ok && Boolean(session) && completed?.value > 0 };
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function executeAppServer(connector, {cwd,task,attempt,onSession,onUsage,onDevelopmentNote,onTurnStarted,onTurnFinished,
  onAddendumCheckpoint,signal,objectiveSource,executionNotes}) {
  async function recordUsage(usage,method,scope) {
    if (!usage||!onUsage) return;
    const fields={total:'totalTokens',input:'inputTokens',cached_input:'cachedInputTokens',
      cache_write_input:'cacheWriteInputTokens',output:'outputTokens',reasoning_output:'reasoningOutputTokens'};
    const metrics=Object.entries(fields).flatMap(([name,key])=>{
      const value=usage[key];
      return Number.isSafeInteger(value)&&value>=0 ? [{
        name:'provider_'+name+'_tokens',unit:'tokens',value,availability:'observed',
        source:'codex_app_server_token_usage_updated',method,
      }] : [];
    });
    if (metrics.length) await onUsage(metrics,scope);
  }
  let result=await connector.runWorkspaceTurn({cwd,prompt:codexTaskPrompt(task,attempt,{objectiveSource,executionNotes}),
    resumeSessionId:attempt.resume_session_id,signal,onSession,onDevelopmentNote,onTurnStarted,onTurnFinished,
    onUsageSnapshot:onUsage&&((usage,scope)=>recordUsage(usage,'fresh_thread_progress',scope))});
  async function publishProfile(turn, ordinal) {
    if (onUsage && turn.profile?.length) {
      const turnOrdinal = {
        name:'app_server_workspace_turn_ordinal',unit:'count',value:ordinal,availability:'observed',
        source:'codex_app_server_turn_profile',method:'observed_turn_notifications',
      };
      try { await onUsage([...turn.profile,turnOrdinal],{sessionId:turn.sessionId}); }
      catch { console.error('App Server turn profile could not be recorded.'); }
    }
  }
  await publishProfile(result,1);
  if (result.status==='completed' && attempt.live_addenda && !signal.aborted) {
    const checkpoint = await onAddendumCheckpoint();
    if (checkpoint?.addenda.length) {
      try { await recordUsage(result.usage,'fresh_thread_progress',{sessionId:result.sessionId}); }
      catch { console.error('App Server token telemetry could not be recorded.'); }
      const instructions = checkpoint.addenda.map(({ id, text }) => ({ id, text }));
      result = await connector.runWorkspaceTurn({
        cwd, resumeSessionId: result.sessionId, signal, onSession, onDevelopmentNote, onTurnStarted, onTurnFinished,
        captureFreshThreadUsage: !attempt.resume_session_id,
        onUsageSnapshot:onUsage&&((usage,scope)=>recordUsage(usage,'fresh_thread_progress',scope)),
        prompt: [
          'Apply the authenticated owner addenda below within the already approved Task scope.',
          'The original execution authorization, workspace, Git base and claimed acceptance criteria still govern.',
          'Changes to external actions, publication, acceptance or tool authorization require separate approval.',
          JSON.stringify({ task_id: task.id, attempt_id: attempt.id, spec_version: attempt.spec_version, instructions }),
        ].join('\n'),
        onTurnAccepted: checkpoint.delivered,
      });
      if (result.status === 'completed') await checkpoint.acknowledged();
      await publishProfile(result,2);
    }
  }
  if (result.status==='completed') {
    try { await recordUsage(result.usage,'fresh_thread_total',{sessionId:result.sessionId}); }
    catch { console.error('App Server token telemetry could not be recorded.'); }
  }
  return {ok:result.status==='completed',stopped:signal.aborted,providerStatus:result.status};
}

export async function runClaim({ claim, send, workspace, executable, signal, admitStorage,
  identify = checkoutIdentity, execute = executeCodex, onTelemetryStart, onUsage, onTelemetryEnd, onTelemetryStage, onTelemetryStageStart,
  telemetryDirectory, onDevelopmentNote,
  verificationNamespace, prepareWorkspace, managedConnection, providerStream, interval = 12_000,
  requestTimeoutMs = reportTimeoutMs }) {
  const { task, attempt, lease } = claim;
  const controller = new AbortController();
  const workerSignal = AbortSignal.any([controller.signal, signal, AbortSignal.timeout(Math.max(1, attempt.deadline - Date.now()))]);
  const heartbeats = new AbortController();
  let sessionId;
  let executionIdentity;
  let identity;
  let desired;
  let stopReason;
  let terminalConfirmed = false;
  const wallOrigin = Date.now();
  const monotonicOrigin = performance.now();
  const elapsedSinceOrigin = () => performance.now() - monotonicOrigin;
  let leaseExhausted = false;
  let leaseUntil = attempt.lease_until ?? attempt.deadline;
  const timeUntilLeaseExpiry = () => leaseUntil - wallOrigin - elapsedSinceOrigin();
  const leaseExpired = () => Object.assign(Error('The Task lease expired before the worker could confirm its report.'), {code:'report_lease_expired'});
  const sendBeforeLeaseExpiry = async request => {
    const remaining = timeUntilLeaseExpiry();
    if (leaseExhausted || remaining <= 0) throw leaseExpired();
    const reportController = new AbortController();
    const exhaustsLease = remaining <= requestTimeoutMs;
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (exhaustsLease) leaseExhausted = true;
        const error = exhaustsLease ? leaseExpired() :
          Object.assign(Error('The Task Engine report did not respond within its request budget.'), {code:'report_timeout'});
        reportController.abort(error);
        reject(error);
      }, Math.min(remaining,requestTimeoutMs));
    });
    try { return await Promise.race([send(request, {signal:reportController.signal}), expired]); }
    finally { clearTimeout(timer); }
  };
  let reports = Promise.resolve();
  const report = async (type, fields = {}, operationId = randomUUID()) => {
    let request;
    let backoff = 250;
    let retries = 0;
    for (;;) {
      const pending = reports.then(async () => {
        if (type==='heartbeat'&&terminalConfirmed) return null;
        request ??= { op: 'report', task_id: task.id, attempt_id: attempt.id, lease,
          operation_id: operationId, report: { type, ...fields,
            ...(sessionId ? { session_id: sessionId } : {}), ...(executionIdentity ? { execution_identity:executionIdentity } : {}),
            ...(identity ? { branch: identity.branch } : {}) } };
        const result = await sendBeforeLeaseExpiry(request);
        if (type==='heartbeat') {
          const expiry = result.attempts?.find(item=>item.id===attempt.id)?.lease_until;
          if (Number.isFinite(expiry)) leaseUntil = Math.min(Math.max(leaseUntil,expiry),attempt.deadline);
        }
        if (['finished', 'failed', 'stopped'].includes(type)) { terminalConfirmed=true; heartbeats.abort(); }
        if (retries && type==='heartbeat') {
          console.info(new Date().toISOString(),attempt.id,'Lease renewal recovered after',retries,'retry attempt(s).');
        }
        return result;
      });
      reports = pending.catch(()=>{});
      try { return await pending; }
      catch (error) {
        const retryable = !error.status || error.status === 429 || error.status >= 500 || error.code === 'task_version_conflict';
        const retryBudget = timeUntilLeaseExpiry() - reportSafetyMarginMs;
        if (!retryable || error.code==='report_lease_expired' || retryBudget <= 0) throw error;
        // Retry the same immutable operation without blocking a renewal during backoff.
        await sleep(Math.min(backoff,retryBudget));
        if (timeUntilLeaseExpiry() <= reportSafetyMarginMs) throw error;
        retries++;
        backoff = Math.min(backoff * 2,2_000);
      }
    }
  };
  const confirmControl = async () => {
    if (terminalConfirmed) return;
    const result = await report('heartbeat');
    if (!result) return;
    const state = result.lifecycle.state;
    if (state === 'pausing' || state === 'cancelling') {
      desired = state;
      controller.abort();
    }
  };
  const stop = reason => {
    stopReason ??= reason;
    controller.abort();
  };
  let monitoring;
  let storageMonitoring;
  let lock;
  let retainedClaim;
  let outcome;
  let executionEnd;
  let provisioning = false;
  let provisioningStarted;
  let telemetryStarted = false;
  let liveStages = false;
  let executionState = 'failed';
  let turnStarted;
  const noteItems = new Set();
  const stages = [];
  async function measureStage(name, phase, action) {
    const startAt = new Date().toISOString(), started = performance.now();
    if (liveStages) await telemetry(onTelemetryStageStart,{name,phase,startAt});
    let state = 'failed';
    try {
      const result = await action();
      state = 'completed';
      return result;
    } finally {
      const stage = {name,phase,startAt,endAt:new Date().toISOString(),durationMs:performance.now()-started,state};
      if (liveStages) await telemetry(onTelemetryStage,stage);
      else stages.push(stage);
    }
  }
  const telemetry = async (callback, payload) => {
    try { await callback?.({ task, attempt, verificationNamespace, providerStream, ...payload }); }
    catch { console.error('Task execution telemetry could not be recorded.'); }
  };
  const guardStorage = async () => {
    try { await admitStorage(); }
    catch (error) {
      const reserve = error.reserve;
      const measurements = reserve ?
        ' C: '+reserve.cFreeBytes+' bytes free, D: '+reserve.dFreeBytes+' bytes free; floor '+reserve.floorBytesEach+' bytes each.' : '';
      stop(({
        storage_guard_timeout: 'The worker storage guard timed out before execution.',
        storage_reserve_denied: 'The storage reserve policy denied the worker write budget.',
        storage_guard_unavailable: 'The worker could not read storage reserve data before execution.',
      }[error.code] ?? 'The worker storage check failed before execution.') + measurements);
      throw error;
    }
  };
  try {
    monitoring = (async () => {
      while (!heartbeats.signal.aborted) {
        try { await confirmControl(); }
        catch (error) {
          stop(error.code==='lease_rejected'
            ? 'The Task Engine rejected this worker lease.'
            : error.code==='report_lease_expired'
              ? 'The lease expired before the Task Engine confirmed renewal.'
              : error.code==='report_timeout' || error.code==='connector_tool_timeout'
                ? 'The Task Engine did not answer lease renewal within the retry window.'
                : error.code==='connector_disconnected'
                  ? 'The Task Engine connector disconnected during lease renewal.'
                  : 'The worker could not confirm lease renewal with the Task Engine.');
          return;
        }
        try { await sleep(interval, undefined, {signal:heartbeats.signal}); }
        catch { return; }
      }
    })();
    if (telemetryDirectory && !onTelemetryStart && !onUsage && !onTelemetryEnd) {
      await guardStorage();
      retainedClaim=await retainActiveClaim(telemetryDirectory,{task,attempt});
      ({ onTelemetryStart, onUsage, onTelemetryEnd, onTelemetryStage, onTelemetryStageStart, onDevelopmentNote } =
        createClaimTelemetryHooks(telemetryDirectory, {managedConnection}, telemetryDirectory));
      telemetryStarted = liveStages = true;
    }
    await measureStage('worker_initialization','queue',async () => {
      if (!liveStages) await guardStorage();
      if (workspace) await checkWorkspaceTelemetryScope(workspace, verificationNamespace ?? undefined);
    });
    storageMonitoring = (async () => {
      const checkSignal = AbortSignal.any([heartbeats.signal,workerSignal]);
      while (!checkSignal.aborted) {
        try { await sleep(240_000,undefined,{signal:checkSignal}); }
        catch { return; }
        try { await admitStorage(); }
        catch { stop('The worker stopped because the storage check could not confirm a safe write.'); return; }
      }
    })();
    if (prepareWorkspace) {
      provisioning = true;
      provisioningStarted = performance.now();
      workspace = await measureStage('checkout_provisioning','context',
        () => prepareWorkspace({ task, attempt, signal:workerSignal,
          observe:(name,action) => measureStage(name,'context',action) }));
      provisioning = false;
    }
    workerSignal.throwIfAborted();
    await measureStage('checkout_validation','context',async () => {
      identity = await identify(workspace, attempt.revision);
      try { lock = await open(join(workspace, '.git', 'aads-task-worker.lock'), 'wx'); }
      catch (error) {
        if (error.code === 'EEXIST') stop('The checkout is still locked. Confirm the previous executor has stopped and reconcile its files before retrying.');
        throw error;
      }
      if (identity.revision !== attempt.revision || ((!attempt.resume_session_id||attempt.resume_requires_clean)&&identity.dirty)) {
        throw Error('Workspace must match the attempt revision and cleanliness policy');
      }
      await checkWorkspaceTelemetryScope(workspace, verificationNamespace ?? undefined);
      await retainedClaim?.update({workspace,branch:identity.branch});
    });
    if (!onTelemetryStart && !onUsage && !onTelemetryEnd) {
      ({ onTelemetryStart, onUsage, onTelemetryEnd, onTelemetryStage, onDevelopmentNote } = createClaimTelemetryHooks(workspace,
        managedConnection ? { managedConnection } : undefined));
    }
    telemetryStarted = true;
    await telemetry(onTelemetryStart, { verificationNamespace, ...(providerStream ? {providerStream} : {}) });
    const objectiveSource = await prepareObjectiveSource(workspace,task,attempt);
    workerSignal.throwIfAborted();
    outcome = await execute({ executable, cwd: workspace, task, attempt, objectiveSource,
      executionNotes:claim.execution_notes,
      onSession: async (value,observedIdentity) => {
        if (attempt.resume_session_id&&value!==attempt.resume_session_id) {
          controller.abort();
          throw Error('The provider returned a different conversation');
        }
        sessionId=value;
        executionIdentity=observedIdentity;
        await retainedClaim?.update({sessionId});
        try { await confirmControl(); }
        catch (error) {
          stop('The Task Engine could not bind the Codex session to the active attempt.');
          throw error;
        }
      },
      onUsage: onUsage && ((measurements,scope) => onUsage({ task, attempt, measurements,...scope })),
      onDevelopmentNote:async (itemId,note,occurredAt=new Date().toISOString())=>{
        if (!sessionId||noteItems.has(itemId)) return;
        noteItems.add(itemId);
        await telemetry(onDevelopmentNote,{itemId,note,occurredAt,sessionId});
      },
      onTurnStarted:async(turnId)=>{
        if (turnStarted) return;
        if (turnId) await retainedClaim?.update({turnId});
        turnStarted={name:'codex_turn',phase:'implementation',startAt:new Date().toISOString(),monotonic:performance.now()};
        await telemetry(onTelemetryStageStart,turnStarted);
      },
      onTurnFinished:async(status)=>{
        if (!turnStarted) return;
        const state=status==='completed'?'completed':status==='failed'?'failed':'interrupted';
        await telemetry(onTelemetryStage,{...turnStarted,endAt:new Date().toISOString(),
          durationMs:performance.now()-turnStarted.monotonic,state});
        turnStarted=undefined;
      },
      onAddendumCheckpoint: async () => {
        await confirmControl();
        workerSignal.throwIfAborted();
        const { addenda } = await report('addenda_take');
        if (!addenda.length) return { addenda };
        const reservationId = addenda[0].reservation_id;
        if (addenda.some(item => item.task_id !== task.id || item.attempt_id !== attempt.id ||
            item.session_id !== sessionId || item.spec_version !== attempt.spec_version || item.reservation_id !== reservationId)) {
          throw Error('Addendum delivery identity does not match this attempt');
        }
        let turnId;
        return {
          addenda,
          delivered: async id => {
            await report('addenda_delivered', { reservation_id: reservationId, turn_id: id });
            turnId = id;
          },
          acknowledged: () => report('addenda_acknowledged', { reservation_id: reservationId, turn_id: turnId }),
        };
      },
      signal: workerSignal });
  } catch (error) {
    const checkout = provisioning && (error?.checkoutFailure ? error : checkoutFailure('prepare checkout',error));
    outcome = {ok:false, ...(checkout ? {checkout, checkoutDuration:Math.round(performance.now()-provisioningStarted)} : {})};
  } finally {
    if (telemetryStarted) executionEnd = {at:new Date().toISOString(),monotonic:performance.now()};
  }
  const terminal = async (type, fields) => {
    const operationId=randomUUID();
    if (type==='finished') {
      await retainedClaim?.update({candidateRevision:fields.revision,terminalOperationId:operationId});
    }
    const submit = () => report(type,fields,operationId);
    if (type === 'finished') await submit();
    else await measureStage('terminal_reporting','integration',submit);
  };
  try {
    if (!desired && outcome?.ok) {
      try { await confirmControl(); }
      catch { stop('The worker could not confirm Task state before candidate submission.'); }
    }
    if (desired && (outcome?.stopped || outcome?.ok || workerSignal.aborted)) {
      const checkpoint = desired === 'pausing' && identity ? await identify(workspace, attempt.revision).catch(() => null) : null;
      await terminal('stopped', checkpoint && checkpoint.branch === identity?.branch ? { revision: checkpoint.revision } : {});
      executionState = 'interrupted';
    } else if (outcome?.ok && !workerSignal.aborted) {
      let result;
      try {
        result = await measureStage('candidate_git_verification','verification',async () => {
          let candidate = await identify(workspace, attempt.revision);
          if (candidate.dirty && candidate.branch === identity.branch && candidate.revision === attempt.revision) {
            await admitStorage();
            await checkpointCandidate(workspace, candidate, task, attempt);
            candidate = await identify(workspace, attempt.revision);
          }
          return candidate;
        });
      } catch {
        result = undefined;
      }
      const lacksDeliverable=task.deliverables?.length>0&&result?.revision===attempt.revision;
      if (result && !result.dirty && result.branch === identity.branch && !lacksDeliverable) {
        await measureStage('candidate_submission','integration',() => terminal('finished', { result: 'candidate', revision: result.revision }));
        executionState = 'completed';
      } else {
        await terminal('failed', { failure: lacksDeliverable
          ? 'The executor completed without creating a revision for the declared deliverables.'
          : 'Candidate workspace did not yield a clean, pinned revision.' });
      }
    } else {
      if (workerSignal.aborted) executionState = 'interrupted';
      const failure = stopReason ?? (signal.aborted ? 'The worker shut down before a candidate was submitted.'
        : workerSignal.aborted ? 'The attempt reached its execution time limit.'
        : outcome?.checkout ? outcome.checkout.message +
          (outcome.checkout.tries ? ' Fetch attempts: '+outcome.checkout.tries+'.' : '') +
          (outcome.checkout.category === 'reconciliation_required' ? ' Retained files need reconciliation before retry.'
            : outcome.checkout.retryable ? ' Transient failure. Check the environment before retrying.'
            : ' Correct the reported operation before authorizing retry.')
        : outcome?.providerStatus==='disconnected' ? 'The Codex App Server disconnected before reporting a terminal turn.'
        : outcome?.providerStatus==='interrupted' ? 'Codex reported that the turn was interrupted.'
        : 'Executor or workspace failed before producing a candidate.');
      const checkout = outcome?.checkout;
      const diagnostic = checkout && !workerSignal.aborted ? {
        stage:checkout.operation.startsWith('fetch from ') ? 'checkout_fetch'
          : checkout.operation==='materialize pinned branch' ? 'checkout_materialization' : 'checkout_provisioning',
        operation:checkout.operation, category:checkout.category, retryable:checkout.retryable,
        duration_ms:Math.min(1_800_000,outcome.checkoutDuration),
        recovery_required:['reconciliation_required','original_checkout_missing','git_lock_contention'].includes(checkout.category),
        ...(checkout.exitCode>=0 && checkout.exitCode<=255 ? {exit_code:checkout.exitCode} : {}),
        ...(checkout.tries ? {fetch_attempts:checkout.tries} : {}),
      } : null;
      await terminal('failed', {failure, ...(diagnostic ? {checkout_diagnostic:diagnostic} : {})});
    }
  } finally {
    heartbeats.abort();
    if (!terminalConfirmed && stopReason) console.error(new Date().toISOString(),attempt.id,'Task interruption:',stopReason);
    await Promise.all([monitoring,storageMonitoring]);
    try {
      if (lock) await measureStage('checkout_lock_release','other',async () => {
        await lock.close();
        await unlink(join(workspace, '.git', 'aads-task-worker.lock'));
      });
      if (retainedClaim) {
        try {
          if (terminalConfirmed) await retainedClaim.clear();
          else await retainedClaim.update({settled:true});
        } catch { console.error('Task recovery marker update is pending.'); }
      }
    } finally {
      if (telemetryStarted) {
        for (const stage of stages) await telemetry(onTelemetryStage,stage);
        await telemetry(onTelemetryEnd, { measurements: outcome?.measurements ?? [], state: executionState, executionEnd });
      }
    }
  }
}

export async function checkWorkspaceTelemetryScope(workspace, verification) {
  const connection = await readObservatoryConnection(join(workspace, '.git', 'agent-harness', 'observatory-sync'));
  if (connection && connection.verification !== verification) {
    throw Error('Worker and checkout telemetry namespace must match');
  }
}

async function main(configPath) {
  if (!configPath) throw Error('Usage: node scripts/agent/observatory-task-worker.mjs <private-config.json>');
  const credential = process.env.AADS_TASK_WORKER_KEY;
  if (!credential || credential.length < 32) throw Error('AADS_TASK_WORKER_KEY is required');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const workerId = config.worker_id ?? randomUUID();
  if (!verificationId.test(workerId)) throw Error('Worker ID must be a UUID v4');
  if (config.executor_transport!==undefined && !['exec','app_server'].includes(config.executor_transport)) {
    throw Error('Invalid worker execution transport');
  }
  if (!isAbsolute(config.codex_bin) || !isAbsolute(config.workspace_root) || (!config.workspaces && !config.auto_provision) ||
      !Array.isArray(config.storage_check) || !config.storage_check.length || !config.storage_check.every(value => typeof value === 'string') ||
      !isAbsolute(config.storage_check[0])) throw Error('Worker configuration is incomplete');
  const verification = config.verification;
  if (verification !== undefined && (typeof verification !== 'string' || !verificationId.test(verification))) {
    throw Error('Worker verification must be a namespace UUID');
  }
  const root = await realpath(config.workspace_root);
  const author = config.auto_provision ? gitProvisioningIdentity(config.auto_provision) : null;
  let gitCache;
  if (config.provision_git_cache!==undefined) {
    if (!author||!isAbsolute(config.provision_git_cache)) throw Error('Invalid provisioning Git cache configuration');
    gitCache=await realpath(config.provision_git_cache);
    const withinWorker=relative(root,gitCache);
    if (!withinWorker||(!isAbsolute(withinWorker)&&!withinWorker.startsWith('..'))||
        !repoUrl.test(await git(gitCache,'remote','get-url','origin'))) throw Error('Provisioning cache must use the trusted Aetherwake repository outside worker checkouts');
  }
  const workspaces = new Map();
  for (const [id, path] of Object.entries(config.workspaces ?? {})) {
    if (!taskIdPattern.test(id) || !isAbsolute(path)) throw Error('Invalid Task workspace mapping');
    const workspace = await realpath(path);
    if (relative(root, dirname(workspace)) || [...workspaces.values()].includes(workspace)) {
      throw Error('Each Task workspace must be a distinct direct child of workspace_root');
    }
    await checkWorkspaceTelemetryScope(workspace, verification);
    workspaces.set(id, workspace);
  }
  if ((!author && !workspaces.size) || workspaces.size > 500) throw Error('Worker requires 1 to 500 Task workspace mappings');
  const scope = config.auto_provision?.task_ids ?? (author ? undefined : [...workspaces.keys()]);
  const appServer = config.executor_transport === 'app_server';
  if (scope !== undefined && (!Array.isArray(scope) || !scope.length || scope.length > 500 ||
      !scope.every(id => taskIdPattern.test(id)))) throw Error('Invalid automatic checkout Task scope');

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => controller.abort());
  const { signal } = controller;
  const active = new Set();
  // Serialize local guard processes so concurrent slots cannot contend on WMI.
  let storageCheck = Promise.resolve();
  const admitStorage = () => {
    const pending = storageCheck.then(() => checkWorkerStorage(config.storage_check, root));
    storageCheck = pending.catch(() => {});
    return pending;
  };
  function connection() {
    let connector;
    function use(operation) {
      const current = connector ??= openObservatoryConnector({cwd:root,tool,executable:config.codex_bin});
      return operation(current).catch(error => {
        if (error.code === 'connector_disconnected' && connector === current) {
          current.close();
          connector = undefined;
        }
        throw error;
      });
    }
    return {
      close: () => connector?.close(),
      ready: requestSignal => use(current=>current.ready(requestSignal)),
      call: (args,toolName,options) => use(current=>current.call(args,toolName,options)),
    };
  }
  const control = connection();
  const dispatch = connection();
  const delivery = connection();
  const observations = connection();
  const recovery = connection();
  const send = (request, options) => (request.op==='claim' ? dispatch : control)
    .call({ request, worker_key: credential, ...(verification ? { verification } : {}) }, tool, options);
  const managedConnection = { call:args => delivery.call(args,'aetherwake_engineering_observatory.sync_task_telemetry') };
  let nextPulse = 0;
  let lastWorkerState;
  let pulseRequest;
  function pulse(state) {
    if (pulseRequest || (state === lastWorkerState && Date.now() < nextPulse)) return;
    lastWorkerState = state;
    nextPulse = Date.now() + 15_000;
    pulseRequest = observations.call({
      request: { op:'worker_pulse', worker_id:workerId, worker_state:state,
        conversation_continuation:appServer, ...(scope ? { task_ids:scope } : {}) },
      worker_key:credential, ...(verification ? { verification } : {}),
    },tool).catch(() => { /* An unavailable observation must not block claims or leases. */ })
      .finally(() => { pulseRequest = undefined; });
  }
  let recoveryCursor = 0;
  let nextRecovery = 0;
  let recovering;
  async function recoverIdleTelemetry() {
    if (active.size || signal.aborted || Date.now()<nextRecovery) return;
    nextRecovery=Date.now()+60_000;
    const locations=[root,join(root,'.aads-observatory')];
    const entries=await Promise.all(locations.map(path=>readdir(path,{withFileTypes:true}).catch(error=>{
      if (error.code==='ENOENT') return [];
      throw error;
    })));
    const taskIds=[...new Set([...workspaces.keys(),...entries.flat().filter(entry=>entry.isDirectory()&&
      taskIdPattern.test(entry.name)).map(entry=>entry.name)])].filter(id=>!scope||scope.includes(id)).sort();
    for (let scanned=0;scanned<Math.min(taskIds.length,4)&&!signal.aborted;scanned++) {
      const taskId=taskIds[recoveryCursor++%taskIds.length];
      const telemetryDirectory=await workerTelemetryDirectory(root,taskId,workspaces.get(taskId));
      try {
        await reconcileAbandonedClaim({directory:telemetryDirectory,taskId,
          readTask:id=>recovery.call({request:{op:'get',task_id:id},...(verification?{verification}:{})})});
        if (await recoverWorkerTelemetry({taskId,telemetryDirectory,verification,connector:managedConnection})) break;
      } catch {
        console.error('A saved Task telemetry delivery is still pending.');
        break;
      }
    }
  }
  try {
    while (!signal.aborted) {
      if (active.size < taskExecutionCapacity) {
        try {
          await admitStorage();
          // Do not spend a new claim's lease on local App Server startup.
          await control.ready(signal);
          const request = { op:'claim', operation_id:randomUUID(), conversation_continuation:appServer,
            live_addenda:appServer, separate_execution_notes:true, ...(scope ? { task_ids:scope } : {}) };
          const result = await send(request).catch(error => {
            if (error.status && error.status < 500) throw error;
            return send(request);
          });
          if (result.claim && !signal.aborted) {
            const workspace = workspaces.get(result.claim.task.id);
            const taskId = result.claim.task.id;
            const telemetryDirectory = await workerTelemetryDirectory(root,taskId,workspace);
            const job = runClaim({ claim:result.claim, send, workspace, executable:config.codex_bin, signal,
              verificationNamespace:verification ?? null,managedConnection,telemetryDirectory,
              ...(config.executor_transport==='app_server' ? {
                  execute:async options=>{
                    // The persistent conversation belongs to this attempt process.
                    // Release its Desktop session when the turn exits.
                    const executor=openObservatoryConnector({cwd:options.cwd,executable:config.codex_bin});
                    try { return await executeAppServer(executor,options); }
                    finally { executor.close(); }
                  },providerStream:'codex_app_server',
              } : {}),
              ...(workspace ? {} : {prepareWorkspace:input => provisionTaskWorkspace({root, author, gitCache, ...input})}),
              admitStorage }).catch(() => {
                console.error('Attempt reporting failed. The Task lease will require reconciliation.');
              }).finally(() => active.delete(job));
            active.add(job);
            pulse(active.size === taskExecutionCapacity ? 'busy' : 'available');
            continue;
          }
          pulse(result.dispatch_state === 'busy' ? 'busy' : 'available');
          recovering ??= recoverIdleTelemetry().catch(() => {
            console.error('A saved Task telemetry delivery is still pending.');
          }).finally(() => { recovering = undefined; });
        } catch (error) {
          const detail = error.code?.startsWith?.('storage_') ? error.code :
            error.status === 409 ? 'claim_rejected' : 'task_connection_unavailable';
          if (detail !== lastWorkerState || Date.now() >= nextPulse) {
            console.error(new Date().toISOString() + ' Worker poll deferred (' + detail + ').');
          }
          pulse(detail);
          if (error.status === 403 || error.status === 404) throw Error('Hosted Task worker is not configured or authorized');
        }
      } else pulse('busy');
      await sleep(3000, undefined, { signal }).catch(() => {});
    }
  } finally {
    controller.abort();
    await Promise.all(active);
    recovery.close();
    observations.close();
    delivery.close();
    dispatch.close();
    control.close();
    await recovering;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
