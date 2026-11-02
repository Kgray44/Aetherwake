import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './fixture.mts';
import { mountChecklistCreator, type ChecklistCreator } from '../creator.ts';
import { blockDocument } from '../../block-library/tests/component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ChecklistPort, CreateChecklist } from '../../application-contract/checklist.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';

const button = (root: any, label: string) => root.querySelectorAll('button').find((element: any) => element.textContent === label);
function setup(t: any, configure?: (f: ReturnType<typeof fixture>) => Partial<Parameters<typeof mountChecklistCreator>[1]>) {
  const f = fixture(t), dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator(), opened: string[] = [];
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose),
    target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const port: ChecklistPort = { create: async input => f.service.create(input), read: async id => f.service.read(id), mutate: async input => f.service.mutate(input) };
  const controller = mountChecklistCreator(dom.root, { port, motion, projectId: null, viewId: 'synthetic:creator', onCreated: id => { opened.push(id); }, ...configure?.(f) });
  t.after(() => { controller.dispose(); restore(); });
  const submit = (title: string) => { dom.root.querySelector('input').value = title; dom.root.querySelector('form').onsubmit({ preventDefault() {} }); };
  const status = () => dom.root.querySelector('.aw-checklist-create-status').textContent as string;
  return { f, dom, coordinator, controller, port, opened, submit, status };
}

test('creator explicitly saves a canonical conversation-linked Checklist without a placement, editor or provider and flush never submits implicitly', async t => {
  let conversationId = '', projectId = '';
  const s = setup(t, f => {
    projectId = f.kernel.createProject('Synthetic explicit creation scope').id;
    conversationId = f.kernel.createConversationRef('Synthetic source conversation', projectId).id;
    f.db.prepare('INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)').run(conversationId, 'conversation');
    return { projectId, conversationId };
  });
  s.dom.root.querySelector('input').value = 'Unsubmitted title'; await s.controller.flush();
  assert.equal(s.f.count('checklist_documents'), 0); assert.equal(s.opened.length, 0);
  s.submit('  Linked steps  '); await until(() => s.opened.length === 1);
  const doc = s.f.service.read(s.opened[0]);
  assert.equal(doc.resource.title, 'Linked steps'); assert.equal(doc.resource.projectId, projectId);
  assert.deepEqual(doc.references[0].target, { kind: 'conversation', resourceId: conversationId });
  assert.equal(doc.entries.length, 0); assert.equal(s.f.count('notes'), 0); assert.equal(s.f.count('workspaces'), 0); assert.equal(s.f.count('blocks'), 0);
  s.submit('No duplicate after success'); await s.controller.flush(); assert.equal(s.f.count('checklist_documents'), 1);
  for (let i = 0; i < 90; i++) { s.coordinator.step(1 / 60); s.controller.frame(); }
  assert.equal(s.dom.root.querySelector('.aw-checklist-creator').style.opacity, '1');
  assert.ok(s.dom.root.querySelectorAll('button').every((value: any) => value.dataset.aerynthMotionControl === 'true'));
});

test('lost creation acknowledgment retains its exact command and payload; explicit retry reads the same receipt and opens one resource', async t => {
  const inputs: CreateChecklist[] = []; let lost = true;
  const s = setup(t, f => ({ port: { create: async input => {
    inputs.push(structuredClone(input)); const result = f.service.create(input);
    if (lost) { lost = false; throw new Error('Synthetic lost creation acknowledgment'); } return result;
  }, read: async id => f.service.read(id), mutate: async input => f.service.mutate(input) } }));
  s.submit('One durable creation'); await until(() => s.status().includes('could not be confirmed'));
  assert.equal(s.f.count('checklist_documents'), 1); assert.equal(s.opened.length, 0);
  await assert.rejects(s.controller.flush(), /needs confirmation/);
  const title = s.dom.root.querySelector('input'); assert.equal(title.disabled, true); title.value = 'Must not replace the pending payload';
  button(s.dom.root, 'Retry creation').onclick(); await until(() => s.opened.length === 1);
  assert.deepEqual(inputs[0], inputs[1]); assert.equal(s.f.service.read(s.opened[0]).resource.title, 'One durable creation');
  assert.equal(s.f.count('resources'), 1); assert.equal(s.f.count('checklist_documents'), 1); await s.controller.flush();
});

test('known rejection retains editable title; navigation failure preserves creation and can reopen without another command or flush cycle', async t => {
  let reject = true, attempts = 0, opens = 0, controller: ChecklistCreator;
  const s = setup(t, f => ({ port: { create: async input => {
    attempts++; if (reject) throw Object.assign(new Error('Synthetic unavailable scope'), { code: 'checklist_reference_unavailable' }); return f.service.create(input);
  }, read: async id => f.service.read(id), mutate: async input => f.service.mutate(input) },
  onCreated: async () => { opens++; await controller.flush(); if (opens === 1) throw new Error('Synthetic navigation failure'); } }));
  controller = s.controller;
  s.submit('Preserve the title'); await until(() => s.status().includes('outside the permitted scope'));
  assert.equal(s.dom.root.querySelector('input').disabled, false); assert.equal(s.dom.root.querySelector('input').value, 'Preserve the title');
  assert.equal(s.f.count('checklist_documents'), 0); await controller.flush();
  reject = false; s.submit('Preserve the title'); await until(() => s.status().includes('Opening it did not finish'));
  assert.equal(s.f.count('checklist_documents'), 1); assert.equal(attempts, 2);
  button(s.dom.root, 'Open checklist').onclick(); await until(() => opens === 2); await controller.flush();
  assert.equal(attempts, 2); assert.equal(s.f.count('checklist_documents'), 1);
});

test('disposing a creator during an actual pending save releases motion and prevents late navigation; production has no independent scheduler', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s = setup(t, f => ({ port: { create: async input => { await gate; return f.service.create(input); }, read: async id => f.service.read(id), mutate: async input => f.service.mutate(input) } }));
  s.submit('Save before disposal'); assert.equal(s.f.count('checklist_documents'), 0);
  s.controller.dispose(); assert.equal(s.coordinator.bodies.size, 0); release(); await s.controller.flush();
  assert.equal(s.f.count('checklist_documents'), 1); assert.equal(s.opened.length, 0);
  const source = readFileSync(new URL('../creator.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../creator.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|ResizeObserver/);
  assert.doesNotMatch(css, /\btransition\s*:|\banimation\s*:/);
});
