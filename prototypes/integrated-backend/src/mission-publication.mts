import type { DatabaseSync } from 'node:sqlite';
import { ensure } from './contracts.mts';
import { MISSION_LIMITS, type Mission } from './mission-contracts.mts';

interface MissionPublicationHost {
  /** Persist the event and acknowledge it in the same transaction. */
  lifecycle(missionId: string, seq: number, ack: () => void): void;
  /** A deferred report stays pending. A handled report must acknowledge it transactionally. */
  report(missionId: string, seq: number, ack: () => void): boolean;
  conversation?(missionId: string, seq: number, ack: () => void): boolean;
}

const lifecycleBatch = 64;

/** Stores only journal coordinates. The mission journal remains the source of evidence. */
export class MissionPublication {
  private readonly db: DatabaseSync;
  private flushing = false;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS vela_mission_lifecycle_outbox (
      mission_id TEXT NOT NULL REFERENCES vela_missions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND ${MISSION_LIMITS.events}),
      UNIQUE(mission_id,seq)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vela_mission_report_outbox (
      mission_id TEXT PRIMARY KEY REFERENCES vela_missions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND ${MISSION_LIMITS.events})
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vela_mission_conversation_outbox (
      mission_id TEXT PRIMARY KEY REFERENCES vela_missions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND ${MISSION_LIMITS.events})
    ) STRICT;`);
  }

  stage(mission: Mission, from: number): void {
    ensure(this.db.isTransaction, 'mission_publication_requires_transaction');
    const events = mission.events.slice(from);
    if (!events.length) return;
    const enqueue = this.db.prepare(`INSERT INTO vela_mission_lifecycle_outbox VALUES(?,?)
      ON CONFLICT(mission_id,seq) DO NOTHING`);
    for (const event of events) enqueue.run(mission.id, event.seq);

    if (mission.disposition === 'cancelled' ||
        !mission.tasks.length || !mission.tasks.every(task => task.state === 'verified')) return;
    const settled = events.findLast(event => event.kind === 'settled' && event.detail === 'verified');
    if (settled && mission.originConversationId) this.db.prepare(`INSERT INTO vela_mission_report_outbox VALUES(?,?)
      ON CONFLICT(mission_id) DO UPDATE SET seq=excluded.seq WHERE excluded.seq > vela_mission_report_outbox.seq`)
      .run(mission.id, settled.seq);
    const conversation = mission.workroom?.missionConversationResourceId && (settled ??
      (events.some(event => event.kind === 'workroom') && mission.events.findLast(event =>
        event.kind === 'settled' && event.detail === 'verified')));
    if (conversation) this.db.prepare(`INSERT INTO vela_mission_conversation_outbox VALUES(?,?)
      ON CONFLICT(mission_id) DO UPDATE SET seq=excluded.seq WHERE excluded.seq > vela_mission_conversation_outbox.seq`)
      .run(mission.id, conversation.seq);
  }

  ackReport(missionId: string): void {
    ensure(this.db.isTransaction, 'mission_publication_requires_transaction');
    const removed = this.db.prepare('DELETE FROM vela_mission_report_outbox WHERE mission_id=?').run(missionId);
    ensure(removed.changes === 1 || !this.hasReport(missionId), 'mission_publication_ack_failed');
  }

  hasLifecycle(missionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM vela_mission_lifecycle_outbox WHERE mission_id=? LIMIT 1').get(missionId);
  }

  hasReport(missionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM vela_mission_report_outbox WHERE mission_id=?').get(missionId);
  }

  hasConversation(missionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM vela_mission_conversation_outbox WHERE mission_id=?').get(missionId);
  }

  flush(host: MissionPublicationHost): { continue: boolean; retry: boolean } {
    if (this.flushing) return { continue: false, retry: false };
    this.flushing = true;
    try {
      let retry = false, advanced = 0;
      const events = this.db.prepare(`SELECT mission_id,seq FROM vela_mission_lifecycle_outbox
        ORDER BY rowid LIMIT ?`).all(lifecycleBatch);
      const ackEvent = this.db.prepare('DELETE FROM vela_mission_lifecycle_outbox WHERE mission_id=? AND seq=?');
      for (const row of events) {
        const id = String(row.mission_id), seq = Number(row.seq);
        let acknowledged = false;
        try {
          host.lifecycle(id, seq, () => {
            ensure(this.db.isTransaction, 'mission_publication_requires_transaction');
            ensure(ackEvent.run(id, seq).changes === 1, 'mission_publication_ack_failed');
            acknowledged = true;
          });
        } catch { retry = true; break; }
        if (!acknowledged) { retry = true; break; }
        advanced++;
      }

      const reports = this.db.prepare(`SELECT mission_id,seq FROM vela_mission_report_outbox AS report
        WHERE NOT EXISTS (SELECT 1 FROM vela_mission_lifecycle_outbox WHERE mission_id=report.mission_id)
        ORDER BY rowid LIMIT ?`).all(MISSION_LIMITS.missions);
      const ackReport = this.db.prepare('DELETE FROM vela_mission_report_outbox WHERE mission_id=? AND seq=?');
      for (const row of reports) {
        const id = String(row.mission_id), seq = Number(row.seq);
        let acknowledged = false;
        try {
          const handled = host.report(id, seq, () => {
            ensure(this.db.isTransaction, 'mission_publication_requires_transaction');
            ensure(ackReport.run(id, seq).changes === 1, 'mission_publication_ack_failed');
            acknowledged = true;
          });
          if (handled && !acknowledged) retry = true;
        } catch { retry = true; }
      }
      if (host.conversation) {
        const conversations = this.db.prepare(`SELECT mission_id,seq FROM vela_mission_conversation_outbox
          WHERE NOT EXISTS (SELECT 1 FROM vela_mission_lifecycle_outbox WHERE
            mission_id=vela_mission_conversation_outbox.mission_id)
          ORDER BY rowid LIMIT ?`).all(MISSION_LIMITS.missions);
        const remove = this.db.prepare('DELETE FROM vela_mission_conversation_outbox WHERE mission_id=? AND seq=?');
        for (const row of conversations) {
          let acknowledged = false;
          try {
            const handled = host.conversation(String(row.mission_id), Number(row.seq), () => {
              ensure(this.db.isTransaction, 'mission_publication_requires_transaction');
              ensure(remove.run(row.mission_id, row.seq).changes === 1, 'mission_publication_ack_failed');
              acknowledged = true;
            });
            if (handled && !acknowledged) retry = true;
          } catch { retry = true; }
        }
      }
      const moreEvents = advanced === lifecycleBatch &&
        !!this.db.prepare('SELECT 1 FROM vela_mission_lifecycle_outbox LIMIT 1').get();
      return { continue: moreEvents, retry };
    } finally { this.flushing = false; }
  }
}
