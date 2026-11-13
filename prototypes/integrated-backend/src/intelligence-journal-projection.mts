import type { DatabaseSync } from 'node:sqlite';
import { ensure, type CommandMap, type StreamEvent } from './contracts.mts';
import type { Mission, MissionEvent, MissionScope, MissionWorkroomStreamEvent } from './mission-contracts.mts';

export function missionStreamFields(mission: Mission, event: MissionEvent): Pick<StreamEvent, 'mission' | 'status' | 'payload'> {
  const executor = (mission.tasks.find(task => task.id === event.taskId) ??
    mission.retiredTasks?.find(task => task.id === event.taskId))?.executor;
  let status: string | null = event.kind === 'created' ? 'queued' : event.kind === 'started' ? 'running' : null;
  if (event.kind === 'settled' || event.kind === 'recovered') {
    if (event.detail && ['verified', 'failed', 'blocked', 'cancelled', 'uncertain'].includes(event.detail)) status = event.detail;
    else if (event.detail === 'paused_on_restart') status = 'paused';
    else if (event.kind === 'settled' && !event.attemptId) status = 'blocked';
  }
  return { mission: { id: mission.id, scope: mission.scope, kind: event.kind, seq: event.seq, occurredAt: event.time,
    ...(event.taskId ? { taskId: event.taskId } : {}), ...(event.attemptId ? { attemptId: event.attemptId } : {}),
    ...(executor ? { executor } : {}) }, status, payload: { redacted: true, ...(event.taskId ? { taskId: event.taskId } : {}) } };
}

export function streamScopeMatches(scope: MissionScope | null, origin: MissionScope | undefined) {
  return !!scope && scope.workspaceId === origin?.workspaceId && scope.projectId === origin.projectId;
}

interface IntelligenceJournalReadPorts {
  db: Pick<DatabaseSync, 'prepare'>;
  withReadSnapshot<T>(read: () => T): T;
  rendererScope(): string;
  missionScope(): MissionScope | null;
  resourceAllowed(event: StreamEvent): boolean;
}

/** Read projections of the canonical journal. Core retains writes and delivery. */
export function createIntelligenceJournalProjection({
  db, withReadSnapshot, rendererScope, missionScope, resourceAllowed,
}: IntelligenceJournalReadPorts) {
  function latestCursor() {
    return Number(db.prepare('SELECT latest FROM integration_meta WHERE id=1').get()!.latest);
  }

  function earliestCursor() {
    return db.prepare('SELECT min(cursor) AS value FROM intelligence_events').get()!.value as number | null;
  }

  function projectMissionEvent(event: StreamEvent, dedupe: string, scope: MissionScope | null,
    legacyMissions: Map<string, Mission | null>): StreamEvent | undefined {
    if (event.mission) return streamScopeMatches(scope, event.mission.scope) ? event : undefined;
    // Older rows have only a correlation ID. Bind them to the exact durable lifecycle event before disclosure.
    const id = event.correlationId;
    if (!scope || !id || event.providerId !== 'aerynth-native' || event.classification !== 'observed') return;
    if (!legacyMissions.has(id)) {
      const row = db.prepare('SELECT json FROM vela_missions WHERE id=?').get(id);
      legacyMissions.set(id, row ? JSON.parse(String(row.json)) as Mission : null);
    }
    const mission = legacyMissions.get(id);
    if (!mission || mission.id !== id || !streamScopeMatches(scope, mission.scope)) return;
    if (event.type === 'vela.mission/report-posted' && dedupe === 'mission:report:' + id &&
      db.prepare('SELECT 1 FROM vela_mission_report_links WHERE mission_id=?').get(id)) {
      return { ...event, mission: { id, scope: mission.scope, kind: 'report-posted' }, status: 'posted', payload: { redacted: true } };
    }
    const observed = mission.events.find(entry => event.type === 'vela.mission/' + entry.kind && dedupe === `mission:${id}:${entry.seq}`);
    if (observed) return { ...event, ...missionStreamFields(mission, observed) };
  }

  function rendererPage(input: CommandMap['rendererEventPage']['input']): CommandMap['rendererEventPage']['output'] {
    ensure(input && typeof input === 'object' && !Array.isArray(input) &&
      Object.keys(input).every(key => ['after', 'limit', 'recent'].includes(key)), 'invalid_cursor');
    const { recent = false, after = 0, limit = 250 } = input;
    ensure(typeof recent === 'boolean' && (!recent || input.after === undefined) &&
      Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 250, 'invalid_cursor');
    return withReadSnapshot(() => {
      // Read bounds, rows, and current access in one SQLite read snapshot. Raw rows determine
      // coverage, including rows that the current policy excludes from delivery.
      const scope = rendererScope();
      const scopeOfMission = missionScope(), legacyMissions = new Map<string, Mission | null>();
      const latest = latestCursor();
      const earliest = earliestCursor();
      const select = "SELECT cursor,dedupe,json_remove(json,'$.externalEvidence','$.externalCoverage','$.payload.delta') AS json FROM intelligence_events";
      const rows = recent
        ? db.prepare(select + ' ORDER BY cursor DESC LIMIT ?').all(limit).reverse()
        : db.prepare(select + ' WHERE cursor > ? ORDER BY cursor LIMIT ?').all(after, limit);
      const events = rows.flatMap(row => {
        const event = JSON.parse(String(row.json)) as StreamEvent;
        if (!resourceAllowed(event)) return [];
        if (!event.type.startsWith('vela.mission/')) return [event];
        const projected = projectMissionEvent(event, String(row.dedupe), scopeOfMission, legacyMissions);
        return projected ? [projected] : [];
      });
      const scannedThrough = recent || rows.length < limit ? latest : Number(rows.at(-1)!.cursor);
      const truncated = earliest !== null && (recent ? earliest > 1 || Number(rows[0]?.cursor) > earliest : after < earliest - 1);
      return { events, earliest, latest, scannedThrough, truncated, scope };
    });
  }

  function replay(a: CommandMap['replay']['input']): CommandMap['replay']['output'] {
    const after = a.after ?? 0, limit = a.limit ?? 100;
    ensure(Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'invalid_cursor');
    const scope = missionScope(), legacyMissions = new Map<string, Mission | null>();
    const rows = db.prepare(`SELECT e.dedupe, json_remove(e.json,'$.externalEvidence','$.externalCoverage') AS json
      FROM intelligence_events e WHERE e.cursor>? AND (json_extract(e.json,'$.type') NOT GLOB 'vela.mission/*'
        OR EXISTS (SELECT 1 FROM vela_missions m WHERE m.id=json_extract(e.json,'$.correlationId')
          AND json_extract(m.json,'$.scope.workspaceId')=? AND json_extract(m.json,'$.scope.projectId') IS ?))
      ORDER BY e.cursor LIMIT ?`).all(after, scope?.workspaceId ?? null, scope?.projectId ?? null, limit);
    const events = rows.flatMap(row => {
      const event = JSON.parse(String(row.json)) as StreamEvent;
      if (!event.type.startsWith('vela.mission/')) return [event];
      const projected = projectMissionEvent(event, String(row.dedupe), scope, legacyMissions);
      return projected ? [projected] : [];
    });
    const earliest = earliestCursor();
    const latest = latestCursor();
    return { events, earliest, latest, truncated: earliest !== null && after < earliest - 1 };
  }

  function readWorkroomStream(mission: Mission): MissionWorkroomStreamEvent[] {
    const legacy = new Map([[mission.id, mission]]);
    return db.prepare(`SELECT dedupe,json FROM intelligence_events
      WHERE json_extract(json,'$.correlationId')=? AND json_extract(json,'$.type') GLOB 'vela.mission/*'
      ORDER BY cursor DESC LIMIT 128`).all(mission.id).reverse().flatMap(row => {
      const stored = JSON.parse(String(row.json)) as StreamEvent;
      const event = projectMissionEvent(stored, String(row.dedupe), mission.scope, legacy);
      if (event?.mission?.id !== mission.id) return [];
      const { eventId, cursor, receivedAt, type, status, classification } = event;
      const { taskId, executor, occurredAt } = event.mission;
      return [{ eventId, cursor, receivedAt, type, status, classification,
        ...(occurredAt ? { occurredAt } : {}),
        ...(taskId ? { taskId } : {}), ...(executor ? { executor } : {}) }];
    });
  }

  return { latestCursor, rendererPage, replay, readWorkroomStream };
}
