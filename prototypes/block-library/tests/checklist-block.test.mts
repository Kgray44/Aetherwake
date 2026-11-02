import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Resource } from '../../application-contract/contracts.ts';
import type { ChecklistPort } from '../../application-contract/checklist.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import { fixture } from '../../checklist-product/tests/fixture.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import { mountDirectResourceExperience, type DirectResourcePorts } from '../direct-resource-view.ts';
import { blockIdentity } from '../identity-model.ts';
import { mountBlockIdentity } from '../identity-view.ts';
import { blockAvailability, blockDefinition } from '../registry.ts';
import { blockDocument, card } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

test('direct Checklist views share canonical data without Notes or workspaces and borrow only their own host motion keys', async t => {
  const f = fixture(t), created = f.service.create({ commandId: randomUUID(), title: 'Synthetic independent checklist' });
  const dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; },
    add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  let reads = 0;
  const port: ChecklistPort = { create: async input => f.service.create(input),
    read: async id => { reads++; return f.service.read(id); }, mutate: async input => f.service.mutate(input) };
  const resource = (): Resource => { const r = f.service.read(created.resourceId).resource; return {
    id: r.id, kind: 'checklist', title: r.title, version: r.version, project_id: r.projectId, provider: 'local', content: '', messages: [],
  }; };
  const forbidden = () => { throw new Error('Checklist must never use a Note or manual Task controller.'); };
  const ports: DirectResourcePorts = { notes: {} as any, noteSession: forbidden, saveContent: forbidden,
    setTaskStatus: forbidden, setTaskPriority: forbidden, manageMembers: forbidden, openResource: forbidden };
  const a = mountDirectResourceExperience(dom.root, resource(), { ...ports, checklists: { port, motion, viewId: 'synthetic:direct:a' } });
  const second = document.createElement('div'); dom.root.append(second);
  const b = mountDirectResourceExperience(second, resource(), { ...ports, checklists: { port, motion, viewId: 'synthetic:direct:b' } });
  t.after(() => { a.dispose(); b.dispose(); restore(); });
  await until(() => second.textContent!.includes('Manual checklist.'));
  assert.equal(reads, 2, 'One canonical initial read per presentation');
  assert.equal(f.count('notes'), 0); assert.equal(f.count('workspaces'), 0); assert.equal(f.count('blocks'), 0);
  const form = dom.root.querySelector('.aw-checklist-add') as any;
  form.querySelector('input').value = 'Shared item'; form.onsubmit({ preventDefault() {} });
  await until(() => dom.root.querySelector('.aw-checklist-status').textContent.startsWith('Checklist saved.'));
  b.update(resource());
  await until(() => second.querySelectorAll('li').length === 1);
  const rowA = dom.root.querySelector('.aw-checklist-items li'), rowB = second.querySelector('li')!;
  assert.equal(rowA.dataset.entryId, rowB.dataset.entryId);
  assert.equal(f.service.read(created.resourceId).entries.length, 1);
  for (let i = 0; i < 90; i++) { coordinator.step(1 / 60); a.frame?.(); b.frame?.(); }
  assert.equal(dom.root.querySelector('.aw-checklist').style.opacity, '1');
  b.reflow?.(); await a.flush(); await b.flush();
  b.setActive(false); const before = reads; b.update({ ...resource(), version: resource().version + 1 });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, before, 'Inactive view performs no canonical reads');
  a.update({ ...resource(), available: false });
  assert.equal(dom.root.querySelector('.aw-direct-resource-body').hidden, true);
  await assert.rejects(a.flush(), /unavailable/);
  a.dispose();
  assert.ok([...coordinator.bodies.keys()].every(key => key.startsWith('checklist:synthetic:direct:b')));
  b.dispose(); assert.equal(coordinator.bodies.size, 0);
  assert.equal(f.count('resources'), 1); assert.equal(f.count('notes'), 0); assert.equal(f.count('blocks'), 0);
});

test('Checklist compact identity projects real subordinate entries without invoking Task completion controls and gates absent capabilities', t => {
  const f = fixture(t), created = f.service.create({ commandId: randomUUID(), title: 'Synthetic checklist identity' });
  f.mutate(created.resourceId, [{ type: 'addEntry', key: 'entry', entry: { text: 'Read the source', priority: 'high', dueDate: '2026-11-08' } }]);
  const doc = f.service.read(created.resourceId), resource: Resource = { id: created.resourceId, kind: 'checklist', title: doc.resource.title,
    version: doc.resource.version, provider: 'local', content: '', messages: [] };
  const model = blockIdentity({ kind: 'checklist', resource, checklist: doc });
  assert.equal(model.layout, 'ledger'); assert.equal(model.label, 'Checklist');
  assert.equal(model.rows[0].id, doc.entries[0].id); assert.match(model.rows[0].detail, /high.*2026-11-08/);
  assert.equal(model.rows[0].target, undefined); assert.equal(model.rows[0].checked, undefined);
  const dom = blockDocument(), restore = dom.install(), c = card(dom);
  const identity = mountBlockIdentity(c.article, { toggleTask: async () => { assert.fail('Subordinate checklist IDs are not Task IDs'); } });
  t.after(() => { identity.dispose(); restore(); }); identity.update(model);
  assert.equal(c.article.querySelectorAll('.aw-identity-check').length, 0);
  assert.equal(blockIdentity({ kind: 'checklist', resource }).phase, 'loading');
  const unavailable = blockIdentity({ kind: 'checklist', resource: { ...resource, available: false }, checklist: doc });
  assert.equal(unavailable.phase, 'unavailable'); assert.deepEqual(unavailable.rows, []);
  const manifest = blockDefinition('checklist'); assert.equal(manifest.defaultPresentation.shape, 'rounded');
  const caps = { revision: 1, kinds: {}, providers: {}, velaPlanning: { state: 'unsupported' as const } };
  assert.equal(blockAvailability('checklist', caps).state, 'unknown');
});
