import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture } from './fixture.mts';
import { mountChecklistExperience } from '../view.ts';
import { blockDocument } from '../../block-library/tests/component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { ChecklistPort } from '../../application-contract/checklist.ts';

const button = (root: any, label: string) => root.querySelectorAll('button').find((element: any) => element.textContent === label);
const inputNamed = (root: any, label: string) => root.querySelectorAll('input').find((element: any) => element.getAttribute('aria-label') === label);
async function setup(t: any, extras?: (state: ReturnType<typeof fixture>) => Pick<Parameters<typeof mountChecklistExperience>[3], 'chooseReference' | 'openReference'>) {
  const f = fixture(t), created = f.service.create({ commandId: randomUUID(), title: 'Synthetic working checklist' });
  const dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator(); let wakes = 0;
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake: () => { wakes++; } };
  const port: ChecklistPort = { create: async input => f.service.create(input), read: async id => f.service.read(id), mutate: async input => f.service.mutate(input) };
  const controller = mountChecklistExperience(dom.root, created.resourceId, port, { viewId: 'synthetic:view', motion, ...extras?.(f) });
  t.after(() => { controller.dispose(); restore(); });
  await until(() => dom.root.textContent.includes('Manual checklist.'));
  const frame = (count = 100) => { for (let index = 0; index < count; index++) { coordinator.step(1 / 60); controller.frame(); } };
  frame();
  const add = async (value: string) => {
    const form = dom.root.querySelector('.aw-checklist-add') as any; form.querySelector('input').value = value; form.onsubmit({ preventDefault() {} });
    await until(() => dom.root.querySelector('.aw-checklist-status').textContent.startsWith('Checklist saved.')); frame();
  };
  const row = (id: string) => dom.root.querySelectorAll('[data-checklist-entry-id]').find((element: any) => element.dataset.checklistEntryId === id) as any;
  return { f, dom, port, coordinator, controller, created, frame, add, row, wakes: () => wakes };
}

test('real service-backed viewer adds/edits/checks/reorders/groups and dates entries with retained nodes and host-driven shared motion', async t => {
  const s = await setup(t); await s.add('First entry'); await s.add('Second entry');
  const first = s.f.service.read(s.created.resourceId).entries[0], row = s.row(first.id), input = inputNamed(row, 'Checklist item text');
  input.value = 'Edited first entry'; input.oninput(); input.setSelectionRange(2, 7);
  button(row, 'Details').onclick(); assert.equal(row.querySelector('.aw-checklist-entry-details').inert, false); s.frame();
  const description = row.querySelector('textarea'); description.value = 'Manual details'; description.oninput();
  const priority = row.querySelectorAll('select')[0]; priority.value = 'high'; priority.onchange();
  const due = row.querySelectorAll('input').find((input: any) => input.type === 'date'); due.value = '2028-02-29'; due.onchange();
  button(row, 'Save changes').onclick(); await until(() => s.f.service.read(s.created.resourceId).entries[0].text === 'Edited first entry' && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false'); s.frame();
  assert.equal(s.row(first.id), row); assert.equal(inputNamed(row, 'Checklist item text'), input); assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]);
  const groupForm = s.dom.root.querySelector('.aw-checklist-groups') as any; groupForm.querySelector('input').value = 'Today'; groupForm.onsubmit({ preventDefault() {} });
  await until(() => s.f.service.read(s.created.resourceId).groups.length === 1 && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false');
  const groupId = s.f.service.read(s.created.resourceId).groups[0].id, group = row.querySelectorAll('select')[1]; group.value = groupId; group.onchange();
  button(row, 'Save changes').onclick(); await until(() => s.f.service.read(s.created.resourceId).entries[0].groupId === groupId && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false');
  const checkbox = row.querySelectorAll('input').find((input: any) => input.type === 'checkbox'); checkbox.checked = true; checkbox.onchange(); assert.equal(checkbox.checked, false, 'No checkmark success before canonical acknowledgment');
  await until(() => checkbox.checked === true);
  button(row, 'Move item down').onclick(); await until(() => s.f.service.read(s.created.resourceId).entries[1].id === first.id); s.frame();
  const saved = s.f.service.read(s.created.resourceId).entries[1]; assert.equal(saved.description, 'Manual details'); assert.equal(saved.priority, 'high'); assert.equal(saved.dueDate, '2028-02-29'); assert.equal(saved.completion!.basis, 'manual');
  assert.equal(s.f.count('notes'), 0); assert.equal(s.f.count('workspaces'), 0); assert.equal(s.f.count('blocks'), 0);
  assert.ok(s.wakes() > 0); assert.ok(s.coordinator.receipts.some(receipt => receipt.cause === 'checklist-layout'));
  for (const element of s.dom.root.querySelectorAll('button,input,textarea,select')) assert.equal(element.dataset.aerynthMotionControl, 'true');
});

test('group management and real source selection use canonical commands and preserve linked source identity through removal and revocation', async t => {
  let sourceId = ''; const opened: string[] = [];
  const s = await setup(t, f => { const source = f.kernel.createNote('Synthetic source note', 'Preserved source text'); sourceId = source.id;
    return { chooseReference: async () => ({ kind: 'resource', resourceId: source.id }), openReference: reference => { if (reference.kind === 'resource') opened.push(reference.resourceId); } }; });
  button(s.dom.root.querySelector('.aw-checklist-tools'), 'Link source').onclick();
  await until(() => s.f.service.read(s.created.resourceId).references.length === 1 && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false');
  button(s.dom.root, 'Synthetic source note').onclick(); assert.deepEqual(opened, [sourceId]);
  button(s.dom.root, 'Groups').onclick(); s.frame();
  const groupForm = s.dom.root.querySelector('.aw-checklist-groups') as any; groupForm.querySelector('input').value = 'First group'; groupForm.onsubmit({ preventDefault() {} });
  await until(() => s.f.service.read(s.created.resourceId).groups.length === 1 && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false');
  const groupId = s.f.service.read(s.created.resourceId).groups[0].id, select = s.dom.root.querySelectorAll('select').find((element: any) => element.getAttribute('aria-label') === 'Manage checklist group') as any;
  select.value = groupId; select.onchange(); const name = inputNamed(s.dom.root, 'Group name'); name.value = 'Renamed group'; name.oninput(); button(s.dom.root, 'Save group name').onclick();
  await until(() => s.f.service.read(s.created.resourceId).groups[0].title === 'Renamed group' && s.dom.root.querySelector('.aw-checklist').getAttribute('aria-busy') === 'false');
  button(s.dom.root, 'Remove group').onclick(); await until(() => s.f.service.read(s.created.resourceId).groups.length === 0);
  s.f.revoked.add(sourceId); await s.controller.refresh(); assert.equal(button(s.dom.root, 'Source unavailable').disabled, true); assert.equal(s.f.kernel.getResource(sourceId).note.content, 'Preserved source text');
});

test('a confirmed mutation followed by failed refresh is reported saved; an unconfirmed response retries the same receipt without duplicate entries', async t => {
  const s = await setup(t), read = s.port.read, mutate = s.port.mutate; let denyRead = true;
  s.port.read = async id => { if (denyRead) throw new Error('Synthetic post-commit read failure'); return read(id); };
  const form = s.dom.root.querySelector('.aw-checklist-add') as any; form.querySelector('input').value = 'Actually committed'; form.onsubmit({ preventDefault() {} });
  await until(() => s.dom.root.querySelector('.aw-checklist-status').textContent.startsWith('Change saved.'));
  assert.equal(s.f.service.read(s.created.resourceId).entries.length, 1); assert.equal(form.querySelector('input').value, ''); assert.equal(form.querySelector('button').disabled, true);
  denyRead = false; await s.controller.refresh(); assert.equal(form.querySelector('button').disabled, false);
  let lost = true; const commandIds: string[] = [];
  s.port.mutate = async input => { commandIds.push(input.commandId); const result = await mutate(input); if (lost) { lost = false; throw new Error('Synthetic lost acknowledgment'); } return result; };
  form.querySelector('input').value = 'Receipt-backed retry'; form.onsubmit({ preventDefault() {} }); await until(() => s.dom.root.querySelector('.aw-checklist-status').textContent.includes('could not be confirmed'));
  assert.equal(s.f.service.read(s.created.resourceId).entries.length, 2); assert.equal(form.querySelector('button').disabled, true);
  button(s.dom.root, 'Retry save').onclick(); await until(() => s.dom.root.querySelector('.aw-checklist-status').textContent.startsWith('Checklist saved.'));
  assert.equal(commandIds.length, 2); assert.equal(commandIds[0], commandIds[1]); assert.equal(s.f.service.read(s.created.resourceId).entries.length, 2); assert.equal(form.querySelector('input').value, '');
});
test('filters and closing disclosures become inert immediately, animate only on the host frame and remove only their own coordinator keys', async t => {
  const s = await setup(t); await s.add('An entry'); const id = s.f.service.read(s.created.resourceId).entries[0].id, row = s.row(id), panel = row.querySelector('.aw-checklist-entry-details');
  button(row, 'Details').onclick(); s.frame(); assert.equal(panel.hidden, false); button(row, 'Details').onclick(); assert.equal(panel.inert, true); assert.equal(panel.hidden, false); s.frame(); assert.equal(panel.hidden, true);
  const search = inputNamed(s.dom.root, 'Find checklist items'); search.value = 'No matching item'; search.oninput(); assert.equal(row.inert, true); s.frame(); assert.equal(row.hidden, true);
  search.value = ''; search.oninput(); s.frame(); assert.equal(row.hidden, false);
  const section = s.dom.root.querySelector('.aw-checklist') as any; s.controller.setActive(false); assert.equal(section.inert, true); s.frame(); assert.equal(section.hidden, true);
  s.controller.setActive(true); await until(() => section.hidden === false); s.frame(); assert.equal(section.inert, false);
  s.coordinator.add('host:unrelated', { x: 0, y: 0, w: 1, h: 1, lift: 0, yaw: 0, opacity: 1 }); s.controller.dispose(); assert.deepEqual([...s.coordinator.bodies.keys()], ['host:unrelated']);
  const source = readFileSync(new URL('../view.ts', import.meta.url), 'utf8'); assert.doesNotMatch(source, /requestAnimationFrame\s*\(|setTimeout\s*\(|setInterval\s*\(/);
});
test('concurrent edits preserve local text, require explicit conflict choice and never replace the retained editor during refresh', async t => {
  const s = await setup(t); await s.add('Saved original'); const entry = s.f.service.read(s.created.resourceId).entries[0], row = s.row(entry.id), input = inputNamed(row, 'Checklist item text');
  assert.equal(button(row, 'Use saved').hidden, true); assert.equal(button(row, 'Keep my edits').hidden, true);
  input.value = 'My local edit'; input.oninput(); input.setSelectionRange(3, 8);
  s.f.mutate(s.created.resourceId, [{ type: 'editEntry', entryId: entry.id, patch: { text: 'Other view edit' } }]); await s.controller.refresh();
  assert.equal(s.row(entry.id), row); assert.equal(input.value, 'My local edit'); assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 8]); assert.match(row.querySelector('.aw-checklist-conflict').textContent, /changed elsewhere/);
  assert.equal(button(row, 'Use saved').hidden, false); assert.equal(button(row, 'Keep my edits').hidden, false);
  button(row, 'Save changes').onclick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(s.f.service.read(s.created.resourceId).entries[0].text, 'Other view edit');
  button(row, 'Keep my edits').onclick(); assert.equal(button(row, 'Use saved').hidden, true); assert.equal(button(row, 'Keep my edits').hidden, true);
  button(row, 'Save changes').onclick(); await until(() => s.f.service.read(s.created.resourceId).entries[0].text === 'My local edit');
});
test('read-only/denied source capability and stale checkbox failures stay honest without losing local drafts', async t => {
  const s = await setup(t); await s.add('Saved text'); const entry = s.f.service.read(s.created.resourceId).entries[0], row = s.row(entry.id), input = inputNamed(row, 'Checklist item text');
  assert.equal(button(row, 'Link source').disabled, true); assert.match(button(row, 'Link source').title, /unavailable/);
  input.value = 'Unsaved local text'; input.oninput();
  s.port.mutate = async () => { throw Object.assign(new Error('stale'), { code: 'checklist_version_conflict' }); };
  const checkbox = row.querySelectorAll('input').find((input: any) => input.type === 'checkbox'); checkbox.checked = true; checkbox.onchange();
  await until(() => s.dom.root.querySelector('.aw-checklist-status').textContent.includes('changed elsewhere'));
  assert.equal(checkbox.checked, false); assert.equal(input.value, 'Unsaved local text'); assert.equal(s.f.service.read(s.created.resourceId).entries[0].checked, false);
  s.f.readOnly.add(s.created.resourceId); await s.controller.refresh(); assert.equal(checkbox.disabled, true); assert.equal(input.disabled, true); assert.equal(input.value, 'Unsaved local text');
  s.f.revoked.add(s.created.resourceId); await s.controller.refresh(); assert.equal(s.dom.root.querySelector('.aw-checklist-items').hidden, true); assert.match(s.dom.root.textContent, /unavailable/);
});
