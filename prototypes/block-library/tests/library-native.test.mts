import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { prepareLibraryNative } from '../prepare-library-native.mts';
const require = createRequire(import.meta.url), { createGuard, options, verify } = require('./library-native.cjs');

function fakeWindow() {
  const listeners = new Map<string, Function[]>(); let events = 0, focused = true;
  const win = {
    isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused,
    focus() { throw Error('No focus acquisition permitted'); },
    webContents: {
      isDestroyed: () => false,
      on(name: string, fn: Function) { listeners.set(name, [...listeners.get(name) ?? [], fn]); },
      removeListener(name: string, fn: Function) { listeners.set(name, (listeners.get(name) ?? []).filter(value => value !== fn)); },
      sendInputEvent() { events++; },
      executeJavaScript() { throw Error('No UI/JS permitted in rejection test'); },
    },
  };
  return { win, listeners, get events() { return events; }, loseFocus() { focused = false; } };
}
test('A/C helper uses the same explicit host-started deadline and native budgets', () => {
  assert.throws(() => options([], Date.now()));
  assert.throws(() => options(['--verification-deadline-ms=90001'], Date.now()));
  const value = options(['--verification-deadline-ms=90000', '--verify-restore'], 1000);
  assert.equal(value.deadlineAt, 91000); assert.equal(value.restore, true); assert.equal(value.maxScreenshots, 2); assert.equal(value.maxPngBytes, 8388608);
});
test('operator Escape, expired deadline and focus loss stop native input; listener custody is released', () => {
  const f = fakeWindow(), guard = createGuard(f.win, { deadlineAt: Date.now() + 10000 });
  let prevented = false;
  f.listeners.get('before-input-event')![0]({ preventDefault() { prevented = true; } }, { type: 'keyDown', key: 'Escape' });
  assert.equal(prevented, true); assert.throws(() => guard.input({ type: 'mouseMove', x: 1, y: 1 }), /operator_escape/); assert.equal(f.events, 0); guard.dispose();
  assert.equal(f.listeners.get('before-input-event')!.length, 0);
  const second = fakeWindow(), active = createGuard(second.win, { deadlineAt: Date.now() + 10000 }); second.loseFocus();
  assert.throws(() => active.input({ type: 'mouseMove', x: 1, y: 1 }), /native_owner_window_inactive/); active.dispose(); assert.equal(second.events, 0);
  assert.throws(() => createGuard(fakeWindow().win, { deadlineAt: Date.now() - 1 }), /deadline_reached/);
});
test('Escape during an awaited operation rejects its continuation; destroyed-window cleanup uses the retained event emitter', async () => {
  const f = fakeWindow(), guard = createGuard(f.win, { deadlineAt: Date.now() + 10000 });
  let release!: (value: string) => void;
  const pending = guard.around(() => new Promise<string>(resolve => { release = resolve; }));
  f.listeners.get('before-input-event')![0]({ preventDefault() {} }, { type: 'keyDown', key: 'Escape' });
  release('finished-before-cancellation-observed'); await assert.rejects(pending, /operator_escape/);
  Object.defineProperty(f.win, 'webContents', { get() { throw Error('Native window has been destroyed'); } });
  assert.doesNotThrow(() => guard.dispose()); assert.equal(f.listeners.get('before-input-event')!.length, 0); assert.equal(f.events, 0);
});
test('A/C verifier refuses observed startup errors before JS/native interaction and exits only its own app', async () => {
  const argv = process.argv; process.argv = [...argv, '--verification-deadline-ms=30000'];
  const f = fakeWindow(); let exit = -1;
  try {
    const receipt = await verify({ win: f.win, app: { exit(value: number) { exit = value; } }, privateRoot: join(tmpdir(), 'review-workspace-native-ac-rejected'), source: {}, moduleStarted: Date.now(), startupErrors: ['Synthetic observed startup shader error'] });
    assert.equal(receipt.passed, false); assert.match(receipt.error, /Observed startup/); assert.equal(receipt.actions.length, 0); assert.equal(f.events, 0); assert.equal(exit, 1); assert.equal(f.listeners.get('before-input-event')!.length, 0);
  } finally { process.argv = argv; }
});
test('existing workspace host entry delegates the explicit A/C option without running the normal-card journey', async () => {
  const argv = process.argv; process.argv = [...argv, '--verification-deadline-ms=30000', '--verify-library-templates'];
  const f = fakeWindow(); let exit = -1;
  try {
    const receipt = await require('./workspace-native.cjs').verify({ win: f.win, app: { exit(value: number) { exit = value; } }, privateRoot: join(tmpdir(), 'review-workspace-native-ac-delegation'), source: {}, moduleStarted: Date.now(), startupErrors: ['Synthetic observed startup error'] });
    assert.equal(receipt.contract, 'aerynth.library-template-evidence@1'); assert.equal(receipt.passed, false); assert.equal(receipt.actions.length, 0); assert.equal(exit, 1);
  } finally { process.argv = argv; }
});
test('schema-only A/C preparation creates no project/workspace/resource; real Core reopening and existing-profile refusal retain that empty state', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-library-empty-')), profile = join(dir, 'review-workspace-native-ac-source');
  t.after(() => { const part = relative(resolve(tmpdir()), resolve(dir)); assert(part.startsWith('aerynth-library-empty-') && !part.startsWith('..') && !isAbsolute(part)); rmSync(dir, { recursive: true, force: true }); });
  const seed = await prepareLibraryNative(profile); assert.deepEqual(seed.ordinaryCounts, { projects: 0, workspaces: 0, resources: 0 }); assert.equal(Object.keys(seed.hashes).length, 8);
  await assert.rejects(prepareLibraryNative(profile), /existing_profiles_must_be_preserved/);
  const core = new BackendCore({ path: join(profile, 'aerynth.sqlite'), privateRoot: profile, provider: 'codex', contentPolicy: 'local-private' });
  try { const state = await core.command('desktop', { type: 'snapshot' }); assert.deepEqual([state.projects.length, state.workspaces.length, state.resources.length, state.blocks.length], [0, 0, 0, 0]); assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0); }
  finally { await core.command('close', {}); }
});
