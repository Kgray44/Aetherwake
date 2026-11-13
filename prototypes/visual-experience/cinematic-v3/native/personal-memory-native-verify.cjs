const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const { app, BrowserWindow, safeStorage } = require('electron');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');
const { capturePersonalMemory } = require('./personal-memory-capture.cjs');
const { showVelaReview, isOwnedVelaReviewWindow } = require('./vela-review.cjs');

const root = realpathSync(process.argv[2]);
const mode = process.argv[3];
const headless = process.argv.includes('--headless-worker');
assert(['save', 'restore'].includes(mode));
const profile = join(root, 'electron-profile');
if (mode === 'save') {
  assert.equal(readdirSync(root).length, 0);
  mkdirSync(profile);
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const path = join(root, 'profile.sqlite');
const receiptPath = join(root, 'synthetic-receipt.json');
const text = 'Use the synthetic quartz relay for the next prototype.';
const factText = 'The next prototype uses the synthetic quartz relay.';

async function waitFor(read) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await pause(50);
  }
  throw Error('native_memory_window_timeout');
}

async function run() {
  const { Backend } = await import('../../../integrated-backend/src/service.mts');
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const { WorkspaceKernel } = await import('../../../workspace-kernel/kernel.mts');
  const { NativePersonalMemory } = await import('../../../integrated-backend/src/personal-memory.mts');
  const client = createNativeHostClient(wire => broker.handle(wire));
  const broker = createProtectedStorageBroker({
    safeStorage, isReady: () => app.isReady(), send: wire => client.handle(wire),
  });
  let backend = new Backend({ path, privateRoot: root, contentPolicy: 'local-private', provider: 'fixture' }, client.services);
  let parent;
  let stage = 'start';
  try {
    if (mode === 'restore') {
      stage = 'verify restored canonical source';
      const expected = JSON.parse(readFileSync(receiptPath, 'utf8'));
      assert.notEqual(expected.pid, process.pid);
      const preview = await backend.call('personalMemoryCapturePreviewNative', expected.input);
      assert.equal(preview.sourceText, text);
      assert.equal(preview.enableStorage, false);
      assert.equal(preview.policy.ordinaryEnabled, false);
      assert.equal(preview.policy.velaEnabled, false);
      await backend.call('personalMemoryCaptureCancelNative', { id: preview.id });
      await backend.close();
      backend = undefined;
      stage = 'decrypt restored reviewed fact';
      const kernel = WorkspaceKernel.openExisting(path);
      const source = preview.draft.source;
      const owner = new NativePersonalMemory({ kernel, secrets: client.services.secrets, host: {
        identity: () => ({ userId: 'local-owner', policyVersion: 'aerynth.local-owner@1' }),
        resolveScope: scope => ({ scope, version: preview.scopeProof.version }),
        resolveConversationSource: () => ({ ...source, projectId: null, role: 'user', sensitive: false }),
        authorize: input => input.operation === 'record.read' && input.subject?.id === expected.id
          ? { decision: 'allow', policyVersion: 'aerynth.local-owner@1', authorizationRef: 'synthetic-verify' }
          : { decision: 'deny' },
      } });
      try {
        const fact = (await owner.open()).readFact(expected.id);
        assert.equal(fact.text, factText);
        assert.deepEqual(fact.provenance, source);
      } finally { owner.close(); kernel.close(); }
      console.log(JSON.stringify({ result: 'pass', mode, electron: process.versions.electron, restoredFact: true, providerUseOff: true }));
      return;
    }
    stage = 'seed canonical conversation';
    const chat = await backend.call('createConversation', { title: 'Synthetic memory witness', commandId: 'chat' });
    const message = await backend.call('addMessage', { resourceId: chat.resourceId, role: 'user',
      content: text, expectedRevision: chat.revision, commandId: 'message' });
    const input = { conversationId: chat.resourceId, messageId: message.id, text: factText,
      scope: 'conversation', category: 'decisions', keywords: ['quartz', 'relay'] };
    stage = 'open isolated parent';
    if (!headless) {
      parent = new BrowserWindow({ width: 820, height: 630, show: false, webPreferences: { sandbox: true } });
      await parent.loadURL('data:text/html,<title>Aerynth synthetic memory check</title>');
      parent.show();
      parent.focus();
      await waitFor(() => parent.isFocused());
    }
    stage = 'review and save';
    let reviewed;
    const saved = await capturePersonalMemory({
      input, trustedFrame: () => headless || !parent.isDestroyed() && parent.isVisible(),
      // This fixture enters at the native capture adapter. The owned child
      // still requires real activation; renderer IPC admission is separate.
      observeGesture: () => true, allowWrite: async () => true,
      preview: value => backend.call('personalMemoryCapturePreviewNative', value),
      cancel: id => backend.call('personalMemoryCaptureCancelNative', { id }),
      commit: review => backend.call('personalMemoryCaptureCommitNative', review),
      async showReview(review) {
        reviewed = review;
        if (headless) {
          assert.equal(review.sourceText, text);
          assert.equal(review.draft.text, factText);
          return true;
        }
        parent.focus();
        await waitFor(() => parent.isFocused());
        const result = showVelaReview({ parent, review, expiresAt: review.expiresAt, experience: 'memory-capture' });
        const child = await waitFor(() => BrowserWindow.getAllWindows().find(win =>
          win.isFocused() && isOwnedVelaReviewWindow(win, parent)));
        const contents = await child.webContents.executeJavaScript(
          '({ text: [...document.querySelectorAll("pre")].map(x => x.textContent), bridge: typeof window.aerynthHost })');
        assert.deepEqual(contents, { text: [factText, text], bridge: 'undefined' });
        const point = await child.webContents.executeJavaScript(
          '(() => { const r = document.querySelector("#approve").getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()');
        child.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        for (const type of ['mouseDown', 'mouseUp'])
          child.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point });
        return result;
      },
    });
    assert.equal(saved.status, 'saved');
    await assert.rejects(backend.call('personalMemoryCaptureCommitNative', reviewed), /personal_memory_review_mismatch/);
    await backend.close();
    backend = undefined;
    assert(!readFileSync(path).includes(Buffer.from(factText)));
    writeFileSync(receiptPath, JSON.stringify({ input, id: saved.id, pid: process.pid }), { flag: 'wx' });
    console.log(JSON.stringify({ result: 'pass', mode, electron: process.versions.electron, nativeApproval: !headless, replayDenied: true }));
  } catch (error) {
    const code = /^[a-z][a-z0-9_]{1,79}$/u.test(error.message) ? error.message : error.code ?? error.name;
    console.error(JSON.stringify({ result: 'fail', mode, stage, error: code }));
    throw error;
  } finally {
    if (parent && !parent.isDestroyed()) parent.destroy();
    try { await backend?.close(); }
    finally { client.close(); broker.close(); }
  }
}

app.whenReady().then(run).then(() => app.exit(0), () => app.exit(1));
