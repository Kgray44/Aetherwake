import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { ConversationProductRequest, ProviderPort, VelaBackendState, VelaOperation } from '../src/contracts.mts';
import type { ActionReceipt, VelaNativeAction, VelaPlan, VelaPlanningPort } from '../../vela-core/src/contracts.ts';
import type { Collection, ProductCommandMap } from '../../conversation-product/src/contracts.ts';
import { validateAction } from '../../vela-core/src/capabilities.ts';

function fixture(planner?: VelaPlanningPort) {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-vela-collection-actions-')),
    path = join(dir, 'canonical.sqlite');
  let connections = 0;
  const open = () => {
    const value = new BackendCore({
      path,
      privateRoot: dir,
      cwd: dir,
      provider: planner ? 'fixture' : 'codex',
      contentPolicy: planner ? 'synthetic-only' : 'local-private',
      ...(planner ? { velaPlanningPort: planner } : {}),
    });
    (value as unknown as { port: ProviderPort }).port.connect = async () => {
      connections++;
      throw new Error('Collection actions must remain offline');
    };
    return value;
  };
  let core = open();
  const vela = (name: VelaOperation['name'], input: unknown = {}) => core.command('vela', { name, input } as VelaOperation);
  const product = (name: keyof ProductCommandMap, input: unknown = {}) => core.command('conversation', { name, input } as ConversationProductRequest);
  const prepare = (action: VelaNativeAction) => vela('native', { intent: 'Synthetic explicit native ' + action.type, action }) as Promise<VelaPlan>;
  const state = () => vela('state') as Promise<VelaBackendState>;
  const apply = async (action: VelaNativeAction) => {
    const plan = await prepare(action),
      applied = (await vela('apply', plan.id)) as VelaPlan;
    const receipt = (await state()).receipts.find((item) => item.planId === plan.id)!;
    assert.equal(applied.state, 'applied', action.type + ': ' + receipt?.errorCode);
    assert(receipt, 'Authorized completed action receipt remains inspectable');
    assert.equal(receipt.taskVerified, false);
    return { plan: applied, receipt };
  };
  const db = () => (core as unknown as { db: DatabaseSync }).db;
  return {
    get core() {
      return core;
    },
    vela,
    product,
    prepare,
    apply,
    state,
    db,
    connections: () => connections,
    async collection(id: string) {
      return ((await product('collections')) as Collection[]).find((c) => c.id === id)!;
    },
    async reopen() {
      await core.command('close', {});
      core = open();
    },
    async close() {
      await core.command('close', {});
      const target = resolve(dir),
        part = relative(resolve(tmpdir()), target);
      assert(part.startsWith('aerynth-vela-collection-actions-') && !part.startsWith('..') && !isAbsolute(part));
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test('Vela uses canonical collection IDs, memberships and archive receipts through restart without copying resources, drafts or conversations', async () => {
  const f = fixture();
  try {
    const project = await f.apply({ type: 'createProject', title: 'Synthetic collection project' }),
      projectId = project.receipt.createdProjectId!;
    await f.apply({ type: 'createWorkspace', title: 'Synthetic collection workspace', projectId });
    const chat = await f.apply({ type: 'createConversation', title: 'Synthetic collection conversation', providerId: 'local' }),
      resourceId = chat.receipt.createdResourceId!;
    await f.core.command('addMessage', { resourceId, role: 'user', content: 'Synthetic preserved collection message', expectedRevision: 1 });
    const draft = await f.product('saveDraft', { resourceId, expectedVersion: 0, content: 'Synthetic preserved folder draft' });
    const before = await f.core.command('snapshot', {}),
      graphId = before.resourceMap[resourceId],
      messages = JSON.stringify(before.graph.messages.filter((m) => m.conversationId === graphId));
    const created = await f.apply({ type: 'createCollection', title: 'Synthetic Vela folder', projectId }),
      collectionId = created.receipt.createdCollectionId!;
    assert(collectionId);
    assert(!(await f.core.command('desktop', { type: 'snapshot' })).resources.some((r) => r.id === collectionId), 'A collection is not a resource copy');
    const ref = ((await f.vela('search', 'Synthetic Vela folder')) as { id: string; kind: string }[]).find((item) => item.id === collectionId)!;
    assert.equal(ref.kind, 'collection');
    const membership = await f.apply({ type: 'collectionMembership', collectionId, resourceId, member: true });
    assert(membership.plan.targets.some((target) => target.kind === 'collection' && target.id === collectionId));
    assert(membership.plan.targets.some((target) => target.kind === 'resource' && target.id === resourceId));
    const count = (await f.collection(collectionId)).version;
    await f.apply({ type: 'collectionMembership', collectionId, resourceId, member: true });
    assert.equal((await f.collection(collectionId)).version, count, 'Already-present membership is a canonical no-op');
    await f.apply({ type: 'renameCollection', collectionId, title: 'Synthetic renamed folder' });
    const archived = await f.apply({ type: 'archiveCollection', collectionId, archived: true });
    assert((await f.state()).plans.some((plan) => plan.id === archived.plan.id));
    assert((await f.state()).receipts.some((receipt) => receipt.id === archived.receipt.id));
    assert(
      !((await f.vela('search', 'Synthetic renamed folder')) as { id: string }[]).some((item) => item.id === collectionId),
      'Ordinary search cannot rediscover archived metadata',
    );
    assert(!((await f.product('collections')) as Collection[]).some((item) => item.id === collectionId));
    await f.reopen();
    assert(
      (await f.state()).receipts.some((receipt) => receipt.id === archived.receipt.id),
      'Applied archive audit survives native-service restart',
    );
    assert.equal(((await f.vela('apply', archived.plan.id)) as VelaPlan).state, 'applied');
    const restored = await f.apply({ type: 'archiveCollection', collectionId, archived: false });
    assert.equal(restored.plan.targets.find((target) => target.id === collectionId)!.state, 'archived', 'Only explicit restoration receives archived metadata');
    assert.equal((await f.collection(collectionId)).title, 'Synthetic renamed folder');
    assert.deepEqual((await f.collection(collectionId)).pinnedIds, [resourceId]);
    await f.apply({ type: 'collectionMembership', collectionId, resourceId, member: false });
    assert.deepEqual((await f.collection(collectionId)).pinnedIds, []);
    for (const planId of [created.plan.id, membership.plan.id, restored.plan.id]) assert.equal(((await f.vela('apply', planId)) as VelaPlan).state, 'applied');
    assert.equal(((await f.product('collections')) as Collection[]).filter((c) => c.id === collectionId).length, 1);
    const after = await f.core.command('snapshot', {});
    assert.deepEqual(after.resourceMap, before.resourceMap);
    assert.equal(JSON.stringify(after.graph.messages.filter((m) => m.conversationId === graphId)), messages);
    assert.deepEqual(after.graph.edges, before.graph.edges);
    assert.deepEqual(await f.product('readDraft', { resourceId }), draft);
    assert.deepEqual(after.executions, {});
    assert.deepEqual(after.bindings, {});
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test('collection entity, parent/rule and resource revisions invalidate prepared actions; archived or foreign targets cannot grant membership', async () => {
  const f = fixture();
  try {
    const a = await f.apply({ type: 'createProject', title: 'Synthetic collection A' }),
      b = await f.apply({ type: 'createProject', title: 'Synthetic collection B' }),
      projectA = a.receipt.createdProjectId!,
      projectB = b.receipt.createdProjectId!;
    await f.apply({ type: 'createWorkspace', title: 'Synthetic current collection workspace', projectId: projectA });
    const chat = await f.apply({ type: 'createConversation', title: 'Synthetic scoped collection chat', providerId: 'local' }),
      resourceId = chat.receipt.createdResourceId!;
    const first = await f.apply({ type: 'createCollection', title: 'Synthetic current folder', projectId: projectA }),
      parent = await f.apply({ type: 'createCollection', title: 'Synthetic parent folder', projectId: projectA }),
      collectionId = first.receipt.createdCollectionId!,
      parentId = parent.receipt.createdCollectionId!;
    const rename = await f.prepare({ type: 'renameCollection', collectionId, title: 'Must not replace a user rename' }),
      initial = await f.collection(collectionId);
    await f.product('organize', { type: 'renameCollection', collectionId, title: 'Synthetic user folder rename', expectedVersion: initial.version });
    await assert.rejects(f.vela('apply', rename.id), /stale_target_version/);
    const ruleStale = await f.prepare({ type: 'collectionMembership', collectionId, resourceId, member: true }),
      current = await f.collection(collectionId);
    await f.product('collectionRule', {
      collectionId,
      parentId: null,
      rule: { favorite: true },
      expectedVersion: current.version,
      expectedRuleRevision: current.ruleRevision,
    });
    await assert.rejects(f.vela('apply', ruleStale.id), /stale_target_version/);
    const parentStale = await f.prepare({ type: 'renameCollection', collectionId, title: 'Must not ignore a parent change' }),
      withRule = await f.collection(collectionId);
    await f.product('collectionRule', {
      collectionId,
      parentId,
      rule: withRule.rule,
      expectedVersion: withRule.version,
      expectedRuleRevision: withRule.ruleRevision,
    });
    await assert.rejects(f.vela('apply', parentStale.id), /stale_target_version/);
    const sourceStale = await f.prepare({ type: 'collectionMembership', collectionId, resourceId, member: true });
    await f.core.command('addMessage', { resourceId, role: 'user', content: 'Synthetic newer scoped message', expectedRevision: 1 });
    await assert.rejects(f.vela('apply', sourceStale.id), /stale_target_version/);
    await f.apply({ type: 'archiveCollection', collectionId, archived: true });
    await assert.rejects(f.prepare({ type: 'renameCollection', collectionId, title: 'Must not rename an archive' }), /resource_not_authorized/);
    await assert.rejects(f.prepare({ type: 'collectionMembership', collectionId, resourceId, member: true }), /resource_not_authorized/);
    const foreign = (await f.product('organize', { type: 'createCollection', title: 'Synthetic foreign archived folder', projectId: projectB })) as {
      id: string;
      version: number;
    };
    await f.product('organize', { type: 'archiveCollection', collectionId: foreign.id, archived: true, expectedVersion: foreign.version });
    await assert.rejects(f.prepare({ type: 'archiveCollection', collectionId: foreign.id, archived: false }), /resource_not_authorized/);
    await assert.rejects(f.prepare({ type: 'createCollection', title: 'Must not create in another project', projectId: projectB }), /resource_not_authorized/);
    await f.apply({ type: 'archiveCollection', collectionId, archived: false });
    const revoked = await f.prepare({ type: 'collectionMembership', collectionId, resourceId, member: true });
    const owner = (await f.core.command('desktop', { type: 'snapshot' })).projects.find((p) => p.id === projectA)!;
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'project', id: projectA, archived: true, expectedVersion: owner.version });
    await assert.rejects(f.vela('apply', revoked.id), /resource_not_authorized/);
    assert.equal(f.db().prepare('SELECT count(*) AS count FROM collection_members WHERE collection_id=?').get(collectionId)!.count, 0);
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test('archive audit requires an actual applied receipt, current owner and every other target; pending, failed and foreign records cannot expose it', async () => {
  let collectionId = '',
    resourceId = '';
  const planner: VelaPlanningPort = {
    providerId: 'synthetic-collection-planner',
    availability: () => ({ available: true, busy: false }),
    propose: async () => ({
      schemaVersion: 1,
      summary: 'Synthetic two-target policy regression',
      steps: [
        { id: 'archive', explanation: 'Actual collection archive', action: { type: 'archiveCollection', collectionId, archived: true } },
        { id: 'favorite', explanation: 'Actual separate conversation metadata', action: { type: 'conversationFavorite', resourceId, favorite: true } },
      ],
      contribution: { providerId: 'synthetic-collection-planner', classification: 'reported' },
    }),
  };
  const f = fixture(planner);
  try {
    const project = await f.apply({ type: 'createProject', title: 'Synthetic audit project' }),
      projectId = project.receipt.createdProjectId!;
    await f.apply({ type: 'createWorkspace', title: 'Synthetic audit workspace', projectId });
    const chat = await f.apply({ type: 'createConversation', title: 'Synthetic audit chat', providerId: 'local' });
    resourceId = chat.receipt.createdResourceId!;
    const folder = await f.apply({ type: 'createCollection', title: 'Synthetic audit folder', projectId });
    collectionId = folder.receipt.createdCollectionId!;
    const beforeMissing=await f.state();
    await assert.rejects(f.core.command('velaRequestPreview',{intent:'Recall the earlier Synthetic audit project operations',resourceIds:[]}),/vela_operation_context_unavailable/);
    assert.equal((await f.state()).requests.length,beforeMissing.requests.length,'an essential receipt that cannot fit never dispatches or guesses');
    // Real bounded user text guarantees pressure even with a smaller platform catalog.
    const intent='Synthetic explicit two-target regression. '+('Retain exact collection audit ownership and the independent conversation target; this is bounded synthetic context. '.repeat(18));
    const preview = await f.core.command('velaRequestPreview', { intent, resourceIds: [] }),
      review = await f.core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature}),
      grant = await f.core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature,reviewDigest:review.reviewDigest });
    const frozen=(f.core as any).velaPreviews.get(preview.id).frozenContext;
    assert(frozen.operations.limits.maxEncodedBytes<6144);assert(frozen.operations.omissions.budget>0);
    assert(Buffer.byteLength(review.prompt)<=16384);const wire=JSON.parse(review.prompt.split('\n').at(-1)!);
    const decode=(value:any):any=>!Array.isArray(value)?value:value[0]===0?Object.fromEntries(Array.from({length:(value.length-1)/2},(_,index)=>{
      const key=value[index*2+1];return [typeof key==='number'?wire.contextKeys[key]:key,decode(value[index*2+2])];
    })):value[0]===1?value.slice(1).map(decode):value[0]===2?wire.contextStrings[value[1]]:assert.fail('unknown JSON data tag');
    assert.deepEqual(wire.contextEncoding?decode(wire.context):wire.context,frozen,'the native-reviewed wire retains the complete chosen context and proof');
    assert.equal(wire.capabilities.length,(f.core as any).velaPreviews.get(preview.id).catalog.descriptors.length,'all authorized capabilities remain in the original hard budget');
    const request = (await f.vela('request', {
      intent: preview.intent,
      resourceIds: [],
      authorizeProvider: true,
      previewId: preview.id,
      grantId: grant.grantId,
    })) as { planId: string };
    let plan = (await f.state()).plans.find((p) => p.id === request.planId)!;
    await f.vela('review', { planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
    plan = (await f.vela('apply', plan.id)) as VelaPlan;
    assert.equal(plan.state, 'applied');
    assert((await f.state()).plans.some((p) => p.id === plan.id));
    const data = (f.core as unknown as { vela: { data: { plans: VelaPlan[]; receipts: ActionReceipt[] } } }).vela.data,
      stored = data.plans.find((p) => p.id === plan.id)!,
      receipt = data.receipts.find((r) => r.planId === plan.id && r.stepId === 'archive')!;
    // Fault-injected contract states use this real persisted action/receipt;
    // they do not claim another principal or provider was actually executed.
    for (const state of ['prepared', 'approved', 'failed', 'unknown'] as const) {
      const old = stored.state;
      stored.state = state;
      assert(!(await f.state()).plans.some((p) => p.id === plan.id));
      stored.state = old;
    }
    const principal = stored.scope.principalId;
    stored.scope.principalId = 'synthetic-foreign-principal';
    assert(!(await f.state()).plans.some((p) => p.id === plan.id));
    stored.scope.principalId = principal;
    const hostReceipt = receipt.hostReceiptId;
    delete receipt.hostReceiptId;
    assert(!(await f.state()).plans.some((p) => p.id === plan.id));
    receipt.hostReceiptId = hostReceipt;
    const oldReceiptState = receipt.state;
    receipt.state = 'failed';
    assert(!(await f.state()).plans.some((p) => p.id === plan.id));
    receipt.state = oldReceiptState;
    assert((await f.state()).receipts.some((r) => r.id === receipt.id));
    const current = (await f.core.command('desktop', { type: 'snapshot' })).resources.find((r) => r.id === resourceId)!;
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'resource', id: resourceId, archived: true, expectedVersion: current.version });
    assert(!(await f.state()).plans.some((p) => p.id === plan.id), 'Every other target still needs current visibility');
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'resource', id: resourceId, archived: false, expectedVersion: current.version + 1 });
    assert((await f.state()).plans.some((p) => p.id === plan.id));
    const other = (await f.product('organize', { type: 'createCollection', title: 'Synthetic pending folder', projectId })) as { id: string; version: number };
    const pending = await f.prepare({ type: 'archiveCollection', collectionId: other.id, archived: true });
    await f.product('organize', { type: 'archiveCollection', collectionId: other.id, archived: true, expectedVersion: other.version });
    assert(!(await f.state()).plans.some((p) => p.id === pending.id), 'Pending plans cannot use the historical archive exception');
    const owner = (await f.core.command('desktop', { type: 'snapshot' })).projects.find((p) => p.id === projectId)!;
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'project', id: projectId, archived: true, expectedVersion: owner.version });
    assert(!(await f.state()).plans.some((p) => p.id === plan.id));
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test('collection targets are unavailable on unsafe composite revisions and unsupported releases reject before mutation', async () => {
  const f = fixture();
  try {
    const created = await f.apply({ type: 'createCollection', title: 'Synthetic revision-limited folder', projectId: null }),
      collectionId = created.receipt.createdCollectionId!;
    const normal = await f.apply({ type: 'createCollection', title: 'Synthetic ordinary folder', projectId: null });
    f.db().prepare('INSERT INTO cp_collection_rules VALUES(?,NULL,NULL,?)').run(collectionId, 200000000);
    assert(!((await f.vela('search', 'Synthetic revision-limited folder')) as { id: string }[]).some((r) => r.id === collectionId));
    assert(((await f.vela('search', 'Synthetic ordinary folder')) as { id: string }[]).some((r) => r.id === normal.receipt.createdCollectionId));
    await assert.rejects(f.prepare({ type: 'renameCollection', collectionId, title: 'Must not overflow a target token' }), /resource_not_authorized/);
    for (const invalid of [
      { type: 'archiveCollection', collectionId, archived: false, restoreCollection: true },
      { type: 'renameCollection', collectionId, title: 'Synthetic', expectedVersion: 1 },
      { type: 'collectionMembership', collectionId, resourceId: 'r', member: true, grantId: 'forged' },
    ])
      assert.throws(() => validateAction(invalid), /unsupported_or_invalid_action/);
    f.core.registerVelaNativeCapabilities({
      supportedActions: [],
      dispatch: () => {
        throw new Error('Disabled capability must not dispatch');
      },
    });
    const state = await f.state();
    for (const id of ['createCollection', 'renameCollection', 'archiveCollection', 'collectionMembership']) {
      assert.equal(state.nativeCapabilities[id].available, false);
      assert(!state.capabilities.some((c) => c.id === id));
    }
    await assert.rejects(f.prepare({ type: 'createCollection', title: 'Disabled folder', projectId: null }), /host_policy_denied/);
    assert.equal(f.connections(), 0);
    assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
  } finally {
    await f.close();
  }
});
