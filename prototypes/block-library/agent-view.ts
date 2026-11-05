import type { AgentAssignmentReference, AgentLibraryClientPort, AgentProfile, EffectiveAgentConfiguration } from '../agent-product/contracts.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export type AgentBlockProjection =
  | { phase: 'loading' | 'unavailable' }
  | { phase: 'ready'; profile: AgentProfile; configuration: EffectiveAgentConfiguration | null;
      history: { state: 'loading' | 'unavailable' | 'ready'; references: AgentAssignmentReference[] } };
export interface AgentBlockExperience {
  refresh(): Promise<void>;
  setActive(active: boolean): void;
  setPresentation(presentation: 'workspace' | 'focused'): void;
  reflow(): void;
  frame(): void;
  dispose(): void;
}
const pose = (patch: Partial<ExperiencePose> = {}): ExperiencePose => ({ x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1, ...patch });

/** Saved Agent presentation over the existing canonical library. Configuration
 * compatibility and assignment references are never runtime/execution status. */
export function mountAgentBlockExperience(root: HTMLElement, resourceId: string, options: {
  client: Pick<AgentLibraryClientPort, 'inspect' | 'effective' | 'references'>;
  motion: ExperienceMotionPort;
  viewId: string;
  active?: boolean;
  presentation?: 'workspace' | 'focused';
  onOpenAgent(resourceId: string): void | Promise<void>;
  onOpenResource?(resourceId: string): void | Promise<void>;
  resourceTitle?(resourceId: string): string | undefined;
  onProjection?(projection: AgentBlockProjection): void;
}): AgentBlockExperience {
  if (!options.viewId || !options.motion) throw new Error('A unique view identity and shared motion port are required.');
  const motion = options.motion, prefix = 'agent-block:' + options.viewId;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const value = document.createElement(tag); value.textContent = text; value.className = cls;
    if (tag === 'button') value.dataset.aerynthMotionControl = 'true'; return value;
  };
  const section = node('section', '', 'aw-agent-block'), header = node('header', '', 'aw-agent-profile');
  const portrait = node('span', '', 'aw-agent-monogram'), name = node('h3'), label = node('small', 'Saved agent'), identity = node('div');
  const purpose = node('p', '', 'aw-agent-purpose'), specialties = node('div', '', 'aw-agent-specialties');
  const availability = node('p', 'Configuration not loaded', 'aw-agent-compatibility'), toolbar = node('div', '', 'aw-agent-actions');
  const configuration = node('div', '', 'aw-agent-configuration'), configValues = node('dl'), configNote = node('p');
  const work = node('section', '', 'aw-agent-work'), workHeading = node('h4', 'Linked work'), workStatus = node('p'), references = node('ol');
  const status = node('p', '', 'aw-agent-status');
  let disposed = false, active = options.active ?? true, sequence = 0, busy = false, detailsOpen = false;
  let current: AgentBlockProjection = { phase: 'loading' };
  const rows = new Map<string, { element: HTMLLIElement; title: HTMLElement; description: HTMLElement; action: HTMLButtonElement | null }>();
  section.dataset.resourceId = resourceId; section.dataset.noCardDrag = 'true'; section.dataset.presentation = options.presentation ?? 'workspace';
  section.setAttribute('aria-label', 'Agent'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const target = (key: string, value: ExperiencePose, cause: string) => { motion.target(key, value, cause); motion.wake(); };
  const report = () => { if (!disposed && active) status.textContent = 'Opening the selected resource did not finish. You can try again.'; };
  const action = (text: string, run: () => void | Promise<void>) => {
    const value = node('button', text); value.type = 'button'; value.onclick = () => {
      if (!disposed && active && current.phase === 'ready') { try { void Promise.resolve(run()).catch(report); } catch { report(); } }
    }; return value;
  };
  const open = action('Open agent', () => options.onOpenAgent(resourceId));
  const refreshButton = node('button', 'Refresh agent'); refreshButton.type = 'button';
  refreshButton.onclick = () => { if (active && !disposed) void refresh(); };
  const details = action('Configuration', () => {
    detailsOpen = !detailsOpen; details.setAttribute('aria-expanded', String(detailsOpen));
    configuration.inert = !detailsOpen; if (detailsOpen) configuration.hidden = false;
    reflow();
  });
  details.setAttribute('aria-expanded', 'false');
  configuration.hidden = true; configuration.inert = true;
  configuration.append(configValues, configNote); toolbar.append(open, details, refreshButton);
  identity.append(label, name); header.append(portrait, identity); work.append(workHeading, workStatus, references);
  section.append(header, purpose, specialties, availability, toolbar, configuration, work, status); root.append(section);
  motion.add(prefix, pose({ opacity: 0, y: 8 })); motion.add(prefix + ':details', pose({ h: 0, opacity: 0 }));
  section.style.opacity = '0'; configuration.style.height = '0px'; section.inert = !active; section.hidden = !active;
  const notify = () => { options.onProjection?.(current); };
  function reflow() {
    if (disposed || !active) return;
    target(prefix + ':details', pose({ h: detailsOpen && current.phase === 'ready' ? configuration.scrollHeight || 180 : 0, opacity: detailsOpen ? 1 : 0 }), 'agent-configuration-disclosure');
  }
  function paint() {
    if (disposed) return;
    open.disabled = details.disabled = !active || current.phase !== 'ready'; refreshButton.disabled = !active || busy;
    section.setAttribute('aria-busy', String(busy));
    if (current.phase !== 'ready') {
      name.textContent = current.phase === 'loading' ? 'Loading agent…' : 'Agent unavailable'; portrait.textContent = '';
      label.textContent = 'Agent'; purpose.textContent = ''; specialties.replaceChildren(); configValues.replaceChildren(); configNote.textContent = '';
      references.replaceChildren(); rows.clear(); availability.textContent = current.phase === 'loading' ? 'Reading saved profile…' : 'This saved profile is unavailable or no longer accessible.';
      workStatus.textContent = ''; detailsOpen = false; details.setAttribute('aria-expanded', 'false'); configuration.inert = true;
      reflow(); return;
    }
    const { profile, configuration: effective, history } = current;
    name.textContent = profile.resource.title; portrait.textContent = Array.from(profile.resource.title.trim())[0]?.toUpperCase() ?? 'A';
    label.textContent = profile.resource.state === 'archived' ? 'Archived agent' : 'Saved agent';
    purpose.textContent = profile.profile.purpose || 'Open this agent to define its purpose and supported configuration.';
    specialties.replaceChildren(...profile.profile.specialties.slice(0, 6).map(value => node('span', value)));
    availability.textContent = effective ? ({ supported: 'Compatible configuration', 'needs-setup': 'Configuration needs setup', unsupported: 'Unsupported configuration', unknown: 'Configuration availability unknown' } as const)[effective.configurationState] : 'Configuration unavailable';
    configValues.replaceChildren();
    for (const [name, value] of [['Provider', effective?.settings.providerId ?? 'Not configured'], ['Model', effective?.settings.modelId ?? 'Not configured']]) {
      configValues.append(node('dt', name), node('dd', value));
    }
    configNote.textContent = effective ? 'Catalog compatibility only. Provider access and execution are checked separately.' : 'The effective configuration could not be read. Open the agent to review its setup.';
    if (effective?.reasons.length) configNote.textContent += ' ' + effective.reasons.join(' ');
    workStatus.textContent = history.state === 'loading' ? 'Loading authorized work references…' : history.state === 'unavailable'
      ? 'Work reference history is unavailable in this surface.' : history.references.length
        ? `${history.references.length} work references loaded. These links do not start execution.` : 'No work references loaded.';
    const visible = history.state === 'ready' ? history.references.slice(-4).reverse() : [], live = new Set(visible.map(value => value.id));
    for (const [id, row] of rows) if (!live.has(id)) { row.element.remove(); rows.delete(id); }
    for (const reference of visible) {
      let row = rows.get(reference.id);
      if (!row) {
        const element = node('li'), title = node('strong'), description = node('small');
        element.dataset.referenceId = reference.id; element.append(title, description);
        const actionButton = options.onOpenResource ? action(reference.task.supportedTaskOrigin === 'manual-compatibility' ? 'Open manual task' : 'Open work objective', () => {
          const latest = current.phase === 'ready' ? current.history.references.find(value => value.id === reference.id) : undefined;
          if (latest) return options.onOpenResource?.(latest.task.id);
        }) : null;
        if (actionButton) element.append(actionButton); row = { element, title, description, action: actionButton }; rows.set(reference.id, row);
      }
      row.title.textContent = options.resourceTitle?.(reference.task.id) ?? (reference.task.supportedTaskOrigin === 'manual-compatibility' ? 'Manual task reference' : 'Work objective reference');
      row.description.textContent = (reference.execution ? 'Execution linked; current status is not loaded. ' : 'Reference only; no execution started by this link. ') + 'Saved profile version ' + reference.agent.profileVersion + '.';
      if (row.action) row.action.disabled = !active; references.append(row.element);
    }
    reflow();
  }
  async function refresh() {
    if (disposed || !active) return;
    const token = ++sequence; busy = true; status.textContent = ''; paint();
    try {
      const profile = await options.client.inspect(resourceId);
      if (disposed || !active || token !== sequence) return;
      if (profile.resource.id !== resourceId || profile.ref.resourceId !== resourceId) throw new Error('Agent identity mismatch');
      current = { phase: 'ready', profile, configuration: null, history: { state: options.client.references ? 'loading' : 'unavailable', references: [] } }; paint(); notify();
      const [configurationResult, historyResult] = await Promise.allSettled([
        options.client.effective(profile.ref, profile.resource.projectId),
        options.client.references ? options.client.references(resourceId) : Promise.resolve(null),
      ]);
      if (disposed || !active || token !== sequence) return;
      for (const result of [configurationResult, historyResult]) if (result.status === 'rejected' &&
        ['agent_not_authorized', 'agent_resource_unavailable', 'agent_project_unavailable', 'agent_identity_unavailable'].includes(result.reason?.code)) throw result.reason;
      const configuration = configurationResult.status === 'fulfilled' && configurationResult.value.agent.resourceId === resourceId &&
        configurationResult.value.agent.profileVersion === profile.ref.profileVersion && configurationResult.value.agent.resourceVersion === profile.ref.resourceVersion ? configurationResult.value : null;
      const history = historyResult.status === 'fulfilled' && Array.isArray(historyResult.value) && historyResult.value.every(ref => ref.agent.resourceId === resourceId)
        ? { state: 'ready' as const, references: historyResult.value } : { state: 'unavailable' as const, references: [] };
      current = { phase: 'ready', profile, configuration, history }; paint(); notify();
    } catch {
      if (disposed || !active || token !== sequence) return;
      current = { phase: 'unavailable' }; paint(); notify();
    } finally {
      if (!disposed && active && token === sequence) { busy = false; paint(); target(prefix, pose(), 'agent-profile-read'); }
    }
  }
  paint(); if (active) void refresh();
  return {
    refresh,
    setActive(value) {
      if (disposed || active === value) return; active = value; section.inert = !value;
      if (value) { section.hidden = false; void refresh(); } else { sequence++; busy = false; }
      target(prefix, pose({ opacity: value ? 1 : 0, y: value ? 0 : 8 }), 'agent-block-visibility'); paint();
    },
    setPresentation(value) { if (!disposed) { section.dataset.presentation = value; reflow(); } },
    reflow,
    frame() {
      if (disposed) return; const value = motion.pose(prefix), detail = motion.pose(prefix + ':details');
      section.style.opacity = String(value.opacity); section.style.transform = `translateY(${value.y}px)`;
      if (!active && value.opacity < .001) section.hidden = true;
      configuration.style.height = Math.max(0, detail.h) + 'px'; configuration.style.opacity = String(detail.opacity);
      if (!detailsOpen && detail.h < .5) configuration.hidden = true;
    },
    dispose() { if (disposed) return; disposed = true; sequence++; section.inert = true; section.remove(); rows.clear(); motion.remove(prefix); motion.remove(prefix + ':details'); },
  };
}
