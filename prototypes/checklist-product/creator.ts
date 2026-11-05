import type { ChecklistPort, CreateChecklist } from '../application-contract/checklist.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export interface ChecklistCreator {
  frame(): void;
  /** Waits for an attempted creation, never submits a form implicitly. */
  flush(): Promise<void>;
  dispose(): void;
}

/** Small placement-free creation form. Root owns the enclosing surface,
 * navigation, canonical authorization and existing frame/coordinator. */
export function mountChecklistCreator(root: HTMLElement, options: {
  port: ChecklistPort;
  motion: ExperienceMotionPort;
  projectId: string | null;
  /** Canonical Conversation RESOURCE identity, never a provider thread ID. */
  conversationId?: string;
  onCreated(resourceId: string): void | Promise<void>;
  viewId: string;
}): ChecklistCreator {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const motion = options.motion, key = 'checklist-create:' + options.viewId;
  const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const value = document.createElement(tag); value.textContent = text; value.className = cls;
    if (['button', 'input'].includes(tag)) value.dataset.aerynthMotionControl = 'true';
    return value;
  };
  const section = element('section', '', 'aw-checklist-creator'), heading = element('h3', 'New checklist');
  const hint = element('p', options.conversationId ? 'Linked to this conversation. Add and check items manually.' : 'Keep your next steps together. Add and check items manually.');
  const form = element('form'), label = element('label', 'Title'), title = element('input');
  const create = element('button', 'Create checklist'), retry = element('button', 'Retry creation'), open = element('button', 'Open checklist');
  const status = element('p', '', 'aw-checklist-create-status');
  const projectId = options.projectId, conversationId = options.conversationId;
  let disposed = false, pending = false, navigating = false, request: CreateChecklist | null = null, createdId: string | null = null;
  let operation: Promise<void> | null = null;
  section.dataset.noCardDrag = 'true'; section.setAttribute('aria-label', 'Create checklist');
  title.type = 'text'; title.required = true; title.maxLength = 200; title.placeholder = 'What are the next steps?'; title.setAttribute('aria-label', 'Checklist title');
  create.type = 'submit'; retry.type = open.type = 'button';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const paint = () => {
    if (disposed) return;
    title.disabled = pending || !!request || !!createdId;
    create.disabled = pending || !!request || !!createdId; create.hidden = !!request || !!createdId;
    retry.hidden = !request || pending; retry.disabled = pending;
    open.hidden = !createdId; open.disabled = navigating;
    section.setAttribute('aria-busy', String(pending || navigating));
    motion.wake();
  };
  const openCreated = async () => {
    if (!createdId || disposed || navigating) return;
    navigating = true; paint();
    try {
      await options.onCreated(createdId);
      if (!disposed) status.textContent = 'Checklist created.';
    } catch {
      if (!disposed) status.textContent = 'Checklist created. Opening it did not finish; use Open checklist to try again.';
    } finally { navigating = false; paint(); }
  };
  const send = async () => {
    if (disposed || pending || !request || createdId) return;
    const attempted = request;
    pending = true; status.textContent = 'Creating checklist…'; paint();
    const saving = (async () => {
      try {
        const result = await options.port.create(structuredClone(attempted));
        createdId = result.resourceId; request = null;
        if (!disposed) status.textContent = 'Checklist created.';
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        const rejected = typeof code === 'string' && (code.startsWith('checklist_') || code === 'invalid_checklist_input' || code.startsWith('canonical_checklist_'));
        if (rejected) request = null;
        if (!disposed) status.textContent = rejected
          ? code === 'checklist_reference_unavailable' ? 'This conversation is unavailable or outside the permitted scope. Your title is retained.'
            : code === 'checklist_capacity' ? 'The checklist limit has been reached. Your title is retained.'
              : 'The checklist could not be created. Your title is retained.'
          : 'Creation could not be confirmed. Retry creation checks the same attempt without creating a duplicate.';
      } finally { pending = false; paint(); }
    })();
    operation = saving;
    await saving;
    if (operation === saving) operation = null;
    // Navigation can flush this creator. Never include navigation in the
    // canonical promise awaited by flush(), which would create a cycle.
    if (createdId && !disposed) await openCreated();
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (disposed || pending || request || createdId) return;
    const value = title.value.trim();
    if (!value || value.length > 200) { status.textContent = 'Enter a title of up to 200 characters.'; return; }
    request = { commandId: 'checklist-create:' + crypto.randomUUID(), title: value, projectId,
      ...(conversationId === undefined ? {} : { conversationId }) };
    void send();
  };
  retry.onclick = () => { void send(); };
  open.onclick = () => { void openCreated(); };
  label.append(title); form.append(label, create, retry, open);
  section.append(heading, hint, form, status); root.append(section); section.style.opacity = '0';
  motion.add(key, pose({ opacity: 0, y: 8 })); motion.target(key, pose(), 'checklist-creator-open'); paint();
  return {
    frame() { if (!disposed) { const value = motion.pose(key); section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`; } },
    async flush() { if (operation) await operation; if (request) throw new Error('Checklist creation needs confirmation. Retry the same creation before leaving.'); },
    dispose() {
      if (disposed) return; disposed = true;
      form.onsubmit = null; retry.onclick = open.onclick = null; section.inert = true; section.remove(); motion.remove(key);
    },
  };
}
