import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { TimerService } from '../service.mts';
import type { ClockTimerResource, TimerClockReading, TimerDomainEvent, TimerHostPort, TimerOperation } from '../contracts.ts';

/** Real kernel/SQLite, explicit synthetic semantic host. This does not claim native registry integration. */
export function fixture(t: TestContext, path = ':memory:') {
  const kernel = WorkspaceKernel.open(path), db = kernel.withTransaction(db => db);
  db.exec(`CREATE TABLE IF NOT EXISTS synthetic_timer_kinds(resource_id TEXT PRIMARY KEY REFERENCES resources(id),kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS synthetic_timer_events(id INTEGER PRIMARY KEY,json TEXT NOT NULL);`);
  const revoked = new Set<string>(), readOnly = new Set<string>();
  const clock: TimerClockReading = { epochMs: Date.parse('2026-11-03T12:00:00Z'), monotonicMs: 1000,
    sessionId: 'synthetic-session:1', timeZone: 'America/New_York', locale: 'en-US' };
  let failEvent = false, deniedCreate = false;
  const read = (resourceId: string): ClockTimerResource => {
    const r = kernel.getResource(resourceId).resource;
    const kind = db.prepare('SELECT kind FROM synthetic_timer_kinds WHERE resource_id=?').get(resourceId)?.kind;
    return { id: r.id, kind: String(kind ?? r.kind) as 'clock_timer', title: r.title, version: r.version,
      projectId: r.project_id, state: r.state };
  };
  const host: TimerHostPort = {
    db, atomic: work => kernel.withTransaction(work), clock: () => ({ ...clock }),
    createResource(input) {
      if (deniedCreate) throw new Error('synthetic_create_denied');
      const r = kernel.createGenericResource(input.title, input.projectId);
      db.prepare('INSERT INTO synthetic_timer_kinds VALUES(?,?)').run(r.id, input.kind);
      return read(r.id);
    },
    readResource(resourceId) {
      try {
        const resource = read(resourceId);
        return { resource, authorized: !revoked.has(resourceId) && (!resource.projectId ||
          kernel.subjectState({ kind: 'project', projectId: resource.projectId }) === 'active'), writable: !readOnly.has(resourceId) };
      } catch { return null; }
    },
    touchResource(input) { kernel.touchGenericResource(input.resourceId, input.expectedVersion); return read(input.resourceId); },
    recordEvent(event) {
      db.prepare('INSERT INTO synthetic_timer_events(json) VALUES(?)').run(JSON.stringify(event));
      if (failEvent) throw new Error('synthetic_event_failure');
    },
  };
  const service = new TimerService(kernel, host);
  let closed = false;
  const close = () => { if (!closed) { closed = true; kernel.close(); } };
  t.after(close);
  const mutate = (resourceId: string, operations: TimerOperation[], expectedVersion = service.read(resourceId).resource.version,
    commandId = randomUUID()) => service.mutate({ commandId, resourceId, expectedVersion, operations });
  const create = (title = 'Synthetic clocks', projectId: string | null = null) =>
    service.create({ commandId: randomUUID(), title, projectId });
  const count = (table: string) => {
    if (!/^[a-z_]+$/u.test(table)) throw new Error('invalid test table');
    return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
  };
  return { kernel, db, host, service, clock, revoked, readOnly, close, create, mutate, count,
    advance(ms: number) { clock.epochMs += ms; clock.monotonicMs += ms; },
    failEvent(value = true) { failEvent = value; }, denyCreate() { deniedCreate = true; },
    events: () => db.prepare('SELECT json FROM synthetic_timer_events ORDER BY id').all().map(row => JSON.parse(String(row.json)) as TimerDomainEvent) };
}
