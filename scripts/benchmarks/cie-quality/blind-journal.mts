import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { BlindJournal } from './blind-runner.mts';

type JournalState = NonNullable<Awaited<ReturnType<BlindJournal['read']>>>;
const maxStateBytes = 2 * 1024 * 1024;

function encode(state: JournalState): string {
  const text = JSON.stringify(state);
  if (Buffer.byteLength(text) > maxStateBytes) throw new Error('blind_journal_capacity');
  if (!isDeepStrictEqual(JSON.parse(text), state)) throw new Error('blind_journal_requires_json_state');
  return text;
}

/** Open a dedicated evaluation checkpoint file in the host's evidence directory. */
export function openBlindJournal(path: string, options?: { profileId: string }): BlindJournal & { close(): void } {
  if (options && !/^[a-zA-Z0-9:_-]{1,128}$/.test(options.profileId)) throw new Error('blind_journal_profile_invalid');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS cie_blind_journal (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cie_blind_profile (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        profile_id TEXT NOT NULL
      ) STRICT;`);
    db.exec('BEGIN IMMEDIATE');
    const binding = db.prepare('SELECT profile_id FROM cie_blind_profile WHERE singleton = 1').get();
    const profileId = options?.profileId ?? '';
    if (binding && binding.profile_id !== profileId) throw new Error('blind_journal_profile_mismatch');
    if (!binding) {
      if (options && db.prepare('SELECT 1 FROM cie_blind_journal WHERE singleton = 1').get()) {
        throw new Error('blind_journal_profile_unbound');
      }
      db.prepare('INSERT INTO cie_blind_profile VALUES (1, ?)').run(profileId);
    }
    db.exec('COMMIT');
    const read = db.prepare('SELECT state FROM cie_blind_journal WHERE singleton = 1');
    const insert = db.prepare('INSERT INTO cie_blind_journal VALUES (1, ?) ON CONFLICT(singleton) DO NOTHING');
    const replace = db.prepare('UPDATE cie_blind_journal SET state = ? WHERE singleton = 1 AND state = ?');
    return {
      async read() {
        const row = read.get();
        if (!row) return null;
        const text = row.state;
        if (typeof text !== 'string' || Buffer.byteLength(text) > maxStateBytes) throw new Error('blind_journal_invalid');
        const value = JSON.parse(text);
        if (!value?.checkpoint || (value.inFlight !== null && typeof value.inFlight !== 'string')) {
          throw new Error('blind_journal_invalid');
        }
        return value as JournalState;
      },
      async compareAndSet(expected, next) {
        const serialized = encode(next);
        const result = expected === null ? insert.run(serialized) : replace.run(serialized, encode(expected));
        return Number(result.changes) === 1;
      },
      close() { db.close(); },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
