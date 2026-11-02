import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDirectManipulation } from '../direct-manipulation.ts';
import { defaults } from '../../workspace-engine/geometry.mts';
import type { GestureState } from '../../workspace-engine/interaction.mts';
import type { Command, Presentation } from '../../workspace-engine/contracts.mts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

/** CPU event boundary only: no browser hit testing, native input or frame claim. */
test('fast edge release commits the final pointer position as one versioned gesture, preserving neighbors', async t => {
  const view = blockDocument();
  t.after(view.install());
  const oldElement = globalThis.Element;
  (globalThis as any).Element = view.root.constructor;
  t.after(() => { if (oldElement === undefined) delete (globalThis as any).Element; else globalThis.Element = oldElement; });
  const documentEvents = new Map<string, (event: any) => void>();
  view.doc.documentElement = view.root;
  view.root.style.userSelect = 'text';
  view.doc.addEventListener = (name: string, listener: (event: any) => void) => documentEvents.set(name, listener);
  const article = view.doc.createElement('article'), captured = new Set<number>();
  article.setPointerCapture = (id: number) => captured.add(id);
  article.hasPointerCapture = (id: number) => captured.has(id);
  article.releasePointerCapture = (id: number) => captured.delete(id);
  view.root.append(article);
  const block = { ...defaults, blockId: 'block:actual', resourceId: 'note:actual', workspaceId: 'workspace:actual', version: 7, contentMode: 'reading' as const, resourceState: 'active' as const, x: 80, y: 120, width: 440, height: 360 };
  let state: GestureState = { workspaceId: block.workspaceId, revision: 5, viewport: { x: -17, y: 33, zoom: 0.5 }, blocks: [block, { ...block, blockId: 'block:neighbor', x: 700 }] };
  const before = structuredClone(state), commits: Command[] = [], previews: Presentation[] = [];
  let cancels = 0;
  const controller = mountDirectManipulation(article, {
    blockId: block.blockId, state: () => state,
    preview(value) { previews.push(value); },
    async commit(value) { commits.push(value); },
    cancel() { cancels++; }, failed(error) { throw error; },
  });
  t.after(() => controller.dispose());
  const edge = article.querySelector('[data-resize-edge="se"]');
  // This minimal adapter's closest() lacks dataset presence selectors. Model
  // the real edge target explicitly; browser hit testing remains a host check.
  const closest = edge.closest.bind(edge);
  edge.closest = (selector: string) => selector === '[data-resize-edge]' ? edge : closest(selector);
  edge.fire('pointerdown', { button: 0, pointerId: 2, clientX: 10, clientY: 20 });
  article.fire('pointermove', { pointerId: 2, clientX: 25, clientY: 30 });
  article.fire('pointerup', { pointerId: 2, clientX: 40, clientY: 45 });
  await until(() => commits.length === 1 && !article.hasAttribute('aria-busy'));
  const command = commits[0];
  assert.equal(command.type, 'saveLayout');
  if (command.type !== 'saveLayout') throw Error('Wrong command');
  assert.equal(command.expectedRevision, 5);
  assert.equal(command.placements.length, 1);
  assert.equal(command.placements[0].expectedVersion, 7);
  assert.deepEqual([command.placements[0].presentation.width, command.placements[0].presentation.height], [500, 410]);
  assert.deepEqual([previews.at(-1)!.width, previews.at(-1)!.height], [500, 410]);
  assert.deepEqual(state, before, 'Pointer previews never mutate canonical state or neighboring cards');
  assert.equal(captured.size, 0);
  assert.equal(view.root.style.userSelect, 'text');
  assert.equal(cancels, 0);
  edge.fire('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 20 });
  state = { ...state, revision: 6 };
  article.fire('pointerup', { pointerId: 3, clientX: 100, clientY: 100 });
  assert.equal(commits.length, 1, 'A stale workspace revision cancels, rather than committing the release');
  assert.equal(cancels, 1);
});
