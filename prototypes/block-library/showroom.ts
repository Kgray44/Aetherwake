import type { BlockInstanceKind, LibraryCapabilities } from './contracts.ts';
import { REGISTERED_BLOCKS, blockAvailability, blockCapabilities, catalogDefinition, isSubjectBlockKind } from './registry.ts';
import { instrumentDescriptor, instrumentMatchesIntent, semanticTarget, type InstrumentIntent } from './instrument.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

/** Search registry facts and the current host snapshot, including restrictions. */
export function searchShowroom(query: string, capabilities: LibraryCapabilities, intent: InstrumentIntent | '' = '') {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 16);
  return REGISTERED_BLOCKS.filter(definition => {
    if (!instrumentMatchesIntent(definition, intent)) return false;
    const descriptor = instrumentDescriptor(definition.kind, capabilities);
    const actual = isSubjectBlockKind(definition.kind) ? [] : blockCapabilities(definition.kind, capabilities);
    const haystack = [descriptor.label, descriptor.purpose, definition.kind, ...descriptor.intents, ...definition.keywords,
      ...descriptor.bindableResourceKinds, ...descriptor.bindableSubjectKinds, ...descriptor.capabilities, descriptor.creation,
      descriptor.availability.state, descriptor.availability.reason ?? '',
      ...actual.flatMap(capability => [capability.id.replaceAll('-', ' '), capability.availability.state, capability.availability.reason ?? ''])].join(' ').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }).map(definition => ({ ...definition, availability: blockAvailability(definition.kind, capabilities) }));
}

export function instrumentRequirements(kind: BlockInstanceKind, capabilities: LibraryCapabilities): HTMLElement {
  const descriptor = instrumentDescriptor(kind, capabilities), root = document.createElement('div');
  root.className = 'aw-showroom-requirements';
  const line = (text: string) => { const p = document.createElement('p'); p.className = 'aw-library__hint'; p.textContent = text; root.append(p); };
  line('Availability · ' + descriptor.availability.state.replaceAll('_', ' ') + (descriptor.availability.reason ? ' — ' + descriptor.availability.reason : ''));
  line('Data · ' + [...descriptor.bindableResourceKinds, ...descriptor.bindableSubjectKinds].join(', ') +
    (descriptor.creation === 'reference-only' ? ' · choose an existing saved resource; this type cannot be freely created here.' : kind === 'file' || kind === 'link' ? ' · explicit native file selection or link input.' : descriptor.bindableSubjectKinds.length ? ' · choose an authorized existing subject.' : ' · create a canonical resource or attach an existing compatible resource.'));
  line(`Size · minimum ${descriptor.minSize.width} × ${descriptor.minSize.height}; compact content follows the block’s supported presentation. Expand or focus for its controls.`);
  return root;
}

/** Local presentation fixtures only: these controls have no service/host port. */
export function demonstrationSteps(kind: BlockInstanceKind): readonly string[] {
  if (kind === 'timeline') return [
    'Overview · Two synthetic captured events share a time axis; the gap stays visible.',
    'Zoom · Inspect a narrower range around the example workspace save.',
    'Filter · Focus the example local-host source; this does not verify a task outcome.',
    'Inspect · Example event: workspace.saved · observed · source local host. Saved Timelines are attached, not created here.',
  ];
  if (kind === 'clock_timer') return ['Ready · Example countdown 05:00.', 'Running · Example countdown 04:59. No real timer was started.', 'Paused · Example countdown holds at 04:59.', 'Resumed · Example countdown 04:58. Native timing is separate.'];
  if (kind === 'stream') return ['Intent · Synthetic mission requests two independent source samples.', 'Branch · Example source A and source B proceed on separate declared task branches.', 'Join · Example evidence joins only after both declared dependencies. No real work is running.', 'Inspect · Synthetic task dependencies explain the shape; real Flow requires authorized canonical mission data.'];
  if (kind === 'agent') return ['Profile · Example saved researcher; no execution is running.', 'Inspect · Read example purpose and supported configuration.', 'Attach · A real placement requires choosing an authorized saved agent.'];
  if (kind === 'checklist' || kind === 'task' || kind === 'task_group') return ['Open · Example manual items await review.', 'Review · Inspect the example item and its source.', 'Checked · Example user change; a checkmark does not verify agent execution.'];
  if (kind === 'conversation') return ['Compose · An example local conversation is ready.', 'Message · An example message appears; no provider is contacted.', 'Context · Inspect the example conversation; actual replies require a connected provider.'];
  if (kind === 'note' || kind === 'research' || kind === 'reference') return ['Read · An example document has a title and section.', 'Focus · Select a section of the example text.', 'Reference · Highlight an example source; no external content is fetched.'];
  if (kind === 'file' || kind === 'link') return ['Choose · Real media requires an explicit picker or link input.', 'Inspect · This miniature contains no user file or remote content.', 'Open · Native readers and external actions remain separate from this demonstration.'];
  return ['Overview · Inspect the example ' + catalogDefinition(kind).title + '.', 'Focus · Highlight an example item.', 'Inspect · Actual resources and permissions are resolved only by the native host.'];
}

/** Small purpose-specific compositions; every mark is synthetic, never telemetry. */
export function instrumentMiniature(kind: BlockInstanceKind, step = 0): HTMLElement {
  const root = document.createElement('div');
  root.className = 'aw-showroom-miniature'; root.dataset.kind = kind; root.dataset.step = String(step);
  root.setAttribute('aria-hidden', 'true');
  const mark = (text: string, cls = '') => {
    const element = document.createElement('span'); element.className = cls; element.textContent = text; root.append(element);
  };
  if (kind === 'timeline') {
    root.className += ' aw-showroom-miniature--timeline';
    mark(step === 1 ? '12:03 ── 12:04 ── 12:05' : '12:00 ───────────── 12:10', 'aw-showroom-axis');
    mark('◆ save', 'aw-showroom-node'); mark(step === 2 ? 'source filter · local host' : '⋯ gap ⋯  ◇ response', 'aw-showroom-gap');
  } else if (kind === 'clock_timer') {
    root.className += ' aw-showroom-miniature--timer'; mark('◴', 'aw-showroom-orbit'); mark(['05:00', '04:59', '04:59', '04:58'][step % 4], 'aw-showroom-digits'); mark(step === 2 ? 'Paused' : step ? 'Example countdown' : 'Ready');
  } else if (kind === 'stream') {
    root.className += ' aw-showroom-miniature--stream';
    mark('◎ Example intent', 'aw-showroom-example-intent');
    const branches = document.createElement('div'); branches.className = 'aw-showroom-example-branches';
    for (const label of ['Source A', 'Source B']) { const branch = document.createElement('span'); branch.textContent = (step >= 1 ? '◈ ' : '◇ ') + label; branches.append(branch); }
    root.append(branches); mark(step >= 2 ? '▣ Example evidence join' : '◇ Await both sources', 'aw-showroom-example-join');
  } else if (kind === 'conversation') {
    root.className += ' aw-showroom-miniature--conversation'; mark('A question', 'aw-showroom-message'); mark(step ? 'Example message · local history' : 'Write a message…', 'aw-showroom-message aw-showroom-message--reply');
  } else if (kind === 'agent') {
    root.className += ' aw-showroom-miniature--agent'; mark('R', 'aw-showroom-profile'); mark('Researcher'); mark(step ? 'Purpose · configuration' : 'Saved profile · idle');
  } else if (kind === 'task' || kind === 'task_group' || kind === 'checklist' || kind === 'task_objective') {
    root.className += ' aw-showroom-miniature--tasks'; mark(kind === 'task_objective' ? 'Objective → Requirements' : 'Review'); mark('✓ Gather sources'); mark(step >= 2 ? '✓ Record questions · manual' : '○ Record questions');
  } else if (kind === 'project_overview' || kind === 'resource_browser' || kind === 'collection_browser' || kind === 'folder') {
    root.className += ' aw-showroom-miniature--navigation'; mark(kind === 'collection_browser' ? 'Collection' : kind === 'project_overview' ? 'Project' : 'Resources'); mark('├ ▤ Notes'); mark(step ? '└ ◈ Selected source' : '└ ◈ Sources');
  } else {
    root.className += ' aw-showroom-miniature--document'; mark(kind === 'file' ? '▤ Source reader' : kind === 'link' ? '↗ example.org' : 'Working notes', 'aw-showroom-document-title'); mark('━━━━━━━━━━'); mark(step ? 'Linked example source ↗' : '━━━━━━');
  }
  return root;
}

export type ShowroomReplay = { frame(): void; dispose(): void };
export type ShowroomReplayOptions = {
  motion?: ExperienceMotionPort;
  key?: string;
  active?(): boolean;
  register?(replay: ShowroomReplay): void;
};
let replayIdentity = 0;

/** Finite replay borrows the host's coordinator and frame. It owns no clock or scheduler. */
export function showroomDemonstration(kind: BlockInstanceKind, options: ShowroomReplayOptions = {}): HTMLElement {
  const ownerDocument = document;
  const root = document.createElement('section'); root.className = 'aw-showroom-demo';
  root.setAttribute('aria-label', catalogDefinition(kind).title + ' synthetic demonstration');
  const steps = demonstrationSteps(kind), stage = document.createElement('div'), status = document.createElement('p'), controls = document.createElement('div');
  controls.className = 'aw-showroom-controls'; status.className = 'aw-library__hint'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  let step = 0, playing = false, owned = false, disposed = false;
  const motion = options.motion, key = options.key ?? 'showroom:' + kind + ':' + ++replayIdentity;
  const pose = (x: number): ExperiencePose => ({ x, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 });
  const release = () => { if (owned) { motion!.remove(key); owned = false; motion!.wake(); } };
  const stop = () => { const animated = playing; playing = false; release(); if (animated) { stage.style.transform = ''; stage.style.opacity = ''; } pause.disabled = true; };
  const visible = () => !disposed && root.isConnected && !root.hidden && ownerDocument.visibilityState !== 'hidden' && (options.active?.() ?? true);
  const action = (label: string, run: () => void) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'aw-library__button'; button.textContent = label; button.onclick = run; controls.append(button); return button; };
  const paint = () => { stage.replaceChildren(instrumentMiniature(kind, step)); status.textContent = `Example step ${step + 1} / ${steps.length} · ${steps[step]}`; previous.disabled = step === 0; next.disabled = step === steps.length - 1; };
  const replay = action('Replay example', () => {
    if (disposed) return;
    stop(); step = 0; paint();
    if (!motion || motion.reduced || !visible()) return;
    playing = true; pause.disabled = false; owned = true; motion.add(key, pose(0));
    semanticTarget(motion, key, 'replay', pose(1));
  }); replay.dataset.demoReplay = kind;
  const pause = action('Pause example', () => { stop(); }); pause.dataset.demoPause = kind; pause.disabled = true;
  const previous = action('Previous step', () => { if (disposed) return; stop(); step = Math.max(0, step - 1); paint(); });
  const next = action('Next step', () => { if (disposed) return; stop(); step = Math.min(steps.length - 1, step + 1); paint(); }); next.dataset.demoNext = kind;
  const label = document.createElement('p'); label.className = 'aw-library__hint';
  label.textContent = 'Synthetic interaction demonstration · no live activity or user data · ' + (motion && !motion.reduced ? 'Replay animates this finite example; step controls are always available.' : 'Advance steps manually (reduced motion or animation unavailable).');
  const replayView: ShowroomReplay = {
    frame() {
      if (!playing || disposed) return;
      if (!visible() || motion!.reduced) { stop(); return; }
      const current = motion!.pose(key), progress = Math.max(0, Math.min(1, current.x - step));
      stage.style.transform = `translateY(${(1 - progress) * 8}px)`;
      stage.style.opacity = String(.45 + .55 * progress);
      const axis = stage.querySelector<HTMLElement>('.aw-showroom-axis');
      if (axis) { axis.style.transformOrigin = 'left'; axis.style.transform = `scaleX(${step === 1 ? .88 + progress * .12 : 1})`; }
      const event = stage.querySelector<HTMLElement>('.aw-showroom-node');
      if (event) event.style.transform = `translateX(${(1 - progress) * 14}px)`;
      if (Math.abs(current.x - (step + 1)) > .001) return;
      if (step === steps.length - 1) { stop(); return; }
      step++; paint(); semanticTarget(motion!, key, 'replay', pose(step + 1));
    },
    dispose() { if (disposed) return; stop(); disposed = true; ownerDocument.removeEventListener?.('visibilitychange', visibility); },
  };
  const visibility = () => { if (ownerDocument.visibilityState === 'hidden') stop(); };
  if (motion) ownerDocument.addEventListener?.('visibilitychange', visibility);
  options.register?.(replayView);
  root.append(label, stage, status, controls); paint(); return root;
}
