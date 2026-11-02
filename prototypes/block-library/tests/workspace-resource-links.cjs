const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { createGuard, options, captureAllowed, consoleHandler } = require('./library-native.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { expressions: x, preflight, panel } = require('./workspace-resource-links-expressions.cjs');
const q = JSON.stringify, digest = value => createHash('sha256').update(value).digest('hex');
exports.preflight = preflight;
exports.workspace = s => ({ blocks: s.blocks, viewport: s.viewport, organization: s.organization, presence: s.presence });
exports.canonical = s => ({ projects: s.projects, workspaces: s.workspaces, resources: s.resources });
exports.edges = edges => [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
exports.assertRecovery = (actual, expected) => { assert.deepEqual(actual, expected, 'Read-only links/navigation must not save, discard or change a separate recovery draft'); assert(expected.draft && expected.draft.content !== expected.resource.content, 'Distinct canonical and recovery text required'); };
exports.fixture = seed => {
  const f = seed.relatedCase; assert(f && seed.relatedValidation && f.note?.blockId && f.note?.resourceId && f.browser?.blockId && f.task?.resourceId, 'explicit_related_recovery_fixture_required');
  assert.notEqual(f.note.resourceId, f.task.resourceId); assert.equal(f.task.placements.length, 2);
  for (const id of [f.note.resourceId, f.task.resourceId]) { assert.equal(f.documents[id]?.resource.id, id); exports.assertRecovery(f.documents[id], f.documents[id]); }
  assert.equal(f.workspaces[f.note.workspaceId].blocks.find(b => b.id === f.note.blockId)?.resource_id, f.note.resourceId);
  return f;
};
exports.assertState = (state, baseline, workspaces, relationships) => {
  assert.deepEqual(exports.canonical(state), exports.canonical(baseline), 'Canonical IDs, content, versions and ownership remain exact');
  assert.deepEqual(exports.edges(state.relationships), exports.edges(relationships), 'Only the intended user edge changes; membership/provenance remain exact');
  assert(workspaces[state.activeWorkspaceId], 'Only prepared destinations are used');
  assert.deepEqual(exports.workspace(state), workspaces[state.activeWorkspaceId], 'Exact saved placement geometry, shape, camera, organization and Vela');
};

/** Existing host/preparer/guard only. All user links use actual controls and the
 * existing graphAction broker. No provider call, synthetic input event or store. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-resource-links-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.workspace-resource-links-evidence@1', syntheticOnly: true, source, passed: false, actions: [], checks: [], screenshots: [], errors: [], limitations: ['Existing thirteen-destination fixture explicitly prepares canonical Note/Task and two separate recovery drafts; this is not native resource creation.', 'Fixture navigation is logged separately from native document/browser actions, keyboard/search, link creation, target opening and removal.', 'No provider connection, model call, combined B/Codex qualification, wider D/E/F, scale/performance or owner artistic acceptance.'] };
  let guard, limits, consoleSource, failureProbe, failureShot;
  const consoleError = consoleHandler(receipt);
  const startup = () => { receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : -1; receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(e => String(e?.message ?? e).slice(0, 1000)) : ['Invalid startup errors']; };
  try {
    limits = options(process.argv, moduleStarted); receipt.limits = limits; guard = createGuard(win, limits);
    assert(/^review-workspace-native-/.test(path.basename(privateRoot)), 'dedicated_synthetic_profile_required'); startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', consoleError);
    const readJson = async (name, bound) => { const file = path.join(privateRoot, name), stat = await guard.around(() => fs.stat(file)); assert(stat.size <= bound, 'resource_links_json_bound_exceeded'); return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8'))); };
    const seed = await readJson('workspace-native-seed.json', 262144), fixture = exports.fixture(seed);
    assert.equal(seed.contract, 'aerynth.workspace-native@1'); assert.equal(seed.syntheticOnly, true); assert.equal(seed.cases.length, 10); assert.equal(seed.shapeCases.length, 3);
    assert(source?.hashes && typeof source.hashes === 'object' && !Array.isArray(source.hashes), 'host_source_identity_required'); assert(Object.keys(seed.hashes).length > 0 && Object.keys(seed.hashes).length <= 8);
    for (const [name, hash] of Object.entries(seed.hashes)) {
      assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..')); assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name);
      if (source.hashes[name]) assert.equal(source.hashes[name], hash, 'Host source differs: ' + name);
    }
    receipt.preparationHashes = seed.hashes; receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename)));
    receipt.expressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-resource-links-expressions.cjs')))); receipt.commonHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-approach-expressions.cjs'))));
    receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs')))); receipt.preflight = preflight();
    assert.deepEqual(seed.relatedValidation, { preflightSha256: receipt.preflight.sha256, helperSha256: receipt.helperSha256, expressionHelperSha256: receipt.expressionHelperSha256, commonHelperSha256: receipt.commonHelperSha256 }, 'Related-resource source changed after preparation');
    const driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(compileExpression(code))), wait = code => guard.around(() => driver.wait(compileExpression(code), Math.min(8000, Math.max(1, limits.deadlineAt - Date.now()))));
    const snapshot = () => guard.around(() => driver.snapshot());
    const navigate = async workspaceId => { const command = { type: 'navigate', target: { kind: 'workspace', workspaceId } }; receipt.actions.push({ action: 'canonical fixture navigation', command }); await js(x.execute(command)); await wait(x.activeWorkspace(workspaceId)); };
    const click = async selector => { receipt.lastIntent = { action: 'native click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); };
    const key = (keyCode, modifiers = []) => { guard.input({ type: 'keyDown', keyCode, modifiers }); guard.input({ type: 'keyUp', keyCode, modifiers }); receipt.actions.push({ action: 'native key', keyCode, modifiers }); };
    const type = async (selector, value) => { await click(selector); key('A', ['control']); await guard.insertText(value); receipt.actions.push({ action: 'native search input', selector, value }); };
    const button = async (scope, label) => { await wait(x.buttonExists(scope, label)); const selector = await js(x.buttonPath(scope, label)); assert(selector); await click(selector); };
    const select = async (selector, value) => { const index = await js(x.optionIndex(selector, value)); assert(index >= 0 && index <= 60, 'Supported native option required'); await click(selector); key('Home'); for (let n = 0; n < index; n++) key('Down'); key('Enter'); await wait(x.valueIs(selector, value)); receipt.actions.push({ action: 'native select', selector, value }); };
    const note = '[data-block=' + q(fixture.note.blockId) + ']', noteInput = note + ' textarea', search = panel + ' input[aria-label="Find related resources"]', target = panel + ' select[aria-label="Resource to link"]', kind = panel + ' select[aria-label="Relationship type"]';
    const document = async id => (await js(x.host('notes', { name: 'readNote', input: id }))).result;
    const recovery = async () => { for (const id of [fixture.note.resourceId, fixture.task.resourceId]) exports.assertRecovery(await document(id), fixture.documents[id]); };
    const verify = async relationships => { exports.assertState(await snapshot(), seed.expected, fixture.workspaces, relationships); await recovery(); };
    const noExecution = async () => assert.deepEqual(await js(x.host('executionStatus', {})), []);
    const graphics = () => js(x.graphics());
    const shot = async (name, diagnostic = false) => {
      assert(receipt.screenshots.length < limits.maxScreenshots, 'native_capture_count_exceeded'); const before = await graphics(); if (!diagnostic) await wait(x.drawsAfter(before.draws)); const health = await graphics(); assert(captureAllowed(health, diagnostic), 'Renderable actual frame required');
      const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes, 'native_capture_bytes_exceeded');
      await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' })); receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), priorDraws: before.draws, freshDraw: health.draws > before.draws, diagnostic, health });
    };
    failureProbe = async () => ({ graphics: await graphics(), context: await js(x.failureContext()), focus: await js(x.focusDetails()), target: await js(x.targetDiagnostics(receipt.lastIntent?.selector ?? '')) }); failureShot = () => shot('native-resource-links-failure', true);
    const close = async () => { await click(panel + ' .aw-contextual-dismiss'); await wait(x.absent(panel)); };
    const openNote = async () => {
      await navigate(fixture.note.workspaceId); await wait(x.valueIs(noteInput, fixture.documents[fixture.note.resourceId].draft.content)); await js(x.rememberEditor(noteInput));
      await click(note + ' .aw-note-actions > summary'); await button(note + ' .aw-note-actions-panel', 'Related resources'); await wait(x.relatedReady(fixture.note.resourceId)); await wait(x.focused(search));
      const retained = await js(x.retainedEditor(noteInput)); assert(retained.sameNode && retained.sameText && retained.sameSelection && retained.scrollDelta <= 1, 'Read-only panel opening retains the recovered Note editor'); receipt.noteEditorOnOpen = retained; await recovery();
    };
    const add = async typeName => {
      await js(x.rememberNode(search)); key('Tab'); await wait(x.focused(target)); key('Tab', ['shift']); await wait(x.focused(search));
      await type(search, fixture.task.title); assert.equal(await js(x.sameNode(search)), true, 'Search render retains the focused search node'); assert.equal(await js(x.focused(search)), true);
      await select(target, fixture.task.resourceId); await select(kind, typeName); await button(panel + ' form', 'Add link'); await wait(x.edgeExists(fixture.note.resourceId, fixture.task.resourceId, typeName)); await wait(x.relatedReady(fixture.note.resourceId));
      const edge = (await snapshot()).relationships.find(e => e.source_id === fixture.note.resourceId && e.target_id === fixture.task.resourceId && e.kind === typeName && e.provenance === 'user'); assert(edge);
      assert.equal(await js(x.linkDetail(edge.id)), 'Outgoing · ' + (typeName === 'references' ? 'References' : 'Depends on') + ' · user'); return edge;
    };
    const incoming = async edge => {
      await navigate(fixture.browser.workspaceId); const browser = '[data-block=' + q(fixture.browser.blockId) + ']';
      await wait(x.exists(browser + ' .aw-subject-tools input')); await type(browser + ' .aw-subject-tools input', fixture.task.title);
      const row = browser + ' [data-resource-id=' + q(fixture.task.resourceId) + ']'; await wait(x.exists(row)); await click(row + ' .aw-subject-resource-details > summary'); await click(row + ' .aw-subject-related'); await wait(x.relatedReady(fixture.task.resourceId)); await wait(x.focused(search));
      assert.equal(await js(x.linkDetail(edge.id)), 'Incoming · ' + (edge.kind === 'references' ? 'References' : 'Depends on') + ' · user');
      const membership = seed.expected.relationships.find(e => e.kind === 'contains_task' && e.target_id === fixture.task.resourceId); assert(membership);
      await wait(x.exists(panel + ' [data-relationship-id=' + q(membership.id) + ']')); assert.equal(await js(x.exists(panel + ' [data-remove-link=' + q(membership.id) + ']')), false, 'Task membership cannot be removed as a user link');
      key('Tab'); receipt.keyboardIncomingFocus = await js(x.focusDetails()); assert(receipt.keyboardIncomingFocus?.insideRelated && receipt.keyboardIncomingFocus.tag === 'BUTTON'); await recovery();
    };
    const remove = async edge => { await click(panel + ' [data-remove-link=' + q(edge.id) + ']'); await wait(x.edgeAbsent(edge.id)); await wait(x.relatedReady(fixture.task.resourceId)); await verify(seed.expected.relationships); };
    await wait(x.ready()); await noExecution();
    if (limits.restore) {
      receipt.phase = 'fresh-process link and recovery persistence'; const expected = await readJson('workspace-resource-links-expected.json', limits.maxCheckpointBytes);
      assert.equal(expected.contract, 'aerynth.workspace-resource-links-checkpoint@1'); assert.deepEqual(expected.documents, fixture.documents); assert.deepEqual(expected.canonical, exports.canonical(await snapshot())); assert.equal((await snapshot()).activeWorkspaceId, expected.activeWorkspaceId);
      assert.deepEqual(exports.edges((await snapshot()).relationships), exports.edges(expected.relationships)); await recovery(); receipt.restoredEdge = expected.persistedEdge;
      await incoming(expected.persistedEdge); await verify(expected.relationships); await shot('fresh-process-incoming-user-link');
      await remove(expected.persistedEdge); await close(); receipt.removedAfterRestart = expected.persistedEdge.id;
      receipt.checks.push('Separate process restores the exact user link and untouched canonical/recovery data, then actual native removal deletes only that same edge without replayed creation');
    } else {
      receipt.phase = 'native Note actions and outgoing user link'; await openNote(); await verify(seed.expected.relationships);
      const first = await add('references'); receipt.firstUserEdge = first; await verify([...seed.expected.relationships, first]); await shot('note-outgoing-link-with-recovery-retained');
      await button(panel + ' [data-relationship-id=' + q(first.id) + ']', fixture.task.title); await wait(x.absent(panel)); await wait(x.openedTarget(fixture.task.resourceId));
      const opened = await snapshot(), placement = opened.blocks.find(b => b.resource_id === fixture.task.resourceId); assert(placement && fixture.task.placements.some(p => p.blockId === placement.id)); receipt.openedTarget = { resourceId: fixture.task.resourceId, blockId: placement.id, workspaceId: opened.activeWorkspaceId };
      await verify([...seed.expected.relationships, first]); await click('[data-block=' + q(placement.id) + '] .unfold'); await wait(x.expanded('[data-block=' + q(placement.id) + ']', false));
      receipt.phase = 'native incoming provenance and exact user-link removal'; await incoming(first); await verify([...seed.expected.relationships, first]); await shot('task-incoming-link-and-protected-membership'); await remove(first); await close();
      receipt.phase = 'native second user link for restart'; await openNote(); const persisted = await add('depends_on'); assert.notEqual(persisted.id, first.id); receipt.persistedUserEdge = persisted; await verify([...seed.expected.relationships, persisted]); await close();
      const final = await snapshot(), checkpoint = { contract: 'aerynth.workspace-resource-links-checkpoint@1', canonical: exports.canonical(final), relationships: final.relationships, documents: fixture.documents, workspaces: fixture.workspaces, removedEdgeId: first.id, persistedEdge: persisted, activeWorkspaceId: final.activeWorkspaceId };
      const bytes = Buffer.from(JSON.stringify(checkpoint)); assert(bytes.length <= limits.maxCheckpointBytes, 'resource_links_checkpoint_bytes_exceeded'); await guard.around(() => fs.writeFile(path.join(privateRoot, 'workspace-resource-links-expected.json'), bytes, { flag: 'wx' }));
      receipt.checks.push('Actual Note actions/search keyboard/native selects create references link; outgoing/incoming type and user provenance, target opening and exact removal use the existing broker; protected membership and separate Note/Task recovery remain intact', 'A second explicit depends-on user link persists for separate-process validation; no resource edit, recovery save or provider call occurs');
    }
    await noExecution(); receipt.finalGraphics = await graphics(); assert(captureAllowed(receipt.finalGraphics)); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0); receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 12000); if (failureProbe) try { receipt.failureState = await failureProbe(); } catch (e) { receipt.failureStateUnavailable = String(e?.message ?? e).slice(0, 1000); }
    if (failureShot && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await failureShot(); } catch (e) { receipt.failureCaptureUnavailable = String(e?.message ?? e).slice(0, 1000); }
  } finally {
    startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false; receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    try { consoleSource?.removeListener('console-message', consoleError); guard?.dispose(); } catch (e) { receipt.passed = false; receipt.cleanupError = String(e?.message ?? e).slice(0, 1000); }
    try { const bytes = Buffer.from(JSON.stringify(receipt, null, 2)); assert(bytes.length <= (limits?.maxJsonBytes ?? 524288), 'resource_links_receipt_bytes_exceeded'); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'workspace-resource-links.json'), bytes, { flag: 'wx' }); }
    catch (e) { receipt.passed = false; receipt.error = String(e?.message ?? e).slice(0, 1000); }
    finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } }
  }
  return receipt;
};
