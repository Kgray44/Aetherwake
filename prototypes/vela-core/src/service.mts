import { createHash, randomUUID } from 'node:crypto';
import { VELA_IDENTITY_PROMPT } from './vela-identity.mts';
import { projectVelaOperations, validateVelaOperations, type VelaOperationsHost,
  type VelaOperationsOptions, type VelaOperationsPacket } from './operational-context.mts';
import type { DatabaseSync } from 'node:sqlite';
import { CAPABILITIES, VelaError, check, identifier, isHostPolicyRead, isImmediateNativeAction, isLocalFact, isRecord, text, validateAction, validateProviderResult } from './capabilities.ts';
import { clockTimerRequiresReview } from '../../timer-product/vela-contract.ts';
import { canonicalUserEvidence } from './voice-evidence.ts';
import { defaultAdaptation, effectivePreference, observePreference, preferenceCategory, samePreferenceScope, setExplicitPreference, validatePreference } from './adaptation.ts';
import { VELA_CONTRACT, VELA_PROJECT_CHECK_LABELS } from './contracts.ts';
import { evaluateLocalCapability, validateLocalRecord } from './local-capabilities.mts';
import { requiresVelaPlanAttention } from './manifestation-state.ts';
import { validateRoutingDefaults, validateRoutingScope, type VelaRoutingProfile, type VelaRoutingSettingsChange } from './routing-settings.ts';
import { HISTORY_LIMITS, HistorySelectionError, createHistoryProvenance, historyDependenciesFromContext, historyDigest, selectBoundedHistory, selectVelaHandoff, unionHistoryDependencies, validateFrozenHistory, validateFrozenHistoryMetadata } from './bounded-history.mts';
import { investigateSemanticHistory, type SemanticHistoryCall, type SemanticHistoryScan, type SemanticHistorySource } from './semantic-history.mts';
import type { VelaHandoff } from './history-contracts.ts';
import type { AcceptedHistoryAppend, HistoryFence, HistoryMessageMetadata, HistoryMetadataReader, HistoryOmission, HistoryOrigin, HistoryProofReader, HistoryRequestRecord, HistorySnapshot, HistoryTail, PrivateFrozenProviderContext } from './bounded-history.mts';
import type {
  ActionReceipt, AppAttentionEvent, AttentionItem, AttentionPreferences, AuthorizationRequest,
  ContextManifest, DelegateTaskAction, HostActionResult, PlanStep, ResourceRef, VelaHostPort,
  VelaNativeAction, VelaPlan, VelaPlanningPort, VelaRequest, VelaScope, VelaState, VelaSubjectRef,
  AdaptationPolicy, AdaptationState, ExplicitPreference, PreferenceHypothesis, PreferenceKey,
  PreferenceScope, PreferenceValue, AdaptationReceipt, ProviderContribution, ProviderReplyKind,
  VelaLocalCapabilityId, VelaLocalDispatch, VelaLocalHost, VelaLocalRecord, VelaLocalResult,
  VelaPresentationState, VelaPresentationPatch, VelaProjectCheckReceipt, VelaProviderRecovery,
} from './contracts.ts';

export interface VelaSemanticHistorySource extends SemanticHistorySource {
  sourceKind: NonNullable<SemanticHistorySource['sourceKind']>;
  proofDigest: string;
}

type StoredActionReceipt = ActionReceipt & { foundSubjects?: (VelaSubjectRef&{version?:number})[] };
const subjectKey = ({ id, kind }: VelaSubjectRef) => kind + ':' + id;

interface StoredState {
  schemaVersion: 3; conversationId: string | null; requests: VelaRequest[];
  plans: VelaPlan[]; receipts: StoredActionReceipt[]; preferences: AttentionPreferences;
  attention: AttentionItem[]; lastPresenceAt: string | null;
  adaptation: AdaptationState;
  presentation?: VelaPresentationState;
  routingProfiles?: VelaRoutingProfile[];
}
export interface VelaServiceOptions {
  /** The SAME live canonical SQLite connection. This service never opens/closes a database. */
  db: DatabaseSync;
  /** Host transaction boundary must include canonical conversation writes. Supports nesting if host APIs need it. */
  transaction<T>(work: () => T): T;
  /** Optional SAME-connection read boundary; never the Core mutation/snapshot/save path. */
  readTransaction?<T>(work: (db: DatabaseSync) => T): T;
  host: VelaHostPort; planner?: VelaPlanningPort;
  /** Cheap trusted local metadata/system clock and one-message recovery. Never provider context or model access. */
  local?: VelaLocalHost;
  /** Host-certified same-request completion context after exact owner effects.
   * The original accepted snapshot remains immutable historical evidence. */
  providerContextAdvance?(requestId:string):{context:ContextManifest;historyFence?:HistoryFence;navigation:{currentProjectId:string|null;currentWorkspaceId:string|null};validate():void}|undefined;
  /** Source-owned negative observation inside the same plan-rejection transaction; never starts a provider. */
  onPlanRejected?(plan:VelaPlan):void;
  /** Explicit bounded canonical projections. Absent means no implicit conversational history. */
  history?: {
    snapshot(conversationId: string, limit: number, query?: string, mode?: 'semantic-query'): HistorySnapshot | null;
    tail?(conversationId: string): HistoryTail | null;
    message: HistoryProofReader['message']; content: HistoryProofReader['content'];
    messageMetadata(conversationId: string, messageId: string): HistoryMessageMetadata | null;
    verifyProviderContribution: HistoryMetadataReader['verifyProviderContribution'];
  };
  now?: () => string;
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const byteLength = (v: string) => Buffer.byteLength(v, 'utf8');
const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const preserveProposal = (proposal: unknown): unknown => {
  try { const raw = JSON.stringify(proposal); return raw !== undefined && byteLength(raw) <= 64000 ? JSON.parse(raw) : { omitted: 'Invalid provider output exceeds 64 KiB or is not serializable' }; }
  catch { return { omitted: 'Invalid provider output is not JSON serializable' }; }
};
const errorCode = (e: unknown, fallback: string) => e instanceof VelaError || e instanceof HistorySelectionError ? e.code : fallback;
const severityRank = { info: 0, warning: 1, critical: 2 };
const defaultPresentation = (): VelaPresentationState => ({ schemaVersion: 1, version: 1, view: 'current', selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [] });
const presentationIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 256 && value.every(identifier) && new Set(value).size === value.length;
function validatePresentation(value: unknown): asserts value is VelaPresentationState {
  check(isRecord(value) && value.schemaVersion === 1, 'unsupported_vela_presentation_schema');
  check(Object.keys(value).sort().join(',') === 'dismissedRequestIds,pinnedRequestIds,schemaVersion,selectedRequestId,version,view' && Number.isSafeInteger(value.version) && Number(value.version) >= 1 && (value.view === 'current' || value.view === 'history') && (value.selectedRequestId === null || identifier(value.selectedRequestId)) && presentationIds(value.dismissedRequestIds) && presentationIds(value.pinnedRequestIds), 'invalid_vela_presentation_state');
}
export const VELA_PLANNING_TASK_INSTRUCTION = `Be brief. Resolve “here” or “this” using activeSurface and activeResourceId. Choose typed tools by effect and activeWorkspaceLayout. Avoid no-ops when rearranging. Clarify unresolved targets or consequential ambiguity. Report plans as proposals. Delegation requires separate approval.`;
export const VELA_PLANNING_INSTRUCTION = VELA_IDENTITY_PROMPT + '\n' + VELA_PLANNING_TASK_INSTRUCTION;

export class VelaService {
  private data!: StoredState;
  private stored: string | null = null;
  private controllers = new Map<string, AbortController>();
  private opts: VelaServiceOptions;
  constructor(options: VelaServiceOptions) {
    this.opts = options;
    if (options.readTransaction !== undefined) check(typeof options.readTransaction === 'function', 'canonical_read_transaction_required');
    options.transaction(() => {
      options.db.exec(`CREATE TABLE IF NOT EXISTS vela_state (
        id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, json TEXT NOT NULL
      )`);
      const row = options.db.prepare('SELECT schema_version,json FROM vela_state WHERE id=1').get();
      if (row) {
        check(row.schema_version === 1 || row.schema_version === 2 || row.schema_version === 3, 'unsupported_vela_schema');
        this.stored = String(row.json); this.data = JSON.parse(this.stored);
        check(this.data.schemaVersion === row.schema_version && Array.isArray(this.data.requests) && Array.isArray(this.data.plans) && Array.isArray(this.data.receipts) && Array.isArray(this.data.attention) && isRecord(this.data.preferences), 'corrupt_vela_state');
        this.data.schemaVersion = 3;
      } else this.data = { schemaVersion: 3, conversationId: null, requests: [], plans: [], receipts: [], attention: [], lastPresenceAt: null,
        adaptation: defaultAdaptation(this.now(), !!options.host.applyPreference),
        preferences: { version: 1, mode: 'normal', monitoringEnabled: false, delegationEnabled: false,
          allowedEventTypes: [], minimumSeverity: 'warning', maxInterruptionsPerHour: 3,
          source: 'default', updatedAt: this.now(), learning: 'disabled' } };
      this.data.adaptation ??= defaultAdaptation(this.now(), !!options.host.applyPreference);
      const localCommands = new Set<string>();
      for (const request of this.data.requests) if (request.local !== undefined) {
        validateLocalRecord(request.local);
        check(!localCommands.has(request.local.commandId), 'corrupt_vela_local_state'); localCommands.add(request.local.commandId);
        check(request.providerId === null && request.state === 'responded' && request.response && ['answer', 'inability'].includes(request.response.kind), 'corrupt_vela_local_state');
      }
      this.data.adaptation.applicationAvailable = !!options.host.applyPreference;
      if (this.data.presentation === undefined) this.data.presentation = defaultPresentation(); validatePresentation(this.data.presentation);
      if (this.data.routingProfiles !== undefined) {
        const profiles = this.data.routingProfiles;
        check(Array.isArray(profiles) && profiles.length <= 256, 'corrupt_vela_routing_profiles');
        const seen = new Set<string>();
        for (const profile of profiles) {
          check(isRecord(profile) && Number.isSafeInteger(profile.version) && profile.version > 0, 'corrupt_vela_routing_profiles');
          validateRoutingScope(profile.scope, profile.id);
          validateRoutingDefaults(profile.defaults);
          check(!profile.defaults.attemptLimits || profile.scope === 'global' || profile.scope === 'project', 'invalid_vela_attempt_limit_scope');
          check(profile.defaults.calibration === undefined || profile.scope === 'global' || profile.scope === 'project', 'invalid_vela_calibration_scope');
          const key = profile.scope + ':' + profile.id;
          check(!seen.has(key), 'corrupt_vela_routing_profiles');
          seen.add(key);
        }
      }
      // Restart does not replay a plan, start inference, mark attention reviewed, or claim interrupted effects failed.
      for (const request of this.data.requests) if (request.state === 'planning' || request.state === 'checking') {
        const checking = request.state === 'checking';
        if (checking && request.projectCheck?.state === 'running') request.projectCheck.state = 'unknown';
        request.state = 'unknown'; request.errorCode = checking ? 'restart_project_check_outcome_unknown' : 'restart_planning_outcome_unknown'; request.updatedAt = this.now();
      }
      for (const plan of this.data.plans) if (plan.state === 'applying') {
        plan.state = 'unknown';
        const request = this.getRequest(plan.requestId); request.state = 'unknown'; request.errorCode = 'restart_action_outcome_unknown';
      }
      for (const receipt of this.data.receipts) if (receipt.state === 'started') {
        receipt.state = 'unknown'; receipt.errorCode = 'restart_action_outcome_unknown';
      }
      for (const receipt of this.data.adaptation.receipts) if (receipt.state === 'started') {
        receipt.state = 'unknown'; receipt.errorCode = 'restart_preference_outcome_unknown';
        const hypothesis = this.data.adaptation.hypotheses.find(h => h.id === receipt.hypothesisId);
        if (hypothesis) { hypothesis.state = 'unknown'; hypothesis.errorCode = receipt.errorCode; }
      }
      this.save();
    });
  }
  private now() { return this.opts.now?.() ?? new Date().toISOString(); }
  operationContext(inspectWorkspace: VelaOperationsHost['inspectWorkspace'], options?: VelaOperationsOptions): VelaOperationsPacket {
    return this.read(() => projectVelaOperations(this.data, { scope: () => this.scope(),
      resolve: (ref, scope) => this.opts.host.resolve(ref, scope), inspectWorkspace }, options));
  }
  validateOperationContext(packet: VelaOperationsPacket, inspectWorkspace: VelaOperationsHost['inspectWorkspace']): void {
    this.read(() => validateVelaOperations(packet, this.data, { scope: () => this.scope(),
      resolve: (ref, scope) => this.opts.host.resolve(ref, scope), inspectWorkspace }));
  }
  /** The canonical host supplies the applicable scope chain. */
  routingProfile(scope: VelaRoutingProfile['scope'], id: VelaRoutingProfile['id']): VelaRoutingProfile {
    return structuredClone(this.data.routingProfiles?.find(profile => profile.scope === scope && profile.id === id) ??
      { scope, id, version: 0, defaults: {} });
  }
  saveRoutingProfile(input: VelaRoutingSettingsChange): VelaRoutingProfile {
    validateRoutingScope(input.scope, input.id);
    validateRoutingDefaults(input.defaults);
    check(!input.defaults.attemptLimits || input.scope === 'global' || input.scope === 'project', 'invalid_vela_attempt_limit_scope');
    check(input.defaults.calibration === undefined || input.scope === 'global' || input.scope === 'project', 'invalid_vela_calibration_scope');
    return this.atomic(() => {
      const current = this.routingProfile(input.scope, input.id);
      check(current.version === input.expectedVersion && current.version < Number.MAX_SAFE_INTEGER, 'stale_vela_routing_defaults');
      const profiles = this.data.routingProfiles ??= [];
      const profile = { scope: input.scope, id: input.id, defaults: structuredClone(input.defaults), version: current.version + 1 };
      const index = profiles.findIndex(row => row.scope === profile.scope && row.id === profile.id);
      if (index >= 0) profiles[index] = profile;
      else {
        check(profiles.length < 256, 'vela_routing_profiles_capacity_reached');
        profiles.push(profile);
      }
      return structuredClone(profile);
    });
  }
  private read<T>(work: () => T): T {
    if (!this.opts.readTransaction) return this.opts.transaction(work);
    return this.opts.readTransaction(db => { check(db === this.opts.db, 'canonical_database_connection_mismatch'); return work(); });
  }
  private save() {
    const json = JSON.stringify(this.data);
    check(byteLength(json) <= 4 * 1024 * 1024, 'vela_state_capacity_reached');
    const current = this.opts.db.prepare('SELECT json FROM vela_state WHERE id=1').get();
    check((current ? String(current.json) : null) === this.stored, 'concurrent_vela_writer');
    this.opts.db.prepare('INSERT INTO vela_state VALUES(1,3,?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,json=excluded.json').run(json);
    this.stored = json;
  }
  private atomic<T>(work: () => T): T {
    const before = structuredClone(this.data), stored = this.stored;
    try { return this.opts.transaction(() => { const result = work(); this.save(); return result; }); }
    catch (e) {
      // Provider/delegation continuations retain these canonical objects across await.
      // An unrelated UI preference rollback must restore their values without detaching those references.
      const retain = <T extends { id: string }>(live: T[], saved: T[]) => { const records = new Map(live.map(record => [record.id, record])); for (let index = 0; index < saved.length; index++) { const record = records.get(saved[index].id); if (!record) continue; for (const key of Object.keys(record)) delete (record as Record<string, unknown>)[key]; Object.assign(record, saved[index]); saved[index] = record; } };
      retain(this.data.requests, before.requests); retain(this.data.plans, before.plans); retain(this.data.receipts, before.receipts);
      retain(this.data.adaptation.hypotheses, before.adaptation.hypotheses); retain(this.data.adaptation.receipts, before.adaptation.receipts);
      this.data = before; this.stored = stored; throw e;
    }
  }
  private restores(steps:readonly PlanStep[]):string[] {
    return [...new Set(steps.flatMap(({action})=>action.type==='archiveCollection'&&!action.archived?[action.collectionId]:[]))];
  }
  private scope(steps:readonly PlanStep[]=[]): VelaScope {
    const restoreCollectionIds=this.restores(steps);
    const scope = this.opts.host.scope(restoreCollectionIds.length?{restoreCollectionIds}:undefined);
    check(identifier(scope.principalId) && identifier(scope.policyVersion), 'invalid_host_scope');
    for (const ids of [scope.resourceIds, scope.workspaceIds, scope.projectIds, scope.collectionIds===undefined?[]:scope.collectionIds]) check(Array.isArray(ids) && ids.length <= 10000 && ids.every(identifier) && new Set(ids).size === ids.length, 'invalid_host_scope');
    return structuredClone(scope);
  }
  private permitted(id: string, kind: ResourceRef['kind'], scope: VelaScope) {
    return (kind === 'resource' ? scope.resourceIds : kind === 'workspace' ? scope.workspaceIds : kind==='project'?scope.projectIds:kind==='collection'?scope.collectionIds??[]:[]).includes(id);
  }
  private resolve(id: string, kind: ResourceRef['kind'], scope: VelaScope, restoreCollection=false): ResourceRef {
    check(identifier(id) && this.permitted(id, kind, scope), 'resource_not_authorized');
    const ref = this.opts.host.resolve({ id, kind }, scope,restoreCollection?{restoreCollection:true}:undefined);
    check(ref && ref.id === id && ref.kind === kind && Number.isSafeInteger(ref.version) && ref.version >= 1 && text(ref.title), 'resource_unavailable');
    return structuredClone(ref);
  }
  private getRequest(id: string) {
    const request = this.data.requests.find(r => r.id === id); check(request, 'request_not_found'); return request;
  }
  private getPlan(id: string) {
    const plan = this.data.plans.find(p => p.id === id); check(plan, 'plan_not_found'); return plan;
  }
  private contextIdentity() {
    const context = this.opts.host.context?.(); if (!context) return null;
    check((context.currentProjectId === null || identifier(context.currentProjectId)) && (context.currentWorkspaceId === null || identifier(context.currentWorkspaceId)), 'invalid_host_context');
    return { currentProjectId: context.currentProjectId, currentWorkspaceId: context.currentWorkspaceId };
  }
  private conversationId() {
    if (!this.data.conversationId) {
      const id = this.opts.host.ensureConversation('system:vela');
      check(identifier(id), 'invalid_canonical_conversation'); this.data.conversationId = id;
    }
    return this.data.conversationId;
  }
  ensureMissionConversation(): string {
    return this.atomic(() => this.conversationId());
  }
  private append(content: string, requestId: string, source: 'user' | 'vela-native' | 'provider', plan?: VelaPlan, response?: { kind: ProviderReplyKind; contribution?: ProviderContribution }) {
    const contribution = source === 'provider' ? response?.contribution ?? plan?.contribution : undefined;
    return this.opts.host.appendMessage(this.conversationId(), {
      role: source === 'user' ? 'user' : 'assistant', content, source,
      classification: source === 'provider' ? 'reported' : 'observed', requestId,
      ...(plan ? { planId: plan.id } : {}), ...(contribution ? { providerId: contribution.providerId } : {}),
      ...(source === 'provider' && contribution ? { providerContribution: structuredClone(contribution) } : {}), ...(response ? { responseKind: response.kind } : {}),
    });
  }
  /** Opening records presence only. No inference, execution, content retrieval, or review acknowledgement. */
  open(): VelaState {
    this.atomic(() => { this.conversationId(); this.data.lastPresenceAt = this.now(); });
    return this.state();
  }
  state(): VelaState {
    const scope = this.scope();
    const available = this.opts.planner?.availability() ?? { available: false, busy: false, reason: 'No planning provider connected' };
    const visible = (item: AttentionItem) => item.subject === null || (this.permitted(item.subject.id, item.subject.kind, scope) && !!this.opts.host.resolve(item.subject, scope));
    // Revoke content visibility as well as future collection. Persisted private history remains host-owned.
    const requests = structuredClone(this.data.requests).map(r => {
      const { activeSurface, activeResourceId, activeWorkspaceLayout, ...context } = r.context;
      const projectId = activeSurface?.projectId ?? null, workspaceId = activeSurface?.workspaceId ?? null;
      const visibleWorkspaceId = workspaceId && scope.workspaceIds.includes(workspaceId) ? workspaceId : null;
      if(r.nativeAttachment&&(!this.permitted(r.nativeAttachment.workspaceId,'workspace',scope)||!r.nativeAttachment.resources.every(ref=>this.permitted(ref.id,ref.kind,scope))))delete r.nativeAttachment;
      if(r.nativeSourceObservation&&this.opts.host.validateNativeSourceObservation?.(r.nativeSourceObservation,scope)!==true)delete r.nativeSourceObservation;
      return { ...r, context: { ...context,
        discovered: context.discovered.filter(ref => this.permitted(ref.id, ref.kind, scope)),
        included: context.included.filter(ref => this.permitted(ref.id, ref.kind, scope)),
        omitted: context.omitted.filter(ref => scope.resourceIds.includes(ref.id)),
        ...(activeSurface ? { activeSurface: {
          projectId: projectId && scope.projectIds.includes(projectId) ? projectId : null,
          workspaceId: visibleWorkspaceId,
        } } : {}),
        ...(activeWorkspaceLayout && visibleWorkspaceId ? { activeWorkspaceLayout } : {}),
        ...(activeResourceId && visibleWorkspaceId && scope.resourceIds.includes(activeResourceId) ? { activeResourceId } : {}),
      } };
    });
    const restorationScopes=new Map<string,VelaScope>();
    const planVisible = (p: VelaPlan) => {
      if(p.scope.principalId!==scope.principalId)return false;
      const archived=p.state==='applied'?new Set(p.steps.flatMap(step=>step.action.type==='archiveCollection'&&step.action.archived&&this.data.receipts.some(receipt=>receipt.planId===p.id&&receipt.stepId===step.id&&receipt.state==='applied'&&identifier(receipt.hostReceiptId))?[step.action.collectionId]:[])):new Set<string>();
      const archivedWorkspaces=p.state==='applied'?new Set(p.steps.flatMap(({id,action})=>action.type==='recoverCreation'&&action.action==='undo-creation'&&this.data.receipts.some(receipt=>receipt.planId===p.id&&receipt.stepId===id&&receipt.state==='applied'&&identifier(receipt.hostReceiptId)&&receipt.workspaceRecovery?.kind==='receipt'&&receipt.workspaceRecovery.action==='undo-creation'&&receipt.workspaceRecovery.workspaceId===action.workspaceId)?[action.workspaceId]:[])):new Set<string>();
      const visibleTarget=(ref:ResourceRef,allowed:VelaScope)=>this.permitted(ref.id,ref.kind,allowed)||(ref.kind==='collection'&&archived.has(ref.id)&&this.opts.host.canInspectCollectionArchiveReceipt?.(ref,p.scope)===true)||
        (ref.kind==='workspace'&&archivedWorkspaces.has(ref.id)&&this.opts.host.canInspectWorkspaceArchiveReceipt?.(ref,p.scope)===true);
      const ids=this.restores(p.steps);
      try{
        if(!ids.length)return p.targets.every(r=>visibleTarget(r,scope));
        const key=JSON.stringify(ids.sort());let allowed=restorationScopes.get(key);if(!allowed){allowed=this.scope(p.steps);restorationScopes.set(key,allowed);}return p.targets.every(r=>visibleTarget(r,allowed!));
      }catch{return false;}
    };
    const plans = this.data.plans.filter(planVisible);
    const planIds = new Set(plans.map(p => p.id));
    const receipts = this.data.receipts.filter(r => planIds.has(r.planId));
    const resultRefs = new Map<string, VelaSubjectRef>();
    for (const receipt of receipts) {
      if (receipt.state !== 'applied') continue;
      const construction = receipt.workspaceConstruction;
      if(receipt.clockTimer?.resourceId&&this.permitted(receipt.clockTimer.resourceId,'resource',scope))
        resultRefs.set('resource:'+receipt.clockTimer.resourceId,{id:receipt.clockTimer.resourceId,kind:'resource'});
      if (construction) for (const ref of [
        { id: construction.workspaceId, kind: 'workspace' as const },
        ...(construction.projectId ? [{ id: construction.projectId, kind: 'project' as const }] : []),
        ...construction.resources.map(resource => ({ id: resource.resourceId, kind: 'resource' as const })),
      ]) if (this.permitted(ref.id, ref.kind, scope)) resultRefs.set(subjectKey(ref), ref);
      for (const ref of receipt.foundSubjects ?? []) {
        if (this.permitted(ref.id, ref.kind, scope)) resultRefs.set(subjectKey(ref), ref);
      }
    }
    const currentRefs = new Map(this.resolveSubjects([...resultRefs.values()], scope).map(ref => [subjectKey(ref), ref]));
    const searchResults = Object.fromEntries(receipts.filter(r => r.state === 'applied' && r.foundSubjects).map(r =>
      [r.id, r.foundSubjects!.flatMap(ref => currentRefs.get(subjectKey(ref)) ?? [])]));
    const result: VelaState = {
      contract: VELA_CONTRACT, identity: { id: 'system:vela', name: 'Vela', role: 'application-assistant' },
      conversation: this.data.conversationId ? this.opts.host.readConversation(this.data.conversationId) : null,
      planner: { providerId: this.opts.planner?.providerId ?? null, ...available },
      capabilities: CAPABILITIES, requests, plans, receipts: receipts.map(({ foundSubjects: _refs, openResourceId, workspaceConstruction, clockTimer, ...receipt }) => {
        const constructionVisible = workspaceConstruction && [
          { id: workspaceConstruction.workspaceId, kind: 'workspace' as const },
          ...(workspaceConstruction.projectId ? [{ id: workspaceConstruction.projectId, kind: 'project' as const }] : []),
          ...workspaceConstruction.resources.map(resource => ({ id: resource.resourceId, kind: 'resource' as const })),
        ].every(ref => currentRefs.has(subjectKey(ref)));
        const timerVisible=clockTimer&&(clockTimer.resourceId===null||currentRefs.has('resource:'+clockTimer.resourceId));
        return { ...receipt, ...(constructionVisible ? { workspaceConstruction } : {}), ...(timerVisible?{clockTimer}:{}),
          ...(openResourceId && searchResults[receipt.id]?.some(ref => ref.id === openResourceId && ref.kind === 'resource') ? { openResourceId } : {}) };
      }),
      searchResults,
      preferences: this.data.preferences, attention: this.data.attention.filter(visible),
      lastPresenceAt: this.data.lastPresenceAt, coverage: 'authorized-app-events-only',
      adaptation: this.visibleAdaptation(scope),
      presentation: this.visiblePresentation(scope),
    };
    return structuredClone(result);
  }
  private presentationRequestIds(scope: VelaScope, enforce = false): Set<string> {
    const id = this.data.conversationId; if (!id) return new Set();
    const ref = this.permitted(id, 'resource', scope) ? this.opts.host.resolve({ id, kind: 'resource' }, scope) : null;
    const allowed = ref?.id === id && ref.kind === 'resource' && this.opts.host.canReadContent?.(ref, scope) === true;
    if (enforce) check(allowed, 'presentation_not_authorized');
    return new Set(allowed ? this.data.requests.filter(request => request.conversationId === id).map(request => request.id) : []);
  }
  private visiblePresentation(scope: VelaScope): VelaPresentationState {
    const value = this.data.presentation!, ids = this.presentationRequestIds(scope);
    return { ...value, selectedRequestId: value.selectedRequestId !== null && ids.has(value.selectedRequestId) ? value.selectedRequestId : null, dismissedRequestIds: value.dismissedRequestIds.filter(id => ids.has(id)), pinnedRequestIds: value.pinnedRequestIds.filter(id => ids.has(id)) };
  }
  /** Explicit versioned view metadata; no conversation append, provider call, source body, action consent or attention acknowledgement. */
  presentation(input: { expectedVersion: number; patch: VelaPresentationPatch }): VelaPresentationState {
    check(isRecord(input) && Object.keys(input).sort().join(',') === 'expectedVersion,patch' && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1 && isRecord(input.patch), 'invalid_presentation_patch');
    const keys = Object.keys(input.patch); check(keys.length > 0 && keys.every(key => ['view', 'selectedRequestId', 'dismissedRequestIds', 'pinnedRequestIds'].includes(key)), 'invalid_presentation_patch');
    return this.atomic(() => {
      const current = this.data.presentation!, row = this.opts.db.prepare("SELECT json_extract(json,'$.presentation.version') AS version FROM vela_state WHERE id=1").get();
      check(current.version === input.expectedVersion && Number(row?.version) === input.expectedVersion, 'stale_presentation_version'); check(current.version < Number.MAX_SAFE_INTEGER, 'presentation_version_capacity_reached');
      const value = { ...current, ...structuredClone(input.patch), version: current.version + 1 }; validatePresentation(value);
      const ids = this.presentationRequestIds(this.scope(), true);
      check((value.selectedRequestId === null || ids.has(value.selectedRequestId)) && [...value.dismissedRequestIds, ...value.pinnedRequestIds].every(id => ids.has(id)), 'presentation_request_not_authorized');
      const dismissed = new Set(value.dismissedRequestIds);
      check(!this.data.plans.some(plan => requiresVelaPlanAttention(plan.state) && this.data.requests.some(request => request.id === plan.requestId && request.planId === plan.id && ids.has(request.id)) && dismissed.has(plan.requestId)), 'presentation_plan_requires_review');
      this.data.presentation = value; return structuredClone(value);
    });
  }
  search(query: string, match?: 'exact-resource'): ResourceRef[] {
    check(typeof query === 'string' && query.length <= 200, 'invalid_search');
    const scope = this.scope();
    return this.resolveSubjects(this.opts.host.search(query, scope, 30, match).slice(0, 30), scope);
  }
  private resolveSubjects(refs: readonly VelaSubjectRef[], scope: VelaScope): ResourceRef[] {
    const allowed = new Map(refs.filter(ref => this.permitted(ref.id, ref.kind, scope)).map(ref => [subjectKey(ref), ref]));
    if (!allowed.size) return [];
    const list = [...allowed.values()];
    const found = this.opts.host.resolveMany?.(list, scope) ??
      list.flatMap(ref => this.opts.host.resolve(ref, scope) ?? []);
    return found.filter(ref => allowed.has(subjectKey(ref)) && Number.isSafeInteger(ref.version) && ref.version >= 1 && text(ref.title));
  }
  /** Exact prospective context for native consent. No conversation/message/request/provider side effects. */
  previewContext(resourceIds: string[]): ContextManifest {
    return this.read(() => structuredClone(this.context(resourceIds, this.scope())));
  }
  private historyOrigin(scope = this.scope()): HistoryOrigin {
    const navigation = this.contextIdentity(); return { principalId: scope.principalId, policyVersion: scope.policyVersion,
      navigation: navigation ? { kind: 'known', projectId: navigation.currentProjectId, workspaceId: navigation.currentWorkspaceId } : { kind: 'unknown' } };
  }
  /** Trusted metadata projection only; never RPC or a second transcript/body store. */
  historyRequestMetadata(id: string): HistoryRequestRecord | null {
    return this.read(() => {
      const r = this.data.requests.find(value => value.id === id); if (!r) return null;
      const scope = this.scope(), ref = this.opts.host.resolve({ id: r.conversationId, kind: 'resource' }, scope);
      if (!ref || this.opts.host.canReadContent?.(ref, scope) !== true) return null;
      if(r.nativeSourceObservation&&this.opts.host.validateNativeSourceObservation?.(r.nativeSourceObservation,scope)!==true)return null;
      let sourceDependencies; try { sourceDependencies = historyDependenciesFromContext(r.context, r.conversationId); } catch { return null; }
      return structuredClone({ id: r.id, conversationId: r.conversationId, state: r.state, providerId: r.providerId,
        ...(r.handoff?.taskId ? { taskId: r.handoff.taskId } : {}),
        ...(r.origin ? { origin: r.origin } : {}), ...(r.inputMessageId ? { inputMessageId: r.inputMessageId } : {}), ...(r.inputContentDigest ? { inputContentDigest: r.inputContentDigest } : {}),
        ...(r.response ? { response: r.response } : {}), ...(r.provenance ? { provenance: r.provenance } : {}),...(r.nativeSourceObservation?{nativeSourceObservation:r.nativeSourceObservation}:{}), sourcePolicyVersion: r.context.policyVersion, sourceDependencies });
    });
  }
  private historyReaders(): { full: HistoryProofReader; metadata: HistoryMetadataReader } {
    const callbacks = this.opts.history; check(callbacks && this.opts.host.conversationRevision && this.opts.host.canReadContent, 'canonical_history_unavailable');
    const scope = this.scope(), resolve: HistoryProofReader['resolve'] = ref => this.opts.host.resolve(ref, scope);
    const canReadContent = (ref: ResourceRef) => this.opts.host.canReadContent!(ref, scope) === true;
    const canReadMessage = (id: string) => { const ref = resolve({ id, kind: 'resource' }); return !!ref && canReadContent(ref); };
    const request = (id: string) => this.historyRequestMetadata(id);
    const verifyNativeSourceObservation=(r:HistoryRequestRecord)=>!!r.nativeSourceObservation&&this.opts.host.validateNativeSourceObservation?.(r.nativeSourceObservation,scope)===true;
    const metadata: HistoryMetadataReader = { request, resolve, canReadContent,
      message: (id, messageId) => canReadMessage(id) ? callbacks.messageMetadata(id, messageId) : null,
      verifyProviderContribution: callbacks.verifyProviderContribution,verifyNativeSourceObservation };
    const full: HistoryProofReader = { request, resolve,verifyNativeSourceObservation,
      message: (id, messageId, maxBytes) => canReadMessage(id) ? callbacks.message(id, messageId, maxBytes) : null,
      content: (ref, maxBytes) => canReadContent(ref) ? callbacks.content(ref, maxBytes) : null,
      verifyProviderContribution: (contribution, message, r) => {
        const m = metadata.message(r.conversationId, message.id); return !!m && callbacks.verifyProviderContribution(contribution, m, r) === true;
      } };
    return { full, metadata };
  }
  /** Core-only prospective egress. Opening/selection never appends, creates a conversation or invokes a provider. */
  previewProviderContext(resourceIds: string[], options: { includeHistory: boolean; activeResourceId?: string; historyQuery?: string; historyQueryMode?: 'semantic-query';
    agent?: { ref: ResourceRef; instructions: string };
    handoff?: { requestId: string; destinationProviderId: string; purpose?: VelaHandoff['purpose'] }; fits(context: ContextManifest): boolean
  }): { context: ContextManifest; origin: HistoryOrigin; historyFence?: HistoryFence; historyOmissions: readonly HistoryOmission[]; handoff?: VelaHandoff } {
    return this.read(() => {
      const scope = this.scope(), origin = this.historyOrigin(scope), context = this.context(resourceIds, scope, options.activeResourceId);
      if (options.agent) {
        const ref = this.resolve(options.agent.ref.id, 'resource', scope);
        check(ref.version === options.agent.ref.version && ref.resourceKind === 'agent', 'stale_vela_agent_routing');
        if (!context.discovered.some(item => item.id === ref.id && item.kind === ref.kind)) context.discovered.push(ref);
        if (options.agent.instructions) context.agentInstructions = options.agent.instructions;
      }
      check(typeof options.includeHistory === 'boolean' && typeof options.fits === 'function', 'invalid_history_preview');
      check(options.fits(context), 'planning_prompt_capacity_exceeded');
      if (options.handoff) {
        check(this.data.conversationId, 'vela_handoff_source_unavailable');
        const readers = this.historyReaders(), tail = this.opts.history?.tail?.(this.data.conversationId);
        check(tail, 'vela_handoff_source_unavailable');
        try {
          const chosen = selectVelaHandoff({ ...options.handoff, origin, tail, reader: readers.full,
            fits: history => options.fits({ ...context, history }) });
          unionHistoryDependencies(historyDependenciesFromContext(context, this.data.conversationId), chosen.fence.dependencies);
          return structuredClone({ context: { ...context, history: chosen.history }, origin,
            historyFence: chosen.fence, historyOmissions: [], handoff: chosen.handoff });
        } catch (error) {
          if (!(error instanceof HistorySelectionError)) throw error;
          const code = error.code === 'handoff-same-provider' ? 'vela_handoff_same_provider'
            : error.code === 'handoff-context-limit' ? 'vela_handoff_context_limit' : 'vela_handoff_source_unavailable';
          throw new VelaError(code);
        }
      }
      if (!options.includeHistory) return { context, origin, historyOmissions: [{ reason: 'disabled' }] };
      if (!this.data.conversationId) return { context, origin, historyOmissions: [{ reason: 'no-conversation' }] };
      const conversation = this.opts.host.resolve({ id: this.data.conversationId, kind: 'resource' }, scope);
      if (!conversation || this.opts.host.canReadContent?.(conversation, scope) !== true) return { context, origin, historyOmissions: [{ reason: 'message-unavailable' }] };
      const readers = this.historyReaders(), snapshot = this.opts.history!.snapshot(this.data.conversationId, HISTORY_LIMITS.lookbackMessages, options.historyQuery, options.historyQueryMode);
      if (snapshot === null) return { context, origin, historyOmissions: [{ reason: 'message-unavailable' }] };
      const selection = selectBoundedHistory({ enabled: true, origin, snapshot, reader: readers.full, fits: history => options.fits({ ...context, ...(history ? { history } : {}) }) });
      if (selection.fence) {
        try { unionHistoryDependencies(historyDependenciesFromContext(context, this.data.conversationId), selection.fence.dependencies); }
        catch (error) { if (!(error instanceof HistorySelectionError)) throw error;
          return { context, origin, historyOmissions: [...selection.omissions, { reason: error.code === 'unproven-request' ? 'unproven-request' : 'proof-limit' }] }; }
      }
      return structuredClone({ context: { ...context, ...(selection.history ? { history: selection.history } : {}) }, origin,
        ...(selection.fence ? { historyFence: selection.fence } : {}), historyOmissions: selection.omissions });
    });
  }
  /** Native shadow investigation. The disclosure gateway must authorize each exact outbound payload.
   * No exchange or model assessment is appended or used as a turn result. */
  investigateHistory(intent: string, disclose: (call: SemanticHistoryCall, sources: readonly VelaSemanticHistorySource[],
    signal: AbortSignal, revalidate: () => boolean) => Promise<unknown>, signal?: AbortSignal,
    selectedNoteIds: readonly string[] = []) {
    const noteIds = [...selectedNoteIds];
    check(noteIds.length <= 4 && noteIds.every(identifier) && new Set(noteIds).size === noteIds.length, 'invalid_semantic_note_selection');
    const originDigest = historyDigest(this.read(() => this.historyOrigin()));
    const originCurrent = () => historyDigest(this.read(() => this.historyOrigin())) === originDigest;
    const proofs = new WeakMap<VelaSemanticHistorySource, () => boolean>();
    const isCurrent = (source: VelaSemanticHistorySource) => {
      try { return proofs.get(source)?.() === true; }
      catch (error) {
        if (error instanceof HistorySelectionError || error instanceof VelaError) return false;
        throw error;
      }
    };
    const findHistory = (query?: string) => {
      if (!originCurrent()) return { sources: [], scan: 'unavailable' as const };
      const preview = this.previewProviderContext([], { includeHistory: true,
        ...(query ? { historyQuery: query, historyQueryMode: 'semantic-query' as const } : {}), fits: () => true });
      const { history } = preview.context;
      const scan: SemanticHistoryScan = preview.historyOmissions.some(item => item.reason === 'message-unavailable' || item.reason === 'unknown-origin')
        ? 'unavailable' : (!query && !!history) || history?.retrieval?.partial || preview.historyOmissions.some(item => item.reason !== 'no-history' && item.reason !== 'no-conversation')
          ? 'partial' : 'bounded';
      if (!preview.historyFence || !history || (query && (!history.retrieval || history.retrieval.resolution === 'no-match'))) return { sources: [], scan };
      const fence = preview.historyFence;
      const requestIds = history.retrieval?.selectedRequestIds ?? [...new Set(history.messages.map(message => message.requestId))];
      const sources = requestIds.map(sourceId => {
        const source = Object.freeze({
          sourceId, sourceKind: 'conversation-exchange' as const, revision: String(fence.baseRevision), proofDigest: fence.digest,
          text: JSON.stringify(history.messages.filter(message => message.requestId === sourceId)
            .map(({ role, content }) => ({ role, content }))),
        });
        proofs.set(source, () => { this.validateProviderHistory(preview); return true; });
        return source;
      });
      return { sources, scan };
    };
    const readNote = (id: string) => this.read(() => {
      const scope = this.scope();
      const ref = this.opts.host.resolve({ id, kind: 'resource' }, scope);
      if (ref?.resourceKind !== 'note' || this.opts.host.canReadContent?.(ref, scope) !== true) return null;
      const entry = this.context([id], scope).included[0];
      if (!entry) return null;
      return Object.freeze({
        sourceId: id, sourceKind: 'note' as const, revision: String(entry.version), text: entry.content,
        proofDigest: historyDigest({ originDigest, id, version: entry.version, source: entry.source, digest: entry.contentDigest }),
      });
    });
    const findSelectedNotes = () => {
      if (!originCurrent()) return { sources: [], scan: 'unavailable' as const };
      const notes = noteIds.flatMap(id => {
        const note = readNote(id);
        if (!note) return [];
        proofs.set(note, () => readNote(id)?.proofDigest === note.proofDigest);
        return [note];
      });
      const scan: SemanticHistoryScan = notes.length === noteIds.length ? 'bounded' : notes.length ? 'partial' : 'unavailable';
      return { sources: notes, scan };
    };
    return investigateSemanticHistory<VelaSemanticHistorySource>(intent, {
      ...(noteIds.length ? { selected: findSelectedNotes } : {}),
      search: findHistory,
      recent: () => findHistory(),
      isCurrent,
      disclose: (call, sources, abort) => {
        const revalidate = () => originCurrent() && sources.every(isCurrent);
        return revalidate() ? disclose(call, sources, abort, revalidate) : Promise.resolve(null);
      },
    }, signal);
  }

  /** Validates the exact private reviewed window; metadataOnly is safe for schema tools and never reselects. */
  validateProviderHistory(preview: { context: ContextManifest; historyFence?: HistoryFence }, options: { metadataOnly?: boolean; acceptedAppend?: AcceptedHistoryAppend } = {}): void {
    this.read(() => {
      if (!preview.historyFence) { check(!preview.context.history, 'invalid_history_fence'); return; }
      check(preview.context.history && this.data.conversationId === preview.historyFence.conversationId, 'invalid_history_fence');
      const readers = this.historyReaders(), revision = this.opts.host.conversationRevision!(preview.historyFence.conversationId);
      check(revision !== null, 'canonical_history_unavailable');
      const input = { fence: preview.historyFence, origin: this.historyOrigin(), current: { conversationId: preview.historyFence.conversationId, revision }, ...(options.acceptedAppend ? { acceptedAppend: options.acceptedAppend } : {}) };
      if (options.metadataOnly) validateFrozenHistoryMetadata({ ...input, reader: readers.metadata });
      else validateFrozenHistory({ ...input, history: preview.context.history, reader: readers.full });
    });
  }
  private context(ids: string[], scope: VelaScope, activeResourceId?: string): ContextManifest {
    check(Array.isArray(ids) && ids.length <= 12 && ids.every(identifier) && new Set(ids).size === ids.length, 'invalid_context_selection');
    const manifest: ContextManifest = { id: randomUUID(), createdAt: this.now(), policyVersion: scope.policyVersion,
      discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' };
    for (const id of ids) {
      const ref = this.resolve(id, 'resource', scope); manifest.discovered.push(ref);
      const content = this.opts.host.readContent(id, scope);
      if (!content) {const reason=this.opts.host.contentOmissionReason?.(id,scope);check(reason===undefined||text(reason,400),'invalid_host_content');manifest.omitted.push({ id, reason:reason??'Content unavailable or not authorized' }); continue; }
      check(content.ref.id === id && content.ref.kind === ref.kind && content.ref.version === ref.version, 'stale_context_version');
      check(typeof content.content === 'string' && text(content.source, 1000), 'invalid_host_content');
      const bytes = byteLength(content.content);
      if (bytes > 12000 || manifest.contentBytes + bytes > 32000) { manifest.omitted.push({ id, reason: 'Content exceeds bounded context; select a smaller source' }); continue; }
      manifest.included.push({ ...ref, content: content.content, source: content.source, reason: 'explicit', contentDigest: digest(content.content), trust: 'untrusted-source-data' });
      manifest.contentBytes += bytes;
    }
    for(const supplied of this.opts.host.contextReferences?.(ids)??[]) {
      check(supplied.kind==='project'||supplied.kind==='workspace','invalid_application_context_reference');
      const actual=this.resolve(supplied.id,supplied.kind,scope);check(actual.version===supplied.version,'stale_application_context_reference');
      if(!manifest.discovered.some(ref=>ref.id===actual.id&&ref.kind===actual.kind))manifest.discovered.push(actual);
    }
    const active = this.contextIdentity();
    if (active) {
      const discoveredId = (id: string | null, kind: 'project' | 'workspace') =>
        manifest.discovered.find(ref => ref.id === id && ref.kind === kind)?.id ?? null;
      manifest.activeSurface = {
        projectId: discoveredId(active.currentProjectId, 'project'),
        workspaceId: discoveredId(active.currentWorkspaceId, 'workspace'),
      };
      if (manifest.activeSurface.workspaceId) {
        const layout = this.opts.host.activeWorkspaceLayout?.(manifest.activeSurface.workspaceId);
        if (layout) manifest.activeWorkspaceLayout = layout;
        if (activeResourceId) {
          const resource = this.opts.host.resolve({ id: activeResourceId, kind: 'resource' }, scope);
          if (resource) {
            manifest.activeResourceId = resource.id;
            if (!manifest.discovered.some(ref => ref.kind === resource.kind && ref.id === resource.id))
              manifest.discovered.push(resource);
          }
        }
      }
    }
    return manifest;
  }
  private targets(steps: PlanStep[], scope: VelaScope) {
    const refs = new Map<string, ResourceRef>();
    const add = (id: string | null, kind: ResourceRef['kind'],restoreCollection=false) => { if (id !== null) { const ref = this.resolve(id, kind, scope,restoreCollection); refs.set(kind + ':' + id, ref); } };
    for (const step of steps) {
      const a = step.action;
      switch (a.type) {
        case 'clockTimer': {
          const request=a.request;add(a.workspaceId,'workspace');
          if(request.name==='create')add(request.input.projectId??null,'project');
          if(request.name==='list')for(const id of request.input.resourceIds)add(id,'resource');
          if(request.name==='mutate'||request.name==='read') {
            add(request.input.resourceId,'resource');const ref=refs.get('resource:'+request.input.resourceId)!;
            check(ref.resourceKind==='clock_timer','canonical_timer_resource_required');
            if(request.input.expectedVersion!==undefined)check(ref.version===request.input.expectedVersion,'stale_resource_version');
          }
          break;
        }
        case 'setAttentionMode': {const version=this.attentionPreferenceVersion();check(version!==null,'attention_preferences_unavailable');check(version===a.expectedVersion,'stale_preference_version');break;}
        case 'navigate': if (a.target.kind === 'workspace') add(a.target.workspaceId, 'workspace'); else add(a.target.projectId, 'project'); break;
        case 'createWorkspace': case 'constructWorkspace': add(a.projectId, 'project'); break;
        case 'adjustWorkspace':add(a.workspaceId,'workspace');for(const adjustment of a.adjustments)for(const id of adjustment.resourceIds)add(id,'resource');break;
        case 'recoverCreation':if(a.action==='undo-creation')add(a.workspaceId,'workspace');else {const source=this.creationRecoveryReference(a.receiptId);if(source)add(source.projectId,'project');else for(const ref of this.opts.host.contextReferences?.([])??[])if(ref.kind==='project')add(ref.id,'project');}break;
        case 'inspectVelaOperation': add(a.workspaceId,'workspace'); break;
        case 'repairWorkspace': add(a.workspaceId,'workspace'); for(const id of a.resourceIds)add(id,'resource'); break;
        case 'createTimeline': add(a.projectId, 'project'); add(a.workspaceId, 'workspace'); break;
        case 'renameProject': add(a.projectId,'project'); break;
        case 'renameResource': case 'associateResourceProject': {
          add(a.resourceId,'resource');
          check(['note','task','task_group','reference'].includes(refs.get('resource:'+a.resourceId)!.resourceKind??''),'resource_organization_unsupported');
          if(a.type==='associateResourceProject')add(a.projectId,'project');break;
        }
        case 'createConversation': for(const ref of this.opts.host.contextReferences?.([])??[])if(ref.kind==='project')add(ref.id,'project'); break;
        case 'conversationFavorite': case 'renameConversation': add(a.resourceId,'resource'); break;
        case 'associateConversationProject': add(a.resourceId,'resource'); add(a.projectId,'project'); break;
        case 'createCollection': add(a.projectId,'project'); break;
        case 'renameCollection': add(a.collectionId,'collection'); break;
        case 'archiveCollection': add(a.collectionId,'collection',!a.archived); break;
        case 'collectionMembership': add(a.collectionId,'collection'); add(a.resourceId,'resource'); break;
        case 'renameWorkspace': case 'bringAllIntoView': case 'resolveLayout': case 'setOrganization': add(a.workspaceId, 'workspace'); break;
        case 'workspaceFromResources': add(a.projectId, 'project'); for (const id of a.resourceIds) add(id, 'resource'); break;
        case 'createResource': add(a.workspaceId, 'workspace'); break;
        case 'attach': add(a.workspaceId, 'workspace'); add(a.resourceId, 'resource'); break;
        case 'content': case 'taskStatus': case 'taskPriority': add(a.resourceId, 'resource'); check(refs.get('resource:' + a.resourceId)!.version === a.expectedVersion, 'stale_resource_version'); break;
        case 'setTaskGroupMembers': add(a.groupId, 'resource'); check(refs.get('resource:' + a.groupId)!.version === a.expectedVersion, 'stale_resource_version'); for (const id of a.taskIds) add(id, 'resource'); break;
        case 'relate': add(a.sourceId, 'resource'); add(a.targetId, 'resource'); break;
        case 'applyStructuredPreset': add(a.workspaceId, 'workspace'); break;
        case 'delegateTask': for (const id of a.resourceIds) add(id, 'resource'); break;
      }
    }
    return [...refs.values()];
  }
  private authorize(input: AuthorizationRequest): string {
    const decision = this.opts.host.authorize(structuredClone(input));
    check(decision.policyVersion === input.scope.policyVersion, 'stale_policy_version');
    check(decision.decision === 'allow', decision.decision === 'deny' ? 'host_policy_denied' : 'invalid_host_policy_decision');
    check(identifier(decision.authorizationRef), 'host_authorization_required'); return decision.authorizationRef;
  }
  private authInput(plan: VelaPlan, phase: AuthorizationRequest['phase'], priorAuthorizationRef?: string): AuthorizationRequest {
    return { phase, requestId: plan.requestId, planId: plan.id, fingerprint: plan.fingerprint,
      intent: this.getRequest(plan.requestId).intent, scope: this.scope(plan.steps), targets: plan.targets,
      actions: plan.steps.map(s => s.action), ...(priorAuthorizationRef ? { priorAuthorizationRef } : {}) };
  }
  private prepare(request: VelaRequest, summary: string, steps: PlanStep[], contribution: VelaPlan['contribution']): VelaPlan {
    check(steps.slice(0, -1).every(step => step.action.type !== 'openResource'), 'resource_open_must_be_final');
    const scope = this.scope(steps), targets = this.targets(steps, scope);
    const body = { requestId: request.id, version: 1 as const, summary, steps, targets, scope, contribution };
    const plan: VelaPlan = { ...body, id: randomUUID(), fingerprint: digest(body), state: 'prepared', createdAt: this.now(), expiresAt: new Date(Date.parse(this.now()) + 15 * 60000).toISOString() };
    this.authorize(this.authInput(plan, 'prepare'));
    this.data.plans.push(plan); request.planId = plan.id; request.state = 'awaiting-review'; request.updatedAt = this.now();
    return plan;
  }
  /** Only the host can supply a sampled measurement or select a typed observation. */
  local(input: { capabilityId: VelaLocalCapabilityId; intent: string; commandId: string }, signal?: AbortSignal, utilization?: import('./system-utilization.mts').SystemUtilization[], memory?: import('./system-information.ts').SystemMemoryMeasurement | null,battery?:import('./system-battery.ts').SystemBatteryMeasurement|null): VelaLocalDispatch {
    const started = performance.now();
    check(isRecord(input) && Object.keys(input).every(key => ['capabilityId', 'intent', 'commandId'].includes(key)) && text(input.intent, 16000) && identifier(input.commandId), 'invalid_local_request');
    const { capabilityId } = input, classified = performance.now();
    check(isLocalFact(capabilityId), 'unsupported_local_capability');
    const previous = this.data.requests.find(request => request.local?.commandId === input.commandId);
    if (previous) check(previous.intent === input.intent && previous.local?.capabilityId === capabilityId, 'local_command_id_conflict');
    check(!signal?.aborted, 'local_request_cancelled'); const host = this.opts.local; check(host, 'local_capability_host_unavailable');
    const identity = host.identity(); check(identifier(identity.principalId) && identifier(identity.policyVersion), 'invalid_local_identity');
    if (previous) {
      check(previous.origin?.principalId === identity.principalId && previous.origin.policyVersion === identity.policyVersion, 'local_response_unavailable');
      const message = this.read(() => host.readMessage(previous.conversationId, previous.response!.messageId));
      check(message && message.id === previous.response!.messageId && message.requestId === previous.id && message.role === 'assistant' && message.source === 'vela-native' && canonicalUserEvidence(message) && message.providerId === undefined && message.providerContribution === undefined && message.planId === undefined && message.responseKind === previous.response!.kind && digest(message.content) === previous.response!.contentDigest, 'local_response_unavailable');
      const ended = performance.now(); return { matched: true, request: structuredClone(previous), result: { ...structuredClone(previous.local!), messageId: message.id, content: message.content, replayed: true, timing: { classificationMs: classified - started, capabilityMs: ended - classified, persistenceMs: 0, totalMs: ended - started } } };
    }
    const answer = evaluateLocalCapability(capabilityId, host, input.intent, utilization, memory,battery), recordedAt = this.now(), observedAt = answer.facts.kind === 'time' || answer.facts.kind === 'date' ? answer.facts.utc : answer.facts.kind === 'system-memory' || answer.facts.kind === 'system-battery' || answer.facts.kind === 'system-utilization' ? answer.facts.measurement.measuredAt : recordedAt; check(!signal?.aborted, 'local_request_cancelled');
    const record: VelaLocalRecord = { schemaVersion: 1, commandId: input.commandId, capabilityId, classification: 'observed', providerId: null, observedAt, facts: answer.facts }; validateLocalRecord(record);
    const committing = performance.now();
    const value = this.atomic(() => {
      check(!signal?.aborted, 'local_request_cancelled');
      const conversationId = host.ensureConversation(); check(identifier(conversationId) && (this.data.conversationId === null || this.data.conversationId === conversationId), 'canonical_local_conversation_mismatch'); this.data.conversationId = conversationId;
      const request: VelaRequest = { id: randomUUID(), conversationId, intent: input.intent, state: 'responded', createdAt: recordedAt, updatedAt: recordedAt, providerId: null,
        context: { id: randomUUID(), createdAt: recordedAt, policyVersion: identity.policyVersion, discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' },
        origin: { ...identity, navigation: { kind: 'unknown' } }, inputContentDigest: digest(input.intent), local: record };
      const user = host.appendMessage(conversationId, { role: 'user', content: input.intent, source: 'user', classification: 'observed', requestId: request.id }); check(identifier(user.id) && user.requestId === request.id && user.role === 'user' && canonicalUserEvidence(user) && user.content === input.intent && user.source === 'user' && user.providerId === undefined, 'invalid_canonical_request'); request.inputMessageId = user.id;
      check(!signal?.aborted, 'local_request_cancelled');
      const message = host.appendMessage(conversationId, { role: 'assistant', content: answer.content, source: 'vela-native', classification: 'observed', requestId: request.id, responseKind: answer.kind });
      check(identifier(message.id) && message.role === 'assistant' && message.requestId === request.id && message.content === answer.content && message.source === 'vela-native' && canonicalUserEvidence(message) && message.providerId === undefined && message.providerContribution === undefined && message.planId === undefined && message.responseKind === answer.kind, 'invalid_canonical_local_response');
      check(!signal?.aborted, 'local_request_cancelled'); request.response = { kind: answer.kind, messageId: message.id, contentDigest: digest(message.content) }; this.data.requests.push(request);
      return { request: structuredClone(request), message };
    });
    const ended = performance.now(); const result: VelaLocalResult = { ...structuredClone(record), messageId: value.message.id, content: value.message.content, replayed: false,
      timing: { classificationMs: classified - started, capabilityMs: committing - classified, persistenceMs: ended - committing, totalMs: ended - started } };
    return { matched: true, request: value.request, result };
  }
  /** Trusted host entry after exact local command approval. */
  beginProjectCheck(intent: string, receipt: VelaProjectCheckReceipt, routingSettings: VelaRequest['routingSettings']): VelaRequest {
    check(text(intent, 16000) && receipt.state === 'running', 'invalid_vela_project_check');
    const scope = this.scope();
    return this.atomic(() => {
      const time = this.now();
      const request: VelaRequest = { id: randomUUID(), conversationId: this.conversationId(), intent, state: 'checking',
        createdAt: time, updatedAt: time, providerId: null, origin: this.historyOrigin(scope), inputContentDigest: historyDigest(intent),
        context: { id: randomUUID(), createdAt: time, policyVersion: scope.policyVersion, discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' },
        route: { kind: 'project-check', reason: 'reviewed-local-check', environment: 'local-read-only', check: receipt.kind },
        routingSettings: structuredClone(routingSettings), projectCheck: structuredClone(receipt) };
      const user = this.append(intent, request.id, 'user');
      check(identifier(user.id) && user.requestId === request.id && user.role === 'user' && user.source === 'user' &&
        canonicalUserEvidence(user) && user.content === intent, 'invalid_canonical_request');
      request.inputMessageId = user.id;
      this.data.requests.push(request);
      return structuredClone(request);
    });
  }
  finishProjectCheck(requestId: string, receipt: VelaProjectCheckReceipt): VelaRequest {
    return this.atomic(() => {
      const request = this.getRequest(requestId);
      check(request.state === 'checking' && request.projectCheck?.id === receipt.id && receipt.state !== 'running', 'invalid_vela_project_check');
      const label = VELA_PROJECT_CHECK_LABELS[receipt.kind];
      const details = { passed: 'passed', failed: 'failed', limited: 'exceeded the time or output limit',
        unknown: 'finished without a confirmed result', stale: 'could not be verified because the reviewed inputs changed' } as const;
      const count = receipt.testCount === undefined ? '' : ' The runner reported ' + receipt.testCount + ' tests.';
      const report = receipt.benchmark;
      const measurement = report ? ` The script reported ${report.samples} samples, with a median of ${report.medianMs} ms and a 95th percentile of ${report.p95Ms} ms.` : '';
      const artifact = receipt.artifact ? ` Review the ${receipt.artifact.bytes}-byte output before saving it as ${receipt.artifact.relativePath}.` : '';
      const content = label + ' ' + details[receipt.state] + '.' + count + measurement + artifact;
      const kind = receipt.state === 'passed' || receipt.state === 'failed' ? 'answer' : 'inability';
      const message = this.append(content, requestId, 'vela-native', undefined, { kind });
      check(identifier(message.id) && message.requestId === requestId && message.source === 'vela-native' &&
        canonicalUserEvidence(message) && message.content === content && message.responseKind === kind &&
        message.providerId === undefined, 'invalid_canonical_local_response');
      request.projectCheck = structuredClone(receipt);
      request.response = { kind, messageId: message.id, contentDigest: historyDigest(content) };
      request.state = 'responded'; request.updatedAt = this.now();
      return structuredClone(request);
    });
  }
  recordProviderRecovery(requestId: string, recovery: VelaProviderRecovery): void {
    this.atomic(() => {
      const request = this.getRequest(requestId);
      check(request.state === 'unknown' && !request.providerRecovery && request.providerId === 'codex-app-server', 'vela_provider_recovery_unavailable');
      request.providerRecovery = structuredClone(recovery);
      request.updatedAt = recovery.observedAt;
    });
  }
  async request(input: { intent: string; resourceIds: string[]; authorizeProvider: boolean }, frozen?: PrivateFrozenProviderContext, planner = this.opts.planner, routed?: Pick<VelaRequest, 'route' | 'routingSettings' | 'handoff' | 'routingAgent'>): Promise<VelaRequest> {
    check(text(input.intent, 16000) && typeof input.authorizeProvider === 'boolean', 'invalid_request');
    const scope = this.scope(), navigation = this.contextIdentity();
    if (frozen) check(typeof frozen.validate === 'function' && typeof frozen.onAcceptedAppend === 'function', 'private_provider_context_required');
    const reviewed = frozen ? freeze(structuredClone({ context: frozen.context, ...(frozen.historyFence ? { historyFence: frozen.historyFence } : {}) })) : undefined;
    if (routed?.handoff) check(identifier(routed.handoff.taskId) && reviewed?.historyFence?.historyDigest === routed.handoff.contextDigest &&
      routed.handoff.destinationProviderId === planner?.providerId, 'invalid_vela_handoff');
    let acceptedAppend: AcceptedHistoryAppend | undefined;
    let completionContext:ReturnType<NonNullable<VelaServiceOptions['providerContextAdvance']>>;
    const validate = (phase: 'before-append' | 'before-provider' | 'before-response') => {
      if(phase==='before-response')completionContext=this.opts.providerContextAdvance?.(request.id);
      if(completionContext){completionContext.validate();this.validateProviderHistory(completionContext);return;}
      if (reviewed) { this.validateProviderHistory(reviewed, { ...(acceptedAppend ? { acceptedAppend } : {}) }); frozen!.validate(phase, acceptedAppend); }
    };
    let providerContext!: ContextManifest;
    const request = this.atomic(() => {
      validate('before-append');
      providerContext = reviewed ? structuredClone(reviewed.context) : this.context(input.resourceIds, scope);
      check(providerContext.policyVersion === scope.policyVersion, 'stale_policy_version');
      // The exact private reviewed egress is used in memory; canonical history bodies are never duplicated in request storage.
      const { history: _history, agentInstructions: _agentInstructions, operations, ...storedContext } = providerContext;
      const conversationId=this.conversationId(),baseRevision=frozen?this.opts.host.conversationRevision?.(conversationId):undefined;
      if(frozen)check(Number.isSafeInteger(baseRevision)&&Number(baseRevision)>=1&&Number(baseRevision)<Number.MAX_SAFE_INTEGER,'canonical_history_revision_required');
      const r: VelaRequest = { id: randomUUID(), conversationId, intent: input.intent,
        state: 'planning', createdAt: this.now(), updatedAt: this.now(), providerId: planner?.providerId ?? null,
        context: storedContext, origin: this.historyOrigin(scope), inputContentDigest: historyDigest(input.intent),
        ...(operations ? { operationContext: { contract: operations.contract, digest: operations.digest,
          receiptIds: operations.operations.map(operation => operation.receiptId) } } : {}),
        ...(routed ? structuredClone(routed) : {}),
        ...(reviewed?.historyFence ? { history: { schemaVersion: 1, fenceDigest: reviewed.historyFence.digest, historyDigest: reviewed.historyFence.historyDigest, messages: reviewed.historyFence.messages } } : {}) };
      this.data.requests.push(r); const message = this.append(r.intent, r.id, 'user');
      check(identifier(message.id) && message.requestId === r.id && message.role === 'user' && message.source === 'user' && canonicalUserEvidence(message) && message.content === r.intent, 'invalid_canonical_request');
      r.inputMessageId = message.id;
      // Explicit selection of Vela itself cannot establish a recursive proof. Such a request remains usable but is never implicit history.
      try { r.provenance = createHistoryProvenance({ requestId: r.id, conversationId: r.conversationId, origin: r.origin!, inputMessageId: message.id, inputContentDigest: r.inputContentDigest!, dependencies: unionHistoryDependencies(historyDependenciesFromContext(r.context, r.conversationId), reviewed?.historyFence?.dependencies ?? []) }); }
      catch (error) { if (reviewed?.historyFence || !(error instanceof HistorySelectionError)) throw error; }
      if (frozen) {
        const revision = this.opts.host.conversationRevision?.(r.conversationId); check(Number.isSafeInteger(revision) && Number(revision) >= 1, 'canonical_history_revision_required');
        check(revision===baseRevision!+1,'invalid_history_append');
        if (reviewed?.historyFence) check(revision === reviewed.historyFence.baseRevision + 1, 'invalid_history_append');
        acceptedAppend = { requestId: r.id, messageId: message.id, contentDigest: r.inputContentDigest!, revision: revision! };
        frozen.onAcceptedAppend(structuredClone(acceptedAppend),{conversationId,revision:baseRevision!});
      }
      return r;
    });
    const controller = new AbortController(); this.controllers.set(request.id, controller);
    let providerOutput: unknown, providerOutputReceived = false, retainInvalidProposal = false;
    let localReadPlanId: string | undefined;
    try {
      const status = planner?.availability();
      if (!planner || !status?.available || status.busy || input.authorizeProvider !== true) {
        this.atomic(() => {
          request.state = 'provider-unavailable'; request.errorCode = !planner || !status?.available ? 'provider_unavailable' : status.busy ? 'provider_busy' : 'provider_authorization_required';
          this.append('Model planning is unavailable for this request. Native search, navigation, and local actions remain available.', request.id, 'vela-native');
        }); return structuredClone(this.getRequest(request.id));
      }
      this.authorize({ phase: 'provider-context', requestId: request.id, intent: request.intent, scope,
        targets: providerContext.discovered, contextManifest: providerContext, actions: [], providerId: planner.providerId });
      validate('before-provider');
      const proposal = await planner.propose({ requestId: request.id, conversationId: request.conversationId,
        intent: request.intent, context: structuredClone(providerContext), capabilities: structuredClone(CAPABILITIES), instruction: VELA_PLANNING_INSTRUCTION }, controller.signal);
      providerOutput = proposal; providerOutputReceived = true;
      if (controller.signal.aborted || this.getRequest(request.id).state !== 'planning') return structuredClone(this.getRequest(request.id));
      localReadPlanId = this.atomic(() => {
        const active = this.getRequest(request.id); if (controller.signal.aborted || active.state !== 'planning') return;
        validate('before-response');
        // Never retain a rejected provider body from a request whose reviewed scope has changed.
        check(digest(this.contextIdentity()) === digest(completionContext?.navigation??navigation), 'stale_context_scope');
        // This transaction fences the actual canonical message/plan and request together after inference.
        const currentScope = this.scope();
        check(currentScope.policyVersion === scope.policyVersion && currentScope.principalId === scope.principalId, 'stale_policy_version');
        const responseContext=completionContext?.context??active.context;
        for (const ref of responseContext.included) check(this.resolve(ref.id, ref.kind, currentScope).version === ref.version, 'stale_context_version');
        let parsed;
        try { parsed = validateProviderResult(proposal, planner.providerId); }
        catch (e) {
          active.state = 'invalid-plan'; active.errorCode = errorCode(e, 'invalid_provider_proposal'); active.updatedAt = this.now();
          active.invalidProposal = preserveProposal(proposal);
          this.append('The provider response could not be used. No actions were run. The rejected output is retained for inspection.', active.id, 'vela-native');
          return;
        }
        if (parsed.kind === 'plan') {
          retainInvalidProposal = true;
          const plan = this.prepare(active, parsed.summary, parsed.steps, parsed.contribution);
          if (plan.steps.length === 1 && isImmediateNativeAction(plan.steps[0].action.type)) {
            plan.authorizationRef = this.authorize(this.authInput(plan, 'review'));
            plan.reviewedAt = this.now();
            plan.state = 'approved';
            return plan.id;
          } else {
            this.append('Proposed plan from ' + planner.providerId + ': ' + parsed.summary + '\nReview the typed actions before applying them.', active.id, 'provider', plan);
          }
        } else {
          for (const ref of responseContext.discovered) check(this.resolve(ref.id, ref.kind, currentScope).version === ref.version, 'stale_context_version');
          for (const entry of responseContext.included) {
            const content = this.opts.host.readContent(entry.id, currentScope);
            check(content, 'context_content_unavailable');
            check(content.ref.id === entry.id && content.ref.kind === entry.kind && content.ref.version === entry.version && content.source === entry.source && digest(content.content) === entry.contentDigest, 'stale_context_version');
          }
          const message = this.append(parsed.content, active.id, 'provider', undefined, parsed);
          check(identifier(message.id) && message.content === parsed.content && message.source === 'provider' && message.providerId === parsed.contribution.providerId && message.classification === 'reported', 'invalid_canonical_response');
          active.response = { kind: parsed.kind, messageId: message.id, contentDigest: historyDigest(parsed.content) }; active.state = 'responded'; active.updatedAt = this.now();
        }
      });
    } catch (e) {
      if (this.getRequest(request.id).state === 'cancelled') return structuredClone(this.getRequest(request.id));
      this.atomic(() => { const r = this.getRequest(request.id); r.state = e instanceof VelaError && e.outcome === 'unknown' ? 'unknown' : providerOutputReceived ? 'invalid-plan' : 'failed'; r.errorCode = errorCode(e, 'planning_failed');
        if (retainInvalidProposal) r.invalidProposal = preserveProposal(providerOutput);
        r.updatedAt = this.now(); this.append('The request could not produce a usable response (' + r.errorCode + '). ' +
          (routed?.route?.kind === 'agentic' || routed?.route?.kind === 'composite' ? 'Review Codex activity before retrying.' : 'No proposed actions were run.'), r.id, 'vela-native'); });
    } finally { this.controllers.delete(request.id); }
    if (localReadPlanId) await this.apply(localReadPlanId);
    return structuredClone(this.getRequest(request.id));
  }
  /** Explicit typed local action: host policy authorizes it, with no model call or redundant review. */
  clockTimerJournalContext(): { lastResourceId: string | null; lastTimer: {resourceId:string;timerId:string} | null } {
    // Trusted host-only reference projection of the existing canonical receipts.
    // The caller must resolve these IDs against current access; stale refs must clarify.
    const receipts=this.data.receipts.filter(receipt=>receipt.state==='applied'&&receipt.clockTimer?.resourceId).map(receipt=>receipt.clockTimer!);
    const last=receipts.at(-1),timer=receipts.findLast(receipt=>receipt.timerId!==null);
    return {lastResourceId:last?.resourceId??null,lastTimer:timer?.resourceId&&timer.timerId?{resourceId:timer.resourceId,timerId:timer.timerId}:null};
  }
  nativeClarification(intent: string, content: string): VelaRequest {
    return this.nativeResponse(intent,content,'clarification');
  }
  /** Canonical, observed native answer; receives no provider authority or raw location. */
  nativeResponse(intent:string,content:string,kind:import('./contracts.ts').ProviderReplyKind,observation?:VelaRequest['nativeObservation']):VelaRequest {
    check(text(intent,16000)&&text(content,2000),'invalid_timer_clarification');const scope=this.scope();
    check(['answer','clarification','inability'].includes(kind),'invalid_native_response');
    if(observation)check(observation.kind==='local-weather'&&observation.source==='National Weather Service'&&observation.sharedPrecision==='0.01-degree'&&Number.isFinite(Date.parse(observation.locationObservedAt)),'invalid_weather_observation');
    return this.atomic(()=>{
      const time=this.now(),request:VelaRequest={id:randomUUID(),conversationId:this.conversationId(),intent,state:'responded',createdAt:time,updatedAt:time,
        providerId:null,nativeResponse:{schemaVersion:1,classification:'observed'},origin:this.historyOrigin(scope),inputContentDigest:digest(intent),context:this.context([],scope),...(observation?{nativeObservation:structuredClone(observation)}:{})};
      const user=this.append(intent,request.id,'user');request.inputMessageId=user.id;
      const response=this.append(content,request.id,'vela-native',undefined,{kind});
      request.response={kind,messageId:response.id,contentDigest:digest(content)};this.data.requests.push(request);return structuredClone(request);
    });
  }
  /** Host-only result for an already observed native proposal. Never creates another user utterance. */
  nativeProposalResult(requestId:string,content:string,kind:import('./contracts.ts').ProviderReplyKind):VelaRequest {
    check(identifier(requestId)&&text(content,2000)&&['answer','clarification','inability'].includes(kind),'invalid_native_response');
    return this.atomic(()=>{const request=this.data.requests.find(value=>value.id===requestId),origin=this.historyOrigin();
      check(request?.nativeResponse?.classification==='observed'&&request.providerId===null&&!request.planId&&
        request.conversationId===this.data.conversationId&&JSON.stringify(request.origin)===JSON.stringify(origin),'native_proposal_request_unavailable');
      const response=this.append(content,request.id,'vela-native',undefined,{kind});request.response={kind,messageId:response.id,contentDigest:digest(content)};
      request.state='responded';request.updatedAt=this.now();return structuredClone(request);});
  }
  /** Only an applied, current-scope search can supply a subsequent native attachment's IDs. */
  nativeSearchSelection():{receiptId:string;resources:ResourceRef[]}|null{
    return this.read(()=>{const scope=this.scope(),request=this.data.requests.at(-1);if(!request||request.state!=='completed'||JSON.stringify(request.origin)!==JSON.stringify(this.historyOrigin(scope)))return null;
      const plan=this.data.plans.find(plan=>plan.id===request.planId);if(!plan||plan.state!=='applied')return null;
      const receipts=this.data.receipts.filter(receipt=>receipt.planId===plan.id&&receipt.state==='applied'&&plan.steps.some(step=>step.id===receipt.stepId&&step.action.type==='search'));
      if(receipts.length!==1||!receipts[0].foundSubjects?.length)return null;
      const resources:ResourceRef[]=[];for(const saved of receipts[0].foundSubjects){if(saved.kind!=='resource'||!Number.isSafeInteger(saved.version))return null;
        const current=this.opts.host.resolve(saved,scope);if(!current||current.version!==saved.version||!this.permitted(current.id,current.kind,scope))return null;resources.push(structuredClone(current));}
      return {receiptId:receipts[0].id,resources};});
  }
  nativeAttachmentResult(intent:string,receipt:NonNullable<VelaRequest['nativeAttachment']>):VelaRequest{
    return this.atomic(()=>{check(receipt.verified&&receipt.resources.length>0&&receipt.addedCount+receipt.existingCount===receipt.resources.length,'invalid_native_attachment_receipt');
      const content=receipt.resources.length+' selected source'+(receipt.resources.length===1?' is':'s are')+' now in this workspace.';
      const request=this.nativeResponse(intent,content,'answer'),stored=this.getRequest(request.id);stored.nativeAttachment=structuredClone(receipt);stored.context.discovered.push(...structuredClone(receipt.resources));return structuredClone(stored);});
  }
  nativeSourceResponse(intent:string,content:string,ref:ResourceRef,observation:NonNullable<VelaRequest['nativeSourceObservation']>):VelaRequest{
    return this.atomic(()=>{check(observation.kind==='folder-metadata'&&ref.kind==='resource'&&ref.resourceKind==='folder'&&observation.resourceId===ref.id&&observation.version===ref.version&&this.opts.host.validateNativeSourceObservation?.(observation,this.scope())===true,'native_source_observation_unavailable');
      const request=this.nativeResponse(intent,content,'answer'),stored=this.getRequest(request.id);stored.context.discovered.push(structuredClone(ref));stored.nativeSourceObservation=structuredClone(observation);
      stored.provenance=createHistoryProvenance({requestId:stored.id,conversationId:stored.conversationId,origin:stored.origin!,inputMessageId:stored.inputMessageId!,inputContentDigest:stored.inputContentDigest!,dependencies:historyDependenciesFromContext(stored.context,stored.conversationId)});return structuredClone(stored);});
  }
  creationRecoveryReference(receiptId?:string):{receiptId:string;workspaceId:string;projectId:string|null}|null {
    let receipt=receiptId?this.data.receipts.find(receipt=>receipt.id===receiptId):this.data.receipts.at(-1);
    if(!receipt||receipt.state!=='applied')return null;
    if(!receiptId&&receipt.workspaceRecovery) {
      const action=this.data.plans.find(plan=>plan.id===receipt!.planId)?.steps.find(step=>step.id===receipt!.stepId)?.action;
      if(action?.type!=='recoverCreation')return null;receipt=this.data.receipts.find(receipt=>receipt.id===action.receiptId);
    }
    const proof=receipt?.workspaceConstruction,plan=receipt&&this.data.plans.find(plan=>plan.id===receipt.planId);
    if(!receipt||receipt.state!=='applied'||!proof||receipt.createdWorkspaceId!==proof.workspaceId||plan?.steps.length!==1||
      !proof.verification.workspaceExists||!proof.verification.bindingsMatch||!proof.verification.geometryValid)return null;
    return {receiptId:receipt.id,workspaceId:proof.workspaceId,projectId:proof.projectId};
  }
  /** Host-only typed proposal on the existing canonical user request. */
  prepareToolAction(requestId:string,action:VelaNativeAction,summary:string):VelaPlan {
    return this.prepareToolActions(requestId,[action],summary);
  }
  prepareToolActions(requestId:string,actions:unknown[],summary:string):VelaPlan {
    check(Array.isArray(actions)&&actions.length>0&&actions.length<=6&&text(summary,1000),'invalid_vela_tool_actions');const parsed=actions.map(validateAction);
    return this.atomic(()=>{const request=this.getRequest(requestId);check(request.providerId==='openai-api-vela'&&request.state==='planning','vela_tool_request_unavailable');
      check(!request.planId||this.getPlan(request.planId).state!=='prepared','vela_tool_review_pending');
      const phase=request.state,plan=this.prepare(request,summary,parsed.map((action,index)=>({id:'tool-'+(index+1),explanation:'Typed source-owned capability proposal',action})),null);request.state=phase;return structuredClone(plan);});
  }
  /** Existing standing host policy, not a model-supplied permission or native approval. */
  canExecuteToolActions(actions:unknown[]):boolean {
    try{return actions.length>0&&actions.length<=6&&actions.map(validateAction).every(action=>{
      const descriptor=CAPABILITIES.find(c=>c.id===action.type);return descriptor?.authorization==='host-policy'&&descriptor.effect!=='provider-execution'&&!(action.type==='clockTimer'&&clockTimerRequiresReview(action));
    });}catch{return false;}
  }
  async executeToolActions(requestId:string,actions:unknown[],summary:string):Promise<VelaPlan> {
    check(this.canExecuteToolActions(actions),'vela_tool_action_review_required');const plan=this.prepareToolActions(requestId,actions,summary);
    this.review({planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'});const result=await this.apply(plan.id);
    if(result.state==='applied')this.atomic(()=>{const request=this.getRequest(requestId);request.state='planning';request.updatedAt=this.now();});return result;
  }
  checkpointToolRequest(requestId:string,workflowId:string,phase:import('../../application-contract/vela-tools.ts').VelaWorkflowPhase,reason?:string):void {
    this.atomic(()=>{const r=this.getRequest(requestId);check(r.providerId==='openai-api-vela'&&(!r.toolWorkflow||r.toolWorkflow.id===workflowId),'vela_tool_request_unavailable');
      if(['cancelled','completed','responded'].includes(r.state)||r.state==='unknown'&&r.response&&r.toolWorkflow?.phase==='unknown')return;
      r.toolWorkflow={id:workflowId,phase,...(reason?{reason}:{})};
      if(['blocked','budget-exhausted','clarification','unknown'].includes(phase)){
        const kind=phase==='clarification'?'clarification':'inability';
        const content=phase==='unknown'?'I couldn’t confirm how the last step ended. Review the recorded results before trying again; I won’t repeat it automatically.':
          phase==='budget-exhausted'?'This request reached its current limit. Review the recorded results before continuing.':
          phase==='clarification'?'I need more detail to continue this request. Review the recorded results and clarify what you need next.':
          'I couldn’t continue this request. Review the recorded results and connection details before trying again.';
        const message=this.append(content,r.id,'vela-native',undefined,{kind});
        r.response={kind,messageId:message.id,contentDigest:historyDigest(content)};
        r.errorCode=typeof reason==='string'&&/^[a-z][a-z0-9_]{0,119}$/u.test(reason)?reason:'vela_tool_'+phase.replaceAll('-','_');
        r.state=phase==='unknown'?'unknown':'responded';r.updatedAt=this.now();return;
      }
      if(phase==='awaiting-review'||phase==='waiting-job'){r.state=phase==='awaiting-review'?'awaiting-review':'native-ready';r.updatedAt=this.now();}});
  }
  async resumeToolRequest(requestId:string,work:()=>Promise<unknown>):Promise<VelaRequest> {
    const request=this.getRequest(requestId);check(request.providerId==='openai-api-vela'&&['awaiting-review','native-ready'].includes(request.state)&&request.toolWorkflow&&['awaiting-review','waiting-job','budget-exhausted','partial'].includes(request.toolWorkflow.phase),'vela_tool_resume_unavailable');
    this.atomic(()=>{request.state='planning';request.updatedAt=this.now();});
    try{const output=await work();if(this.getRequest(requestId).state!=='planning')return structuredClone(this.getRequest(requestId));
      return this.atomic(()=>{const parsed=validateProviderResult(output,'openai-api-vela');check(parsed.kind!=='plan','vela_tool_resume_plan_unavailable');const message=this.append(parsed.content,requestId,'provider',undefined,parsed);request.response={kind:parsed.kind,messageId:message.id,contentDigest:historyDigest(parsed.content)};request.state='responded';request.updatedAt=this.now();return structuredClone(request);});
    }catch(error){if(this.getRequest(requestId).state!=='planning')return structuredClone(this.getRequest(requestId));this.atomic(()=>{request.state=error instanceof VelaError&&error.outcome==='unknown'?'unknown':'failed';request.errorCode=errorCode(error,'vela_tool_resume_failed');request.updatedAt=this.now();});return structuredClone(request);}
  }
  native(input: { intent: string; action: VelaNativeAction }): VelaPlan {
    check(text(input.intent, 16000), 'invalid_request'); const action = validateAction(input.action);
    check(action.type !== 'delegateTask', 'explicit_execution_authorization_required');
    const scope = this.scope();
    return this.atomic(() => {
      const r: VelaRequest = { id: randomUUID(), conversationId: this.conversationId(), intent: input.intent, state: 'native-ready',
        createdAt: this.now(), updatedAt: this.now(), providerId: null, origin: this.historyOrigin(scope), inputContentDigest: historyDigest(input.intent), context: this.context([], scope) };
      this.data.requests.push(r); r.inputMessageId=this.append(r.intent, r.id, 'user').id;
      const plan = this.prepare(r, input.intent, [{ id: 'native-1', explanation: 'Explicit native application command', action }], null);
      if (CAPABILITIES.find(capability => capability.id === action.type)?.authorization === 'reviewed-action'||action.type==='clockTimer'&&clockTimerRequiresReview(action)) return structuredClone(plan);
      plan.authorizationRef = this.authorize(this.authInput(plan, 'review')); plan.reviewedAt = this.now(); plan.state = 'approved';
      return structuredClone(plan);
    });
  }
  private validatePlan(plan: VelaPlan) {
    const scope = this.scope(plan.steps);
    check(scope.principalId === plan.scope.principalId && scope.policyVersion === plan.scope.policyVersion, 'stale_policy_version');
    check(Date.parse(plan.expiresAt) > Date.parse(this.now()), 'plan_expired');
    const body = { requestId: plan.requestId, version: plan.version, summary: plan.summary, steps: plan.steps, targets: plan.targets, scope: plan.scope, contribution: plan.contribution };
    check(digest(body) === plan.fingerprint, 'plan_fingerprint_mismatch');
    for(const step of plan.steps)if(step.action.type==='setAttentionMode'){const version=this.attentionPreferenceVersion();check(version!==null,'attention_preferences_unavailable');check(version===step.action.expectedVersion,'stale_preference_version');}
    const restoring=new Set(this.restores(plan.steps));
    for (const ref of plan.targets) check(this.resolve(ref.id, ref.kind, scope,ref.kind==='collection'&&restoring.has(ref.id)).version === ref.version, 'stale_target_version');
    for (const ref of this.getRequest(plan.requestId).context.included) check(this.resolve(ref.id, ref.kind, scope).version === ref.version, 'stale_context_version');
  }
  review(input: { planId: string; fingerprint: string; decision: 'approve' | 'reject' }): VelaPlan {
    check(['approve', 'reject'].includes(input.decision), 'invalid_review_decision');
    return this.atomic(() => {
      const plan = this.getPlan(input.planId); check(plan.state === 'prepared', 'plan_not_reviewable');
      check(plan.fingerprint === input.fingerprint, 'review_fingerprint_mismatch');
      if (input.decision === 'reject') { plan.state = 'rejected'; plan.reviewedAt = this.now();this.opts.onPlanRejected?.(structuredClone(plan));return structuredClone(plan); }
      this.validatePlan(plan);
      plan.authorizationRef = this.authorize(this.authInput(plan, 'review')); plan.reviewedAt = this.now(); plan.state = 'approved';
      return structuredClone(plan);
    });
  }
  async apply(planId: string): Promise<VelaPlan> {
    let plan = this.getPlan(planId);
    if (plan.state === 'applied') return structuredClone(plan);
    check(plan.state === 'approved' && identifier(plan.authorizationRef), 'review_authorization_required');
    this.validatePlan(plan);
    const authorizationRef = this.authorize(this.authInput(plan, 'apply', plan.authorizationRef));
    let request = this.getRequest(plan.requestId);
    let explicitResponse = false;
    this.atomic(() => { plan.state = 'applying'; });
    for (const step of plan.steps) {
      if (this.getPlan(planId).state !== 'applying') break;
      let receipt: StoredActionReceipt = { id: randomUUID(), planId, requestId: plan.requestId, stepId: step.id,
        commandId: 'vela:' + planId + ':' + step.id, source: 'vela', providerId: step.action.type === 'delegateTask' ? step.action.providerId : null,
        state: 'started', startedAt: this.now(), taskVerified: false };
      this.atomic(() => { this.data.receipts.push(receipt); });
      let result: HostActionResult;
      let dispatched = false;
      let timerReceiptCommitted = false;
      try {
        // Targets/permissions are checked again at every boundary, including between steps.
        const scope = this.scope([step]);
        check(scope.policyVersion === plan.scope.policyVersion, 'stale_policy_version');
        const targets = this.targets([step], scope);
        for (const ref of targets) check(plan.targets.some(p => p.id === ref.id && p.kind === ref.kind && p.version === ref.version), 'stale_target_version');
        if (step.action.type === 'delegateTask') {
          check(this.data.preferences.delegationEnabled && this.opts.host.delegateTask, 'delegation_disabled');
          const executionAuthorization = this.authorize({ ...this.authInput(plan, 'delegate', authorizationRef), actions: [step.action], providerId: step.action.providerId });
          const resourceIds = step.action.resourceIds;
          const context = structuredClone(request.context);
          context.discovered = context.discovered.filter(ref => resourceIds.includes(ref.id));
          context.included = context.included.filter(ref => resourceIds.includes(ref.id));
          context.omitted = context.omitted.filter(ref => resourceIds.includes(ref.id));
          context.contentBytes = context.included.reduce((sum, entry) => sum + byteLength(entry.content), 0);
          dispatched = true;
          result = await this.opts.host.delegateTask({ action: step.action, commandId: receipt.commandId, requestId: request.id,
            planId, initiatingIntent: request.intent, sourceConversationId: request.conversationId,
            context, authorizationRef: executionAuthorization });
        } else {
          // The host must atomically validate expectedVersions, authorizationRef and commandId with canonical writes.
          const input = { action: structuredClone(step.action) as VelaNativeAction, commandId: receipt.commandId,
            requestId: request.id, planId, intent: request.intent, expectedVersions: targets, authorizationRef };
          const controller = new AbortController();
          const preparation = this.opts.host.prepareNative?.(input, controller.signal);
          if (preparation) {
            this.controllers.set(request.id, controller);
            try {
              const commit = await preparation;
              check(!controller.signal.aborted && this.getPlan(planId).state === 'applying', 'native_preparation_cancelled');
              check(Date.parse(plan.expiresAt) > Date.parse(this.now()), 'plan_expired');
              check(this.scope([step]).policyVersion === plan.scope.policyVersion, 'stale_policy_version');
              dispatched = true;
              if(['clockTimer','adjustWorkspace','recoverCreation'].includes(step.action.type)) {
                result=this.atomic(()=>{
                  const value=commit();check(value&&['applied','failed','cancelled','unknown'].includes(value.status)&&identifier(value.receiptId),'invalid_host_receipt');
                  if(step.action.type==='clockTimer')check(value.status!=='applied'||value.clockTimer?.contract==='aerynth.vela-clock-timer@1','canonical_timer_receipt_required');
                  if(step.action.type==='adjustWorkspace')check(value.status!=='applied'||value.workspaceAdjustment?.verification.oneUndoEntry===true,'canonical_adjustment_receipt_required');
                  if(step.action.type==='recoverCreation')check(value.status!=='applied'||value.workspaceRecovery?.kind==='receipt','canonical_recovery_receipt_required');
                  receipt.state=value.status;receipt.endedAt=this.now();receipt.hostReceiptId=value.receiptId;
                  if(value.clockTimer)receipt.clockTimer=structuredClone(value.clockTimer);
                  if(value.workspaceAdjustment)receipt.workspaceAdjustment=structuredClone(value.workspaceAdjustment);
                  if(value.workspaceRecovery)receipt.workspaceRecovery=structuredClone(value.workspaceRecovery);
                  if(value.createdResourceId)receipt.createdResourceId=value.createdResourceId;
                  if(value.errorCode)receipt.errorCode=value.errorCode;
                  if(text(value.responseText,1000)){this.append(value.responseText,request.id,'vela-native',plan);explicitResponse=true;}
                  if(value.status!=='applied'){plan.state=value.status;request.state=value.status;request.errorCode=value.errorCode;}
                  return value;
                });timerReceiptCommitted=true;
              } else result = commit();
            } finally { this.controllers.delete(request.id); }
          } else {
            dispatched = true;
            const dispatch = () => this.opts.host.applyNative(input);
            result = step.action.type==='setAttentionMode' ? this.atomic(dispatch) : dispatch();
          }
        }
        check(result && ['applied', 'failed', 'cancelled', 'unknown'].includes(result.status) && identifier(result.receiptId), 'invalid_host_receipt');
      } catch (e) {
        if(['setAttentionMode','clockTimer','adjustWorkspace','recoverCreation'].includes(step.action.type)) {
          // Mode mutation uses this SAME service inside the host transaction. Its
          // rollback restores a clone; reconnect local references to canonical IDs.
          plan=this.getPlan(planId);request=this.getRequest(plan.requestId);
          const restored=this.data.receipts.find(value=>value.id===receipt.id);check(restored,'canonical_receipt_missing');receipt=restored;
        }
        // An adapter can throw after side effects. Never turn that uncertainty into a safe-to-retry failure.
        const cancelled = !dispatched && this.getPlan(planId).state !== 'applying';
        result = { status: dispatched ? 'unknown' : cancelled ? 'cancelled' : 'failed', receiptId: receipt.id, errorCode: errorCode(e, dispatched ? 'host_action_outcome_unknown' : 'action_validation_failed') };
      }
      if(timerReceiptCommitted)continue;
      this.atomic(() => {
        receipt.state = result.status; receipt.endedAt = this.now(); receipt.hostReceiptId = result.receiptId;
        if (result.errorCode) receipt.errorCode = result.errorCode;
        if (result.createdResourceId) receipt.createdResourceId = result.createdResourceId;
        if (result.createdWorkspaceId) receipt.createdWorkspaceId = result.createdWorkspaceId;
        if (result.workspaceConstruction) receipt.workspaceConstruction = structuredClone(result.workspaceConstruction);
        if (result.clockTimer) receipt.clockTimer = structuredClone(result.clockTimer);
        if (result.workspaceAdjustment) receipt.workspaceAdjustment = structuredClone(result.workspaceAdjustment);
        if (result.workspaceRecovery) receipt.workspaceRecovery = structuredClone(result.workspaceRecovery);
        if (result.createdProjectId) receipt.createdProjectId = result.createdProjectId;
        if (result.createdCollectionId) receipt.createdCollectionId = result.createdCollectionId;
        if ((step.action.type === 'search' || step.action.type === 'openResource') && result.status === 'applied' && result.foundSubjects) {
          receipt.foundSubjects = result.foundSubjects.slice(0, 12).map(({ id, kind }) => {const current=this.opts.host.resolve({id,kind},this.scope());return {id,kind,...(current?{version:current.version}:{})};});
          if (step.action.type === 'openResource' && receipt.foundSubjects.length === 1 && receipt.foundSubjects[0].kind === 'resource')
            receipt.openResourceId = receipt.foundSubjects[0].id;
        }
        if (text(result.responseText, 1000)) {
          this.append(result.responseText, request.id, 'vela-native', plan);
          explicitResponse = true;
        }
        if (result.status !== 'applied') { plan.state = result.status; request.state = result.status === 'failed' ? 'failed' : result.status; request.errorCode = result.errorCode; }
      });
    }
    this.atomic(() => {
      if (plan.state === 'applying') { plan.state = 'applied'; request.state = 'completed'; }
      request.updatedAt = this.now();
      if (!explicitResponse || plan.steps.length !== 1) {
        const action = plan.steps.length === 1 ? plan.steps[0].action : undefined;
        let applied = plan.steps.some(step => step.action.type === 'delegateTask')
          ? 'Started the delegated work. Its result still needs verification.'
          : `Completed ${plan.steps.length} action${plan.steps.length === 1 ? '' : 's'}.`;
        if (action?.type === 'navigate') applied = 'Opened the requested view.';
        else if (action?.type === 'openResource') applied = 'The resource lookup is complete.';
        else if (action && isHostPolicyRead(action.type)) applied = 'The local lookup is complete.';
        else if (action && ['createProject', 'createResource', 'createWorkspace', 'createConversation', 'createCollection'].includes(action.type) && 'title' in action)
          applied = `Created “${action.title}”.`;
        else if (action?.type === 'workspaceFromResources') applied = `Created “${action.title}” with ${action.resourceIds.length} resource${action.resourceIds.length === 1 ? '' : 's'}.`;
        this.append(plan.state === 'applied' ? applied : 'Plan execution stopped with state: ' + plan.state + '. Inspect receipts before retrying.', request.id, 'vela-native', plan);
      }
    });
    return structuredClone(plan);
  }
  cancel(requestId: string): VelaRequest {
    const request = this.getRequest(requestId), plan = request.planId ? this.getPlan(request.planId) : undefined;
    check(request.state !== 'checking', 'vela_project_check_wait_for_result');
    check(request.state !== 'completed' && request.state !== 'responded', 'completed_request_not_cancellable');
    this.atomic(() => {
      if (plan?.state === 'applying') {
        plan.state = 'unknown'; request.state = 'unknown'; request.errorCode = 'cancellation_requested_outcome_unknown';
      } else { request.state = 'cancelled'; if (plan && ['prepared', 'approved'].includes(plan.state)) plan.state = 'cancelled'; }
      request.updatedAt = this.now();
    });
    this.controllers.get(requestId)?.abort(); return structuredClone(request);
  }
  /** Trusted non-RPC scalar. Never clones state/history or materializes source bodies. */
  attentionPreferenceVersion():number|null {
    return this.read(()=>{
      const scope=this.scope();if(this.opts.host.canReadAttentionPreferences?.(scope)!==true)return null;
      // SQLite projects one scalar from the existing canonical row. A competing
      // service cannot leave an old in-memory version advertised as current.
      let version:unknown;try{version=this.opts.db.prepare("SELECT json_extract(json,'$.preferences.version') AS version FROM vela_state WHERE id=1").get()?.version;}catch{return null;}
      return Number.isSafeInteger(version)&&Number(version)>=1&&Number(version)<Number.MAX_SAFE_INTEGER&&version===this.data.preferences.version?Number(version):null;
    });
  }
  preferences(input: { expectedVersion: number; patch: Partial<Omit<AttentionPreferences, 'version' | 'source' | 'updatedAt' | 'learning'>> }): AttentionPreferences {
    check(isRecord(input.patch) && Object.keys(input.patch).every(k => ['mode', 'monitoringEnabled', 'delegationEnabled', 'allowedEventTypes', 'minimumSeverity', 'maxInterruptionsPerHour'].includes(k)), 'invalid_preferences');
    return this.atomic(() => {
      const previous = this.data.preferences; check(previous.version === input.expectedVersion, 'stale_preference_version');
      const next = { ...previous, ...input.patch, version: previous.version + 1, source: 'explicit' as const, updatedAt: this.now(), learning: 'disabled' as const };
      check(['normal', 'quiet', 'focused', 'collaborative', 'proactive'].includes(next.mode) && typeof next.monitoringEnabled === 'boolean' && typeof next.delegationEnabled === 'boolean', 'invalid_preferences');
      check(Array.isArray(next.allowedEventTypes) && next.allowedEventTypes.length <= 100 && next.allowedEventTypes.every(identifier) && new Set(next.allowedEventTypes).size === next.allowedEventTypes.length, 'invalid_preferences');
      check(['info', 'warning', 'critical'].includes(next.minimumSeverity) && Number.isInteger(next.maxInterruptionsPerHour) && next.maxInterruptionsPerHour >= 0 && next.maxInterruptionsPerHour <= 60, 'invalid_preferences');
      this.data.preferences = next; return structuredClone(next);
    });
  }
  /** Host event bus only. No screen, OS activity, microphone, external polling, or provider calls. */
  ingestAttention(event: AppAttentionEvent): AttentionItem | null {
    check(isRecord(event) && identifier(event.id) && identifier(event.type) && identifier(event.source) && text(event.summary, 2000) && identifier(event.correlationId) && Number.isFinite(Date.parse(event.occurredAt)) && ['info', 'warning', 'critical'].includes(event.severity) && ['observed', 'reported', 'inferred', 'unknown'].includes(event.classification), 'invalid_attention_event');
    const preferences = this.data.preferences;
    if (!preferences.monitoringEnabled || !preferences.allowedEventTypes.includes(event.type)) return null;
    const scope = this.scope(); if (event.subject) this.resolve(event.subject.id, event.subject.kind, scope);
    const existing = this.data.attention.find(i => i.id === event.id);
    if (existing) { check(digest({ ...existing, receivedAt: undefined, disposition: undefined, reason: undefined, reviewedAt: undefined, dismissedAt: undefined }) === digest(event), 'attention_idempotency_conflict'); return structuredClone(existing); }
    let disposition: AttentionItem['disposition'] = 'digest', reason = 'Retained for explicit review';
    if (preferences.mode === 'quiet') { disposition = 'silent'; reason = 'Quiet mode permits silence'; }
    else if (preferences.mode === 'focused') reason = 'Focused mode defers interruptions';
    else if (severityRank[event.severity] >= severityRank[preferences.minimumSeverity]) {
      const hourAgo = Date.parse(this.now()) - 3600000;
      const budgetUsed = this.data.attention.filter(i => i.disposition === 'interrupt' && Date.parse(i.receivedAt) > hourAgo).length;
      if (budgetUsed < preferences.maxInterruptionsPerHour) { disposition = 'interrupt'; reason = 'Authorized application event meets the configured severity and attention budget'; }
      else reason = 'Hourly attention budget reached';
    }
    const item: AttentionItem = { ...structuredClone(event), receivedAt: this.now(), disposition, reason, reviewedAt: null, dismissedAt: null };
    this.atomic(() => this.data.attention.push(item)); return structuredClone(item);
  }
  reviewAttention(ids: string[], disposition: 'reviewed' | 'dismissed' = 'reviewed'): void {
    check(Array.isArray(ids) && ids.length <= 500 && ids.every(identifier) && ['reviewed', 'dismissed'].includes(disposition), 'invalid_attention_review');
    const visible = new Set(this.state().attention.map(i => i.id));
    this.atomic(() => { for (const id of ids) { check(visible.has(id), 'attention_not_authorized'); const item = this.data.attention.find(i => i.id === id)!; if (disposition === 'reviewed') item.reviewedAt = this.now(); else item.dismissedAt = this.now(); } });
  }
  private preferenceScope(scope: PreferenceScope) {
    check(isRecord(scope) && ((scope.kind === 'global' && scope.id === null) || (scope.kind === 'workspace' && identifier(scope.id))), 'invalid_preference_scope');
    return scope.kind === 'workspace' ? [this.resolve(scope.id!, 'workspace', this.scope())] : [];
  }
  private visibleAdaptation(scope: VelaScope): AdaptationState {
    const data = structuredClone(this.data.adaptation);
    const visible = (s: PreferenceScope) => s.kind === 'global' || (scope.workspaceIds.includes(s.id!) && !!this.opts.host.resolve({ id: s.id!, kind: 'workspace' }, scope));
    data.hypotheses = data.hypotheses.filter(h => visible(h.scope));
    data.explicit = data.explicit.filter(h => visible(h.scope));
    data.suppressions = data.suppressions.filter(h => visible(h.scope));
    data.receipts = data.receipts.filter(h => visible(h.scope));
    return data;
  }
  adaptationPolicy(input: { expectedVersion: number; enabled: boolean; categories: AdaptationPolicy['categories'] }): AdaptationPolicy {
    check(typeof input.enabled === 'boolean' && isRecord(input.categories) && Object.keys(input.categories).sort().join(',') === 'organization,presentation', 'invalid_adaptation_policy');
    for (const category of Object.values(input.categories)) check(isRecord(category) && Object.keys(category).sort().join(',') === 'enabled,level' && typeof category.enabled === 'boolean' && ['manual', 'suggestive', 'assisted', 'adaptive'].includes(category.level), 'invalid_adaptation_policy');
    return this.atomic(() => {
      check(this.data.adaptation.policy.version === input.expectedVersion, 'stale_adaptation_policy_version');
      this.data.adaptation.policy = { version: input.expectedVersion + 1, enabled: input.enabled, categories: structuredClone(input.categories), updatedAt: this.now() };
      return structuredClone(this.data.adaptation.policy);
    });
  }
  /** Host app-event adapter only; never exposed as a renderer-generated behavioral observation. */
  observePreference(input: { key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; eventId: string }): PreferenceHypothesis | null {
    validatePreference(input.key, input.value, input.scope); this.preferenceScope(input.scope);
    const category = this.data.adaptation.policy.categories[preferenceCategory(input.key)];
    if (!this.data.adaptation.policy.enabled || !category.enabled || category.level === 'manual') return null;
    const event = this.data.attention.find(e => e.id === input.eventId); check(event, 'preference_evidence_unavailable');
    const hypothesis = this.atomic(() => observePreference(this.data.adaptation, { ...input, event }, randomUUID()));
    if (!hypothesis) return null;
    const explicit = effectivePreference(this.data.adaptation, input.key, input.scope);
    if (category.level === 'adaptive' && hypothesis.state === 'suggested' && hypothesis.evidence.length >= 3 && explicit?.source !== 'explicit') {
      this.applyPreferenceValue({ key: hypothesis.key, value: hypothesis.value, scope: hypothesis.scope, hypothesisId: hypothesis.id, origin: 'authorized-adaptation' });
    }
    return structuredClone(this.data.adaptation.hypotheses.find(h => h.id === hypothesis.id)!);
  }
  effectivePreference(key: PreferenceKey, scope: PreferenceScope) {
    this.preferenceScope(scope); return structuredClone(effectivePreference(this.data.adaptation, key, scope));
  }
  explicitPreference(input: { key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; expectedVersion: number; apply: boolean }): ExplicitPreference {
    check(typeof input.apply === 'boolean', 'invalid_preference_application'); this.preferenceScope(input.scope);
    const preference = this.atomic(() => structuredClone(setExplicitPreference(this.data.adaptation, input, randomUUID(), this.now())));
    if (input.apply) this.applyPreferenceValue({ ...input, origin: 'explicit-user' });
    return preference;
  }
  reviewPreference(input: { hypothesisId: string; decision: 'accept' | 'reject' | 'suppress'; apply: boolean }): PreferenceHypothesis {
    check(['accept', 'reject', 'suppress'].includes(input.decision) && typeof input.apply === 'boolean', 'invalid_preference_review');
    const hypothesis = this.data.adaptation.hypotheses.find(h => h.id === input.hypothesisId); check(hypothesis, 'preference_hypothesis_not_found');
    this.preferenceScope(hypothesis.scope); check(hypothesis.state === 'suggested', 'preference_not_reviewable');
    this.atomic(() => {
      hypothesis.reviewedAt = this.now();
      if (input.decision === 'accept') {
        const previous = this.data.adaptation.explicit.find(p => p.key === hypothesis.key && samePreferenceScope(p.scope, hypothesis.scope));
        setExplicitPreference(this.data.adaptation, { ...hypothesis, expectedVersion: previous?.version ?? 0 }, randomUUID(), this.now());
        hypothesis.state = 'accepted';
      } else {
        hypothesis.state = input.decision === 'suppress' ? 'suppressed' : 'rejected';
        // Rejection suppresses the same value/evidence pattern until an explicit reset permits it again.
        this.data.adaptation.suppressions.push({ key: hypothesis.key, value: hypothesis.value, scope: structuredClone(hypothesis.scope), createdAt: this.now() });
      }
    });
    if (input.decision === 'accept' && input.apply) this.applyPreferenceValue({ key: hypothesis.key, value: hypothesis.value, scope: hypothesis.scope, hypothesisId: hypothesis.id, origin: 'explicit-user' });
    return structuredClone(this.data.adaptation.hypotheses.find(h => h.id === hypothesis.id)!);
  }
  resetPreferences(input: { scope: PreferenceScope; clearSuppressions: boolean }): void {
    this.preferenceScope(input.scope); check(typeof input.clearSuppressions === 'boolean', 'invalid_preference_reset');
    this.atomic(() => {
      for (const preference of this.data.adaptation.explicit) if (samePreferenceScope(preference.scope, input.scope)) { preference.active = false; preference.version++; preference.updatedAt = this.now(); }
      for (const hypothesis of this.data.adaptation.hypotheses) if (samePreferenceScope(hypothesis.scope, input.scope) && ['suggested', 'accepted', 'applied'].includes(hypothesis.state)) hypothesis.state = 'superseded';
      if (input.clearSuppressions) this.data.adaptation.suppressions = this.data.adaptation.suppressions.filter(s => !samePreferenceScope(s.scope, input.scope));
      // Resetting a preference does not pretend to undo host UI effects. Explicit opposite commands remain available.
    });
  }
  private applyPreferenceValue(input: { key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; hypothesisId?: string; origin: 'explicit-user' | 'authorized-adaptation' }): AdaptationReceipt {
    validatePreference(input.key, input.value, input.scope);
    const targets = this.preferenceScope(input.scope), scope = this.scope();
    const hypothesis = this.data.adaptation.hypotheses.find(h => h.id === input.hypothesisId);
    if (input.origin === 'authorized-adaptation') {
      const category = this.data.adaptation.policy.categories[preferenceCategory(input.key)];
      check(this.data.adaptation.policy.enabled && category.enabled && category.level === 'adaptive' && hypothesis && hypothesis.evidence.length >= 3, 'automatic_adaptation_not_authorized');
      check(effectivePreference(this.data.adaptation, input.key, input.scope)?.source !== 'explicit', 'explicit_preference_overrides_inference');
    }
    const receipt: AdaptationReceipt = { id: randomUUID(), commandId: 'vela-preference:' + randomUUID(), key: input.key, value: input.value,
      scope: structuredClone(input.scope), origin: input.origin, state: 'started', startedAt: this.now(), ...(input.hypothesisId ? { hypothesisId: input.hypothesisId } : {}) };
    this.atomic(() => this.data.adaptation.receipts.push(receipt));
    let result: HostActionResult, dispatched = false;
    try {
      check(this.opts.host.applyPreference, 'host_preference_application_unavailable');
      const action = { type: 'applyPreference' as const, key: input.key, value: input.value, scope: input.scope };
      const authorizationRef = this.authorize({ phase: 'adaptation', requestId: receipt.id, intent: input.origin === 'explicit-user' ? 'Apply the explicit low-risk application preference' : 'Apply an authorized low-risk inferred preference', scope, targets, actions: [action] });
      dispatched = true;
      result = this.opts.host.applyPreference({ action, commandId: receipt.commandId, authorizationRef, expectedVersions: targets,
        evidenceEventIds: hypothesis?.evidence.map(e => e.eventId) ?? [], origin: input.origin });
      check(result && ['applied', 'failed', 'cancelled', 'unknown'].includes(result.status) && identifier(result.receiptId), 'invalid_host_preference_receipt');
    } catch (e) { result = { status: dispatched ? 'unknown' : 'failed', receiptId: receipt.id, errorCode: errorCode(e, 'preference_application_unknown') }; }
    this.atomic(() => {
      receipt.state = result.status; receipt.endedAt = this.now(); receipt.hostReceiptId = result.receiptId; if (result.errorCode) receipt.errorCode = result.errorCode;
      if (hypothesis) { hypothesis.state = result.status === 'applied' ? 'applied' : result.status === 'cancelled' ? 'failed' : result.status; if (result.errorCode) hypothesis.errorCode = result.errorCode; }
    });
    return structuredClone(receipt);
  }
}
