const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { createGuard, options, captureAllowed, consoleHandler } = require('./library-native.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { expressions: x, preflight } = require('./workspace-approach-expressions.cjs');
const q = JSON.stringify, digest = value => createHash('sha256').update(value).digest('hex');
exports.preflight = preflight;
exports.placementState = state => ({ blocks: state.blocks, organization: state.organization, presence: state.presence });
exports.workspaceState = state => ({ ...exports.placementState(state), viewport: state.viewport });
/** Task-group member status is a live projection of its canonical Task, not a
 * second mutation. Preserve all group fields, membership IDs/order and titles. */
exports.assertResourceEffects = (before, after, effects) => {
  assert.deepEqual(after.map(item => item.id), before.map(item => item.id), 'Exact canonical resource identities');
  for (const resource of before) {
    const actual = after.find(item => item.id === resource.id), effect = effects.get(resource.id);
    let expected = effect ? { ...resource, ...effect, version: actual.version } : resource;
    if (effect) assert(actual.version > resource.version, 'Native edit/status must advance its canonical resource version');
    if (resource.taskMembers) expected = { ...expected, taskMembers: resource.taskMembers.map(member => effects.has(member.id) && Object.hasOwn(effects.get(member.id), 'taskStatus') ? { ...member, status: effects.get(member.id).taskStatus } : member) };
    assert.deepEqual(actual, expected, 'Only intended canonical effects and derived member status: ' + resource.id);
  }
};
exports.selectCases = seed => {
  const selected = [seed.cases.find(item => item.kind === 'research'), seed.shapeCases.find(item => item.shape === 'pill' && item.kind === 'task'), seed.shapeCases.find(item => item.shape === 'circle' && item.kind === 'reference')];
  assert(selected.every(item => item?.workspaceId && item.blockId && item.resourceId), 'existing_research_pill_circle_fixture_required');
  assert.equal(new Set(selected.map(item => item.workspaceId)).size, 3);
  return selected;
};

/** Explicit mode of the existing workspace-native host entry and 13-workspace
 * fixture. Parent owns the native slot. No new App/IPC/fixture implementation. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-approach-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.workspace-approach-evidence@1', syntheticOnly: true, source, passed: false, actions: [], checks: [], cases: [], screenshots: [], errors: [], limitations: ['Uses the existing synthetic 10-kind/3-shape preparer, not native creation.', 'Canonical navigation and tiny viewport setup are logged fixture commands; Approach, editing, task toggle, Return, Open and Back use actual native input.', 'Does not replace the normal 10-kind/3-shape journey, qualify performance or establish owner artistic acceptance.'] };
  let guard, limits, consoleSource, failureProbe, failureShot;
  const consoleError = consoleHandler(receipt);
  const startup = () => { receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : -1; receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(value => String(value?.message ?? value).slice(0, 1000)) : ['Invalid startup errors']; };
  try {
    limits = options(process.argv, moduleStarted); receipt.limits = limits;
    guard = createGuard(win, limits);
    assert(/^review-workspace-native-/.test(path.basename(privateRoot)), 'dedicated_synthetic_profile_required');
    startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', consoleError);
    const readJson = async (name, bound) => { const file = path.join(privateRoot, name), stat = await guard.around(() => fs.stat(file)); assert(stat.size <= bound, 'approach_json_bound_exceeded'); return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8'))); };
    const seed = await readJson('workspace-native-seed.json', 262144);
    assert(!seed.relatedCase, 'ordinary_fixture_required_not_recovery_specialization');
    assert.equal(seed.contract, 'aerynth.workspace-native@1'); assert.equal(seed.syntheticOnly, true); assert.equal(seed.cases.length, 10); assert.equal(seed.shapeCases.length, 3);
    const cases = exports.selectCases(seed);
    assert(source?.hashes && typeof source.hashes === 'object', 'host_source_identity_required');
    assert(Object.keys(seed.hashes).length > 0 && Object.keys(seed.hashes).length <= 8);
    for (const [name, hash] of Object.entries(seed.hashes)) {
      assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..'));
      assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name);
      if (source.hashes[name]) assert.equal(source.hashes[name], hash, 'Host source differs: ' + name);
    }
    receipt.preparationHashes = seed.hashes;
    receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename)));
    receipt.expressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-approach-expressions.cjs'))));
    receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs'))));
    receipt.preflight = preflight();
    receipt.commonExpressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./library-native-expressions.cjs'))));
    assert.deepEqual(seed.approachValidation, { preflightSha256: receipt.preflight.sha256, expressionHelperSha256: receipt.expressionHelperSha256, commonHelperSha256: receipt.commonExpressionHelperSha256 }, 'Approach expression source changed after preparation');
    const driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(compileExpression(code)));
    const wait = code => guard.around(() => driver.wait(compileExpression(code), Math.min(8000, Math.max(1, limits.deadlineAt - Date.now()))));
    const snapshot = () => guard.around(() => driver.snapshot());
    const execute = async command => { receipt.actions.push({ action: 'canonical fixture command', command }); return js(x.execute(command)); };
    const click = async selector => { receipt.lastIntent = { action: 'native click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); };
    const key = (keyCode, modifiers = []) => { guard.input({ type: 'keyDown', keyCode, modifiers }); guard.input({ type: 'keyUp', keyCode, modifiers }); };
    const card = entry => '[data-block=' + q(entry.blockId) + ']';
    const navigate = async entry => { await execute({ type: 'navigate', target: { kind: 'workspace', workspaceId: entry.workspaceId } }); await wait(x.activeWorkspace(entry.workspaceId)); };
    const graphics = () => js(x.graphics());
    const shot = async (name, diagnostic = false) => {
      assert(receipt.screenshots.length < limits.maxScreenshots, 'native_capture_count_exceeded');
      const before = await graphics(); if (!diagnostic) await wait(x.drawsAfter(before.draws)); const health = await graphics(); assert(captureAllowed(health, diagnostic), 'Renderable actual frame required');
      const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes, 'native_capture_bytes_exceeded');
      await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' }));
      receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), priorDraws: before.draws, freshDraw: health.draws > before.draws, diagnostic, health });
    };
    failureProbe = async () => ({ graphics: await graphics(), context: await js(x.failureContext()), editor: await js(x.editorMetrics(card(cases[0]) + ' textarea')), cards: await Promise.all(cases.map(entry => js(x.dom(card(entry))))) });
    failureShot = () => shot('native-approach-failure', true);
    const noExecution = async () => assert.deepEqual(await js(x.host('executionStatus', {})), []);
    await wait(x.ready()); await noExecution();
    if (limits.restore) {
      receipt.phase = 'separate-process Approach restoration';
      const expected = await readJson('workspace-approach-expected.json', limits.maxCheckpointBytes);
      assert.equal(expected.contract, 'aerynth.workspace-approach-checkpoint@1');
      assert.equal((await snapshot()).activeWorkspaceId, expected.activeWorkspaceId, 'Saved active workspace restores before navigation');
      assert.deepEqual((await snapshot()).resources, expected.resources); assert.deepEqual((await snapshot()).relationships, expected.relationships);
      for (const entry of cases) {
        await navigate(entry); assert.deepEqual(exports.workspaceState(await snapshot()), expected.workspaces[entry.workspaceId]);
        await wait(x.composition(card(entry), 'overview'));
        if (entry.kind === 'research') assert.equal(await js(x.valueIs(card(entry) + ' textarea', expected.researchText)), true);
        if (entry.kind === 'task') assert.equal(await js(x.checked(card(entry) + ' .task-completed', true)), true);
        receipt.cases.push({ kind: entry.kind, shape: entry.shape ?? 'default', restored: true, dom: await js(x.dom(card(entry))) });
      }
      await navigate(cases.find(entry => entry.workspaceId === expected.activeWorkspaceId));
      await shot('restored-tiny-workspace');
      receipt.checks.push('Fresh process restores exact saved tiny viewports, placement identities/geometry, edited Research and checked Task without replay');
    } else {
      receipt.phase = 'native Approach, primary controls and exact Return';
      const initial = await snapshot(); assert.deepEqual(initial.resources, seed.expected.resources, 'Fresh preparer state, not an already consumed profile');
      const expectedWorkspaces = {}, resourceEffects = new Map();
      const researchText = '# Synthetic native Approach edit\n' + Array.from({ length: 40 }, (_, n) => 'Retained research line ' + String(n + 1).padStart(2, '0')).join('\n');
      for (const entry of cases) {
        await navigate(entry); const selector = card(entry), original = await snapshot(), block = original.blocks.find(item => item.id === entry.blockId); assert(block);
        const tinyView = { x: block.x - 120 / .35, y: block.y - 220 / .35, zoom: .35 };
        await execute({ type: 'setViewport', workspaceId: entry.workspaceId, viewport: tinyView });
        await wait(x.composition(selector, 'overview'));
        const tiny = await snapshot(); assert.deepEqual(exports.placementState(tiny), exports.placementState(original), 'Fixture camera must not resize/move/rebind a placement');
        const primary = selector + ' .aw-block-approach[aria-label^="Approach "]', open = selector + ' .unfold';
        assert(await js(x.point(primary)), 'Tiny header Approach must be unobstructed'); assert(await js(x.point(open)), 'Tiny header Open fallback must remain unobstructed');
        const input = selector + (entry.kind === 'task' ? ' .task-completed' : ' textarea');
        assert(await js(x.rememberNode(input)), 'Existing editor/control node required');
        const result = { kind: entry.kind, shape: entry.shape ?? 'default', blockId: entry.blockId, resourceId: entry.resourceId, tiny: await js(x.dom(selector)), viewportBefore: tiny.viewport };
        receipt.activeCase = result;
        if (entry.kind === 'research') await shot('tiny-research-with-approach');
        await click(primary); await wait(x.composition(selector, 'working')); await wait(x.expanded(selector, false));
        const approached = await snapshot(); assert(approached.viewport.zoom > tiny.viewport.zoom, 'Native Approach must increase usable footprint'); assert.deepEqual(exports.placementState(approached), exports.placementState(tiny));
        assert.equal(await js(x.sameNode(input)), true, 'Approach retains the original editor/control node'); result.working = await js(x.dom(selector)); result.viewportApproached = approached.viewport;
        if (entry.kind === 'research') {
          await click(selector + ' .aw-note-tools button[aria-label="Edit document"]'); await click(input); key('A', ['control']); await guard.insertText(researchText);
          receipt.actions.push({ action: 'native Research text input', text: researchText }); await wait(x.resourceTextIs(entry.resourceId, researchText));
          key('Home'); for (let n = 0; n < 3; n++) key('Right', ['shift']);
          result.editorBeforeReturn = await js(x.rememberEditor(input)); assert(result.editorBeforeReturn.end - result.editorBeforeReturn.start === 3, 'Native selection required');
          result.editorBeforeTab = result.editorBeforeReturn.metrics;
          resourceEffects.set(entry.resourceId, { content: researchText });
          // Native Tab leaves writing's intentional GPU pause without changing the text/caret.
          key('Tab'); receipt.actions.push({ action: 'native Tab leaves editor for live-frame capture' });
          result.editorAfterTab = await js(x.editorMetrics(input));
          await shot('approached-research-editing');
        } else if (entry.kind === 'task') {
          assert.equal(original.resources.find(item => item.id === entry.resourceId).taskStatus, 'open', 'Fresh Task toggle may happen once');
          await click(input); await wait(x.taskStatusIs(entry.resourceId, 'done')); resourceEffects.set(entry.resourceId, { taskStatus: 'done' });
        }
        if (entry.kind === 'research') result.editorImmediatelyBeforeReturn = await js(x.editorMetrics(input));
        await click(selector + ' .aw-block-approach[aria-label="Return to previous view"]'); await wait(x.composition(selector, 'overview'));
        if (entry.kind === 'research') result.editorAfterReturn = await js(x.editorMetrics(input));
        const returned = await snapshot(); assert.deepEqual(exports.workspaceState(returned), exports.workspaceState(tiny), 'Return restores exact viewport without changing saved geometry/organization/presence');
        assert.equal(await js(x.sameNode(input)), true);
        if (entry.kind === 'research') { result.retainedEditor = await js(x.retainedEditor(input)); assert.equal(result.retainedEditor.sameNode, true); assert.equal(result.retainedEditor.sameText, true); assert.equal(result.retainedEditor.sameSelection, true); assert(result.retainedEditor.scrollDelta <= 1, 'Return retains editor scroll'); }
        if (entry.kind === 'task') assert.equal(await js(x.checked(input, true)), true);
        if (entry.kind === 'reference') {
          await click(open); await wait(x.expanded(selector, true)); await wait(x.composition(selector, 'working')); assert.equal(await js(x.sameNode(input)), true);
          await click(open); await wait(x.expanded(selector, false)); await wait(x.composition(selector, 'overview'));
          assert.deepEqual(exports.workspaceState(await snapshot()), exports.workspaceState(tiny), 'Native Open/Back fallback preserves the tiny workspace exactly'); result.openBackFallback = true;
        }
        expectedWorkspaces[entry.workspaceId] = exports.workspaceState(await snapshot()); result.returned = await js(x.dom(selector)); receipt.cases.push(result); delete receipt.activeCase;
      }
      const final = await snapshot(); exports.assertResourceEffects(initial.resources, final.resources, resourceEffects); assert.deepEqual(final.relationships, initial.relationships);
      const checkpoint = { contract: 'aerynth.workspace-approach-checkpoint@1', resources: final.resources, relationships: final.relationships, workspaces: expectedWorkspaces, activeWorkspaceId: final.activeWorkspaceId, researchText };
      const encoded = Buffer.from(JSON.stringify(checkpoint)); assert(encoded.length <= limits.maxCheckpointBytes, 'approach_checkpoint_bytes_exceeded'); await guard.around(() => fs.writeFile(path.join(privateRoot, 'workspace-approach-expected.json'), encoded, { flag: 'wx' }));
      receipt.checks.push('Native Approach/Return preserves identities and exact saved geometry/camera for Research, saved pill Task and saved circle Reference', 'Research editor text/node/caret/scroll retained; native Task change is canonical; native circle Open/Back fallback remains reachable');
    }
    await noExecution(); receipt.finalGraphics = await graphics(); assert(captureAllowed(receipt.finalGraphics)); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0); receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 12000);
    if (failureProbe) try { receipt.failureState = await failureProbe(); } catch (error) { receipt.failureStateUnavailable = String(error?.message ?? error).slice(0, 1000); }
    if (failureShot && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await failureShot(); } catch (error) { receipt.failureCaptureUnavailable = String(error?.message ?? error).slice(0, 1000); }
  } finally {
    startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false;
    receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    try { consoleSource?.removeListener('console-message', consoleError); } catch (error) { receipt.passed = false; receipt.cleanupError = String(error?.message ?? error).slice(0, 1000); }
    try { guard?.dispose(); } catch (error) { receipt.passed = false; receipt.cleanupError = String(error?.message ?? error).slice(0, 1000); }
    try { const encoded = Buffer.from(JSON.stringify(receipt, null, 2)); assert(encoded.length <= (limits?.maxJsonBytes ?? 524288), 'approach_receipt_bytes_exceeded'); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'workspace-approach.json'), encoded, { flag: 'wx' }); }
    catch (error) { receipt.passed = false; receipt.error = String(error?.message ?? error).slice(0, 1000); }
    finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } }
  }
  return receipt;
};
