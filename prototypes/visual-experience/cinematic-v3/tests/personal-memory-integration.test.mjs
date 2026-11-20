import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { componentDocument, named, until } from '../../../conversation-product/test/component-dom.mts';
import { createPersonalMemoryView } from '../src/personal-memory-view.ts';

test('actual preload exposes inspector reads but requires live activation for every mutation', async () => {
  let host;
  const calls = [], navigator = { userActivation: { isActive: false } };
  vm.runInNewContext(readFileSync(new URL('../native/desktop-preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'aerynthHost'); host = api; } },
        ipcRenderer: { async invoke(...args) { calls.push(args); return { ok: true, result: 'synthetic' }; } } };
    }, process: { argv: [] }, navigator,
  });
  for (const type of ['list', 'read']) assert.equal(await host.command('personalMemory', { type }), 'synthetic');
  for (const type of ['manage', 'revokeSource', 'disableProviderMemory']) {
    const before = calls.length;
    await assert.rejects(host.command('personalMemory', { type, userGesture: true }), /personal_memory_user_gesture_required/);
    assert.equal(calls.length, before);
    navigator.userActivation.isActive = true;
    assert.equal(await host.command('personalMemory', { type }), 'synthetic');
    navigator.userActivation.isActive = false;
  }
  for (const name of ['personalMemoryManagementNative', 'personalMemoryPolicyNative', 'personalMemoryRevokeSourceNative'])
    await assert.rejects(host.command(name, {}), /unsupported_command/);
});

test('superseded inspector reads cannot display stale private text after a reload', async () => {
  const f = componentDocument(), restore = f.install();
  let finishRead, lists = 0;
  const record = { id: 'fact', version: 1, state: 'active', scope: { kind: 'project', id: 'synthetic' } };
  try {
    const view = createPersonalMemoryView(async request => {
      if (request.type === 'list') return { records: ++lists === 1 ? [record] : [], next: null, policy: { version: 1 } };
      return new Promise(resolve => { finishRead = resolve; });
    });
    named(view, 'Load saved memories').fire('click');
    await until(() => !!named(view, 'Memory fact · project · active'));
    named(view, 'Memory fact · project · active').fire('click');
    await until(() => !!finishRead);
    named(view, 'Load saved memories').fire('click');
    await until(() => view.textContent.includes('No saved memories.'));
    finishRead({ ...record, text: 'Superseded synthetic private text', provenance: { kind: 'user-statement' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch(view.textContent, /Superseded synthetic private text/);
    assert.equal(view.querySelector('textarea'), null);
  } finally { restore(); }
});

test('actual native inspector branch keeps confirmation and export in the native process', async () => {
  const source = readFileSync(new URL('../native/desktop-main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('      if (command === "personalMemory") {');
  const end = source.indexOf('      else if (command === "personalMemoryCapture") {', start);
  assert.ok(start > 0 && end > start);
  let options;
  const files = [], dialogs = [], frame = {}, win = { isVisible: () => true, isMinimized: () => false };
  const execute = vm.runInNewContext('(async () => { let result; ' + source.slice(start, end) + '\nreturn result; })', {
    command: 'personalMemory', input: { type: 'list' }, closing: false, backendFailed: false,
    trustedApplicationFrame: () => true, trustedActiveFrame: () => true,
    event: { senderFrame: frame }, win, storage: { allowWrite: async () => true }, call: async () => {},
    managePersonalMemory: async value => { options = value; return { status: 'synthetic' }; },
    reviewDialogs: { async showMessageBox(_win, value) { dialogs.push(value); return { response: 1 }; },
      async showSaveDialog() { return { canceled: false, filePath: 'synthetic.json' }; } },
    writeFileSync: (...args) => files.push(args),
  });
  assert.equal((await execute()).status, 'synthetic');
  assert.equal(options.trustedFrame(), true);
  assert.equal(await options.confirm({ action: 'export', fact: { text: 'synthetic fact' } }), true);
  assert.match(dialogs[0].detail, /readable memory text/);
  assert.equal(dialogs[0].defaultId, 0);
  const path = await options.chooseExport();
  options.writeExport(path, { records: ['synthetic'] });
  assert.equal(files[0][0], 'synthetic.json');
  assert.equal(files[0][2].flag, 'wx');
  assert.equal(files[0][2].mode, 0o600);
});
