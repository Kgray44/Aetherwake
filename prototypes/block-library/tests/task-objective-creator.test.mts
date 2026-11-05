import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskTrackerFixture } from './task-tracker-fixture.mts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import { mountTaskObjectiveCreator, type TaskObjectiveCreator } from '../task-objective-creator.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { CreateTaskObjective } from '../../task-product/contracts.ts';

const button = (root: any, text: string) => root.querySelectorAll('button').find((value: any) => value.textContent === text);
const field = (root: any, tag: string, name: string) => root.querySelectorAll(tag).find((value: any) => value.getAttribute('aria-label') === name);
function setup(t: any, configure?: (f: ReturnType<typeof taskTrackerFixture>) => Partial<Parameters<typeof mountTaskObjectiveCreator>[1]>) {
  const f = taskTrackerFixture(t), dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator(), opened: string[] = [];
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const controller = mountTaskObjectiveCreator(dom.root, { port: f.port, motion, projectId: null, viewId: 'synthetic:task-creator', onCreated: id => { opened.push(id); }, ...configure?.(f) });
  t.after(() => { controller.dispose(); restore(); });
  const count = (table: string) => Number(f.db.prepare('SELECT count(*) n FROM ' + table).get()!.n);
  const submit = (title = 'Synthetic created outcome', objective = 'Deliver an explicitly inspected outcome') => {
    field(dom.root, 'input', 'Task title').value = title; field(dom.root, 'textarea', 'Objective').value = objective; dom.root.querySelector('form').onsubmit({ preventDefault() {} });
  };
  const status = () => dom.root.querySelector('.aw-task-create-status').textContent as string;
  return { f, dom, coordinator, opened, controller, submit, status, count };
}

test('creator records an explicit canonical objective and stable criteria in selected project scope without placement or implicit save', async t => {
  let projectId = '';
  const s = setup(t, f => ({ projectId: projectId = f.kernel.createProject('Synthetic selected project').id }));
  field(s.dom.root, 'input', 'Task title').value = 'Unsubmitted draft'; assert.equal(s.controller.hasUnsavedChanges(), true); await s.controller.flush();
  assert.equal(s.count('task_objective_documents'), 1, 'Only the preexisting fixture objective exists'); assert.equal(s.opened.length, 0);
  button(s.dom.root, 'Add requirement').onclick(); button(s.dom.root, 'Add requirement').onclick();
  const inputs = s.dom.root.querySelectorAll('input').filter((value: any) => value.getAttribute('aria-label') === 'Requirement text'); inputs[0].value = 'Remove this criterion'; inputs[1].value = 'Inspect actual outcome';
  button(s.dom.root, 'Remove requirement').onclick(); s.submit('  New canonical outcome  '); await until(() => s.opened.length === 1);
  const document = s.f.service.read(s.opened[0]); assert.equal(document.resource.title, 'New canonical outcome'); assert.equal(document.resource.projectId, projectId);
  assert.equal(document.definition.requirements.length, 1); assert.equal(document.definition.requirements[0].text, 'Inspect actual outcome'); assert.match(document.definition.requirements[0].id, /^criterion:/);
  assert.equal(document.verification, 'unreviewed'); assert.equal(document.disposition, 'open'); assert.equal(document.acceptance.state, 'not-accepted'); assert.equal(document.attempts.length, 0);
  assert.equal(s.count('notes'), 1, 'Only the existing evidence Note exists'); assert.equal(s.count('workspaces'), 0); assert.equal(s.count('blocks'), 0);
  assert.equal(s.controller.hasUnsavedChanges(), false); s.submit('No duplicate'); await s.controller.flush(); assert.equal(s.count('task_objective_documents'), 2);
  for (let i = 0; i < 100; i++) { s.coordinator.step(1 / 60); s.controller.frame(); } assert.equal(s.dom.root.querySelector('.aw-task-objective-creator').style.opacity, '1');
  assert(s.dom.root.querySelectorAll('input,textarea,button').every((value: any) => value.dataset.aerynthMotionControl === 'true'));
});

test('lost creation acknowledgment retains the exact command and complete definition for durable receipt retry', async t => {
  let lost = true; const inputs: CreateTaskObjective[] = [];
  const s = setup(t, f => ({ port: { ...f.port, create: async input => { inputs.push(structuredClone(input)); const receipt = f.service.create(input); if (lost) { lost = false; throw new Error('Synthetic lost creation acknowledgment'); } return receipt; } } }));
  button(s.dom.root, 'Add requirement').onclick(); field(s.dom.root, 'input', 'Requirement text').value = 'Keep the exact criterion'; s.submit();
  await until(() => s.status().includes('could not be confirmed')); assert.equal(s.count('task_objective_documents'), 2); assert.equal(s.opened.length, 0);
  await assert.rejects(s.controller.flush(), /needs confirmation/); assert.equal(field(s.dom.root, 'input', 'Task title').disabled, true);
  field(s.dom.root, 'textarea', 'Objective').value = 'Must not replace uncertain payload'; button(s.dom.root, 'Retry creation').onclick(); await until(() => s.opened.length === 1);
  assert.deepEqual(inputs[0], inputs[1]); assert.equal(s.f.service.read(s.opened[0]).definition.objective, 'Deliver an explicitly inspected outcome'); assert.equal(s.count('task_objective_documents'), 2);
  await s.controller.flush();
});

test('known policy rejection preserves entries, invalid requirements do no write, and failed opening never repeats creation or deadlocks flush', async t => {
  let controller: TaskObjectiveCreator, opens = 0;
  const s = setup(t, f => { f.deniedOperations.add('create'); return { onCreated: async () => { opens++; await controller.flush(); if (opens === 1) throw new Error('Synthetic navigation failure'); } }; }); controller = s.controller;
  button(s.dom.root, 'Add requirement').onclick(); s.submit(); assert.equal(s.count('task_objective_documents'), 1); assert.match(s.status(), /text for every added requirement/);
  field(s.dom.root, 'input', 'Requirement text').value = 'Explicit criterion'; s.submit(); await until(() => s.status().includes('current scope or policy'));
  assert.equal(field(s.dom.root, 'input', 'Task title').disabled, false); assert.equal(field(s.dom.root, 'input', 'Requirement text').value, 'Explicit criterion'); assert.equal(s.count('task_objective_documents'), 1);
  s.f.deniedOperations.delete('create'); s.submit(); await until(() => s.status().includes('Opening it did not finish')); assert.equal(s.count('task_objective_documents'), 2);
  button(s.dom.root, 'Open Task Tracker').onclick(); await until(() => opens === 2); await controller.flush(); assert.equal(s.count('task_objective_documents'), 2);
});

test('inactive/disposed creators do no hidden submission or late navigation and remove only borrowed motion keys', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let writes = 0;
  const s = setup(t, f => ({ active: false, port: { ...f.port, create: async input => { writes++; await gate; return f.service.create(input); } } }));
  s.submit(); assert.equal(writes, 0); s.controller.setActive(true); s.submit(); assert.equal(writes, 1); s.controller.setActive(false); release(); await s.controller.flush();
  assert.equal(s.count('task_objective_documents'), 2); assert.equal(s.opened.length, 0); s.controller.setActive(true); assert.equal(s.opened.length, 0, 'Reactivation does not navigate automatically');
  button(s.dom.root, 'Open Task Tracker').onclick(); await until(() => s.opened.length === 1);
  s.coordinator.add('unrelated:creator-parent', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 }); s.controller.dispose(); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated:creator-parent']);
  const source = readFileSync(new URL('../task-objective-creator.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../task-objective-creator.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|ResizeObserver/); assert.doesNotMatch(css, /\btransition\s*:|\banimation\s*:/);
});

test('service limits are enforced before submission and the largest supported explicit definition remains usable', async t => {
  let writes = 0; const s = setup(t, f => ({ port: { ...f.port, create: async value => { writes++; return f.service.create(value); } } }));
  s.submit('x'.repeat(201)); assert.equal(writes, 0); s.submit('Within limit', 'x'.repeat(8193)); assert.equal(writes, 0);
  for (let i = 0; i < 33; i++) button(s.dom.root, 'Add requirement').onclick();
  assert.equal(button(s.dom.root, 'Add requirement').disabled, true);
  const inputs = s.dom.root.querySelectorAll('input').filter((value: any) => value.getAttribute('aria-label') === 'Requirement text'); assert.equal(inputs.length, 32);
  for (const input of inputs) input.value = 'x'.repeat(2048); inputs[0].value += 'x'; s.submit(); assert.equal(writes, 0);
  inputs[0].value = 'x'.repeat(2048); s.submit('x'.repeat(200), 'x'.repeat(8192)); await until(() => s.opened.length === 1);
  const document = s.f.service.read(s.opened[0]); assert.equal(document.definition.requirements.length, 32); assert.equal(document.definition.objective.length, 8192); assert.equal(writes, 1);
});

test('dispose during pending creation preserves the actual write and receipt without late navigation', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const s = setup(t, f => ({ port: { ...f.port, create: async value => { await gate; return f.service.create(value); } } }));
  s.submit(); s.controller.dispose(); release(); await s.controller.flush();
  assert.equal(s.count('task_objective_documents'), 2); assert.equal(s.opened.length, 0); assert.equal(s.coordinator.bodies.size, 0);
});
