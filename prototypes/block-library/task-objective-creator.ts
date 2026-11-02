import type { CreateTaskObjective, TaskObjectivePort } from '../task-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export interface TaskObjectiveCreator {
  setActive(active: boolean): void;
  frame(): void;
  flush(): Promise<void>;
  hasUnsavedChanges(): boolean;
  dispose(): void;
}

/** Placement-free creation. Root owns the surrounding surface, project access,
 * navigation and shared frame. No provider, Note or workspace factory exists. */
export function mountTaskObjectiveCreator(root: HTMLElement, options: {
  port: TaskObjectivePort; motion: ExperienceMotionPort; viewId: string;
  projectId: string | null; active?: boolean; showTitle?: boolean;
  onCreated(resourceId: string): void | Promise<void>;
}): TaskObjectiveCreator {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const key = 'task-objective-create:' + options.viewId, motion = options.motion, projectId = options.projectId;
  const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const value = document.createElement(tag); value.textContent = text; value.className = cls;
    if (['button', 'input', 'textarea'].includes(tag)) value.dataset.aerynthMotionControl = 'true'; return value; };
  const section = node('section', '', 'aw-task-objective-creator'), heading = node('h3', 'New task objective'), form = node('form');
  const title = node('input'), objective = node('textarea'), requirements = node('ol'), status = node('p', '', 'aw-task-create-status');
  const create = node('button', 'Create task objective'), retry = node('button', 'Retry creation'), open = node('button', 'Open Task Tracker'), add = node('button', 'Add requirement');
  const rows: { id: string; row: HTMLLIElement; input: HTMLInputElement; remove: HTMLButtonElement }[] = [];
  let disposed = false, active = options.active ?? true, pending = false, navigating = false, createdId: string | null = null;
  let request: CreateTaskObjective | null = null, operation: Promise<void> | null = null;
  const field = (name: string, input: HTMLElement) => { const label = node('label', name); input.setAttribute('aria-label', name); label.append(input); return label; };
  const editable = () => active && !disposed && !pending && !request && !createdId;
  title.type = 'text'; title.maxLength = 200; title.required = true; title.placeholder = 'Name this outcome';
  objective.maxLength = 8192; objective.required = true; objective.rows = 4; objective.placeholder = 'What should this work achieve?';
  create.type = 'submit'; retry.type = open.type = add.type = 'button'; heading.hidden = options.showTitle === false;
  section.dataset.noCardDrag = 'true'; section.setAttribute('aria-label', 'Create task objective'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  function paint() {
    if (disposed) return; title.disabled = objective.disabled = !editable();
    create.disabled = !editable(); create.hidden = !!request || !!createdId; add.disabled = !editable() || rows.length >= 32;
    retry.hidden = !request || pending; retry.disabled = !active || pending; open.hidden = !createdId; open.disabled = !active || navigating;
    for (const value of rows) value.input.disabled = value.remove.disabled = !editable();
    section.inert = !active; section.setAttribute('aria-busy', String(pending || navigating)); motion.wake();
  }
  add.onclick = () => {
    if (!editable() || rows.length >= 32) return;
    const row = node('li'), input = node('input'), remove = node('button', 'Remove requirement'), id = 'criterion:' + crypto.randomUUID();
    input.type = 'text'; input.maxLength = 2048; input.required = true; input.setAttribute('aria-label', 'Requirement text'); remove.type = 'button';
    const value = { id, row, input, remove }; remove.onclick = () => { if (!editable()) return; rows.splice(rows.indexOf(value), 1); row.remove(); paint(); };
    row.append(input, remove); rows.push(value); requirements.append(row); paint(); input.focus();
  };
  async function openCreated() {
    if (!createdId || disposed || !active || navigating) return; navigating = true; paint();
    try { await options.onCreated(createdId); if (!disposed && active) status.textContent = 'Task objective created.'; }
    catch { if (!disposed && active) status.textContent = 'Task objective created. Opening it did not finish; use Open Task Tracker to try again.'; }
    finally { navigating = false; paint(); }
  }
  async function send() {
    if (disposed || !active || pending || !request || createdId) return;
    const attempted = request; pending = true; status.textContent = 'Creating task objective…'; paint();
    const saving = (async () => {
      try { const receipt = await options.port.create(structuredClone(attempted));
        if (receipt.commandId !== attempted.commandId || !receipt.resourceId || receipt.operation !== 'create' || receipt.version !== 1 || receipt.definitionVersion !== 1 || receipt.executionEffects !== 'none') throw new Error('Invalid Task Objective creation acknowledgment');
        createdId = receipt.resourceId; request = null; if (!disposed && active) status.textContent = 'Task objective created.';
      } catch (error) {
        const code = (error as { code?: unknown })?.code, rejected = typeof code === 'string' && code.startsWith('task_');
        if (rejected) request = null;
        if (!disposed && active) status.textContent = rejected ? code === 'task_capacity' ? 'The task objective limit has been reached. Your entries are retained.'
          : 'This task objective could not be created under the current scope or policy. Your entries are retained.'
          : 'Creation could not be confirmed. Retry creation checks the same attempt without creating a duplicate.';
      } finally { pending = false; paint(); }
    })();
    operation = saving; await saving; if (operation === saving) operation = null;
    // Root navigation may call flush. Keep it outside the canonical promise.
    if (createdId && !disposed && active) await openCreated();
  }
  form.onsubmit = event => {
    event.preventDefault(); if (!editable()) return;
    const name = title.value.trim(), text = objective.value.trim(), criteria = rows.map(value => ({ id: value.id, text: value.input.value.trim() }));
    if (!name || name.length > 200 || !text || text.length > 8192 || criteria.some(value => !value.text || value.text.length > 2048)) {
      status.textContent = 'Enter a title and objective, and text for every added requirement.'; return;
    }
    request = { commandId: 'task-objective-create:' + crypto.randomUUID(), title: name, projectId,
      definition: { objective: text, requirements: criteria, sources: [], assignees: [], dependencies: [] } }; void send();
  };
  retry.onclick = () => { void send(); }; open.onclick = () => { void openCreated(); };
  const actions = node('div', '', 'aw-task-create-actions'); actions.append(create, retry, open);
  form.append(field('Task title', title), field('Objective', objective), node('h4', 'Requirements'), requirements, add, actions);
  section.append(heading, node('p', 'Describe the outcome and how you will review it. Add sources, assignees and dependencies in its Task Tracker after creation.'), form, status);
  root.append(section); section.hidden = !active; section.style.opacity = '0'; motion.add(key, pose({ opacity: 0, y: 8 })); motion.target(key, pose({ opacity: active ? 1 : 0, y: active ? 0 : 8 }), 'task-objective-creator-open'); paint();
  return {
    setActive(value) { if (disposed || active === value) return; active = value; if (value) section.hidden = false; motion.target(key, pose({ opacity: value ? 1 : 0, y: value ? 0 : 8 }), 'task-objective-creator-visibility'); paint(); },
    frame() { if (disposed) return; const value = motion.pose(key); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; if (!active && value.opacity < .001) section.hidden = true; },
    async flush() { if (operation) await operation; if (request) throw new Error('Task Objective creation needs confirmation. Retry the same creation before leaving.'); },
    hasUnsavedChanges() { return !!request || !createdId && (!!title.value || !!objective.value || rows.length > 0); },
    dispose() { if (disposed) return; disposed = true; section.inert = true; form.onsubmit = null; retry.onclick = open.onclick = add.onclick = null; section.remove(); motion.remove(key); },
  };
}
