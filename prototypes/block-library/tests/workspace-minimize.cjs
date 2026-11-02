const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { createGuard, options, captureAllowed, consoleHandler } = require('./library-native.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { expressions: x, preflight } = require('./workspace-minimize-expressions.cjs');
const q = JSON.stringify, digest = value => createHash('sha256').update(value).digest('hex');
exports.preflight = preflight;
exports.workspace = state => ({ blocks: state.blocks, viewport: state.viewport, organization: state.organization, presence: state.presence });
exports.independent = state => ({ ...exports.workspace(state), blocks: state.blocks.map(({ minimized, version, contentMode, ...block }) => block) });
exports.assertTransition = (before, after, id, minimized) => {
  assert.deepEqual(exports.independent(after), exports.independent(before), 'Exact saved geometry/camera/organization/presence');
  for (const field of ['resources', 'relationships', 'projects', 'workspaces', 'navigation', 'history', 'activeWorkspaceId']) assert.deepEqual(after[field], before[field], 'Retained ' + field);
  assert.equal(after.blocks.length, before.blocks.length);
  for (const block of before.blocks) {
    const current = after.blocks.find(b => b.id === block.id); assert(current);
    if (block.id === id) { assert.equal(current.minimized, minimized); assert.equal(current.version, block.version + 1); }
    else assert.deepEqual(current, block, 'Independent placement remains byte-exact');
  }
};
exports.selectCases = seed => {
  const selected = [seed.cases.find(c => c.kind === 'conversation'), seed.cases.find(c => c.kind === 'note'), seed.shapeCases.find(c => c.kind === 'reference' && c.shape === 'circle')];
  assert(selected.every(c => c?.workspaceId), 'existing_chat_note_circle_fixture_required');
  assert.equal(new Set(selected.map(c => c.workspaceId)).size, 3);
  assert(selected[2].blockId && selected[2].resourceId, 'existing_saved_circle_required');
  return selected.map(c => ({ ...c }));
};
/** A cold minimized controller may intentionally not exist after process start.
 * Durable data is checked first; only native Restore may activate/hydrate it.
 * Existing hydrated editors keep the full same-process retention assertions. */
exports.recoverEditor = async ({ entry, readDraft, probe, rememberEditor, restore, waitForText, sameNode, retainedEditor }) => {
  const canonicalDraft = async () => { if (entry.kind === 'conversation') assert.equal((await readDraft(entry.resourceId)).content, entry.editorValue, 'Exact persisted Chat draft, independent of controller activation'); };
  await canonicalDraft();
  const observed = await probe();
  if (observed.hydrated) { assert(observed.mounted); await rememberEditor(); }
  await restore();
  await waitForText();
  if (observed.mounted) assert.equal(await sameNode(), true, 'Restore retains any existing reopened editor node');
  let retained = null;
  if (observed.hydrated) {
    retained = await retainedEditor();
    assert(retained.sameNode && retained.sameText && retained.sameSelection && retained.scrollDelta <= 1, 'Restore retains an already hydrated editor');
  }
  await canonicalDraft();
  return { editorMountedBeforeRestore: observed.mounted, controllerHydratedBeforeRestore: observed.hydrated, sameExistingNode: observed.mounted ? true : null, checkpointTextMatches: true, retainedEditor: retained, hydration: observed.hydrated ? 'already hydrated' : 'explicit native Restore activation' };
};
/** Parent-owned native slot only. Existing host, fixture, guard and real controls.
 * No native IME is fabricated; source IME coverage remains a separate tier. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-minimize-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.workspace-minimize-evidence@1', syntheticOnly: true, source, passed: false, actions: [], checks: [], cases: [], screenshots: [], errors: [], limitations: ['Uses the existing synthetic 13-workspace preparer; Chat and Note placements are created through native Library input.', 'Fixture navigation and the 35% circle camera are explicit canonical preparation, never substitutes for native Minimize/Restore.', 'No provider execution, native IME simulation, scale/performance or owner artistic acceptance.'] };
  let guard, limits, consoleSource, failureProbe, failureShot;
  const consoleError = consoleHandler(receipt);
  const startup = () => { receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : -1; receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(e => String(e?.message ?? e).slice(0, 1000)) : ['Invalid startup errors']; };
  try {
    limits = options(process.argv, moduleStarted); receipt.limits = limits; guard = createGuard(win, limits);
    assert(/^review-workspace-native-/.test(path.basename(privateRoot)), 'dedicated_synthetic_profile_required');
    startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', consoleError);
    const readJson = async (name, bound) => { const file = path.join(privateRoot, name), stat = await guard.around(() => fs.stat(file)); assert(stat.size <= bound, 'minimize_json_bound_exceeded'); return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8'))); };
    const seed = await readJson('workspace-native-seed.json', 262144);
    assert.equal(seed.contract, 'aerynth.workspace-native@1'); assert.equal(seed.syntheticOnly, true); assert.equal(seed.cases.length, 10); assert.equal(seed.shapeCases.length, 3);
    assert(source?.hashes && typeof source.hashes === 'object' && !Array.isArray(source.hashes), 'host_source_identity_required');
    assert(Object.keys(seed.hashes).length > 0 && Object.keys(seed.hashes).length <= 8);
    for (const [name, hash] of Object.entries(seed.hashes)) {
      assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..'));
      assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name);
      if (source.hashes[name]) assert.equal(source.hashes[name], hash, 'Host source differs: ' + name);
    }
    receipt.preparationHashes = seed.hashes;
    receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename)));
    receipt.expressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-minimize-expressions.cjs'))));
    receipt.commonHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-approach-expressions.cjs'))));
    receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs')))); receipt.preflight = preflight();
    assert.deepEqual(seed.minimizeValidation, { preflightSha256: receipt.preflight.sha256, helperSha256: receipt.helperSha256, expressionHelperSha256: receipt.expressionHelperSha256, commonHelperSha256: receipt.commonHelperSha256 }, 'Minimize source changed after preparation');
    const driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(compileExpression(code)));
    const wait = code => guard.around(() => driver.wait(compileExpression(code), Math.min(8000, Math.max(1, limits.deadlineAt - Date.now()))));
    const snapshot = () => guard.around(() => driver.snapshot());
    const execute = async command => { receipt.actions.push({ action: 'canonical fixture command', command }); return js(x.execute(command)); };
    const card = entry => '[data-block=' + q(entry.blockId) + ']';
    const editor = entry => card(entry) + (entry.kind === 'conversation' ? ' .cp-composer textarea' : ' textarea');
    const navigate = async entry => { await execute({ type: 'navigate', target: { kind: 'workspace', workspaceId: entry.workspaceId } }); await wait(x.activeWorkspace(entry.workspaceId)); };
    const click = async selector => { receipt.lastIntent = { action: 'native click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); };
    const key = (keyCode, modifiers = []) => { guard.input({ type: 'keyDown', keyCode, modifiers }); guard.input({ type: 'keyUp', keyCode, modifiers }); };
    const type = async (selector, value) => { await click(selector); key('A', ['control']); await guard.insertText(value); receipt.actions.push({ action: 'native text input', selector, value }); };
    const field = async (scope, label) => { const selector = await js(x.fieldPath(scope, label)); assert(selector, 'Actual labeled field missing: ' + label); return selector; };
    const select = async (selector, value) => { const index = await js(x.optionIndex(selector, value)); assert(index >= 0 && index <= 60, 'Supported native option required'); await click(selector); key('Home'); for (let n = 0; n < index; n++) key('Down'); key('Enter'); await wait(x.valueIs(selector, value)); receipt.actions.push({ action: 'native select', selector, value }); };
    const create = async entry => {
      await click('.aw-workspace-add'); await wait(x.exists('.aw-library input[aria-label="Search blocks"]'));
      await type('.aw-library input[aria-label="Search blocks"]', entry.kind === 'conversation' ? 'chat' : entry.kind);
      await click('.aw-library__list [data-block-kind=' + q(entry.kind) + ']'); await wait(x.exists('.aw-library__detail > form'));
      const scope = '.aw-library__detail > form'; await type(await field(scope, 'Title'), entry.title);
      if (entry.kind === 'conversation') await select(await field(scope, 'Conversation backend'), 'local');
      await click(scope + ' > button[type="submit"]'); await wait(x.absent('.aw-library'));
      const s = await snapshot(), resource = s.resources.find(r => r.title === entry.title), block = s.blocks.find(b => b.resource_id === resource?.id);
      assert(resource && block && resource.kind === entry.kind); if (entry.kind === 'conversation') assert.equal(resource.provider, 'local');
      entry.resourceId = resource.id; entry.blockId = block.id;
    };
    const settledPoint = async (selector, surface = false) => {
      receipt.lastIntent = { action: 'locate native target', selector, surface };
      const expression = surface ? x.surfacePoint(selector, selector.slice(0, selector.indexOf(' .card-kind-label'))) : x.point(selector);
      let previous; const end = Math.min(Date.now() + 2500, limits.deadlineAt);
      while (Date.now() < end) { const p = await js(expression); if (p && previous && Math.hypot(p.x - previous.x, p.y - previous.y) < .75) return p; previous = p; await guard.pause(80); }
      assert.fail('Settled unobstructed native target required: ' + selector);
    };
    const minimize = async entry => {
      const selector = card(entry) + ' .card-kind-label', p = await settledPoint(selector, true);
      guard.input({ type: 'mouseMove', ...p }); guard.input({ type: 'mouseDown', ...p, button: 'right', clickCount: 1 }); guard.input({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 });
      receipt.actions.push({ action: 'native card inspector', blockId: entry.blockId });
      await wait(x.enabled('dialog[open] #minimize-card')); await click('dialog[open] #minimize-card'); await wait(x.absent('dialog[open] #minimize-card')); await wait(x.minimized(entry.blockId, true));
    };
    const restore = async entry => { const selector = card(entry) + ' .aw-block-restore'; await settledPoint(selector); await click(selector); await wait(x.minimized(entry.blockId, false)); };
    const graphics = () => js(x.graphics());
    const shot = async (name, diagnostic = false) => {
      assert(receipt.screenshots.length < limits.maxScreenshots, 'native_capture_count_exceeded');
      const before = await graphics(); if (!diagnostic) await wait(x.drawsAfter(before.draws)); const health = await graphics(); assert(captureAllowed(health, diagnostic), 'Renderable actual frame required');
      const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes, 'native_capture_bytes_exceeded');
      await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' }));
      receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), priorDraws: before.draws, freshDraw: health.draws > before.draws, diagnostic, health });
    };
    failureProbe = async () => ({ graphics: await graphics(), context: await js(x.failureContext()), target: await js(x.targetDiagnostics(receipt.lastIntent?.selector ?? '')) }); failureShot = () => shot('native-minimize-failure', true);
    const noExecution = async () => assert.deepEqual(await js(x.host('executionStatus', {})), []);
    const cp = (name, input) => js(x.host('conversation', { name, input }));
    await wait(x.ready()); await noExecution();
    if (limits.restore) {
      receipt.phase = 'separate-process minimized state restoration';
      const expected = await readJson('workspace-minimize-expected.json', limits.maxCheckpointBytes);
      assert.equal(expected.contract, 'aerynth.workspace-minimize-checkpoint@1'); assert.equal(expected.cases.length, 3);
      assert.equal((await snapshot()).activeWorkspaceId, expected.activeWorkspaceId); assert.deepEqual((await snapshot()).resources, expected.resources); assert.deepEqual((await snapshot()).relationships, expected.relationships);
      for (const entry of expected.cases) {
        await navigate(entry); const selector = card(entry), input = editor(entry); receipt.activeCase = { kind: entry.kind, blockId: entry.blockId };
        assert.deepEqual(exports.workspace(await snapshot()), expected.workspaces[entry.workspaceId]); await wait(x.shrunk(selector, entry.workingPose));
        if (entry.kind === 'conversation') assert.equal(entry.editorValue, expected.chatDraft);
        const before = await snapshot(); receipt.activeCase.minimizedPose = await js(x.pose(selector));
        if (entry.shape === 'circle') { await settledPoint(selector + ' .aw-block-restore'); await shot('fresh-process-minimized-circle-restore'); }
        receipt.activeCase.editorRecovery = await exports.recoverEditor({
          entry,
          readDraft: resourceId => cp('readDraft', { resourceId }),
          probe: async () => {
            const mounted = await js(x.rememberNode(input)), controller = selector + (entry.kind === 'conversation' ? ' .cp-chat' : ' .working-content[data-document-kind]');
            return { mounted, hydrated: mounted && await js(x.exists(controller)) && await js(x.valueIs(input, entry.editorValue)) };
          },
          rememberEditor: () => js(x.rememberEditor(input)),
          restore: async () => { await restore(entry); await wait(x.restoredSize(selector, entry.workingPose)); if (entry.kind !== 'reference') await wait(x.composition(selector, 'working')); },
          waitForText: async () => { await wait(x.valueIs(input, entry.editorValue)); if (entry.kind === 'conversation') await wait(x.exists(selector + ' .cp-chat[data-resource-id=' + q(entry.resourceId) + ']')); },
          sameNode: () => js(x.sameNode(input)),
          retainedEditor: () => js(x.retainedEditor(input)),
        });
        const after = await snapshot(); exports.assertTransition(before, after, entry.blockId, false);
        receipt.cases.push({ ...receipt.activeCase, restored: true }); delete receipt.activeCase;
      }
      receipt.checks.push('Separate process restores exact minimized flags/geometry/content/draft/camera; actual native Restore activates a cold controller and hydrates exact persisted text without input replay, retaining any existing editor and full state of already hydrated controllers');
    } else {
      receipt.phase = 'native inspector Minimize and header Restore'; const cases = exports.selectCases(seed), workspaces = {};
      let chatDraft;
      for (const entry of cases) {
        await navigate(entry); if (!entry.blockId) await create(entry);
        const selector = card(entry), input = editor(entry); receipt.activeCase = { kind: entry.kind, shape: entry.shape ?? 'default', blockId: entry.blockId, resourceId: entry.resourceId };
        if (entry.kind !== 'reference') {
          const ready = await snapshot(), block = ready.blocks.find(b => b.id === entry.blockId);
          await wait(x.restoredSize(selector, { width: block.width * ready.viewport.zoom, height: block.height * ready.viewport.zoom }));
          if (entry.kind === 'note') {
            const observed = await js(x.documentMode(selector)); receipt.activeCase.documentBeforeEdit = observed;
            assert(['write', 'read'].includes(observed.mode) && !observed.editorDisabled, 'A real enabled Note mode is required');
            if (observed.mode === 'read') await click(selector + ' .aw-note-tools button[aria-label="Edit document"]');
            await wait(x.point(input));
          }
          const value = Array.from({ length: 40 }, (_, n) => 'Synthetic retained ' + entry.kind + ' line ' + (n + 1)).join('\n');
          await type(input, value); if (entry.kind === 'conversation') { chatDraft = value; await wait(x.draftIs(entry.resourceId, value)); } else await wait(x.noteAndEditorText(input, entry.resourceId, value));
          key('Home'); for (let n = 0; n < 3; n++) key('Right', ['shift']);
          receipt.activeCase.editorNativeSelection = true;
        } else {
          const block = (await snapshot()).blocks.find(b => b.id === entry.blockId); assert(block && block.shape === 'circle');
          await execute({ type: 'setViewport', workspaceId: entry.workspaceId, viewport: { x: block.x - 120 / .35, y: block.y - 220 / .35, zoom: .35 } });
        }
        const baseline = await snapshot(), placement = baseline.blocks.find(b => b.id === entry.blockId);
        await wait(x.restoredSize(selector, { width: placement.width * baseline.viewport.zoom, height: placement.height * baseline.viewport.zoom }));
        const bookmark = await js(x.rememberEditor(input)); entry.editorValue = bookmark.value; receipt.activeCase.editorBefore = bookmark;
        // Inspector focus ends writing's GPU pause through real native input.
        entry.workingPose = await js(x.pose(selector)); const before = await snapshot();
        await minimize(entry); await wait(x.shrunk(selector, entry.workingPose));
        receipt.activeCase.minimizedPose = await js(x.pose(selector));
        const minimizedState = await snapshot(); exports.assertTransition(before, minimizedState, entry.blockId, true);
        receipt.activeCase.retainedWhileMinimized = await js(x.retainedEditor(input));
        assert(receipt.activeCase.retainedWhileMinimized.sameNode && receipt.activeCase.retainedWhileMinimized.sameText && receipt.activeCase.retainedWhileMinimized.sameSelection && receipt.activeCase.retainedWhileMinimized.scrollDelta <= 1, 'Minimize retains editor node/text/caret/scroll');
        if (entry.shape === 'circle') { await settledPoint(selector + ' .aw-block-restore'); await shot('tiny-minimized-circle-native-restore'); }
        await restore(entry); await wait(x.restoredSize(selector, entry.workingPose));
        if (entry.kind !== 'reference') await wait(x.composition(selector, 'working'));
        const after = await snapshot(); exports.assertTransition(minimizedState, after, entry.blockId, false);
        receipt.activeCase.retainedAfterRestore = await js(x.retainedEditor(input)); assert(receipt.activeCase.retainedAfterRestore.sameNode && receipt.activeCase.retainedAfterRestore.sameText && receipt.activeCase.retainedAfterRestore.sameSelection && receipt.activeCase.retainedAfterRestore.scrollDelta <= 1, 'Restore retains editor node/text/caret/scroll');
        if (entry.kind === 'conversation') assert.equal((await cp('readDraft', { resourceId: entry.resourceId })).content, chatDraft);
        await minimize(entry); await wait(x.shrunk(selector, entry.workingPose)); const finalMinimized = await snapshot(); exports.assertTransition(after, finalMinimized, entry.blockId, true); workspaces[entry.workspaceId] = exports.workspace(finalMinimized);
        receipt.cases.push(receipt.activeCase); delete receipt.activeCase;
      }
      const final = await snapshot(), checkpoint = { contract: 'aerynth.workspace-minimize-checkpoint@1', cases, workspaces, resources: final.resources, relationships: final.relationships, activeWorkspaceId: final.activeWorkspaceId, chatDraft };
      const bytes = Buffer.from(JSON.stringify(checkpoint)); assert(bytes.length <= limits.maxCheckpointBytes, 'minimize_checkpoint_bytes_exceeded'); await guard.around(() => fs.writeFile(path.join(privateRoot, 'workspace-minimize-expected.json'), bytes, { flag: 'wx' }));
      receipt.checks.push('Actual inspector Minimize/header Restore for Chat, Note and 35% saved-circle Reference physically shrink retained controllers without canonical geometry/camera/content/draft changes; all three finish canonically minimized for restart');
    }
    await noExecution(); receipt.finalGraphics = await graphics(); assert(captureAllowed(receipt.finalGraphics)); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0); receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 12000);
    if (failureProbe) try { receipt.failureState = await failureProbe(); } catch (e) { receipt.failureStateUnavailable = String(e?.message ?? e).slice(0, 1000); }
    if (failureShot && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await failureShot(); } catch (e) { receipt.failureCaptureUnavailable = String(e?.message ?? e).slice(0, 1000); }
  } finally {
    startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false; receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    try { consoleSource?.removeListener('console-message', consoleError); guard?.dispose(); } catch (e) { receipt.passed = false; receipt.cleanupError = String(e?.message ?? e).slice(0, 1000); }
    try { const bytes = Buffer.from(JSON.stringify(receipt, null, 2)); assert(bytes.length <= (limits?.maxJsonBytes ?? 524288), 'minimize_receipt_bytes_exceeded'); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'workspace-minimize.json'), bytes, { flag: 'wx' }); }
    catch (e) { receipt.passed = false; receipt.error = String(e?.message ?? e).slice(0, 1000); }
    finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } }
  }
  return receipt;
};
