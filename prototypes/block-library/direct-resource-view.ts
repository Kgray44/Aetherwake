import type { Resource } from '../application-contract/contracts.ts';
import type { NoteExperiencePort } from './note-contracts.ts';
import type { NoteSession } from './note-session.ts';
import type { TimelinePort } from '../timeline-product/contracts.ts';
import { mountTimelineExperience, type TimelineExperience } from './timeline-view.ts';
import type { TaskObjectivePort } from '../task-product/contracts.ts';
import { mountTaskTrackerExperience, type TaskTrackerExperience } from './task-tracker-view.ts';
import type { ChecklistPort, ChecklistReference } from '../application-contract/checklist.ts';
import type { ExperienceMotionPort } from '../application-contract/motion.ts';
import { mountChecklistExperience, type ChecklistExperience } from '../checklist-product/view.ts';
import { mountNoteExperience } from './note-view.ts';
import { mountTaskGroupExperience } from './task-group-view.ts';
import { mountEventExperience, type EventWindow } from './event-view.ts';

export interface DirectResourcePorts {
  notes: NoteExperiencePort;
  noteSession(resourceId: string): NoteSession;
  timelines?: { port: TimelinePort; motion: ExperienceMotionPort; viewId: string; resourceTitle?(resourceId: string): string | undefined };
  taskObjectives?: Omit<Parameters<typeof mountTaskTrackerExperience>[3], 'active' | 'presentation' | 'openResource'> & { port: TaskObjectivePort };
  checklists?: {
    port: ChecklistPort;
    motion: ExperienceMotionPort;
    /** Unique per mounted presentation, including multiple views of one resource. */
    viewId: string;
    chooseReference?(): Promise<ChecklistReference | null>;
    openReference?(reference: ChecklistReference): void | Promise<void>;
  };
  saveContent(resourceId: string, content: string, root: HTMLElement): void;
  readResource?(resourceId: string): Resource | undefined;
  setTaskStatus(input: { resourceId: string; expectedVersion: number; status: 'open' | 'done' }): Promise<void>;
  setTaskPriority(input: { resourceId: string; expectedVersion: number; priority: NonNullable<Resource['taskPriority']> }): Promise<void>;
  manageMembers(resourceId: string): void | Promise<void>;
  openResource(resourceId: string): void;
  copyText?(text: string): Promise<void>;
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
  frame?(): void;
  reflow?(): void;
  /** Root invokes this for dependency/source/execution/policy changes even when
   * the represented resource version did not change. No polling is installed. */
  refresh?(): Promise<void>;
  /** Available for Task Tracker drafts; Root owns navigation/discard decisions. */
  hasUnsavedChanges?(): boolean;
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
  let checklist: ChecklistExperience | undefined;
  let timeline: TimelineExperience | undefined;
  let timelineWasActive = false;
  let taskObjective: TaskTrackerExperience | undefined, taskObjectiveWasActive = false;
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
      copyText: ports.copyText,
    });
    editor.oninput = () => {
      if (disposed || !active || !available(resource)) return;
      try { ports.saveContent(resourceId, editor!.value, content); } catch (error) { fail(error); }
    };
  };
  const mount = () => {
    if (mounted || !available(resource)) return;
    body.replaceChildren();
    if (kind === 'task_objective') {
      const source = ports.taskObjectives;
      if (!source) { status.textContent = 'Task Objective access is unavailable in this surface.'; return; }
      const { port, ...options } = source;
      taskObjective = mountTaskTrackerExperience(body, resourceId, port, { ...options, active, presentation: 'focused', showTitle: false, openResource: ports.openResource });
      taskObjectiveWasActive = active; refreshVersion = resource.version; mounted = true; return;
    }
    if (kind === 'timeline') {
      const source = ports.timelines;
      if (!source) { status.textContent = 'Timeline access is unavailable in this surface.'; return; }
      timeline = mountTimelineExperience(body, resourceId, source.port, { motion: source.motion, viewId: source.viewId,
        active, presentation: 'focused', showTitle: false, onOpenResource: ports.openResource, resourceTitle: source.resourceTitle });
      timelineWasActive = active; refreshVersion = resource.version; mounted = true;
      return;
    }
    if (kind === 'checklist') {
      const source = ports.checklists;
      if (!source) { status.textContent = 'Checklist access is unavailable in this surface.'; return; }
      checklist = mountChecklistExperience(body, resourceId, source.port, {
        viewId: source.viewId, motion: source.motion, active, presentation: 'focused',
        chooseReference: source.chooseReference, openReference: source.openReference,
      });
      refreshVersion = resource.version;
      mounted = true;
      return;
    }
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
        taskObjective?.dispose(); taskObjective = undefined; taskObjectiveWasActive = false;
        timeline?.dispose(); timeline = undefined; timelineWasActive = false;
        checklist?.dispose(); checklist = undefined;
        note?.dispose(); group?.dispose(); events?.dispose();
        note = undefined; group = undefined; events = undefined;
        session = undefined; editor = undefined; taskStatus = undefined; taskPriority = undefined;
        body.replaceChildren(); body.inert = true;
        fail(error);
        return;
      }
    }
    note?.setActive(active && available(resource));
    const objectiveActive = active && available(resource), objectiveActivated = objectiveActive && !taskObjectiveWasActive;
    taskObjective?.setActive(objectiveActive); taskObjectiveWasActive = objectiveActive;
    if (objectiveActivated && taskObjective) refreshVersion = resource.version;
    if (taskObjective && objectiveActive && refreshVersion !== resource.version) { refreshVersion = resource.version; void taskObjective.refresh().catch(fail); }
    const timelineActive = active && available(resource), timelineActivated = timelineActive && !timelineWasActive;
    timeline?.setActive(timelineActive); timelineWasActive = timelineActive;
    if (timelineActivated && timeline) refreshVersion = resource.version;
    if (timeline && timelineActive && refreshVersion !== resource.version) { refreshVersion = resource.version; void timeline.refresh().catch(fail); }
    checklist?.setActive(active && available(resource));
    if (checklist && active && available(resource) && refreshVersion !== resource.version) {
      refreshVersion = resource.version;
      void checklist.refresh().catch(fail);
    }
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
      if (disposed) return;
      if (taskObjective) {
        if (!available(resource)) throw new Error('Task Objective is unavailable. Pending decisions remain in its view.');
        await taskObjective.flush(); return;
      }
      if (timeline) {
        if (!available(resource)) throw new Error('Timeline is unavailable. Pending view settings remain in its view.');
        await timeline.flush(); return;
      }
      if (checklist) {
        if (!available(resource)) throw new Error('Checklist is unavailable. Pending edits are retained in its view.');
        await checklist.flush();
        return;
      }
      if (!session) return;
      if (!available(resource)) throw new Error('Resource is unavailable. Pending text remains in its canonical editor session.');
      await session.flushEdits();
    },
    frame() { if (!disposed) { checklist?.frame(); timeline?.frame(); taskObjective?.frame(); } },
    reflow() { if (!disposed) { checklist?.reflow(); timeline?.reflow(); taskObjective?.reflow(); } },
    async refresh() { if (!disposed && active && available(resource)) { if (taskObjective) await taskObjective.refresh(); else if (timeline) await timeline.refresh(); else if (checklist) await checklist.refresh(); else if (session) await session.refresh(); else if (events) await ports.events?.refresh(); } },
    ...(kind === 'task_objective' ? { hasUnsavedChanges: () => taskObjective?.hasUnsavedChanges() ?? false } : {}),
    dispose() {
      if (disposed) return;
      disposed = true;
      taskObjective?.dispose();
      timeline?.dispose();
      checklist?.dispose();
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
