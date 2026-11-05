import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFixture } from './agent-block-fixture.mts';
import { WorkspaceEngine } from '../../workspace-engine/engine.mts';
import { createCanonicalTemplateHost } from '../canonical-host.mts';
import { TemplateService } from '../service.mts';
import { blockDefinition, blockAvailability } from '../registry.ts';
import { captureWorkspaceTemplate } from '../model.ts';
import { blockIdentity } from '../identity-model.ts';
import { mountBlockIdentity } from '../identity-view.ts';
import { mountBlockLibrary } from '../view.ts';
import { blockDocument, card } from './component-dom.mts';
import { until } from '../../conversation-product/test/component-dom.mts';
import type { BlockKind, LibraryCapabilities } from '../contracts.ts';
import type { Resource } from '../../application-contract/contracts.ts';

function library(t: any) {
  const f = agentFixture(t), engine = new WorkspaceEngine(f.kernel); let factoryCalls = 0;
  const capabilities: LibraryCapabilities = { revision: 1, kinds: { agent: { state: 'available' } }, providers: {}, velaPlanning: { state: 'unsupported' } };
  const host = createCanonicalTemplateHost({ db: f.db, kernel: f.kernel, engine, capabilities: () => capabilities,
    atomic: work => f.kernel.withTransaction(work), isAuthorized: () => f.authorized(),
    createResource() { factoryCalls++; throw new Error('Create Agents in the canonical Agent Library'); },
    resourceKind: id => String(f.db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(id)?.kind) as BlockKind,
    navigateWorkspace(workspaceId) { f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId } }, () => { throw new Error('No provider creation'); }); },
    setTaskGroupMembers() { throw new Error('Agent is not a manual Task group'); },
  });
  const service = new TemplateService(f.db, host), workspace = engine.createWorkspace('Synthetic existing Agent placement');
  return { ...f, agentService: f.service, engine, host, service, capabilities, workspace, factoryCalls: () => factoryCalls };
}

test('Agent block attaches and templates reuse one real profile; generic creation/new-template bypasses fail before any canonical factory write', t => {
  const f = library(t), manifest = blockDefinition('agent'), initial = f.agentService.inspect(f.created.agent.resourceId);
  assert.equal(manifest.creation, 'reference-only'); assert.equal(manifest.category, 'intelligence'); assert.equal(manifest.defaultPresentation.shape, 'rounded');
  assert.equal(blockAvailability('agent', { ...f.capabilities, kinds: {} }).state, 'unknown');
  const input = { commandId: 'synthetic:agent-block-new', workspaceId: f.workspace.workspaceId, expectedLayoutVersion: f.workspace.revision, kind: 'agent' as const, title: 'Not an empty profile' };
  assert.throws(() => f.service.createBlock(input), /agent_library_creation_required/);
  assert.throws(() => f.host.createResource({ kind: 'agent', title: input.title, projectId: null }), /agent_library_creation_required/);
  assert.equal(f.factoryCalls(), 0);
  const attached = f.service.attachBlock({ commandId: 'synthetic:existing-agent-attach', workspaceId: input.workspaceId,
    expectedLayoutVersion: input.expectedLayoutVersion, kind: input.kind, resourceId: f.created.agent.resourceId, expectedResourceVersion: initial.resource.version });
  assert.equal(attached.resourceId, initial.resource.id); assert.deepEqual(f.agentService.inspect(initial.resource.id), initial);
  f.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId: f.workspace.workspaceId } }, () => { throw new Error('No provider creation'); });
  const snapshot = f.desktop.snapshot(() => ({ provider: 'local', messages: [] }));
  assert.throws(() => captureWorkspaceTemplate(snapshot, { [initial.resource.id]: 'new' }), /agent_template_reference_required/);
  const body = captureWorkspaceTemplate(snapshot, { [initial.resource.id]: 'reference' }), invalid = structuredClone(body);
  invalid.resources[0].source = { mode: 'new', kind: 'agent', title: 'No silent duplicate' };
  assert.throws(() => f.service.saveTemplate({ name: 'Refused profile copy', description: '', tags: [], body: invalid }), /agent_template_reference_required/);
  const template = f.service.saveTemplate({ name: 'Reuse saved agent', description: '', tags: [], body });
  const applied = f.service.applyTemplate({ commandId: 'synthetic:agent-block-template', templateId: template.id, expectedVersion: template.version, title: 'Synthetic second Agent presentation', projectId: null });
  assert.deepEqual(Object.values(applied.resourceIds), [initial.resource.id]); assert.deepEqual(f.agentService.inspect(initial.resource.id), initial);
  assert.equal(f.db.prepare('SELECT count(*) n FROM resources').get()!.n, 1); assert.equal(f.db.prepare('SELECT count(*) n FROM notes').get()!.n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM blocks').get()!.n, 2); assert.equal(f.factoryCalls(), 0);
});

test('Agent library picker exposes existing canonical profiles directly without a generic create form; compact identity remains profile-specific', async t => {
  const f = library(t), dom = blockDocument(), restore = dom.install(); let created = 0, identity: ReturnType<typeof mountBlockIdentity> | undefined;
  const view = mountBlockLibrary(dom.root, { capabilities: async () => f.capabilities,
    createBlock: async input => { assert.fail('Agent picker must not create a generic resource'); return f.service.createBlock(input); },
    findResources: async input => f.service.findResources(input), attachBlock: async input => f.service.attachBlock(input),
  }, { workspaceId: f.workspace.workspaceId, expectedLayoutVersion: () => f.engine.project(f.workspace.workspaceId).revision,
    onCreated: () => { created++; }, onClose() {} });
  t.after(() => { identity?.dispose(); view.dispose(); restore(); });
  await until(() => dom.root.querySelector('[data-block-kind="agent"]'));
  dom.root.querySelector('[data-block-kind="agent"]').onclick();
  const detail = dom.root.querySelector('.aw-library__detail');
  assert.equal(detail.querySelector('form'), null); assert.match(detail.textContent, /Create and configure agent profiles in the Agent Library/);
  await until(() => detail.querySelector('[data-attach-resource]'));
  detail.querySelector('[data-attach-resource]').onclick(); await until(() => created === 1);
  assert.equal(f.factoryCalls(), 0); assert.equal(f.db.prepare('SELECT count(*) n FROM resources').get()!.n, 1);
  const profile = f.agentService.inspect(f.created.agent.resourceId), configuration = f.agentService.effective(profile.ref, null);
  const resource: Resource = { id: profile.resource.id, kind: 'agent', title: profile.resource.title, version: profile.resource.version, provider: 'local', content: '', messages: [] };
  const model = blockIdentity({ kind: 'agent', resource, agent: { phase: 'ready', profile, configuration, history: { state: 'unavailable', references: [] } } });
  assert.equal(model.layout, 'agent'); assert.equal(model.paragraphs[0], profile.profile.purpose); assert.doesNotMatch(model.subtitle, /Running|Complete/);
  const c = card(dom); identity = mountBlockIdentity(c.article, {}); identity.update(model);
  assert(c.article.querySelector('.aw-identity-agent-monogram')); assert.equal(blockIdentity({ kind: 'agent', resource }).phase, 'loading');
  assert.equal(blockIdentity({ kind: 'agent', resource, agent: { phase: 'unavailable' } }).phase, 'unavailable');
});
