/** All content in this module is synthetic and deterministic. No backend is connected. */
export const FIXTURE_SEED = 20261101;
export const FIXTURE_COUNTS = { messages: 2000, events: 1000, blocks: 12, particles: 200, filaments: 8 } as const;

export type BlockKind = 'conversation' | 'note' | 'timeline' | 'files' | 'signal' | 'chart' | 'plan' | 'people' | 'reference' | 'map' | 'terminal' | 'review';
export type ResourceBlock = { id: string; kind: BlockKind; title: string; eyebrow: string; summary: string; detail: string; accent: string };

export const blocks: ResourceBlock[] = [
  { id: 'res-conversation-orion', kind: 'conversation', title: 'The Orion dialogue', eyebrow: 'CONVERSATION', summary: 'A long-form exchange, ready to resume.', detail: '2,000 synthetic messages · virtualized', accent: 'blue' },
  { id: 'res-note-quiet-geometry', kind: 'note', title: 'Quiet geometry', eyebrow: 'FIELD NOTE', summary: '“The space should make thought feel lighter.”', detail: 'Saved concept · synthetic fixture', accent: 'violet' },
  { id: 'res-timeline-dawn', kind: 'timeline', title: 'Dawn sequence', eyebrow: 'TIMELINE', summary: 'Four moments across one continuous scene.', detail: 'Planning artifact · synthetic fixture', accent: 'silver' },
  { id: 'res-files-atlas', kind: 'files', title: 'Atlas study', eyebrow: 'COLLECTION', summary: 'Surfaces, reflections, and spatial studies.', detail: '18 references · synthetic fixture', accent: 'blue' },
  { id: 'res-signal-vela', kind: 'signal', title: 'Vela presence', eyebrow: 'STATE SIGNAL', summary: 'A visible response to explicit state.', detail: 'Developer controlled · simulated', accent: 'violet' },
  { id: 'res-chart-frame', kind: 'chart', title: 'Frame cadence', eyebrow: 'INSTRUMENT', summary: 'Measured browser frame intervals.', detail: 'Local measurement · no telemetry upload', accent: 'cyan' },
  { id: 'res-plan-horizon', kind: 'plan', title: 'Horizon plan', eyebrow: 'PLAN', summary: 'A direction, not a prediction.', detail: 'Five steps · synthetic fixture', accent: 'silver' },
  { id: 'res-people-constellation', kind: 'people', title: 'Constellation', eyebrow: 'RELATIONSHIPS', summary: 'Ideas arranged by meaning.', detail: 'Illustrative graph · synthetic fixture', accent: 'violet' },
  { id: 'res-reference-material', kind: 'reference', title: 'Material library', eyebrow: 'REFERENCE', summary: 'Glass, light, ink, and breathable depth.', detail: 'Design notes · synthetic fixture', accent: 'blue' },
  { id: 'res-map-spatial', kind: 'map', title: 'Spatial map', eyebrow: 'WORKSPACE', summary: 'A place for active resources.', detail: 'Layout model · synthetic fixture', accent: 'cyan' },
  { id: 'res-terminal-local', kind: 'terminal', title: 'Local console', eyebrow: 'TERMINAL', summary: 'An interface study, without command execution.', detail: 'Static example · synthetic fixture', accent: 'silver' },
  { id: 'res-review-trace', kind: 'review', title: 'Review trace', eyebrow: 'EVIDENCE', summary: 'What was observed, and what remains unknown.', detail: 'Lab record · synthetic fixture', accent: 'violet' },
];

export function randomSequence(seed = FIXTURE_SEED) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

const subjects = ['Material study', 'Spatial continuity', 'Quiet attention', 'Scene grammar', 'Window recovery', 'Light and depth', 'Accessible motion', 'Resource identity'];
const thoughts = [
  'The transition should preserve where this object came from.',
  'Keep the reading surface calm while the environment responds.',
  'I can see the next action without losing the wider context.',
  'The visual cue is useful only when it maps to a real state.',
  'A focused object should remain the same object when it returns.',
  'The atmosphere can recede while I read or type.',
];

export type Message = { id: string; index: number; author: 'You' | 'Vela · fixture'; subject: string; text: string; time: string };
export function createMessages(count: number = FIXTURE_COUNTS.messages): Message[] {
  const random = randomSequence();
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-orion-${String(index + 1).padStart(4, '0')}`,
    index,
    author: index % 3 === 0 ? 'You' : 'Vela · fixture',
    subject: subjects[Math.floor(random() * subjects.length)],
    text: thoughts[Math.floor(random() * thoughts.length)],
    time: `DAY ${String(Math.floor(index / 80) + 1).padStart(2, '0')} · ${String(index % 80).padStart(2, '0')}`,
  }));
}

const eventKinds = ['Observation', 'Selection', 'Transition', 'Attention', 'Recovery'] as const;
export type StreamEvent = { id: string; index: number; kind: typeof eventKinds[number]; title: string; detail: string; time: string };
export function createEvents(count: number = FIXTURE_COUNTS.events): StreamEvent[] {
  const random = randomSequence(FIXTURE_SEED + 11);
  return Array.from({ length: count }, (_, index) => {
    const kind = eventKinds[Math.floor(random() * eventKinds.length)];
    return { id: `evt-lab-${String(index + 1).padStart(4, '0')}`, index, kind,
      title: `${kind} / ${subjects[Math.floor(random() * subjects.length)]}`,
      detail: 'Synthetic event for stream and burst testing. No agent operation occurred.',
      time: `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}` };
  });
}

export type Particle = { x: number; y: number; r: number; speed: number; phase: number; alpha: number };
export function createParticles(): Particle[] {
  const random = randomSequence(FIXTURE_SEED + 23);
  return Array.from({ length: FIXTURE_COUNTS.particles }, () => ({
    x: random(), y: random(), r: 0.35 + random() * 1.6, speed: 0.0006 + random() * 0.0015,
    phase: random() * Math.PI * 2, alpha: 0.08 + random() * 0.38,
  }));
}

export type Filament = { x: number; y: number; length: number; bend: number; phase: number };
export function createFilaments(): Filament[] {
  const random = randomSequence(FIXTURE_SEED + 37);
  return Array.from({ length: FIXTURE_COUNTS.filaments }, () => ({
    x: random(), y: random(), length: 0.12 + random() * 0.28,
    bend: (random() - 0.5) * 0.18, phase: random() * Math.PI * 2,
  }));
}
