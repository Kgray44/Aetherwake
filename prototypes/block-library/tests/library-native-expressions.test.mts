import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { expressions, compileExpression, preflight } = require('./library-native-expressions.cjs');
const { captureAllowed } = require('./library-native.cjs');

test('every A/C renderer factory and branch compiles in direct and actual guarded wait contexts', () => {
  const result = preflight();
  assert.equal(result.factories, 39); assert.equal(result.cases, 45);
  assert.deepEqual(result.names, Object.keys(expressions).sort());
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, preflight(), 'source preparation and native execution bind the same deterministic preflight');
});

test('the actual nested aria-label regression is rejected; JSON-encoded selectors reach querySelector unchanged', () => {
  const broken = '!!document.querySelector(".aw-library input[aria-label=\"Search workspace templates\"]")';
  assert.throws(() => compileExpression(broken), SyntaxError);
  for (const selector of ['.aw-library input[aria-label="Search workspace templates"]', '.aw-library input[aria-label="Search blocks"]', '[data-name="a\\b"]\n/* quote \' */']) {
    let observed: string | undefined;
    const source = expressions.exists(selector);
    assert.equal(compileExpression(source), source);
    assert.equal(runInNewContext(source, { document: { querySelector(value: string) { observed = value; return {}; } } }), true);
    assert.equal(observed, selector);
  }
});

test('quote/newline labels and resource IDs remain inert data in real host and value expressions', () => {
  const value = 'a"\'\n);throw Error("injected");//', id = 'synthetic"\nresource';
  const source = compileExpression(expressions.host('conversation', { name: 'readDraft', input: { resourceId: id } }));
  let request: unknown;
  const result = runInNewContext(source, { window: { aerynthHost: { command(command: string, input: unknown) { request = JSON.parse(JSON.stringify([command, input])); return value; } } } });
  assert.equal(result, value); assert.deepEqual(request, ['conversation', { name: 'readDraft', input: { resourceId: id } }]);
  assert.equal(runInNewContext(compileExpression(expressions.valueIs('textarea', value)), { document: { querySelector() { return { value }; } } }), true);
  assert.throws(() => compileExpression('x'.repeat(65537)), /bounded_renderer_expression/);
});

test('A/C helper routes every own js/wait call through the compiled factory catalog', () => {
  const source = readFileSync(new URL('./library-native.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:js|wait)\(\s*['"`]/);
  assert.match(source, /driver\.js\(compileExpression\(code\)\)/);
  assert.match(source, /driver\.wait\(compileExpression\(expression\)/);
});

test('failure diagnostics allow observed script errors only with healthy renderer/GPU; pass admission stays strict', () => {
  const healthy = { failed: false, contextLost: false, errorCount: 0 };
  assert.equal(captureAllowed(healthy), true);
  assert.equal(captureAllowed({ ...healthy, errorCount: 1 }), false);
  assert.equal(captureAllowed({ ...healthy, errorCount: 1 }, true), true);
  assert.equal(captureAllowed({ ...healthy, errorCount: 1 }, 'truthy'), false);
  for (const health of [{ ...healthy, failed: true }, { ...healthy, contextLost: true }, { ...healthy, errorCount: -1 }, { ...healthy, errorCount: NaN }, { ...healthy, errorCount: 0.5 }]) {
    assert.equal(captureAllowed(health, true), false); assert.equal(captureAllowed(health), false);
  }
});

test('native header coordinates admit pointer-transparent label fallthrough only to the same noninteractive card surface', () => {
  const card: any = {}, otherCard = {};
  const label = { getBoundingClientRect: () => ({ x: 100, y: 200, width: 80, height: 24 }), closest: () => null, contains: () => false };
  let interactive = false, hitCard: unknown = card;
  const ancestor = { closest(selector: string) { return selector === '[data-block]' ? hitCard : interactive ? {} : null; } };
  card.contains = (node: unknown) => node === label || node === ancestor;
  const context = { document: { querySelector: (selector: string) => selector === '.label' ? label : card, elementFromPoint: () => ancestor }, getComputedStyle: () => ({ visibility: 'visible' }) };
  assert.equal(runInNewContext(expressions.point('.label'), context), null, 'strict element hit correctly rejects a pointer-transparent label');
  assert.deepEqual(JSON.parse(JSON.stringify(runInNewContext(expressions.surfacePoint('.label', '.card'), context))), { x: 140, y: 212 });
  interactive = true; assert.equal(runInNewContext(expressions.surfacePoint('.label', '.card'), context), null, 'a real input/button is never treated as draggable card surface');
  interactive = false; hitCard = otherCard; assert.equal(runInNewContext(expressions.surfacePoint('.label', '.card'), context), null, 'overlapping foreign cards remain failures');
});

test('wheel admission observes real closing surfaces, active editing and exact background hit without changing focus', () => {
  let blocked = true, editing = false, focused = true, hitId = 'world';
  const context = { window: { __aerynth: { application: () => ({ navigation: { kind: 'workspace' }, viewport: { x: 4, y: -8, zoom: 1 } }) } }, document: {
    activeElement: { tagName: 'BUTTON', id: 'workspace-manager', className: '', closest: () => editing ? {} : null },
    hidden: false, hasFocus: () => focused, querySelector: () => blocked ? {} : null, querySelectorAll: () => [], elementFromPoint: () => ({ tagName: 'CANVAS', id: hitId, className: '' }),
  } };
  const observe = () => JSON.parse(JSON.stringify(runInNewContext(expressions.wheelContext({ x: 45, y: 220 }), context)));
  assert.equal(observe().ready, false, 'closing surface remains a blocker even after its Close button was clicked');
  blocked = false; assert.equal(observe().ready, true);
  editing = true; assert.equal(observe().ready, false, 'editor focus must be left through native input');
  editing = false; hitId = 'card'; assert.equal(observe().ready, false, 'a card is not empty background');
  hitId = 'world'; focused = false; assert.equal(observe().ready, false);
  focused = true; const ready = observe(); assert.deepEqual(ready.point, { x: 45, y: 220 }); assert.deepEqual(ready.viewport, { x: 4, y: -8, zoom: 1 });
});
