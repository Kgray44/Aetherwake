import { check, identifier, isRecord } from './capabilities.ts';
import type { VelaMode, VelaTurnRouting } from './adaptive-routing.ts';
import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';
import { VELA_CALIBRATION_MODES, type VelaCalibrationMode } from './routing-calibration.ts';

export const VELA_ROUTING_MODES = ['auto', 'fast', 'deep', 'codex', 'custom'] as const;
const providers = ['chatgpt-plan-responses', 'openai-api-vela', 'codex-app-server'] as const;
const efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const keys = ['mode', 'providerId', 'model', 'reasoningEffort'] as const;
export type VelaRoutingScope = 'global' | 'project' | 'workspace' | 'chat';
export type VelaRoutingDefaults = {
  mode?: VelaMode;
  providerId?: typeof providers[number] | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  /** Independent ceilings. A lower scope never increases a broader allowance. */
  attemptLimits?: Partial<Record<'total' | typeof providers[number], number>>;
  calibration?: VelaCalibrationMode;
};
export interface VelaRoutingProfile {
  scope: VelaRoutingScope;
  id: string | null;
  version: number;
  defaults: VelaRoutingDefaults;
}
export interface VelaRoutingSettingsView {
  profiles: VelaRoutingProfile[];
  effective: VelaRoutingDefaults;
  origins: Partial<Record<typeof keys[number], VelaRoutingScope | 'agent' | 'default' | 'turn'>>;
  attempts?: {
    utcDay: string;
    limits: { scope: 'global' | 'project'; provider: 'total' | typeof providers[number]; limit: number; used: number }[];
  };
  calibration?: { mode: VelaCalibrationMode; samples: number; feedbackRequestIds: string[] };
}
export interface VelaAgentRoutingDefaults {
  mode?: never;
  providerId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
}
export type VelaRoutingSettingsChange = Omit<VelaRoutingProfile, 'version'> & { expectedVersion: number };

export function validateRoutingDefaults(value: unknown): asserts value is VelaRoutingDefaults {
  check(isRecord(value) && Object.keys(value).every(key => key === 'attemptLimits' || key === 'calibration' || (keys as readonly string[]).includes(key)), 'invalid_vela_routing_defaults');
  check(!Object.hasOwn(value, 'calibration') || VELA_CALIBRATION_MODES.some(mode => mode === value.calibration), 'invalid_vela_calibration_mode');
  check(!Object.hasOwn(value, 'mode') || VELA_ROUTING_MODES.some(mode => mode === value.mode), 'invalid_vela_mode');
  check(!Object.hasOwn(value, 'providerId') || value.providerId === null || providers.some(provider => provider === value.providerId), 'invalid_vela_provider');
  check(!Object.hasOwn(value, 'model') || value.model === null || identifier(value.model), 'invalid_vela_model');
  check(!Object.hasOwn(value, 'reasoningEffort') || value.reasoningEffort === null || efforts.some(effort => effort === value.reasoningEffort), 'unsupported_reasoning_effort');
  if (Object.hasOwn(value, 'attemptLimits')) {
    const limits = value.attemptLimits;
    check(isRecord(limits) && Object.entries(limits).every(([key, count]) =>
      (key === 'total' || providers.some(provider => provider === key)) &&
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 10000),
    'invalid_vela_attempt_limit');
  }
}

export function validateRoutingScope(scope: unknown, id: unknown): asserts scope is VelaRoutingScope {
  check(scope === 'global' ? id === null : ['project', 'workspace', 'chat'].some(kind => kind === scope) && identifier(id), 'invalid_vela_routing_scope');
}
export function resolveVelaCalibration(profiles: readonly VelaRoutingProfile[]): VelaCalibrationMode {
  const global = profiles.find(profile => profile.scope === 'global')?.defaults.calibration ?? 'off';
  const project = profiles.find(profile => profile.scope === 'project')?.defaults.calibration ?? global;
  return VELA_CALIBRATION_MODES[Math.min(VELA_CALIBRATION_MODES.indexOf(global), VELA_CALIBRATION_MODES.indexOf(project))];
}

export function resolveRoutingSettings(
  profiles: readonly VelaRoutingProfile[], turn?: VelaTurnRouting, agent?: VelaAgentRoutingDefaults,
): Omit<VelaRoutingSettingsView, 'profiles'> {
  const effective: VelaRoutingDefaults = { mode: 'auto' };
  const origins: VelaRoutingSettingsView['origins'] = { mode: 'default' };
  function apply(layer: VelaRoutingDefaults | VelaAgentRoutingDefaults, origin: VelaRoutingScope | 'agent' | 'turn') {
    // A model and effort belong to their backend. A destination change clears
    // subordinate inherited pins before accepting any from the new layer.
    if (layer.providerId !== undefined && layer.providerId !== effective.providerId) {
      delete effective.model;
      delete effective.reasoningEffort;
      delete origins.model;
      delete origins.reasoningEffort;
    }
    if (layer.providerId && layer.providerId !== 'codex-app-server' && layer.mode === undefined && effective.mode === 'codex') {
      effective.mode = 'auto';
      origins.mode = origin;
    }
    if (layer.model !== undefined && layer.model !== effective.model) {
      delete effective.reasoningEffort;
      delete origins.reasoningEffort;
    }
    for (const key of keys) {
      const value = layer[key];
      if (value !== undefined) {
        Object.assign(effective, { [key]: value });
        origins[key] = origin;
      }
    }
  }
  if (!turn?.overrideDefaults) {
    for (const profile of profiles) apply(profile.defaults, profile.scope);
    if (agent) apply(agent, 'agent');
  } else {
    apply({ mode: 'auto', providerId: null, model: null, reasoningEffort: null }, 'turn');
  }
  if (turn) {
    const overrides = Object.fromEntries(keys.flatMap(key => turn[key] === undefined ? [] : [[key, turn[key]]]));
    validateRoutingDefaults(overrides);
    apply(overrides, 'turn');
  }
  validateRoutingDefaults(effective);
  return { effective, origins };
}
