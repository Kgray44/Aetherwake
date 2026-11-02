import test from 'node:test';
import assert from 'node:assert/strict';
import { taskTrackerFixture } from './task-tracker-fixture.mts';
import { WorkspaceEngine } from '../../workspace-engine/engine.mts';
import { createCanonicalTemplateHost } from '../canonical-host.mts';
import { TemplateService } from '../service.mts';
import { captureWorkspaceTemplate } from '../model.ts';
import { blockIdentity } from '../identity-model.ts';
import { blockDefinition, blockAvailability } from '../registry.ts';
import { mountDirectResourceExperience, type DirectResourcePorts } from '../direct-resource-view.ts';
import { blockDocument, card } from './component-dom.mts';
import { mountBlockIdentity } from '../identity-view.ts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { Resource } from '../../application-contract/contracts.ts';
import type { BlockKind, LibraryCapabilities } from '../contracts.ts';

test('Task Tracker attaches one canonical objective across workspaces/templates and refuses generic creation or empty copies', t => {
  const f = taskTrackerFixture(t), engine = new WorkspaceEngine(f.kernel), document = f.service.read(f.created.resourceId); let factoryCalls = 0;
  const caps: LibraryCapabilities = { revision: 1, kinds: { task_objective: { state: 'available' } }, providers: {}, velaPlanning: { state: 'unsupported' } };
  const host = createCanonicalTemplateHost({ db: f.db, kernel: f.kernel, engine, atomic: work => f.kernel.withTransaction(work), capabilities: () => caps,
    isAuthorized: target => !f.denied.has(target.id), createResource() { factoryCalls++; throw new Error('No generic Task Objective factory'); },
    resourceKind: id => String(f.db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(id)?.kind ?? f.kernel.getResource(id).resource.kind) as BlockKind,
    navigateWorkspace: workspaceId => { f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId } }, () => { throw new Error('No provider'); }); },
    setTaskGroupMembers() { throw new Error('Task Objective is not a manual Task group'); } });
  const service = new TemplateService(f.db, host), workspace = engine.createWorkspace('Synthetic Task Tracker A');
  assert.equal(blockDefinition('task_objective').title, 'Task Tracker'); assert.equal(blockDefinition('task_objective').creation, 'reference-only');
  assert.equal(blockDefinition('task_objective').defaultPresentation.shape, 'rounded'); assert.equal(blockAvailability('task_objective', { ...caps, kinds: {} }).state, 'unknown');
  assert.throws(() => service.createBlock({ commandId: 'synthetic:objective-generic', workspaceId: workspace.workspaceId, expectedLayoutVersion: workspace.revision, kind: 'task_objective', title: 'Never a blank shell' }), /task_objective_creation_required/);
  assert.throws(() => host.createResource({ kind: 'task_objective', title: 'Never a Note', projectId: null }), /task_objective_creation_required/);
  const attached = service.attachBlock({ commandId: 'synthetic:objective-attach', workspaceId: workspace.workspaceId, expectedLayoutVersion: workspace.revision,
    kind: 'task_objective', resourceId: document.resource.id, expectedResourceVersion: document.resource.version });
  const placement = engine.project(workspace.workspaceId).blocks.find(row => row.blockId === attached.placementId)!; assert.deepEqual([placement.width, placement.height], [600, 540]);
  f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.workspaceId } }, () => { throw new Error('No provider'); });
  const snapshot = f.desktop.snapshot(() => ({ provider: 'local', messages: [] }));
  assert.throws(() => captureWorkspaceTemplate(snapshot, { [document.resource.id]: 'new' }), /task_objective_template_reference_required/);
  const body = captureWorkspaceTemplate(snapshot, { [document.resource.id]: 'reference' }), invalid = structuredClone(body);
  invalid.resources[0].source = { mode: 'new', kind: 'task_objective', title: 'Do not lose requirements and review history' };
  assert.throws(() => service.saveTemplate({ name: 'Refused empty copy', description: '', tags: [], body: invalid }), /task_objective_template_reference_required/);
  const template = service.saveTemplate({ name: 'Reuse actual objective', description: '', tags: [], body });
  const applied = service.applyTemplate({ commandId: 'synthetic:objective-template', templateId: template.id, expectedVersion: template.version, title: 'Synthetic Task Tracker B', projectId: null });
  assert.deepEqual(Object.values(applied.resourceIds), [document.resource.id]); assert.deepEqual(f.service.read(document.resource.id), document);
  const layout = engine.project(workspace.workspaceId); engine.execute({ type: 'detachBlock', commandId: 'synthetic:objective-detach', workspaceId: workspace.workspaceId, expectedRevision: layout.revision, blockId: attached.placementId });
  assert.deepEqual(f.service.read(document.resource.id), document); assert.equal(f.db.prepare('SELECT count(*) n FROM task_objective_documents').get()!.n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM notes').get()!.n, 1, 'Only evidence Note exists'); assert.equal(factoryCalls, 0);
});

test('direct Task Tracker is placement-free and supports external freshness refresh without changing Task version', async t => {
  const f = taskTrackerFixture(t), dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, value) => coordinator.add(key, value), target: (key, value, cause) => coordinator.target(key, value, cause),
    pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const resource = (): Resource => { const r = f.service.read(f.created.resourceId).resource; return { id: r.id, kind: 'task_objective', title: r.title, version: r.version, provider: 'local', content: '', messages: [] }; };
  let reads = 0; const forbidden = () => { throw new Error('No manual Task, Note session or hidden placement'); };
  const port = { ...f.port, read: async (id: string) => { reads++; return f.service.read(id); } };
  const ports: DirectResourcePorts = { notes: {} as any, noteSession: forbidden, saveContent: forbidden, setTaskStatus: forbidden, setTaskPriority: forbidden,
    manageMembers: forbidden, openResource: forbidden, taskObjectives: { port, motion, viewId: 'synthetic:direct-objective' } };
  const controller = mountDirectResourceExperience(dom.root, resource(), ports); t.after(() => { controller.dispose(); restore(); });
  const settled = () => dom.root.querySelector('.aw-task-tracker').getAttribute('aria-busy') === 'false'; await until(() => settled()); assert.equal(reads, 1);
  controller.reflow?.(); for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame?.(); } assert.equal(dom.root.querySelector('.aw-task-tracker').style.opacity, '1');
  const document = f.service.read(f.created.resourceId); f.service.mutate({ commandId: 'synthetic:direct-objective-edit', resourceId: document.resource.id, expectedVersion: document.resource.version,
    operation: { type: 'replaceDefinition', definition: f.definition({ objective: 'Current objective after canonical edit' }) } });
  controller.update(resource()); await until(() => reads === 2 && settled()); assert.match(dom.root.textContent, /Current objective after canonical edit/);
  const version = resource().version; await controller.refresh?.(); assert.equal(reads, 3); assert.equal(resource().version, version, 'External refresh needs no Task mutation'); await controller.flush();
  controller.setActive(false); await controller.refresh?.(); controller.update(resource()); assert.equal(reads, 3); controller.setActive(true); await until(() => reads === 4 && settled());
  assert.equal(f.db.prepare('SELECT count(*) n FROM workspaces').get()!.n, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 0);
  const model = blockIdentity({ kind: 'task_objective', resource: resource(), taskObjective: f.service.read(f.created.resourceId) });
  assert.equal(model.layout, 'objective'); assert.equal(model.rows[0].id, 'criterion:one'); assert.equal(model.metrics[0].value, '1'); assert(!model.rows.some(row => 'checked' in row));
  assert.equal(blockIdentity({ kind: 'task_objective', resource: resource() }).phase, 'loading');
  assert.equal(blockIdentity({ kind: 'task_objective', resource: resource(), taskObjective: null }).phase, 'unavailable');
  const edit = dom.root.querySelectorAll('button').find((value: any) => value.textContent === 'Edit definition'); edit.onclick();
  assert.equal(controller.hasUnsavedChanges?.(), true); const discard = dom.root.querySelectorAll('button').find((value: any) => value.textContent === 'Discard definition edits'); discard.onclick(); assert.equal(controller.hasUnsavedChanges?.(), false);
  controller.dispose(); assert.equal(coordinator.bodies.size, 0);
});

test('Task Tracker compact/overview composition retains real criteria without manual-Task checkboxes or invented progress', t => {
  const f = taskTrackerFixture(t), dom = blockDocument(), restore = dom.install(), surface = card(dom), document = f.service.read(f.created.resourceId);
  const resource: Resource = { id: document.resource.id, kind: 'task_objective', title: document.resource.title, version: document.resource.version, provider: 'local', content: '', messages: [] };
  const identity = mountBlockIdentity(surface.article, { approach() {} }); t.after(() => { identity.dispose(); restore(); });
  identity.update(blockIdentity({ kind: 'task_objective', resource, taskObjective: document }));
  assert.match(dom.root.querySelector('.aw-identity-objective').textContent, /inspected synthetic artifact/); assert.equal(dom.root.querySelectorAll('.aw-identity-objective-requirements li').length, 1);
  assert.equal(dom.root.querySelectorAll('.aw-block-compact .aw-identity-check').length, 0); surface.open.focus();
  assert.equal(identity.setFootprint({ width: 200, height: 200, bodyWidth: 150, bodyHeight: 70, textScale: 1 }), 'overview');
  assert.match(dom.root.querySelector('.aw-block-overview-content').textContent, /manual verification unreviewed.*acceptance not-accepted/);
  assert.doesNotMatch(dom.root.querySelector('.aw-block-overview-content').textContent, /\d+%|running|verified by provider/);
});
