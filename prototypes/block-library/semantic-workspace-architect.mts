import type { BlockKind, CanonicalTemplateHost, ResourceCandidate, TemplateResourceRole, VelaTemplatePlanner } from './contracts.ts';
import { blockDefinition } from './registry.ts';
import { check, validateDraft } from './model.ts';
import { composeWorkspaceBlueprint } from './workspace-architect.mts';

export const SEMANTIC_WORKSPACE_INSTRUCTION = 'Design a useful workspace for the stated purpose. Choose supported functional block roles and relevant existing resources from the supplied authorized metadata. Reuse their exact IDs where useful. New notes and checklists may start empty. Never invent files, repositories, resource IDs or capabilities. Keep at most eight complementary roles, giving primary work useful space and secondary references compact space. Return only the required JSON.';
export const SEMANTIC_WORKSPACE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'rationale', 'roles'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, rationale: { type: 'string', minLength: 1, maxLength: 500 },
    roles: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['key', 'label', 'kind', 'resourceId', 'compact'], properties: {
        key: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 120 },
        kind: { type: 'string', minLength: 1, maxLength: 60 }, resourceId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] },
        compact: { type: 'boolean' },
      } } },
  },
} as const;
export interface SemanticWorkspaceRequest {
  instruction: string; payload: { purpose: string; projectId: string | null; supportedKinds: BlockKind[];
    candidates: ResourceCandidate[]; discoveryComplete: boolean };
  schema: typeof SEMANTIC_WORKSPACE_SCHEMA; requestId: string; validate(): void;
}
export interface SemanticWorkspacePort { propose(request: SemanticWorkspaceRequest, signal?: AbortSignal): Promise<unknown> }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f]/u.test(value);
const snapshot = (candidates: ResourceCandidate[]) => JSON.stringify(candidates.map(item => [item.id, item.kind, item.projectId, item.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Model reasoning chooses roles. Canonical validation and deterministic geometry retain all mutation authority. */
export function createSemanticWorkspaceArchitect(host: Pick<CanonicalTemplateHost, 'capabilities' | 'workspacePlanningResources'>,
  port: SemanticWorkspacePort): VelaTemplatePlanner {
  return { async plan(input, signal) {
    const supported = [...new Set(input.supportedKinds)].filter(kind => host.capabilities().kinds[kind]?.state === 'available');
    const discover = () => host.workspacePlanningResources?.(input.projectId);
    const initial = discover(), candidates = (initial?.resources ?? []).filter(resource => resource.projectId === input.projectId && supported.includes(resource.kind)).slice(0, 64);
    check(new Set(candidates.map(item => item.id)).size === candidates.length, 'semantic_workspace_ambiguous_catalog');
    const fence = snapshot(candidates);
    const validate = () => {
      check(!signal?.aborted, 'semantic_workspace_cancelled');
      const current = discover()?.resources ?? [];
      const ids = new Set(candidates.map(item => item.id));
      check(snapshot(current.filter(item => ids.has(item.id))) === fence, 'semantic_workspace_sources_changed');
      check(supported.every(kind => host.capabilities().kinds[kind]?.state === 'available'), 'semantic_workspace_capabilities_changed');
    };
    validate();
    const raw = await port.propose({ instruction: SEMANTIC_WORKSPACE_INSTRUCTION, schema: SEMANTIC_WORKSPACE_SCHEMA,
      requestId: input.requestId, validate, payload: { purpose: input.prompt, projectId: input.projectId, supportedKinds: supported,
        candidates: structuredClone(candidates), discoveryComplete: initial?.complete === true && (initial.resources.length <= 64) } }, signal);
    validate();
    check(record(raw) && exact(raw, ['title', 'rationale', 'roles']) && bounded(raw.title, 120) && bounded(raw.rationale, 500) &&
      Array.isArray(raw.roles) && raw.roles.length > 0 && raw.roles.length <= 8, 'invalid_semantic_workspace');
    const used = new Set<string>(), keys = new Set<string>(), compact = new Set<string>();
    const resources: TemplateResourceRole[] = raw.roles.map(value => {
      check(record(value) && exact(value, ['key', 'label', 'kind', 'resourceId', 'compact']) &&
        typeof value.key === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(value.key) && !keys.has(value.key) &&
        bounded(value.label, 120) && typeof value.kind === 'string' && supported.includes(value.kind as BlockKind) &&
        typeof value.compact === 'boolean' && (value.resourceId === null || typeof value.resourceId === 'string'), 'invalid_semantic_workspace_role');
      keys.add(value.key); if (value.compact) compact.add(value.key);
      const kind = value.kind as BlockKind, existing = value.resourceId === null ? undefined : candidates.find(item => item.id === value.resourceId && item.kind === kind);
      check(value.resourceId === null || existing && !used.has(existing.id), 'semantic_workspace_reference_unavailable');
      if (existing) { used.add(existing.id); return { key: value.key, label: value.label,
        source: { mode: 'reference', kind, resourceId: existing.id, expectedVersion: existing.version } }; }
      check(blockDefinition(kind).creation !== 'reference-only' && !['file', 'link'].includes(kind), 'semantic_workspace_cannot_create_reference');
      check(kind !== 'conversation' || host.capabilities().providers.local?.state === 'available', 'semantic_workspace_conversation_unavailable');
      return { key: value.key, label: value.label, source: { mode: 'new', kind, title: value.label,
        ...(kind === 'conversation' ? { provider: 'local' as const } : {}), ...(kind === 'checklist' ? { emptyChecklist: true as const } : {}) } };
    });
    return { ...validateDraft({ name: raw.title, description: raw.rationale, tags: ['workspace-architect', 'semantic'],
      body: composeWorkspaceBlueprint(resources, compact) }), provenance: { requestId: input.requestId, providerId: 'openai-api-vela' } };
  } };
}
