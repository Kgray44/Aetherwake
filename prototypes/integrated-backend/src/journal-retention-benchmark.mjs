import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const statements = {
  previous: 'DELETE FROM events WHERE cursor NOT IN (SELECT cursor FROM events ORDER BY cursor DESC LIMIT ?)',
  range: 'DELETE FROM events WHERE cursor < (SELECT cursor FROM events ORDER BY cursor DESC LIMIT 1 OFFSET ? - 1)',
};
const warmups = 20;
const samples = 100;

function measure(sql, retained) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE events(cursor INTEGER PRIMARY KEY, dedupe TEXT NOT NULL UNIQUE, json TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO events VALUES(?,?,?)');
    const append = index => insert.run(index * 2, 'synthetic:' + index, '{"type":"synthetic/benchmark"}');
    const remove = db.prepare(sql);
    db.exec('BEGIN');
    for (let i = 1; i <= retained; i++) append(i);
    db.exec('COMMIT');
    const times = [];
    for (let i = 0; i < warmups + samples; i++) {
      append(retained + i + 1);
      const started = performance.now();
      assert.equal(remove.run(retained).changes, 1);
      const elapsed = performance.now() - started;
      if (i >= warmups) times.push(elapsed);
    }
    const last = (retained + warmups + samples) * 2;
    const cursors = db.prepare('SELECT cursor FROM events ORDER BY cursor').all();
    assert.equal(cursors.length, retained);
    assert(cursors.every((row, i) => row.cursor === last - (retained - i - 1) * 2));
    times.sort((a, b) => a - b);
    return {
      p50Ms: times[Math.ceil(samples * 0.50) - 1],
      p95Ms: times[Math.ceil(samples * 0.95) - 1],
    };
  } finally {
    db.close();
  }
}

console.log(JSON.stringify({ node: process.version, platform: process.platform, warmups, samples }));
for (const retained of [100, 10_000, 100_000]) {
  console.log(JSON.stringify({ retained, ...Object.fromEntries(
    Object.entries(statements).map(([name, sql]) => [name, measure(sql, retained)]),
  ) }));
}
