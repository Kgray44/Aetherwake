import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { VelaWorkspaceRepair, type VelaWorkspaceRepairAction, type WorkspaceRepairHost } from '../src/vela-workspace-repair.mts';
import type { VelaBackendState } from '../src/contracts.mts';
import type { ActionReceipt, ResourceRef, VelaPlanningPort, VelaWorkspaceConstructionReceipt } from '../../vela-core/src/contracts.ts';
import type { WorkspaceProjection } from '../../workspace-engine/contracts.mts';

const COMPLAINT = "I literally just told you to make a workspace and you didn't!";
const inside = (core: BackendCore): any => core;
const state = (core: BackendCore) => core.command('vela', { name: 'state', input: {} }) as Promise<VelaBackendState>;
const engine = (core: BackendCore) => inside(core).desktop.nativeBlockServices().engine;
const inspect = (core: BackendCore, id: string): WorkspaceProjection => engine(core).inspectWorkspace(id);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-vela-repair-')), path = join(dir, 'canonical.sqlite');
  const attempts = { connections: 0, turns: 0, planning: 0 };
  const planner: VelaPlanningPort = { providerId: 'synthetic-repair-tripwire', availability: () => ({ available: true, busy: false }),
    propose: async () => { attempts.planning++; throw new Error('Repair must not call a model'); } };
  const open = () => {
    const core = new BackendCore({ path, provider: 'fixture', contentPolicy: 'synthetic-only', velaPlanningPort: planner });
    inside(core).port.connect = async () => { attempts.connections++; throw new Error('Repair must remain offline'); };
    inside(core).port.turn = async () => { attempts.turns++; throw new Error('Repair must remain offline'); };
    return core;
  };
  let core = open(); const restorers: (() => void)[] = [];
  const restore = () => { while (restorers.length) restorers.pop()!(); };
  const allocated = () => readdirSync(dir).reduce((sum, entry) => sum + statSync(join(dir, entry)).size, 0);
  return { get core() { return core; }, attempts,
    patch(target: any, name: string, replacement: any) { const original = target[name]; target[name] = replacement;
      restorers.push(() => { target[name] = original; }); return original; }, restore,
    async reopen() { restore(); await core.command('close', {}); core = open(); },
    async close() { restore();
      try { assert.ok(allocated() < 8 * 1024 * 1024, 'owned fixture remains within its 8 MiB allocation bound'); await core.command('close', {}); }
      finally { const target = resolve(dir), child = relative(resolve(tmpdir()), target);
        assert.ok(child.startsWith('aerynth-vela-repair-') && !child.startsWith('..') && !isAbsolute(child)); rmSync(target, { recursive: true, force: true }); }
    },
  };
}
async function construct(core: BackendCore, intent = 'Create a workspace for A World for Two for Minecraft.') {
  const result = await core.command('velaRouteNative', { intent }); assert.ok(result.matched);
  assert.equal(result.request.state, 'completed', result.request.errorCode);
  const vela = await state(core), receipt = vela.receipts.find(item => item.requestId === result.request.id);
  assert.ok(receipt?.workspaceConstruction); return { receipt, proof: structuredClone(receipt.workspaceConstruction) };
}
function host(core: BackendCore) {
  const recorded: { sourceReceiptId: string; proof: VelaWorkspaceConstructionReceipt }[] = [];
  const value: WorkspaceRepairHost = {
    templates: inside(core).library,
    operationContext: () => inside(core).vela.operationContext(inside(core).inspectVelaOperationWorkspace),
    validateOperationContext: packet => inside(core).vela.validateOperationContext(packet, inside(core).inspectVelaOperationWorkspace),
    inspectWorkspace: id => inspect(core, id),
    resource: id => inside(core).velaHost.resolve({ kind: 'resource', id }, inside(core).velaHost.scope()) as ResourceRef | null,
    resourceVersion: id => { try { return inside(core).kernel.getResource(id).resource.version; } catch { return null; } },
    atomic: work => inside(core).atomic(work), once: (commandId, input, work) => inside(core).once(commandId, input, work),
    record: (_workspaceId, proof, sourceReceiptId) => { recorded.push({ sourceReceiptId, proof: structuredClone(proof) }); },
  };
  return { value, recorded };
}
function action(receipt: ActionReceipt, proof: VelaWorkspaceConstructionReceipt): VelaWorkspaceRepairAction {
  return { type: 'repairWorkspace', workspaceId: proof.workspaceId, receiptId: receipt.id,
    resourceIds: [...new Set(proof.resources.map(resource => resource.resourceId))] };
}
function losePlacement(core: BackendCore, workspaceId: string, blockId: string) {
  // Synthetic canonical-storage fault: references/content and historical receipts deliberately survive.
  inside(core).atomic(() => inside(core).db.prepare('DELETE FROM blocks WHERE id=? AND workspace_id=?').run(blockId, workspaceId));
  assert.ok(!inspect(core, workspaceId).blocks.some(block => block.blockId === blockId));
}
function preserve(block: WorkspaceProjection['blocks'][number]) {
  const { version: _version, ...rest } = block; return rest;
}
async function canonical(core: BackendCore) {
  const db = inside(core).db;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => String(row.name))
    .filter((name: string) => /^(projects|workspaces|resources|blocks|desktop_resources|workspace_.*|block_library_.*|checklist_.*)$/.test(name)).sort();
  return { tables: Object.fromEntries(tables.map((name: string) => {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return [name, db.prepare('SELECT * FROM "' + name + '"').all().map((row: any) => JSON.stringify(row)).sort()];
  })), snapshot: await core.command('snapshot', {}), domainReceipts: structuredClone(inside(core).state.receipts) };
}
async function offline(f: ReturnType<typeof fixture>) {
  assert.deepEqual(f.attempts, { connections: 0, turns: 0, planning: 0 });
  const activity = await f.core.command('providerActivity', {});
  assert.equal(activity.codexConnections, 0); assert.equal(activity.providerRequests, 0);
  assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
}

test('the exact follow-up repairs a lost placement in the same workspace and preserves edited content, manual geometry and camera', async () => {
  const f = fixture();
  try {
    const { receipt: original, proof } = await construct(f.core), desktop = await f.core.command('desktop', { type: 'snapshot' });
    const note = desktop.resources.find(resource => proof.resources.some(item => item.resourceId === resource.id) && resource.kind === 'note')!;
    const checklist = desktop.resources.find(resource => proof.resources.some(item => item.resourceId === resource.id) && resource.kind === 'checklist')!;
    const lost = proof.placements.find(binding => binding.resourceId === checklist.id)!, initial = inspect(f.core, proof.workspaceId);
    const noteBlock = initial.blocks.find(block => block.resourceId === note.id)!, lostBlock = initial.blocks.find(block => block.blockId === lost.blockId)!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'Synthetic user-edited Minecraft note must remain exact.' });
    losePlacement(f.core, proof.workspaceId, lost.blockId);
    inside(f.core).atomic(() => engine(f.core).execute({ type: 'moveBlock', commandId: randomUUID(), workspaceId: proof.workspaceId,
      expectedRevision: inspect(f.core, proof.workspaceId).revision, blockId: noteBlock.blockId, x: lostBlock.x, y: lostBlock.y }));
    inside(f.core).atomic(() => engine(f.core).execute({ type: 'saveLayout', commandId: randomUUID(), workspaceId: proof.workspaceId,
      expectedRevision: inspect(f.core, proof.workspaceId).revision, placements: [], viewport: { x: 230, y: -41, zoom: 0.83 } }));
    const before = inspect(f.core, proof.workspaceId), sourceReceipt = structuredClone((await state(f.core)).receipts.find(item => item.id === original.id));
    const reply = await f.core.command('velaRouteNative', { intent: COMPLAINT }); assert.ok(reply.matched);
    assert.equal(reply.request.state, 'completed', reply.request.errorCode);
    const vela = await state(f.core), repair = vela.receipts.find(item => item.requestId === reply.request.id)!;
    assert.equal(vela.plans.find(plan => plan.id === reply.request.planId)?.steps[0].action.type, 'repairWorkspace');
    assert.equal(repair.state, 'applied'); assert.equal(repair.createdWorkspaceId, undefined); assert.equal(repair.taskVerified, false);
    assert.ok(repair.workspaceConstruction); assert.equal(repair.workspaceConstruction.workspaceId, proof.workspaceId);
    assert.deepEqual(vela.receipts.find(item => item.id === original.id), sourceReceipt);
    const after = inspect(f.core, proof.workspaceId), replacement = after.blocks.find(block => block.resourceId === checklist.id)!;
    assert.equal(after.blocks.length, initial.blocks.length); assert.notEqual(replacement.blockId, lost.blockId);
    assert.ok(replacement.y >= Math.max(before.presence.y + before.presence.height, ...before.blocks.map(block => block.y + block.height)) + 24);
    for (const block of before.blocks) assert.deepEqual(preserve(after.blocks.find(item => item.blockId === block.blockId)!), preserve(block));
    assert.deepEqual(after.viewport, before.viewport); assert.deepEqual(after.presence, before.presence);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).resources.find(resource => resource.id === note.id)?.content, 'Synthetic user-edited Minecraft note must remain exact.');
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).workspaces.length, 1);
    assert.ok(repair.workspaceConstruction.resources.every(resource => resource.reused));
    const next = await f.core.command('velaRouteNative', { intent: COMPLAINT }); assert.ok(next.matched); assert.equal(next.request.state, 'completed');
    assert.equal((await state(f.core)).plans.find(plan => plan.id === next.request.planId)?.steps[0].action.type, 'inspectVelaOperation');
    assert.deepEqual(inspect(f.core, proof.workspaceId), after);
    await f.reopen(); assert.deepEqual(inspect(f.core, proof.workspaceId), after);
    assert.deepEqual((await state(f.core)).receipts.find(item => item.id === repair.id)?.workspaceConstruction, repair.workspaceConstruction);
    await offline(f);
  } finally { await f.close(); }
});

test('free historical holes restore all three resource kinds without cloning notes, checklist data or conversation history', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), old = inspect(f.core, proof.workspaceId);
    const desktop = await f.core.command('desktop', { type: 'snapshot' }), chat = desktop.resources.find(item => item.kind === 'conversation' && proof.resources.some(resource => resource.resourceId === item.id))!;
    const conversation = (await f.core.command('snapshot', {})).conversations.find(item => item.resourceId === chat.id)!;
    await f.core.command('addMessage', { resourceId: chat.id, role: 'user', content: 'Synthetic existing chat history remains canonical through repair.', expectedRevision: conversation.revision });
    const before = await f.core.command('snapshot', {}), resourcesBefore = before.resources.map(item => item.resource.id).sort(), h = host(f.core);
    for (const lost of old.blocks) {
      losePlacement(f.core, proof.workspaceId, lost.blockId);
      const commit = await new VelaWorkspaceRepair(h.value).prepare(action(receipt, proof), randomUUID(), new AbortController().signal);
      const result = commit(), replacement = inspect(f.core, proof.workspaceId).blocks.find(block => block.resourceId === lost.resourceId)!;
      assert.equal(result.status, 'applied'); assert.equal(result.createdWorkspaceId, undefined);
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) assert.equal(replacement[key], lost[key]);
      assert.notEqual(replacement.blockId, lost.blockId);
      const after = await f.core.command('snapshot', {});
      assert.deepEqual(after.resources.map(item => item.resource.id).sort(), resourcesBefore);
      assert.deepEqual(after.graph, before.graph); assert.deepEqual(after.resourceMap, before.resourceMap);
    }
    assert.equal(h.recorded.length, old.blocks.length); await offline(f);
  } finally { await f.close(); }
});

test('an equivalent resource placement supersedes its lost ID without duplication; domain replay survives restart', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), old = inspect(f.core, proof.workspaceId), lost = old.blocks[1];
    losePlacement(f.core, proof.workspaceId, lost.blockId);
    const ref: ResourceRef = inside(f.core).velaHost.resolve({ kind: 'resource', id: lost.resourceId }, inside(f.core).velaHost.scope());
    const replacement = inside(f.core).atomic(() => inside(f.core).library.attachBlock({ commandId: randomUUID(), workspaceId: proof.workspaceId,
      expectedLayoutVersion: inspect(f.core, proof.workspaceId).revision, kind: ref.resourceKind, resourceId: lost.resourceId,
      expectedResourceVersion: inside(f.core).kernel.getResource(lost.resourceId).resource.version,
      presentation: Object.fromEntries(['x', 'y', 'width', 'height', 'zIndex', 'rotation', 'shape', 'minimized', 'locked', 'materialVariant'].map(key => [key, (lost as any)[key]])) }));
    const before = inspect(f.core, proof.workspaceId), h = host(f.core), commandId = randomUUID();
    const commit = await new VelaWorkspaceRepair(h.value).prepare(action(receipt, proof), commandId, new AbortController().signal);
    const first = commit(); assert.deepEqual(commit(), first); assert.equal(h.recorded.length, 1);
    assert.equal(first.workspaceConstruction?.placements.find(binding => binding.resourceId === lost.resourceId)?.blockId, replacement.placementId);
    assert.deepEqual(inspect(f.core, proof.workspaceId), before);
    await f.reopen(); const restartedHost = host(f.core);
    const replay = await new VelaWorkspaceRepair(restartedHost.value).prepare(action(receipt, proof), commandId, new AbortController().signal);
    assert.deepEqual(replay(), first); assert.equal(restartedHost.recorded.length, 0);
    assert.deepEqual(inspect(f.core, proof.workspaceId), before); await offline(f);
  } finally { await f.close(); }
});

test('repair is confined to its exact workspace and preserves the active other workspace', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), lost = inspect(f.core, proof.workspaceId).blocks[1]; losePlacement(f.core, proof.workspaceId, lost.blockId);
    const other = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic untouched second workspace', projectId: proof.projectId });
    const otherId = other.activeWorkspaceId!;
    await f.core.command('desktop', { type: 'createResource', workspaceId: otherId, kind: 'note', title: 'Synthetic unrelated note' });
    const beforeOther = inspect(f.core, otherId), h = host(f.core);
    const commit = await new VelaWorkspaceRepair(h.value).prepare(action(receipt, proof), randomUUID(), new AbortController().signal); commit();
    assert.deepEqual(inspect(f.core, otherId), beforeOther);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).activeWorkspaceId, otherId);
    assert.equal(inspect(f.core, proof.workspaceId).blocks.length, proof.placements.length); await offline(f);
  } finally { await f.close(); }
});

test('an additional manual subject card is preserved through count-only operation coverage', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), initial = inspect(f.core, proof.workspaceId), lost = initial.blocks[1];
    assert.ok(proof.projectId);
    const overview = await f.core.command('library', { name: 'createSubjectBlock', input: { commandId: randomUUID(), workspaceId: proof.workspaceId,
      expectedLayoutVersion: initial.revision, kind: 'project_overview', subject: { kind: 'project', projectId: proof.projectId },
      presentation: { x: 2200, y: 200, width: 600, height: 500 } } });
    const subjectId = (overview.result as { placementId: string }).placementId;
    losePlacement(f.core, proof.workspaceId, lost.blockId);
    const before = inspect(f.core, proof.workspaceId), subject = before.blocks.find(block => block.blockId === subjectId)!;
    assert.equal(subject.resourceId, undefined);
    const h = host(f.core), packet = h.value.operationContext(), operation = packet.operations.find(item => item.receiptId === receipt.id)!;
    assert.equal(operation.observed?.placementCount, before.blocks.length);
    assert.equal(operation.observed?.placements.length, before.blocks.length - 1);
    assert.ok(!JSON.stringify(operation).includes(subjectId));
    const commit = await new VelaWorkspaceRepair(h.value).prepare(action(receipt, proof), randomUUID(), new AbortController().signal), result = commit();
    const after = inspect(f.core, proof.workspaceId);
    assert.deepEqual(preserve(after.blocks.find(block => block.blockId === subjectId)!), preserve(subject));
    assert.deepEqual(after.viewport, before.viewport); assert.equal(after.blocks.length, initial.blocks.length + 1);
    assert.ok(!result.workspaceConstruction?.placements.some(binding => binding.blockId === subjectId)); await offline(f);
  } finally { await f.close(); }
});

test('unknown, mismatched and revoked inputs cannot repair or disclose a withdrawn construction', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), lost = inspect(f.core, proof.workspaceId).blocks[1]; losePlacement(f.core, proof.workspaceId, lost.blockId);
    const h = host(f.core), service = new VelaWorkspaceRepair(h.value), source = action(receipt, proof), before = await canonical(f.core);
    await assert.rejects(service.prepare({ ...source, receiptId: 'receipt:unknown' }, randomUUID(), new AbortController().signal), /receipt_unavailable/);
    await assert.rejects(service.prepare({ ...source, workspaceId: 'workspace:unknown' }, randomUUID(), new AbortController().signal), /receipt_unavailable/);
    await assert.rejects(service.prepare({ ...source, resourceIds: source.resourceIds.slice(1) }, randomUUID(), new AbortController().signal), /manifest_mismatch/);
    assert.deepEqual(await canonical(f.core), before);
    const resource = (await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.id === lost.resourceId)!;
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'resource', id: resource.id, expectedVersion: resource.version, archived: true });
    const revokedBefore = await canonical(f.core);
    await assert.rejects(service.prepare(source, randomUUID(), new AbortController().signal), /receipt_unavailable/);
    const packet = h.value.operationContext(); assert.equal(packet.operations.length, 0);
    assert.ok(!JSON.stringify(packet).includes(proof.templateId)); assert.deepEqual(await canonical(f.core), revokedBefore);
    assert.equal(h.recorded.length, 0); await offline(f);
  } finally { await f.close(); }
});

test('source and layout changes or cancellation between preparation and commit fail before writes', async () => {
  const f = fixture();
  try {
    const { receipt, proof } = await construct(f.core), lost = inspect(f.core, proof.workspaceId).blocks[1]; losePlacement(f.core, proof.workspaceId, lost.blockId);
    const h = host(f.core), service = new VelaWorkspaceRepair(h.value), source = action(receipt, proof);
    let commit = await service.prepare(source, randomUUID(), new AbortController().signal);
    const note = (await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.kind === 'note')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'Synthetic changed after prepare.' });
    let before = await canonical(f.core); assert.throws(commit, /operations_changed|sources_changed/); assert.deepEqual(await canonical(f.core), before);
    commit = await service.prepare(source, randomUUID(), new AbortController().signal);
    inside(f.core).atomic(() => engine(f.core).execute({ type: 'saveLayout', commandId: randomUUID(), workspaceId: proof.workspaceId,
      expectedRevision: inspect(f.core, proof.workspaceId).revision, placements: [], viewport: { x: -12, y: 60, zoom: 0.8 } }));
    before = await canonical(f.core); assert.throws(commit, /operations_changed|sources_changed/); assert.deepEqual(await canonical(f.core), before);
    const controller = new AbortController(); commit = await service.prepare(source, randomUUID(), controller.signal); controller.abort();
    before = await canonical(f.core); assert.throws(commit, /repair_cancelled/); assert.deepEqual(await canonical(f.core), before);
    commit = await service.prepare(source, randomUUID(), new AbortController().signal);
    const resource = (await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.id === lost.resourceId)!;
    await f.core.command('desktop', { type: 'archiveSubject', kind: 'resource', id: resource.id, expectedVersion: resource.version, archived: true });
    before = await canonical(f.core); assert.throws(commit, /receipt_unavailable|operations_changed/); assert.deepEqual(await canonical(f.core), before);
    assert.equal(h.recorded.length, 0); await offline(f);
  } finally { await f.close(); }
});

for (const fault of ['postcondition', 'record'] as const) {
  test('repair rolls back new placements and domain/library receipts after ' + fault + ' failure', async () => {
    const f = fixture();
    try {
      const { receipt, proof } = await construct(f.core), lost = inspect(f.core, proof.workspaceId).blocks[1]; losePlacement(f.core, proof.workspaceId, lost.blockId);
      const before = await canonical(f.core), h = host(f.core), originalAttach = h.value.templates.attachBlock; let wrote = false;
      f.patch(h.value.templates, 'attachBlock', function(this: any, ...args: any[]) { const result = originalAttach.apply(this, args as any); wrote = true; return result; });
      if (fault === 'postcondition') {
        const originalInspect = h.value.inspectWorkspace;
        h.value.inspectWorkspace = id => { const actual = originalInspect(id); if (wrote) { const changed = structuredClone(actual); changed.blocks[0].x += 5; return changed; } return actual; };
      } else h.value.record = () => { throw new Error('Synthetic repair recording failure'); };
      const commandId = randomUUID(), commit = await new VelaWorkspaceRepair(h.value).prepare(action(receipt, proof), commandId, new AbortController().signal);
      assert.throws(commit, /repair_preservation_failed|repair_geometry_mismatch|Synthetic repair recording failure/);
      assert.equal(wrote, true); f.restore(); assert.deepEqual(await canonical(f.core), before);
      assert.ok(!inside(f.core).state.receipts[commandId]); assert.equal(h.recorded.length, 0); await offline(f);
    } finally { await f.close(); }
  });
}

test('an unmarked ambiguous correction cannot choose between two real construction receipts', async () => {
  const f = fixture();
  try {
    await construct(f.core); await construct(f.core);
    const before = await canonical(f.core), packet = inside(f.core).vela.operationContext(inside(f.core).inspectVelaOperationWorkspace);
    assert.equal(packet.operations.length, 2);
    const result = await f.core.command('velaRouteNative', { intent: 'Fix that workspace' }); assert.equal(result.matched, true);
    assert.equal(result.request?.response?.kind,'clarification');assert.equal(result.request?.providerId,null);
    const after=await canonical(f.core);assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.domainReceipts,before.domainReceipts);
    assert.deepEqual(after.snapshot.executions,before.snapshot.executions);assert.equal(after.snapshot.graph.messages.length,before.snapshot.graph.messages.length+2);await offline(f);
  } finally { await f.close(); }
});
