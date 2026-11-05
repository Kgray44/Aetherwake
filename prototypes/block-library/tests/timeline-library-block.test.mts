import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineFixture } from './timeline-view-fixture.mts';
import { WorkspaceEngine } from '../../workspace-engine/engine.mts';
import { createCanonicalTemplateHost } from '../canonical-host.mts';
import { TemplateService } from '../service.mts';
import { captureWorkspaceTemplate } from '../model.ts';
import { blockIdentity } from '../identity-model.ts';
import { blockDefinition, blockAvailability } from '../registry.ts';
import { mountDirectResourceExperience, type DirectResourcePorts } from '../direct-resource-view.ts';
import { blockDocument } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';
import type { ExperienceMotionPort } from '../../application-contract/motion.ts';
import type { Resource } from '../../application-contract/contracts.ts';
import type { BlockKind, LibraryCapabilities } from '../contracts.ts';

test('Timeline attachments/templates preserve one canonical configured view and generic creation cannot create a Note or broaden its scope', t => {
  const f = timelineFixture(t), engine = new WorkspaceEngine(f.kernel), document = f.service.read(f.created.resourceId); let factoryCalls = 0;
  const caps: LibraryCapabilities = { revision: 1, kinds: { timeline: { state: 'available' } }, providers: {}, velaPlanning: { state: 'unsupported' } };
  const host = createCanonicalTemplateHost({ db: f.db, kernel: f.kernel, engine, atomic: work => f.kernel.withTransaction(work), capabilities: () => caps,
    isAuthorized: () => f.authorized(), createResource() { factoryCalls++; throw new Error('No generic Timeline factory'); },
    resourceKind: id => String(f.db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(id)?.kind ?? f.kernel.getResource(id).resource.kind) as BlockKind,
    navigateWorkspace(workspaceId) { f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId } }, () => { throw new Error('No provider'); }); },
    setTaskGroupMembers() { throw new Error('Timeline is not a Task group'); } });
  const service = new TemplateService(f.db, host), workspace = engine.createWorkspace('Synthetic Timeline attachment');
  assert.equal(blockDefinition('timeline').creation, 'reference-only'); assert.equal(blockDefinition('timeline').defaultPresentation.shape, 'rounded');
  assert.equal(blockAvailability('timeline', { ...caps, kinds: {} }).state, 'unknown');
  assert.throws(() => service.createBlock({ commandId: 'synthetic:timeline-generic', workspaceId: workspace.workspaceId, expectedLayoutVersion: workspace.revision, kind: 'timeline', title: 'Never a blank copy' }), /timeline_creation_required/);
  assert.throws(() => host.createResource({ kind: 'timeline', title: 'No hidden defaults', projectId: null }), /timeline_creation_required/);
  const attached = service.attachBlock({ commandId: 'synthetic:timeline-reference', workspaceId: workspace.workspaceId, expectedLayoutVersion: workspace.revision, kind: 'timeline', resourceId: f.created.resourceId, expectedResourceVersion: document.resource.version });
  const placement = engine.project(workspace.workspaceId).blocks.find(row => row.blockId === attached.placementId)!; assert.deepEqual([placement.width, placement.height], [640, 460]);
  f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.workspaceId } }, () => { throw new Error('No provider'); });
  const snapshot = f.desktop.snapshot(() => ({ provider: 'local', messages: [] }));
  assert.throws(() => captureWorkspaceTemplate(snapshot, { [f.created.resourceId]: 'new' }), /timeline_template_reference_required/);
  const body = captureWorkspaceTemplate(snapshot, { [f.created.resourceId]: 'reference' }), invalid = structuredClone(body);
  invalid.resources[0].source = { mode: 'new', kind: 'timeline', title: 'Must not replace the saved scope with defaults' };
  assert.throws(() => service.saveTemplate({ name: 'Refused Timeline copy', description: '', tags: [], body: invalid }), /timeline_template_reference_required/);
  const template = service.saveTemplate({ name: 'Same saved Timeline', description: '', tags: [], body });
  const applied = service.applyTemplate({ commandId: 'synthetic:timeline-reference-template', templateId: template.id, expectedVersion: template.version, title: 'Synthetic second Timeline placement', projectId: null });
  assert.deepEqual(Object.values(applied.resourceIds), [f.created.resourceId]); assert.deepEqual(f.service.read(f.created.resourceId), document);
  assert.equal(f.db.prepare('SELECT count(*) n FROM timeline_views').get()!.n, 1); assert.equal(f.db.prepare('SELECT count(*) n FROM notes').get()!.n, 1, 'Only the actual source Note exists'); assert.equal(factoryCalls, 0);
});

test('direct Timeline opening uses the same unplaced canonical viewer, never a Note session, and forwards Root frames/resize and current versions', async t => {
  const f = timelineFixture(t); f.add(); const dom = blockDocument(), restore = dom.install(), coordinator = new MotionCoordinator();
  const motion: ExperienceMotionPort = { get reduced() { return coordinator.reduced; }, add: (key, pose) => coordinator.add(key, pose), target: (key, pose, cause) => coordinator.target(key, pose, cause), pose: key => coordinator.pose(key), remove: key => { coordinator.bodies.delete(key); }, wake() {} };
  const resource = (): Resource => { const r = f.service.read(f.created.resourceId).resource; return { id: r.id, kind: 'timeline', title: r.title, version: r.version, provider: 'local', content: '', messages: [] }; };
  let reads = 0; const port = { ...f.port, read: async (id: string) => { reads++; return f.service.read(id); } };
  const forbidden = () => { throw new Error('No Note, Task or hidden workspace path'); };
  const ports: DirectResourcePorts = { notes: {} as any, noteSession: forbidden, saveContent: forbidden, setTaskStatus: forbidden, setTaskPriority: forbidden,
    manageMembers: forbidden, openResource: forbidden, timelines: { port, motion, viewId: 'synthetic:timeline-direct' } };
  const controller = mountDirectResourceExperience(dom.root, resource(), ports); t.after(() => { controller.dispose(); restore(); });
  await until(() => dom.root.querySelectorAll('.aw-timeline-items li').length === 1 && dom.root.querySelector('.aw-timeline').getAttribute('aria-busy') === 'false');
  assert.equal(reads, 1); controller.reflow?.(); for (let i = 0; i < 100; i++) { coordinator.step(1 / 60); controller.frame?.(); }
  assert.equal(dom.root.querySelector('.aw-timeline').style.opacity, '1');
  const document = f.service.read(f.created.resourceId), changed = structuredClone(document.view); changed.viewport.from = '2026-11-02T06:00:00.000Z';
  f.service.save({ commandId: 'synthetic:timeline-direct-version', resourceId: f.created.resourceId, expectedVersion: document.resource.version, view: changed }); controller.update(resource());
  await until(() => reads === 2 && dom.root.querySelector('.aw-timeline').getAttribute('aria-busy') === 'false'); await controller.flush();
  controller.setActive(false); await new Promise(resolve => setImmediate(resolve)); const before = reads; controller.update(resource()); assert.equal(reads, before);
  controller.setActive(true); await until(() => reads === before + 1); await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, before + 1, 'Reactivation performs one fresh read');
  assert.equal(f.db.prepare('SELECT count(*) n FROM workspaces').get()!.n, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM timeline_views').get()!.n, 1);
  const doc = f.service.read(f.created.resourceId), window = f.service.query({ resourceId: doc.resource.id, expectedVersion: doc.resource.version });
  const model = blockIdentity({ kind: 'timeline', resource: resource(), timeline: { document: doc, window } });
  assert.equal(model.layout, 'chronology'); assert.equal(model.metrics[0].value, '1'); assert.equal(model.rows[0].time, window.items[0].event.receivedAt);
  assert.equal(blockIdentity({ kind: 'timeline', resource: resource() }).phase, 'loading'); assert.equal(blockIdentity({ kind: 'timeline', resource: resource(), timeline: { document: null, window: null } }).phase, 'unavailable');
  controller.dispose(); assert.equal(coordinator.bodies.size, 0);
});
