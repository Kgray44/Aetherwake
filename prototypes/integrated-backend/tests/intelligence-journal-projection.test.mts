import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { StreamEvent } from '../src/contracts.mts';
import { createIntelligenceJournalProjection } from '../src/intelligence-journal-projection.mts';

test('scoped renderer replay uses the existing read snapshot and advances across a denied row', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE integration_meta(id INTEGER PRIMARY KEY, latest INTEGER NOT NULL);
      INSERT INTO integration_meta VALUES(1, 6);
      CREATE TABLE intelligence_events(cursor INTEGER PRIMARY KEY, dedupe TEXT NOT NULL, json TEXT NOT NULL);
    `);
    const insert = db.prepare('INSERT INTO intelligence_events VALUES(?,?,?)');
    insert.run(2, 'denied', JSON.stringify({ cursor: 2, type: 'synthetic/denied' }));
    insert.run(6, 'visible', JSON.stringify({
      cursor: 6, type: 'synthetic/visible', payload: { redacted: true, delta: 'private' },
      externalEvidence: 'private', externalCoverage: 'private',
    }));

    let deny = true;
    const journal = createIntelligenceJournalProjection({
      db,
      withReadSnapshot: read => {
        db.exec('SAVEPOINT owner_snapshot');
        try { return read(); }
        finally { db.exec('RELEASE owner_snapshot'); }
      },
      rendererScope: () => {
        assert.equal(db.isTransaction, true);
        return deny ? 'original-scope' : 'current-scope';
      },
      missionScope: () => null,
      resourceAllowed: (event: StreamEvent) => {
        assert.equal(db.isTransaction, true);
        return !deny || event.cursor !== 2;
      },
    });

    assert.deepEqual(journal.rendererPage({ after: 1, limit: 1 }), {
      events: [], earliest: 2, latest: 6, scannedThrough: 2, truncated: false, scope: 'original-scope',
    });
    assert.deepEqual(journal.rendererPage({ recent: true }), {
      events: [{ cursor: 6, type: 'synthetic/visible', payload: { redacted: true } }],
      earliest: 2, latest: 6, scannedThrough: 6, truncated: true, scope: 'original-scope',
    });
    deny = false;
    const page = journal.rendererPage({ after: 1, limit: 1 });
    assert.deepEqual(page.events, [{ cursor: 2, type: 'synthetic/denied' }]);
    assert.equal(page.scope, 'current-scope');
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare('SELECT total_changes() AS count').get()!.count, 3);
  } finally {
    db.close();
  }
});
