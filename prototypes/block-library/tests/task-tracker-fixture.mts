import { createHash, randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import { TaskObjectiveService, type TaskObjectiveHost } from '../../task-product/service.mts';
import type { TaskDefinition, TaskExecutionMetadata, TaskObjectivePort, TaskObjectiveResource, TaskSourceRef } from '../../task-product/contracts.ts';

/** Actual canonical Kernel/Task service. Host policy and retained Core execution
 * metadata are explicit synthetic fixtures; no app, provider or runner starts. */
export function taskTrackerFixture(t: any) {
  const kernel = WorkspaceKernel.open(':memory:'), db = kernel.withTransaction(db => db), desktop = new DesktopState(kernel, db);
  t.after(() => kernel.close());
  db.exec('CREATE TABLE integration_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)');
  db.prepare('INSERT INTO integration_state VALUES(1,?)').run(JSON.stringify({ schemaVersion: 1, graph: { messages: [] }, revisions: {}, executions: {} }));
  const denied = new Set<string>(), deniedOperations = new Set<string>(); let writable = true;
  const raw = (id: string) => db.prepare('SELECT r.*,d.kind semantic_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?').get(id);
  const access = (id: string) => !!raw(id) && !denied.has(id);
  const resource = (id: string): TaskObjectiveResource | null => {
    const value = raw(id); return value?.kind === 'generic' && value.semantic_kind === 'task_objective' ? { id, kind: 'task_objective', title: String(value.title),
      projectId: value.project_id as string | null, version: Number(value.version), state: value.state as 'active' | 'archived' } : null;
  };
  const ref = (resourceId: string): TaskSourceRef => ({ resourceId, revision: 'resource:' + raw(resourceId)!.version + ':content:' +
    (db.prepare('SELECT revision FROM notes WHERE resource_id=?').get(resourceId)?.revision ?? 0) });
  const execution = (id: string): TaskExecutionMetadata | null => {
    const row = db.prepare('SELECT json_extract(json,?) record FROM integration_state WHERE id=1').get('$.executions.' + JSON.stringify(id));
    return row?.record ? { ...JSON.parse(String(row.record)), revision: createHash('sha256').update(String(row.record)).digest('hex') } : null;
  };
  const host: TaskObjectiveHost = { db, identity: () => ({ principalId: 'synthetic:task-owner', actorKind: 'user', authority: 'manual', policyVersion: 'synthetic:policy:1' }),
    now: () => '2026-11-02T12:00:00.000Z', authorize: input => ({ decision: deniedOperations.has(input.operation) ? 'deny' : 'allow',
      authorizationRef: 'synthetic:authorization:' + input.operation + ':' + input.requestDigest, policyVersion: 'synthetic:policy:1' }),
    projectAccess: () => false, resourceAccess: access,
    readResource: id => { const value = resource(id); return value ? { resource: value, authorized: access(id), writable } : null; },
    createResource: input => { const value = kernel.createGenericResource(input.title, input.projectId); db.prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,'task_objective')").run(value.id); return resource(value.id)!; },
    touchResource: input => { kernel.touchGenericResource(input.resourceId, input.expectedVersion); return resource(input.resourceId)!; },
    resolveReference: value => { const r = raw(value.resourceId); return r && access(value.resourceId) && !value.messageId ? { reference: ref(value.resourceId), projectId: r.project_id as string | null, state: r.state as 'active' | 'archived' } : null; },
    resolveAssignee: value => value.kind === 'principal' && value.principalId === 'synthetic:task-owner' ? { reference: value, projectId: null } : null,
    execution,
    recordEvent: event => { db.prepare('INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), 'task-objective', event.resourceId, event.resourceId, event.resourceVersion, host.now(), 'user', event.commandId, event.type, JSON.stringify(event.detail)); },
  };
  const service = new TaskObjectiveService(kernel, host);
  const definition = (patch: Partial<TaskDefinition> = {}): TaskDefinition => ({ objective: 'Deliver an inspected synthetic artifact',
    requirements: [{ id: 'criterion:one', text: 'Artifact meets the recorded criterion' }], assignees: [], dependencies: [], sources: [], ...structuredClone(patch) });
  const create = (value = definition()) => service.create({ commandId: randomUUID(), title: 'Synthetic Task Tracker', projectId: null, definition: value });
  const source = kernel.createNote('Synthetic evidence', 'SYNTHETIC_PRIVATE_EVIDENCE_BODY');
  const created = create();
  const port: TaskObjectivePort = { create: async value => service.create(value), read: async id => service.read(id), mutate: async value => service.mutate(value),
    history: async value => service.history(value), list: async value => service.list(value) };
  const seedExistingExecution = (resourceId = source.id, state: TaskExecutionMetadata['state'] = 'provider_completed', id: string = randomUUID()) => {
    const record = { id, resourceId, providerId: 'synthetic-provider', commandId: 'synthetic:retained-command', state,
      nativeThreadId: 'synthetic:thread', nativeTurnId: 'synthetic:turn', nativeResponseId: null };
    db.prepare('UPDATE integration_state SET json=json_set(json,?,json(?)) WHERE id=1').run('$.executions.' + JSON.stringify(id), JSON.stringify(record)); return execution(id)!;
  };
  return { kernel, db, desktop, host, service, port, created, source, definition, create, ref, execution, seedExistingExecution, denied, deniedOperations, setWritable(value: boolean) { writable = value; } };
}
