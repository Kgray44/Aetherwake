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
import { workspaceNativePreparationSkip } from './workspace-native-prerequisites.mts';
const require = createRequire(import.meta.url), helper = require('./workspace-structured-grid.cjs'), { expressions: x, preflight } = require('./workspace-structured-grid-expressions.cjs');

test('Structured grid preflight exhausts finite read-only probes and inherits every shared expression before native dispatch', () => {
  const result = preflight(); assert.equal(result.factories, 2); assert.equal(result.cases, 4); assert.deepEqual(result, preflight());
  assert.deepEqual(result.common, require('./library-native-expressions.cjs').preflight());
  const source = readFileSync(new URL('./workspace-structured-grid.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/); assert.doesNotMatch(source, /\.dispatchEvent\(|\.click\(\)|\.focus\(\)|\.value\s*=/);
  assert.doesNotMatch(source, /x\.(?:execute|host)\(['"](?:desktop|execute|conversationSend|createConversation|connect|capabilities)['"]/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/); assert.match(source, /flag: 'wx'/);
  assert.match(readFileSync(new URL('./workspace-native.cjs', import.meta.url), 'utf8'), /includes\('--verify-structured-grid'\)/);
});

test('grid capture readiness requires exact rendered card/camera rest, arrival, Vela bounds and fonts without waiting for ambient motion', () => {
  const blocks = [0, 1, 2].map(index => ({ id: String(index), x: 100 + index * 400, y: 300, width: 280, height: 200 }));
  const state = { blocks, viewport: { x: -37, y: -75, zoom: 0.9 }, presence: { x: 1505, y: 337, width: 208, height: 260 } }, motion: any = { receipts: [], poses: {} };
  const nodes: Record<string, any> = {}, node = (value: object): any => ({ value, style: { opacity: '1', display: 'block', visibility: 'visible' }, closest: () => null, getBoundingClientRect() { return this.value; } });
  const project = (item: any) => ({ x: (item.x + 37) * 0.9, y: (item.y + 75) * 0.9, width: item.width * 0.9, height: item.height * 0.9 });
  for (const block of blocks) { const p = project(block); nodes['[data-block="' + block.id + '"]'] = node(p); motion.poses[block.id] = { x: p.x, y: p.y, w: p.width, h: p.height, lift: 0, yaw: 0, opacity: 1 }; }
  nodes['#vela'] = node(project(state.presence)); nodes['#stage'] = node({ x: 0, y: 0, width: 1602, height: 1002 });
  const document = { hidden: false, hasFocus: () => true, fonts: { status: 'loaded' }, querySelector: (selector: string) => nodes[selector] ?? null };
  const context = { document, innerWidth: 1602, innerHeight: 1002, getComputedStyle: (node: any) => node.style, window: { __aerynth: { application: () => state, snapshot: () => motion } } };
  const probe = () => runInNewContext(x.gridFrame(blocks.map(block => block.id)), context);
  assert.equal(probe().ready, true);
  motion.receipts.push({ resource: 'ambient', status: 'started' }); assert.equal(probe().ready, true);
  motion.receipts.push({ resource: '0', status: 'retargeted' }); assert.ok(probe().problems.includes('0:unsettled')); motion.receipts.pop();
  motion.poses['0'].x += 2; assert.ok(probe().problems.includes('0:unsettled')); motion.poses['0'].x -= 2;
  nodes['#vela'].value.x = 1580; assert.ok(probe().problems.includes('vela-unsettled-or-clipped')); nodes['#vela'].value = project(state.presence);
  nodes['#stage'].style.opacity = '0.4'; assert.ok(probe().problems.includes('arrival-unsettled')); nodes['#stage'].style.opacity = '1';
  document.fonts.status = 'loading'; assert.ok(probe().problems.includes('fonts-loading')); document.fonts.status = 'loaded';
  assert.equal(runInNewContext(x.gridResting(['other', '1', '2']), context), false); assert.equal(probe().ready, true);
});

test('mode and gesture assertions reject silent packing, changed shape/order/versions, camera/Vela or canonical edits', () => {
  const blocks = [{ id: 'note', resource_id: 'n', x: 77, y: 303, width: 367, height: 291, z: 7, version: 1, shape: 'folio' }, { id: 'task', x: 623, y: 315, width: 351, height: 177, version: 1, shape: 'pill' }, { id: 'reference', x: 1077, y: 357, width: 251, height: 251, version: 1, shape: 'circle' }];
  const before = { blocks, resources: [{ id: 'n', content: 'Exact' }], projects: [], workspaces: [], relationships: [], viewport: { x: -37, y: -75, zoom: 0.9 }, presence: { x: 1505, y: 337, width: 208, height: 260, version: 1 }, organization: { mode: 'freeform', gap: 12, structured: { order: [] } }, activeWorkspaceId: 'workspace' };
  const mode = { ...structuredClone(before), organization: { ...before.organization, mode: 'structured' } }; helper.assertPreserved(before, mode);
  const moved = structuredClone(mode); Object.assign(moved.blocks[0], { x: 144, y: 352, version: 2 }); helper.assertGesture(mode, moved, 'note', 'move');
  const resized = structuredClone(moved); Object.assign(resized.blocks[0], { width: 416, height: 320, version: 3 }); helper.assertGesture(moved, resized, 'note', 'resize');
  for (const patch of [{ blocks: mode.blocks.toReversed() }, { blocks: mode.blocks.map((block, i) => i ? block : { ...block, version: 2 }) }, { viewport: { ...mode.viewport, x: 0 } }, { presence: { ...mode.presence, y: 0 } }]) assert.throws(() => helper.assertPreserved(before, { ...mode, ...patch }));
  for (const mutate of [(s: any) => s.blocks[1].x++, (s: any) => s.blocks[0].shape = 'rectangle', (s: any) => s.blocks[0].x++, (s: any) => s.resources[0].content = 'Changed']) { const changed = structuredClone(moved); mutate(changed); assert.throws(() => helper.assertGesture(mode, changed, 'note', 'move')); }
});

test('Structured specialization prepares three real off-grid shapes and equivalent canonical operations persist exactly across Core restart without provider activity', { skip: workspaceNativePreparationSkip }, async t => {
  const profile = join(tmpdir(), 'review-workspace-native-grid-source-' + randomUUID()), seed = await prepareWorkspaceNative(profile, { structuredGrid: true }), fixture = helper.fixture(seed);
  assert.equal(seed.cases.length, 11); assert(seed.cases.some(entry=>entry.kind==='clock_timer'&&entry.resourceId&&entry.blockId));
  assert.equal(seed.shapeCases.length, 3); assert.equal(seed.expected.workspaces.length, 14); assert.equal(seed.expected.blocks.length, 3); assert.equal(Object.keys(seed.hashes).length, 7); assert.equal(seed.structuredGridValidation!.preflightSha256, preflight().sha256);
  const options = { path: join(profile, 'aerynth.sqlite'), privateRoot: profile, provider: 'codex' as const, contentPolicy: 'local-private' as const }; let core = new BackendCore(options), open = true;
  t.after(async () => { if (open) await core.command('close', {}); });
  let state = await core.command('desktop', { type: 'snapshot' }); assert.deepEqual(helper.workspace(state), helper.workspace(seed.expected));
  const beforeMode = state; state = await core.command('desktop', { type: 'setOrganization', workspaceId: fixture.workspaceId, expectedOrganizationRevision: state.organization!.revision, organization: { mode: 'structured' } }); helper.assertPreserved(beforeMode, state);
  const beforeMove = state, note = state.blocks.find(block => block.id === fixture.movingBlockId)!;
  state = await core.command('desktop', { type: 'geometry', blockId: note.id, expectedVersion: note.version, placement: { ...note, x: 185, y: 451 }, shape: note.shape }); helper.assertGesture(beforeMove, state, note.id, 'move');
  const beforeResize = state, moved = state.blocks.find(block => block.id === note.id)!;
  state = await core.command('desktop', { type: 'geometry', blockId: note.id, expectedVersion: moved.version, placement: { ...moved, width: 409, height: 333 }, shape: moved.shape }); helper.assertGesture(beforeResize, state, note.id, 'resize');
  assert.deepEqual((await core.command('notes', { name: 'readNote', input: fixture.document.resource.id })).result, fixture.document); assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0);
  await core.command('close', {}); open = false; core = new BackendCore(options); open = true;
  const restored = await core.command('desktop', { type: 'snapshot' }); assert.deepEqual(helper.workspace(restored), helper.workspace(state)); assert.deepEqual(helper.canonical(restored), helper.canonical(seed.expected));
  assert.deepEqual((await core.command('notes', { name: 'readNote', input: fixture.document.resource.id })).result, fixture.document);
  const bytes = readFileSync(join(profile, 'workspace-native-seed.json')); await assert.rejects(prepareWorkspaceNative(profile, { structuredGrid: true }), /existing_profiles_must_be_preserved/); assert.deepEqual(readFileSync(join(profile, 'workspace-native-seed.json')), bytes);
  await assert.rejects(prepareWorkspaceNative(join(tmpdir(), 'review-workspace-native-invalid-' + randomUUID()), { structuredGrid: true, relatedResources: true }), /invalid_preparation_options/);
});

test('Structured native mode rejects startup errors and either consumed-profile marker before renderer/native operations and releases listeners', async () => {
  const argv = process.argv; process.argv = [...argv, '--verify-structured-grid', '--verification-deadline-ms=30000'];
  try {
    for (const kind of ['startup', 'checkpoint', 'started']) {
      const profile = mkdtempSync(join(tmpdir(), 'review-workspace-native-grid-rejection-'));
      if (kind !== 'startup') writeFileSync(join(profile, kind === 'checkpoint' ? 'workspace-structured-grid-expected.json' : 'workspace-structured-grid-initial-started.json'), '{}', { flag: 'wx' });
      const contents: any = new EventEmitter(); contents.isDestroyed = () => false; const forbidden = () => { throw Error('Rejected grid mode cannot perform renderer/native operations'); };
      for (const key of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[key] = forbidden;
      const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents }; let exit = -1;
      const receipt = await require('./workspace-native.cjs').verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: profile, source: {}, moduleStarted: Date.now(), startupErrors: kind === 'startup' ? ['Synthetic observed error'] : [] });
      assert.equal(receipt.passed, false); assert.match(receipt.error, kind === 'startup' ? /Observed startup/ : /consumed_initial_profile/); assert.equal(receipt.actions.length + receipt.screenshots.length, 0); assert.equal(exit, 1); assert.equal(contents.listenerCount('before-input-event'), 0); assert.equal(contents.listenerCount('console-message'), 0);
    }
  } finally { process.argv = argv; }
});
