import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import { AgentLibraryService, agentTemplates } from '../../agent-product/service.mts';
import type { AgentHostPort, AgentLibraryClientPort, CanonicalAgentResource } from '../../agent-product/contracts.ts';

/** Actual canonical SQLite/service; explicit synthetic policy and cached catalog.
 * No production history-list API, provider discovery, execution or native host. */
export function agentFixture(t: any) {
  const kernel = WorkspaceKernel.open(':memory:'), db = kernel.withTransaction(db => db), desktop = new DesktopState(kernel, db);
  t.after(() => kernel.close()); let allowed = true;
  const resource = (id: string): CanonicalAgentResource | null => {
    const r = db.prepare("SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=? AND d.kind='agent'").get(id);
    return r ? { id, kind: 'agent', title: String(r.title), projectId: r.project_id as string | null, version: Number(r.version), state: r.state as 'active' | 'archived' } : null;
  };
  const host: AgentHostPort = {
    identity: () => ({ principalId: 'synthetic:block-owner', policyVersion: 'synthetic:policy1' }),
    authorize: () => ({ decision: allowed ? 'allow' : 'deny', policyVersion: 'synthetic:policy1', authorizationRef: 'synthetic:authorization' }),
    resource, project: () => null,
    createResource(input) { const r = kernel.createGenericResource(input.title, input.projectId); db.prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,'agent')").run(r.id); return resource(r.id)!; },
    renameResource(input) { kernel.renameResource(input.id, input.title, input.expectedVersion); return resource(input.id)!; },
    touchResource(input) { kernel.touchGenericResource(input.id, input.expectedVersion); return resource(input.id)!; },
    archiveResource(input) { kernel.setResourceArchived(input.id, input.archived, input.expectedVersion); return resource(input.id)!; },
    configurationLayers: () => ({ policyVersion: 'synthetic:policy1', layers: [{ scope: 'global', id: null, version: 'synthetic:global1', settings: {
      providerId: 'synthetic-provider', modelId: 'synthetic-model', reasoningEffort: null, additionalInstructions: '', requiredCapabilities: [],
    } }] }),
    providerCatalog: () => ({ revision: 'synthetic:catalog1', providers: [{ id: 'synthetic-provider', state: 'available', models: [{ id: 'synthetic-model', reasoningEfforts: [] }], capabilities: [] }] }),
    task(id) { const r = db.prepare("SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=? AND d.kind='task'").get(id); return r ? {
      id, kind: 'task', version: Number(r.version), projectId: r.project_id as string | null, state: r.state as 'active' | 'archived', supportedTaskOrigin: 'manual-compatibility',
    } : null; },
    execution: () => null,
  };
  const service = new AgentLibraryService({ db, transaction: work => kernel.withTransaction(work), host });
  const client: Pick<AgentLibraryClientPort, 'inspect' | 'effective'> = { inspect: async id => service.inspect(id), effective: async (ref, project) => service.effective(ref, project) };
  const created = service.create({ commandId: randomUUID(), title: 'Synthetic Researcher', projectId: null, profile: agentTemplates()[0].profile });
  const link = () => {
    desktop.apply({ type: 'createResource', kind: 'task', title: 'Synthetic manual task reference', workspaceId: null }, () => { throw new Error('No provider creation'); });
    const task = db.prepare("SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE d.kind='task' ORDER BY r.rowid DESC LIMIT 1").get()!;
    const configuration = service.effective(created.agent, null);
    return service.recordAssignment({ commandId: randomUUID(), agent: created.agent, task: { id: String(task.id), version: Number(task.version) },
      expectedCatalogRevision: configuration.catalogRevision, expectedConfigurationDigest: configuration.digest });
  };
  return { kernel, db, service, client, created, link, deny() { allowed = false; } };
}
