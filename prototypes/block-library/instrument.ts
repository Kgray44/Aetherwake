import type { BlockComposition } from './presentation-policy.ts';
import type { BlockDefinition, BlockInstanceKind, LibraryCapabilities } from './contracts.ts';
import { blockAvailability, catalogDefinition } from './registry.ts';
import type { ExperienceMotionPort, ExperiencePose } from '../application-contract/motion.ts';

export type InstrumentMode = 'glance' | 'interaction' | 'immersion';
export type InstrumentIntent = 'conversation' | 'knowledge' | 'time' | 'execution' | 'navigation' | 'environment' | 'specialists';
export type InstrumentDataClass = 'observed' | 'reported' | 'inferred' | 'simulated' | 'unknown';
export type SemanticMotion = 'morph' | 'branch' | 'join' | 'orbit' | 'unfurl' | 'collapse' | 'reveal' | 'settle' | 'snap' | 'focus' | 'replay';

const intents: Record<BlockInstanceKind, readonly InstrumentIntent[]> = {
  conversation: ['conversation'], note: ['knowledge'], research: ['knowledge'], reference: ['knowledge'],
  task: ['execution'], task_group: ['execution'], checklist: ['execution'], task_objective: ['execution'],
  agent: ['specialists', 'execution'], timeline: ['time'], clock_timer: ['time'], stream: ['execution'],
  project_overview: ['navigation'], resource_browser: ['navigation', 'knowledge'], collection_browser: ['navigation', 'knowledge'],
  file: ['knowledge'], folder: ['navigation'], link: ['knowledge'],
};
export const instrumentIntents: readonly InstrumentIntent[] = Object.freeze(['conversation', 'knowledge', 'time', 'execution', 'navigation', 'environment', 'specialists']);

/** A projection of the existing block manifest, never a second registration or
 * capability authority. Runtime availability is re-read for every discovery. */
export function instrumentDescriptor(kind: BlockInstanceKind, capabilities?: LibraryCapabilities) {
  const definition = catalogDefinition(kind);
  return Object.freeze({
    kind: definition.kind, label: definition.title, purpose: definition.description,
    intents: intents[kind], supportedModes: ['glance', 'interaction', 'immersion'] as readonly InstrumentMode[],
    bindableResourceKinds: definition.compatibleResourceKinds,
    bindableSubjectKinds: definition.compatibleSubjectKinds ?? [],
    minSize: definition.minimumSize, capabilities: definition.controls,
    creation: definition.compatibleSubjectKinds?.length ? 'subject-reference' : definition.creation ?? 'create-or-reference', requiredServices: definition.requiredServices,
    availability: capabilities ? blockAvailability(kind, capabilities) : { state: 'unknown' as const, reason: 'No live capability snapshot supplied.' },
    motionProfileId: kind === 'timeline' || kind === 'stream' ? 'structural' : 'information',
  });
}

export function instrumentMatchesIntent(definition: BlockDefinition<BlockInstanceKind>, intent: InstrumentIntent | '') {
  return !intent || intents[definition.kind].includes(intent);
}

/** Reuse the current footprint/focus decisions. Modes do not create resources,
 * change permission, or impose minimum resize constraints on saved layouts. */
export function instrumentMode(composition: BlockComposition, focused: boolean): InstrumentMode {
  return composition === 'overview' ? 'glance' : focused ? 'immersion' : 'interaction';
}

export interface InstrumentProjection {
  placementId: string;
  resourceId?: string;
  subjectId?: string;
  sourceRevision?: number;
  mode: InstrumentMode;
  semanticState: string;
  dataClass: InstrumentDataClass;
  focusRef?: string;
}

export function projectInstrumentMode(projection: InstrumentProjection, mode: InstrumentMode): InstrumentProjection {
  return { ...projection, mode };
}

const neutral: ExperiencePose = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
/** Shared semantic targets use the existing coordinator's exact spring and host
 * frame. Retargeting starts at the displayed pose/velocity; no clock or RAF is
 * owned here. Geometry remains caller supplied and bounded by its layout. */
export function semanticTarget(motion: ExperienceMotionPort, key: string, primitive: SemanticMotion, geometry: Partial<ExperiencePose> = {}) {
  const target = { ...neutral, ...geometry };
  if (!Object.values(target).every(Number.isFinite)) throw new Error('Invalid instrument motion target');
  motion.target(key, target, `instrument:${primitive}`);
  motion.wake();
}
