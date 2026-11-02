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
  assert.equal(blockComposition('conversation', { ...small, width: 0 }, 'working'), 'working', 'Hidden projected card is not a measured body constraint');
  assert.equal(blockComposition('conversation', { ...small, bodyHeight: 0 }, 'working'), 'overview', 'A genuinely exhausted body still exposes header Approach');
  assert.equal(blockComposition('conversation', { ...small, bodyWidth: NaN }, 'overview'), 'overview');
});

test('short Tasks use the existing overview before their real controls clip, retaining live priority/editor input through resizing', t => {
  const view = blockDocument(), restore = view.install(), f = card(view);
  const priority = document.createElement('select'); priority.setAttribute('aria-label', 'Task priority'); f.working.append(priority);
  const identity = mountBlockIdentity(f.article, { approach() {} });
  t.after(() => { identity.dispose(); restore(); });
  const task: Resource = { id: 'resource:short-task', kind: 'task', title: 'Synthetic meaningful task name', version: 1, provider: 'local', messages: [], content: 'Exact description', taskStatus: 'open', taskPriority: 'normal' };
  identity.update(blockIdentity({ kind: 'task', resource: task }));
  const smallTask: BlockFootprint = { width: 315.9, height: 159.3, bodyWidth: 200, bodyHeight: 60, textScale: 1 };
  f.open.focus(); assert.equal(identity.setFootprint(smallTask), 'overview');
  assert.match(view.root.querySelector('.aw-block-overview-content').textContent, /Open/); assert.equal(priority.hasAttribute('inert'), true);
  assert.equal(identity.setFootprint({ ...smallTask, bodyHeight: 110 }), 'working'); priority.focus();
  assert.equal(identity.setFootprint(smallTask), 'working', 'An active priority field retains its working view and native control');
  assert.equal(priority.hasAttribute('inert'), false);
  f.editor.value = 'Exact in-progress Task description'; f.editor.setSelectionRange(3, 9); f.editor.scrollTop = 19; f.editor.focus();
  assert.equal(identity.setFootprint(smallTask), 'working');
  f.open.focus(); assert.equal(identity.setFootprint(smallTask), 'overview');
  assert.equal(f.working.querySelector('select'), priority); assert.equal(f.editor.value, 'Exact in-progress Task description'); assert.deepEqual([f.editor.selectionStart, f.editor.selectionEnd, f.editor.scrollTop], [3, 9, 19]);
  assert.equal(blockApproachTarget('task').minimumBodyHeight, 108);
  assert.equal(blockComposition('task', { ...smallTask, width: 500, bodyWidth: 400, bodyHeight: 170, textScale: 2 }), 'overview', 'Readable control height scales with the existing per-instance type scale');
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
  assert.equal(identity.setFootprint({ ...small, bodyHeight: 0 }), 'overview');
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
test('overview retains explicit accessible Open and its original handler when camera approach cannot fit', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view);
  let opened = 0;
  const original = () => { opened++; };
  f.open.onclick = original; f.open.setAttribute('aria-label', 'Original Open action');
  const identity = mountBlockIdentity(f.article, { approach() { throw Error('card_approach_needs_more_room'); } });
  t.after(() => { identity.dispose(); restore(); });
  identity.update(blockIdentity({ kind: 'conversation', resource: chat }));
  identity.setFootprint({ ...small, bodyHeight: 0 });
  assert.match(f.open.getAttribute('aria-label')!, /Open local chat in focused view/);
  assert.equal(f.open.parentElement, f.actions); assert.equal(f.open.hidden, false); assert.equal(f.open.hasAttribute('inert'), false);
  view.root.querySelector('.aw-block-approach').onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 0, 'A refused camera approach never silently expands');
  assert.equal(f.open.onclick, original); f.open.onclick(); assert.equal(opened, 1);
  identity.setFootprint({ width: 500, height: 400, bodyWidth: 420, bodyHeight: 250, textScale: 1 });
  assert.equal(f.open.getAttribute('aria-label'), 'Original Open action');
});
