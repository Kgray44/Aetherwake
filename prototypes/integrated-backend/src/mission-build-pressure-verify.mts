import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { CodexAdapter } from '../../codex-bridge/src/adapter.ts';
import { windowsCodexLaunch } from './codex-launch.mts';
import { createMissionAdmission } from './mission-admission.mts';
import { createMissionProjectCheck } from './mission-project-check.mts';
import { MissionService } from './mission-service.mts';
import { planVelaProjectCheck } from './vela-project-check.mts';

if (process.platform !== 'win32' || process.env.AERYNTH_VERIFY_WINDOWS_BUILD !== '1')
  throw Error('Windows and AERYNTH_VERIFY_WINDOWS_BUILD=1 are required');
const path = Object.entries(process.env).find(([name]) => name.toUpperCase() === 'PATH')?.[1] ?? '';
const launch = windowsCodexLaunch(path, process.execPath, ['app-server', '--listen', 'stdio://']);
assert.ok(launch, 'installed Codex CLI is unavailable');
const adapter = new CodexAdapter(launch.executable, launch.args);
const fixtureBase = realpathSync.native(resolve(homedir(), 'Documents'));
const root = mkdtempSync(join(fixtureBase, 'aerynth-arie-build-pressure-'));
const database = new DatabaseSync(':memory:');
const governor = createMissionAdmission({ maxWorkers: 3, readWindowsPressure: null });
const scope = { workspaceId: 'build-pressure-fixture', projectId: null };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, resolve: release };
}
const readyEntered = latch(), readyGate = latch();
let commandEntered = latch();
const eventLoop = monitorEventLoopDelay({ resolution: 5 });
let nativeCommandMs = 0;
let holdReadiness = true, nativeRuns = 0, occupied = false;
const check = createMissionProjectCheck({ digest, runner: {
  async ready() {
    if (holdReadiness) { readyEntered.resolve(); await readyGate.promise; }
    return adapter.windowsSandboxReady();
  },
  async execute(command, cwd) {
    nativeRuns++;
    commandEntered.resolve();
    const started = performance.now();
    try { return await adapter.execReadOnly({ command, cwd, timeoutMs: 8000 }); }
    finally { nativeCommandMs = Math.round(performance.now() - started); }
  },
}, lease() {
  if (occupied) return null;
  occupied = true;
  return () => { occupied = false; };
} });
const service = new MissionService({ db: database, authorized: candidate => candidate.workspaceId === scope.workspaceId,
  atomic<T>(operation: () => T) {
    database.exec('BEGIN');
    try { const result = operation(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }, executors: { 'codex.project-check': check }, laneLimit: () => 1, admission: governor.read,
  resources: { canAcquire: () => governor.canLease('build'), acquire: (_lane, request) => governor.tryLease({ ...request, kind: 'build' }) },
});

function mode(mode: 'balanced' | 'gaming_focus') {
  const policy = governor.inspectPolicy();
  governor.configurePolicy(policy.configVersion, { mode, limits: policy.limits });
  governor.read(true);
  service.capacityChanged();
}
async function settle(id: string) {
  const deadline = performance.now() + 12_000;
  while (performance.now() < deadline) {
    const current = service.read(id, scope);
    if (!['queued', 'running', 'cancelling'].includes(current.outcome)) return current;
    await wait(20);
  }
  throw Error('sandbox command did not settle');
}

try {
  const input = join(root, 'bounded.test.mjs');
  writeFileSync(input, `import test from 'node:test';\nimport { setTimeout as wait } from 'node:timers/promises';\n` +
    `test('synthetic sandbox test', async () => { await wait(2500); });\n`);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, timeout: 5000, stdio: 'ignore' });
  git('init', '--quiet');
  git('add', '--', 'bounded.test.mjs');
  git('-c', 'user.name=ARIE fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '--no-verify', '-m', 'Record the synthetic read-only input');
  const checked = planVelaProjectCheck(undefined, 'node-test', [input]);
  const plan = { objective: 'Verify the synthetic read-only test', scope, criteria: ['read-only-test'], tasks: [{ id: 'test',
    objective: 'Run the reviewed test', criterion: 'read-only-test', executor: 'codex.project-check', claims: [], dependencies: [],
    maxAttempts: 1, timeoutMs: 12_000, projectCheck: { paths: [input], digest: digest(checked) } }] };
  await adapter.connect();
  assert.equal(await adapter.windowsSandboxReady(), true);

  const queued = service.create('before-dispatch-pressure', plan);
  await Promise.race([readyEntered.promise, wait(5000, undefined, { ref: false }).then(() => { throw Error('sandbox readiness gate not reached'); })]);
  mode('gaming_focus');
  readyGate.resolve();
  const blocked = await settle(queued.id);
  assert.equal(blocked.outcome, 'blocked');
  assert.equal((blocked.tasks[0].attempts[0].evidence?.value as { status: string }).status, 'resource_checkpoint');
  assert.equal(nativeRuns, 0);
  assert.equal(governor.inspectPolicy().active.build, 0);

  holdReadiness = false;
  mode('balanced');
  eventLoop.enable();
  await wait(20);
  const active = service.create('after-dispatch-pressure', plan);
  await Promise.race([commandEntered.promise, wait(7000, undefined, { ref: false }).then(() => { throw Error('sandbox dispatch not reached'); })]);
  await wait(350);
  mode('gaming_focus');
  assert.equal(governor.inspectPolicy().effective.build, 0);
  assert.equal(governor.inspectPolicy().active.build, 1);
  assert.equal(governor.canLease('remote'), true);
  const terminal = await settle(active.id);
  assert.equal(terminal.outcome, 'verified', terminal.tasks[0].detail);
  assert.equal(terminal.tasks[0].attempts[0].resourceLease?.kind, 'build');
  assert.equal(governor.inspectPolicy().active.build, 0);
  assert.equal(nativeRuns, 1);
  eventLoop.disable();
  const verifiedCommandMs = nativeCommandMs;

  mode('balanced');
  commandEntered = latch();
  const stale = service.create('input-changes-after-dispatch', plan);
  await Promise.race([commandEntered.promise, wait(7000, undefined, { ref: false }).then(() => { throw Error('sandbox dispatch not reached'); })]);
  await wait(350);
  appendFileSync(input, '\n// Synthetic input changed after dispatch.\n');
  const invalidated = await settle(stale.id);
  assert.equal(invalidated.outcome, 'blocked');
  assert.equal((invalidated.tasks[0].attempts[0].evidence?.value as { status: string }).status, 'reviewed_check_changed');
  assert.equal(invalidated.tasks[0].attempts[0].verification?.passed, false);
  assert.equal(governor.inspectPolicy().active.build, 0);
  assert.equal(nativeRuns, 2);
  console.log(JSON.stringify({ sandboxReady: true, preDispatchOutcome: blocked.outcome, nativeRuns,
    activeLeaseRetainedUntilVerified: true, remoteAvailableUnderPressure: true,
    executionMs: terminal.tasks[0].attempts[0].timing?.executionMs, nativeCommandMs: verifiedCommandMs,
    backendEventLoopMaxMs: Math.round(eventLoop.max / 1e6), changedInputOutcome: invalidated.outcome }));
} finally {
  eventLoop.disable();
  readyGate.resolve();
  await service.close();
  adapter.close();
  governor.dispose();
  database.close();
  const target = realpathSync.native(root), part = relative(fixtureBase, target);
  assert.ok(part.startsWith('aerynth-arie-build-pressure-') && !isAbsolute(part));
  rmSync(target, { recursive: true, force: true });
}
