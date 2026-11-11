import type { DatabaseSync } from 'node:sqlite';
import type { ResourcePolicyPersistence } from './resource-policy.mts';

/** Single authoritative preference and rollback row in the existing profile database. */
export function createResourcePolicyStore(db: DatabaseSync): ResourcePolicyPersistence {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_resource_preferences (
    id INTEGER PRIMARY KEY CHECK(id=1),
    version INTEGER NOT NULL CHECK(version>=2 AND version<=9007199254740991),
    json TEXT NOT NULL CHECK(length(json)<=4096)
  ) STRICT`);
  return {
    load() {
      const row = db.prepare('SELECT version,json FROM platform_resource_preferences WHERE id=1').get();
      if (!row) return null;
      let value: unknown = null;
      try { value = JSON.parse(String(row.json)); } catch { /* Expose degraded defaults and keep the CAS revision. */ }
      return { version: Number(row.version), value };
    },
    save(expectedVersion, version, value) {
      const json = JSON.stringify(value);
      const result = expectedVersion === null ?
        db.prepare('INSERT INTO platform_resource_preferences VALUES(1,?,?) ON CONFLICT(id) DO NOTHING').run(version, json) :
        db.prepare('UPDATE platform_resource_preferences SET version=?,json=? WHERE id=1 AND version=?').run(version, json, expectedVersion);
      if (result.changes !== 1) throw Error('stale_resource_policy');
    },
  };
}
