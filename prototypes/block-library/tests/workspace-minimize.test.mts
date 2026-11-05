import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url), helper = require('./workspace-minimize.cjs'), { expressions: x, preflight } = require('./workspace-minimize-expressions.cjs');

test('minimize preflight compiles Boolean branches and physical-size observations with every inherited expression before dispatch', () => {
  const p = preflight(); assert.equal(p.factories, 5); assert.equal(p.cases, 6);
  assert.deepEqual(p.common, require('./workspace-approach-expressions.cjs').preflight()); assert.deepEqual(p, preflight());
  const source = readFileSync(new URL('./workspace-minimize.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/);
  assert.doesNotMatch(source, /\.dispatchEvent\(|\.click\(\)|\.focus\(\)|\.value\s*=/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/);
});

test('Note mode observation uses the actual mode control and retained editor visibility, with no toggle when already writing', () => {
  let label = 'Read document'; const editor = { hidden: false, disabled: false }, button = { getAttribute: () => label };
  const root = { querySelector: (selector: string) => selector.includes('textarea') ? editor : button }, context = { document: { querySelector: () => root } };
  const observe = () => JSON.parse(JSON.stringify(runInNewContext(x.documentMode('[data-block="actual-note"]'), context)));
  assert.deepEqual(observe(), { mode: 'write', buttonLabel: 'Read document', editorHidden: false, editorDisabled: false });
  label = 'Edit document'; editor.hidden = true; assert.equal(observe().mode, 'read');
  editor.hidden = false; assert.equal(observe().mode, 'unavailable', 'Inconsistent or unfinished paint is not a usable editor');
});

test('size observations require actual physical shrink/effective overview and exact restored extent without writing DOM or geometry', () => {
  const node = { dataset: { blockMinimized: 'false', blockComposition: 'working' }, classList: { contains: () => false }, getBoundingClientRect: () => ({ x: 120, y: 220, width: 147, height: 147 }) };
  const context = { document: { querySelector: () => node } }, before = { width: 147, height: 147 };
  assert.equal(runInNewContext(x.shrunk('[data-block="circle"]', before), context), false);
  assert.equal(runInNewContext(x.restoredSize('[data-block="circle"]', before), context), true);
  node.dataset.blockMinimized = 'true'; node.dataset.blockComposition = 'overview';
  assert.equal(runInNewContext(x.shrunk('article', before), context), false, 'A stored flag or overview alone is not physical minimization');
  node.getBoundingClientRect = () => ({ x: 120, y: 220, width: 72.8, height: 72.8 });
  assert.equal(runInNewContext(x.shrunk('article', before), context), true);
  assert.equal(runInNewContext(x.restoredSize('article', before), context), false);
});

test('canonical transition verification rejects neighbor version changes, camera movement, data loss and missing flag/version acknowledgement', () => {
  const block = { id: 'target', version: 4, minimized: false, contentMode: 'reading', resource_id: 'real', x: 10, y: 20, width: 420, height: 420, shape: 'circle' };
  const state = { blocks: [block, { ...block, id: 'independent' }], resources: [{ id: 'real', content: 'Actual retained content' }], relationships: [], viewport: { x: -252.8571428571429, y: -468.57142857142856, zoom: .35 }, organization: { mode: 'freeform' }, presence: { id: 'system:vela', version: 1 }, activeWorkspaceId: 'workspace', navigation: { kind: 'workspace', workspaceId: 'workspace' }, history: [] };
  const minimized = structuredClone(state); minimized.blocks[0] = { ...block, version: 5, minimized: true, contentMode: 'summary' };
  helper.assertTransition(state, minimized, 'target', true);
  for (const mutate of [(s: any) => s.blocks[1].version++, (s: any) => s.viewport.x += .0001, (s: any) => s.resources.pop(), (s: any) => s.blocks[0].version--, (s: any) => s.blocks[0].minimized = false]) {
    const bad = structuredClone(minimized); mutate(bad); assert.throws(() => helper.assertTransition(state, bad, 'target', true));
  }
});

test('minimize mode chooses existing empty Chat/Note destinations and saved circle without substituting a fake placement', () => {
  const seed = { cases: [{ kind: 'conversation', workspaceId: 'chat' }, { kind: 'note', workspaceId: 'note' }], shapeCases: [{ kind: 'reference', shape: 'circle', workspaceId: 'circle', resourceId: 'reference', blockId: 'saved-circle' }] };
  const selected = helper.selectCases(seed); assert.deepEqual(selected, [...seed.cases, ...seed.shapeCases]); (selected[0] as any).blockId = 'new-native'; assert.equal((seed.cases[0] as any).blockId, undefined);
  assert.throws(() => helper.selectCases({ ...seed, shapeCases: [] }), /existing_chat_note_circle/);
});

test('fresh minimized Chat verifies durable draft before native Restore and hydrates only on activation, without inventing prior DOM identity', async () => {
  const events: string[] = []; let active = false;
  const entry = { kind: 'conversation', resourceId: 'canonical-chat', editorValue: 'Exact saved unsent draft' };
  const forbidden = () => { throw Error('A cold unmounted controller has no earlier editor state'); };
  const result = await helper.recoverEditor({ entry,
    readDraft: async (id: string) => { assert.equal(id, entry.resourceId); events.push('canonical draft'); return { content: entry.editorValue }; },
    probe: async () => { events.push('observe unmounted'); return { mounted: false, hydrated: false }; },
    rememberEditor: forbidden,
    restore: async () => { events.push('native Restore'); active = true; },
    waitForText: async () => { assert(active, 'No demand for hidden unmounted UI hydration'); events.push('exact hydrated text'); },
    sameNode: forbidden, retainedEditor: forbidden,
  });
  assert.deepEqual(events, ['canonical draft', 'observe unmounted', 'native Restore', 'exact hydrated text', 'canonical draft']);
  assert.equal(result.editorMountedBeforeRestore, false); assert.equal(result.sameExistingNode, null); assert.equal(result.retainedEditor, null); assert.equal(result.checkpointTextMatches, true);
});

test('fresh restore retains existing editor identity and never relaxes state checks for a hydrated controller', async () => {
  const entry = { kind: 'conversation', resourceId: 'canonical-chat', editorValue: 'Exact persisted draft' }, events: string[] = [];
  const ports = { entry, readDraft: async () => ({ content: entry.editorValue }), probe: async () => ({ mounted: true, hydrated: true }), rememberEditor: async () => { events.push('remember'); }, restore: async () => { events.push('native Restore'); }, waitForText: async () => { events.push('exact text'); }, sameNode: async () => true, retainedEditor: async () => ({ sameNode: true, sameText: true, sameSelection: true, scrollDelta: 0 }) };
  const result = await helper.recoverEditor(ports); assert.equal(result.sameExistingNode, true); assert.equal(result.retainedEditor.scrollDelta, 0); assert.deepEqual(events, ['remember', 'native Restore', 'exact text']);
  await assert.rejects(helper.recoverEditor({ ...ports, sameNode: async () => false }), /existing reopened editor/);
  await assert.rejects(helper.recoverEditor({ ...ports, retainedEditor: async () => ({ sameNode: true, sameText: true, sameSelection: false, scrollDelta: 0 }) }), /already hydrated/);
  await assert.rejects(helper.recoverEditor({ ...ports, retainedEditor: async () => ({ sameNode: true, sameText: true, sameSelection: true, scrollDelta: 2 }) }), /already hydrated/);
  events.length = 0;
  await assert.rejects(helper.recoverEditor({ ...ports, readDraft: async () => ({ content: 'Wrong draft' }) }), /Exact persisted Chat draft/); assert.deepEqual(events, [], 'A wrong canonical draft fails before native input');
});

test('explicit minimize dispatch rejects startup errors before any native operation and releases actual owner listeners', async () => {
  const argv = process.argv; process.argv = [...argv, '--verify-minimize', '--verification-deadline-ms=30000'];
  const contents: any = new EventEmitter(); contents.isDestroyed = () => false;
  const forbidden = () => { throw Error('No native operation permitted on rejection'); };
  for (const key of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[key] = forbidden;
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents };
  let exit = -1;
  try {
    const receipt = await require('./workspace-native.cjs').verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: join(tmpdir(), 'review-workspace-native-minimize-rejected'), source: {}, moduleStarted: Date.now(), startupErrors: ['Synthetic observed startup error'] });
    assert.equal(receipt.contract, 'aerynth.workspace-minimize-evidence@1'); assert.equal(receipt.passed, false); assert.match(receipt.error, /Observed startup/);
    assert.equal(receipt.actions.length + receipt.screenshots.length, 0); assert.equal(exit, 1); assert.equal(contents.listenerCount('before-input-event'), 0); assert.equal(contents.listenerCount('console-message'), 0);
  } finally { process.argv = argv; }
});
