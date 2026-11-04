import type { ActionReceipt, PlanStep, ResourceRef, VelaHostPort, VelaPlan, VelaRequest, VelaScope, VelaSubjectRef, VelaWorkspaceConstructionReceipt } from './contracts.ts';
import { CAPABILITIES, check, identifier, text, validateAction } from './capabilities.ts';
import { historyDigest } from './bounded-history.mts';
import { canonicalRetrievalQuery, rankCanonicalRetrieval } from './history-retrieval.mts';

/** Read-only views of the existing durable records. This module owns no storage or transcript. */
export interface VelaOperationsState {
  requests: readonly VelaRequest[];
  plans: readonly VelaPlan[];
  receipts: readonly ActionReceipt[];
}
export interface VelaOperationWorkspaceSnapshot {
  workspace: { id: string; kind: 'workspace'; version: number };
  /** Actual canonical placements, excluding system presence. No content or instructions. */
  placements: readonly { blockId: string; resource: { id: string; kind: 'resource'; version: number } }[];
  /** Count-only coverage for additional non-resource subject cards. Their identities/content are not projected. */
  totalPlacementCount?: number;
}
export interface VelaOperationsHost extends Pick<VelaHostPort, 'scope' | 'resolve'> {
  /** Must enforce current canonical placement/metadata authorization on the SAME read boundary. */
  inspectWorkspace?(id: string, scope: VelaScope): VelaOperationWorkspaceSnapshot | null;
}
export const VELA_OPERATIONS_CONTRACT = 'aerynth.vela-operations@1' as const;
export const VELA_OPERATIONS_LIMITS = Object.freeze({ maxOperations: 8, maxEncodedBytes: 32768, lookbackReceipts: 64,
  maxReferences: 64, maxPlacements: 128, maxIntentBytes: 2048 });
export interface VelaOperationsOptions { maxOperations?: number; maxEncodedBytes?: number; query?: string }
type Metadata = Pick<ResourceRef, 'id' | 'kind' | 'title' | 'version' | 'resourceKind' | 'projectId' | 'state'>;
export interface VelaOperationProjection {
  requestId: string; planId: string; receiptId: string; stepId: string;
  originalIntent: string; intentTruncated: boolean;
  action: PlanStep['action']['type']; effect: string; startedAt: string;
  state: ActionReceipt['state']; requestState: VelaRequest['state']; planState: VelaPlan['state'];
  errorCodes: string[];
  resultIds: { resourceId?: string; workspaceId?: string; projectId?: string; collectionId?: string; openResourceId?: string };
  originatingRefs: Metadata[]; resultingRefs: Metadata[];
  expected: { workspaceId: string | null; resourceIds: string[]; population: 'not-declared' | 'declared-references';
    placements: { blockId: string; resourceId: string }[]; projectId?: string | null };
  recordedConstruction: { evidence: 'historical-host-receipt'; receipt: VelaWorkspaceConstructionReceipt } | null;
  observed: { workspace: Metadata; placementCount: number; placements: { blockId: string; resourceId: string; resourceVersion: number }[] } | null;
  verification: {
    state: 'verified' | 'incomplete' | 'unavailable' | 'not-applicable';
    coverage: 'declared-action-postconditions-only';
    population: 'not-declared' | 'matches' | 'missing' | 'unknown';
    missingResourceIds: string[]; missingPlacementIds: string[]; reason: string | null; geometry: 'not-inspected'; taskVerified: false;
  };
  recovery: { authority: 'none'; correction: 'replan-required'; undo: 'host-dependent' | 'no-state-change';
    retry: 'replan-required' | 'outcome-must-be-reconciled' | 'not-indicated' };
  /** Opaque versions of the relevant durable records, plus exact current canonical metadata. */
  sourceVersions: { request: string; plan: string; receipt: string };
}
export interface VelaOperationsPacket {
  contract: typeof VELA_OPERATIONS_CONTRACT;
  trust: 'untrusted-operation-data'; authority: 'none';
  scope: { principalId: string; policyVersion: string; fingerprint: string };
  limits: { maxOperations: number; maxEncodedBytes: number; query?: string };
  operations: readonly VelaOperationProjection[];
  omissions: { limit: number; budget: number; unavailable: number; invalidLink: number };
  digest: string;
}
export type VelaOperationReferent =
  | { kind: 'none'; authority: 'none' }
  | { kind: 'resolved'; authority: 'none'; purpose: 'correction' | 'undo' | 'retry'; receiptId: string; requestId: string; planId: string }
  | { kind: 'ambiguous'; authority: 'none'; purpose: 'correction' | 'undo' | 'retry'; candidateReceiptIds: readonly string[] };

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const key = (ref: VelaSubjectRef) => ref.kind + ':' + ref.id;
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;
const validRef = (ref: VelaSubjectRef) => ref && identifier(ref.id) && ['resource', 'workspace', 'project', 'collection'].includes(ref.kind);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function boundedIntent(value: string) {
  if (Buffer.byteLength(value, 'utf8') <= VELA_OPERATIONS_LIMITS.maxIntentBytes) return { originalIntent: value, intentTruncated: false };
  let result = '', size = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, 'utf8');
    if (size + next > VELA_OPERATIONS_LIMITS.maxIntentBytes) break;
    result += character; size += next;
  }
  return { originalIntent: result, intentTruncated: true };
}
function scoped(scope: VelaScope, ref: VelaSubjectRef) {
  return (ref.kind === 'resource' ? scope.resourceIds : ref.kind === 'workspace' ? scope.workspaceIds
    : ref.kind === 'project' ? scope.projectIds : scope.collectionIds ?? []).includes(ref.id);
}
function scopeProof(scope: VelaScope) {
  check(identifier(scope?.principalId) && identifier(scope.policyVersion), 'vela_operations_scope_unavailable');
  const lists = [scope.resourceIds, scope.workspaceIds, scope.projectIds, scope.collectionIds ?? []];
  check(lists.every(ids => Array.isArray(ids) && ids.length <= 10000 && ids.every(identifier) && new Set(ids).size === ids.length), 'vela_operations_scope_unavailable');
  return { principalId: scope.principalId, policyVersion: scope.policyVersion,
    fingerprint: historyDigest([scope.principalId, scope.policyVersion, ...lists.map(ids => [...ids].sort(compare))]) };
}
function metadata(host: VelaOperationsHost, scope: VelaScope, ref: VelaSubjectRef): Metadata | null {
  if (!validRef(ref) || !scoped(scope, ref)) return null;
  let item: ResourceRef | null = null;
  try { item = host.resolve({ id: ref.id, kind: ref.kind }, scope); } catch { return null; }
  if (!item || key(item) !== key(ref) || !version(item.version) || !text(item.title) ||
      item.resourceKind !== undefined && !identifier(item.resourceKind) ||
      item.projectId !== undefined && item.projectId !== null && !identifier(item.projectId) ||
      item.state !== undefined && !['active', 'archived'].includes(item.state)) return null;
  return { id: item.id, kind: item.kind, version: item.version, title: item.title,
    ...(item.resourceKind === undefined ? {} : { resourceKind: item.resourceKind }),
    ...(item.projectId === undefined ? {} : { projectId: item.projectId }),
    ...(item.state === undefined ? {} : { state: item.state }) };
}
function uniqueRefs(refs: readonly VelaSubjectRef[]) {
  const found = new Map<string, VelaSubjectRef>();
  for (const ref of refs) {
    check(validRef(ref), 'vela_operations_invalid_reference');
    found.set(key(ref), { kind: ref.kind, id: ref.id });
  }
  check(found.size <= VELA_OPERATIONS_LIMITS.maxReferences, 'vela_operations_reference_limit');
  return [...found.values()].sort((a, b) => compare(key(a), key(b)));
}
/** Public action identities only. Never copies content, task objectives, constraints or agent instructions. */
function actionRefs(action: PlanStep['action']) {
  const refs: VelaSubjectRef[] = [];
  const add = (id: string | null | undefined, kind: VelaSubjectRef['kind']) => { if (id !== null && id !== undefined) refs.push({ id, kind }); };
  if ('projectId' in action) add(action.projectId, 'project');
  if ('workspaceId' in action) add(action.workspaceId, 'workspace');
  if ('resourceId' in action) add(action.resourceId, 'resource');
  if ('collectionId' in action) add(action.collectionId, 'collection');
  if ('resourceIds' in action) for (const id of action.resourceIds) add(id, 'resource');
  if (action.type === 'navigate') {
    if (action.target.kind === 'workspace') add(action.target.workspaceId, 'workspace');
    else add(action.target.projectId, 'project');
  }
  if (action.type === 'setTaskGroupMembers') { add(action.groupId, 'resource'); for (const id of action.taskIds) add(id, 'resource'); }
  if (action.type === 'relate') { add(action.sourceId, 'resource'); add(action.targetId, 'resource'); }
  return refs;
}
function originatingRefs(request: VelaRequest, plan: VelaPlan, action: PlanStep['action']) {
  const refs: VelaSubjectRef[] = [...plan.targets, ...request.context.included, ...actionRefs(action)];
  // Explicit native actions did not send the discovery catalog/navigation to a provider. Those unused hints
  // must not become dependencies that hide a newly created destination after normal navigation.
  if (request.providerId === null) return uniqueRefs(refs);
  refs.push(...request.context.discovered);
  const navigation = request.origin?.navigation;
  if (navigation?.kind === 'known') {
    if (navigation.projectId !== null) refs.push({ kind: 'project', id: navigation.projectId });
    if (navigation.workspaceId !== null) refs.push({ kind: 'workspace', id: navigation.workspaceId });
  }
  const active = request.context.activeSurface;
  if (active?.projectId) refs.push({ kind: 'project', id: active.projectId });
  if (active?.workspaceId) refs.push({ kind: 'workspace', id: active.workspaceId });
  return uniqueRefs(refs);
}
function constructionReceipt(receipt: ActionReceipt, action: PlanStep['action']): VelaOperationProjection['recordedConstruction'] {
  const value = receipt.workspaceConstruction;
  if (value === undefined) return null;
  check(value.contract === 'aerynth.vela-workspace-construction@1' && identifier(value.workspaceId) &&
    value.workspaceId === (action.type === 'repairWorkspace' ? action.workspaceId : receipt.createdWorkspaceId) && (value.projectId === null || identifier(value.projectId)) &&
    version(value.workspaceVersion) && version(value.layoutVersion) && identifier(value.templateId) && version(value.templateVersion) &&
    typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) &&
    Array.isArray(value.resources) && value.resources.length > 0 && value.resources.length <= VELA_OPERATIONS_LIMITS.maxReferences &&
    value.resources.every(item => identifier(item.role) && identifier(item.resourceId) && version(item.version) && typeof item.reused === 'boolean') &&
    Array.isArray(value.placements) && value.placements.length > 0 && value.placements.length <= VELA_OPERATIONS_LIMITS.maxPlacements &&
    value.placements.every(item => identifier(item.role) && identifier(item.blockId) && identifier(item.resourceId) &&
      value.resources.some(resource => resource.resourceId === item.resourceId)) &&
    new Set(value.placements.map(item => item.blockId)).size === value.placements.length &&
    value.verification?.workspaceExists === true && value.verification.projectMatches === true &&
    value.verification.bindingsMatch === true && value.verification.geometryValid === true, 'vela_operations_invalid_construction_receipt');
  return { evidence: 'historical-host-receipt', receipt: {
    contract: value.contract, workspaceId: value.workspaceId, projectId: value.projectId, workspaceVersion: value.workspaceVersion,
    layoutVersion: value.layoutVersion, templateId: value.templateId, templateVersion: value.templateVersion, observedAt: value.observedAt,
    resources: value.resources.map(({ role, resourceId, version, reused }) => ({ role, resourceId, version, reused })),
    placements: value.placements.map(({ role, blockId, resourceId }) => ({ role, blockId, resourceId })),
    verification: { workspaceExists: true, projectMatches: true, bindingsMatch: true, geometryValid: true },
  } };
}
function resultRefs(receipt: ActionReceipt, construction: VelaOperationProjection['recordedConstruction']) {
  const { createdResourceId: resourceId, createdProjectId: projectId,
    createdCollectionId: collectionId, openResourceId } = receipt;
  const workspaceId = receipt.createdWorkspaceId ?? construction?.receipt.workspaceId;
  const resultIds = { ...(resourceId ? { resourceId } : {}), ...(workspaceId ? { workspaceId } : {}),
    ...(projectId ? { projectId } : {}), ...(collectionId ? { collectionId } : {}), ...(openResourceId ? { openResourceId } : {}) };
  const refs: VelaSubjectRef[] = [];
  for (const [id, kind] of [[resourceId, 'resource'], [workspaceId, 'workspace'], [projectId, 'project'],
    [collectionId, 'collection'], [openResourceId, 'resource']] as const) if (id !== undefined) refs.push({ id, kind });
  if (construction) {
    for (const resource of construction.receipt.resources) refs.push({ id: resource.resourceId, kind: 'resource' });
    if (construction.receipt.projectId !== null) refs.push({ id: construction.receipt.projectId, kind: 'project' });
  }
  return { resultIds, refs: uniqueRefs(refs) };
}
function expected(action: PlanStep['action'], receipt: ActionReceipt): VelaOperationProjection['expected'] {
  let workspaceId = receipt.createdWorkspaceId ?? ('workspaceId' in action ? action.workspaceId : null);
  let resourceIds: string[] = [];
  if (action.type === 'workspaceFromResources' || action.type === 'repairWorkspace') resourceIds = [...action.resourceIds];
  if (action.type === 'attach') resourceIds = [action.resourceId];
  if ((action.type === 'createResource' || action.type === 'createTimeline') && workspaceId && receipt.createdResourceId) resourceIds = [receipt.createdResourceId];
  if (action.type === 'navigate') workspaceId = null;
  const construction = action.type === 'constructWorkspace' || action.type === 'repairWorkspace' ? receipt.workspaceConstruction : undefined;
  if (construction) resourceIds = construction.resources.map(resource => resource.resourceId);
  return { workspaceId, resourceIds: [...new Set(resourceIds)].sort(compare), population: resourceIds.length ? 'declared-references' : 'not-declared',
    placements: construction ? construction.placements.map(({ blockId, resourceId }) => ({ blockId, resourceId })) : [],
    ...(construction ? { projectId: construction.projectId } : {}) };
}
function observe(host: VelaOperationsHost, scope: VelaScope, expected: VelaOperationProjection['expected']) {
  const verification: VelaOperationProjection['verification'] = { state: 'not-applicable', coverage: 'declared-action-postconditions-only',
    population: expected.population === 'not-declared' ? 'not-declared' : 'unknown', missingResourceIds: [], missingPlacementIds: [],
    reason: null, geometry: 'not-inspected', taskVerified: false };
  let observed: VelaOperationProjection['observed'] = null;
  if (!expected.workspaceId) return { observed, verification };
  const workspace = metadata(host, scope, { kind: 'workspace', id: expected.workspaceId });
  if (!workspace) return { observed, verification: { ...verification, state: 'unavailable' as const, reason: 'workspace-unavailable' } };
  let snapshot: VelaOperationWorkspaceSnapshot | null = null;
  try { snapshot = host.inspectWorkspace?.(expected.workspaceId, scope) ?? null; } catch { /* unavailable inspection is never empty-workspace proof */ }
  if (!snapshot || snapshot.workspace?.id !== workspace.id || snapshot.workspace.kind !== 'workspace' || snapshot.workspace.version !== workspace.version ||
      !Array.isArray(snapshot.placements) || snapshot.placements.length > VELA_OPERATIONS_LIMITS.maxPlacements ||
      snapshot.totalPlacementCount !== undefined && (!Number.isSafeInteger(snapshot.totalPlacementCount) ||
        snapshot.totalPlacementCount < snapshot.placements.length || snapshot.totalPlacementCount > VELA_OPERATIONS_LIMITS.maxPlacements)) {
    return { observed, verification: { ...verification, state: 'unavailable' as const, reason: 'workspace-inspection-unavailable' } };
  }
  const placements: NonNullable<VelaOperationProjection['observed']>['placements'] = [], seen = new Set<string>();
  for (const placement of snapshot.placements) {
    if (!identifier(placement?.blockId) || seen.has(placement.blockId) || placement.resource?.kind !== 'resource')
      return { observed: null, verification: { ...verification, state: 'unavailable' as const, reason: 'workspace-inspection-invalid' } };
    const resource = metadata(host, scope, placement.resource);
    if (!resource || resource.version !== placement.resource.version)
      return { observed: null, verification: { ...verification, state: 'unavailable' as const, reason: 'workspace-placement-unavailable' } };
    seen.add(placement.blockId); placements.push({ blockId: placement.blockId, resourceId: resource.id, resourceVersion: resource.version });
  }
  placements.sort((a, b) => compare(a.blockId, b.blockId));
  // Verify the complete authorized snapshot, but disclose only bindings relevant to this operation.
  // A busy workspace must not make one old note receipt grow with every unrelated card.
  observed = { workspace, placementCount: snapshot.totalPlacementCount ?? placements.length,
    placements: placements.filter(placement=>expected.resourceIds.includes(placement.resourceId)||expected.placements.some(binding=>binding.blockId===placement.blockId)) };
  verification.missingResourceIds = expected.resourceIds.filter(id => !placements.some(placement => placement.resourceId === id));
  verification.missingPlacementIds = expected.placements.filter(binding => !placements.some(placement =>
    placement.blockId === binding.blockId && placement.resourceId === binding.resourceId)).map(binding => binding.blockId);
  const bindingsMissing = verification.missingResourceIds.length > 0 || verification.missingPlacementIds.length > 0;
  const projectMismatch = expected.projectId !== undefined && workspace.projectId !== expected.projectId;
  verification.state = bindingsMissing || projectMismatch ? 'incomplete' : 'verified';
  verification.population = expected.population === 'not-declared' ? 'not-declared' : bindingsMissing ? 'missing' : 'matches';
  verification.reason = projectMismatch ? 'workspace-project-mismatch' : bindingsMissing ? 'declared-resource-placement-missing' : null;
  return { observed, verification };
}
function recordVersions(request: VelaRequest, plan: VelaPlan, receipt: ActionReceipt, step: PlanStep, refs: VelaSubjectRef[]) {
  return {
    request: historyDigest({ id: request.id, intent: request.intent, state: request.state, updatedAt: request.updatedAt,
      errorCode: request.errorCode, planId: request.planId, origin: request.origin, refs }),
    plan: historyDigest({ id: plan.id, requestId: plan.requestId, state: plan.state, fingerprint: plan.fingerprint,
      version: plan.version, scope: plan.scope, targets: plan.targets.map(({ id, kind, version }) => ({ id, kind, version })),
      stepId: step.id, action: step.action.type, expected: expected(step.action, receipt) }),
    receipt: historyDigest(receipt),
  };
}

/** Separate action proof: native operations do not acquire provider-history attribution by being projected here. */
export function projectVelaOperations(state: VelaOperationsState, host: VelaOperationsHost, options: VelaOperationsOptions = {}): VelaOperationsPacket {
  const maxOperations = options.maxOperations ?? VELA_OPERATIONS_LIMITS.maxOperations;
  const maxEncodedBytes = options.maxEncodedBytes ?? VELA_OPERATIONS_LIMITS.maxEncodedBytes;
  const query=canonicalRetrievalQuery(options.query);
  check(Number.isSafeInteger(maxOperations) && maxOperations >= 0 && maxOperations <= VELA_OPERATIONS_LIMITS.maxOperations &&
    Number.isSafeInteger(maxEncodedBytes) && maxEncodedBytes >= 1024 && maxEncodedBytes <= VELA_OPERATIONS_LIMITS.maxEncodedBytes, 'vela_operations_invalid_limits');
  const scope = host.scope(), proof = scopeProof(scope);
  const omissions = { limit: 0, budget: 0, unavailable: 0, invalidLink: 0 };
  const operations: VelaOperationProjection[] = [];
  const payload = { contract: VELA_OPERATIONS_CONTRACT, trust: 'untrusted-operation-data' as const, authority: 'none' as const,
    scope: proof, limits: { maxOperations, maxEncodedBytes, ...(query?{query:query.terms.join(' ')}:{}) }, operations, omissions };
  // Duplicate durable identities cannot become a uniquely resolved operation.
  const index = <T extends { id: string }>(records: readonly T[]) => {
    const values = new Map<string, T | null>();
    for (const record of records) values.set(record.id, values.has(record.id) ? null : record);
    return values;
  };
  const requests = index(state.requests), plans = index(state.plans), receipts = index(state.receipts);
  const candidates = [...receipts.values()].filter((receipt): receipt is ActionReceipt => !!receipt)
    .sort((a, b) => compare(b.startedAt, a.startedAt) || compare(a.id, b.id));
  omissions.invalidLink += [...receipts.values()].filter(receipt => !receipt).length;
  omissions.limit += Math.max(0, candidates.length - VELA_OPERATIONS_LIMITS.lookbackReceipts);
  for (const receipt of candidates.slice(0, VELA_OPERATIONS_LIMITS.lookbackReceipts)) {
    if (!query && operations.length >= maxOperations) { omissions.limit++; continue; }
    const request = requests.get(receipt.requestId), plan = plans.get(receipt.planId);
    const steps = plan?.steps.filter(step => step.id === receipt.stepId) ?? [];
    if (!request || !plan || steps.length !== 1 || plan.requestId !== request.id || request.planId !== plan.id ||
        receipt.source !== 'vela' || ![receipt.id, receipt.planId, receipt.requestId, receipt.stepId].every(identifier) ||
        !['started', 'applied', 'failed', 'cancelled', 'unknown'].includes(receipt.state) || !Number.isFinite(Date.parse(receipt.startedAt))) {
      omissions.invalidLink++; continue;
    }
    if (plan.scope.principalId !== scope.principalId || request.origin && request.origin.principalId !== scope.principalId) {
      omissions.unavailable++; continue;
    }
    try {
      const step = steps[0], action = validateAction(step.action), construction = constructionReceipt(receipt, action);
      check(!construction || action.type === 'constructWorkspace' || action.type === 'repairWorkspace', 'vela_operations_invalid_construction_receipt');
      const refs = originatingRefs(request, plan, action), results = resultRefs(receipt, construction);
      const originating = refs.map(ref => metadata(host, scope, ref)), resulting = results.refs.map(ref => metadata(host, scope, ref));
      if ([...originating, ...resulting].some(ref => !ref)) { omissions.unavailable++; continue; }
      const expectation = expected(action, receipt), observation = observe(host, scope, expectation);
      const capability = CAPABILITIES.find(item => item.id === action.type);
      const outcomeUnknown = receipt.state === 'unknown' || receipt.state === 'started';
      const projection: VelaOperationProjection = { requestId: request.id, planId: plan.id, receiptId: receipt.id, stepId: step.id,
        ...boundedIntent(request.intent), action: action.type, effect: capability?.effect ?? 'unknown', startedAt: receipt.startedAt,
        state: receipt.state, requestState: request.state, planState: plan.state,
        errorCodes: [...new Set([request.errorCode, receipt.errorCode].filter((code): code is string => identifier(code)))].sort(compare),
        resultIds: results.resultIds, originatingRefs: originating as Metadata[], resultingRefs: resulting as Metadata[], expected: expectation,
        recordedConstruction: construction,
        ...observation,
        recovery: { authority: 'none', correction: 'replan-required', undo: capability?.reversible === 'no-state-change' ? 'no-state-change' : 'host-dependent',
          retry: outcomeUnknown ? 'outcome-must-be-reconciled' : receipt.state === 'failed' || receipt.state === 'cancelled' || observation.verification.state === 'incomplete' ? 'replan-required' : 'not-indicated' },
        sourceVersions: recordVersions(request, plan, receipt, step, refs) };
      // Workspace-producing commands require a result identity before any success claim is possible.
      if (receipt.state === 'applied' && ['createWorkspace', 'constructWorkspace', 'workspaceFromResources'].includes(action.type) && !receipt.createdWorkspaceId)
        projection.verification = { ...projection.verification, state: 'incomplete', reason: 'created-workspace-identity-missing' };
      if (receipt.state === 'applied' && ['createResource', 'createTimeline'].includes(action.type) && !receipt.createdResourceId)
        projection.verification = { ...projection.verification, state: 'incomplete', reason: 'created-resource-identity-missing' };
      if ((action.type === 'constructWorkspace' && receipt.createdWorkspaceId || action.type === 'repairWorkspace') && !construction)
        projection.verification = { ...projection.verification, state: 'unavailable', reason: 'construction-receipt-unavailable' };
      if (projection.verification.state === 'incomplete' && !outcomeUnknown) projection.recovery.retry = 'replan-required';
      operations.push(projection);
      if (!query && bytes({ ...payload, digest: '0'.repeat(64) }) > maxEncodedBytes) { operations.pop(); omissions.budget++; }
    } catch { omissions.invalidLink++; }
  }
  if(query){
    // All source/receipt/ref checks above precede lexical indexing. Ranking grants no mutation authority.
    const ranking=rankCanonicalRetrieval(query,operations.map(operation=>({id:operation.receiptId,
      text:[operation.originalIntent,...operation.originatingRefs.map(ref=>ref.title),...operation.resultingRefs.map(ref=>ref.title)].join('\n'),
      identities:[operation.receiptId,operation.requestId,operation.planId,...Object.values(operation.resultIds)]}))),
      ordered=[...new Set([...ranking.ids,...operations.map(operation=>operation.receiptId)])].map(id=>operations.find(operation=>operation.receiptId===id)!);
    operations.splice(0);
    for(const operation of ordered){if(operations.length>=maxOperations){omissions.limit++;continue;}operations.push(operation);
      if(bytes({...payload,digest:'0'.repeat(64)})>maxEncodedBytes){operations.pop();omissions.budget++;}}
  }
  check(historyDigest(scopeProof(host.scope())) === historyDigest(proof), 'vela_operations_scope_changed');
  // Only dependencies actually disclosed by this packet bind its durable scope.
  // Creating an unrelated provider execution resource must not invalidate prior
  // operation evidence. Every disclosed reference was resolved above against the
  // complete current scope, so revocation still withdraws the operation.
  const disclosed = [...new Set(operations.flatMap(operation => [...operation.originatingRefs, ...operation.resultingRefs]
    .map(ref => ref.kind + ':' + ref.id)))].sort(compare);
  payload.scope = { principalId: scope.principalId, policyVersion: scope.policyVersion,
    fingerprint: historyDigest([scope.principalId, scope.policyVersion, disclosed]) };
  const packet = { ...payload, digest: historyDigest(payload) };
  check(bytes(packet) <= maxEncodedBytes, 'vela_operations_budget_exceeded');
  return freeze(packet);
}

/** Rebuild against the actual owning state/services immediately before consuming a frozen projection. */
export function validateVelaOperations(frozen: VelaOperationsPacket, current: VelaOperationsState, host: VelaOperationsHost,
  options: VelaOperationsOptions = frozen.limits): void {
  const { digest, ...payload } = frozen;
  check(frozen.contract === VELA_OPERATIONS_CONTRACT && digest === historyDigest(payload), 'vela_operations_changed');
  const rebuilt = projectVelaOperations(current, host, options);
  check(rebuilt.digest === digest, 'vela_operations_changed');
}

const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}:_-]+/gu, ' ').trim();
/** Resolves an evidence reference only. Every correction, undo or retry still needs the current host action path. */
export function resolveVelaOperationReferent(intent: string, packet: VelaOperationsPacket): VelaOperationReferent {
  const none = { kind: 'none' as const, authority: 'none' as const };
  if (!text(intent, 16000)) return none;
  const { digest, ...payload } = packet;
  if (packet.contract !== VELA_OPERATIONS_CONTRACT || digest !== historyDigest(payload)) return none;
  const input = normalized(intent);
  const purpose = /\b(undo|revert|rollback)\b/.test(input) ? 'undo' : /\b(retry|try again|run again|do it again)\b/.test(input) ? 'retry'
    : /\b(fix|correct|repair|didn t|didnt|did not|empty|missing|incomplete|wrong)\b/.test(input) ? 'correction' : null;
  if (!purpose) return none;
  let candidates = [...packet.operations].filter(operation => purpose === 'undo' ? operation.recovery.undo !== 'no-state-change'
    : operation.effect !== 'read' && operation.effect !== 'navigate' && operation.action !== 'inspectVelaOperation');
  const contains = (value: string) => (' ' + input + ' ').includes(' ' + normalized(value) + ' ');
  const explicit = candidates.filter(operation => [operation.receiptId, operation.planId, operation.requestId,
    ...Object.values(operation.resultIds)].some(contains));
  if (explicit.length) candidates = explicit;
  else {
    const named = candidates.filter(operation => [...operation.originatingRefs, ...operation.resultingRefs]
      .some(ref => ref.title.length >= 3 && contains(ref.title)));
    if (named.length) candidates = named;
    else {
      // An unknown explicit identity/name must not be silently replaced by the one visible operation.
      if (/\b(?:receipt|request|plan|resource|workspace|project|collection):[\p{L}\p{N}:_-]+\b/u.test(input) ||
          /\b(named|called|titled)\b/.test(input) || /["“”][^"“”]+["“”]/u.test(intent)) return none;
      if (!/\b(that|it|this|previous|last|just|again|you didn t|you didnt|you did not)\b/.test(input)) return none;
      if (/\bworkspace\b/.test(input)) candidates = candidates.filter(operation => /workspace/i.test(operation.action) || operation.expected.workspaceId !== null);
    }
  }
  if (!explicit.length && /\b(last|just)\b/.test(input) && candidates.length) {
    const latest = candidates.map(operation => operation.startedAt).sort(compare).at(-1);
    candidates = candidates.filter(operation => operation.startedAt === latest);
  }
  if (!candidates.length) return none;
  if (candidates.length > 1) return freeze({ kind: 'ambiguous', authority: 'none', purpose,
    candidateReceiptIds: candidates.map(operation => operation.receiptId) });
  const { receiptId, requestId, planId } = candidates[0];
  return freeze({ kind: 'resolved', authority: 'none', purpose, receiptId, requestId, planId });
}
