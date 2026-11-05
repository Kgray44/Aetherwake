import test from 'node:test';
import assert from 'node:assert/strict';
import { mountManualTaskExperience, type ManualTaskPort } from '../manual-task-view.ts';
import type { Resource } from '../../application-contract/contracts.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

const initial = (): Resource => ({ id: 'synthetic:manual', kind: 'task', title: 'Synthetic manual review', version: 1, content: 'Root-owned description',
  taskStatus: 'open', taskPriority: 'normal', provider: 'local', messages: [] });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(t: any, configure?: (input: { read(): Resource | undefined; write(value: Resource | undefined): void; calls: unknown[] }) => Partial<ManualTaskPort>) {
  const dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator(), calls: unknown[] = [], visibility = new Set<() => void>();
  dom.doc.addEventListener = (name: string, run: () => void) => { if (name === 'visibilitychange') visibility.add(run); };
  dom.doc.removeEventListener = (name: string, run: () => void) => { if (name === 'visibilitychange') visibility.delete(run); };
  const create = dom.doc.createElement; dom.doc.createElement = (tag: string) => { const element = create(tag); element.style.setProperty = (key: string, value: string) => { element.style[key] = value; }; return element; };
  let resource: Resource | undefined = initial(); const values = { read: () => resource, write: (value: Resource | undefined) => { resource = value; }, calls };
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const port: ManualTaskPort = { readResource: () => resource, setTaskStatus: async input => { calls.push(input); resource = { ...resource!, version: resource!.version + 1, taskStatus: input.status }; },
    setTaskPriority: async input => { calls.push(input); resource = { ...resource!, version: resource!.version + 1, taskPriority: input.priority }; }, ...configure?.(values) };
  const description = dom.doc.createElement('textarea'); description.value = 'Root-owned description'; dom.root.append(description);
  const view = mountManualTaskExperience(dom.root, resource, port, { motion, viewId: 'synthetic:view' });
  t.after(() => { view.dispose(); restore(); });
  return { dom, coordinator, view, calls, values, visibility, description, button: () => dom.root.querySelector<HTMLButtonElement>('.aw-manual-task-toggle')!,
    priority: () => dom.root.querySelector<HTMLSelectElement>('select')!, section: () => dom.root.querySelector<HTMLElement>('.aw-manual-task')! };
}

test('manual dial commits through fresh canonical CAS, never advances pending status and keeps execution verification separate', async t => {
  const gate = deferred();
  const s = setup(t, values => ({ setTaskStatus: async input => { values.calls.push(input); await gate.promise; values.write({ ...values.read()!, version: 5, taskStatus: input.status }); } }));
  s.values.write({ ...initial(), version: 4, execution: { id: 'existing-execution', state: 'provider_completed', taskVerified: false } });
  s.button().onclick!({} as MouseEvent); await until(() => s.calls.length === 1);
  assert.deepEqual(s.calls[0], { resourceId: initial().id, expectedVersion: 4, status: 'done' });
  assert.equal(s.section().dataset.manualState, 'open'); assert(s.button().disabled);
  gate.resolve(); await s.view.flush(); assert.equal(s.section().dataset.manualState, 'done');
  assert.match(s.section().textContent!, /provider completed.*task verification is not established/);
  for (let frame = 0; frame < 100; frame++) { s.coordinator.step(1 / 60); s.view.frame(); }
  assert.equal(s.dom.root.querySelector('.aw-manual-task-dial').style['--aw-manual-progress'], '100%');
  assert.equal(s.values.read()!.content, 'Root-owned description'); assert.equal(s.calls.length, 1);
});

test('priority uses native controls, rolls conflicts back without retry and never replaces Root description or selection', async t => {
  let conflict = false;
  const s = setup(t, values => ({ setTaskPriority: async input => { values.calls.push(input); if (conflict) { values.write({ ...values.read()!, version: 8, taskPriority: 'low' }); throw Error('task_version_conflict'); }
    values.write({ ...values.read()!, version: 2, taskPriority: input.priority }); } }));
  s.description.focus(); s.description.setSelectionRange(2, 8);
  const priority = s.priority(); priority.value = 'high'; priority.onchange!({} as Event);
  assert.equal(priority.value, 'normal'); await s.view.flush(); assert.equal(priority.value, 'high');
  conflict = true; priority.value = 'urgent'; priority.onchange!({} as Event); await assert.rejects(s.view.flush(), /version_conflict/);
  assert.equal(priority.value, 'low'); assert.match(s.section().textContent!, /Task changed elsewhere/); assert.equal(s.calls.length, 2);
  s.view.setPresentation('focused'); s.view.setActive(false); s.view.setActive(true);
  assert.equal(s.dom.root.querySelector('textarea'), s.description); assert.equal(s.description.selectionStart, 2); assert.equal(s.description.selectionEnd, 8);
});

test('unavailable fresh reads and revocation stop actions, redact execution data and release only owned motion channels', async t => {
  const s = setup(t); s.coordinator.add('unrelated', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 });
  s.values.write(undefined); s.button().onclick!({} as MouseEvent); await assert.rejects(s.view.flush(), /access is unavailable/);
  assert.equal(s.calls.length, 0); assert.equal(s.section().dataset.manualState, 'unavailable'); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated']);
  s.view.update({ ...initial(), version: 2, execution: { id: 'private-reference', state: 'blocked', errorCode: 'PRIVATE_ERROR', taskVerified: false } });
  assert.match(s.section().textContent!, /PRIVATE_ERROR/);
  s.view.update({ ...initial(), version: 2, available: false }); assert.doesNotMatch(s.section().textContent!, /PRIVATE_ERROR/); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated']);
  const retained = s.button(); s.view.dispose(); retained.onclick!({} as MouseEvent); assert.equal(s.calls.length, 0);
});

test('hidden/inactive views own no scheduler or motion, reduced motion projects canonical state and disposal removes visibility listener', async t => {
  const s = setup(t); assert.equal(s.coordinator.bodies.size, 1);
  s.view.setActive(false); assert.equal(s.coordinator.bodies.size, 0); s.button().onclick!({} as MouseEvent); assert.equal(s.calls.length, 0);
  s.view.setActive(true); s.dom.doc.hidden = true; for (const listener of s.visibility) listener(); assert.equal(s.coordinator.bodies.size, 0);
  s.dom.doc.hidden = false; s.coordinator.reduced = true; for (const listener of s.visibility) listener();
  s.view.update({ ...initial(), version: 2, taskStatus: 'done' }); s.view.frame();
  assert.equal(s.dom.root.querySelector('.aw-manual-task-dial').style['--aw-manual-progress'], '100%');
  s.view.dispose(); assert.equal(s.coordinator.bodies.size, 0); assert.equal(s.visibility.size, 0); assert.equal(s.dom.root.querySelector('textarea'), s.description);
});

test('an acknowledgment without a new canonical projection cannot fabricate a Done state', async t => {
  const s = setup(t, values => ({ readResource: undefined, setTaskStatus: async input => { values.calls.push(input); } }));
  s.button().onclick!({} as MouseEvent); await s.view.flush(); assert.equal(s.section().dataset.manualState, 'open');
  assert.match(s.section().textContent!, /Waiting for the latest saved task state/);
  s.view.update({ ...initial(), version: 2, taskStatus: 'done' }); assert.equal(s.section().dataset.manualState, 'done');
  assert.throws(() => s.view.update({ ...initial(), id: 'other' }), /identity cannot change/);
});
