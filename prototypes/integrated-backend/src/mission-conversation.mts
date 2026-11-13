import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { MissionProjection } from './mission-contracts.mts';
import { missionCompletion, missionResultAvailable } from './mission-native.mts';

interface ReceiptHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  read(missionId: string): MissionProjection;
  allowed(mission: MissionProjection): boolean;
  append(resourceId: string, content: string, referenceIds: string[]): string;
  record(mission: MissionProjection, messageId: string): void;
}

// Excludes mutable delivery/layout events. A receipt identifies the exact verified evidence.
function evidenceDigest(mission: MissionProjection): string {
  return createHash('sha256').update(JSON.stringify({ planRevision: mission.planRevision,
    criteria: mission.criteria,...(mission.coverage?{coverage:mission.coverage}:{}), tasks: mission.tasks.map(task => ({ id: task.id, state: task.state,
      evidence: task.attempts.at(-1)?.evidence, verification: task.attempts.at(-1)?.verification })) })).digest('hex');
}

/** An attributed handoff in one canonical local chat, independent of Vela's global history. */
export class MissionConversationReceipts {
  private readonly host: ReceiptHost;
  private readonly receiptByMessage: StatementSync;
  private readonly checking = new Set<string>();

  constructor(host: ReceiptHost) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS vela_mission_conversation_receipts (
      mission_id TEXT NOT NULL REFERENCES vela_missions(id) ON DELETE CASCADE,
      evidence_digest TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      UNIQUE(mission_id,evidence_digest)
    ) STRICT;`);
    this.receiptByMessage = host.db.prepare('SELECT mission_id, evidence_digest, resource_id FROM vela_mission_conversation_receipts WHERE message_id=?');
  }

  publish(mission: MissionProjection, acknowledge: () => void): boolean {
    if (!missionResultAvailable(mission) || !this.host.allowed(mission)) return false;
    const resourceId = mission.workroom!.missionConversationResourceId!, digest = evidenceDigest(mission);
    this.host.atomic(() => {
      const previous = this.host.db.prepare(`SELECT message_id FROM vela_mission_conversation_receipts
        WHERE mission_id=? AND evidence_digest=?`).get(mission.id, digest);
      if (!previous) {
        const evidence = mission.tasks.map(task => ({ taskId: task.id, evidence: task.attempts.at(-1)?.evidence }));
        const recordedAt = mission.events.findLast(event => event.kind === 'settled' && event.detail === 'verified')!.time;
        const content = [`Mission ${mission.id} · plan ${mission.planRevision}`, `Objective: ${mission.objective}`,
          `${mission.coverage?'Partial evidence':'Verified result'} recorded at ${recordedAt}`, missionCompletion(mission).content,
          ...evidence.flatMap(({ taskId, evidence: item }) => item ?
            [`Evidence ${taskId}: ${item.id} · ${item.source} · observed ${item.observedAt}`] : []),
          `This handoff records ${mission.coverage?'partial evidence, not a completed investigation':'that verified result'}. Open the mission plan for current status and evidence.`].join('\n');
        const messageId = this.host.append(resourceId, content, [mission.id,
          ...evidence.flatMap(row => row.evidence ? [row.evidence.id] : [])]);
        this.host.db.prepare('INSERT INTO vela_mission_conversation_receipts VALUES(?,?,?,?)')
          .run(mission.id, digest, resourceId, messageId);
        this.host.record(mission, messageId);
      }
      acknowledge();
    });
    return true;
  }

  /** Every source read, including inherited branch messages and future sends, rechecks authority. */
  sourceAllowed(messageId: string): boolean {
    const row = this.receiptByMessage.get(messageId);
    if (!row) return true;
    const id = String(row.mission_id);
    if (this.checking.has(id)) return false;
    this.checking.add(id);
    try {
      const current = this.host.read(id);
      return missionResultAvailable(current) && this.host.allowed(current) &&
        current.workroom?.missionConversationResourceId === row.resource_id && evidenceDigest(current) === row.evidence_digest;
    } catch { return false; }
    finally { this.checking.delete(id); }
  }
}
