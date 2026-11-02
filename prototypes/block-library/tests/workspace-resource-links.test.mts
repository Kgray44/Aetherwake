import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareWorkspaceNative } from '../prepare-workspace-native.mts';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { NoteSession } from '../note-session.ts';
import type { NoteDocument } from '../note-contracts.ts';
const require = createRequire(import.meta.url), helper = require('./workspace-resource-links.cjs'), { expressions: x, preflight } = require('./workspace-resource-links-expressions.cjs');

test('Related native expressions exhaust all user link kinds and inherited branches before dispatch, without JS input substitutes', () => {
  const result = preflight(); assert.equal(result.factories, 7); assert.equal(result.cases, 9); assert.deepEqual(result, preflight());
  assert.deepEqual(result.common, require('./workspace-approach-expressions.cjs').preflight());
  const source = readFileSync(new URL('./workspace-resource-links.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/); assert.doesNotMatch(source, /\.dispatchEvent\(|\.click\(\)|\.focus\(\)|\.value\s*=/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/);
});

test('Related readiness requires exact canonical source identity and settled busy state; edge observations retain exact direction/type/provenance', () => {
  const panel = { dataset: { resourceId: 'source' }, getAttribute: () => 'true' }, state = { relationships: [{ id: 'real-edge', source_id: 'source', target_id: 'task', kind: 'references', provenance: 'user' }] };
  const context = { document: { querySelector: () => panel }, window: { __aerynth: { application: () => state } } };
  assert.equal(runInNewContext(x.relatedReady('source'), context), false); panel.getAttribute = () => ''; assert.equal(runInNewContext(x.relatedReady('source'), context), true); assert.equal(runInNewContext(x.relatedReady('other'), context), false);
  assert.equal(runInNewContext(x.edgeExists('source', 'task', 'references'), context), true); assert.equal(runInNewContext(x.edgeExists('task', 'source', 'references'), context), false);
  state.relationships[0].provenance = 'inferred'; assert.equal(runInNewContext(x.edgeExists('source', 'task', 'references'), context), false);
  assert.equal(runInNewContext(x.edgeAbsent('real-edge'), context), false);
});

test('recovery and canonical comparisons reject auto-save, discard, changed draft version, geometry, hidden content changes or lost protected edges', () => {
  const document = { resource: { id: 'source', content: 'Canonical text', version: 2 }, draft: { content: 'Separate recovery', version: 1 }, draftRevision: 1 };
  helper.assertRecovery(document, document);
  for (const patch of [{ resource: { ...document.resource, content: 'Separate recovery' } }, { draft: null }, { draft: { ...document.draft, version: 2 } }]) assert.throws(() => helper.assertRecovery({ ...document, ...patch }, document));
  const state = { activeWorkspaceId: 'workspace', projects: [], workspaces: [], resources: [document.resource], relationships: [{ id: 'protected', kind: 'contains_task' }], blocks: [{ id: 'placement', resource_id: 'source', width: 440, height: 360, version: 1 }], viewport: { x: 0, y: -100, zoom: 1 }, organization: { mode: 'freeform' }, presence: { id: 'system:vela', version: 1 } };
  const workspaces = { workspace: helper.workspace(state) }; helper.assertState(state, state, workspaces, state.relationships);
  for (const patch of [{ relationships: [] }, { blocks: [{ ...state.blocks[0], width: 441 }] }, { resources: [{ ...document.resource, content: 'Separate recovery' }] }]) assert.throws(() => helper.assertState({ ...state, ...patch }, state, workspaces, state.relationships));
  assert.throws(() => helper.fixture({ cases: [], shapeCases: [] }), /explicit_related_recovery_fixture/);
});

test('explicit Related mode rejects startup errors before native operations and releases owner listeners', async () => {
  const argv = process.argv; process.argv = [...argv, '--verify-resource-links', '--verification-deadline-ms=30000'];
  const contents: any = new EventEmitter(); contents.isDestroyed = () => false; const forbidden = () => { throw Error('No native operation allowed on rejection'); };
  for (const key of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[key] = forbidden;
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents }; let exit = -1;
  try {
    const receipt = await require('./workspace-native.cjs').verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: join(tmpdir(), 'review-workspace-native-links-rejected'), source: {}, moduleStarted: Date.now(), startupErrors: ['Synthetic observed error'] });
    assert.equal(receipt.contract, 'aerynth.workspace-resource-links-evidence@1'); assert.equal(receipt.passed, false); assert.equal(receipt.actions.length + receipt.screenshots.length, 0); assert.equal(exit, 1);
    assert.equal(contents.listenerCount('before-input-event'), 0); assert.equal(contents.listenerCount('console-message'), 0);
  } finally { process.argv = argv; }
});

test('a consumed initial Related profile is rejected before JS or native input rather than replaying link changes before a late checkpoint collision', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'review-workspace-native-consumed-source-'));
  writeFileSync(join(profile, 'workspace-resource-links-expected.json'), JSON.stringify({ cpuOnlyRejectionMarker: true }), { flag: 'wx' });
  const argv = process.argv; process.argv = [...argv, '--verify-resource-links', '--verification-deadline-ms=30000'];
  const contents: any = new EventEmitter(); contents.isDestroyed = () => false;
  const forbidden = () => { throw Error('Consumed profiles cannot trigger JS or native actions'); };
  for (const key of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[key] = forbidden;
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents }; let exit = -1;
  try {
    const receipt = await helper.verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: profile, source: {}, moduleStarted: Date.now(), startupErrors: [] });
    assert.equal(receipt.passed, false); assert.match(receipt.error, /consumed_initial_profile_must_be_preserved/); assert.equal(receipt.actions.length, 0); assert.equal(receipt.screenshots.length, 0); assert.equal(exit, 1);
    assert.equal(contents.listenerCount('before-input-event'), 0); assert.equal(contents.listenerCount('console-message'), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(profile, 'workspace-resource-links-expected.json'), 'utf8')), { cpuOnlyRejectionMarker: true });
  } finally { process.argv = argv; }
});

test('explicit recovery-special preparation uses existing Core/SQLite, preserves separate Note/Task recovery through automatic flush and reopening, and never starts execution', async t => {
  const profile = join(tmpdir(), 'review-workspace-native-related-source-' + randomUUID()), seed = await prepareWorkspaceNative(profile, { relatedResources: true }), fixture = helper.fixture(seed);
  assert.equal(seed.cases.length, 10); assert.equal(seed.shapeCases.length, 3); assert.equal(seed.expected.workspaces.length, 13); assert.equal(seed.cases.filter(entry => !entry.blockId).length, 1, 'Only Chat remains for native creation in this explicitly specialized fixture');
  assert.equal(seed.relatedValidation!.preflightSha256, preflight().sha256);
  const options = { path: join(profile, 'aerynth.sqlite'), privateRoot: profile, provider: 'codex' as const, contentPolicy: 'local-private' as const };
  let core = new BackendCore(options), open = true, commits = 0;
  t.after(async () => { if (open) await core.command('close', {}); });
  for (const id of [fixture.note.resourceId, fixture.task.resourceId]) {
    const read = async () => (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument;
    helper.assertRecovery(await read(), fixture.documents[id]);
    const session = new NoteSession(id, {
      readNote: read,
      saveNoteDraft: async input => (await core.command('notes', { name: 'saveNoteDraft', input })).result as any,
      commitNote: async input => { commits++; return (await core.command('notes', { name: 'commitNote', input })).result as NoteDocument; },
      discardNoteDraft: async input => (await core.command('notes', { name: 'discardNoteDraft', input })).result as NoteDocument,
    }, fixture.documents[id].resource);
    await session.flushEdits(); assert.equal(session.snapshot().phase, 'recovered'); helper.assertRecovery(await read(), fixture.documents[id]);
  }
  assert.equal(commits, 0); assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0);
  await core.command('close', {}); open = false; core = new BackendCore(options); open = true;
  for (const id of [fixture.note.resourceId, fixture.task.resourceId]) helper.assertRecovery((await core.command('notes', { name: 'readNote', input: id })).result, fixture.documents[id]);
  for (const [workspaceId, expected] of Object.entries(fixture.workspaces)) {
    const state = await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } }); assert.deepEqual(helper.workspace(state), expected);
  }
  assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0);
  const before = readFileSync(join(profile, 'workspace-native-seed.json')); await assert.rejects(prepareWorkspaceNative(profile, { relatedResources: true }), /existing_profiles_must_be_preserved/); assert.deepEqual(readFileSync(join(profile, 'workspace-native-seed.json')), before);
});
