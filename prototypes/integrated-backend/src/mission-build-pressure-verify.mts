import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
const parallelTypecheck = process.argv.includes('--parallel-typecheck');
const requireCpuPressure = process.argv.includes('--require-native-cpu-pressure');
assert.ok(!requireCpuPressure || parallelTypecheck, 'Native CPU pressure verification requires the parallel typecheck fixture');
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
let compilerOverlapMs: number | undefined;
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
    try {
      const result = await adapter.execReadOnly({ command, cwd, timeoutMs: 8000 });
      if (parallelTypecheck && result.exitCode !== 0) console.error(JSON.stringify({ stdout: result.stdout, stderr: result.stderr }));
      const overlap = /^(?:# )?verified compiler overlap ms: (\d+(?:\.\d+)?)\r?$/mu.exec(result.stdout)?.[1];
      compilerOverlapMs = overlap === undefined ? undefined : Number(overlap);
      return result;
    }
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

function compilerFixture() {
  const installed = dirname(createRequire(import.meta.url).resolve('typescript'));
  const compiler = join(root, 'compiler');
  mkdirSync(compiler);
  const files = readdirSync(installed).filter(name => /^(?:typescript\.js|lib(?:\.[a-z0-9]+)*\.d\.ts)$/u.test(name));
  assert.ok(files.includes('typescript.js'));
  assert.ok(files.reduce((total, name) => total + statSync(join(installed, name)).size, 0) < 24 * 2 ** 20);
  for (const name of files) copyFileSync(join(installed, name), join(compiler, name));
  for (const project of ['service', 'worker']) {
    const directory = join(root, project);
    mkdirSync(directory);
    for (let index = 0; index < 24; index++) {
      const source = index === 0 ? 'export const value: number = 1;\n' :
        `import { value as prior } from './module-${index - 1}.js';\nexport const value: number = prior + ${index};\n`;
      writeFileSync(join(directory, `module-${index}.ts`), source);
    }
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2023',
      module: 'NodeNext', types: [], lib: ['ES2023'] }, include: ['*.ts'] }));
  }
  return `import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker, parentPort, workerData, threadId } from 'node:worker_threads';
if (parentPort) {
  const { default: ts } = await import('./compiler/typescript.js');
  const file = './' + workerData + '/tsconfig.json';
  const config = ts.readConfigFile(file, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, './' + workerData);
  assert.equal(options.errors.length, 0);
  assert.equal(options.fileNames.length, 24);
  const started = performance.now();
  const program = ts.createProgram(options.fileNames, { ...options.options, noEmit: true, incremental: false });
  assert.equal(ts.getPreEmitDiagnostics(program).length, 0);
  parentPort.postMessage({ threadId, started, ended: performance.now() });
} else {
  test('typecheck two independent module graphs', async () => {
    const results = await Promise.all(['service', 'worker'].map(project => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: project, execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 96 } });
      let result;
      worker.once('message', value => { result = value; });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 && result ? resolve(result) : reject(Error('Compiler worker failed')));
    })));
    const [a, b] = results;
    assert.notEqual(a.threadId, b.threadId);
    const overlap = Math.min(a.ended, b.ended) - Math.max(a.started, b.started);
    assert.ok(overlap > 0);
    console.log('verified compiler overlap ms: ' + overlap.toFixed(2));
  });
}\n`;
}

try {
  const input = join(root, 'bounded.test.mjs');
  writeFileSync(input, parallelTypecheck ? compilerFixture() : `import test from 'node:test';\nimport { setTimeout as wait } from 'node:timers/promises';\n` +
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
  if (parallelTypecheck) {
    await wait(550);
    let sample = governor.read(true);
    if (requireCpuPressure) {
      const deadline = performance.now() + 6000;
      while (!sample.reasons.includes('cpu-load') && performance.now() < deadline) {
        await wait(550);
        sample = governor.read(true);
      }
      assert.ok(sample.reasons.includes('cpu-load'), 'Expected sustained native CPU pressure before sandbox admission');
      assert.equal(governor.inspectPolicy().effective.cpu, 1);
      assert.equal(governor.canLease('remote'), true);
    }
  }
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
  const attempt = terminal.tasks[0].attempts[0];
  assert.equal(attempt.resourceLease?.kind, 'build');
  if (requireCpuPressure) assert.ok(attempt.admission?.reasons.includes('cpu-load'));
  assert.equal(governor.inspectPolicy().active.build, 0);
  assert.equal(nativeRuns, 1);
  const verifiedOverlapMs = compilerOverlapMs;
  if (parallelTypecheck) assert.ok(verifiedOverlapMs !== undefined && verifiedOverlapMs > 0);
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
    queueMs: attempt.timing?.queueMs, executionMs: attempt.timing?.executionMs, nativeCommandMs: verifiedCommandMs,
    backendEventLoopMaxMs: Math.round(eventLoop.max / 1e6), changedInputOutcome: invalidated.outcome,
    ...(parallelTypecheck ? { compilerWorkers: 2, compilerOverlapMs: verifiedOverlapMs,
      cpuAtAdmissionPercent: attempt.admission?.readings.cpuPercent?.value ?? null,
      cpuPressureAtAdmission: attempt.admission?.reasons.includes('cpu-load') ?? false } : {}) }));
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
