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
  const result = preflight(); assert.equal(result.factories, 9); assert.equal(result.cases, 15); assert.deepEqual(result, preflight());
  assert.deepEqual(result.common, require('./workspace-approach-expressions.cjs').preflight());
  const source = readFileSync(new URL('./workspace-resource-links.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/); assert.doesNotMatch(source, /\.dispatchEvent\(|\.click\(\)|\.focus\(\)|\.value\s*=/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/);
});

test('disclosure Enter includes guarded native carriage-return char between key down/up and stops on guard rejection', () => {
  const events: object[] = [];
  const sequence = helper.activateDisclosure({ input(event: object) { events.push(event); } });
  assert.deepEqual(events, [{ type: 'keyDown', keyCode: 'Enter', modifiers: [] }, { type: 'char', keyCode: '\r', modifiers: [] }, { type: 'keyUp', keyCode: 'Enter', modifiers: [] }]);
  assert.deepEqual(sequence, events);
  const interrupted: object[] = [];
  assert.throws(() => helper.activateDisclosure({ input(event: object) { if (interrupted.length === 1) throw Error('native owner lost'); interrupted.push(event); } }), /native owner lost/);
  assert.equal(interrupted.length, 1, 'No character/up event bypasses the per-event owner guard');
});

test('Related readiness requires exact canonical source identity and settled busy state; edge observations retain exact direction/type/provenance', () => {
  const panel = { dataset: { resourceId: 'source' }, getAttribute: () => 'true' }, state = { relationships: [{ id: 'real-edge', source_id: 'source', target_id: 'task', kind: 'references', provenance: 'user' }] };
  const context = { document: { querySelector: () => panel }, window: { __aerynth: { application: () => state } } };
  assert.equal(runInNewContext(x.relatedReady('source'), context), false); panel.getAttribute = () => ''; assert.equal(runInNewContext(x.relatedReady('source'), context), true); assert.equal(runInNewContext(x.relatedReady('other'), context), false);
  assert.equal(runInNewContext(x.edgeExists('source', 'task', 'references'), context), true); assert.equal(runInNewContext(x.edgeExists('task', 'source', 'references'), context), false);
  state.relationships[0].provenance = 'inferred'; assert.equal(runInNewContext(x.edgeExists('source', 'task', 'references'), context), false);
  assert.equal(runInNewContext(x.edgeAbsent('real-edge'), context), false);
});

test('Related capture requires the existing contextual transition to settle and exact source/link controls to be fully painted in their real clip', () => {
  const node = (x: number, y: number, width: number, height: number): any => ({ value: { x, y, width, height }, textContent: 'Synthetic visible label', parentElement: null, style: { display: 'block', visibility: 'visible', opacity: '1' }, closest() { return this.hiddenAncestor || this.inertAncestor ? {} : null; }, getBoundingClientRect() { return this.value; } });
  const host = node(300, 250, 440, 400), body = node(318, 300, 404, 332);
  host.open = true; Object.assign(host.style, { width: '440px', height: '400px', background: 'actual computed background', backdropFilter: 'blur(22px)', transform: 'matrix(1,0,0,1,300,250)' });
  body.parentElement = host; Object.assign(body, { scrollTop: 0, clientHeight: 332, scrollHeight: 420 });
  const section = { dataset: { resourceId: 'source' }, busy: 'false', getAttribute() { return this.busy; } };
  const field = (x: number, y: number, width: number, height: number, parent = body) => { const value = node(x, y, width, height); value.parentElement = parent; return value; };
  const user: any = { target: field(318, 450, 240, 24), detail: field(318, 480, 260, 18), remove: field(630, 450, 80, 24) }, protectedRow: any = { target: field(318, 390, 240, 24), detail: field(318, 420, 260, 18) };
  const userFields: Record<string, any> = { '.aw-resource-links-target': user.target, small: user.detail, '[data-remove-link]': user.remove }, protectedFields: Record<string, any> = { '.aw-resource-links-target': protectedRow.target, small: protectedRow.detail };
  user.querySelector = (selector: string) => userFields[selector] ?? null;
  protectedRow.querySelector = (selector: string) => protectedFields[selector] ?? null;
  const fields: Record<string, any> = { '.aw-contextual-content': body, '.aw-resource-links': section, '.aw-contextual-heading > span': field(318, 264, 220, 20, host), '.aw-contextual-dismiss': field(692, 264, 28, 28, host), '.aw-resource-links-header h3': field(318, 310, 220, 20), 'input[aria-label="Find related resources"]': field(318, 340, 404, 30), '[data-relationship-id="edge"]': user, '[data-relationship-id="protected"]': protectedRow, '.aw-resource-links-create-toggle > summary': field(318, 650, 160, 24), '.aw-resource-links-help > summary': field(318, 690, 160, 24) };
  host.querySelector = (selector: string) => fields[selector] ?? null;
  const motion: any = { receipts: [{ resource: 'contextual:2:related-resources', transition: 17, status: 'settled' }] }, document = { hidden: false, hasFocus: () => true, fonts: { status: 'loaded' }, querySelector: () => host };
  const context = { document, innerWidth: 1602, innerHeight: 1002, getComputedStyle: (node: any) => node.style, window: { __aerynth: { snapshot: () => motion } } }, expected = { resourceId: 'source', edgeId: 'edge', membershipId: 'protected' };
  const probe = () => runInNewContext(x.relatedFrame(expected), context);
  let frame = probe(); assert.equal(frame.ready, true); assert.equal(frame.material.opacity, '1'); assert.equal(frame.items.length, 9); assert.equal(frame.addLink.visible, false, 'Off-clip disclosure is recorded honestly without replacing the required exact visible link controls');
  motion.receipts.push({ resource: 'ambient', status: 'started' }); assert.equal(probe().ready, true, 'Ambient motion is not a contextual settlement gate'); motion.receipts.pop();
  motion.receipts[0].status = 'retargeted'; assert.ok(probe().problems.includes('contextual-motion-unsettled')); motion.receipts[0].status = 'settled';
  host.style.opacity = '0.4'; frame = probe(); assert.equal(frame.ready, false); assert.equal(frame.material.opacity, '0.4'); host.style.opacity = '1';
  body.style.opacity = '0.8'; assert.equal(probe().ready, false); body.style.opacity = '1';
  host.style.height = '399px'; assert.ok(probe().problems.includes('host-dimensions-not-painted')); host.style.height = '400px';
  user.detail.value.y = 625; assert.ok(probe().problems.includes('edge:detail:clipped-or-transparent')); user.detail.value.y = 480;
  user.remove.inertAncestor = true; assert.ok(probe().problems.includes('edge:remove:clipped-or-transparent')); user.remove.inertAncestor = false;
  protectedRow.target.hiddenAncestor = true; assert.ok(probe().problems.includes('protected:target:clipped-or-transparent')); protectedRow.target.hiddenAncestor = false;
  section.dataset.resourceId = 'other'; assert.ok(probe().problems.includes('wrong-or-busy-source')); section.dataset.resourceId = 'source';
  section.busy = 'true'; assert.equal(probe().ready, false); section.busy = 'false';
  document.fonts.status = 'loading'; assert.ok(probe().problems.includes('fonts-loading')); document.fonts.status = 'loaded';
  frame = probe(); assert.equal(frame.ready, true); helper.assertFrameStable(frame, probe());
  assert.throws(() => helper.assertFrameStable(frame, { ...frame, ready: false }), /painted resting/);
  assert.throws(() => helper.assertFrameStable(frame, { ...frame, transition: { ...frame.transition, transition: 18 } }), /retargeted/);
  assert.throws(() => helper.assertFrameStable(frame, { ...frame, rendered: { ...frame.rendered, height: frame.rendered.height + 1 } }), /geometry changed/);
  assert.equal(runInNewContext(x.relatedResting(), context), false, 'Missing exact identities remain diagnostic observations, never qualifying capture state');
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
  assert.equal(seed.cases.length, 11); assert(seed.cases.some(entry=>entry.kind==='clock_timer'&&entry.resourceId&&entry.blockId));
  assert.equal(seed.shapeCases.length, 3); assert.equal(seed.expected.workspaces.length, 14); assert.equal(seed.cases.filter(entry => !entry.blockId).length, 1, 'Only Chat remains for native creation in this explicitly specialized fixture');
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
