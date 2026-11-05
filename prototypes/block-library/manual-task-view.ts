import type { Resource } from '../application-contract/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

type Priority = NonNullable<Resource['taskPriority']>;
export interface ManualTaskPort {
  setTaskStatus(input: { resourceId: string; expectedVersion: number; status: 'open' | 'done' }): Promise<void>;
  setTaskPriority(input: { resourceId: string; expectedVersion: number; priority: Priority }): Promise<void>;
  readResource?(id: string): Resource | undefined;
}
const priorities = ['low', 'normal', 'high', 'urgent'] as const;
const readable = (value: Resource) => value.kind === 'task' && value.available !== false && value.visible !== false && (value.state === undefined || value.state === 'active');
const pose = (progress: number): ExperiencePose => ({ x: progress, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 });

/** Manual status is never execution verification. The host owns description
 * editing, canonical mutations, current authority and the shared frame. */
export function mountManualTaskExperience(root: HTMLElement, initial: Resource, port: ManualTaskPort, options: {
  motion: ExperienceMotionPort; viewId: string; active?: boolean; presentation?: 'workspace' | 'focused';
}) {
  if (initial.kind !== 'task' || !options.viewId || !options.motion) throw new Error('A canonical Task, unique view identity and shared motion port are required.');
  const doc = root.ownerDocument, resourceId = initial.id, motion = options.motion, key = 'manual-task:' + options.viewId + ':' + resourceId;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const value = doc.createElement(tag); value.textContent = text; value.className = className; return value; };
  const section = node('section', '', 'aw-manual-task'), instrument = node('div', '', 'aw-manual-task-instrument'), dial = node('div', '', 'aw-manual-task-dial');
  const state = node('strong', '', 'aw-manual-task-state'), stages = node('ol', '', 'aw-manual-task-stages'), openStage = node('li', 'Open'), doneStage = node('li', 'Done manually');
  const action = node('button', '', 'aw-manual-task-toggle'), priorityMenu = node('details', '', 'aw-manual-task-priority'), priorityHeading = node('summary'), priority = node('select');
  const priorityLabel = node('label', 'Manual task priority'), execution = node('p', '', 'aw-manual-task-execution'), status = node('p', '', 'aw-manual-task-status');
  section.dataset.resourceId = resourceId; section.dataset.noCardDrag = 'true'; section.dataset.presentation = options.presentation ?? 'workspace';
  section.setAttribute('aria-label', 'Manual task status and priority'); dial.setAttribute('aria-hidden', 'true');
  action.type = 'button'; action.dataset.aerynthMotionControl = priority.dataset.aerynthMotionControl = 'true';
  priority.setAttribute('aria-label', 'Manual task priority');
  for (const value of priorities) { const item = node('option', value[0].toUpperCase() + value.slice(1)); item.value = value; priority.append(item); }
  priorityLabel.append(priority); priorityMenu.append(priorityHeading, priorityLabel, node('small', 'Priority is your manual ordering cue, not execution urgency.'));
  priorityHeading.oncontextmenu = event => { if (!active || disposed || !readable(current)) return; event.preventDefault(); event.stopPropagation(); priorityMenu.open = true; priority.focus(); };
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); stages.setAttribute('aria-label', 'Manual task stages'); stages.append(openStage, doneStage);
  instrument.append(dial, node('small', 'Manual task'), state); section.append(instrument, stages, action, priorityMenu,
    node('p', 'Manual completion records your choice. It does not verify agent work.', 'aw-manual-task-caveat'), execution, status); root.append(section);
  let current = initial, active = options.active ?? true, disposed = false, owned = false, pending: Promise<void> | null = null, failure: unknown = null;
  const release = () => { if (owned) { motion.remove(key); owned = false; motion.wake(); } };
  const visible = () => active && !disposed && !doc.hidden;
  const paintDial = (value: number) => { dial.style.setProperty('--aw-manual-progress', String(Math.max(0, Math.min(1, value)) * 100) + '%'); };
  function paint() {
    if (disposed) return;
    const allowed = readable(current), done = current.taskStatus === 'done';
    section.inert = !active; section.setAttribute('aria-busy', String(!!pending));
    action.disabled = priority.disabled = !visible() || !allowed || !!pending;
    action.textContent = !allowed ? 'Task unavailable' : done ? 'Reopen manual task' : 'Mark done manually';
    priority.value = allowed ? current.taskPriority ?? 'normal' : '';
    priorityHeading.textContent = allowed ? 'Priority · ' + (current.taskPriority ?? 'normal') : 'Priority unavailable';
    section.dataset.manualState = allowed ? done ? 'done' : 'open' : 'unavailable';
    section.dataset.priority = allowed ? current.taskPriority ?? 'normal' : 'unknown';
    state.textContent = allowed ? done ? 'Done manually' : 'Open' : 'Task unavailable';
    stages.hidden = dial.hidden = !allowed;
    openStage.setAttribute('aria-current', String(allowed && !done)); doneStage.setAttribute('aria-current', String(allowed && done));
    execution.textContent = !allowed || !current.execution ? '' : 'Separate execution reference · ' + current.execution.state.replaceAll('_', ' ') +
      (current.execution.errorCode ? ' · ' + current.execution.errorCode : '') + ' · task verification is not established.';
    execution.hidden = !execution.textContent;
    if (!allowed) status.textContent = current.state === 'archived' ? 'Archived task. Canonical content is retained.' : 'Task access is unavailable. No manual action can be applied.';
    if (!allowed || !visible()) { release(); return; }
    const target = pose(done ? 1 : 0);
    if (!owned) { motion.add(key, target); owned = true; paintDial(target.x); }
    motion.target(key, target, 'manual-task:canonical-status'); motion.wake();
    if (motion.reduced) paintDial(target.x);
  }
  const adopt = (next: Resource) => {
    if (next.id !== resourceId || next.kind !== 'task') throw new Error('Manual Task identity cannot change.');
    if (next.version < current.version && readable(next)) return;
    current = next;
  };
  const fresh = () => {
    const value = port.readResource ? port.readResource(resourceId) : current;
    if (!value || value.id !== resourceId || !readable(value)) throw Object.assign(new Error('Task access is unavailable. Refresh before changing it.'), { unavailable: true });
    if (value.version < current.version) throw new Error('A stale Task version was returned. Refresh before changing it.');
    adopt(value); return value;
  };
  function mutate(change: { status: 'open' | 'done' } | { priority: Priority }) {
    if (pending || !visible() || !readable(current)) return;
    failure = null; status.textContent = 'Saving manual task change…';
    const work = Promise.resolve().then(async () => {
      if (!visible() || !readable(current)) { if (!disposed) status.textContent = 'Manual change cancelled before dispatch.'; return; }
      const saved = fresh();
      if ('status' in change) await port.setTaskStatus({ resourceId, expectedVersion: saved.version, status: change.status });
      else await port.setTaskPriority({ resourceId, expectedVersion: saved.version, priority: change.priority });
      if (disposed || !readable(current)) return;
      if (port.readResource) fresh();
      const confirmed = 'status' in change ? current.taskStatus === change.status : current.taskPriority === change.priority;
      status.textContent = confirmed ? 'Manual task change saved.' : 'Change acknowledged. Waiting for the latest saved task state.';
    }).catch(error => {
      failure = error;
      if (!disposed) {
        if (port.readResource) { const latest = port.readResource(resourceId); if (latest?.id === resourceId && latest.kind === 'task') adopt(latest); else current = { ...current, available: false }; }
        if ((error as { unavailable?: boolean })?.unavailable) current = { ...current, available: false };
        if (readable(current)) status.textContent = /conflict|version/i.test(String(error)) ? 'Task changed elsewhere. The saved state is shown; review it before trying again.' : 'The change was not confirmed. The saved manual state is retained.';
      }
    }).finally(() => { if (pending === work) pending = null; paint(); });
    pending = work; paint();
  }
  action.onclick = () => mutate({ status: current.taskStatus === 'done' ? 'open' : 'done' });
  priority.onchange = () => { const requested = priority.value as Priority; priority.value = current.taskPriority ?? 'normal'; if (priorities.includes(requested)) mutate({ priority: requested }); };
  function reflow() { if (!disposed) section.dataset.compact = String(section.dataset.presentation === 'workspace' && root.getBoundingClientRect().width < 360); }
  const visibility = () => { if (!disposed) paint(); }; doc.addEventListener?.('visibilitychange', visibility);
  paint(); reflow();
  return {
    update(next: Resource) { if (disposed) return; adopt(next); paint(); },
    setActive(value: boolean) { if (disposed) return; active = value; if (!value) priorityMenu.open = false; paint(); },
    setPresentation(value: 'workspace' | 'focused') { if (!disposed) { section.dataset.presentation = value; reflow(); } },
    frame() { if (!visible() || !owned || !readable(current)) return; paintDial(motion.reduced ? current.taskStatus === 'done' ? 1 : 0 : motion.pose(key).x); },
    reflow,
    async flush() { if (pending) await pending; if (failure) throw failure; },
    dispose() { if (disposed) return; disposed = true; release(); doc.removeEventListener?.('visibilitychange', visibility); section.remove(); },
  };
}
