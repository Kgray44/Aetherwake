import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import { ChecklistService } from '../service.mts';
import type { ChecklistHostPort, ChecklistResource } from '../contracts.ts';
import type { ChecklistOperation, ChecklistReference } from '../../application-contract/checklist.ts';
export function fixture(t: any, path = ':memory:', suppliedKernel?: WorkspaceKernel) {
  const kernel = suppliedKernel ?? WorkspaceKernel.open(path), db = kernel.withTransaction(db => db);
  // Reuse Root's existing logical-kind table, not a parallel resource catalog.
  new DesktopState(kernel, db);
  const revoked = new Set<string>(), readOnly = new Set<string>(), events: Parameters<ChecklistHostPort['recordEvent']>[0][] = [];
  let failEvent = false;
  const read = (resourceId: string): ChecklistResource => {
    const r = kernel.getResource(resourceId).resource, logical = db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(resourceId);
    return { id: r.id, kind: String(logical?.kind ?? r.kind), title: r.title, version: r.version, projectId: r.project_id, state: r.state };
  };
  const host: ChecklistHostPort = {
    db,
    atomic(work) { const count = events.length; try { return kernel.withTransaction(work); } catch (error) { events.length = count; throw error; } },
    createResource(input) { const r = kernel.createGenericResource(input.title, input.projectId); db.prepare('INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)').run(r.id, 'checklist'); return read(r.id); },
    readResource(resourceId) { try { const resource = read(resourceId); return { resource, authorized: !revoked.has(resourceId) && (!resource.projectId || kernel.subjectState({ kind: 'project', projectId: resource.projectId }) === 'active'), writable: !readOnly.has(resourceId) }; } catch { return null; } },
    touchResource(input) { kernel.touchGenericResource(input.resourceId, input.expectedVersion); return read(input.resourceId); },
    resolveReference(ref) {
      if (ref.kind === 'resource' || ref.kind === 'conversation') {
        const value = host.readResource(ref.resourceId);
        return value?.authorized && value.resource.state === 'active' && (ref.kind !== 'conversation' || value.resource.kind === 'conversation')
          ? { available: true, title: value.resource.title } : { available: false };
      }
      if (ref.kind === 'project') { const p = db.prepare('SELECT id,title,state FROM projects WHERE id=?').get(ref.projectId); return p && p.state === 'active' && !revoked.has(String(p.id)) ? { available: true, title: String(p.title) } : { available: false }; }
      return { available: false };
    },
    mutationContext: () => ({ actor: { kind: 'user', id: 'user:synthetic' }, authority: 'manual', at: new Date().toISOString() }),
    recordEvent(event) { events.push(structuredClone(event)); if (failEvent) throw new Error('synthetic_canonical_event_failure'); },
  };
  const service = new ChecklistService(kernel, host);
  let closed = false; const close = () => { if (!closed) { closed = true; kernel.close(); } }; if (!suppliedKernel) t.after(close);
  const count = (table: 'resources' | 'notes' | 'conversation_refs' | 'blocks' | 'workspaces' | 'checklist_documents' | 'checklist_receipts') => Number(db.prepare('SELECT count(*) AS n FROM ' + table).get()!.n);
  const mutate = (resourceId: string, operations: ChecklistOperation[], expectedVersion = service.read(resourceId).resource.version) => service.mutate({ commandId: randomUUID(), resourceId, expectedVersion, operations });
  return { kernel, db, host, service, events, revoked, readOnly, count, mutate, close, failEvent: () => { failEvent = true; } };
}
