import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { taskTrackerFixture } from './task-tracker-fixture.mts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import { mountTaskTrackerExperience } from '../task-tracker-view.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { TaskObjectiveDocument, TaskObjectivePort, MutateTaskObjective, TaskObjectiveReceipt, TaskObjectiveHistory } from '../../task-product/contracts.ts';

const button = (root: any, text: string) => root.querySelectorAll('button').find((value: any) => value.textContent === text);
const field = (root: any, tag: string, name: string) => root.querySelectorAll(tag).find((value: any) => value.getAttribute('aria-label') === name);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function setup(t: any, configure?: (f: ReturnType<typeof taskTrackerFixture>) => { port?: TaskObjectivePort; active?: boolean; pickers?: boolean }) {
  const f = taskTrackerFixture(t), configured = configure?.(f) ?? {}, dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose),
    target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  let document: TaskObjectiveDocument | null = null; const opened: string[] = [];
  const controller = mountTaskTrackerExperience(dom.root, f.created.resourceId, configured.port ?? f.port, { motion, viewId: 'synthetic:tracker', active: configured.active,
    ...(configured.pickers === false ? {} : { chooseSource: async () => f.ref(f.source.id), chooseAssignee: async () => ({ kind: 'principal' as const, principalId: 'synthetic:task-owner' }),
      chooseDependency: async () => { const dep = f.create(); return { resourceId: dep.resourceId, version: dep.version }; },
      chooseExistingExecution: async () => { const value = f.seedExistingExecution(); return { id: value.id, revision: value.revision }; } }),
    openResource: id => { opened.push(id); }, resourceTitle: id => id === f.source.id ? 'Synthetic evidence' : undefined, onProjection: value => { document = value; } });
  t.after(() => { controller.dispose(); restore(); });
  const settled = () => dom.root.querySelector('.aw-task-tracker').getAttribute('aria-busy') === 'false';
  const ready = () => until(() => !!document && settled());
  const changed = (version: number) => until(() => document!.resource.version === version && settled());
  const click = (text: string) => { const value = button(dom.root, text); assert(value, text); assert.equal(value.disabled, false, text + ' enabled'); value.onclick(); };
  const frame = () => { for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame(); } };
  return { f, dom, coordinator, controller, opened, settled, ready, changed, click, frame, get document() { return document; } };
}

test('Task Tracker keeps existing execution, manual verification and explicit acceptance separate on the actual canonical service', async t => {
  const s = await setup(t); await s.ready(); s.frame();
  s.f.desktop.apply({ type: 'createResource', kind: 'task', title: 'Existing manual Task', workspaceId: null }, () => { throw new Error('No conversation creation'); });
  const legacy = s.f.db.prepare("SELECT r.id,r.version FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE d.kind='task'").get()!;
  s.f.kernel.updateNote(String(legacy.id), '{"status":"complete","priority":"high","description":"Preserve exact legacy content"}', Number(legacy.version));
  const legacySnapshot = () => s.f.db.prepare('SELECT r.*,n.content,n.revision FROM resources r JOIN notes n ON n.resource_id=r.id WHERE r.id=?').get(String(legacy.id));
  const beforeLegacy = legacySnapshot();
  assert.match(s.dom.root.querySelector('.aw-task-objective').textContent, /inspected synthetic artifact/);
  assert.equal(s.document!.verification, 'unreviewed'); assert.equal(s.document!.acceptance.state, 'not-accepted');
  assert(!s.dom.root.querySelectorAll('button').some((value: any) => /^(Run|Start|Stop|Pause|Resume)$/.test(value.textContent)));
  s.click('Link existing execution'); await s.changed(2);
  const execution = s.document!.attempts[0].execution.current!; assert.equal(execution.state, 'provider_completed');
  assert.equal(s.document!.verification, 'unreviewed'); assert.equal(s.document!.acceptance.state, 'not-accepted');
  s.click('Review outcome'); const decision = field(s.dom.root, 'select', 'Decision'); decision.value = 'verified'; decision.onchange();
  const criterion = s.dom.root.querySelectorAll('input').find((value: any) => value.dataset.requirementId === 'criterion:one'); criterion.checked = true; criterion.onchange();
  s.click('Choose review evidence'); await until(() => s.dom.root.querySelectorAll('button').some((value: any) => value.textContent === 'Remove evidence'));
  const note = field(s.dom.root, 'textarea', 'Review note'); note.value = 'Synthetic manual inspection'; note.oninput();
  s.click('Record manual review'); await s.changed(3);
  assert.equal(s.document!.verification, 'verified'); assert.equal(s.document!.disposition, 'open'); assert.equal(s.document!.acceptance.state, 'not-accepted');
  s.click('Review acceptance'); const acceptance = s.dom.root.querySelectorAll('section').find((value: any) => value.dataset.taskPanel === 'acceptance');
  const check = acceptance.querySelector('input'); check.checked = true; check.onchange(); s.click('Confirm acceptance'); await s.changed(4);
  assert.equal(s.document!.acceptance.state, 'valid'); assert.equal(s.document!.disposition, 'accepted');
  assert.deepEqual(s.f.execution(execution.id), execution, 'Manual decisions never rewrite existing execution');
  s.click('Reopen objective'); await s.changed(5); assert.equal(s.document!.acceptance.state, 'historical');
  s.click('Close objective'); s.click('Confirm administrative close'); await s.changed(6);
  assert.equal(s.document!.disposition, 'cancelled'); assert.deepEqual(s.f.execution(execution.id), execution);
  s.click('History'); await until(() => s.dom.root.textContent.includes('6 whole versions loaded'));
  assert.equal(s.f.db.prepare('SELECT count(*) n FROM workspaces').get()!.n, 0); assert.equal(s.f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 0);
  assert.doesNotMatch(s.dom.root.textContent, /SYNTHETIC_PRIVATE_EVIDENCE_BODY|synthetic:thread|synthetic:turn/);
  assert.deepEqual(legacySnapshot(), beforeLegacy, 'Task Tracker leaves the existing manual Task identity, content and status unchanged');
});

test('definition editing preserves criterion identity, selects real references and retains unavailable bindings until explicit removal', async t => {
  const s = await setup(t); await s.ready(); s.click('Edit definition');
  const objective = field(s.dom.root, 'textarea', 'Objective'); objective.value = 'Edited actual objective'; objective.oninput();
  s.click('Choose assignee'); s.click('Add source'); await until(() => s.dom.root.querySelectorAll('.aw-task-binding').length >= 2);
  s.click('Record definition'); await s.changed(2);
  assert.equal(s.document!.definition.requirements[0].id, 'criterion:one'); assert.equal(s.document!.sources[0].reference!.resourceId, s.f.source.id);
  assert.equal(s.document!.assignees[0].reference!.kind, 'principal');
  s.f.denied.add(s.f.source.id); await s.controller.refresh(); s.click('Edit definition');
  assert.match(s.dom.root.textContent, /Unavailable saved reference/); assert.equal(button(s.dom.root, 'Record definition').disabled, true);
  const rows = s.dom.root.querySelectorAll('.aw-task-binding'), unavailable = rows.find((value: any) => value.textContent.includes('Unavailable saved reference') && value.querySelector('button'));
  button(unavailable, 'Remove reference').onclick(); assert.equal(button(s.dom.root, 'Record definition').disabled, false);
  s.click('Record definition'); await s.changed(3); assert.equal(s.document!.sources.length, 0); assert.equal(s.document!.assignees.length, 1);
  const before = s.f.db.prepare('SELECT count(*) n FROM notes').get()!.n; assert.equal(before, 1, 'Only fixture evidence Note exists; objective uses generic canonical resource');
});

test('own save snapshot before acknowledgment retains newer local typing; real competing definition needs an explicit choice', async t => {
  const ack = deferred<TaskObjectiveReceipt>(); let written: TaskObjectiveReceipt | null = null, first = true;
  const s = await setup(t, f => ({ port: { ...f.port, mutate: async value => { const result = f.service.mutate(value); if (first) { first = false; written = result; return ack.promise; } return result; } } }));
  await s.ready(); s.click('Edit definition'); const objective = field(s.dom.root, 'textarea', 'Objective'); objective.value = 'Submitted definition'; objective.oninput(); s.click('Record definition');
  await until(() => !!written); objective.value = 'Newer local definition'; objective.oninput(); objective.focus(); objective.setSelectionRange(4, 9); await s.controller.refresh();
  assert.equal(objective.value, 'Newer local definition'); assert.equal(button(s.dom.root, 'Keep my definition').hidden, true);
  assert.equal(s.dom.doc.activeElement, objective); assert.equal(objective.selectionStart, 4); assert.equal(objective.selectionEnd, 9);
  ack.resolve(written!); await s.changed(2); assert.equal(objective.value, 'Newer local definition'); assert.equal(s.controller.hasUnsavedChanges(), true);
  const current = s.f.service.read(s.f.created.resourceId); s.f.service.mutate({ resourceId: current.resource.id, expectedVersion: current.resource.version, commandId: randomUUID(),
    operation: { type: 'replaceDefinition', definition: s.f.definition({ objective: 'Competing definition' }) } });
  await s.controller.refresh(); assert.equal(objective.value, 'Newer local definition'); assert.equal(button(s.dom.root, 'Keep my definition').hidden, false); assert.equal(button(s.dom.root, 'Record definition').disabled, true);
  s.click('Keep my definition'); s.click('Record definition'); await s.changed(4); assert.equal(s.document!.definition.objective, 'Newer local definition');
});

test('a changed definition requires an explicit current review, and a late history response cannot republish revoked content', async t => {
  const late = deferred<TaskObjectiveHistory>(); let captured: TaskObjectiveHistory | null = null;
  const s = await setup(t, f => ({ port: { ...f.port, history: async value => { captured = f.service.history(value); return late.promise; } } }));
  await s.ready(); s.click('Review outcome'); const check = s.dom.root.querySelectorAll('input').find((value: any) => value.dataset.requirementId === 'criterion:one'); check.checked = true; check.onchange();
  s.f.service.mutate({ commandId: randomUUID(), resourceId: s.f.created.resourceId, expectedVersion: 1, operation: { type: 'replaceDefinition', definition: s.f.definition({ objective: 'New externally saved objective' }) } });
  await s.controller.refresh(); assert.equal(button(s.dom.root, 'Record manual review').disabled, true); assert.equal(button(s.dom.root, 'Review current definition').hidden, false);
  s.click('Review current definition'); assert.equal(check.checked, false); assert.equal(button(s.dom.root, 'Record manual review').disabled, false);
  s.click('History'); await until(() => !!captured); s.f.denied.add(s.f.created.resourceId); await s.controller.refresh(); late.resolve(captured!);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(s.document, null); assert.doesNotMatch(s.dom.root.textContent, /New externally saved objective|whole versions loaded/);
});

test('lost review acknowledgment retries the exact durable command once and an acknowledged save with read failure stays truthful', async t => {
  const inputs: MutateTaskObjective[] = []; let lost = true, denyRead = false;
  const s = await setup(t, f => ({ port: { ...f.port, read: async id => { if (denyRead) throw new Error('Synthetic read interruption'); return f.service.read(id); },
    mutate: async value => { inputs.push(structuredClone(value)); const receipt = f.service.mutate(value); if (lost) { lost = false; throw new Error('Synthetic lost acknowledgment'); } return receipt; } } }));
  await s.ready(); s.click('Review outcome'); const note = field(s.dom.root, 'textarea', 'Review note'); note.value = 'Synthetic needs-work review'; note.oninput();
  s.click('Record manual review'); await until(() => s.dom.root.textContent.includes('could not be confirmed')); await assert.rejects(s.controller.flush(), /needs confirmation/);
  s.click('Retry change'); await s.changed(2); assert.deepEqual(inputs[0], inputs[1]); assert.equal(s.document!.reviews.length, 1);
  denyRead = true; s.click('Close objective'); s.click('Confirm administrative close'); await until(() => s.dom.root.textContent.includes('Change recorded. Refresh'));
  assert.equal(s.f.service.read(s.f.created.resourceId).resource.version, 3); await assert.rejects(s.controller.flush(), /needs confirmation/);
  denyRead = false; await s.controller.refresh(); await s.controller.flush(); assert.equal(s.document!.disposition, 'cancelled');
});

test('external evidence and execution changes remain changed or unknown; access denial clears rendered data while retaining local edits', async t => {
  const s = await setup(t); await s.ready(); s.click('Edit definition'); s.click('Add source'); await until(() => s.dom.root.textContent.includes('Saved reference'));
  s.click('Record definition'); await s.changed(2); s.click('Link existing execution'); await s.changed(3);
  const execution = s.document!.attempts[0].execution.current!; s.f.seedExistingExecution(execution.resourceId, 'unknown', execution.id);
  const source = s.f.kernel.getResource(s.f.source.id); s.f.kernel.updateNote(s.f.source.id, 'Changed actual evidence body', source.resource.version);
  await s.controller.refresh(); assert.equal(s.document!.sources[0].freshness, 'changed'); assert.equal(s.document!.attempts[0].execution.current!.state, 'unknown'); assert.equal(s.document!.verification, 'unreviewed');
  s.click('Edit definition'); const objective = field(s.dom.root, 'textarea', 'Objective'); objective.value = 'Retained local edit'; objective.oninput();
  s.f.denied.add(s.f.created.resourceId); await s.controller.refresh(); assert.equal(s.document, null); assert.equal(objective.value, '');
  assert.doesNotMatch(s.dom.root.textContent, /Deliver an inspected|Synthetic evidence|Recorded state: unknown/);
  s.f.denied.delete(s.f.created.resourceId); await s.controller.refresh(); assert.equal(objective.value, 'Retained local edit');
  s.f.setWritable(false); await s.controller.refresh(); assert.equal(button(s.dom.root, 'Record definition').disabled, true); assert.equal(s.document!.canEdit, false);
  s.coordinator.add('unrelated:parent', { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 }); s.controller.dispose(); assert.deepEqual([...s.coordinator.bodies.keys()], ['unrelated:parent']);
});

test('inactive/stale reads publish no hidden work, unavailable pickers stay disabled, and motion is injected', async t => {
  let reads = 0; const late = deferred<TaskObjectiveDocument>();
  const s = await setup(t, f => ({ active: false, pickers: false, port: { ...f.port, read: async id => ++reads === 1 ? late.promise : f.service.read(id) } }));
  assert.equal(reads, 0); s.controller.setActive(true); await until(() => reads === 1); s.controller.setActive(false); late.resolve(s.f.service.read(s.f.created.resourceId));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(s.document, null); s.controller.setActive(true); await s.ready();
  assert.equal(button(s.dom.root, 'Link existing execution').disabled, true); s.click('Edit definition'); assert.equal(button(s.dom.root, 'Add source').disabled, true);
  const source = readFileSync(new URL('../task-tracker-view.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../task-tracker-view.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|new MotionCoordinator|ResizeObserver/); assert.doesNotMatch(css, /\btransition\s*:|\banimation\s*:/);
});
