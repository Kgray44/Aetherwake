import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { LibraryMethod, LibraryRequest, VelaBackendState, VelaOperation } from '../src/contracts.mts';
import type { ActionReceipt, ResourceRef, VelaPlanningPort, VelaRequest, VelaWorkspaceConstructionReceipt } from '../../vela-core/src/contracts.ts';
import type { ChecklistDocument } from '../../application-contract/checklist.ts';
import type { WorkspaceProjection } from '../../workspace-engine/contracts.mts';
import { blockDefinition } from '../../block-library/registry.ts';

const MINECRAFT_INTENT = 'Create a workspace for A World for Two for Minecraft.';
const internal = (core: BackendCore): any => core;
const library = (core: BackendCore, name: LibraryMethod, input: unknown = {}): Promise<any> =>
  core.command('library', { name, input } as LibraryRequest);
const vela = (core: BackendCore, name: VelaOperation['name'], input: unknown = {}): Promise<any> =>
  core.command('vela', { name, input } as VelaOperation);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-vela-construction-')), path = join(dir, 'canonical.sqlite');
  const attempts = { connections: 0, turns: 0, planning: 0 };
  const planner: VelaPlanningPort = { providerId: 'synthetic-construction-tripwire', availability: () => ({ available: true, busy: false }),
    propose: async () => { attempts.planning++; throw new Error('Construction must not invoke a model'); } };
  const open = () => {
    const core = new BackendCore({ path, provider: 'fixture', contentPolicy: 'synthetic-only', velaPlanningPort: planner });
    internal(core).port.connect = async () => { attempts.connections++; throw new Error('Construction must remain offline'); };
    internal(core).port.turn = async () => { attempts.turns++; throw new Error('Construction must not execute a provider turn'); };
    return core;
  };
  let core = open();
  const restorers: (() => void)[] = [];
  const restore = () => { while (restorers.length) restorers.pop()!(); };
  const allocation = () => readdirSync(dir).reduce((total, entry) => total + statSync(join(dir, entry)).size, 0);
  return { get core() { return core; }, attempts,
    patch(target: any, name: string, replacement: any) {
      const original = target[name]; target[name] = replacement; restorers.push(() => { target[name] = original; }); return original;
    }, restore,
    async reopen() { restore(); await core.command('close', {}); core = open(); },
    async close() {
      restore();
      try { await core.command('close', {}); assert.ok(allocation() < 8 * 1024 * 1024, 'owned fixture remains within the 8 MiB write estimate'); }
      finally {
        const target = resolve(dir), child = relative(resolve(tmpdir()), target);
        assert.ok(child.startsWith('aerynth-vela-construction-') && !child.startsWith('..') && !isAbsolute(child));
        rmSync(target, { recursive: true, force: true });
      }
    },
  };
}
async function route(core: BackendCore, intent = MINECRAFT_INTENT): Promise<VelaRequest> {
  const result = await core.command('velaRouteNative', { intent });
  assert.equal(result.matched, true);
  assert.ok(result.matched); return result.request;
}
async function operation(core: BackendCore, request: VelaRequest) {
  const state = await vela(core, 'state') as VelaBackendState;
  const plan = state.plans.find(item => item.id === request.planId);
  const receipt = state.receipts.find(item => item.requestId === request.id);
  assert.ok(plan); assert.ok(receipt);
  return { state, plan, receipt };
}
async function inspection(core: BackendCore, workspaceId: string) {
  return (await core.command('library', { name: 'inspectWorkspace', input: { workspaceId } })).result as WorkspaceProjection;
}
async function assertOffline(f: ReturnType<typeof fixture>) {
  assert.deepEqual(f.attempts, { connections: 0, turns: 0, planning: 0 });
  const activity = await f.core.command('providerActivity', {});
  assert.equal(activity.codexConnections, 0); assert.equal(activity.providerRequests, 0);
  assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
}
async function assertConstruction(core: BackendCore, receipt: ActionReceipt): Promise<VelaWorkspaceConstructionReceipt> {
  assert.equal(receipt.state, 'applied'); assert.equal(receipt.taskVerified, false);
  const proof = receipt.workspaceConstruction;
  assert.ok(proof); assert.equal(proof.contract, 'aerynth.vela-workspace-construction@1');
  assert.equal(proof.workspaceId, receipt.createdWorkspaceId);
  assert.deepEqual(proof.verification, { workspaceExists: true, projectMatches: true, bindingsMatch: true, geometryValid: true });
  const actual = await inspection(core, proof.workspaceId);
  const desktop = await core.command('desktop', { type: 'snapshot' });
  assert.equal(actual.workspaceId, proof.workspaceId); assert.equal(actual.projectId, proof.projectId);
  assert.equal(actual.workspaceVersion, proof.workspaceVersion); assert.equal(actual.revision, proof.layoutVersion);
  assert.equal(actual.blocks.length, proof.placements.length); assert.ok(actual.blocks.length > 0);
  assert.equal(actual.presence.id, 'system:vela'); assert.ok(actual.blocks.every(block => block.resourceId !== 'system:vela'));
  const saved = (await library(core, 'getTemplate', proof.templateId)).result;
  assert.equal(saved.version, proof.templateVersion);
  for (const binding of proof.placements) {
    const block = actual.blocks.find(item => item.blockId === binding.blockId);
    const resource: VelaWorkspaceConstructionReceipt['resources'][number] | undefined = proof.resources.find(item => item.resourceId === binding.resourceId);
    assert.ok(block); assert.ok(resource); assert.equal(block.resourceId, resource.resourceId); assert.equal(block.resourceState, 'active');
    const canonical = desktop.resources.find(item => item.id === resource.resourceId);
    const resolved: ResourceRef | null = internal(core).velaHost.resolve({ kind: 'resource', id: resource.resourceId }, internal(core).velaHost.scope());
    assert.ok(canonical); assert.ok(resolved); assert.equal(resolved.version, resource.version);
    const minimum = blockDefinition(canonical.kind as Parameters<typeof blockDefinition>[0]).minimumSize;
    assert.ok([block.x, block.y, block.width, block.height].every(Number.isFinite));
    assert.ok(block.width >= minimum.width && block.height >= minimum.height);
    const role = saved.body.placements.find((item: any) => item.key === binding.role);
    assert.ok(role); for (const field of ['x', 'y', 'width', 'height'] as const) assert.equal(block[field], role.presentation[field]);
  }
  return proof;
}
/** Canonical user objects must roll back; the request/failure audit and Vela conversation are intentionally retained. */
async function canonicalObjects(core: BackendCore) {
  const db = internal(core).db, state = await vela(core, 'state') as VelaBackendState;
  const conversationId = state.conversation?.resourceId, snapshot = await core.command('snapshot', {});
  const graphId = conversationId ? snapshot.resourceMap[conversationId] : undefined;
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => String(row.name))
    .filter((name: string) => /^(projects|workspaces|resources|blocks|desktop_resources|workspace_.*|block_library_.*|checklist_.*)$/.test(name))
    .sort();
  const tables = Object.fromEntries(names.map((name: string) => {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const rows = db.prepare('SELECT * FROM "' + name + '"').all().filter((row: any) =>
      !(name === 'resources' && row.id === conversationId) && !(name === 'desktop_resources' && row.resource_id === conversationId));
    return [name, rows.map((row: any) => JSON.stringify(row)).sort()];
  }));
  return { tables,
    resourceMap: Object.fromEntries(Object.entries(snapshot.resourceMap).filter(([id]) => id !== conversationId)),
    conversations: snapshot.graph.conversations.filter(item => item.id !== graphId),
    messages: snapshot.graph.messages.filter(item => item.conversationId !== graphId), edges: snapshot.graph.edges,
    bindings: snapshot.bindings, relationships: snapshot.relationships };
}
async function makeProject(core: BackendCore, title: string) {
  const before = new Set((await core.command('desktop', { type: 'snapshot' })).projects.map(item => item.id));
  const desktop = await core.command('desktop', { type: 'createProject', title });
  const project = desktop.projects.find(item => !before.has(item.id)); assert.ok(project); return project;
}

test('the exact Minecraft prompt constructs three functional canonical blocks, persists proof and survives restart with zero model calls', async () => {
  const f = fixture();
  try {
    const request = await route(f.core); assert.equal(request.state, 'completed', request.errorCode);
    const { plan, receipt, state } = await operation(f.core, request);
    assert.equal(plan.state, 'applied'); assert.equal(plan.steps[0].action.type, 'constructWorkspace');
    const proof = await assertConstruction(f.core, receipt), desktop = await f.core.command('desktop', { type: 'snapshot' });
    assert.equal(proof.placements.length, 3); assert.equal(proof.resources.length, 3); assert.ok(receipt.createdProjectId);
    assert.equal(proof.projectId, receipt.createdProjectId); assert.equal(desktop.activeWorkspaceId, proof.workspaceId);
    assert.equal(desktop.workspaces.find(item => item.id === proof.workspaceId)?.project_id, proof.projectId);
    assert.equal(desktop.projects.find(item => item.id === proof.projectId)?.title, 'A World for Two for Minecraft');
    const created = proof.resources.map(item => desktop.resources.find(resource => resource.id === item.resourceId)!);
    assert.deepEqual(created.map(item => item.kind).sort(), ['checklist', 'conversation', 'note']);
    assert.ok(proof.resources.every(item => item.reused === false));
    const note = created.find(item => item.kind === 'note')!, chat = created.find(item => item.kind === 'conversation')!, checklist = created.find(item => item.kind === 'checklist')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'Synthetic Minecraft construction note survives restart.' });
    const checklistDocument = (await f.core.command('checklists', { name: 'read', input: { resourceId: checklist.id } })).result as ChecklistDocument;
    assert.equal(checklistDocument.canEdit, true);
    await f.core.command('checklists', { name: 'mutate', input: { commandId: randomUUID(), resourceId: checklist.id,
      expectedVersion: checklistDocument.resource.version, operations: [{ type: 'addEntry', key: 'verify', entry: { text: 'Synthetic check: restore world backup' } }] } });
    const conversation = (await f.core.command('snapshot', {})).conversations.find(item => item.resourceId === chat.id);
    assert.ok(conversation); assert.equal(conversation.providerId, 'local');
    await f.core.command('addMessage', { resourceId: chat.id, role: 'user', content: 'Synthetic project conversation is usable.', expectedRevision: conversation.revision });
    const beforeRestart = await inspection(f.core, proof.workspaceId), velaConversationId = state.conversation?.resourceId;
    await f.reopen();
    const restored = await vela(f.core, 'state') as VelaBackendState;
    assert.equal(restored.conversation?.resourceId, velaConversationId);
    assert.deepEqual(restored.receipts.find(item => item.id === receipt.id)?.workspaceConstruction, proof);
    assert.deepEqual(await inspection(f.core, proof.workspaceId), beforeRestart);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.id === note.id)?.content, 'Synthetic Minecraft construction note survives restart.');
    assert.equal(((await f.core.command('checklists', { name: 'read', input: { resourceId: checklist.id } })).result as ChecklistDocument).entries[0].text, 'Synthetic check: restore world backup');
    const graph = await f.core.command('snapshot', {});
    assert.ok(graph.graph.messages.some(item => item.conversationId === graph.resourceMap[chat.id] && item.content === 'Synthetic project conversation is usable.'));
    await assertOffline(f);
  } finally { await f.close(); }
});

test('an existing exact project and relevant authorized resources are reused without duplicating their identities or histories', async () => {
  const f = fixture();
  try {
    const project = await makeProject(f.core, 'A World for Two');
    const source = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic existing source', projectId: project.id });
    const workspaceId = source.activeWorkspaceId!;
    const notes = await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId, expectedLayoutVersion: source.layoutVersion,
      kind: 'note', title: 'A World for Two working notes' });
    const tasks = await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId, expectedLayoutVersion: notes.desktop.layoutVersion,
      kind: 'checklist', title: 'A World for Two next actions' });
    const chat = await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId, expectedLayoutVersion: tasks.desktop.layoutVersion,
      kind: 'conversation', provider: 'local', title: 'A World for Two project conversation' });
    const oldIds = [notes.result.resourceId, tasks.result.resourceId, chat.result.resourceId].sort();
    const conversation = (await f.core.command('snapshot', {})).conversations.find(item => item.resourceId === chat.result.resourceId)!;
    await f.core.command('addMessage', { resourceId: chat.result.resourceId, role: 'user', content: 'Synthetic preexisting canonical Minecraft history.', expectedRevision: conversation.revision });
    await vela(f.core, 'open');
    const before = await f.core.command('snapshot', {}), projectCount = (await f.core.command('desktop', { type: 'snapshot' })).projects.length;
    const request = await route(f.core); assert.equal(request.state, 'completed', request.errorCode);
    const { receipt } = await operation(f.core, request), proof = await assertConstruction(f.core, receipt);
    assert.equal(proof.projectId, project.id); assert.equal(receipt.createdProjectId, undefined);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).projects.length, projectCount);
    assert.deepEqual(proof.resources.map(item => item.resourceId).sort(), oldIds); assert.ok(proof.resources.every(item => item.reused));
    const after = await f.core.command('snapshot', {});
    for (const id of oldIds) assert.equal(after.resourceMap[id], before.resourceMap[id]);
    assert.deepEqual(after.graph.messages.filter(item => item.conversationId === before.resourceMap[chat.result.resourceId]),
      before.graph.messages.filter(item => item.conversationId === before.resourceMap[chat.result.resourceId]));
    assert.deepEqual((await inspection(f.core, workspaceId)).blocks.map(item => item.resourceId).sort(), oldIds);
    await assertOffline(f);
  } finally { await f.close(); }
});

test('duplicate active project names require resolution before any construction mutation', async () => {
  const f = fixture();
  try {
    await makeProject(f.core, 'A World for Two'); await makeProject(f.core, 'A World for Two');
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: null } });
    await vela(f.core, 'open'); const before = await canonicalObjects(f.core);
    await assert.rejects(route(f.core), /vela_project_ambiguous/);
    assert.deepEqual(await canonicalObjects(f.core), before); await assertOffline(f);
  } finally { await f.close(); }
});

test('an unrelated current project does not capture the named Minecraft destination', async () => {
  const f = fixture();
  try {
    const other = await makeProject(f.core, 'Synthetic unrelated coursework');
    await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic unrelated current workspace', projectId: other.id });
    const request = await route(f.core); assert.equal(request.state, 'completed', request.errorCode);
    const { receipt } = await operation(f.core, request), proof = await assertConstruction(f.core, receipt);
    assert.ok(receipt.createdProjectId); assert.notEqual(proof.projectId, other.id);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).projects.find(item => item.id === proof.projectId)?.title, 'A World for Two for Minecraft');
    await assertOffline(f);
  } finally { await f.close(); }
});

test('an asynchronously planned resource that changes before commit is rejected without construction residue', async () => {
  const f = fixture(); let release = () => {}; let pending: Promise<VelaRequest> | undefined;
  try {
    const project = await makeProject(f.core, 'A World for Two');
    const source = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic stale source', projectId: project.id });
    const note = await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId: source.activeWorkspaceId!,
      expectedLayoutVersion: source.layoutVersion, kind: 'note', title: 'A World for Two working notes' });
    await vela(f.core, 'open');
    let reached = () => {}; const reachedPlanning = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; }), planner = internal(f.core).library.planner, original = planner.plan;
    f.patch(planner, 'plan', async function(this: any, ...args: any[]) {
      const result = await original.apply(this, args); reached(); await gate; return result;
    });
    pending = route(f.core);
    await Promise.race([reachedPlanning, pending.then(request => { throw new Error('Route returned before the planner pause: ' + request.state); })]);
    const resource = (await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.id === note.result.resourceId)!;
    await f.core.command('desktop', { type: 'content', resourceId: resource.id, expectedVersion: resource.version, content: 'Synthetic edit while planning is paused.' });
    const before = await canonicalObjects(f.core); release();
    const request = await pending; assert.notEqual(request.state, 'completed');
    const { receipt } = await operation(f.core, request); assert.notEqual(receipt.state, 'applied');
    assert.equal(receipt.workspaceConstruction, undefined); f.restore();
    assert.deepEqual(await canonicalObjects(f.core), before); await assertOffline(f);
  } finally { release(); await pending?.catch(() => undefined); await f.close(); }
});

for (const fault of ['apply-after-write', 'postcondition-binding', 'postcondition-geometry'] as const) {
  test('construction rolls back templates, user objects and graph mappings after ' + fault, async () => {
    const f = fixture();
    try {
      await vela(f.core, 'open'); const before = await canonicalObjects(f.core), templates = internal(f.core).library;
      const originalApply = templates.applyTemplate; let applied = false, injected = 0;
      f.patch(templates, 'applyTemplate', function(this: any, ...args: any[]) {
        const result = originalApply.apply(this, args); applied = true;
        if (fault === 'apply-after-write') { injected++; throw new Error('Synthetic failure after actual template mutation'); }
        return result;
      });
      if (fault !== 'apply-after-write') {
        const engine = internal(f.core).desktop.nativeBlockServices().engine, originalInspect = engine.inspectWorkspace;
        f.patch(engine, 'inspectWorkspace', function(this: any, ...args: any[]) {
          const actual = originalInspect.apply(this, args);
          if (!applied) return actual;
          injected++; const changed = structuredClone(actual) as WorkspaceProjection;
          if (fault === 'postcondition-binding') changed.blocks[0].resourceId = 'resource:synthetic-wrong-binding';
          else changed.blocks[0].width = 0;
          return changed;
        });
      }
      const request = await route(f.core); assert.ok(injected > 0, 'fault must exercise the actual canonical construction path');
      assert.notEqual(request.state, 'completed'); const { receipt } = await operation(f.core, request);
      assert.notEqual(receipt.state, 'applied'); assert.equal(receipt.workspaceConstruction, undefined); assert.equal(receipt.createdWorkspaceId, undefined);
      f.restore(); assert.deepEqual(await canonicalObjects(f.core), before); await assertOffline(f);
    } finally { await f.close(); }
  });
}

test('construction in one scope neither reuses nor exposes another project resource and explicit cross-scope targets are denied', async () => {
  const f = fixture();
  try {
    const allowed = await makeProject(f.core, 'A World for Two'), other = await makeProject(f.core, 'Synthetic private unrelated project');
    const secretDesktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic private source', projectId: other.id });
    const secret = await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId: secretDesktop.activeWorkspaceId!, expectedLayoutVersion: secretDesktop.layoutVersion,
      kind: 'note', title: 'A World for Two working notes SECRET_OTHER_SCOPE' });
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: allowed.id } });
    const request = await route(f.core); assert.equal(request.state, 'completed', request.errorCode);
    const { receipt } = await operation(f.core, request), proof = await assertConstruction(f.core, receipt);
    assert.ok(proof.resources.every(item => item.resourceId !== secret.result.resourceId));
    assert.doesNotMatch(JSON.stringify(request.context), /SECRET_OTHER_SCOPE|Synthetic private unrelated project/);
    assert.ok(!request.context.discovered.some(item => item.id === other.id || item.id === secret.result.resourceId));
    const before = await canonicalObjects(f.core);
    await assert.rejects(vela(f.core, 'native', { intent: 'Synthetic explicit denied construction', action: {
      type: 'constructWorkspace', title: 'Must remain denied', purpose: 'Synthetic denied cross-project construction', projectId: other.id, newProjectTitle: null,
    } }), /resource_not_authorized/);
    assert.deepEqual(await canonicalObjects(f.core), before); await assertOffline(f);
  } finally { await f.close(); }
});
