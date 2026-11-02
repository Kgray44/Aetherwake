const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { createGuard, options, captureAllowed, consoleHandler } = require('./library-native.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { expressions: x, preflight } = require('./workspace-structured-grid-expressions.cjs');
const q = JSON.stringify, digest = bytes => createHash('sha256').update(bytes).digest('hex');
exports.preflight = preflight;
exports.workspace = s => ({ blocks: s.blocks, viewport: s.viewport, organization: s.organization, presence: s.presence });
exports.canonical = s => ({ projects: s.projects, workspaces: s.workspaces, resources: s.resources, relationships: s.relationships });
exports.fixture = seed => {
  const f = seed.structuredGridCase;
  assert(seed.contract === 'aerynth.workspace-native@1' && seed.syntheticOnly && f && seed.structuredGridValidation && !seed.relatedCase, 'explicit_structured_grid_fixture_required');
  assert.equal(seed.expected.activeWorkspaceId, f.workspaceId); assert.equal(seed.expected.blocks.length, 3); assert.equal(seed.expected.organization.mode, 'freeform');
  assert(seed.expected.blocks.some(block => block.x % 16 || block.y % 16)); assert(new Set(seed.expected.blocks.map(block => block.shape)).size >= 3);
  assert(seed.expected.viewport.x && seed.expected.viewport.y && seed.expected.viewport.zoom !== 1); assert(seed.expected.presence.x % 16 && seed.expected.presence.y % 16);
  assert(seed.expected.blocks.some(block => block.id === f.movingBlockId && block.resource_id === f.document.resource.id));
  return f;
};
exports.assertPreserved = (before, after) => {
  assert.deepEqual(after.blocks, before.blocks, 'Mode entry must preserve exact block records, versions, shape, layers and order');
  assert.deepEqual(after.viewport, before.viewport); assert.deepEqual(after.presence, before.presence); assert.deepEqual(after.organization.structured, before.organization.structured);
  assert.equal(after.activeWorkspaceId, before.activeWorkspaceId); assert.deepEqual(exports.canonical(after), exports.canonical(before));
};
exports.assertGesture = (before, after, id, operation) => {
  const old = before.blocks.find(block => block.id === id), item = after.blocks.find(block => block.id === id); assert(old && item && item.version > old.version);
  assert.deepEqual(after.blocks.map(block => block.id), before.blocks.map(block => block.id), 'Direct manipulation preserves ordering');
  assert.deepEqual(after.blocks.filter(block => block.id !== id), before.blocks.filter(block => block.id !== id), 'Unrelated cards remain exact, including versions');
  assert.deepEqual(after.viewport, before.viewport); assert.deepEqual(after.presence, before.presence); assert.deepEqual(exports.canonical(after), exports.canonical(before));
  assert.deepEqual(after.organization.structured.order, before.organization.structured.order);
  const aligned = value => Math.abs(value / 16 - Math.round(value / 16)) < 1e-7;
  if (operation === 'move') {
    assert(item.x !== old.x && item.y !== old.y); assert(aligned(item.x) && aligned(item.y));
    assert.deepEqual(item, { ...old, x: item.x, y: item.y, version: item.version });
  } else {
    assert.equal(operation, 'resize'); assert(item.width > old.width && item.height > old.height); assert(aligned(item.x + item.width) && aligned(item.y + item.height));
    assert.deepEqual(item, { ...old, width: item.width, height: item.height, version: item.version });
  }
  for (const other of [...after.blocks.filter(block => block.id !== id), after.presence]) assert(!(item.x < other.x + other.width + after.organization.gap && item.x + item.width + after.organization.gap > other.x && item.y < other.y + other.height + after.organization.gap && item.y + item.height + after.organization.gap > other.y), 'Active landing must avoid occupied geometry');
};
/** Existing parent-owned host only. All mode and geometry mutations are native
 * control/pointer input; renderer/host calls below only observe prepared state. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-structured-grid-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.workspace-structured-grid-evidence@1', syntheticOnly: true, source, passed: false, actions: [], screenshots: [], checks: [], errors: [], limitations: ['The existing Core preparer seeds a synthetic three-card mixed workspace; this is not native content creation.', 'Native mode selection and direct pointer drag/resize prove a bounded grid journey, not effortless interaction, sustained frame performance, wider scale, provider or artistic acceptance.'] };
  let guard, limits, consoleSource, failureProbe, failureShot;
  const onConsole = consoleHandler(receipt), startup = () => { receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : -1; receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(error => String(error?.message ?? error).slice(0, 1000)) : ['Invalid startup errors']; };
  try {
    limits = options(process.argv, moduleStarted); receipt.limits = limits; guard = createGuard(win, limits);
    assert(/^review-workspace-native-/.test(path.basename(privateRoot)), 'dedicated_synthetic_profile_required'); startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', onConsole);
    const checkpointName = 'workspace-structured-grid-expected.json', startedName = 'workspace-structured-grid-initial-started.json';
    if (!limits.restore) for (const name of [checkpointName, startedName]) { let consumed = false; try { await guard.around(() => fs.stat(path.join(privateRoot, name))); consumed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; } assert(!consumed, 'consumed_initial_profile_must_be_preserved_use_separate_restore'); }
    const readJson = async (name, bound) => { const file = path.join(privateRoot, name); assert((await guard.around(() => fs.stat(file))).size <= bound, 'structured_grid_json_bound_exceeded'); return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8'))); };
    const seed = await readJson('workspace-native-seed.json', 262144), fixture = exports.fixture(seed), ids = seed.expected.blocks.map(block => block.id);
    assert(source?.hashes && typeof source.hashes === 'object' && !Array.isArray(source.hashes), 'host_source_identity_required'); assert(Object.keys(seed.hashes).length > 0 && Object.keys(seed.hashes).length <= 8);
    for (const [name, hash] of Object.entries(seed.hashes)) { assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..')); assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name); if (name.endsWith('/prepare-workspace-native.mts')) { if (source.hashes[name]) assert.equal(source.hashes[name], hash); } else assert.equal(source.hashes[name], hash, 'Host runtime differs: ' + name); }
    receipt.preparationHashes = seed.hashes; receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename))); receipt.expressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-structured-grid-expressions.cjs')))); receipt.commonHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./library-native-expressions.cjs')))); receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs')))); receipt.preflight = preflight();
    assert.deepEqual(seed.structuredGridValidation, { preflightSha256: receipt.preflight.sha256, helperSha256: receipt.helperSha256, expressionHelperSha256: receipt.expressionHelperSha256, commonHelperSha256: receipt.commonHelperSha256 });
    if (!limits.restore) { const marker = Buffer.from(JSON.stringify({ contract: 'aerynth.structured-grid-initial-started@1', sourceHashes: digest(Buffer.from(JSON.stringify(source.hashes))) })); assert(marker.length <= 1024); await guard.around(() => fs.writeFile(path.join(privateRoot, startedName), marker, { flag: 'wx' })); }
    const driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(compileExpression(code))), wait = code => guard.around(() => driver.wait(compileExpression(code), Math.min(8000, Math.max(1, limits.deadlineAt - Date.now())))), snapshot = () => guard.around(() => driver.snapshot());
    const invariant = async state => { assert.deepEqual(exports.canonical(state), exports.canonical(seed.expected)); assert.deepEqual(state.navigationBlocks.filter(block => block.workspace_id !== fixture.workspaceId), seed.expected.navigationBlocks.filter(block => block.workspace_id !== fixture.workspaceId)); assert.deepEqual(state.viewport, seed.expected.viewport); assert.deepEqual(state.presence, seed.expected.presence); assert.deepEqual((await js(x.host('notes', { name: 'readNote', input: fixture.document.resource.id }))).result, fixture.document); assert.deepEqual(await js(x.host('executionStatus', {})), []); };
    const graphics = () => js(x.graphics()), card = '[data-block=' + q(fixture.movingBlockId) + ']';
    const shot = async (name, diagnostic = false) => { assert(receipt.screenshots.length < limits.maxScreenshots, 'native_capture_count_exceeded'); if (!diagnostic) await wait(x.gridResting(ids)); const frameBefore = await js(x.gridFrame(ids)), prior = await graphics(); if (!diagnostic) await wait(x.drawsAfter(prior.draws)); const health = await graphics(), frameAfter = await js(x.gridFrame(ids)); assert(captureAllowed(health, diagnostic)); if (!diagnostic) assert(frameBefore.ready && frameAfter.ready, 'Grid capture requires rendered resting geometry'); const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes); await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' })); receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), priorDraws: prior.draws, freshDraw: health.draws > prior.draws, diagnostic, health, frameBefore, frameAfter }); };
    failureProbe = async () => ({ graphics: await graphics(), context: await js(x.failureContext()), target: await js(x.targetDiagnostics(receipt.lastIntent?.selector ?? '')), frame: await js(x.gridFrame(ids)) }); failureShot = () => shot('native-structured-grid-failure', true);
    const drag = async (selector, dx, dy, surface) => { await wait(x.gridResting(ids)); receipt.lastIntent = { action: 'native direct pointer gesture', selector, dx, dy }; const start = await js(surface ? x.surfacePoint(selector, card) : x.point(selector)); assert(start, 'Unobstructed actual pointer target required'); guard.input({ type: 'mouseMove', ...start }); guard.input({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 }); for (let n = 1; n <= 8; n++) { guard.input({ type: 'mouseMove', x: Math.round(start.x + dx * n / 8), y: Math.round(start.y + dy * n / 8), modifiers: ['leftbuttondown'] }); await guard.pause(20); } const end = { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }; guard.input({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 }); receipt.actions.push({ ...receipt.lastIntent, start, end }); };
    await wait(x.ready()); await wait(x.activeWorkspace(fixture.workspaceId)); await wait(x.gridResting(ids));
    let state = await snapshot(); await invariant(state);
    if (limits.restore) {
      const expected = await readJson(checkpointName, limits.maxCheckpointBytes); assert.equal(expected.contract, 'aerynth.structured-grid-checkpoint@1'); assert.deepEqual(expected.sourceHashes, source.hashes); assert.deepEqual(expected.buildAssets, source.buildAssets); assert.deepEqual(exports.workspace(state), expected.workspace); assert.deepEqual(exports.canonical(state), expected.canonical); assert.equal(state.organization.mode, 'structured'); receipt.restored = expected.workspace; await shot('fresh-process-exact-structured-grid'); receipt.checks.push('Separate process restores exact mode, geometry, order, shapes, placement versions, camera and Vela before any native mutation; no gesture replay');
    } else {
      assert.deepEqual(exports.workspace(state), exports.workspace(seed.expected)); const beforeMode = state, selector = '.aw-workspace-layout button[data-organization-mode="structured"]';
      receipt.lastIntent = { action: 'native Structured button click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); await wait(x.organizationIs('structured')); await wait(x.enabled(selector)); state = await snapshot(); exports.assertPreserved(beforeMode, state); await invariant(state); receipt.modeEntry = { before: exports.workspace(beforeMode), after: exports.workspace(state) }; await shot('structured-entry-preserves-current-workspace');
      const beforeMove = state; await drag(card + ' .card-kind-label', 55, 37, true); await wait(x.layoutAfter(beforeMove.layoutVersion)); await wait(x.gridResting(ids)); state = await snapshot(); exports.assertGesture(beforeMove, state, fixture.movingBlockId, 'move'); await invariant(state); receipt.move = { before: exports.workspace(beforeMove), after: exports.workspace(state) };
      const beforeResize = state; await drag(card + ' [data-resize-edge="se"]', 41, 29, false); await wait(x.layoutAfter(beforeResize.layoutVersion)); await wait(x.gridResting(ids)); state = await snapshot(); exports.assertGesture(beforeResize, state, fixture.movingBlockId, 'resize'); await invariant(state); receipt.resize = { before: exports.workspace(beforeResize), after: exports.workspace(state) }; await shot('direct-grid-drag-and-resize-with-stationary-neighbors');
      const checkpoint = Buffer.from(JSON.stringify({ contract: 'aerynth.structured-grid-checkpoint@1', workspace: exports.workspace(state), canonical: exports.canonical(state), sourceHashes: source.hashes, buildAssets: source.buildAssets })); assert(checkpoint.length <= limits.maxCheckpointBytes); await guard.around(() => fs.writeFile(path.join(privateRoot, checkpointName), checkpoint, { flag: 'wx' })); receipt.checks.push('Actual Structured button preserves exact prepared workspace; later native header drag and invisible corner resize snap active geometry to16 without packing unrelated cards or Vela');
    }
    await invariant(state); receipt.finalGraphics = await graphics(); assert(captureAllowed(receipt.finalGraphics)); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0); receipt.passed = true;
  } catch (error) { receipt.error = String(error?.stack ?? error).slice(0, 12000); if (failureProbe) try { receipt.failureState = await failureProbe(); } catch (error) { receipt.failureStateUnavailable = String(error?.message ?? error).slice(0, 1000); } if (failureShot && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await failureShot(); } catch (error) { receipt.failureCaptureUnavailable = String(error?.message ?? error).slice(0, 1000); }
  } finally { startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false; receipt.elapsedFromHostStartMs = Date.now() - moduleStarted; try { consoleSource?.removeListener('console-message', onConsole); guard?.dispose(); } catch (error) { receipt.passed = false; receipt.cleanupError = String(error?.message ?? error).slice(0, 1000); } try { const bytes = Buffer.from(JSON.stringify(receipt, null, 2)); assert(bytes.length <= (limits?.maxJsonBytes ?? 524288)); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'workspace-structured-grid.json'), bytes, { flag: 'wx' }); } catch (error) { receipt.passed = false; receipt.error = String(error?.message ?? error).slice(0, 1000); } finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } } }
  return receipt;
};
