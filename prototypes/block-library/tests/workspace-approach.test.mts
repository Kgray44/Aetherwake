import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const helper = require('./workspace-approach.cjs'), { expressions, preflight } = require('./workspace-approach-expressions.cjs');

test('Approach catalog compiles all own branches plus shared A/C expressions before native dispatch', () => {
  const result = preflight();
  assert.equal(result.factories, 9); assert.equal(result.cases, 13); assert.equal(result.common.factories, 38); assert.equal(result.common.cases, 44);
  assert.deepEqual(result, preflight());
  const source = readFileSync(new URL('./workspace-approach.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/); assert.match(source, /driver\.wait\(compileExpression\(code\)/);
});

test('retention observations compare the actual retained node, text, native selection and scroll without writing them', () => {
  const node = { value: 'Saved "quoted"\ntext', selectionStart: 3, selectionEnd: 6, scrollTop: 21 };
  const context = { window: {}, document: { querySelector() { return node; } } };
  assert.equal(runInNewContext(expressions.rememberNode('textarea'), context), true);
  runInNewContext(expressions.rememberEditor('textarea'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(runInNewContext(expressions.retainedEditor('textarea'), context))), { sameNode: true, sameText: true, sameSelection: true, scrollDelta: 0 });
  node.selectionStart = 0; node.scrollTop = 9;
  const changed = JSON.parse(JSON.stringify(runInNewContext(expressions.retainedEditor('textarea'), context)));
  assert.equal(changed.sameSelection, false); assert.equal(changed.scrollDelta, 12);
  const replacement = { ...node }; context.document.querySelector = () => replacement;
  assert.equal(runInNewContext(expressions.sameNode('textarea'), context), false, 'a rebuilt matching-value editor is not preservation');
});

test('explicit Approach mode rejects startup errors before JS/input and releases its actual Escape/console listeners', async () => {
  const argv = process.argv; process.argv = [...argv, '--verify-approach', '--verification-deadline-ms=30000'];
  const contents: any = new EventEmitter(); contents.isDestroyed = () => false;
  const forbidden = () => { throw Error('No native operation permitted on rejection'); };
  for (const key of ['executeJavaScript', 'sendInputEvent', 'capturePage', 'insertText']) contents[key] = forbidden;
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true, focus: forbidden, webContents: contents };
  let exit = -1;
  try {
    const receipt = await require('./workspace-native.cjs').verify({ win, app: { exit(code: number) { exit = code; } }, privateRoot: join(tmpdir(), 'review-workspace-native-approach-rejected'), source: {}, moduleStarted: Date.now(), startupErrors: ['Synthetic observed startup error'] });
    assert.equal(receipt.contract, 'aerynth.workspace-approach-evidence@1'); assert.equal(receipt.passed, false); assert.match(receipt.error, /Observed startup/);
    assert.equal(receipt.actions.length + receipt.screenshots.length, 0); assert.equal(exit, 1); assert.equal(contents.listenerCount('before-input-event'), 0); assert.equal(contents.listenerCount('console-message'), 0);
  } finally { process.argv = argv; }
});

test('existing fixture selection requires real Research plus saved pill Task and circle Reference; geometry assertions retain every block field', () => {
  const research = { kind: 'research', workspaceId: 'a', blockId: 'r', resourceId: 'rr' }, pill = { kind: 'task', shape: 'pill', workspaceId: 'b', blockId: 'p', resourceId: 'pp' }, circle = { kind: 'reference', shape: 'circle', workspaceId: 'c', blockId: 'c', resourceId: 'cc' };
  const seed = { cases: [research], shapeCases: [pill, circle] };
  assert.deepEqual(helper.selectCases(seed), [research, pill, circle]);
  assert.throws(() => helper.selectCases({ ...seed, shapeCases: [pill] }), /existing_research_pill_circle/);
  const state = { blocks: [{ id: 'r', resource_id: 'rr', x: 9, y: 16, width: 420, height: 420, rotation: 17, shape: 'circle', version: 8, locked: true, materialVariant: 'warm' }], organization: { mode: 'freeform' }, presence: { version: 1 }, viewport: { x: -200, y: -400, zoom: .35 } };
  assert.equal(helper.workspaceState(state).blocks, state.blocks); assert.deepEqual(helper.workspaceState(state), state);
});
