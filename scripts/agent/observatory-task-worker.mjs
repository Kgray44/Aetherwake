import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { observeCodexStream } from './provider-events.mjs';
import { openObservatoryConnector } from './observatory-connector.mjs';
import { readObservatoryConnection } from './observatory-sync.mjs';

const runFile = promisify(execFile);
const verificationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const taskIdPattern = new RegExp('^task_' + verificationId.source.slice(1));
const repoUrl = /^(?:https:\/\/github\.com\/|git@github\.com:)Kgray44\/Aetherwake(?:\.git)?$/i;
const tool = 'aetherwake_engineering_observatory.task_engine_v1';

function git(cwd, ...args) {
  return runFile('git', ['--no-optional-locks', '-C', cwd, ...args], {
    windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
  }).then(({ stdout }) => stdout.trim());
}

export async function checkoutIdentity(path, base) {
  const [root, origin, revision, branch, gitDir, dirty] = await Promise.all([
    git(path, 'rev-parse', '--show-toplevel'), git(path, 'remote', 'get-url', 'origin'),
    git(path, 'rev-parse', 'HEAD'), git(path, 'symbolic-ref', '--short', 'HEAD'),
    git(path, 'rev-parse', '--absolute-git-dir'), git(path, 'status', '--porcelain', '--untracked-files=normal'),
  ]);
  if (await realpath(root) !== path || !repoUrl.test(origin) || !branch.startsWith('codex/aads-task-') ||
      relative(path, await realpath(gitDir)) !== '.git') {
    throw Error('Executor requires a dedicated Aetherwake checkout and task branch');
  }
  await git(path, 'merge-base', '--is-ancestor', base, revision);
  return { branch, revision, dirty: Boolean(dirty) };
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

export function buildTaskPrompt(task, attempt) {
  const retry = attempt.retry && {
    prior_attempt_id: attempt.retry.prior_attempt_id,
    prior_state: attempt.retry.prior_state,
    changed_assumption: attempt.retry.changed_assumption,
  };
  return [
    'Carry out the approved Aetherwake engineering Task in this dedicated checkout only.',
    'Follow repository governance and the current sandbox. Make scoped changes and run relevant tests.',
    'Leave changes in the checkout. The Task worker will create the local candidate commit.',
    'External actions, publication, acceptance and changes to execution authorization require explicit separate approval.',
    'Task: ' + task.id + ' (' + attempt.id + ')',
    task.title, task.objective, 'Acceptance criteria:',
    ...task.acceptance.criteria.map(item => item.id + ' ' + item.description),
    ...(retry ? [
      'Prior failed attempt (owner-approved retry context): ' + JSON.stringify(retry),
      'Check the changed assumption before repeating the prior approach. Keep the original scope and acceptance criteria.',
    ] : []),
  ].join('\n');
}

export async function executeCodex({ executable, cwd, task, attempt, onSession, onUsage, signal }) {
  const prompt = buildTaskPrompt(task, attempt);
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
    onUsage,
  });
  try {
    const [result, measurements] = await Promise.all([exited, observed]);
    const completed = measurements.find(item => item.name === 'provider_turn_completed_event_count');
    return { ...result, measurements, ok: result.ok && Boolean(session) && completed?.value > 0 };
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function runClaim({ claim, send, workspace, executable, signal, admitStorage,
  identify = checkoutIdentity, execute = executeCodex, onTelemetryStart, onUsage, onTelemetryEnd,
  verificationNamespace, interval = 12_000 }) {
  const { task, attempt, lease } = claim;
  const controller = new AbortController();
  const workerSignal = AbortSignal.any([controller.signal, signal, AbortSignal.timeout(Math.max(1, attempt.deadline - Date.now()))]);
  const heartbeats = new AbortController();
  let sessionId;
  let identity;
  let desired;
  let leaseLost = false;
  const report = async (type, fields = {}) => {
    const request = { op: 'report', task_id: task.id, attempt_id: attempt.id, lease,
      operation_id: randomUUID(), report: { type, ...fields,
        ...(sessionId ? { session_id: sessionId } : {}), ...(identity ? { branch: identity.branch } : {}) } };
    // Reconcile an ambiguous response by replaying the same operation, never the execution.
    try { return await send(request); }
    catch (error) {
      if (error.status && error.status < 500) throw error;
      return send(request);
    }
  };
  const confirmControl = async () => {
    const state = (await report('heartbeat')).lifecycle.state;
    if (state === 'pausing' || state === 'cancelling') {
      desired = state;
      controller.abort();
    }
  };
  const update = async () => {
    await admitStorage();
    await confirmControl();
  };
  let monitoring;
  let lock;
  let outcome;
  let telemetryStarted = false;
  let executionState = 'failed';
  const telemetry = async (callback, payload) => {
    try { await callback?.({ task, attempt, ...payload }); }
    catch { console.error('Task execution telemetry could not be recorded.'); }
  };
  try {
    await admitStorage();
    identity = await identify(workspace, attempt.revision);
    lock = await open(join(workspace, '.git', 'aads-task-worker.lock'), 'wx');
    if (identity.revision !== attempt.revision || (!attempt.resume_session_id && identity.dirty)) {
      throw Error('Workspace must match the attempt revision and cleanliness policy');
    }
    await update();
    monitoring = (async () => {
      while (!workerSignal.aborted && !heartbeats.signal.aborted) {
        try {
          await sleep(interval, undefined, { signal: AbortSignal.any([heartbeats.signal, workerSignal]) });
        } catch { return; }
        try { await update(); }
        catch { leaseLost = true; controller.abort(); }
      }
    })();
    telemetryStarted = true;
    await telemetry(onTelemetryStart, { verificationNamespace });
    outcome = await execute({ executable, cwd: workspace, task, attempt,
      onSession: value => { sessionId = value; },
      onUsage: onUsage && (measurements => onUsage({ task, attempt, measurements })),
      signal: workerSignal });
  } catch {
    outcome = { ok: false };
  } finally {
    heartbeats.abort();
    await monitoring;
  }
  try {
    if (leaseLost) {
      executionState = 'interrupted';
      return;
    }
    if (!desired && outcome?.ok) await confirmControl();
    if (desired && (outcome?.stopped || outcome?.ok)) {
      const checkpoint = desired === 'pausing' ? await identify(workspace, attempt.revision).catch(() => null) : null;
      await report('stopped', checkpoint && checkpoint.branch === identity?.branch ? { revision: checkpoint.revision } : {});
      executionState = 'interrupted';
    } else if (outcome?.ok && !workerSignal.aborted) {
      let result;
      try {
        result = await identify(workspace, attempt.revision);
        if (result.dirty && result.branch === identity.branch && result.revision === attempt.revision) {
          await admitStorage();
          await checkpointCandidate(workspace, result, task, attempt);
          result = await identify(workspace, attempt.revision);
        }
      } catch {
        result = undefined;
      }
      if (result && !result.dirty && result.branch === identity.branch) {
        await report('finished', { result: 'candidate', revision: result.revision });
        executionState = 'completed';
      } else {
        await report('failed', { failure: 'Candidate workspace did not yield a clean, pinned revision.' });
      }
    } else {
      if (workerSignal.aborted) executionState = 'interrupted';
      await report('failed', { failure: workerSignal.aborted
        ? 'Executor interrupted before producing a candidate.'
        : 'Executor or workspace failed before producing a candidate.' });
    }
  } finally {
    if (telemetryStarted) await telemetry(onTelemetryEnd, { measurements: outcome?.measurements ?? [], state: executionState });
    if (lock) {
      await lock.close();
      await unlink(join(workspace, '.git', 'aads-task-worker.lock'));
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
  if (!isAbsolute(config.codex_bin) || !isAbsolute(config.workspace_root) || !config.workspaces ||
      !Array.isArray(config.storage_check) || !config.storage_check.length || !config.storage_check.every(value => typeof value === 'string') ||
      !isAbsolute(config.storage_check[0])) throw Error('Worker configuration is incomplete');
  const verification = config.verification;
  if (verification !== undefined && (typeof verification !== 'string' || !verificationId.test(verification))) {
    throw Error('Worker verification must be a namespace UUID');
  }
  const root = await realpath(config.workspace_root);
  const workspaces = new Map();
  for (const [id, path] of Object.entries(config.workspaces)) {
    if (!taskIdPattern.test(id) || !isAbsolute(path)) throw Error('Invalid Task workspace mapping');
    const workspace = await realpath(path);
    if (relative(root, dirname(workspace)) || [...workspaces.values()].includes(workspace)) {
      throw Error('Each Task workspace must be a distinct direct child of workspace_root');
    }
    await checkWorkspaceTelemetryScope(workspace, verification);
    workspaces.set(id, workspace);
  }
  if (!workspaces.size || workspaces.size > 500) throw Error('Worker requires 1 to 500 Task workspace mappings');

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => controller.abort());
  const { signal } = controller;
  const active = new Set();
  const admitStorage = () => runFile(config.storage_check[0], config.storage_check.slice(1), {
    cwd: root, windowsHide: true, timeout: 5000, maxBuffer: 8192,
  });
  let connector;
  function send(request) {
    connector ??= openObservatoryConnector({ cwd: root, tool, executable: config.codex_bin });
    return connector.call({ request, worker_key: credential, ...(verification ? { verification } : {}) }).catch(error => {
      if (!error.status) { connector?.close(); connector = undefined; }
      throw error;
    });
  }
  try {
    while (!signal.aborted) {
      if (active.size < 2) {
        try {
          await admitStorage();
          const request = { op: 'claim', operation_id: randomUUID(), task_ids: [...workspaces.keys()] };
          const result = await send(request).catch(error => {
            if (error.status && error.status < 500) throw error;
            return send(request);
          });
          if (result.claim && !signal.aborted) {
            const workspace = workspaces.get(result.claim.task.id);
            const job = runClaim({ claim: result.claim, send, workspace, executable: config.codex_bin, signal,
              verificationNamespace: verification ?? null,
              admitStorage: async () => {
                await admitStorage();
                await checkWorkspaceTelemetryScope(workspace, verification);
              } }).catch(() => {
                console.error('Attempt reporting failed. The Task lease will require reconciliation.');
              }).finally(() => active.delete(job));
            active.add(job);
            continue;
          }
        } catch (error) {
          if (error.status === 403 || error.status === 404) throw Error('Hosted Task worker is not configured or authorized');
          if (error.status !== 409) console.error('Worker admission or Task connection unavailable. Waiting.');
        }
      }
      await sleep(3000, undefined, { signal }).catch(() => {});
    }
  } finally {
    controller.abort();
    await Promise.all(active);
    connector?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
