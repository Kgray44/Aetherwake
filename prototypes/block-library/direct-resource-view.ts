import type { Resource } from '../application-contract/contracts.ts';
import type { NoteExperiencePort } from './note-contracts.ts';
import type { NoteSession } from './note-session.ts';
import { mountNoteExperience } from './note-view.ts';
import { mountTaskGroupExperience } from './task-group-view.ts';
import { mountEventExperience, type EventWindow } from './event-view.ts';

export interface DirectResourcePorts {
  notes: NoteExperiencePort;
  noteSession(resourceId: string): NoteSession;
  saveContent(resourceId: string, content: string, root: HTMLElement): void;
  readResource?(resourceId: string): Resource | undefined;
  setTaskStatus(input: { resourceId: string; expectedVersion: number; status: 'open' | 'done' }): Promise<void>;
  setTaskPriority(input: { resourceId: string; expectedVersion: number; priority: NonNullable<Resource['taskPriority']> }): Promise<void>;
  manageMembers(resourceId: string): void | Promise<void>;
  openResource(resourceId: string): void;
  openRelated?(resourceId: string, anchor: HTMLElement): void;
  events?: {
    snapshot(): EventWindow;
    refresh(): Promise<void>;
    openResource?(resourceId: string): void;
  };
}

export interface DirectResourceExperience {
  update(resource: Resource): void;
  setActive(active: boolean): void;
  flush(): Promise<void>;
  dispose(): void;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = text;
  return value;
};
const available = (resource: Resource) => resource.available !== false && resource.visible !== false && (resource.state === undefined || resource.state === 'active');
const noteKinds = new Set(['note', 'task', 'task_group', 'research', 'reference']);

/** Placement-free content adapter. Root owns resolution/authorization, surface
 * caching, transitions, navigation and the canonical-ID NoteSession lifetime.
 * This module has no layout, block, membership, resource factory or ID port. */
export function mountDirectResourceExperience(
  root: HTMLElement,
  initial: Resource,
  ports: DirectResourcePorts,
): DirectResourceExperience {
  const resourceId = initial.id, kind = initial.kind;
  let resource = initial, active = true, disposed = false, mounted = false;
  let note: ReturnType<typeof mountNoteExperience> | undefined;
  let group: ReturnType<typeof mountTaskGroupExperience> | undefined;
  let events: ReturnType<typeof mountEventExperience> | undefined;
  let session: NoteSession | undefined;
  let refreshVersion: number | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let taskStatus: HTMLInputElement | undefined, taskPriority: HTMLSelectElement | undefined;
  let pendingStatus = false, pendingPriority = false;
  const body = node('section', 'aw-direct-resource-body');
  const status = node('p', 'aw-direct-resource-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.classList.add('aw-direct-resource');
  root.dataset.resourceId = resourceId;
  root.dataset.resourceKind = kind;
  root.replaceChildren(status, body);

  const fail = (error: unknown) => {
    if (!disposed && active) status.textContent = error instanceof Error ? error.message.replaceAll('_', ' ') : 'The operation could not be completed.';
  };
  const currentTask = (id: string): Resource => {
    const current = ports.readResource ? ports.readResource(id) : (id === resourceId ? resource : undefined);
    if (!current || current.kind !== 'task' || !available(current)) throw new Error('Task is unavailable. Refresh its current data before editing.');
    return current;
  };
  const paintTask = () => {
    if (taskStatus) {
      taskStatus.checked = resource.taskStatus === 'done';
      taskStatus.disabled = !active || !available(resource) || pendingStatus || pendingPriority;
      taskStatus.setAttribute('aria-busy', String(pendingStatus));
    }
    if (taskPriority) {
      taskPriority.value = resource.taskPriority ?? 'normal';
      taskPriority.disabled = !active || !available(resource) || pendingPriority || pendingStatus;
    }
  };
  const taskControls = () => {
    const tools = node('div', 'aw-direct-task-controls');
    const completed = node('label', 'local-task-state', 'Completed locally');
    taskStatus = node('input', 'task-completed');
    taskStatus.type = 'checkbox';
    taskStatus.setAttribute('aria-label', 'Completed locally');
    completed.prepend(taskStatus);
    const priorityLabel = node('label', '', 'Priority');
    taskPriority = node('select', 'task-priority');
    taskPriority.setAttribute('aria-label', 'Task priority');
    for (const priority of ['low', 'normal', 'high', 'urgent'] as const) {
      const option = node('option', '', priority[0].toUpperCase() + priority.slice(1));
      option.value = priority; taskPriority.append(option);
    }
    priorityLabel.append(taskPriority); tools.append(completed, priorityLabel); body.prepend(tools);
    taskStatus.onchange = () => {
      if (disposed || !active || pendingStatus || pendingPriority || !available(resource)) return;
      const requested = taskStatus!.checked ? 'done' : 'open';
      pendingStatus = true; paintTask();
      void Promise.resolve().then(async () => {
        if (disposed || !active || !available(resource)) return;
        currentTask(resourceId);
        await session!.flushEdits();
        if (disposed || !active || !available(resource)) return;
        const current = currentTask(resourceId);
        const document = session!.snapshot().document?.resource;
        await ports.setTaskStatus({ resourceId, expectedVersion: Math.max(current.version, document?.id === resourceId ? document.version : 0), status: requested });
      }).catch(fail).finally(() => { pendingStatus = false; if (!disposed) paintTask(); });
    };
    taskPriority.onchange = () => {
      if (disposed || !active || pendingPriority || pendingStatus || !available(resource)) return;
      const requested = taskPriority!.value as NonNullable<Resource['taskPriority']>;
      if (!['low', 'normal', 'high', 'urgent'].includes(requested)) return;
      pendingPriority = true; paintTask();
      void Promise.resolve().then(async () => {
        if (disposed || !active || !available(resource)) return;
        currentTask(resourceId);
        await session!.flushEdits();
        if (disposed || !active || !available(resource)) return;
        const current = currentTask(resourceId);
        const document = session!.snapshot().document?.resource;
        await ports.setTaskPriority({ resourceId, expectedVersion: Math.max(current.version, document?.id === resourceId ? document.version : 0), priority: requested });
      }).catch(fail).finally(() => { pendingPriority = false; if (!disposed) paintTask(); });
    };
  };
  const mountDocument = (parent: HTMLElement) => {
    const content = node('div', 'aw-direct-document');
    editor = node('textarea', 'aw-direct-editor');
    editor.value = resource.content; editor.maxLength = 100000; editor.rows = 12;
    editor.setAttribute('aria-label', resource.title + ' content');
    const saved = node('p', 'saved');
    content.append(editor, saved); parent.append(content);
    session = ports.noteSession(resourceId);
    if (session.resourceId !== resourceId) throw new Error('Canonical editor session identity mismatch.');
    note = mountNoteExperience(content, editor, session, ports.notes, {
      kind, active, presentation: 'focused', initialMode: ['research', 'reference'].includes(kind) ? 'read' : 'write',
      openRelated: ports.openRelated,
    });
    editor.oninput = () => {
      if (disposed || !active || !available(resource)) return;
      try { ports.saveContent(resourceId, editor!.value, content); } catch (error) { fail(error); }
    };
  };
  const mount = () => {
    if (mounted || !available(resource)) return;
    body.replaceChildren();
    if (noteKinds.has(kind)) {
      if (kind === 'task_group') {
        const primary = node('div', 'task-group-primary'); body.append(primary);
        group = mountTaskGroupExperience(primary, {
          members: resource.taskMembers ?? [], active, presentation: 'focused',
          setStatus: async ({ resourceId: memberId, status }) => {
            if (disposed || !active || !available(resource)) throw new Error('Task group is unavailable.');
            const member = currentTask(memberId);
            await ports.setTaskStatus({ resourceId: memberId, expectedVersion: member.version, status });
          },
          manageMembers: () => { if (!disposed && active && available(resource)) return ports.manageMembers(resourceId); },
          openTask: ports.openResource,
        });
        const description = node('details', 'task-group-description');
        description.append(node('summary', '', 'Description')); body.append(description);
        mountDocument(description);
      } else {
        mountDocument(body);
        if (kind === 'task') taskControls();
      }
      mounted = true;
    } else if (kind === 'stream' && ports.events) {
      events = mountEventExperience(body, {
        snapshot: () => ({ ...ports.events!.snapshot(), workspaceResourceIds: [], projectId: resource.project_id ?? null }),
        refresh: () => ports.events!.refresh(),
        openResource: ports.events.openResource ?? ports.openResource,
      }, { active, presentation: 'focused' });
      mounted = true;
    } else {
      status.textContent = kind === 'stream'
        ? 'Recorded events are unavailable in this surface.'
        : 'A direct presentation is not supported for this resource type.';
    }
  };
  const reconcile = () => {
    if (disposed) return;
    body.hidden = !available(resource);
    body.inert = !active || !available(resource);
    if (!available(resource)) status.textContent = resource.state === 'archived'
      ? 'This resource is archived. Its canonical data is retained.'
      : 'This resource is unavailable or no longer accessible.';
    else {
      if (mounted) status.textContent = '';
      try { mount(); } catch (error) {
        note?.dispose(); group?.dispose(); events?.dispose();
        note = undefined; group = undefined; events = undefined;
        session = undefined; editor = undefined; taskStatus = undefined; taskPriority = undefined;
        body.replaceChildren(); body.inert = true;
        fail(error);
        return;
      }
    }
    note?.setActive(active && available(resource));
    const document = session?.snapshot().document?.resource;
    if (session && document && active && available(resource) && document.version < resource.version && refreshVersion !== resource.version) {
      refreshVersion = resource.version;
      // The existing session preserves dirty/recovered text and fences a
      // competing canonical revision. A clean session adopts fresh metadata.
      void session.refresh().catch(fail);
    }
    group?.setActive(active && available(resource));
    group?.update(resource.taskMembers ?? []);
    events?.setActive(active && available(resource));
    if (available(resource) && active) events?.update();
    if (editor) editor.disabled = !active || !available(resource);
    paintTask();
  };
  reconcile();
  return {
    update(next) {
      if (disposed) return;
      if (next.id !== resourceId || next.kind !== kind) throw new Error('Direct resource identity cannot change.');
      if (next.version < resource.version && available(next)) return;
      resource = next;
      if (editor) editor.setAttribute('aria-label', resource.title + ' content');
      reconcile();
    },
    setActive(value) { if (!disposed) { active = value; reconcile(); } },
    async flush() {
      if (disposed || !session) return;
      if (!available(resource)) throw new Error('Resource is unavailable. Pending text remains in its canonical editor session.');
      await session.flushEdits();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (editor) editor.oninput = null;
      if (taskStatus) taskStatus.onchange = null;
      if (taskPriority) taskPriority.onchange = null;
      note?.dispose(); group?.dispose(); events?.dispose();
      body.remove(); status.remove();
      root.classList.remove('aw-direct-resource');
      delete root.dataset.resourceId; delete root.dataset.resourceKind;
      // The shared canonical session belongs to Root, including pending edits.
    },
  };
}
