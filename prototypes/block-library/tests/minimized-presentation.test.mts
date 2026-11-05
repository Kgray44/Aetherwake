import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument, card } from './component-dom.mts';
import { blockIdentity } from '../identity-model.ts';
import { mountBlockIdentity, type BlockMinimizedPresentation } from '../identity-view.ts';
import type { Resource } from '../../application-contract/contracts.ts';
const note: Resource = { id: 'resource:retained-minimized', kind: 'note', title: 'Synthetic retained Note', version: 1, content: '# Actual authored heading\nExact text retained', provider: 'local', messages: [] };
const ready = () => blockIdentity({ kind: 'note', resource: note });
const roomy = { width: 600, height: 500, bodyWidth: 540, bodyHeight: 400, textScale: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('canonical minimize exposes its own kind-specific overview without Approach, retaining the same editor, value, caret, scroll and existing Open handler', t => {
  const view = blockDocument(), restore = view.install(), f = card(view), observations: BlockMinimizedPresentation[] = [];
  const originalOpen = () => {}; f.open.onclick = originalOpen;
  const identity = mountBlockIdentity(f.article, { restore: async () => {}, onMinimizedPresentationChange: state => observations.push(state) });
  t.after(() => { identity.dispose(); restore(); });
  identity.update(ready()); identity.setFootprint(roomy); f.editor.focus();
  f.editor.value = 'Retained unsent text'; f.editor.setSelectionRange(3, 9); f.editor.scrollTop = 53;
  assert.deepEqual(identity.setMinimized(true), { canonicalMinimized: true, effectiveMinimized: true, deferredReason: null });
  assert.equal(f.article.dataset.blockComposition, 'overview'); assert.equal(f.article.dataset.blockMinimized, 'true');
  assert.equal(f.editor.hasAttribute('inert'), true); assert.equal(f.open.onclick, originalOpen);
  assert.match(view.root.querySelector('.aw-block-overview-content').textContent, /Actual authored heading/);
  assert.equal(view.root.querySelector('.aw-block-approach').hidden, true);
  assert.equal(view.root.querySelector('.aw-block-restore').hidden, false);
  assert.equal(view.root.querySelector('.aw-block-restore').getAttribute('aria-label'), 'Restore note');
  identity.setMinimized(true); identity.setFootprint(roomy); identity.update(ready());
  assert.equal(observations.length, 1, 'No repeated coordinator wake for identical projection or footprint');
  assert(Object.isFrozen(observations[0]));
  identity.setMinimized(false);
  assert.equal(observations.length, 2); assert.equal(f.article.dataset.blockComposition, 'working');
  assert.equal(f.working.querySelector('textarea'), f.editor); assert.equal(f.editor.hasAttribute('inert'), false);
  assert.equal(f.editor.value, 'Retained unsent text'); assert.deepEqual([f.editor.selectionStart, f.editor.selectionEnd, f.editor.scrollTop], [3, 9, 53]);
});

test('IME defers physical shrink until final input settles and emits exactly one effective-minimized wake without remounting', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view), observations: BlockMinimizedPresentation[] = [];
  const identity = mountBlockIdentity(f.article, { onMinimizedPresentationChange: state => observations.push(state) });
  t.after(() => { identity.dispose(); restore(); }); identity.update(ready()); identity.setFootprint(roomy);
  f.editor.focus(); f.editor.fire('compositionstart');
  identity.setMinimized(true);
  assert.deepEqual(identity.minimizedPresentation(), { canonicalMinimized: true, effectiveMinimized: false, deferredReason: 'composition' });
  assert.equal(f.article.dataset.blockComposition, 'working'); assert.equal(f.editor.hasAttribute('inert'), false);
  f.editor.fire('compositionend');
  assert.equal(identity.minimizedPresentation().effectiveMinimized, false, 'No synchronous shrink during compositionend');
  f.editor.value = 'Final native composition'; f.editor.setSelectionRange(5, 5); f.editor.fire('input');
  await tick();
  assert.equal(identity.minimizedPresentation().effectiveMinimized, true); assert.equal(observations.filter(state => state.effectiveMinimized).length, 1);
  assert.equal(f.working.querySelector('textarea'), f.editor); assert.equal(f.editor.value, 'Final native composition'); assert.equal(f.editor.selectionStart, 5);
  identity.setMinimized(false); assert.equal(f.editor.hasAttribute('inert'), false);
});

test('a new composition or canceled canonical request fences the queued shrink, and unavailable recovery remains directly usable', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view), observations: BlockMinimizedPresentation[] = [];
  const identity = mountBlockIdentity(f.article, { onMinimizedPresentationChange: state => observations.push(state) });
  t.after(() => { identity.dispose(); restore(); });
  assert.equal(identity.setMinimized(true).deferredReason, 'uninitialized');
  identity.update({ ...ready(), phase: 'loading' }); assert.equal(identity.minimizedPresentation().deferredReason, 'loading');
  identity.update({ ...ready(), phase: 'unavailable' }); assert.equal(identity.minimizedPresentation().deferredReason, 'unavailable');
  assert.equal(f.article.dataset.blockComposition, 'working'); assert.equal(f.editor.hasAttribute('inert'), false);
  identity.update(ready()); identity.setMinimized(false); f.editor.fire('compositionstart'); identity.setMinimized(true);
  f.editor.fire('compositionend'); f.editor.fire('compositionstart'); await tick();
  assert.equal(identity.minimizedPresentation().deferredReason, 'composition');
  identity.setMinimized(false); f.editor.fire('compositionend'); await tick();
  assert.equal(identity.minimizedPresentation().canonicalMinimized, false); assert.equal(f.article.dataset.blockComposition, 'working');
  assert.throws(() => identity.setMinimized('true' as any), /invalid_canonical_minimized_flag/);
});

test('Restore requests one canonical command and never clears the flag optimistically or conceals failure', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view); let calls = 0, reject!: (error: Error) => void;
  const identity = mountBlockIdentity(f.article, { restore: () => { calls++; return new Promise<void>((_resolve, fail) => { reject = fail; }); } });
  t.after(() => { identity.dispose(); restore(); }); identity.update(ready()); identity.setMinimized(true);
  const button = view.root.querySelector('.aw-block-restore'); button.onclick(); button.onclick(); await tick();
  assert.equal(calls, 1); assert.equal(button.disabled, true); assert.equal(identity.minimizedPresentation().canonicalMinimized, true);
  reject(Error('Synthetic stale version')); await tick();
  assert.equal(button.disabled, false); assert.equal(identity.minimizedPresentation().effectiveMinimized, true);
  assert.match(view.root.querySelector('.aw-block-approach-status').textContent, /Could not restore.*retained/);
  identity.setMinimized(false); assert.equal(button.hidden, true);
});

test('queued Restore cannot cross canonical false/true replacement or disposal, which releases retained nodes and listeners', async t => {
  const view = blockDocument(), restore = view.install(), f = card(view); let calls = 0, wakes = 0;
  t.after(restore);
  const identity = mountBlockIdentity(f.article, { restore: async () => { calls++; }, onMinimizedPresentationChange() { wakes++; } });
  identity.update(ready()); identity.setMinimized(true); const button = view.root.querySelector('.aw-block-restore');
  button.onclick(); identity.setMinimized(false); identity.setMinimized(true); await tick(); assert.equal(calls, 0);
  button.onclick(); identity.dispose(); const finalWakes = wakes; identity.setMinimized(false); await tick();
  assert.equal(calls, 0); assert.equal(wakes, finalWakes); assert.equal(view.root.querySelector('.aw-block-restore'), null);
  assert.equal(f.editor.hasAttribute('inert'), false); assert.equal(f.working.querySelector('textarea'), f.editor);
  assert.equal(f.article.dataset.blockMinimized, undefined);
  for (const listeners of (f.article as any).listeners.values()) assert.equal(listeners.length, 0);
});
