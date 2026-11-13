import type { DatabaseSync } from 'node:sqlite';
import { ensure } from './contracts.mts';
import type { MissionScope } from './mission-contracts.mts';

const lifetimeMs = 24 * 60 * 60 * 1000;
export type MissionExperiencePolicy = {
  scope: MissionScope; version: number; experimentId: string | null; hostCohort: string | null;
  governorVersion: number | null; expiresAtMs: number | null;
};

/** MissionService's native-probe policy. Effective only at admission, inside existing ARIE bounds. */
export function createMissionExperiencePolicy(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS mission_experience_policy(
    workspace_id TEXT NOT NULL, project_key TEXT NOT NULL, version INTEGER NOT NULL,
    experiment_id TEXT, host_cohort TEXT, governor_version INTEGER, expires_at_ms INTEGER,
    PRIMARY KEY(workspace_id,project_key)
  ) STRICT`);
  const read = (scope: MissionScope): MissionExperiencePolicy => {
    const row = db.prepare(`SELECT version, experiment_id AS experimentId, host_cohort AS hostCohort,
      governor_version AS governorVersion, expires_at_ms AS expiresAtMs FROM mission_experience_policy
      WHERE workspace_id=? AND project_key=?`).get(scope.workspaceId, scope.projectId ?? '');
    return row ? { scope, ...row } as MissionExperiencePolicy :
      { scope, version: 1, experimentId: null, hostCohort: null, governorVersion: null, expiresAtMs: null };
  };
  const save = (scope: MissionScope, expected: number, experimentId: string | null, hostCohort: string | null,
    governorVersion: number | null, expiresAtMs: number | null) => {
    const written = db.prepare(`INSERT INTO mission_experience_policy VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,project_key) DO UPDATE SET version=excluded.version, experiment_id=excluded.experiment_id,
      host_cohort=excluded.host_cohort, governor_version=excluded.governor_version, expires_at_ms=excluded.expires_at_ms
      WHERE version=?`).run(scope.workspaceId, scope.projectId ?? '', expected + 1, experimentId, hostCohort,
      governorVersion, expiresAtMs, expected);
    ensure(written.changes === 1, 'aep_policy_version_changed');
    return read(scope);
  };
  return {
    read,
    promote(scope: MissionScope, expected: number, experimentId: string, hostCohort: string, governorVersion: number, now: number) {
      ensure(read(scope).version === expected, 'aep_policy_version_changed');
      return save(scope, expected, experimentId, hostCohort, governorVersion, now + lifetimeMs);
    },
    rollback(scope: MissionScope, expected: number) {
      const current = read(scope);
      ensure(current.version === expected && current.experimentId, 'aep_policy_rollback_unavailable');
      return save(scope, expected, null, null, null, null);
    },
  };
}
