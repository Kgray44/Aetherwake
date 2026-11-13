const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const { createMemoryReviewGuard, memoryWitnessDeadline, memoryWitnessRoot, claimMemoryWitnessPhase } = require('./personal-memory-review-guard.cjs');

const mode = process.argv[3];
assert(['save', 'restore'].includes(mode));
let deadline, root;
try {
  // The supervising process supplies the allocation, after central handoff.
  const admission = JSON.parse(process.env.AERYNTH_MEMORY_WITNESS_ADMISSION ?? 'null');
  deadline = memoryWitnessDeadline(admission, mode);
  root = memoryWitnessRoot(admission, process.argv[2]);
} catch {
  console.error(JSON.stringify({ result: 'fail', mode, error: 'native_memory_admission_required' }));
  process.exitCode = 1;
  return;
}
const drive = root[0].toUpperCase();
assert(['C', 'D'].includes(drive));
function allowWrite() {
  if (performance.now() >= deadline - 3000) return false;
  const result = spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', join(process.env.LOCALAPPDATA, 'AeroStorageWatch/ReserveGuard.ps1'),
      '-EstimatedCBytes', drive === 'C' ? '268435456' : '0', '-EstimatedDBytes', drive === 'D' ? '268435456' : '0'],
    { windowsHide: true, timeout: Math.max(1, Math.min(3000, Math.floor(deadline - 3000 - performance.now()))),
      encoding: 'utf8', maxBuffer: 8192 });
  try { return result.status === 0 && JSON.parse(result.stdout).allowed === true && performance.now() < deadline - 3000; }
  catch { return false; }
}
assert(allowWrite(), 'storage_reserve_admission_denied');
const profile = join(root, 'electron-profile');
if (mode === 'save') assert.equal(readdirSync(root).length, 0);
else readFileSync(join(root, 'synthetic-receipt.json'));
claimMemoryWitnessPhase(root, mode);
const { app, BrowserWindow, safeStorage } = require('electron');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');
const { capturePersonalMemory } = require('./personal-memory-capture.cjs');
const { showVelaReview, isOwnedVelaReviewWindow } = require('./vela-review.cjs');
if (mode === 'save') mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const path = join(root, 'profile.sqlite');
const receiptPath = join(root, 'synthetic-receipt.json');
const text = 'Use the synthetic quartz relay for the next prototype.';
const factText = 'The next prototype uses the synthetic quartz relay.';

async function waitFor(read) {
  const end = Math.min(deadline - 3000, performance.now() + 10000);
  while (performance.now() < end) {
    const value = await read();
    if (value) return value;
    await pause(50);
  }
  throw Error('native_memory_window_timeout');
}

async function run() {
  const { Backend } = await import('../../../integrated-backend/src/service.mts');
  const { BackendCore } = await import('../../../integrated-backend/src/core.mts');
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const client = createNativeHostClient(wire => broker.handle(wire));
  const broker = createProtectedStorageBroker({
    safeStorage, isReady: () => app.isReady(), send: wire => client.handle(wire),
  });
  const startBackend = () => new Backend({ path, privateRoot: root, contentPolicy: 'local-private', provider: 'fixture' }, client.services);
  async function withLocalRecall(expected, check) {
    assert(allowWrite(), 'storage_reserve_admission_denied');
    const local = new BackendCore({ path, privateRoot: root, contentPolicy: 'local-private', provider: 'fixture' }, undefined, client.services);
    try {
      const vela = await local.command('vela', { name: 'open', input: {} });
      const conversationId = vela.conversation.resourceId;
      assert.notEqual(conversationId, expected.input.conversationId);
      await local.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: expected.workspaceId } });
      const policy = await local.command('personalMemoryPolicyNative', {});
      assert.equal(policy.velaEnabled, false);
      await local.command('personalMemoryPolicyNative', { assistant: 'vela', enable: true, expectedVersion: policy.version });
      try {
        const query = { conversationId, projectId: expected.projectId, requestId: 'synthetic-memory-restore',
          intent: 'Which quartz relay?', prompt: 'Synthetic local recall only.' };
        const recall = await local.personalMemoryReview.prepareVelaRecall(query);
        try { check(recall); } finally { recall?.revoke(); }
        const activity = await local.command('providerActivity', {});
        assert.equal(activity.providerRequests, 0);
        assert.equal(activity.codexConnections, 0);
      } finally {
        const current = await local.command('personalMemoryPolicyNative', {});
        await local.command('personalMemoryPolicyNative', { assistant: 'vela', enable: false, expectedVersion: current.version });
      }
    } finally { await local.command('close', {}); }
  }
  let backend = startBackend();
  let parent;
  let stopObservingFocus;
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
      stage = 'read restored fact through the canonical worker';
      const read = { type: 'read', id: expected.id };
      const fact = await backend.call('personalMemoryManagementNative', read);
      assert.equal(fact.text, factText);
      assert.deepEqual(fact.provenance, preview.draft.source);
      stage = 'recall in a second chat through the local owner';
      await backend.close();
      backend = undefined;
      await withLocalRecall(expected, recall => {
        assert.ok(recall);
        const data = JSON.parse(recall.prompt.slice(recall.prompt.lastIndexOf('\n') + 1));
        assert.deepEqual(data.items.map(item => [item.factId, item.provenance.messageId]), [[fact.id, expected.input.messageId]]);
        assert.throws(() => recall.validate(recall.prompt), /personal_memory_disclosure_review_required/);
      });
      backend = startBackend();
      stage = 'revoke the exact restored source';
      const revoke = await backend.call('personalMemoryManagementNative', {
        type: 'previewSourceRevocation', id: fact.id, version: fact.version,
      });
      assert.equal(revoke.sourceText, text);
      const { conversationId, messageId } = expected.input;
      assert.equal(revoke.binding.conversationId, conversationId);
      assert.equal(revoke.binding.messageId, messageId);
      const result = await backend.call('personalMemoryRevokeSourceNative', revoke.binding);
      assert.deepEqual(result, { revision: revoke.binding.expectedRevision + 1, erasedFacts: 1 });
      await backend.close();
      backend = undefined;
      stage = 'verify revocation after worker restart';
      backend = startBackend();
      await assert.rejects(backend.call('personalMemoryManagementNative', read), /personal_record_unavailable/);
      const opened = await backend.call('openResource', { resourceId: conversationId, selection: { messageId } });
      assert.equal(opened.status, 'unavailable');
      await backend.close();
      backend = undefined;
      await withLocalRecall(expected, recall => assert.equal(recall, null));
      console.log(JSON.stringify({ result: 'pass', mode, electron: process.versions.electron,
        restoredFact: true, localCrossChatRecall: true, revokedLocalRecallDenied: true, providerUseOff: true, revokedSourceSurvivedWorkerRestart: true }));
      return;
    }
    stage = 'seed canonical conversation';
    const project = (await backend.call('desktop', { type: 'createProject', title: 'Synthetic memory project' })).projects[0];
    const workspace = (await backend.call('desktop', { type: 'createWorkspace', title: 'Synthetic memory workspace', projectId: project.id })).workspaces[0];
    const chat = await backend.call('createConversation', { title: 'Synthetic memory witness', commandId: 'chat' });
    await backend.call('conversation', { name: 'organize', input: {
      type: 'associateProject', resourceId: chat.resourceId, projectId: project.id, expectedVersion: 1,
    } });
    const detail = await backend.call('conversation', { name: 'detail', input: { resourceId: chat.resourceId } });
    const message = await backend.call('addMessage', { resourceId: chat.resourceId, role: 'user',
      content: text, expectedRevision: detail.conversation.revision, commandId: 'message' });
    const input = { conversationId: chat.resourceId, messageId: message.id, text: factText,
      scope: 'project', expectedProjectId: project.id, category: 'decisions', keywords: ['quartz', 'relay'] };
    stage = 'open isolated parent';
    parent = new BrowserWindow({ width: 820, height: 630, show: false, webPreferences: { sandbox: true } });
    await parent.loadURL('data:text/html,<title>Aerynth synthetic memory check</title><button>Review memory</button>');
    parent.show();
    await waitFor(() => parent.isFocused());
    const guard = createMemoryReviewGuard({ parent, focusedWindow: () => BrowserWindow.getFocusedWindow(),
      isOwned: isOwnedVelaReviewWindow, deadline: deadline - 3000 });
    const focusChanged = (_event, target) => guard.observeFocus(target);
    const parentBlurred = () => {
      // Let Electron finish transferring focus to the authenticated modal.
      setImmediate(() => { if (stopObservingFocus) guard.observeFocus(BrowserWindow.getFocusedWindow()); });
    };
    app.on('browser-window-focus', focusChanged);
    parent.on('blur', parentBlurred);
    stopObservingFocus = () => {
      app.removeListener('browser-window-focus', focusChanged);
      parent.removeListener('blur', parentBlurred);
      stopObservingFocus = undefined;
    };
    guard.checkParent();
    stage = 'review and save';
    let reviewed;
    const saved = await capturePersonalMemory({
      input, trustedFrame: () => !parent.isDestroyed() && parent.isVisible(),
      observeGesture: () => parent.isFocused(), allowWrite,
      preview: value => backend.call('personalMemoryCapturePreviewNative', value),
      cancel: id => backend.call('personalMemoryCaptureCancelNative', { id }),
      commit: review => {
        guard.checkParent();
        return backend.call('personalMemoryCaptureCommitNative', review);
      },
      async showReview(review) {
        guard.checkParent();
        reviewed = review;
        const result = showVelaReview({ parent, review, expiresAt: review.expiresAt, experience: 'memory-capture' });
        const child = await waitFor(() => BrowserWindow.getAllWindows().find(win =>
          win.isFocused() && isOwnedVelaReviewWindow(win, parent)));
        const contents = await child.webContents.executeJavaScript(
          '({ text: [...document.querySelectorAll("pre")].map(x => x.textContent), bridge: typeof window.aerynthHost })');
        assert.deepEqual(contents, { text: [factText, text], bridge: 'undefined' });
        const point = await child.webContents.executeJavaScript(
          '(() => { const r = document.querySelector("#approve").getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()');
        guard.checkReview(child);
        child.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        for (const type of ['mouseDown', 'mouseUp']) {
          guard.checkReview(child);
          child.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point });
        }
        return result;
      },
    });
    assert.equal(saved.status, 'saved');
    await assert.rejects(backend.call('personalMemoryCaptureCommitNative', reviewed), /personal_memory_review_mismatch/);
    await backend.close();
    backend = undefined;
    assert(!readFileSync(path).includes(Buffer.from(factText)));
    writeFileSync(receiptPath, JSON.stringify({ input, id: saved.id, workspaceId: workspace.id, projectId: project.id, pid: process.pid }), { flag: 'wx' });
    console.log(JSON.stringify({ result: 'pass', mode, electron: process.versions.electron, nativeApproval: true, replayDenied: true }));
  } catch (error) {
    const code = /^[a-z][a-z0-9_]{1,79}$/u.test(error.message) ? error.message : error.code ?? error.name;
    console.error(JSON.stringify({ result: 'fail', mode, stage, error: code }));
    throw error;
  } finally {
    stopObservingFocus?.();
    if (parent && !parent.isDestroyed()) parent.destroy();
    try { await backend?.close(); }
    finally { client.close(); broker.close(); }
  }
}

const watchdog = setTimeout(() => {
  console.error(JSON.stringify({ result: 'fail', mode, error: 'native_memory_hard_deadline' }));
  app.exit(1);
}, Math.max(1, deadline - performance.now()));
app.whenReady().then(run).then(
  () => { clearTimeout(watchdog); app.exit(0); },
  () => { clearTimeout(watchdog); app.exit(1); },
);
