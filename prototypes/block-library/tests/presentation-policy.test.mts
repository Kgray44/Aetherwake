import test from 'node:test';
import assert from 'node:assert/strict';
import { blockComposition, blockApproachTarget, readableBody, type BlockFootprint } from '../presentation-policy.ts';
import { REGISTERED_BLOCKS } from '../registry.ts';
import { blockDocument, card } from './component-dom.mts';
import { blockIdentity } from '../identity-model.ts';
import { mountBlockIdentity } from '../identity-view.ts';
import type { Resource } from '../../application-contract/contracts.ts';

const small: BlockFootprint = { width: 160, height: 220, bodyWidth: 120, bodyHeight: 110, textScale: 1 };
const chat: Resource = { id: 'resource:retained-chat', kind: 'conversation', title: 'Synthetic retained Chat', version: 1, provider: 'local', content: '', messages: [{ id: 'message:actual', role: 'user', content: 'Exact canonical message', provenance: 'user' } as any] };

test('all registered kinds use body readability and a reachable Approach target, independent of canonical defaults', () => {
  assert.deepEqual(Object.keys(readableBody).sort(), REGISTERED_BLOCKS.map(value => value.kind).sort());
  for (const { kind } of REGISTERED_BLOCKS) {
    assert.equal(blockComposition(kind, { ...small, bodyHeight: 20 }), 'overview');
    const target = blockApproachTarget(kind, 1.5);
    assert.equal(blockComposition(kind, { width: 1000, height: 1000, bodyWidth: target.minimumBodyWidth, bodyHeight: target.minimumBodyHeight, textScale: 1.5 }, 'overview'), 'working');
  }
});
test('tall narrow Chat becomes an overview; actual short Chat and safe curved document body remain directly usable', () => {
  assert.equal(blockComposition('conversation', { ...small, height: 1000, bodyHeight: 900 }), 'overview');
  assert.equal(blockComposition('conversation', { width: 408, height: 257, bodyWidth: 368, bodyHeight: 112, textScale: 1 }), 'working');
  for (const kind of ['research', 'reference'] as const) assert.equal(blockComposition(kind, { width: 420, height: 420, bodyWidth: 265, bodyHeight: 140, textScale: 1 }), 'working');
  assert.equal(blockComposition('conversation', { width: 408, height: 257, bodyWidth: 368, bodyHeight: 112, textScale: 2 }), 'overview');
});
test('hysteresis holds a composition through small camera jitter and never withdraws focused/IME input', () => {
  let mode: 'working' | 'overview' = 'overview';
  for (const width of [232, 240, 254]) { mode = blockComposition('conversation', { ...small, width: 500, bodyWidth: width, bodyHeight: 200 }, mode); assert.equal(mode, 'overview'); }
  mode = blockComposition('conversation', { ...small, width: 500, bodyWidth: 256, bodyHeight: 200 }, mode);
  assert.equal(mode, 'working');
  for (const width of [250, 240, 225, 224]) { mode = blockComposition('conversation', { ...small, width: 500, bodyWidth: width, bodyHeight: 200 }, mode); assert.equal(mode, 'working'); }
  assert.equal(blockComposition('conversation', { ...small, width: 500, bodyWidth: 223, bodyHeight: 200 }, mode), 'overview');
  assert.equal(blockComposition('conversation', small, 'overview', true), 'working');
  assert.equal(blockComposition('conversation', { ...small, bodyWidth: 0 }, 'working'), 'working');
  assert.equal(blockComposition('conversation', { ...small, bodyWidth: NaN }, 'overview'), 'overview');
});
test('actual identity controller retains editor/caret/scroll through overview, focused/IME input, header focus and approach failure', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view);
  let calls = 0, target: unknown;
  const identity = mountBlockIdentity(f.article, { approach: async value => { calls++; target = value; throw Error('synthetic_camera_refusal'); } });
  t.after(() => { identity.dispose(); restore(); });
  const editor = f.editor;
  editor.value = 'Exact retained unsent text'; editor.setSelectionRange(2, 11); editor.scrollTop = 47;
  identity.update(blockIdentity({ kind: 'conversation', resource: chat }));
  f.open.focus();
  assert.equal(identity.setFootprint(small), 'overview', 'Header focus is not working input');
  assert.equal(editor.hasAttribute('inert'), true);
  assert.equal(view.root.querySelector('.aw-block-overview-content').textContent, 'YouExact canonical message');
  const button = view.root.querySelector('.aw-block-approach');
  button.onclick(); button.onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(target, { minimumBodyWidth: 256, minimumBodyHeight: 108 });
  assert.equal(button.disabled, false);
  assert.match(view.root.querySelector('.aw-block-approach-status').textContent, /Could not approach/);
  identity.setFootprint({ width: 408, height: 257, bodyWidth: 368, bodyHeight: 112, textScale: 1 });
  editor.focus();
  assert.equal(identity.setFootprint(small), 'working');
  assert.equal(editor.hasAttribute('inert'), false);
  editor.fire('compositionstart');
  f.open.focus();
  assert.equal(identity.setFootprint(small), 'working', 'IME survives a transient focus change');
  editor.fire('compositionend');
  assert.equal(f.article.dataset.blockComposition, 'overview');
  assert.equal(f.working.children.find((node: any) => node.tagName === 'TEXTAREA'), editor);
  assert.equal(editor.value, 'Exact retained unsent text');
  assert.deepEqual([editor.selectionStart, editor.selectionEnd, editor.scrollTop], [2, 11, 47]);
  identity.update({ ...blockIdentity({ kind: 'conversation', resource: chat }), phase: 'unavailable' });
  assert.equal(f.article.dataset.blockComposition, 'working', 'Existing unavailable/recovery controls retain their own lifecycle');
  assert.equal(editor.hasAttribute('inert'), false);
});
test('absent Approach integration retains direct working controls and disposal restores preexisting inert state', t => {
  const view = blockDocument(), restore = view.install(), f = card(view), identity = mountBlockIdentity(f.article, {});
  t.after(() => { identity.dispose(); restore(); });
  identity.update(blockIdentity({ kind: 'conversation', resource: chat }));
  assert.equal(identity.setFootprint(small), 'working');
  assert.equal(f.editor.hasAttribute('inert'), false);
  const second = mountBlockIdentity(f.article, { approach() {} });
  f.editor.setAttribute('inert', '');
  second.update(blockIdentity({ kind: 'conversation', resource: chat }));
  second.setFootprint(small); second.dispose();
  assert.equal(f.editor.hasAttribute('inert'), true);
});

test('a disposed overview never starts a queued camera approach or leaves listeners/inert children behind', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view);
  t.after(restore);
  let approaches = 0;
  const identity = mountBlockIdentity(f.article, { approach() { approaches++; } });
  identity.update(blockIdentity({ kind: 'conversation', resource: chat }));
  identity.setFootprint(small);
  view.root.querySelector('.aw-block-approach').onclick();
  identity.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(approaches, 0);
  assert.equal(f.editor.hasAttribute('inert'), false);
  assert.equal(view.root.querySelector('.aw-block-overview'), null);
  assert.equal(view.root.querySelector('.aw-block-approach'), null);
  for (const listeners of (f.article as any).listeners.values()) assert.equal(listeners.length, 0);
});
