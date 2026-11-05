import { randomUUID } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import { TimelineService, type TimelineHostPort } from '../../timeline-product/service.mts';
import type { TimelineEventHeader, TimelineResource, TimelineView, TimelinePort } from '../../timeline-product/contracts.ts';

/** Same canonical SQLite schema with synthetic retained headers. No application,
 * provider, competing event store or source-payload access is exercised. */
export function timelineFixture(t: any) {
  const kernel = WorkspaceKernel.open(':memory:'), db = kernel.withTransaction(db => db), desktop = new DesktopState(kernel, db); t.after(() => kernel.close());
  const source = kernel.createNote('Synthetic canonical source', 'Synthetic source content'), deniedResources = new Set<string>();
  let denied = false, writable = true;
  const resource = (id: string): TimelineResource | null => {
    const r = db.prepare("SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=? AND d.kind='timeline'").get(id);
    return r ? { id, kind: 'timeline', title: String(r.title), projectId: r.project_id as string | null, version: Number(r.version), state: r.state as 'active' | 'archived' } : null;
  };
  const events: Parameters<TimelineHostPort['recordEvent']>[0][] = [];
  const host: TimelineHostPort = { db, identity: () => ({ principalId: 'synthetic:timeline-owner', policyVersion: 'synthetic:timeline-policy' }),
    projectAccess: () => false, resourceAccess: id => !deniedResources.has(id) && !!db.prepare('SELECT 1 FROM resources WHERE id=?').get(id), eventAccess: () => !denied,
    readResource: id => { const r = resource(id); return r ? { resource: r, authorized: !denied, writable } : null; },
    createResource(input) { const r = kernel.createGenericResource(input.title, input.projectId); db.prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,'timeline')").run(r.id); return resource(r.id)!; },
    touchResource(input) { kernel.touchGenericResource(input.resourceId, input.expectedVersion); return resource(input.resourceId)!; },
    recordEvent: event => { events.push(structuredClone(event)); },
  };
  const service = new TimelineService(kernel, host);
  const view: TimelineView = { schemaVersion: 1, mode: 'activity', scope: { projectId: null, resourceIds: [] }, sources: { providerIds: [], eventTypes: [], classifications: ['observed', 'reported', 'inferred', 'simulated'] },
    viewport: { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z', displayTimeZone: 'UTC' }, selection: null };
  const created = service.create({ commandId: randomUUID(), title: 'Synthetic retained timeline', projectId: null, view });
  const port: TimelinePort = { create: async input => service.create(input), read: async id => service.read(id), save: async input => service.save(input), query: async input => service.query(input) };
  db.exec('CREATE TABLE intelligence_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,dedupe TEXT NOT NULL UNIQUE,json TEXT NOT NULL); CREATE TABLE integration_meta(id INTEGER PRIMARY KEY CHECK(id=1),latest INTEGER NOT NULL); INSERT INTO integration_meta VALUES(1,0);');
  const add = (patch: Partial<TimelineEventHeader> = {}) => {
    const result = db.prepare('INSERT INTO intelligence_events(dedupe,json) VALUES(?,?)').run(randomUUID(), '{}');
    const event: TimelineEventHeader = { schemaVersion: 1, eventId: randomUUID(), cursor: Number(result.lastInsertRowid), resourceId: source.id, executionId: null,
      providerId: 'synthetic-provider', providerInstanceId: 'synthetic-instance', connectionId: 'synthetic-connection', nativeEventId: null, nativeSequence: null,
      threadId: null, turnId: null, correlationId: null, causationId: null, receivedAt: '2026-11-02T12:00:00.000Z', providerTime: null, providerTimeSource: null,
      type: 'synthetic.private_event', classification: 'observed', status: null, ...patch };
    db.prepare('UPDATE intelligence_events SET json=? WHERE cursor=?').run(JSON.stringify({ ...event, payload: { delta: 'SYNTHETIC_PRIVATE_PAYLOAD_MUST_NOT_RENDER' } }), event.cursor);
    db.prepare('UPDATE integration_meta SET latest=? WHERE id=1').run(event.cursor); return event;
  };
  return { kernel, db, desktop, service, port, created, source, view, add, deniedResources, events, authorized: () => !denied, setDenied(value: boolean) { denied = value; }, setWritable(value: boolean) { writable = value; } };
}
