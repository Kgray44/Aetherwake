import type { CapabilityDescriptor, DelegateTaskAction, PlanStep, ProviderContribution, ProviderProposal, ProviderResult, VelaNativeAction } from './contracts.ts';
import { defaultOrganization, updateOrganization } from '../../workspace-engine/organization.mts';
import type { OrganizationUpdate } from '../../workspace-engine/contracts.mts';
import { AERYNTH_SOURCE_REPOSITORY, githubRepository } from '../../application-contract/github-timeline.ts';

export class VelaError extends Error {
  readonly code: string;
  /** Trusted adapter failure semantics; never inferred from model prose or an error-code pattern. */
  readonly outcome?: 'unknown';
  constructor(code: string, outcome?: 'unknown') { super(code); this.code = code; this.outcome = outcome; }
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
function capability(id: CapabilityDescriptor['id'], label: string, effect: CapabilityDescriptor['effect'], properties: Record<string, unknown>, scope: string,
  authorization: CapabilityDescriptor['authorization'] = id === 'delegateTask' ? 'explicit-execution-authorization' : 'host-policy'): CapabilityDescriptor {
  return { id, label, effect, schema: objectSchema(properties), scope,
    authorization,
    reversible: ['read', 'navigate'].includes(effect) ? 'no-state-change' : 'host-dependent' };
}
export const CAPABILITIES: CapabilityDescriptor[] = [
  capability('search', 'Search authorized application resources', 'read', { query: stringSchema }, 'Authorized metadata only; content requires separate retrieval'),
  capability('navigate', 'Open a workspace or project constellation', 'navigate', { type: { const: 'navigate' }, target: { oneOf: [objectSchema({ kind: { const: 'workspace' }, workspaceId: idSchema }), objectSchema({ kind: { const: 'constellation' }, projectId: nullableIdSchema })] } }, 'One authorized navigation target'),
  capability('createProject', 'Create a project', 'create', { type: { const: 'createProject' }, title: stringSchema }, 'One new canonical project; does not change the authorized scope or grant access to another project'),
  capability('renameProject', 'Rename a project', 'mutate', { type: { const: 'renameProject' }, projectId: idSchema, title: stringSchema }, 'One authorized active project and its exact manifest version'),
  capability('renameResource', 'Rename a local resource', 'mutate', { type: { const: 'renameResource' }, resourceId: idSchema, title: stringSchema }, 'One authorized active note, task, task group or reference; preserves content, drafts and placements'),
  capability('associateResourceProject', 'Change a local resource project', 'mutate', { type: { const: 'associateResourceProject' }, resourceId: idSchema, projectId: nullableIdSchema }, 'One authorized active non-chat local resource and exact authorized destination project or null; grants no content or sharing access'),
  capability('createWorkspace', 'Create an empty workspace', 'create', { type: { const: 'createWorkspace' }, title: stringSchema, projectId: nullableIdSchema }, 'One canonical workspace in the exact authorized project or without a project; opens the new workspace'),
  capability('createTimeline', 'Create and show a saved Timeline', 'create', {
    type: { const: 'createTimeline' }, title: stringSchema, projectId: nullableIdSchema, workspaceId: nullableIdSchema,
    source: { oneOf: [objectSchema({ kind: { const: 'application-activity' } }),
      objectSchema({ kind: { const: 'github-commits' }, repositoryUrl: { ...stringSchema, maxLength: 180 } })] },
  }, 'Current project; optionally place in current workspace. Use canonical app events or reviewed public GitHub default-branch commits. Ask which repository if unclear. Aerynth product source: ' + AERYNTH_SOURCE_REPOSITORY, 'reviewed-action'),
  capability('renameWorkspace', 'Rename a workspace', 'mutate', { type: { const: 'renameWorkspace' }, workspaceId: idSchema, title: stringSchema }, 'One authorized workspace; current entity and layout revisions are bound by the target manifest'),
  capability('bringAllIntoView', 'Frame the current workspace', 'mutate', { type: { const: 'bringAllIntoView' }, workspaceId: idSchema }, 'Frame the current authorized workspace using actual presenter bounds supplied outside the model action; does not create or duplicate resources'),
  capability('resolveLayout', 'Resolve workspace layout collisions', 'mutate', { type: { const: 'resolveLayout' }, workspaceId: idSchema }, 'One authorized workspace and its existing canonical layout participants, including Vela'),
  capability('setOrganization', 'Set workspace organization', 'mutate', { type: { const: 'setOrganization' }, workspaceId: idSchema, organization: organizationSchema }, 'One authorized workspace; validates the canonical organization update and retains resource identities'),
  capability('createConversation', 'Create an empty conversation', 'create', { type: { const: 'createConversation' }, title: stringSchema, providerId: { enum: ['local', 'codex-app-server'] } }, 'One canonical chat in the bound current project or independent scope; Codex requires a configured real Codex provider. No connection, authentication probe, message or provider turn is started'),
  capability('conversationFavorite', 'Set conversation favorite', 'mutate', { type: { const: 'conversationFavorite' }, resourceId: idSchema, favorite: { type: 'boolean' } }, 'One authorized active conversation; canonical identity, history, drafts and provider remain unchanged'),
  capability('renameConversation', 'Rename a conversation', 'mutate', { type: { const: 'renameConversation' }, resourceId: idSchema, title: stringSchema }, 'One authorized active conversation; entity and message revisions are bound by the target manifest'),
  capability('associateConversationProject', 'Associate a conversation with a project', 'mutate', { type: { const: 'associateConversationProject' }, resourceId: idSchema, projectId: nullableIdSchema }, 'One authorized active conversation and exact authorized destination project, or no project; does not duplicate or recreate the chat'),
  capability('createCollection', 'Create a folder or collection', 'create', { type: { const: 'createCollection' }, title: stringSchema, projectId: nullableIdSchema }, 'One new canonical collection in the exact authorized project or independent scope; no resources are copied'),
  capability('renameCollection', 'Rename a folder or collection', 'mutate', { type: { const: 'renameCollection' }, collectionId: idSchema, title: stringSchema }, 'One authorized active collection; entity and parent/rule revisions are bound by its target manifest'),
  capability('archiveCollection', 'Archive or restore a collection', 'mutate', { type: { const: 'archiveCollection' }, collectionId: idSchema, archived: { type: 'boolean' } }, 'One authorized collection; archived metadata is resolved only for explicit restoration with current host permission; resources and history remain intact'),
  capability('collectionMembership', 'Add or remove a resource in a collection', 'mutate', { type: { const: 'collectionMembership' }, collectionId: idSchema, resourceId: idSchema, member: { type: 'boolean' } }, 'One authorized active collection and exact authorized resource; changes canonical membership references without moving or copying the resource'),
  capability('workspaceFromResources', 'Create a workspace from existing resources', 'create', { type: { const: 'workspaceFromResources' }, title: stringSchema, projectId: nullableIdSchema, resourceIds: arraySchema }, 'Create one workspace; attach references to the exact existing resource IDs; never duplicate resources'),
  capability('createResource', 'Create a note, task, or task group', 'create', { type: { const: 'createResource' }, kind: { enum: ['note', 'task', 'task_group'] }, title: stringSchema, workspaceId: nullableIdSchema }, 'One local canonical resource; optional authorized workspace placement'),
  capability('attach', 'Place an existing resource', 'mutate', { type: { const: 'attach' }, workspaceId: idSchema, resourceId: idSchema }, 'One existing canonical resource and one workspace'),
  capability('content', 'Edit a local resource', 'mutate', { type: { const: 'content' }, resourceId: idSchema, expectedVersion: versionSchema, content: { type: 'string', maxLength: 100000 } }, 'One versioned resource; host validates resource type'),
  capability('taskStatus', 'Update task status', 'mutate', { type: { const: 'taskStatus' }, resourceId: idSchema, expectedVersion: versionSchema, status: { enum: ['open', 'done'] } }, 'One versioned task; status does not assert verified outcome'),
  capability('taskPriority', 'Update task priority', 'mutate', { type: { const: 'taskPriority' }, resourceId: idSchema, expectedVersion: versionSchema, priority: { enum: ['low', 'normal', 'high', 'urgent'] } }, 'One authorized versioned task; priority does not change completion or verification state'),
  capability('setTaskGroupMembers', 'Organize task group members', 'mutate', { type: { const: 'setTaskGroupMembers' }, groupId: idSchema, expectedVersion: versionSchema, taskIds: arraySchema }, 'One versioned group and an explicit task set'),
  capability('relate', 'Link two resources', 'mutate', { type: { const: 'relate' }, sourceId: idSchema, targetId: idSchema, kind: stringSchema }, 'Two existing resources; source is Vela, not inferred authority'),
  capability('applyStructuredPreset', 'Apply a workspace layout preset', 'mutate', { type: { const: 'applyStructuredPreset' }, workspaceId: idSchema, preset: { enum: ['balanced', 'focus', 'development', 'research'] } }, 'One authorized workspace; references and histories retain identity'),
  capability('setAttentionMode', 'Set Vela attention mode', 'mutate', { type: { const: 'setAttentionMode' }, mode: { enum: ['normal','quiet','focused','collaborative','proactive'] }, expectedVersion: versionSchema }, 'Global Vela attention mode only; exact preference version. Does not grant monitoring, delegation, event access or learning.'),
  capability('delegateTask', 'Request an explicitly authorized provider execution', 'provider-execution', { type: { const: 'delegateTask' }, title: stringSchema, objective: { type: 'string', minLength: 1, maxLength: 16000 }, providerId: idSchema, resourceIds: arraySchema, constraints: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 1000 } } }, 'Original intent, source conversation, exact resource manifest, provider identity, and host-issued execution authorization'),
];

export function validateAction(value: unknown): VelaNativeAction | DelegateTaskAction {
  check(isRecord(value), 'invalid_action');
  const v = value;
  let valid = false;
  switch (v.type) {
    case 'setAttentionMode': valid = fields(v, ['type','mode','expectedVersion']) && typeof v.mode==='string' && ['normal','quiet','focused','collaborative','proactive'].includes(v.mode) && version(v.expectedVersion); break;
    case 'navigate': valid = fields(v, ['type', 'target']) && isRecord(v.target) && (
      (fields(v.target, ['kind', 'workspaceId']) && v.target.kind === 'workspace' && identifier(v.target.workspaceId)) ||
      (fields(v.target, ['kind', 'projectId']) && v.target.kind === 'constellation' && nullableId(v.target.projectId))); break;
    case 'createProject': valid = fields(v, ['type', 'title']) && text(v.title); break;
    case 'renameProject': valid = fields(v, ['type', 'projectId', 'title']) && identifier(v.projectId) && text(v.title); break;
    case 'renameResource': valid = fields(v, ['type', 'resourceId', 'title']) && identifier(v.resourceId) && text(v.title); break;
    case 'associateResourceProject': valid = fields(v, ['type', 'resourceId', 'projectId']) && identifier(v.resourceId) && nullableId(v.projectId); break;
    case 'createWorkspace': valid = fields(v, ['type', 'title', 'projectId']) && text(v.title) && nullableId(v.projectId); break;
    case 'createTimeline': valid = fields(v, ['type', 'title', 'projectId', 'workspaceId', 'source']) && text(v.title) &&
      nullableId(v.projectId) && nullableId(v.workspaceId) && isRecord(v.source) &&
      ((v.source.kind === 'application-activity' && fields(v.source, ['kind'])) ||
       (v.source.kind === 'github-commits' && fields(v.source, ['kind', 'repositoryUrl']) &&
        text(v.source.repositoryUrl, 180) && !!githubRepository(v.source.repositoryUrl))); break;
    case 'renameWorkspace': valid = fields(v, ['type', 'workspaceId', 'title']) && identifier(v.workspaceId) && text(v.title); break;
    case 'bringAllIntoView': case 'resolveLayout': valid = fields(v, ['type', 'workspaceId']) && identifier(v.workspaceId); break;
    case 'setOrganization': valid = fields(v, ['type', 'workspaceId', 'organization']) && identifier(v.workspaceId) && organization(v.organization); break;
    case 'createConversation': valid = fields(v, ['type', 'title', 'providerId']) && text(v.title) && ['local','codex-app-server'].includes(String(v.providerId)); break;
    case 'conversationFavorite': valid = fields(v, ['type', 'resourceId', 'favorite']) && identifier(v.resourceId) && typeof v.favorite==='boolean'; break;
    case 'renameConversation': valid = fields(v, ['type', 'resourceId', 'title']) && identifier(v.resourceId) && text(v.title); break;
    case 'associateConversationProject': valid = fields(v, ['type', 'resourceId', 'projectId']) && identifier(v.resourceId) && nullableId(v.projectId); break;
    case 'createCollection': valid = fields(v, ['type', 'title', 'projectId']) && text(v.title) && nullableId(v.projectId); break;
    case 'renameCollection': valid = fields(v, ['type', 'collectionId', 'title']) && identifier(v.collectionId) && text(v.title); break;
    case 'archiveCollection': valid = fields(v, ['type', 'collectionId', 'archived']) && identifier(v.collectionId) && typeof v.archived==='boolean'; break;
    case 'collectionMembership': valid = fields(v, ['type', 'collectionId', 'resourceId', 'member']) && identifier(v.collectionId) && identifier(v.resourceId) && typeof v.member==='boolean'; break;
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

function validateContribution(value: unknown, providerId: string): ProviderContribution {
  const c = value;
  check(isRecord(c) && c.providerId === providerId && c.classification === 'reported' && Object.keys(c).every(k => ['providerId', 'model', 'nativeThreadId', 'nativeTurnId', 'executionId', 'planningConversationId', 'sourceMessageId', 'classification'].includes(k)) && Object.entries(c).every(([k, v]) => k === 'classification' || text(v, 200)), 'invalid_provider_attribution');
  return structuredClone(c) as unknown as ProviderContribution;
}
export function validateProposal(value: unknown, providerId: string): ProviderProposal {
  check(isRecord(value) && fields(value, ['schemaVersion', 'summary', 'steps', 'contribution']), 'invalid_provider_proposal');
  check(value.schemaVersion === 1 && text(value.summary, 4000) && Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 12, 'invalid_provider_proposal');
  const contribution = validateContribution(value.contribution, providerId);
  const steps = value.steps.map((step): PlanStep => {
    check(isRecord(step) && fields(step, ['id', 'explanation', 'action']) && identifier(step.id) && text(step.explanation, 2000), 'invalid_plan_step');
    return { id: step.id, explanation: step.explanation, action: validateAction(step.action) };
  });
  check(new Set(steps.map(s => s.id)).size === steps.length, 'duplicate_plan_step');
  // Independent steps only: overlapping mutations would need refreshed previews and version manifests.
  return { schemaVersion: 1, summary: value.summary, steps, contribution };
}
/** Explicit wire discrimination; legacy plans normalize without weakening their non-empty action contract. */
export function validateProviderResult(value: unknown, providerId: string): ProviderResult {
  check(isRecord(value), 'invalid_provider_result');
  if (value.schemaVersion === 1) { const plan = validateProposal(value, providerId); return { ...plan, schemaVersion: 2, kind: 'plan' }; }
  check(value.schemaVersion === 2, 'invalid_provider_result');
  if (value.kind === 'plan') {
    check(fields(value, ['schemaVersion', 'kind', 'summary', 'steps', 'contribution']), 'invalid_provider_result');
    const plan = validateProposal({ schemaVersion: 1, summary: value.summary, steps: value.steps, contribution: value.contribution }, providerId);
    return { ...plan, schemaVersion: 2, kind: 'plan' };
  }
  check(['answer', 'clarification', 'inability'].includes(String(value.kind)) && fields(value, ['schemaVersion', 'kind', 'content', 'contribution']) && text(value.content, 16000), 'invalid_provider_result');
  return { schemaVersion: 2, kind: value.kind as 'answer' | 'clarification' | 'inability', content: value.content, contribution: validateContribution(value.contribution, providerId) };
}
