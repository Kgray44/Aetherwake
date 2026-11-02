import type { DatabaseSync } from 'node:sqlite';
import type { DesktopSnapshot, Resource as DesktopResource } from '../../application-contract/contracts.ts';
import { check, identifier, isRecord, text, validateAction } from './capabilities.ts';
import { validatePreference } from './adaptation.ts';
import type { AuthorizationDecision, AuthorizationRequest, CanonicalConversation, ResourceRef, VelaHostPort, VelaScope } from './contracts.ts';

export type CanonicalResourceMetadata = Pick<DesktopResource, 'id' | 'title' | 'kind' | 'version' | 'state' | 'visible' | 'available' | 'project_id' | 'conversationRevision'>;
/** A metadata projection of the actual DesktopSnapshot. Existing full snapshots also structurally satisfy it. */
export type CanonicalVelaMetadata = Pick<DesktopSnapshot, 'contract' | 'projects' | 'workspaces' | 'blocks' | 'navigationBlocks' | 'activeWorkspaceId'> & { resources: CanonicalResourceMetadata[] };
export interface CanonicalVelaContext {
  principalId: string; policyVersion: string;
  currentProjectId: string | null; currentWorkspaceId: string | null; selectedResourceIds: string[];
}
export interface CanonicalVelaHostOptions {
  db: DatabaseSync;
  /** The actual SAME connection is supplied by the kernel/backend boundary, and checked by identity. */
  transaction<T>(work: (db: DatabaseSync) => T): T;
  metadata(): CanonicalVelaMetadata;
  currentContext(): CanonicalVelaContext;
  permissions: {
    /** Mandatory authoritative allow-list, including any parent-approved placement/project relationships. */
    scope(context: CanonicalVelaContext, metadata: CanonicalVelaMetadata): VelaScope;
    metadata(ref: ResourceRef, context: CanonicalVelaContext, metadata: CanonicalVelaMetadata): boolean;
    content(ref: ResourceRef, context: CanonicalVelaContext, metadata: CanonicalVelaMetadata): boolean;
    authorize(request: AuthorizationRequest, context: CanonicalVelaContext, metadata: CanonicalVelaMetadata): AuthorizationDecision;
  };
  conversations: {
    ensure: VelaHostPort['ensureConversation']; read: VelaHostPort['readConversation']; append: VelaHostPort['appendMessage'];
  };
  revisions: {
    /** Cheap current graph/message revision; do not load transcripts during metadata discovery. Null is unavailable. */
    conversation(resourceId: string, metadata: CanonicalVelaMetadata): number | null;
    /** Actual current engine projection/layout revision, independently of the workspace metadata version. */
    workspace(workspaceId: string, metadata: CanonicalVelaMetadata): number | null;
  };
  dispatch: {
    /** Mandatory opaque parent dispatcher. Block/layout/template work belongs to Universal Block System. */
    native: VelaHostPort['applyNative'];
    delegateTask?: VelaHostPort['delegateTask']; preference?: VelaHostPort['applyPreference'];
  };
  maxContentBytes?: number;
}
export interface CanonicalVelaHost extends VelaHostPort {
  /** Current project/workspace/selection, filtered by actual live authorization. Selection does not expand scope. */
  context(): CanonicalVelaContext;
}
interface View { metadata: CanonicalVelaMetadata; context: CanonicalVelaContext; scope: VelaScope; refs: Map<string, ResourceRef> }
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
const key = (kind: ResourceRef['kind'], id: string) => kind + ':' + id;
const permitted = (scope: VelaScope, ref: Pick<ResourceRef, 'id' | 'kind'>) => (ref.kind === 'resource' ? scope.resourceIds : ref.kind === 'workspace' ? scope.workspaceIds : ref.kind === 'project' ? scope.projectIds : []).includes(ref.id);

/** Exact injective pairing: max(entityVersion,messageRevision) would miss changes while the smaller value grows. */
export function canonicalVersionToken(entityVersion: number, dependentRevision: number): number {
  check(validVersion(entityVersion) && validVersion(dependentRevision), 'invalid_canonical_revision');
  const left = BigInt(entityVersion - 1), right = BigInt(dependentRevision - 1), sum = left + right;
  const token = sum * (sum + 1n) / 2n + right + 1n;
  check(token <= BigInt(Number.MAX_SAFE_INTEGER), 'canonical_revision_capacity_reached'); return Number(token);
}
function validateScope(scope: VelaScope) {
  check(isRecord(scope) && identifier(scope.principalId) && identifier(scope.policyVersion), 'invalid_canonical_scope');
  for (const ids of [scope.resourceIds, scope.workspaceIds, scope.projectIds]) check(Array.isArray(ids) && ids.length <= 10000 && ids.every(identifier) && new Set(ids).size === ids.length, 'invalid_canonical_scope');
}
function actionSubjects(action: ReturnType<typeof validateAction>): Pick<ResourceRef, 'id' | 'kind'>[] {
  const result: Pick<ResourceRef, 'id' | 'kind'>[] = [];
  const add = (id: string | null, kind: ResourceRef['kind']) => { if (id !== null && !result.some(r => r.id === id && r.kind === kind)) result.push({ id, kind }); };
  switch (action.type) {
    case 'navigate': if (action.target.kind === 'workspace') add(action.target.workspaceId, 'workspace'); else add(action.target.projectId, 'project'); break;
    case 'workspaceFromResources': add(action.projectId, 'project'); for (const id of action.resourceIds) add(id, 'resource'); break;
    case 'createResource': add(action.workspaceId, 'workspace'); break;
    case 'attach': add(action.workspaceId, 'workspace'); add(action.resourceId, 'resource'); break;
    case 'content': case 'taskStatus': add(action.resourceId, 'resource'); break;
    case 'setTaskGroupMembers': add(action.groupId, 'resource'); for (const id of action.taskIds) add(id, 'resource'); break;
    case 'relate': add(action.sourceId, 'resource'); add(action.targetId, 'resource'); break;
    case 'applyStructuredPreset': add(action.workspaceId, 'workspace'); break;
    case 'delegateTask': for (const id of action.resourceIds) add(id, 'resource'); break;
  }
  return result;
}

/** No tables, resources, messages, execution records, blocks, layouts or preferences are owned by this adapter. */
export function createCanonicalVelaHost(options: CanonicalVelaHostOptions): CanonicalVelaHost {
  const contentLimit = options.maxContentBytes ?? 128000;
  check(Number.isSafeInteger(contentLimit) && contentLimit >= 1 && contentLimit <= 1024 * 1024, 'invalid_canonical_content_limit');
  for (const callback of [options.transaction, options.metadata, options.currentContext, options.permissions?.scope, options.permissions?.metadata, options.permissions?.content, options.permissions?.authorize, options.conversations?.ensure, options.conversations?.read, options.conversations?.append, options.revisions?.conversation, options.revisions?.workspace, options.dispatch?.native]) check(typeof callback === 'function', 'canonical_host_callback_required');
  const within = <T,>(work: () => T): T => options.transaction(db => { check(db === options.db, 'canonical_database_connection_mismatch'); return work(); });
  const row = (table: 'resources' | 'workspaces' | 'projects', id: string) => options.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  function view(): View {
    const metadata = options.metadata(), context = structuredClone(options.currentContext());
    check(metadata.contract === 'aerynth.desktop@1', 'unsupported_canonical_desktop_contract');
    check(identifier(context.principalId) && identifier(context.policyVersion) && (context.currentProjectId === null || identifier(context.currentProjectId)) && (context.currentWorkspaceId === null || identifier(context.currentWorkspaceId)) && Array.isArray(context.selectedResourceIds) && context.selectedResourceIds.length <= 500 && context.selectedResourceIds.every(identifier) && new Set(context.selectedResourceIds).size === context.selectedResourceIds.length, 'invalid_canonical_context');
    const scope = structuredClone(options.permissions.scope(context, metadata)); validateScope(scope);
    check(scope.principalId === context.principalId && scope.policyVersion === context.policyVersion, 'canonical_scope_identity_mismatch');
    const refs = new Map<string, ResourceRef>();
    const projectActive = (id: string | null) => id === null || (!!metadata.projects.find(p => p.id === id) && row('projects', id)?.state === 'active');
    const store = (ref: ResourceRef) => { check(identifier(ref.id) && text(ref.title) && validVersion(ref.version), 'invalid_canonical_metadata'); if (options.permissions.metadata(ref, context, metadata) === true) refs.set(key(ref.kind, ref.id), ref); };
    for (const id of scope.projectIds) {
      const entity = row('projects', id); if (!entity || entity.state !== 'active' || !metadata.projects.some(p => p.id === id)) continue;
      store({ id, kind: 'project', title: String(entity.title), version: Number(entity.version) });
    }
    for (const id of scope.workspaceIds) {
      const entity = row('workspaces', id); if (!entity || entity.state !== 'active' || !metadata.workspaces.some(w => w.id === id) || !projectActive(entity.project_id === null ? null : String(entity.project_id))) continue;
      const revision = options.revisions.workspace(id, metadata); if (revision === null) continue;
      store({ id, kind: 'workspace', title: String(entity.title), version: canonicalVersionToken(Number(entity.version), revision) });
    }
    for (const id of scope.resourceIds) {
      const entity = row('resources', id), meta = metadata.resources.find(r => r.id === id);
      if (!entity || entity.state !== 'active' || !meta || meta.visible === false || meta.available === false || !projectActive(entity.project_id === null ? null : String(entity.project_id))) continue;
      let version = Number(entity.version);
      if (entity.kind === 'conversation') {
        const revision = options.revisions.conversation(id, metadata); if (revision === null) continue;
        version = canonicalVersionToken(version, revision);
      }
      store({ id, kind: 'resource', title: String(entity.title), version, resourceKind: meta.kind });
    }
    scope.projectIds = scope.projectIds.filter(id => refs.has(key('project', id)));
    scope.workspaceIds = scope.workspaceIds.filter(id => refs.has(key('workspace', id)));
    scope.resourceIds = scope.resourceIds.filter(id => refs.has(key('resource', id)));
    return { metadata, context, scope, refs };
  }
  function selectedScope(input: VelaScope, current: View) {
    validateScope(input); check(input.principalId === current.scope.principalId && input.policyVersion === current.scope.policyVersion, 'stale_canonical_scope');
    return input;
  }
  function resolve(ref: Pick<ResourceRef, 'id' | 'kind'>, scope: VelaScope, current: View): ResourceRef | null {
    selectedScope(scope, current);
    if (!identifier(ref.id) || !['resource', 'workspace', 'project'].includes(ref.kind) || !permitted(scope, ref) || !permitted(current.scope, ref)) return null;
    return current.refs.get(key(ref.kind, ref.id)) ?? null;
  }
  function requireConversation(id: string, current: View, content = true): ResourceRef {
    const ref = resolve({ id, kind: 'resource' }, current.scope, current);
    check(ref && row('resources', id)?.kind === 'conversation', 'canonical_conversation_not_authorized');
    check(!content || options.permissions.content(ref, current.context, current.metadata) === true, 'canonical_conversation_content_not_authorized');
    return ref;
  }
  function readConversation(id: string, current: View): CanonicalConversation {
    requireConversation(id, current);
    const result = options.conversations.read(id), revision = options.revisions.conversation(id, current.metadata);
    check(result.resourceId === id && validVersion(result.revision) && result.revision === revision && Array.isArray(result.messages), 'canonical_conversation_revision_mismatch');
    return result;
  }
  function validateTargets(targets: ResourceRef[], current: View) {
    check(Array.isArray(targets) && targets.length <= 10000, 'invalid_canonical_target_manifest');
    for (const target of targets) { const actual = resolve(target, current.scope, current); check(actual, 'canonical_target_not_authorized'); check(actual.version === target.version, 'stale_canonical_target_version'); }
  }
  function readContent(id: string, scope: VelaScope, current: View) {
    const ref = resolve({ id, kind: 'resource' }, scope, current);
    if (!ref || options.permissions.content(ref, current.context, current.metadata) !== true) return null;
    const entity = row('resources', id)!;
    if (entity.kind === 'conversation') {
      const conversation = readConversation(id, current);
      const content = JSON.stringify({ resourceId: conversation.resourceId, revision: conversation.revision, messages: conversation.messages });
      if (Buffer.byteLength(content) > contentLimit) return null;
      return { ref, content, source: 'aerynth://resource/' + encodeURIComponent(id) + '?conversationRevision=' + conversation.revision };
    }
    if (entity.kind !== 'note') return null;
    // Check byte length in SQLite before materializing a large note; no truncation or derivative content store.
    const size = options.db.prepare('SELECT length(CAST(content AS BLOB)) AS bytes FROM notes WHERE resource_id=?').get(id);
    if (!size || Number(size.bytes) > contentLimit) return null;
    const note = options.db.prepare('SELECT content FROM notes WHERE resource_id=?').get(id); if (!note) return null;
    return { ref, content: String(note.content), source: 'aerynth://resource/' + encodeURIComponent(id) + '?version=' + entity.version };
  }
  const host: CanonicalVelaHost = {
    scope: () => within(() => structuredClone(view().scope)),
    context: () => within(() => {
      const current = view(); return { ...current.context,
        currentProjectId: current.context.currentProjectId && current.scope.projectIds.includes(current.context.currentProjectId) ? current.context.currentProjectId : null,
        currentWorkspaceId: current.context.currentWorkspaceId && current.scope.workspaceIds.includes(current.context.currentWorkspaceId) ? current.context.currentWorkspaceId : null,
        selectedResourceIds: current.context.selectedResourceIds.filter(id => current.scope.resourceIds.includes(id)),
      };
    }),
    ensureConversation: name => within(() => {
      check(name === 'system:vela', 'invalid_canonical_assistant_key'); const id = options.conversations.ensure(name);
      check(identifier(id), 'invalid_canonical_conversation'); requireConversation(id, view()); return id;
    }),
    readConversation: id => within(() => structuredClone(readConversation(id, view()))),
    appendMessage: (id, message) => within(() => { const current = view(); requireConversation(id, current); return options.conversations.append(id, structuredClone(message)); }),
    resolve: (ref, scope) => within(() => structuredClone(resolve(ref, scope, view()))),
    search: (query, scope, limit) => within(() => {
      check(typeof query === 'string' && query.length <= 200 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'invalid_canonical_search');
      const current = view(); selectedScope(scope, current); const search = query.normalize('NFKC').toLocaleLowerCase();
      const priority = (ref: ResourceRef) => ref.kind === 'resource' && current.context.selectedResourceIds.includes(ref.id) ? 0 : ref.kind === 'workspace' && ref.id === current.context.currentWorkspaceId ? 1 : ref.kind === 'project' && ref.id === current.context.currentProjectId ? 2 : 3;
      return [...current.refs.values()].filter(ref => permitted(scope, ref) && (ref.title.normalize('NFKC').toLocaleLowerCase().includes(search) || ref.id.toLocaleLowerCase().includes(search) || ref.resourceKind?.includes(search)))
        .sort((a, b) => priority(a) - priority(b) || a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).slice(0, limit).map(ref => structuredClone(ref));
    }),
    readContent: (id, scope) => within(() => structuredClone(readContent(id, scope, view()))),
    authorize: request => within(() => {
      const current = view(); selectedScope(request.scope, current); validateTargets(request.targets, current);
      if (request.contextManifest) {
        check(request.contextManifest.policyVersion === current.scope.policyVersion, 'stale_canonical_context_policy');
        validateTargets(request.contextManifest.discovered, current);
        for (const included of request.contextManifest.included) { const actual = resolve(included, current.scope, current); check(actual && actual.version === included.version && request.contextManifest.discovered.some(ref => ref.id === included.id && ref.kind === included.kind && ref.version === included.version) && options.permissions.content(actual, current.context, current.metadata) === true, 'canonical_context_content_not_authorized'); }
      }
      const decision = options.permissions.authorize(structuredClone(request), current.context, current.metadata);
      check(decision && ['allow', 'deny'].includes(decision.decision) && decision.policyVersion === current.scope.policyVersion, 'invalid_canonical_policy_decision');
      if (decision.decision === 'allow') check(identifier(decision.authorizationRef), 'canonical_host_authorization_required');
      return structuredClone(decision);
    }),
    applyNative: input => within(() => {
      const current = view(), action = validateAction(input.action); check(action.type !== 'delegateTask', 'canonical_native_action_required');
      check(identifier(input.authorizationRef) && identifier(input.commandId) && identifier(input.requestId) && identifier(input.planId), 'canonical_dispatch_authorization_required');
      validateTargets(input.expectedVersions, current);
      for (const subject of actionSubjects(action)) check(input.expectedVersions.some(target => target.id === subject.id && target.kind === subject.kind), 'canonical_action_target_manifest_required');
      // No block, template, placement, layout or fallback implementation. Parent dispatcher owns capability/release checks.
      return options.dispatch.native(structuredClone(input));
    }),
  };
  if (options.dispatch.delegateTask) host.delegateTask = async input => {
    within(() => {
      const current = view(); check(identifier(input.authorizationRef), 'canonical_dispatch_authorization_required');
      check(validateAction(input.action).type === 'delegateTask', 'canonical_delegation_action_required');
      requireConversation(input.sourceConversationId, current, false);
      validateTargets(input.context.discovered, current);
      validateTargets(input.context.included, current);
      for (const id of input.action.resourceIds) check(resolve({ id, kind: 'resource' }, current.scope, current), 'canonical_delegation_resource_not_authorized');
      check(input.context.discovered.every(ref => ref.kind === 'resource' && input.action.resourceIds.includes(ref.id)) && input.context.omitted.every(ref => input.action.resourceIds.includes(ref.id)), 'canonical_delegation_context_not_authorized');
      for (const included of input.context.included) check(input.action.resourceIds.includes(included.id) && options.permissions.content(included, current.context, current.metadata) === true, 'canonical_delegation_context_not_authorized');
    });
    return options.dispatch.delegateTask!(structuredClone(input));
  };
  if (options.dispatch.preference) host.applyPreference = input => within(() => {
    validatePreference(input.action.key, input.action.value, input.action.scope); check(input.action.type === 'applyPreference', 'canonical_preference_action_required');
    const current = view(); check(identifier(input.authorizationRef), 'canonical_dispatch_authorization_required'); validateTargets(input.expectedVersions, current);
    if (input.action.scope.kind === 'workspace') check(input.expectedVersions.some(ref => ref.kind === 'workspace' && ref.id === input.action.scope.id), 'canonical_preference_target_manifest_required');
    return options.dispatch.preference!(structuredClone(input));
  });
  return host;
}
