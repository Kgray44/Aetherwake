import type { CapabilityDescriptor, DelegateTaskAction, PlanStep, ProviderProposal, VelaNativeAction } from './contracts.ts';
import { defaultOrganization, updateOrganization } from '../../workspace-engine/organization.mts';
import type { OrganizationUpdate } from '../../workspace-engine/contracts.mts';

export class VelaError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new VelaError(code);
}
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export const identifier = (v: unknown): v is string => text(v, 200) && !/[\x00-\x1f]/.test(v);
const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 1;
const fields = (v: Record<string, unknown>, names: string[]) => Object.keys(v).every(k => names.includes(k)) && names.every(k => Object.hasOwn(v, k));
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(identifier) && new Set(v).size === v.length;
const nullableId = (v: unknown) => v === null || identifier(v);
const stringSchema = { type: 'string', minLength: 1, maxLength: 200 };
const idSchema = stringSchema;
const arraySchema = { type: 'array', maxItems: 100, uniqueItems: true, items: idSchema };
const nullableIdSchema = { anyOf: [idSchema, { type: 'null' }] };
const versionSchema = { type: 'integer', minimum: 1 };
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const boundedNumber = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const optionalObjectSchema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties });
const organizationSchema = optionalObjectSchema({
  mode: { enum: ['fluid', 'freeform', 'structured'] }, gap: boundedNumber(0, 256),
  structured: optionalObjectSchema({
    columnCount: { anyOf: [{ type: 'integer', minimum: 1, maximum: 12 }, { type: 'null' }] },
    rowHeight: boundedNumber(32, 512), rowGap: boundedNumber(0, 256), columnGap: boundedNumber(0, 256), margin: boundedNumber(0, 256),
    preset: { enum: ['balanced', 'focus', 'development', 'research'] },
    order: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 512 } },
    spans: { type: 'object', additionalProperties: objectSchema({ columns: { type: 'integer', minimum: 1, maximum: 128 }, rows: { type: 'integer', minimum: 1, maximum: 256 } }) },
  }),
});
function organization(value: unknown): value is OrganizationUpdate {
  if (!isRecord(value)) return false;
  if (isRecord(value.structured) && isRecord(value.structured.spans) && !Object.values(value.structured.spans).every(span => isRecord(span) && fields(span, ['columns', 'rows']))) return false;
  try { updateOrganization(defaultOrganization(), value); return true; } catch { return false; }
}
function capability(id: CapabilityDescriptor['id'], label: string, effect: CapabilityDescriptor['effect'], properties: Record<string, unknown>, scope: string): CapabilityDescriptor {
  return { id, label, effect, schema: objectSchema(properties), scope,
    authorization: id === 'delegateTask' ? 'explicit-execution-authorization' : 'host-policy',
    reversible: ['read', 'navigate'].includes(effect) ? 'no-state-change' : 'host-dependent' };
}
export const CAPABILITIES: CapabilityDescriptor[] = [
  capability('search', 'Search authorized application resources', 'read', { query: stringSchema }, 'Authorized metadata only; content requires separate retrieval'),
  capability('navigate', 'Open a workspace or project constellation', 'navigate', { type: { const: 'navigate' }, target: { oneOf: [objectSchema({ kind: { const: 'workspace' }, workspaceId: idSchema }), objectSchema({ kind: { const: 'constellation' }, projectId: nullableIdSchema })] } }, 'One authorized navigation target'),
  capability('createProject', 'Create a project', 'create', { type: { const: 'createProject' }, title: stringSchema }, 'One new canonical project; does not change the authorized scope or grant access to another project'),
  capability('createWorkspace', 'Create an empty workspace', 'create', { type: { const: 'createWorkspace' }, title: stringSchema, projectId: nullableIdSchema }, 'One canonical workspace in the exact authorized project or without a project; opens the new workspace'),
  capability('renameWorkspace', 'Rename a workspace', 'mutate', { type: { const: 'renameWorkspace' }, workspaceId: idSchema, title: stringSchema }, 'One authorized workspace; current entity and layout revisions are bound by the target manifest'),
  capability('bringAllIntoView', 'Frame the current workspace', 'mutate', { type: { const: 'bringAllIntoView' }, workspaceId: idSchema }, 'Frame the current authorized workspace using actual presenter bounds supplied outside the model action; does not create or duplicate resources'),
  capability('resolveLayout', 'Resolve workspace layout collisions', 'mutate', { type: { const: 'resolveLayout' }, workspaceId: idSchema }, 'One authorized workspace and its existing canonical layout participants, including Vela'),
  capability('setOrganization', 'Set workspace organization', 'mutate', { type: { const: 'setOrganization' }, workspaceId: idSchema, organization: organizationSchema }, 'One authorized workspace; validates the canonical organization update and retains resource identities'),
  capability('workspaceFromResources', 'Create a workspace from existing resources', 'create', { type: { const: 'workspaceFromResources' }, title: stringSchema, projectId: nullableIdSchema, resourceIds: arraySchema }, 'Create one workspace; attach references to the exact existing resource IDs; never duplicate resources'),
  capability('createResource', 'Create a note, task, or task group', 'create', { type: { const: 'createResource' }, kind: { enum: ['note', 'task', 'task_group'] }, title: stringSchema, workspaceId: nullableIdSchema }, 'One local canonical resource; optional authorized workspace placement'),
  capability('attach', 'Place an existing resource', 'mutate', { type: { const: 'attach' }, workspaceId: idSchema, resourceId: idSchema }, 'One existing canonical resource and one workspace'),
  capability('content', 'Edit a local resource', 'mutate', { type: { const: 'content' }, resourceId: idSchema, expectedVersion: versionSchema, content: { type: 'string', maxLength: 100000 } }, 'One versioned resource; host validates resource type'),
  capability('taskStatus', 'Update task status', 'mutate', { type: { const: 'taskStatus' }, resourceId: idSchema, expectedVersion: versionSchema, status: { enum: ['open', 'done'] } }, 'One versioned task; status does not assert verified outcome'),
  capability('taskPriority', 'Update task priority', 'mutate', { type: { const: 'taskPriority' }, resourceId: idSchema, expectedVersion: versionSchema, priority: { enum: ['low', 'normal', 'high', 'urgent'] } }, 'One authorized versioned task; priority does not change completion or verification state'),
  capability('setTaskGroupMembers', 'Organize task group members', 'mutate', { type: { const: 'setTaskGroupMembers' }, groupId: idSchema, expectedVersion: versionSchema, taskIds: arraySchema }, 'One versioned group and an explicit task set'),
  capability('relate', 'Link two resources', 'mutate', { type: { const: 'relate' }, sourceId: idSchema, targetId: idSchema, kind: stringSchema }, 'Two existing resources; source is Vela, not inferred authority'),
  capability('applyStructuredPreset', 'Apply a workspace layout preset', 'mutate', { type: { const: 'applyStructuredPreset' }, workspaceId: idSchema, preset: { enum: ['balanced', 'focus', 'development', 'research'] } }, 'One authorized workspace; references and histories retain identity'),
  capability('delegateTask', 'Request an explicitly authorized provider execution', 'provider-execution', { type: { const: 'delegateTask' }, title: stringSchema, objective: { type: 'string', minLength: 1, maxLength: 16000 }, providerId: idSchema, resourceIds: arraySchema, constraints: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 1000 } } }, 'Original intent, source conversation, exact resource manifest, provider identity, and host-issued execution authorization'),
];

export function validateAction(value: unknown): VelaNativeAction | DelegateTaskAction {
  check(isRecord(value), 'invalid_action');
  const v = value;
  let valid = false;
  switch (v.type) {
    case 'navigate': valid = fields(v, ['type', 'target']) && isRecord(v.target) && (
      (fields(v.target, ['kind', 'workspaceId']) && v.target.kind === 'workspace' && identifier(v.target.workspaceId)) ||
      (fields(v.target, ['kind', 'projectId']) && v.target.kind === 'constellation' && nullableId(v.target.projectId))); break;
    case 'createProject': valid = fields(v, ['type', 'title']) && text(v.title); break;
    case 'createWorkspace': valid = fields(v, ['type', 'title', 'projectId']) && text(v.title) && nullableId(v.projectId); break;
    case 'renameWorkspace': valid = fields(v, ['type', 'workspaceId', 'title']) && identifier(v.workspaceId) && text(v.title); break;
    case 'bringAllIntoView': case 'resolveLayout': valid = fields(v, ['type', 'workspaceId']) && identifier(v.workspaceId); break;
    case 'setOrganization': valid = fields(v, ['type', 'workspaceId', 'organization']) && identifier(v.workspaceId) && organization(v.organization); break;
    case 'workspaceFromResources': valid = fields(v, ['type', 'title', 'projectId', 'resourceIds']) && text(v.title) && nullableId(v.projectId) && ids(v.resourceIds); break;
    case 'createResource': valid = fields(v, ['type', 'kind', 'title', 'workspaceId']) && ['note', 'task', 'task_group'].includes(String(v.kind)) && text(v.title) && nullableId(v.workspaceId); break;
    case 'attach': valid = fields(v, ['type', 'workspaceId', 'resourceId']) && identifier(v.workspaceId) && identifier(v.resourceId); break;
    case 'content': valid = fields(v, ['type', 'resourceId', 'expectedVersion', 'content']) && identifier(v.resourceId) && version(v.expectedVersion) && typeof v.content === 'string' && v.content.length <= 100000; break;
    case 'taskStatus': valid = fields(v, ['type', 'resourceId', 'expectedVersion', 'status']) && identifier(v.resourceId) && version(v.expectedVersion) && ['open', 'done'].includes(String(v.status)); break;
    case 'taskPriority': valid = fields(v, ['type', 'resourceId', 'expectedVersion', 'priority']) && identifier(v.resourceId) && version(v.expectedVersion) && ['low', 'normal', 'high', 'urgent'].includes(String(v.priority)); break;
    case 'setTaskGroupMembers': valid = fields(v, ['type', 'groupId', 'expectedVersion', 'taskIds']) && identifier(v.groupId) && version(v.expectedVersion) && ids(v.taskIds); break;
    case 'relate': valid = fields(v, ['type', 'sourceId', 'targetId', 'kind']) && identifier(v.sourceId) && identifier(v.targetId) && typeof v.kind === 'string' && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(v.kind); break;
    case 'applyStructuredPreset': valid = fields(v, ['type', 'workspaceId', 'preset']) && identifier(v.workspaceId) && ['balanced', 'focus', 'development', 'research'].includes(String(v.preset)); break;
    case 'delegateTask': valid = fields(v, ['type', 'title', 'objective', 'providerId', 'resourceIds', 'constraints']) && text(v.title) && text(v.objective, 16000) && identifier(v.providerId) && ids(v.resourceIds) && Array.isArray(v.constraints) && v.constraints.length <= 30 && v.constraints.every(c => text(c, 1000)); break;
  }
  check(valid, 'unsupported_or_invalid_action');
  return structuredClone(v) as unknown as VelaNativeAction | DelegateTaskAction;
}

export function validateProposal(value: unknown, providerId: string): ProviderProposal {
  check(isRecord(value) && fields(value, ['schemaVersion', 'summary', 'steps', 'contribution']), 'invalid_provider_proposal');
  check(value.schemaVersion === 1 && text(value.summary, 4000) && Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 12, 'invalid_provider_proposal');
  const c = value.contribution;
  check(isRecord(c) && c.providerId === providerId && c.classification === 'reported' && Object.keys(c).every(k => ['providerId', 'model', 'nativeThreadId', 'nativeTurnId', 'executionId', 'planningConversationId', 'sourceMessageId', 'classification'].includes(k)) && Object.entries(c).every(([k, v]) => k === 'classification' || text(v, 200)), 'invalid_provider_attribution');
  const steps = value.steps.map((step): PlanStep => {
    check(isRecord(step) && fields(step, ['id', 'explanation', 'action']) && identifier(step.id) && text(step.explanation, 2000), 'invalid_plan_step');
    return { id: step.id, explanation: step.explanation, action: validateAction(step.action) };
  });
  check(new Set(steps.map(s => s.id)).size === steps.length, 'duplicate_plan_step');
  // Independent steps only: overlapping mutations would need refreshed previews and version manifests.
  return { schemaVersion: 1, summary: value.summary, steps, contribution: c as unknown as ProviderProposal['contribution'] };
}
