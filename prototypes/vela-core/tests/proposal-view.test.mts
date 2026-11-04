import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../block-library/tests/component-dom.mts';
import { createVelaProposalView, type VelaProposalChoice } from '../src/proposal-view.ts';
const proposal = (id = 'proposal:one'): VelaProposalChoice => ({ id, version: 1, question: 'I found these files. Would you like me to add them?', acceptLabel: 'Yes, add them',
  items: Array.from({ length: 7 }, (_, index) => ({ id: 'file:' + index, label: 'Project document ' + index + '.md', detail: 'Project / Docs' })) });
test('natural proposal previews four files, expands in place, and accepts the exact displayed binding once', async () => {
  const { doc, root } = blockDocument(), accepted: Readonly<VelaProposalChoice>[] = [];
  let finish!: () => void;
  const view = createVelaProposalView(doc, { accept: async value => { accepted.push(value); await new Promise<void>(resolve => { finish = resolve; }); }, decline: async () => { throw Error('Unexpected decline'); } }); root.append(view.element); view.update(proposal());
  const button = (name: string) => root.querySelectorAll('button').find((node: {textContent:string}) => node.textContent === name)!;
  const rows = root.querySelectorAll('li'); assert.equal(rows.filter((row: {hidden:boolean}) => !row.hidden).length, 4);
  const more = button('See all 7'); more.fire('click'); assert.equal(more.getAttribute('aria-expanded'), 'true'); assert.equal(rows.filter((row: {hidden:boolean}) => !row.hidden).length, 7);
  button('Yes, add them').fire('click'); button('Yes, add them').fire('click'); assert.equal(accepted.length, 1); assert.equal(accepted[0].items.length, 7);
  view.update(proposal('proposal:two')); assert.equal(accepted[0].id, 'proposal:one'); finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button('See all 7'), more); view.dispose();
});
test('decline has its own exact binding and withdrawn proposals erase filenames from the surface', async () => {
  const { doc, root } = blockDocument(), declined: string[] = [];
  const view = createVelaProposalView(doc, { accept: async () => { throw Error('Unexpected accept'); }, decline: async value => { declined.push(value.id); } }); root.append(view.element);
  const initial = proposal(), value = {...initial, items:[{ id: 'file:0', label: '<img src=private onerror=run()>' },...initial.items.slice(1)]}; view.update(value);
  assert.ok(root.textContent.includes('<img src=')); assert.equal(root.querySelectorAll('img').length, 0);
  root.querySelectorAll('button').find((node: {textContent:string}) => node.textContent === 'No')!.fire('click'); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(declined, [value.id]);
  view.update(null); assert.equal(root.textContent.includes('Project document'), false); assert.equal(root.textContent.includes('<img src='), false);
  assert.throws(() => view.update({ ...value, items: [] }), /proposal_items_invalid/); view.dispose();
});
