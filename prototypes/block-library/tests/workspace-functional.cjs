const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { createGuard, options, captureAllowed, consoleHandler, persistent, workspace } = require('./library-native.cjs');
const { compileExpression } = require('./library-native-expressions.cjs');
const { expressions: x, preflight } = require('./workspace-functional-expressions.cjs');
const q = JSON.stringify, digest = value => createHash('sha256').update(value).digest('hex');
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
exports.preflight = preflight;
exports.fixture = seed => {
  assert.equal(seed.contract, 'aerynth.functional-workspace-native@1'); assert.equal(seed.syntheticOnly, true);
  assert.equal(seed.codexScope, 'prepared identity only; no native session, capability probe or turn');
  assert.equal(seed.expected.activeWorkspaceId, seed.workspaceId); assert.equal(seed.expected.blocks.length, 6);
  const ids = new Set();
  for (const role of ['local', 'codex', 'note', 'group', 'stream', 'project']) {
    const binding = seed.placements[role], block = seed.expected.blocks.find(b => b.id === binding.blockId);
    assert(block && block.workspace_id === seed.workspaceId && !ids.has(block.id)); ids.add(block.id);
    if (role !== 'project') assert.equal(block.resource_id, binding.resourceId);
    else assert.deepEqual(block.subject, { kind: 'project', projectId: seed.projectId });
  }
  const codex = seed.expected.resources.find(r => r.id === seed.placements.codex.resourceId), local = seed.expected.resources.find(r => r.id === seed.placements.local.resourceId);
  assert(codex && local && codex.id !== local.id); assert.equal(codex.providerId, 'codex-app-server'); assert.equal(local.providerId, 'local');
  for (const id of [seed.placements.note.resourceId, seed.recoveryTaskId]) {
    const doc = seed.documents[id]; assert.equal(doc.resource.id, id); assert(doc.draft && doc.draft.content !== doc.resource.content);
  }
  assert(!seed.expected.blocks.some(b => b.resource_id === seed.recoveryTaskId));
  return seed.placements;
};
exports.assertBasePlacements = (state, seed, extra) => {
  assert.deepEqual(state.projects, seed.expected.projects); assert.deepEqual(state.workspaces, seed.expected.workspaces);
  assert.equal(state.activeWorkspaceId, seed.workspaceId); assert.deepEqual(state.viewport, seed.expected.viewport);
  assert.deepEqual(state.organization, seed.expected.organization); assert.deepEqual(state.presence, seed.expected.presence);
  for (const block of seed.expected.blocks) assert.deepEqual(state.blocks.find(b => b.id === block.id), block, 'Native content/actions retain every original placement exactly');
  assert.equal(state.blocks.length, seed.expected.blocks.length + (extra ? 1 : 0));
  if (extra) {
    assert.equal(extra.createdBlock.id, extra.blockId); assert.equal(extra.createdBlock.resource_id, extra.resourceId);
    assert.deepEqual(state.blocks.find(b => b.id === extra.blockId), extra.createdBlock, 'The newly created Task placement also retains its exact geometry');
  }
};
exports.assertCompleted = (state, seed, task, message) => {
  exports.assertBasePlacements(state, seed, task);
  assert.deepEqual(state.resources.map(r => r.id).sort(), [...seed.expected.resources.map(r => r.id), task.resourceId].sort());
  const roles = seed.placements;
  for (const original of seed.expected.resources) {
    const actual = state.resources.find(r => r.id === original.id);
    if (original.id === roles.local.resourceId) {
      assert.deepEqual(without(actual, ['messages', 'messageCount', 'conversationRevision']), without(original, ['messages', 'messageCount', 'conversationRevision']));
      assert.equal(actual.conversationRevision, original.conversationRevision + 1); assert.equal(actual.messageCount, 1);
      assert.equal(actual.messages.length, 1); assert.equal(actual.messages[0].role, 'user'); assert.equal(actual.messages[0].content, seed.labels.message); assert.equal(actual.messages[0].id, message.id);
    } else if (original.id === roles.note.resourceId) {
      assert.deepEqual(actual, { ...original, content: seed.labels.noteText, version: original.version + 2 });
    } else if (original.id === roles.group.resourceId) {
      assert.deepEqual(without(actual, ['version', 'taskMembers']), without(original, ['version', 'taskMembers']));
      assert.equal(actual.version, original.version + 1); assert.equal(actual.taskMembers.length, 1);
      assert.equal(actual.taskMembers[0].id, task.resourceId); assert.equal(actual.taskMembers[0].status, 'done');
    } else assert.deepEqual(actual, original, 'Unchanged canonical resources, including Codex and recovery task, remain exact');
  }
  const created = state.resources.find(r => r.id === task.resourceId); assert.equal(created.title, seed.labels.nativeTask); assert.equal(created.kind, 'task'); assert.equal(created.project_id, seed.projectId); assert.equal(created.taskStatus, 'done');
  assert.equal(task.createdResource.content, ''); assert.equal(task.createdResource.taskStatus, 'open');
  assert.deepEqual(created, { ...task.createdResource, version: task.createdResource.version + 1, taskStatus: 'done' }, 'Task status must not alter its title, content, ownership or other metadata');
  assert.equal(state.relationships.length, seed.expected.relationships.length + 1);
  for (const edge of seed.expected.relationships) assert.deepEqual(state.relationships.find(e => e.id === edge.id), edge);
  const edge = state.relationships.find(e => !seed.expected.relationships.some(old => old.id === e.id));
  assert.equal(edge.kind, 'contains_task'); assert.equal(edge.source_id, roles.group.resourceId); assert.equal(edge.target_id, task.resourceId); assert.equal(edge.provenance, 'user');
};
exports.assertNoProviderExecution = integration => {
  assert.equal(Object.keys(integration.executions).length, 0); assert.equal(Object.values(integration.bindings).flat().length, 0, 'Identity staging must not establish a native provider session');
  assert(integration.graph.messages.every(message => message.role === 'user'), 'No synthetic or provider assistant output is permitted');
};

/** Parent-owned native phase only. The Codex block is inspected without Send,
 * connect, capability probes or execution. A genuine turn remains separate. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-functional-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.functional-workspace-evidence@1', syntheticOnly: true, source, passed: false, journeyBComplete: false, codexExecution: 'not requested; identity-only inspection', actions: [], checks: [], screenshots: [], errors: [], limitations: ['Offline canonical preparation is not native creation of the initial six block surfaces.', 'Actual native local recording, Note review/save/edit/recovery, new Task creation/membership/status, retained-event inspection and Project overview navigation are distinct from preparation.', 'Codex is a distinct prepared identity with an untouched unsent draft. No capability probe, connection, native session or turn is requested; this alone cannot complete journey B.', 'Canonical application events expose only their actual stored attribution; a provider association is not evidence of provider execution or per-resource causality.', 'No real native IME, mixed-card scale, sustained performance, wider D/E/F or owner artistic acceptance.'] };
  let guard, limits, consoleSource, probe, failureShot;
  const consoleError = consoleHandler(receipt);
  const startup = () => { receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : -1; receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(e => String(e?.message ?? e).slice(0, 1000)) : ['Invalid startup errors']; };
  try {
    limits = options(process.argv, moduleStarted); receipt.limits = limits; guard = createGuard(win, limits);
    assert(/^review-workspace-native-functional-/.test(path.basename(privateRoot)), 'dedicated_functional_profile_required'); startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', consoleError);
    const checkpointName = 'workspace-functional-expected.json', startedName = 'workspace-functional-initial-started.json';
    if (!limits.restore) {
      for (const name of [checkpointName, startedName]) {
        let consumed = false; try { await guard.around(() => fs.stat(path.join(privateRoot, name))); consumed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        assert(!consumed, 'consumed_initial_profile_must_be_preserved_use_separate_restore');
      }
    }
    const readJson = async (name, bound) => { const file = path.join(privateRoot, name); assert((await guard.around(() => fs.stat(file))).size <= bound, 'functional_json_bytes_exceeded'); return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8'))); };
    const seed = await readJson('workspace-functional-seed.json', 262144), roles = exports.fixture(seed);
    assert(source?.hashes && typeof source.hashes === 'object' && !Array.isArray(source.hashes), 'host_source_identity_required'); assert(Object.keys(seed.hashes).length === 8);
    for (const [name, hash] of Object.entries(seed.hashes)) {
      assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..')); assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name);
      if (!name.includes('/tests/') && !name.endsWith('/prepare-functional-workspace-native.mts')) assert.equal(source.hashes[name], hash, 'Host/preparation runtime differs');
      else if (source.hashes[name]) assert.equal(source.hashes[name], hash, 'Host/preparation helper differs');
    }
    receipt.preparationHashes = seed.hashes; receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename))); receipt.expressionHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-functional-expressions.cjs')))); receipt.commonHelperSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./workspace-approach-expressions.cjs')))); receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs')))); receipt.preflight = preflight();
    assert.deepEqual(seed.validation, { preflightSha256: receipt.preflight.sha256, helperSha256: receipt.helperSha256, expressionHelperSha256: receipt.expressionHelperSha256, commonHelperSha256: receipt.commonHelperSha256 });
    if (!limits.restore) {
      // An initial run that later fails may already have sent input. Its small
      // exclusive start receipt prevents a second mutation attempt on that profile.
      const marker = Buffer.from(JSON.stringify({ contract: 'aerynth.functional-workspace-initial-started@1', startedAt: new Date().toISOString(), sourceSha256: digest(Buffer.from(JSON.stringify(source.hashes))) }));
      assert(marker.length <= 1024); await guard.around(() => fs.writeFile(path.join(privateRoot, startedName), marker, { flag: 'wx' }));
    }
    const driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(compileExpression(code))), wait = code => guard.around(() => driver.wait(compileExpression(code), Math.min(8000, Math.max(1, limits.deadlineAt - Date.now()))));
    const snapshot = () => guard.around(() => driver.snapshot());
    const click = async selector => { receipt.lastIntent = { action: 'native click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); };
    const key = (keyCode, modifiers = []) => { guard.input({ type: 'keyDown', keyCode, modifiers }); guard.input({ type: 'keyUp', keyCode, modifiers }); receipt.actions.push({ action: 'native key', keyCode, modifiers }); };
    const type = async (selector, content) => { await click(selector); key('A', ['control']); await guard.insertText(content); receipt.actions.push({ action: 'native text input', selector, content }); };
    const button = async (scope, label) => { await wait(x.buttonExists(scope, label)); const selector = await js(x.buttonPath(scope, label)); assert(selector); await click(selector); };
    const card = id => '[data-block=' + q(id) + ']';
    const open = async binding => { const selector = card(binding.blockId); await click(selector + ' .unfold'); await wait(x.expanded(selector, true)); return selector; };
    const close = async selector => { await click(selector + ' .unfold'); await wait(x.expanded(selector, false)); };
    const document = async id => (await js(x.host('notes', { name: 'readNote', input: id }))).result;
    const draft = id => js(x.host('conversation', { name: 'readDraft', input: { resourceId: id } }));
    const detail = id => js(x.host('conversation', { name: 'detail', input: { resourceId: id, limit: 50 } }));
    const noExecution = async () => exports.assertNoProviderExecution(await js(x.host('snapshot', {})));
    const unchangedRecovery = async () => { assert.deepEqual(await document(seed.recoveryTaskId), seed.documents[seed.recoveryTaskId]); assert.deepEqual(await draft(roles.codex.resourceId), seed.drafts[roles.codex.resourceId]); const codex = await detail(roles.codex.resourceId); assert.equal(codex.conversation.providerId, 'codex-app-server'); assert.equal(codex.messages.total, 0); await noExecution(); };
    const shot = async name => {
      assert(receipt.screenshots.length < limits.maxScreenshots); const before = await js(x.graphics()); await wait(x.drawsAfter(before.draws)); const health = await js(x.graphics()); assert(captureAllowed(health));
      const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes); await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' })); receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), freshDraw: health.draws > before.draws, diagnostic: false, health });
    };
    probe = async () => ({ graphics: await js(x.graphics()), context: await js(x.failureContext()), target: await js(x.targetDiagnostics(receipt.lastIntent?.selector ?? '')) });
    // Failure captures remain explicitly diagnostic, bounded and never count as a pass.
    failureShot = async () => {
      assert(receipt.screenshots.length < limits.maxScreenshots); const health = await js(x.graphics()); assert(captureAllowed(health, true)); const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length; assert(receipt.pngBytes <= limits.maxPngBytes); await guard.around(() => fs.mkdir(output, { recursive: true })); const file = 'native-functional-failure.png'; await guard.around(() => fs.writeFile(path.join(output, file), png, { flag: 'wx' })); receipt.screenshots.push({ file, bytes: png.length, sha256: digest(png), freshDraw: false, diagnostic: true, health });
    };
    const inspectEvent = async event => {
      const selector = await open(roles.stream); await wait(x.exists(selector + ' .aw-event-view')); await button(selector + ' .aw-event-view', 'Refresh retained events');
      await type(selector + ' input[aria-label="Search event metadata"]', event.eventId);
      const row = selector + ' [data-event-id=' + q(event.eventId) + ']'; await wait(x.exists(row)); await click(row + ' summary');
      const metadata = await js(x.eventMetadata(row)); assert.equal(metadata['Event ID'], event.eventId); assert.equal(metadata.Cursor, String(event.cursor)); assert.equal(metadata.Type, event.type); assert.equal(metadata['Evidence class'], event.classification); assert.equal(metadata.Provider, event.providerId); assert.equal(metadata.Execution, 'Unavailable'); receipt.inspectedEvent = { eventId: event.eventId, cursor: event.cursor, type: event.type, classification: event.classification, resourceId: event.resourceId, executionId: event.executionId, providerId: event.providerId };
      return selector;
    };
    await wait(x.ready()); await unchangedRecovery();
    if (limits.restore) {
      receipt.phase = 'fresh-process exact combined workspace and recovery'; const expected = await readJson(checkpointName, limits.maxCheckpointBytes);
      assert.equal(expected.contract, 'aerynth.functional-workspace-checkpoint@1'); assert.deepEqual(expected.sourceHashes, source.hashes); assert.deepEqual(expected.buildAssets, source.buildAssets); assert.deepEqual(persistent(await snapshot()), expected.canonical); assert.deepEqual(workspace(await snapshot()), expected.workspace);
      for (const [id, doc] of Object.entries(expected.documents)) assert.deepEqual(await document(id), doc);
      for (const [id, value] of Object.entries(expected.drafts)) assert.deepEqual(await draft(id), value);
      const local = await detail(roles.local.resourceId); assert.deepEqual(local.messages.items, expected.localMessages); assert.equal(local.messages.total, 1);
      const note = await open(roles.note); await wait(x.valueIs(note + ' textarea', seed.labels.noteText)); await close(note);
      const chat = await open(roles.local); await wait(x.valueIs(chat + ' .cp-composer textarea', seed.labels.localDraft)); await close(chat);
      const stream = await inspectEvent(expected.event); await shot('fresh-process-recorded-event-and-recovery'); await close(stream);
      await unchangedRecovery(); assert.deepEqual(persistent(await snapshot()), expected.canonical); assert.deepEqual(workspace(await snapshot()), expected.workspace); receipt.restoredNativeTask = expected.nativeTask;
      receipt.checks.push('Separate process restores exact IDs/resources/membership/geometry/camera/organization/Vela, local transcript and independent drafts; actual Note/Chat activation and retained event inspection replay no mutations');
    } else {
      receipt.phase = 'combined six-surface workspace'; assert.deepEqual(persistent(await snapshot()), persistent(seed.expected)); exports.assertBasePlacements(await snapshot(), seed);
      for (const binding of Object.values(roles)) await wait(x.exists(card(binding.blockId)));
      await shot('combined-distinct-blocks-before-native-actions');
      receipt.phase = 'actual native local message and independent unsent draft';
      const chat = await open(roles.local), chatInput = chat + ' .cp-composer textarea'; await wait(x.valueIs(chatInput, seed.drafts[roles.local.resourceId].content));
      await type(chatInput, seed.labels.message); await click(chat + ' .cp-composer button[type="submit"]'); await wait(x.conversationHasUser(roles.local.resourceId, seed.labels.message)); await wait(x.valueIs(chatInput, ''));
      await type(chatInput, seed.labels.localDraft); await wait(x.draftIs(roles.local.resourceId, seed.labels.localDraft)); const localMessages = (await detail(roles.local.resourceId)).messages.items; assert.equal(localMessages.length, 1); await close(chat); await unchangedRecovery();
      receipt.phase = 'actual native Codex identity inspection without execution'; const codex = await open(roles.codex); await wait(x.valueIs(codex + ' .cp-composer textarea', seed.drafts[roles.codex.resourceId].content)); receipt.codexProvider = await js(x.composerProvider(codex)); assert.equal(receipt.codexProvider?.id, 'codex-app-server'); assert(typeof receipt.codexProvider.label === 'string' && receipt.codexProvider.label.length); await close(codex); await unchangedRecovery();
      receipt.phase = 'actual native recovered Note review/save and persistent edit';
      const note = await open(roles.note), noteInput = note + ' textarea', recovered = seed.documents[roles.note.resourceId].draft.content;
      await wait(x.valueIs(noteInput, recovered)); await button(note + ' .aw-note-recovery', 'Save draft'); await wait(x.noteSavedIs(roles.note.resourceId, recovered));
      if (await js(x.buttonExists(note + ' .aw-note-tools', 'Edit'))) await button(note + ' .aw-note-tools', 'Edit');
      await type(noteInput, seed.labels.noteText); await wait(x.valueIs(noteInput, seed.labels.noteText)); await js(x.rememberEditor(noteInput)); await close(note); await wait(x.noteSavedIs(roles.note.resourceId, seed.labels.noteText));
      receipt.noteRetention = await js(x.retainedEditor(noteInput)); assert(receipt.noteRetention.sameNode && receipt.noteRetention.sameText && receipt.noteRetention.sameSelection && receipt.noteRetention.scrollDelta <= 1);
      receipt.phase = 'actual native Task creation, exact membership and status';
      await click('.aw-workspace-add'); await wait(x.exists('.aw-library input[aria-label="Search blocks"]')); await type('.aw-library input[aria-label="Search blocks"]', 'task'); await click('.aw-library__list [data-block-kind="task"]'); await wait(x.exists('.aw-library__detail > form'));
      const title = await js(x.fieldPath('.aw-library__detail > form', 'Title')); assert(title); await type(title, seed.labels.nativeTask); await click('.aw-library__detail > form > button[type="submit"]'); await wait(x.absent('.aw-library'));
      const afterCreate = await snapshot(), taskResource = afterCreate.resources.find(r => r.title === seed.labels.nativeTask), taskBlock = afterCreate.blocks.find(b => b.resource_id === taskResource?.id); assert(taskResource && taskBlock && taskResource.kind === 'task');
      const nativeTask = { resourceId: taskResource.id, blockId: taskBlock.id, createdResource: taskResource, createdBlock: taskBlock }; exports.assertBasePlacements(afterCreate, seed, nativeTask);
      const group = await open(roles.group); await button(group + ' .aw-task-group', 'Manage tasks'); await wait(x.exists('#task-group-members'));
      await click('#task-group-members input[name="taskId"][value=' + q(nativeTask.resourceId) + ']'); await button('#task-group-members', 'Save task membership'); await wait(x.absent('#command-surface[open]')); await wait(x.groupHas(roles.group.resourceId, nativeTask.resourceId));
      const checkbox = group + ' .aw-task-group-list [data-task-id=' + q(nativeTask.resourceId) + '] input[type="checkbox"]'; await click(checkbox); await wait(x.taskStatusIs(nativeTask.resourceId, 'done')); await close(group); await unchangedRecovery();
      const events = await js(x.host('replay', { after: seed.baselineEventCursor, limit: 250 })), event = events.events.find(e => e.type === 'application/taskStatus' && e.classification === 'observed'); assert(event && event.cursor > seed.baselineEventCursor && event.executionId === null, 'Actual retained application status event required');
      receipt.phase = 'actual native Project overview change and workspace navigation';
      const project = await open(roles.project); await wait(x.exists(project + ' .aw-project-summary')); await button(project + ' .aw-subject-view', 'Refresh');
      await wait(x.containsText(project + ' .aw-project-summary', '0 open · 1 done')); receipt.projectSummary = await js(x.projectSummary(project));
      await click(project + ' [data-workspace-id=' + q(seed.alternateWorkspaceId) + '] button'); await wait(x.activeWorkspace(seed.alternateWorkspaceId)); assert.deepEqual(workspace(await snapshot()), seed.alternate);
      await click('#workspace-manager'); await click('[data-workspace=' + q(seed.workspaceId) + ']'); await wait(x.activeWorkspace(seed.workspaceId)); await wait(x.absent('#command-surface[open]'));
      receipt.phase = 'actual native retained Intelligence Stream event'; const stream = await inspectEvent(event); await shot('actual-task-event-metadata-in-combined-workspace'); await close(stream);
      const final = await snapshot(); exports.assertCompleted(final, seed, nativeTask, localMessages[0]); await unchangedRecovery();
      const documents = {}; for (const id of [roles.note.resourceId, seed.recoveryTaskId]) documents[id] = await document(id);
      const drafts = {}; for (const id of [roles.local.resourceId, roles.codex.resourceId]) drafts[id] = await draft(id);
      assert.equal(documents[roles.note.resourceId].resource.content, seed.labels.noteText); assert.equal(documents[roles.note.resourceId].draft, null);
      const checkpoint = { contract: 'aerynth.functional-workspace-checkpoint@1', sourceHashes: source.hashes, buildAssets: source.buildAssets, canonical: persistent(final), workspace: workspace(final), documents, drafts, localMessages, nativeTask, event };
      const bytes = Buffer.from(JSON.stringify(checkpoint)); assert(bytes.length <= limits.maxCheckpointBytes, 'functional_checkpoint_bytes_exceeded'); await guard.around(() => fs.writeFile(path.join(privateRoot, checkpointName), bytes, { flag: 'wx' })); receipt.nativeTask = nativeTask;
      receipt.checks.push('One combined workspace has meaningful native local message/draft, explicit recovered Note review/save and autosaved edit, new Task membership/status, exact retained-event metadata and actual Project overview navigation; unrelated canonical resources and recovery remain exact');
    }
    await noExecution(); receipt.finalGraphics = await js(x.graphics()); assert(captureAllowed(receipt.finalGraphics)); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0); receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 12000); if (probe) try { receipt.failureState = await probe(); } catch (e) { receipt.failureStateUnavailable = String(e?.message ?? e).slice(0, 1000); }
    if (failureShot && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await failureShot(); } catch (e) { receipt.failureCaptureUnavailable = String(e?.message ?? e).slice(0, 1000); }
  } finally {
    startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false; receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    try { consoleSource?.removeListener('console-message', consoleError); guard?.dispose(); } catch (e) { receipt.passed = false; receipt.cleanupError = String(e?.message ?? e).slice(0, 1000); }
    try { const bytes = Buffer.from(JSON.stringify(receipt, null, 2)); assert(bytes.length <= (limits?.maxJsonBytes ?? 524288)); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'workspace-functional.json'), bytes, { flag: 'wx' }); }
    catch (e) { receipt.passed = false; receipt.error = String(e?.message ?? e).slice(0, 1000); }
    finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, journeyBComplete: false, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } }
  }
  return receipt;
};
