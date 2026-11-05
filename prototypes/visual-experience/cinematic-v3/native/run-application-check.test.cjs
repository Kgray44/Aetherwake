const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { buildStages, terminalLine, runStage } = require('./run-application-check.cjs');

// In-memory spawn stubs only. No executable, window, profile, log file or preparation is created.
function stub(stage, emit) {
  const child = new EventEmitter(); child.pid = 424242; child.exitCode = null; child.signalCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const killed = [], logs = []; let spawns = 0;
  const close = code => { child.exitCode = code; child.emit('close', code, null); };
  const promise = runStage({ name: 'synthetic-stage', file: 'never-executed', args: ['argument with spaces'], cwd: process.cwd(), timeout: 1000, ...stage }, {
    env: {}, write: buffer => logs.push(buffer), spawnChild(file, args, options) { spawns++; assert.equal(options.shell, false); assert.deepEqual(args, ['argument with spaces']); queueMicrotask(() => emit({ child, close })); return child; },
    terminate(owned) { assert.equal(owned, child); killed.push(owned.pid); queueMicrotask(() => close(143)); },
  });
  return { promise, killed, logs, get spawns() { return spawns; } };
}

test('fixed command arrays bind actual Node, fresh external profile, exact offline journey and same-profile restore deadlines', () => {
  const cwd = path.resolve('synthetic checkout/cinematic'), repo = path.resolve('synthetic checkout'), profile = path.resolve('external private/review-expanded-application-123');
  const stages = buildStages({ cwd, repo, profile, node: process.execPath, tsc: 'installed/typescript/bin/tsc', vite: 'installed/vite/bin/vite.js', electron: 'installed/electron.exe' });
  assert.deepEqual(stages.map(s => s.name), ['typecheck', 'build', 'prepare', 'journey', 'restore']);
  for (const stage of stages.slice(0, 3)) { assert.equal(stage.file, process.execPath); assert.equal(stage.cwd, cwd); }
  assert.deepEqual(stages[0].args.slice(0, 2), ['installed/typescript/bin/tsc', '--noEmit']); assert.deepEqual(stages[1].args, ['installed/vite/bin/vite.js', 'build']);
  assert(stages[2].args.includes('--app-root=' + repo)); assert(stages[2].args.includes('--profile=' + profile));
  assert.equal(stages[3].timeout, 95000); assert.equal(stages[4].timeout, 35000);
  for (const stage of stages.slice(3)) { assert(stage.args.includes('--profile=' + profile)); assert(stage.args.includes('--integration-expanded')); assert(stage.args.includes('--prepared-workspaces')); assert(!stage.args.some(a => /integration-live|vela-live|integration-verify/.test(a))); }
  assert(stages[3].args.includes('--verification-deadline-ms=90000')); assert(stages[4].args.includes('--verification-deadline-ms=30000')); assert(stages[4].args.includes('--verify-restore'));
});

test('terminal parser ignores ordinary output but preserves explicit false and nonboolean results for rejection', () => {
  assert.equal(terminalLine('ordinary output', 'passed'), null); assert.equal(terminalLine('{"ready":true}', 'passed'), null);
  assert.deepEqual(terminalLine('{"passed":false}', 'passed'), { passed: false }); assert.deepEqual(terminalLine('{"passed":"true"}', 'passed'), { passed: 'true' });
});
test('exit zero without positive native terminal is insufficient', async () => {
  const s = stub({ terminal: 'passed' }, ({ close }) => close(0)); await assert.rejects(s.promise, /missing_positive_terminal/); assert.equal(s.spawns, 1);
});
test('positive terminal plus exit zero is accepted without launching another process', async () => {
  const s = stub({ terminal: 'passed' }, ({ child, close }) => { child.stdout.emit('data', Buffer.from('{"passed":true,"evidence":"synthetic-private"}\n')); close(0); });
  assert.equal((await s.promise).terminal.passed, true); assert.deepEqual(s.killed, []); assert.equal(s.spawns, 1);
});
test('positive JSON cannot conceal a nonzero child exit', async () => {
  const s = stub({ terminal: 'passed' }, ({ child, close }) => { child.stdout.emit('data', Buffer.from('{"passed":true}\n')); close(1); }); await assert.rejects(s.promise, /exit_1/); assert.equal(s.spawns, 1);
});
test('explicit failure terminates only the owned stub PID with no retry', async () => {
  const s = stub({ terminal: 'passed' }, ({ child }) => child.stdout.emit('data', Buffer.from('{"passed":false}\n'))); await assert.rejects(s.promise, /reported_failure/); assert.deepEqual(s.killed, [424242]); assert.equal(s.spawns, 1);
});
test('focus loss terminates only the owned child even when split across stream chunks', async () => {
  const s = stub({}, ({ child }) => { child.stderr.emit('data', Buffer.from('native_verification_focus_')); child.stderr.emit('data', Buffer.from('lost: stopped')); }); await assert.rejects(s.promise, /focus_lost/); assert.deepEqual(s.killed, [424242]);
});
test('parent timeout terminates the owned child instead of waiting for a lingering UI', async () => {
  const s = stub({ timeout: 10 }, () => {}); await assert.rejects(s.promise, /parent_deadline/); assert.deepEqual(s.killed, [424242]); assert.equal(s.spawns, 1);
});
test('private output limit is losslessly bounded and fails rather than silently truncating a passing run', async () => {
  const s = stub({}, ({ child }) => child.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1, 'x'))); await assert.rejects(s.promise, /log_capacity_exceeded/); assert(s.logs.reduce((sum, buffer) => sum + buffer.length, 0) <= 2 * 1024 * 1024); assert.deepEqual(s.killed, [424242]);
});
