import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../../workspace-engine/engine.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { mountDirectManipulation, type DirectGesturePresentation } from '../direct-manipulation.ts';
import { blockIdentity } from '../identity-model.ts';
import { mountBlockIdentity } from '../identity-view.ts';
import { mountBlockLibrary } from '../view.ts';
import type { AttachBlockInput, BlockLibraryHostPort, CreateBlockInput } from '../contracts.ts';
import { blockDocument, card } from './component-dom.mts';

function pointerDocument(t: TestContext) {
  const view = blockDocument();
  const restore = view.install();
  const previous = globalThis.Element;
  (globalThis as any).Element = view.root.constructor;
  t.after(() => {
    restore();
    if (previous === undefined) delete (globalThis as any).Element;
    else globalThis.Element = previous;
  });
  view.doc.documentElement = view.root;
  view.doc.body = view.root;
  const documentEvents = new Map<string, (event: any) => void>();
  view.doc.addEventListener = (name: string, listener: (event: any) => void) => documentEvents.set(name, listener);
  const proto = view.root.constructor.prototype;
  proto.closest = function (selectors: string) {
    for (let element = this; element; element = element.parentElement) {
      for (const selector of selectors.split(',')) {
        const data = selector.trim().match(/^\[data-([\w-]+)\]$/);
        if (data) {
          const key = data[1].replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
          if (key in element.dataset || element.hasAttribute(`data-${data[1]}`)) return element;
        } else if (element.matches(selector.trim())) return element;
      }
    }
    return null;
  };
  proto.setPointerCapture = function (id: number) { this.capturedPointer = id; };
  proto.hasPointerCapture = function (id: number) { return this.capturedPointer === id; };
  proto.releasePointerCapture = function () { delete this.capturedPointer; };
  return { ...view, documentEvents };
}

test('focused side release moves one existing placement, and keyboard/trash removal keep the resource and layout undo', async t => {
  const view = pointerDocument(t);
  const { article, editor } = card(view);
  const anchor = article.querySelector<HTMLButtonElement>('.resource-anchor')! as any;
  const kernel = WorkspaceKernel.open(':memory:');
  const engine = new WorkspaceEngine(kernel);
  t.after(() => kernel.close());
  const workspace = engine.createWorkspace('Synthetic side rail', null, { mode: 'freeform' });
  let current = engine.execute({
    type: 'createBlock', workspaceId: workspace.workspaceId, expectedRevision: workspace.revision,
    commandId: randomUUID(), resource: { kind: 'note', title: 'Side note', content: 'Retained text' },
    presentation: { x: 40, y: 440, width: 200, height: 120 },
  });
  const placement = current.blocks[0];
  const transitions: (DirectGesturePresentation | null)[] = [];
  let moves = 0, removals = 0, contexts = 0;
  const controller = mountDirectManipulation(article, {
    blockId: placement.blockId,
    state: () => current,
    focusedDrop: (x, y) => x > 220 ? { x, y } : null,
    preview() {},
    async commit(command) { current = engine.execute(command); moves++; },
    async remove() {
      current = engine.execute({
        type: 'detachBlock', blockId: placement.blockId, workspaceId: current.workspaceId,
        expectedRevision: current.revision, commandId: randomUUID(),
      });
      removals++;
    },
    cancel() {}, failed(error) { assert.fail(String(error)); },
    onGestureChange(value) { transitions.push(value); },
    context() { contexts++; },
  });
  t.after(() => controller.dispose());
  article.classList.add('selected', 'receded');
  anchor.fire('pointerdown', { button: 0, pointerId: 1, clientX: 40, clientY: 270 });
  anchor.fire('pointerup', { pointerId: 1, clientX: 50, clientY: 270 });
  assert.equal(moves, 0, 'Dropping on the rail cancels');
  anchor.fire('pointerdown', { button: 0, pointerId: 2, clientX: 40, clientY: 270 });
  anchor.fire('pointermove', { pointerId: 2, clientX: 840, clientY: 500 });
  assert.equal(controller.presentation()?.fromFocusedSide, true);
  assert.equal(engine.project(workspace.workspaceId).revision, current.revision);
  anchor.fire('pointerup', { pointerId: 2, clientX: 900, clientY: 550 });
  await until(() => moves === 1 && controller.presentation() === null);
  assert.equal(current.blocks.length, 1);
  assert.deepEqual([current.blocks[0].blockId, current.blocks[0].x, current.blocks[0].y], [placement.blockId, 800, 490]);
  assert.equal(transitions.filter(value => value?.fromFocusedSide && value.phase === 'committing').length, 1);

  article.classList.remove('receded');
  editor.fire('contextmenu', { button: 2 });
  assert.equal(contexts, 0);
  assert.equal((article as any).fire('contextmenu', { button: 2 }).defaultPrevented, true);
  assert.equal(contexts, 1);
  const pressDelete = (target: unknown) => view.documentEvents.get('keydown')!({
    key: 'Delete', target, preventDefault() {}, stopPropagation() {},
  });
  pressDelete(editor);
  assert.equal(removals, 0);
  pressDelete(article);
  await until(() => removals === 1 && !article.hasAttribute('aria-busy'));
  assert.equal(current.blocks.length, 0);
  assert.equal(kernel.getResource(placement.resourceId!).note.content, 'Retained text');
  current = engine.execute({ type: 'undoLayout', workspaceId: current.workspaceId, expectedRevision: current.revision, commandId: randomUUID() });
  assert.equal(current.blocks[0].blockId, placement.blockId);
  article.classList.add('expanded');
  const trash = article.querySelector('.aw-placement-trash')! as any;
  assert.equal(trash.getAttribute('aria-label'), 'Remove from workspace');
  trash.fire('click', { button: 0 });
  await until(() => removals === 2);
  assert.equal(kernel.getResource(placement.resourceId!).note.content, 'Retained text');
});

test('double-click on chrome uses the existing Approach action and leaves Open and editor input alone', async t => {
  const view = pointerDocument(t);
  const { article, editor, open, top } = card(view);
  let approached = 0;
  const identity = mountBlockIdentity(article, { approach() { approached++; } });
  t.after(() => identity.dispose());
  identity.update(blockIdentity({ kind: 'note', resource: { id: 'note:source', kind: 'note', provider: 'local', title: 'Source', version: 1, content: 'Content', messages: [] } }));
  editor.fire('dblclick', { button: 0 });
  open.fire('dblclick', { button: 0 });
  assert.equal(approached, 0);
  assert.equal(top.fire('dblclick', { button: 0 }).defaultPrevented, true);
  await until(() => approached === 1);
  assert.equal(open.textContent, 'Open ↗');
});

test('library drop uses the carried pose and one fenced canonical command, and stale or canceled drops do not add blocks', async t => {
  const view = pointerDocument(t);
  const coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = {
    get reduced() { return coordinator.reduced; },
    add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {},
  };
  const creates: CreateBlockInput[] = [];
  const attachments: AttachBlockInput[] = [];
  let revision = 7;
  const port: BlockLibraryHostPort = {
    capabilities: async () => ({ revision: 1, kinds: { note: { state: 'available' } }, providers: {}, velaPlanning: { state: 'unsupported' } }),
    async createBlock(input) {
      creates.push(input);
      return { workspaceId: input.workspaceId, resourceId: 'note:created', placementId: 'card:created' };
    },
    async findResources() {
      return { resources: [{ id: 'note:existing', version: 4, title: 'Existing note', kind: 'note', projectId: null }], nextCursor: null };
    },
    async attachBlock(input) {
      attachments.push(input);
      return { workspaceId: input.workspaceId, resourceId: input.resourceId, placementId: 'card:attached' };
    },
  };
  const origins: ('drop' | undefined)[] = [];
  const library = mountBlockLibrary(view.root, port, {
    workspaceId: 'workspace:source', expectedLayoutVersion: () => revision,
    drop: { motion, viewId: 'synthetic:drop', point: (x, y) => x > 600 ? { x, y } : null },
    onClose() {}, onCreated(_result, origin) { origins.push(origin); },
  });
  t.after(() => library.dispose());
  const note = () => view.root.querySelector('[data-block-kind="note"]');
  await until(() => !!note());
  assert.equal(note().dataset.libraryGrab, 'true');
  note().fire('pointerdown', { button: 0, pointerId: 1, clientX: 130, clientY: 300 });
  note().fire('pointermove', { pointerId: 1, clientX: 820, clientY: 540 });
  assert.equal(coordinator.bodies.size, 1);
  for (let i = 0; i < 70; i++) coordinator.step(1 / 60);
  library.frame();
  assert.match(view.root.querySelector('.aw-library__carried').style.transform, /translate/);
  assert.equal(creates.length, 0);
  note().fire('pointerup', { pointerId: 1, clientX: 900, clientY: 650 });
  assert.equal(note().fire('click').defaultPrevented, true);
  await until(() => origins.length === 1);
  assert.equal(origins[0], 'drop');
  assert.equal(creates[0].expectedLayoutVersion, 7);
  assert.deepEqual(creates[0].presentation, { x: 680, y: 470, width: 440, height: 360, shape: 'rounded' });
  assert.equal(coordinator.bodies.size, 0);

  note().fire('pointerdown', { button: 0, pointerId: 2, clientX: 130, clientY: 300 });
  revision++;
  note().fire('pointerup', { pointerId: 2, clientX: 900, clientY: 650 });
  note().fire('pointerdown', { button: 0, pointerId: 3, clientX: 130, clientY: 300 });
  note().fire('pointermove', { pointerId: 3, clientX: 900, clientY: 650 });
  note().fire('pointercancel', { pointerId: 3 });
  assert.equal(creates.length, 1);
  assert.equal(coordinator.bodies.size, 0);
  note().onclick();
  const attachDetails = view.root.querySelectorAll('details').find((item: HTMLDetailsElement) => item.querySelector('summary')?.textContent === 'Attach Existing');
  attachDetails.open = true;
  attachDetails.ontoggle();
  const attach = () => view.root.querySelector('[data-attach-resource]');
  await until(() => !!attach());
  attach().fire('pointerdown', { button: 0, pointerId: 4, clientX: 210, clientY: 300 });
  attach().fire('pointerup', { pointerId: 4, clientX: 950, clientY: 690 });
  await until(() => origins.length === 2);
  assert.equal(attachments[0].resourceId, 'note:existing');
  assert.equal(attachments[0].expectedResourceVersion, 4);
  assert.equal(attachments[0].expectedLayoutVersion, 8);
  assert.deepEqual(attachments[0].presentation, { x: 730, y: 510, width: 440, height: 360, shape: 'rounded' });
  assert.equal(creates.length, 1, 'Dropping the saved resource uses attachment');
});
