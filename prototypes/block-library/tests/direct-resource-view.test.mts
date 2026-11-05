import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { DesktopSnapshot, Resource } from '../../application-contract/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../../application-contract/motion.ts';
import { NoteSession } from '../note-session.ts';
import type { NoteDocument, NoteDraft, NoteExperiencePort } from '../note-contracts.ts';
import { mountDirectResourceExperience, type DirectResourceExperience, type DirectResourcePorts } from '../direct-resource-view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';

test('direct resource source matrix uses canonical unplaced content and existing controllers without layout or identity mutations', { timeout: 45000 }, async t => {
  // One retained bounded synthetic Core profile, never a live application or
  // provider turn. Caller admits512 MiB for the database/journal/receipt bound.
  const profile = mkdtempSync(join(tmpdir(), 'aerynth-direct-resource-source-'));
  t.diagnostic('Retained direct-resource source fixture: ' + profile);
  const core = new BackendCore({ path: join(profile, 'canonical.sqlite'), privateRoot: profile,
    provider: 'codex', contentPolicy: 'local-private' });
  const sessions = new Map<string, NoteSession>(), controllers = new Map<string, DirectResourceExperience>();
  let state: DesktopSnapshot = await core.command('desktop', { type: 'snapshot' });
  const sync = async () => {
    state = await core.command('desktop', { type: 'snapshot' });
    for (const [id, controller] of controllers) {
      const resource = state.resources.find(resource => resource.id === id);
      if (resource) controller.update(resource);
    }
  };
  const notes: NoteExperiencePort = {
    readNote: async id => (await core.command('notes', { name: 'readNote', input: id })).result as NoteDocument,
    saveNoteDraft: async input => (await core.command('notes', { name: 'saveNoteDraft', input })).result as NoteDraft,
    commitNote: async input => {
      const document = (await core.command('notes', { name: 'commitNote', input })).result as NoteDocument;
      await sync(); return document;
    },
    discardNoteDraft: async input => (await core.command('notes', { name: 'discardNoteDraft', input })).result as NoteDocument,
  };
  const calls: { saves: string[]; statuses: { resourceId: string; expectedVersion: number; status: 'open' | 'done' }[];
    priorities: { resourceId: string; expectedVersion: number; priority: NonNullable<Resource['taskPriority']> }[];
    manage: string[]; opens: string[] } = { saves: [], statuses: [], priorities: [], manage: [], opens: [] };
  let recorded = await core.command('replay', { after: 0, limit: 250 });
  const ports: DirectResourcePorts = {
    notes,
    noteSession(id) {
      let session = sessions.get(id);
      if (!session) {
        const resource = state.resources.find(resource => resource.id === id)!;
        session = new NoteSession(id, notes, resource); sessions.set(id, session);
      }
      return session;
    },
    saveContent(id, content, root) {
      assert(root.querySelector('.saved'));
      assert.equal(root.dataset.block, undefined);
      calls.saves.push(id); void sessions.get(id)!.edit(content);
    },
    readResource: id => state.resources.find(resource => resource.id === id && resource.available !== false && resource.visible !== false && resource.state !== 'archived'),
    async setTaskStatus(input) { calls.statuses.push(input); await core.command('desktop', { type: 'taskStatus', ...input }); await sync(); },
    async setTaskPriority(input) { calls.priorities.push(input); await core.command('desktop', { type: 'taskPriority', ...input }); await sync(); },
    manageMembers(id) { calls.manage.push(id); },
    openResource(id) { calls.opens.push(id); },
    events: {
      snapshot: () => ({ ...recorded, disconnected: false, projectId: 'unrelated-ambient-project',
        workspaceResourceIds: state.resources.map(resource => resource.id),
        resources: state.resources.map(resource => ({ id: resource.id, title: resource.title, projectId: resource.project_id ?? null })) }),
      async refresh() { recorded = await core.command('replay', { after: 0, limit: 250 }); },
    },
  };
  const resource = (kind: Resource['kind']) => state.resources.find(resource => resource.kind === kind)!;
  const mount = (target: Resource, supplied = ports) => {
    const dom = blockDocument(), restore = dom.install();
    const createElement = dom.doc.createElement.bind(dom.doc);
    dom.doc.createElement = (tag: string) => { const element = createElement(tag); element.style.setProperty = (name: string, value: string) => { element.style[name] = value; }; return element; };
    // Existing CPU-only document boundary omits global pointer listeners.
    dom.doc.addEventListener = () => {};
    dom.doc.removeEventListener = () => {};
    const controller = mountDirectResourceExperience(dom.root as HTMLElement, target, supplied);
    controllers.set(target.id, controller);
    return { dom, controller, close() { controllers.delete(target.id); controller.dispose(); restore(); } };
  };
  try {
    for (const kind of ['note', 'task', 'task_group', 'research', 'reference', 'stream'] as const)
      state = await core.command('desktop', { type: 'createResource', kind, title: 'Synthetic unplaced ' + kind, workspaceId: null });
    const task = resource('task'), group = resource('task_group'), note = resource('note');
    state = await core.command('desktop', { type: 'setTaskGroupMembers', groupId: group.id, expectedVersion: group.version, taskIds: [task.id] });
    await core.command('notes', { name: 'saveNoteDraft', input: { resourceId: note.id, expectedDraftVersion: 0,
      baseResourceVersion: note.version, content: 'Synthetic separate recovered text, opening must not promote this.' } });
    const recoveredBefore = (await core.command('notes', { name: 'readNote', input: note.id })).result;
    const baseline = JSON.parse(JSON.stringify(state));
    assert.equal(state.workspaces.length, 0); assert.equal(state.projects.length, 0); assert.equal(state.blocks.length, 0);

    for (const kind of ['note', 'task', 'task_group', 'research', 'reference', 'stream'] as const) await t.test(kind + ' opens without any workspace', async () => {
      const view = mount(resource(kind));
      try {
        assert.equal(view.dom.root.querySelector('.folio'), null);
        assert.equal(view.dom.root.dataset.block, undefined);
        assert.equal(view.dom.root.dataset.resourceId, resource(kind).id);
        assert.equal(view.dom.root.querySelector('.aw-direct-resource-status').textContent, '', 'Supported content mounts without a failed component boundary');
        if (kind === 'stream') assert(view.dom.root.querySelector('.aw-event-view'));
        else {
          await until(() => sessions.get(resource(kind).id)!.snapshot().phase !== 'loading');
          assert(view.dom.root.querySelector('textarea'));
          if (kind === 'task_group') assert(view.dom.root.querySelector('.aw-task-group'));
          if (kind === 'task') assert(view.dom.root.querySelector('.task-priority'));
        }
        await view.controller.flush();
      } finally { view.close(); }
    });
    await sync();
    assert.deepEqual(JSON.parse(JSON.stringify(state.resources)), baseline.resources);
    assert.equal(state.workspaces.length, 0); assert.equal(state.projects.length, 0); assert.equal(state.blocks.length, 0);
    assert.deepEqual((await core.command('notes', { name: 'readNote', input: note.id })).result, recoveredBefore);
    assert.deepEqual(calls.saves, []); assert.deepEqual(calls.statuses, []); assert.deepEqual(calls.priorities, []);

    await t.test('real Note edit/flush retains its canonical ID and same editor/session across visibility and updates', async () => {
      const view = mount(resource('note'));
      try {
        const editor = view.dom.root.querySelector('textarea');
        await until(() => sessions.get(note.id)!.snapshot().phase === 'recovered');
        editor.focus(); editor.setSelectionRange(2, 9); editor.scrollTop = 71;
        view.controller.setActive(false); view.controller.setActive(true); view.controller.update(resource('note'));
        assert.equal(view.dom.root.querySelector('textarea'), editor);
        assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 9); assert.equal(editor.scrollTop, 71);
        editor.value = 'Synthetic intentional direct edit.'; editor.oninput();
        await view.controller.flush();
        const saved = (await core.command('notes', { name: 'readNote', input: note.id })).result as NoteDocument;
        assert.equal(saved.resource.id, note.id); assert.equal(saved.resource.content, editor.value);
        assert.equal(saved.draft, null); assert.equal(sessions.get(note.id)!.hasPendingEdits, false);
        assert.throws(() => view.controller.update({ ...resource('note'), id: task.id }), /identity cannot change/);
      } finally { view.close(); }
    });

    await t.test('Task mutations use actual post-edit resource versions; TaskGroup uses the member version', async () => {
      const direct = mount(resource('task'));
      try {
        const editor = direct.dom.root.querySelector('textarea'), checkbox = direct.dom.root.querySelector('.task-completed');
        await until(() => sessions.get(task.id)!.snapshot().phase !== 'loading');
        editor.value = 'Synthetic direct task description.'; editor.oninput();
        checkbox.checked = true; checkbox.onchange();
        await until(() => resource('task').taskStatus === 'done' && !checkbox.disabled);
        assert.equal(calls.statuses.at(-1)!.resourceId, task.id);
        assert.equal(calls.statuses.at(-1)!.expectedVersion, resource('task').version - 1);
        const priority = direct.dom.root.querySelector('.task-priority');
        priority.value = 'urgent'; priority.onchange();
        await until(() => resource('task').taskPriority === 'urgent' && !priority.disabled);
        assert.equal(calls.priorities.at(-1)!.expectedVersion, resource('task').version - 1);
        await until(() => sessions.get(task.id)!.snapshot().document?.resource.version === resource('task').version);
      } finally { direct.close(); }
      const checklist = mount(resource('task_group'));
      try {
        const member = checklist.dom.root.querySelectorAll('input').find((input: any) => input.type === 'checkbox');
        const expectedVersion = resource('task').version;
        member.checked = false; member.onchange();
        await until(() => resource('task').taskStatus === 'open' && !member.disabled);
        assert.equal(calls.statuses.at(-1)!.expectedVersion, expectedVersion);
        assert.notEqual(calls.statuses.at(-1)!.expectedVersion, resource('task_group').version);
      } finally { checklist.close(); }
    });

    await t.test('shared manual Task instrument flushes the real description before CAS and retains editor identity', async () => {
      const poses = new Map<string, ExperiencePose>();
      const motion: ExperienceMotionPort = { reduced: true, add: (key, pose) => { poses.set(key, pose); }, target: (key, pose) => { poses.set(key, pose); },
        pose: key => poses.get(key)!, remove: key => { poses.delete(key); }, wake() {} };
      const view = mount(resource('task'), { ...ports, manualTasks: { motion, viewId: 'synthetic:direct-manual-task' } });
      try {
        await until(() => sessions.get(task.id)!.snapshot().document?.resource.version === resource('task').version && !sessions.get(task.id)!.snapshot().dirty);
        const editor = view.dom.root.querySelector('textarea'), toggle = view.dom.root.querySelector('.aw-manual-task-toggle');
        editor.value = 'Synthetic description retained by the shared manual Task instrument.'; editor.oninput();
        toggle.onclick();
        await until(() => resource('task').taskStatus === 'done' && !toggle.disabled);
        assert.equal(resource('task').content, editor.value);
        assert.equal(view.dom.root.querySelector('textarea'), editor);
        assert.equal(calls.statuses.at(-1)!.expectedVersion, resource('task').version - 1);
        assert.match(view.dom.root.querySelector('.aw-manual-task').textContent, /Done manually/);
        const priority = view.dom.root.querySelector('.aw-manual-task-priority').querySelector('select');
        priority.value = 'high'; priority.onchange();
        await until(() => resource('task').taskPriority === 'high' && !priority.disabled);
        assert.equal(calls.priorities.at(-1)!.expectedVersion, resource('task').version - 1);
        await view.controller.flush(); view.controller.setActive(false); assert.equal(poses.size, 0);
      } finally { view.close(); }
      assert.equal(poses.size, 0);
    });

    await t.test('unknown families never become a generic editor; revocation suspends existing content and pending actions', async () => {
      for (const kind of ['document', 'link', 'agent', 'conversation'] as const) {
        const view = mount({ ...resource('note'), kind: kind as Resource['kind'] });
        try {
          assert.equal(view.dom.root.querySelector('textarea'), null);
          assert.match(view.dom.root.textContent, kind === 'link' ? /Native media access is unavailable/ : /not supported/);
        } finally { view.close(); }
      }
      const mismatched = mount(resource('note'), { ...ports, noteSession: () => ports.noteSession(task.id) });
      try {
        assert.equal(mismatched.dom.root.querySelector('textarea'), null);
        assert.match(mismatched.dom.root.textContent, /session identity mismatch/);
      } finally { mismatched.close(); }
      const view = mount(resource('task'));
      try {
        const checkbox = view.dom.root.querySelector('.task-completed'), before = calls.statuses.length;
        checkbox.checked = true; checkbox.onchange();
        view.controller.update({ ...resource('task'), available: false });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.statuses.length, before);
        assert.equal(view.dom.root.querySelector('.aw-direct-resource-body').hidden, true);
        assert.match(view.dom.root.textContent, /unavailable/);
        await assert.rejects(view.controller.flush(), /unavailable/);
      } finally { view.close(); }
    });
    const snapshot = await core.command('snapshot', {});
    assert.deepEqual(snapshot.executions, {}); assert.deepEqual(snapshot.graph.messages, []);
    assert.equal(state.workspaces.length, 0); assert.equal(state.projects.length, 0); assert.equal(state.blocks.length, 0);
    assert.deepEqual(state.resources.map(resource => resource.id).sort(), baseline.resources.map((resource: Resource) => resource.id).sort());
  } finally {
    for (const controller of controllers.values()) controller.dispose();
    for (const session of sessions.values()) await session.persist();
    await core.command('close', {});
  }
});
