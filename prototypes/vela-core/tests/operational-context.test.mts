import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionReceipt, PlanStep, ResourceRef, VelaPlan, VelaRequest, VelaScope } from '../src/contracts.ts';
import { VELA_OPERATIONS_LIMITS, projectVelaOperations, resolveVelaOperationReferent, validateVelaOperations,
  type VelaOperationsHost, type VelaOperationsState, type VelaOperationWorkspaceSnapshot } from '../src/operational-context.mts';

function fixture(action: PlanStep['action'] = { type: 'workspaceFromResources', title: 'Synthetic Minecraft workspace', projectId: 'project:1', resourceIds: ['resource:1', 'resource:2'] }) {
  const at = '2026-11-03T12:00:00.000Z';
  const scope: VelaScope = { principalId: 'principal:synthetic', policyVersion: 'policy:1',
    resourceIds: ['resource:1', 'resource:2'], workspaceIds: ['workspace:origin', 'workspace:result'], projectIds: ['project:1'] };
  const metadata = new Map<string, ResourceRef>([
    ['project:1', { kind: 'project', id: 'project:1', version: 2, title: 'Synthetic Minecraft project' }],
    ['workspace:origin', { kind: 'workspace', id: 'workspace:origin', version: 3, title: 'Synthetic original workspace', projectId: 'project:1' }],
    ['workspace:result', { kind: 'workspace', id: 'workspace:result', version: 4, title: 'Synthetic Minecraft workspace', projectId: 'project:1' }],
    ['resource:1', { kind: 'resource', id: 'resource:1', version: 5, title: 'Synthetic build note', resourceKind: 'note', projectId: 'project:1' }],
    ['resource:2', { kind: 'resource', id: 'resource:2', version: 6, title: 'Synthetic server task', resourceKind: 'task', projectId: 'project:1' }],
  ]);
  const request: VelaRequest = { id: 'request:1', conversationId: 'conversation:canonical', intent: 'Create a Minecraft workspace using my two existing resources.',
    state: 'completed', createdAt: at, updatedAt: at, providerId: null, planId: 'plan:1',
    origin: { principalId: scope.principalId, policyVersion: scope.policyVersion,
      navigation: { kind: 'known', projectId: 'project:1', workspaceId: 'workspace:origin' } },
    context: { id: 'context:1', createdAt: at, policyVersion: scope.policyVersion, discovered: [structuredClone(metadata.get('resource:1')!)],
      included: [{ ...structuredClone(metadata.get('resource:1')!), reason: 'explicit', content: 'Synthetic SECRET_RESOURCE_BODY', contentDigest: 'digest:synthetic', source: 'source:canonical', trust: 'untrusted-source-data' }],
      omitted: [], contentBytes: 30, coverage: 'explicit-resources-only', agentInstructions: 'Synthetic SECRET_AGENT_INSTRUCTIONS' } };
  const plan: VelaPlan = { id: 'plan:1', requestId: request.id, version: 1, fingerprint: 'fingerprint:1', summary: 'Synthetic operation',
    steps: [{ id: 'step:1', action, explanation: 'Synthetic action explanation' }], targets: [structuredClone(metadata.get('project:1')!)],
    scope: structuredClone(scope), state: 'applied', createdAt: at, expiresAt: '2026-11-03T13:00:00.000Z', contribution: null };
  const receipt: ActionReceipt = { id: 'receipt:1', planId: plan.id, requestId: request.id, stepId: 'step:1', commandId: 'command:1',
    source: 'vela', providerId: null, state: 'applied', startedAt: at, endedAt: at, hostReceiptId: 'host-receipt:1', createdWorkspaceId: 'workspace:result', taskVerified: false };
  const state: VelaOperationsState = { requests: [request], plans: [plan], receipts: [receipt] };
  let snapshot: VelaOperationWorkspaceSnapshot | null = { workspace: { kind: 'workspace', id: 'workspace:result', version: 4 },
    placements: [{ blockId: 'block:1', resource: { kind: 'resource', id: 'resource:1', version: 5 } },
      { blockId: 'block:2', resource: { kind: 'resource', id: 'resource:2', version: 6 } }] };
  const denied = new Set<string>(), calls: string[] = [];
  const host: VelaOperationsHost = {
    scope: () => structuredClone(scope),
    resolve: ref => {
      calls.push('metadata:' + ref.id);
      const item = metadata.get(ref.id);
      if (denied.has(ref.id) || !item || item.kind !== ref.kind) return null;
      // Extra host fields must never escape the projection whitelist.
      return { ...structuredClone(item), content: 'Synthetic SECRET_HOST_BODY', instructions: 'Synthetic SECRET_HOST_INSTRUCTIONS' } as ResourceRef;
    },
    inspectWorkspace: (id, current) => {
      calls.push('placements:' + id);
      assert.equal(current.principalId, scope.principalId);
      return snapshot ? structuredClone(snapshot) : null;
    },
  };
  return { state, request, plan, receipt, metadata, scope, host, denied, calls,
    setSnapshot(value: VelaOperationWorkspaceSnapshot | null) { snapshot = value; } };
}

function constructionFixture() {
  const f = fixture({ type: 'constructWorkspace', title: 'Synthetic Minecraft workspace', purpose: 'Synthetic Minecraft planning and server work',
    projectId: 'project:1', newProjectTitle: null });
  f.receipt.workspaceConstruction = { contract: 'aerynth.vela-workspace-construction@1', workspaceId: 'workspace:result', projectId: 'project:1',
    // Raw historical entity/engine versions are deliberately different from the current canonical composite token.
    workspaceVersion: 1, layoutVersion: 23, templateId: 'template:synthetic-development', templateVersion: 1, observedAt: f.receipt.startedAt,
    resources: [{ role: 'notes', resourceId: 'resource:1', version: 5, reused: true },
      { role: 'tasks', resourceId: 'resource:2', version: 6, reused: false }],
    placements: [{ role: 'notes', blockId: 'block:1', resourceId: 'resource:1' }, { role: 'tasks', blockId: 'block:2', resourceId: 'resource:2' }],
    verification: { workspaceExists: true, projectMatches: true, bindingsMatch: true, geometryValid: true } };
  return f;
}

test('durable operation projection verifies actual identities and placements without resource content or a second store', () => {
  const f = fixture(), before = JSON.stringify(f.state), packet = projectVelaOperations(f.state, f.host), operation = packet.operations[0];
  assert.equal(packet.authority, 'none'); assert.equal(packet.trust, 'untrusted-operation-data');
  assert.equal(operation.originalIntent, f.request.intent); assert.equal(operation.receiptId, f.receipt.id);
  assert.equal(operation.requestId, f.request.id); assert.equal(operation.planId, f.plan.id);
  assert.equal(operation.resultIds.workspaceId, 'workspace:result'); assert.equal(operation.observed?.placementCount, 2);
  assert.deepEqual(operation.observed?.placements.map(item => item.resourceId), ['resource:1', 'resource:2']);
  assert.equal(operation.verification.state, 'verified'); assert.equal(operation.verification.population, 'matches');
  assert.equal(operation.verification.coverage, 'declared-action-postconditions-only'); assert.equal(operation.verification.taskVerified, false);
  assert.equal(operation.recovery.authority, 'none'); assert.equal(operation.recovery.undo, 'host-dependent');
  assert.equal(JSON.stringify(f.state), before); assert.ok(f.calls.every(call => /^(metadata|placements):/.test(call)));
  assert.doesNotMatch(JSON.stringify(packet), /SECRET_|contentDigest|agentInstructions|hostReceiptId|authorizationRef|nativeThreadId/);
  assert.equal(Reflect.set(packet.operations, '0', null), false);
  assert.equal(Reflect.set(operation.resultingRefs[0], 'title', 'replaced'), false);
  validateVelaOperations(packet, f.state, f.host);
});

test('digest is restart-stable and scope allow-list ordering is immaterial', () => {
  const f = fixture(), packet = projectVelaOperations(f.state, f.host);
  const restartedState = JSON.parse(JSON.stringify(f.state)) as VelaOperationsState;
  f.scope.resourceIds.reverse(); f.scope.workspaceIds.reverse();
  assert.equal(projectVelaOperations(restartedState, f.host).digest, packet.digest);
  validateVelaOperations(JSON.parse(JSON.stringify(packet)), restartedState, f.host);
});

for (const revoked of ['resource:1', 'workspace:origin', 'workspace:result', 'project:1']) {
  test('origin and result scope revocation suppresses the entire private operation: ' + revoked, () => {
    const f = fixture();
    if (revoked === 'workspace:origin') f.request.providerId = 'synthetic-planner';
    const frozen = projectVelaOperations(f.state, f.host);
    for (const list of [f.scope.resourceIds, f.scope.workspaceIds, f.scope.projectIds]) {
      const index = list.indexOf(revoked); if (index >= 0) list.splice(index, 1);
    }
    const current = projectVelaOperations(f.state, f.host);
    assert.equal(current.operations.length, 0); assert.equal(current.omissions.unavailable, 1);
    assert.doesNotMatch(JSON.stringify(current), /Minecraft|build note|request:1|workspace:result|SECRET_/);
    assert.throws(() => validateVelaOperations(frozen, f.state, f.host), /vela_operations_changed/);
  });
}

test('metadata denial and principal changes cannot be bypassed by old plan allow-lists', () => {
  const f = fixture(); f.denied.add('workspace:result');
  assert.equal(projectVelaOperations(f.state, f.host).operations.length, 0);
  f.denied.clear(); f.denied.add('resource:1'); assert.equal(projectVelaOperations(f.state, f.host).operations.length, 0);
  f.denied.clear(); f.scope.principalId = 'principal:another'; assert.equal(projectVelaOperations(f.state, f.host).operations.length, 0);
});

test('native creation follows the authorized new project without retaining unused catalog/navigation dependencies', () => {
  const f = constructionFixture();
  f.plan.steps[0].action = { type: 'constructWorkspace', title: 'New destination', purpose: 'Create a useful new destination', projectId: null, newProjectTitle: 'New destination' };
  f.plan.targets = [];
  f.request.intent = 'Create a workspace for New destination'; f.request.context.included = [];
  f.request.context.discovered.push({ kind: 'resource', id: 'resource:unrelated-old', title: 'Withdrawn unrelated catalog metadata', version: 1 });
  f.request.context.activeSurface = { projectId: 'project:1', workspaceId: 'workspace:origin' };
  f.metadata.set('project:new', { kind: 'project', id: 'project:new', title: 'New destination', version: 1 });
  f.metadata.get('workspace:result')!.projectId = 'project:new';
  f.metadata.get('resource:1')!.projectId = 'project:new'; f.metadata.get('resource:2')!.projectId = 'project:new';
  f.receipt.createdProjectId = 'project:new'; f.receipt.workspaceConstruction!.projectId = 'project:new';
  f.scope.projectIds = ['project:new']; f.scope.workspaceIds = ['workspace:result'];
  const packet = projectVelaOperations(f.state, f.host);
  assert.equal(packet.operations.length, 1); assert.equal(packet.operations[0].verification.state, 'verified');
  assert.deepEqual(packet.operations[0].originatingRefs, []);
  assert.doesNotMatch(JSON.stringify(packet), /project:1|workspace:origin|resource:unrelated-old|Withdrawn unrelated/);
  f.request.providerId = 'synthetic-planner';
  const providerPacket = projectVelaOperations(f.state, f.host);
  assert.equal(providerPacket.operations.length, 0); assert.equal(providerPacket.omissions.unavailable, 1);
});

test('canonical target version, title, action receipt and request changes invalidate a frozen packet', () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.metadata.get('workspace:result')!.version++; },
    (f: ReturnType<typeof fixture>) => { f.metadata.get('resource:1')!.title = 'Changed canonical title'; },
    (f: ReturnType<typeof fixture>) => { f.receipt.state = 'unknown'; },
    (f: ReturnType<typeof fixture>) => { f.request.intent = 'Changed user intent'; },
    (f: ReturnType<typeof fixture>) => { f.plan.fingerprint = 'fingerprint:changed'; },
    (f: ReturnType<typeof fixture>) => { f.scope.policyVersion = 'policy:changed'; },
  ]) {
    const f = fixture(), packet = projectVelaOperations(f.state, f.host); mutate(f);
    assert.throws(() => validateVelaOperations(packet, f.state, f.host), /vela_operations_changed/);
  }
});

test('population verification identifies exact missing deliverables instead of calling an empty result successful', () => {
  const f = fixture(); f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: [] });
  const operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.state, 'applied'); assert.equal(operation.observed?.placementCount, 0);
  assert.equal(operation.verification.state, 'incomplete'); assert.equal(operation.verification.population, 'missing');
  assert.deepEqual(operation.verification.missingResourceIds, ['resource:1', 'resource:2']);
  assert.equal(operation.recovery.retry, 'replan-required'); assert.equal(operation.verification.taskVerified, false);
});

test('generic createWorkspace records empty contents honestly without inventing a population requirement', () => {
  const f = fixture({ type: 'createWorkspace', title: 'Synthetic blank workspace', projectId: 'project:1' });
  f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: [] });
  const operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.observed?.placementCount, 0); assert.deepEqual(operation.expected.resourceIds, []);
  assert.equal(operation.verification.state, 'verified'); assert.equal(operation.verification.population, 'not-declared');
  assert.equal(operation.verification.taskVerified, false);
});

test('populated construction separates recorded host verification from currently inspected exact bindings', () => {
  const f = constructionFixture(), operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.verification.state, 'verified'); assert.equal(operation.observed?.workspace.version, 4);
  assert.deepEqual(operation.expected.resourceIds, ['resource:1', 'resource:2']);
  assert.deepEqual(operation.expected.placements, [{ blockId: 'block:1', resourceId: 'resource:1' }, { blockId: 'block:2', resourceId: 'resource:2' }]);
  assert.equal(operation.recordedConstruction?.evidence, 'historical-host-receipt');
  assert.equal(operation.recordedConstruction?.receipt.workspaceVersion, 1); assert.equal(operation.recordedConstruction?.receipt.layoutVersion, 23);
  assert.equal(operation.recordedConstruction?.receipt.verification.geometryValid, true);
  assert.equal(operation.verification.geometry, 'not-inspected'); assert.equal(operation.verification.taskVerified, false);
});

test('repair receipts describe superseding bindings in the same workspace without claiming a new workspace', () => {
  const f = constructionFixture();
  f.receipt.id = 'receipt:repaired'; delete f.receipt.createdWorkspaceId;
  f.plan.steps[0].action = { type: 'repairWorkspace', workspaceId: 'workspace:result', receiptId: 'receipt:original', resourceIds: ['resource:1', 'resource:2'] };
  f.receipt.workspaceConstruction!.placements[0].blockId = 'block:replacement';
  f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: [
    { blockId: 'block:replacement', resource: { kind: 'resource', id: 'resource:1', version: 5 } },
    { blockId: 'block:2', resource: { kind: 'resource', id: 'resource:2', version: 6 } }] });
  const packet = projectVelaOperations(f.state, f.host), operation = packet.operations[0];
  assert.equal(packet.operations.length, 1); assert.equal(operation.action, 'repairWorkspace');
  assert.equal(operation.resultIds.workspaceId, 'workspace:result'); assert.equal(operation.verification.state, 'verified');
  assert.equal(operation.recordedConstruction?.receipt.placements[0].blockId, 'block:replacement');
  assert.equal(f.receipt.createdWorkspaceId, undefined);
  f.scope.resourceIds.splice(f.scope.resourceIds.indexOf('resource:2'), 1);
  assert.equal(projectVelaOperations(f.state, f.host).operations.length, 0);
});

test('construction checks exact resource-to-block bindings and project rather than merely counting cards', () => {
  const f = constructionFixture();
  f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: [
    { blockId: 'block:1', resource: { kind: 'resource', id: 'resource:2', version: 6 } },
    { blockId: 'block:2', resource: { kind: 'resource', id: 'resource:1', version: 5 } }] });
  let operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.observed?.placementCount, 2); assert.deepEqual(operation.verification.missingResourceIds, []);
  assert.deepEqual(operation.verification.missingPlacementIds, ['block:1', 'block:2']); assert.equal(operation.verification.state, 'incomplete');
  f.metadata.get('workspace:result')!.projectId = null;
  operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.verification.reason, 'workspace-project-mismatch');
});

test('historical construction resources receive current authorization even when absent from original context', () => {
  const f = constructionFixture();
  assert.ok(!f.request.context.discovered.some(ref => ref.id === 'resource:2'));
  const frozen = projectVelaOperations(f.state, f.host); f.scope.resourceIds.splice(f.scope.resourceIds.indexOf('resource:2'), 1);
  const current = projectVelaOperations(f.state, f.host);
  assert.equal(current.operations.length, 0); assert.equal(current.omissions.unavailable, 1);
  assert.doesNotMatch(JSON.stringify(current), /resource:2|Synthetic Minecraft/);
  assert.throws(() => validateVelaOperations(frozen, f.state, f.host), /vela_operations_changed/);
});

test('a missing or inconsistent construction receipt cannot claim current construction verification', () => {
  const f = constructionFixture(); delete f.receipt.workspaceConstruction;
  let operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.verification.state, 'unavailable'); assert.equal(operation.verification.reason, 'construction-receipt-unavailable');
  delete f.receipt.createdWorkspaceId; operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.verification.state, 'incomplete'); assert.equal(operation.verification.reason, 'created-workspace-identity-missing');
  const invalid = constructionFixture(); invalid.receipt.workspaceConstruction!.workspaceId = 'workspace:invented';
  assert.equal(projectVelaOperations(invalid.state, invalid.host).operations.length, 0);
  const empty = constructionFixture(); empty.receipt.workspaceConstruction!.placements = [];
  assert.equal(projectVelaOperations(empty.state, empty.host).operations.length, 0);
});

test('unavailable or inconsistent canonical inspection is not proof of an empty workspace', () => {
  for (const snapshot of [null,
    { workspace: { kind: 'workspace' as const, id: 'workspace:result', version: 99 }, placements: [] },
    { workspace: { kind: 'workspace' as const, id: 'workspace:result', version: 4 }, placements: [
      { blockId: 'block:1', resource: { kind: 'resource' as const, id: 'resource:1', version: 999 } }] },
  ]) {
    const f = fixture(); f.setSnapshot(snapshot);
    const operation = projectVelaOperations(f.state, f.host).operations[0];
    assert.equal(operation.observed, null); assert.equal(operation.verification.state, 'unavailable');
    assert.equal(operation.verification.population, 'unknown');
  }
  const f = fixture(); delete f.host.inspectWorkspace;
  assert.equal(projectVelaOperations(f.state, f.host).operations[0].verification.state, 'unavailable');
});

test('an unexpected inaccessible placement never discloses its identity or title', () => {
  const f = fixture(); f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: [
    { blockId: 'block:private', resource: { kind: 'resource', id: 'resource:revoked', version: 1 } }] });
  const packet = projectVelaOperations(f.state, f.host);
  assert.equal(packet.operations[0].verification.state, 'unavailable'); assert.equal(packet.operations[0].observed, null);
  assert.doesNotMatch(JSON.stringify(packet), /resource:revoked|block:private/);
});

test('additional subject cards contribute only an actual count, never invented resource bindings', () => {
  const f = fixture();
  f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, totalPlacementCount: 4, placements: [
    { blockId: 'block:1', resource: { kind: 'resource', id: 'resource:1', version: 5 } },
    { blockId: 'block:2', resource: { kind: 'resource', id: 'resource:2', version: 6 } }] });
  const operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.observed?.placementCount, 4); assert.equal(operation.observed?.placements.length, 2);
  assert.equal(operation.verification.state, 'verified');
  assert.deepEqual(operation.observed?.placements.map(item => item.resourceId), ['resource:1', 'resource:2']);
  assert.equal(operation.verification.coverage, 'declared-action-postconditions-only');
});

test('malformed or inconsistent count-only subject coverage is unavailable', () => {
  for (const count of [0, 1, -1, 2.5, NaN, Infinity, 129]) {
    const f = fixture();
    f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, totalPlacementCount: count, placements: [
      { blockId: 'block:1', resource: { kind: 'resource', id: 'resource:1', version: 5 } },
      { blockId: 'block:2', resource: { kind: 'resource', id: 'resource:2', version: 6 } }] });
    const operation = projectVelaOperations(f.state, f.host).operations[0];
    assert.equal(operation.verification.state, 'unavailable'); assert.equal(operation.observed, null);
  }
});

test('applied creation without a returned canonical identity is incomplete', () => {
  const f = fixture(); delete f.receipt.createdWorkspaceId;
  const operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.verification.state, 'incomplete'); assert.equal(operation.verification.reason, 'created-workspace-identity-missing');
  assert.deepEqual(operation.resultIds, {}); assert.equal(operation.observed, null);
  assert.equal(operation.recovery.retry, 'replan-required');
});

test('failed and unknown receipts preserve specific errors and never authorize a blind retry', () => {
  const f = fixture(); f.receipt.state = 'failed'; f.receipt.errorCode = 'canonical_population_failed';
  f.request.state = 'failed'; f.request.errorCode = 'action_validation_failed'; f.plan.state = 'failed';
  let operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.state, 'failed'); assert.equal(operation.requestState, 'failed'); assert.equal(operation.planState, 'failed');
  assert.deepEqual(operation.errorCodes, ['action_validation_failed', 'canonical_population_failed']);
  assert.equal(operation.recovery.retry, 'replan-required');
  f.receipt.state = 'unknown'; operation = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(operation.recovery.retry, 'outcome-must-be-reconciled'); assert.equal(operation.recovery.authority, 'none');
});

test('attach and createResource verify placement of the exact canonical resource', () => {
  for (const action of [
    { type: 'attach' as const, workspaceId: 'workspace:result', resourceId: 'resource:1' },
    { type: 'createResource' as const, workspaceId: 'workspace:result', kind: 'note' as const, title: 'Synthetic new note' },
  ]) {
    const f = fixture(action); delete f.receipt.createdWorkspaceId;
    if (action.type === 'createResource') f.receipt.createdResourceId = 'resource:1';
    const operation = projectVelaOperations(f.state, f.host).operations[0];
    assert.deepEqual(operation.expected.resourceIds, ['resource:1']); assert.equal(operation.verification.state, 'verified');
  }
});

test('projection stays within operation, lookback, intent and encoded-byte limits', () => {
  const f = fixture();
  const requests: VelaRequest[] = [], plans: VelaPlan[] = [], receipts: ActionReceipt[] = [];
  for (let i = 0; i < 80; i++) {
    const request = structuredClone(f.request), plan = structuredClone(f.plan), receipt = structuredClone(f.receipt);
    request.id = 'request:' + i; request.planId = 'plan:' + i; plan.id = request.planId; plan.requestId = request.id;
    receipt.id = 'receipt:' + i; receipt.planId = plan.id; receipt.requestId = request.id;
    receipt.startedAt = new Date(Date.parse(f.receipt.startedAt) + i * 1000).toISOString();
    requests.push(request); plans.push(plan); receipts.push(receipt);
  }
  const state = { requests, plans, receipts }, packet = projectVelaOperations(state, f.host);
  assert.equal(packet.operations.length, 8); assert.equal(packet.operations[0].receiptId, 'receipt:79');
  assert.equal(packet.omissions.limit, 72); assert.ok(Buffer.byteLength(JSON.stringify(packet)) <= VELA_OPERATIONS_LIMITS.maxEncodedBytes);
  assert.equal(projectVelaOperations(state, f.host, { maxOperations: 2 }).operations.length, 2);
  const tiny = projectVelaOperations(state, f.host, { maxEncodedBytes: 1024 });
  assert.equal(tiny.operations.length, 0); assert.equal(tiny.omissions.budget, 64); assert.ok(Buffer.byteLength(JSON.stringify(tiny)) <= 1024);
  f.request.intent = '🌍'.repeat(3000);
  const bounded = projectVelaOperations(f.state, f.host).operations[0];
  assert.equal(bounded.intentTruncated, true); assert.ok(Buffer.byteLength(bounded.originalIntent) <= VELA_OPERATIONS_LIMITS.maxIntentBytes);
  assert.doesNotMatch(bounded.originalIntent, /\uFFFD/);
  assert.throws(() => projectVelaOperations(state, f.host, { maxOperations: 9 }), /vela_operations_invalid_limits/);
  assert.throws(() => projectVelaOperations(state, f.host, { maxEncodedBytes: Infinity }), /vela_operations_invalid_limits/);
});

test('placement limits and duplicate block identities fail closed', () => {
  const f = fixture();
  for (const count of [2, 129]) {
    f.setSnapshot({ workspace: { kind: 'workspace', id: 'workspace:result', version: 4 }, placements: Array.from({ length: count }, () =>
      ({ blockId: 'block:duplicate', resource: { kind: 'resource' as const, id: 'resource:1', version: 5 } })) });
    assert.equal(projectVelaOperations(f.state, f.host).operations[0].verification.state, 'unavailable');
  }
});

test('duplicate or inconsistent durable joins never produce an invented receipt target', () => {
  const f = fixture();
  assert.equal(projectVelaOperations({ ...f.state, requests: [f.request, structuredClone(f.request)] }, f.host).operations.length, 0);
  assert.equal(projectVelaOperations({ ...f.state, receipts: [f.receipt, structuredClone(f.receipt)] }, f.host).operations.length, 0);
  f.receipt.stepId = 'step:unrelated'; assert.equal(projectVelaOperations(f.state, f.host).operations.length, 0);
});

test('unrelated scope growth preserves an approved packet while actual dependency revocation invalidates it', () => {
  const f = fixture(), packet = projectVelaOperations(f.state, f.host);
  f.scope.resourceIds.push('resource:unrelated-executor');
  assert.doesNotThrow(() => validateVelaOperations(packet, f.state, f.host));
  assert.equal(projectVelaOperations(f.state, f.host).digest, packet.digest);
  f.scope.resourceIds.splice(f.scope.resourceIds.indexOf('resource:2'), 1);
  assert.throws(() => validateVelaOperations(packet, f.state, f.host), /vela_operations_changed/);
});

test('scope changes within a projection fail closed; tampered packets cannot validate or resolve', () => {
  const f = fixture(), packet = projectVelaOperations(f.state, f.host), changed = JSON.parse(JSON.stringify(packet));
  changed.operations[0].receiptId = 'receipt:invented';
  assert.throws(() => validateVelaOperations(changed, f.state, f.host), /vela_operations_changed/);
  assert.equal(resolveVelaOperationReferent('undo that', changed).kind, 'none');
  let scopes = 0;
  f.host.scope = () => ({ ...structuredClone(f.scope), policyVersion: ++scopes === 1 ? 'policy:1' : 'policy:2' });
  assert.throws(() => projectVelaOperations(f.state, f.host), /vela_operations_scope_changed/);
});

test('referent resolution points to real receipt IDs for corrections, undo and retry without granting authority', () => {
  const f = fixture(), packet = projectVelaOperations(f.state, f.host);
  for (const [intent, purpose] of [
    ['Undo that', 'undo'], ['Try again', 'retry'], ["You didn't create the workspace", 'correction'],
    ['Fix receipt:1', 'correction'], ['Undo Synthetic Minecraft workspace', 'undo'],
  ]) {
    const result = resolveVelaOperationReferent(intent, packet);
    assert.deepEqual(result, { kind: 'resolved', authority: 'none', purpose, receiptId: 'receipt:1', requestId: 'request:1', planId: 'plan:1' });
  }
  assert.equal(resolveVelaOperationReferent('What time is it?', packet).kind, 'none');
  assert.equal(resolveVelaOperationReferent('Undo some unrelated project', packet).kind, 'none');
  assert.equal(resolveVelaOperationReferent('Undo receipt:999', packet).kind, 'none');
  assert.equal(resolveVelaOperationReferent('Undo that receipt:999', packet).kind, 'none');
  assert.equal(resolveVelaOperationReferent('Undo that workspace called Vacation', packet).kind, 'none');
  assert.equal(resolveVelaOperationReferent('Fix that workspace "Vacation"', packet).kind, 'none');
});

test('ambiguous corrections preserve all real candidates; an explicitly last action can resolve', () => {
  const f = fixture(), request = structuredClone(f.request), plan = structuredClone(f.plan), receipt = structuredClone(f.receipt);
  request.id = 'request:2'; request.planId = 'plan:2'; plan.id = 'plan:2'; plan.requestId = request.id;
  receipt.id = 'receipt:2'; receipt.requestId = request.id; receipt.planId = plan.id; receipt.startedAt = '2026-11-03T12:01:00.000Z';
  const packet = projectVelaOperations({ requests: [f.request, request], plans: [f.plan, plan], receipts: [f.receipt, receipt] }, f.host);
  assert.deepEqual(resolveVelaOperationReferent('Undo that workspace', packet), { kind: 'ambiguous', authority: 'none', purpose: 'undo', candidateReceiptIds: ['receipt:2', 'receipt:1'] });
  assert.deepEqual(resolveVelaOperationReferent('Fix Synthetic Minecraft workspace', packet), { kind: 'ambiguous', authority: 'none', purpose: 'correction', candidateReceiptIds: ['receipt:2', 'receipt:1'] });
  const last = resolveVelaOperationReferent('Undo the last action', packet);
  assert.equal(last.kind, 'resolved'); if (last.kind === 'resolved') assert.equal(last.receiptId, 'receipt:2');
  const exact = resolveVelaOperationReferent('Undo receipt:1', packet);
  assert.equal(exact.kind, 'resolved'); if (exact.kind === 'resolved') assert.equal(exact.receiptId, 'receipt:1');
  const immediate = resolveVelaOperationReferent("I literally just told you to make a workspace and you didn't!", packet);
  assert.equal(immediate.kind, 'resolved'); if (immediate.kind === 'resolved') assert.equal(immediate.receiptId, 'receipt:2');
  const namedImmediate = resolveVelaOperationReferent('Fix Synthetic Minecraft workspace I just asked for', packet);
  assert.equal(namedImmediate.kind, 'resolved'); if (namedImmediate.kind === 'resolved') assert.equal(namedImmediate.receiptId, 'receipt:2');
  assert.equal(resolveVelaOperationReferent('Fix that receipt:unknown I just mentioned', packet).kind, 'none');
  receipt.startedAt = f.receipt.startedAt;
  const tied = projectVelaOperations({ requests: [f.request, request], plans: [f.plan, plan], receipts: [f.receipt, receipt] }, f.host);
  assert.equal(resolveVelaOperationReferent("You just didn't make the workspace", tied).kind, 'ambiguous');
});

test('a later operation inspection never displaces the mutation being corrected or retried', () => {
  const f = fixture(), inspectedRequest = structuredClone(f.request), inspectedPlan = structuredClone(f.plan), inspectedReceipt = structuredClone(f.receipt);
  inspectedRequest.id = 'request:inspect'; inspectedRequest.planId = 'plan:inspect';
  inspectedPlan.id = 'plan:inspect'; inspectedPlan.requestId = inspectedRequest.id;
  inspectedPlan.steps[0].action = { type: 'inspectVelaOperation', workspaceId: 'workspace:result', receiptId: f.receipt.id };
  inspectedReceipt.id = 'receipt:inspect'; inspectedReceipt.requestId = inspectedRequest.id; inspectedReceipt.planId = inspectedPlan.id;
  inspectedReceipt.startedAt = '2026-11-03T12:01:00.000Z'; delete inspectedReceipt.createdWorkspaceId;
  const packet = projectVelaOperations({ requests: [f.request, inspectedRequest], plans: [f.plan, inspectedPlan], receipts: [f.receipt, inspectedReceipt] }, f.host);
  assert.equal(packet.operations.length, 2);
  for (const intent of ["You just didn't make the workspace", 'Fix that workspace', 'Try again']) {
    const referent = resolveVelaOperationReferent(intent, packet);
    assert.equal(referent.kind, 'resolved'); if (referent.kind === 'resolved') assert.equal(referent.receiptId, f.receipt.id);
  }
});

test('query selection brings an earlier authorized receipt beyond four recent operations into the bounded packet',()=>{
  const f=fixture(),requests=[f.request],plans=[f.plan],receipts=[f.receipt];f.request.intent='Prepare the Aurora release workspace';
  for(let i=0;i<30;i++){
    const request=structuredClone(f.request),plan=structuredClone(f.plan),receipt=structuredClone(f.receipt);
    request.id='request:filler:'+i;request.planId=plan.id='plan:filler:'+i;request.intent='Organize unrelated harbor '+i;
    plan.requestId=request.id;receipt.id='receipt:filler:'+i;receipt.requestId=request.id;receipt.planId=plan.id;
    receipt.startedAt=new Date(Date.parse(f.receipt.startedAt)+(i+1)*1000).toISOString();requests.push(request);plans.push(plan);receipts.push(receipt);
  }
  const state={requests,plans,receipts},recent=projectVelaOperations(state,f.host,{maxOperations:4,maxEncodedBytes:16384});
  assert(!recent.operations.some(operation=>operation.receiptId===f.receipt.id));
  const selected=projectVelaOperations(state,f.host,{maxOperations:4,maxEncodedBytes:16384,query:'Recall earlier Aurora release'});
  assert.equal(selected.operations[0].receiptId,f.receipt.id);assert.equal(selected.operations.length,4);validateVelaOperations(selected,state,f.host);
  assert(!JSON.stringify(selected).includes('SECRET_'));f.denied.add('resource:1');assert.throws(()=>validateVelaOperations(selected,state,f.host),/vela_operations_changed/);
});
