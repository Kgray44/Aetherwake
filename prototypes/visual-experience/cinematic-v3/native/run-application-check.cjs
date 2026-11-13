/* Explicit offline desktop verification launcher. Importing this module never launches or writes. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { createHash } = require('node:crypto');
const { checkNativeTestLaunch } = require('./launch-native-test.cjs');
const MAX_LOG = 2 * 1024 * 1024, MAX_LINE = 65536;
const inside = (root, file) => { const part = path.relative(root, file); return !!part && !part.startsWith('..') && !path.isAbsolute(part); };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function buildStages({ cwd, repo, profile, node, tsc, vite, electron }) {
  const desktop = [cwd, '--integration-expanded', '--prepared-workspaces', '--profile=' + profile];
  return [
    { name: 'typecheck', file: node, args: [tsc, '--noEmit', '-p', path.join(cwd, 'tsconfig.json')], cwd, timeout: 60000 },
    { name: 'build', file: node, args: [vite, 'build'], cwd, timeout: 60000 },
    { name: 'prepare', file: node, args: [path.join(repo, 'prototypes/constellation/tests/prepare-integrated.mts'), '--app-root=' + repo, '--profile=' + profile], cwd, timeout: 65000, terminal: 'prepared' },
    { name: 'journey', file: electron, args: [...desktop, '--verification-deadline-ms=90000'], cwd, timeout: 95000, terminal: 'passed' },
    { name: 'restore', file: electron, args: [...desktop, '--verify-restore', '--verification-deadline-ms=30000'], cwd, timeout: 35000, terminal: 'passed' },
  ];
}
function terminalLine(line, key) {
  try { const value = JSON.parse(line); return value && typeof value === 'object' && Object.hasOwn(value, key) ? value : null; } catch { return null; }
}
function terminateOwned(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Never select by executable name: this PID was returned by our own spawn.
  try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
  catch { if (child.exitCode === null && child.signalCode === null) child.kill(); }
}
function runStage(stage, { env, signal, write, spawnChild = spawn, terminate = terminateOwned }) {
  return new Promise((resolve, reject) => {
    let child, failure, terminal, bytes = 0, pending = '', recent = '', finished = false, termination = Promise.resolve();
    const decoder = new StringDecoder('utf8');
    const abort = error => { if (failure || finished) return; failure = error; termination = Promise.resolve().then(() => terminate(child)).catch(cleanupError => { failure.cleanupError = String(cleanupError); }); };
    const parse = line => { if (!stage.terminal) return; const value = terminalLine(line, stage.terminal); if (value) { terminal = value; if (value[stage.terminal] !== true) abort(new Error(stage.name + '_reported_failure')); } };
    const output = (stream, chunk) => {
      if (finished) return; const text = stream === 'stdout' ? decoder.write(chunk) : chunk.toString('utf8'), log = Buffer.from('[' + stream + '] ' + text);
      const remaining = MAX_LOG - bytes; if (remaining > 0) { const part = log.subarray(0, remaining); write(part); bytes += part.length; }
      if (log.length > remaining) { abort(new Error(stage.name + '_log_capacity_exceeded')); return; }
      recent = (recent + text).slice(-4096); if (/native_verification_focus_lost|native_window_not_focused|native_window_focus_lost/i.test(recent)) abort(new Error(stage.name + '_focus_lost'));
      if (stream === 'stdout') { pending += text; if (pending.length > MAX_LINE) { abort(new Error(stage.name + '_terminal_line_capacity_exceeded')); return; } let newline; while ((newline = pending.indexOf('\n')) >= 0) { parse(pending.slice(0, newline).trim()); pending = pending.slice(newline + 1); } }
    };
    const cancelled = () => abort(new Error(stage.name + '_cancelled'));
    const timer = setTimeout(() => abort(new Error(stage.name + '_parent_deadline')), stage.timeout);
    const finish = async (code, exitSignal) => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancelled); parse((pending + decoder.end()).trim());
      await termination;
      if (!failure && (code !== 0 || exitSignal)) failure = new Error(stage.name + '_exit_' + String(code ?? exitSignal));
      if (!failure && stage.terminal && terminal?.[stage.terminal] !== true) failure = new Error(stage.name + '_missing_positive_terminal');
      const result = { name: stage.name, pid: child?.pid, code, signal: exitSignal, bytes, terminal, ...(failure?.cleanupError ? { cleanupError: failure.cleanupError } : {}) };
      if (failure) { failure.stage = result; reject(failure); } else resolve(result);
    };
    try {
      child = spawnChild(stage.file, stage.args, { cwd: stage.cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => { try { output('stdout', chunk); } catch (error) { abort(error); } }); child.stderr.on('data', chunk => { try { output('stderr', chunk); } catch (error) { abort(error); } });
      child.once('error', error => { abort(error); void finish(null, null); }); child.once('close', (code, exitSignal) => void finish(code, exitSignal));
      signal?.addEventListener('abort', cancelled, { once: true }); if (signal?.aborted) cancelled();
    } catch (error) { abort(error); void finish(null, null); }
  });
}
function reserveGuard(local, profile, cwd) {
  const d = [profile, cwd].some(value => value.toUpperCase().startsWith('D:')) ? '1073741824' : '0';
  const receipt = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(local, 'AeroStorageWatch/ReserveGuard.ps1'), '-EstimatedCBytes', '1073741824', '-EstimatedDBytes', d], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536 }));
  assert.equal(receipt.allowed, true, 'storage_reserve_admission_denied'); return receipt;
}
function verifySource(source, repo, cwd) {
  assert(source?.hashes && Object.keys(source.hashes).length && source?.buildAssets && Object.keys(source.buildAssets).length, 'Native source/build evidence missing');
  for (const [name, expected] of Object.entries(source.hashes)) { const file = path.resolve(repo, name); assert(inside(repo, file), 'Invalid source evidence path'); assert.equal(hash(file), expected, 'Source changed: ' + name); }
  const assets = path.join(cwd, 'dist/assets'); for (const [name, expected] of Object.entries(source.buildAssets)) { const file = path.resolve(assets, name); assert(inside(assets, file), 'Invalid build evidence path'); assert.equal(hash(file), expected, 'Build changed: ' + name); }
}
function readNativeReceipt(terminal, cwd) {
  assert(typeof terminal?.evidence === 'string', 'Native terminal must identify its private evidence'); const folder = path.resolve(terminal.evidence), root = path.join(cwd, '.runtime/application-evidence'); assert(inside(root, folder), 'Native evidence outside private runtime');
  const file = path.join(folder, 'expanded.json'); assert(fs.statSync(file).size <= 2 * 1024 * 1024, 'Native receipt capacity exceeded'); const receipt = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(receipt.passed, true, 'Native receipt did not pass'); return receipt;
}
async function main() {
  assert.equal(process.platform, 'win32', 'Application verification requires the Windows reserve and native desktop host'); assert(!process.versions.electron, 'Run this launcher with actual Node'); assert.equal(process.argv.length, 2, 'This offline runner accepts no forwarded native/provider flags');
  checkNativeTestLaunch();
  const cwd = fs.realpathSync(path.resolve(__dirname, '..')), repo = fs.realpathSync(path.resolve(cwd, '../../..')), local = process.env.LOCALAPPDATA; assert(local && path.isAbsolute(local), 'LOCALAPPDATA must be an absolute existing directory');
  const parent = path.join(local, 'Aerynth'), profile = path.join(parent, 'review-expanded-application-' + Date.now()), logs = profile + '.runner-logs'; assert(profile !== repo && !inside(repo, profile), 'Private profile must be external to the checkout'); assert(!fs.existsSync(profile) && !fs.existsSync(logs), 'Fresh profile/log path already exists; preserve it');
  reserveGuard(local, profile, cwd); fs.mkdirSync(parent, { recursive: true }); fs.mkdirSync(logs);
  const receipt = { contract: 'aerynth.application-check-runner@1', profile, logs, startedAt: new Date().toISOString(), node: process.execPath, passed: false, stages: [], boundary: 'Offline expanded native journey and exact-source/profile restore; no provider or live qualification.' }, controller = new AbortController();
  const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const tsc = require.resolve('typescript/bin/tsc', { paths: [cwd] }), vite = path.join(path.dirname(require.resolve('vite/package.json', { paths: [cwd] })), 'bin/vite.js'), electron = require(require.resolve('electron', { paths: [cwd] })); assert(typeof electron === 'string' && path.isAbsolute(electron), 'Installed Electron executable unavailable');
    const stages = buildStages({ cwd, repo, profile, node: process.execPath, tsc, vite, electron });
    const nativeEnv = { ...process.env, AERYNTH_NODE_BIN: process.execPath };
    delete nativeEnv.ELECTRON_RUN_AS_NODE;
    const setupEnv = { ...nativeEnv };
    delete setupEnv.AERYNTH_NATIVE_TEST_SLOT;
    let originalSource;
    for (const stage of stages) {
      assert(!controller.signal.aborted, 'application_check_cancelled'); reserveGuard(local, profile, cwd);
      if (stage.name === 'prepare') assert(!fs.existsSync(profile), 'Preparation must create the fresh profile itself');
      if (stage.name === 'restore') verifySource(originalSource, repo, cwd);
      const log = path.join(logs, stage.name + '.log'); fs.writeFileSync(log, '', { flag: 'wx' }); let result;
      const nativeStage = stage.file === electron;
      const env = nativeStage ? nativeEnv : setupEnv;
      if (nativeStage) checkNativeTestLaunch(env);
      try { result = await runStage(stage, { env, signal: controller.signal, write: buffer => fs.appendFileSync(log, buffer) }); } catch (error) { if (error.stage) receipt.stages.push({ ...error.stage, log }); throw error; }
      receipt.stages.push({ ...result, log });
      if (stage.name === 'prepare') assert.equal(path.resolve(result.terminal.profile), profile, 'Preparation returned a different profile');
      if (stage.terminal === 'passed') { const native = readNativeReceipt(result.terminal, cwd); verifySource(native.source, repo, cwd); if (originalSource) { assert.deepEqual(native.source.hashes, originalSource.hashes, 'Restore source differs'); assert.deepEqual(native.source.buildAssets, originalSource.buildAssets, 'Restore build differs'); } else originalSource = native.source; }
    }
    receipt.passed = true;
  } catch (error) { receipt.error = String(error.stack ?? error).slice(0, 6000); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); receipt.finishedAt = new Date().toISOString(); const json = JSON.stringify(receipt, null, 2); assert(Buffer.byteLength(json) <= 1024 * 1024, 'Runner receipt capacity exceeded'); fs.writeFileSync(path.join(logs, 'runner.json'), json); }
  console.log(JSON.stringify({ passed: receipt.passed, profile, logs, error: receipt.error })); process.exitCode = receipt.passed ? 0 : 1; return receipt;
}
exports.buildStages = buildStages; exports.terminalLine = terminalLine; exports.runStage = runStage;
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ passed: false, error: String(error.message ?? error) })); process.exitCode = 1; });
