import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDirectManipulation, type DirectGesturePresentation } from '../direct-manipulation.ts';
import { previewLayout, defaultOrganization } from '../../workspace-engine/organization.mts';
import { defaults } from '../../workspace-engine/geometry.mts';
import type { GestureState } from '../../workspace-engine/interaction.mts';
import type { Command, Presentation, LayoutState, OrganizationMode } from '../../workspace-engine/contracts.mts';
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
  const transitions: (DirectGesturePresentation | null)[] = [];
  let cancels = 0;
  const controller = mountDirectManipulation(article, {
    blockId: block.blockId, state: () => state,
    preview(value) { previews.push(value); },
    async commit(value) { commits.push(value); },
    cancel() { cancels++; }, failed(error) { throw error; },
    onGestureChange(value) { transitions.push(value); },
  });
  t.after(() => controller.dispose());
  const edge = article.querySelector('[data-resize-edge="se"]');
  // This minimal adapter's closest() lacks dataset presence selectors. Model
  // the real edge target explicitly; browser hit testing remains a host check.
  const closest = edge.closest.bind(edge);
  edge.closest = (selector: string) => selector === '[data-resize-edge]' ? edge : closest(selector);
  edge.fire('pointerdown', { button: 0, pointerId: 2, clientX: 10, clientY: 20 });
  assert.deepEqual(controller.presentation(), { blockId:block.blockId,intent:'resize',phase:'active' });
  article.fire('pointermove', { pointerId: 2, clientX: 25, clientY: 30 });
  article.fire('pointerup', { pointerId: 2, clientX: 40, clientY: 45 });
  assert.equal(controller.presentation()!.phase,'committing');
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
  assert.deepEqual(transitions.map(value => value?.phase ?? null),['active','committing',null]);
  assert(transitions.filter(Boolean).every(value => Object.isFrozen(value)), 'Presentation observers cannot mutate the controller lifecycle');
  edge.fire('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 20 });
  state = { ...state, revision: 6 };
  article.fire('pointerup', { pointerId: 3, clientX: 100, clientY: 100 });
  assert.equal(commits.length, 1, 'A stale workspace revision cancels, rather than committing the release');
  assert.equal(cancels, 1);
  assert.equal(controller.presentation(),null);
  const initialTransitions = transitions.length;
  article.fire('pointerdown', { button:0,pointerId:4,clientX:100,clientY:100 });
  article.fire('pointermove', { pointerId:4,clientX:102,clientY:101 });
  assert.equal(controller.presentation(),null,'An ordinary click or small pointer jitter does not pick up the card');
  article.fire('pointermove', { pointerId:4,clientX:130,clientY:120 });
  article.fire('pointermove', { pointerId:4,clientX:140,clientY:124 });
  assert.deepEqual(controller.presentation(),{blockId:block.blockId,intent:'move',phase:'active'});
  assert.equal(transitions.length,initialTransitions+1,'Move samples retarget the existing preview, not a lifecycle callback or animation loop per sample');
  documentEvents.get('keydown')!({ key:'Escape',preventDefault(){} });
  assert.equal(controller.presentation(),null);
  assert.equal(commits.length,1,'Escape never commits the outline or a partial pointer position');
  edge.fire('pointerdown', { button:0,pointerId:5,clientX:10,clientY:20 });
  article.fire('pointerup', { pointerId:5,clientX:10,clientY:20 });
  assert.equal(controller.presentation(),null,'No-op resize pickup releases presentation without a commit');
  article.fire('pointerdown', { button:0,pointerId:6,clientX:10,clientY:20 });
  article.fire('pointermove', { pointerId:6,clientX:30,clientY:40 });
  controller.dispose();
  assert.equal(controller.presentation(),null,'Disposal clears transient host lift/outline state');
  assert.equal(captured.size,0);
});

test('all three canonical organization previews retain a resolved target outline and never mutate saved geometry', () => {
  for (const mode of ['fluid','freeform','structured'] as OrganizationMode[]) {
    const block = { ...defaults,blockId:'block:outline',resourceId:'note:outline',workspaceId:'workspace:outline',version:7,resourceState:'active' as const,contentMode:'reading' as const,x:77,y:303,width:367,height:291 };
    const state: LayoutState = { revision:5,blocks:[block,{...block,blockId:'block:neighbor',x:800}],viewport:{x:-37,y:-75,zoom:0.9},organization:{...defaultOrganization(),mode},presence:{id:'system:vela',kind:'vela',workspaceId:block.workspaceId,version:1,x:1500,y:200,width:280,height:320,scale:0.65,locked:false} };
    const before = structuredClone(state);
    const preview = previewLayout(state,{ expectedRevision:5,intent:'move',placements:[{blockId:block.blockId,expectedVersion:7,presentation:{x:132,y:340}}] });
    const target = preview.blocks.find(value => value.blockId === block.blockId)!;
    assert.deepEqual(preview.placementAreas,[{x:target.x,y:target.y,width:target.width,height:target.height}],mode+': the existing policy remains the outline/target authority');
    assert.deepEqual(state,before,mode+': preview is noncanonical');
    assert.deepEqual(preview.blocks[1],state.blocks[1],mode+': unoccupied drag does not change its neighbor');
    if(mode==='structured') assert.deepEqual([target.x,target.y],[128,336],'Keep the existing16-unit grid while restoring the host spring');
  }
});
