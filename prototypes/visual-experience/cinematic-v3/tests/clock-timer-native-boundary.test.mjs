import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { productCommand, isProductRead } = require('../native/product-commands.cjs');
const { PRIVATE_MISSION_FILE_EDIT_COMMANDS } = require('../native/mission-file-edit-broker.cjs');

function preload(active) {
  let host; const calls = [], activation = { isActive: active };
  vm.runInNewContext(readFileSync(new URL('../native/desktop-preload.cjs', import.meta.url), 'utf8'), {
    process: { argv: [] }, navigator: { userActivation: activation },
    require: () => ({ contextBridge: { exposeInMainWorld(_name, value) { host = value; } }, ipcRenderer: {
      invoke: async (...input) => { calls.push(input); return { ok: true, result: 'canonical-clock-result' }; }, on() {}, removeListener() {},
    } }),
  });
  return { host, calls, activation };
}
function main(resumeBarrier = Promise.resolve()) {
  const source = readFileSync(new URL('../native/desktop-main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('  ipcMain.handle("application-command", async (event, command, input) => {');
  const end = source.indexOf('  const active = () => {', start);
  assert.ok(start >= 0 && end > start);
  let handler, focused = true, activation = true, loseFocus = false, activationReads = 0, storageChecks = 0;
  const calls = [], localURL = 'file:///synthetic-aerynth/index.html';
  const frame = { url: localURL, executeJavaScript: async script => {
    assert.equal(script, 'navigator.userActivation.isActive && document.hasFocus()'); activationReads++; if (loseFocus) focused = false; return activation;
  } };
  const webContents = { mainFrame: frame, isDestroyed: () => false };
  const win = { webContents, isDestroyed: () => false }, event = { sender: webContents, senderFrame: frame };
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle(_name, callback) { handler = callback; } }, Buffer, win, localURL,
    trustedActiveFrame: received => received === event && focused,
    productCommand, isProductRead, PRIVATE_MISSION_FILE_EDIT_COMMANDS, timerResumeBarrier: resumeBarrier,
    storage: { allowWrite: async () => { storageChecks++; return true; } },
    call: async (...input) => { calls.push(input); return { result: 'canonical-clock-result' }; },
  });
  return { event, calls, invoke: (family, input, received = event) => handler(received, family, input),
    focus: value => { focused = value; }, activation: value => { activation = value; }, loseFocus: () => { loseFocus = true; },
    metrics: () => ({ activationReads, storageChecks }) };
}

test('clock read/list are public reads, create/mutate are writes, and no private resume or scheduler operation is public', async () => {
  const seen = [], call = async (...input) => { seen.push(input); return { result: null }; };
  for (const name of ['read', 'list']) { const input = { name, input: {} }; assert.equal(isProductRead('clockTimers', input), true); await productCommand({ family: 'clockTimers', input, call }); }
  for (const name of ['create', 'mutate']) { const input = { name, input: {} }; assert.equal(isProductRead('clockTimers', input), false); await productCommand({ family: 'clockTimers', input, call }); }
  for (const name of ['onResume', 'reconcile', 'dispose', 'nextWake']) await assert.rejects(productCommand({ family: 'clockTimers', input: { name, input: {} }, call }), /unsupported_product_command/u);
  assert.equal(seen.length, 4);
});

test('isolated preload observes current activation synchronously and never accepts forged timer gesture flags', async () => {
  const denied = preload(false);
  await denied.host.command('clockTimers', { name: 'read', input: { resourceId: 'canonical-clock' } });
  await denied.host.command('clockTimers', { name: 'list', input: {} });
  for (const name of ['create', 'mutate']) await assert.rejects(denied.host.command('clockTimers', { name, input: { userGesture: true } }), /timer_user_gesture_required/u);
  assert.equal(denied.calls.length, 2);
  const allowed = preload(true), pending = allowed.host.command('clockTimers', { name: 'mutate', input: {} });
  assert.equal(allowed.calls.length, 1, 'IPC dispatch follows the synchronous isolated-world check in the same activation');
  allowed.activation.isActive = false; assert.equal(await pending, 'canonical-clock-result');
  await assert.rejects(allowed.host.command('timerHostResume', {}), /unsupported_command/u);
});

test('library and direct desktop clock creation also require real preload activation', async () => {
  const denied = preload(false);
  await assert.rejects(denied.host.command('library', { name: 'createBlock', input: { kind: 'clock_timer' } }), /timer_user_gesture_required/u);
  await assert.rejects(denied.host.command('desktop', { type: 'createResource', kind: 'clock_timer' }), /timer_user_gesture_required/u);
  assert.equal(denied.calls.length, 0);
});

test('actual Main handler permits scoped timer reads without activation but requires both native focus and Blink activation for writes', async () => {
  const native = main(); native.focus(false); native.activation(false);
  assert.equal((await native.invoke('clockTimers', { name: 'list', input: {} })).ok, true);
  assert.deepEqual(native.metrics(), { activationReads: 0, storageChecks: 0 });
  assert.equal((await native.invoke('clockTimers', { name: 'create', input: {} })).error, 'timer_user_gesture_required');
  native.focus(true); assert.equal((await native.invoke('clockTimers', { name: 'mutate', input: {} })).error, 'timer_user_gesture_required');
  native.activation(true); assert.equal((await native.invoke('clockTimers', { name: 'mutate', input: {} })).ok, true);
  assert.deepEqual(native.calls.map(call => call[1].name), ['list', 'mutate']); assert.equal(native.metrics().storageChecks, 1);
});

test('Main rejects detached/untrusted frames and lost focus after the activation observation', async () => {
  const native = main();
  assert.equal((await native.invoke('clockTimers', { name: 'list', input: {} }, { ...native.event, sender: {} })).error, 'unauthorized_sender');
  native.loseFocus(); assert.equal((await native.invoke('clockTimers', { name: 'create', input: {} })).error, 'timer_user_gesture_required');
  assert.equal(native.calls.length, 0);
});

test('Main refuses every real private mission-edit command through generic renderer RPC', async () => {
  const native = main();
  assert(Object.isFrozen(PRIVATE_MISSION_FILE_EDIT_COMMANDS) && PRIVATE_MISSION_FILE_EDIT_COMMANDS.length > 0);
  for (const command of PRIVATE_MISSION_FILE_EDIT_COMMANDS) {
    assert.equal((await native.invoke(command, { userGesture: true })).error, 'unauthorized_private_command');
  }
  assert.equal(native.calls.length, 0);
  assert.deepEqual(native.metrics(), { activationReads: 0, storageChecks: 0 });
});

test('Main serializes new clock commands behind its private resume barrier and never dispatches renderer-forged resume', async () => {
  let release; const barrier = new Promise(resolve => { release = resolve; }), native = main(barrier);
  const pending = native.invoke('clockTimers', { name: 'list', input: {} }); await Promise.resolve(); assert.equal(native.calls.length, 0);
  release(); assert.equal((await pending).ok, true);
  assert.equal((await native.invoke('timerHostResume', {})).error, 'unsupported_command'); assert.equal(native.calls.length, 1);
});
