import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { MISSION_CONTRACT, type Mission, type MissionEvent } from '../src/mission-contracts.mts';
import { MissionPublication } from '../src/mission-publication.mts';

const time = '2026-01-01T00:00:00.000Z';
const event = (seq: number, kind: MissionEvent['kind'] = 'created', detail?: string): MissionEvent =>
  ({ seq, kind, time, ...(detail ? { detail } : {}) });

function mission(id: string, events: MissionEvent[], state: Mission['tasks'][number]['state'] = 'verified'): Mission {
  return {
    contract: MISSION_CONTRACT, id, requestId: id, objective: 'Synthetic mission', scope: { workspaceId: 'work', projectId: null },
    criteria: ['check'], createdAt: time, revision: events.length, planRevision: 1, concurrency: 1, disposition: 'active',
    originConversationId: 'conversation', events,
    tasks: [{ id: 'check', objective: 'Synthetic verification', executor: 'fixture', dependencies: [], claims: [],
      criterion: 'check', timeoutMs: 1000, maxAttempts: 1, state, queuedAt: time, priority: 0, attempts: [] }],
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  const publication = new MissionPublication(db);
  db.exec(`CREATE TABLE vela_missions(id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE projected_events(mission_id TEXT NOT NULL, seq INTEGER NOT NULL, UNIQUE(mission_id, seq)) STRICT;
    CREATE TABLE projected_reports(mission_id TEXT PRIMARY KEY, seq INTEGER NOT NULL) STRICT;`);
  const atomic = <T,>(work: () => T): T => {
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const add = (value: Mission, from: number) => atomic(() => {
    db.prepare('INSERT OR IGNORE INTO vela_missions VALUES(?)').run(value.id);
    publication.stage(value, from);
  });
  const lifecycle = (id: string, seq: number, ack: () => void) => atomic(() => {
    db.prepare('INSERT INTO projected_events VALUES(?,?)').run(id, seq);
    ack();
  });
  const report = (id: string, seq: number, ack: () => void) => atomic(() => {
    db.prepare('INSERT INTO projected_reports VALUES(?,?)').run(id, seq);
    ack();
    return true;
  });
  const stored = (table: 'projected_events' | 'projected_reports') =>
    db.prepare(`SELECT mission_id,seq FROM ${table} ORDER BY rowid`).all().map(row => [row.mission_id, row.seq]);
  return { db, publication, atomic, add, lifecycle, report, stored };
}

test('stages only newly persisted coordinates, with no publication after a journal rollback', () => {
  const { db, publication, atomic, add, lifecycle, report, stored } = fixture();
  try {
    const value = mission('mission', [event(1), event(2, 'settled', 'verified')]);
    assert.throws(() => publication.stage(value, 0), /mission_publication_requires_transaction/);
    assert.throws(() => atomic(() => {
      db.prepare('INSERT INTO vela_missions VALUES(?)').run(value.id);
      publication.stage(value, 0);
      throw Error('journal write interrupted');
    }), /journal write interrupted/);
    assert.equal(publication.hasLifecycle(value.id), false);
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: false });
    assert.deepEqual(stored('projected_events'), []);
    assert.deepEqual(stored('projected_reports'), []);

    add(value, 1);
    add(value, 1);
    assert.equal(publication.hasLifecycle(value.id), true);
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: false });
    assert.deepEqual(stored('projected_events'), [[value.id, 2]]);
    assert.deepEqual(stored('projected_reports'), [[value.id, 2]]);
    assert.equal(publication.hasLifecycle(value.id), false);
    assert.equal(publication.hasReport(value.id), false);
  } finally { db.close(); }
});

test('rolls back a failed acknowledgement and leaves unrelated reports available', () => {
  const { db, publication, atomic, add, lifecycle, report, stored } = fixture();
  try {
    const events = [event(1), event(2, 'settled', 'verified')];
    add(mission('earlier', events), 0);
    assert.deepEqual(publication.flush({ lifecycle, report: () => false }), { continue: false, retry: false });
    add(mission('later', events), 0);
    const attempted: string[] = [];
    assert.deepEqual(publication.flush({
      lifecycle(id, seq, ack) {
        attempted.push(`${id}:${seq}`);
        atomic(() => {
          db.prepare('INSERT INTO projected_events VALUES(?,?)').run(id, seq);
          ack();
          throw Error('stream commit interrupted');
        });
      }, report,
    }), { continue: false, retry: true });
    assert.deepEqual(attempted, ['later:1']);
    assert.deepEqual(stored('projected_events'), [['earlier', 1], ['earlier', 2]]);
    assert.deepEqual(stored('projected_reports'), [['earlier', 2]]);
    assert.equal(publication.hasReport('later'), true);
    db.exec(`CREATE TRIGGER ignore_ack BEFORE DELETE ON vela_mission_lifecycle_outbox
      BEGIN SELECT RAISE(IGNORE); END;`);
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: true });
    assert.deepEqual(stored('projected_events'), [['earlier', 1], ['earlier', 2]]);
    db.exec('DROP TRIGGER ignore_ack');
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: false });
    assert.deepEqual(stored('projected_events'), [['earlier', 1], ['earlier', 2], ['later', 1], ['later', 2]]);
    assert.deepEqual(stored('projected_reports'), [['earlier', 2], ['later', 2]]);
  } finally { db.close(); }
});

test('continues with an unrelated report after a failure and a deferred origin', () => {
  const { db, publication, atomic, add, lifecycle, report, stored } = fixture();
  try {
    const events = [event(1), event(2, 'settled', 'verified')];
    for (const id of ['fails', 'deferred', 'ready']) add(mission(id, events), 0);
    assert.deepEqual(publication.flush({ lifecycle, report(id, seq, ack) {
      if (id === 'deferred') return false;
      if (id === 'fails') return atomic(() => {
        db.prepare('INSERT INTO projected_reports VALUES(?,?)').run(id, seq);
        ack();
        throw Error('report commit interrupted');
      });
      return report(id, seq, ack);
    } }), { continue: false, retry: true });
    assert.deepEqual(stored('projected_reports'), [['ready', 2]]);
    assert.equal(publication.hasReport('fails'), true);
    assert.equal(publication.hasReport('deferred'), true);
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: false });
    assert.deepEqual(stored('projected_reports'), [['ready', 2], ['fails', 2], ['deferred', 2]]);
  } finally { db.close(); }
});

test('drains a bounded lifecycle prefix before offering the latest verified report', () => {
  const { db, publication, atomic, add, lifecycle, report, stored } = fixture();
  try {
    const events = Array.from({ length: 65 }, (_, index) => event(index + 1, 'control'));
    events[63] = event(64, 'settled', 'verified');
    events[64] = event(65, 'settled', 'verified');
    add(mission('batch', events.slice(0, 64)), 0);
    add(mission('batch', events), 64);
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: true, retry: false });
    assert.equal(stored('projected_events').length, 64);
    assert.deepEqual(stored('projected_reports'), []);
    assert.deepEqual(publication.flush({ lifecycle: () => {}, report }), { continue: false, retry: true });
    assert.deepEqual(publication.flush({ lifecycle, report: () => true }), { continue: false, retry: true });
    assert.equal(stored('projected_events').length, 65);

    assert.throws(() => publication.ackReport('batch'), /mission_publication_requires_transaction/);
    atomic(() => {
      db.prepare('INSERT INTO projected_reports VALUES(?,?)').run('batch', 65);
      publication.ackReport('batch');
    });
    assert.deepEqual(publication.flush({ lifecycle, report }), { continue: false, retry: false });
    assert.deepEqual(stored('projected_reports'), [['batch', 65]]);
  } finally { db.close(); }
});
