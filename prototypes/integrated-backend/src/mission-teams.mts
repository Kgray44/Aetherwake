import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ensure, ServiceError } from './contracts.mts';
import type { MissionScope } from './mission-contracts.mts';

export interface MissionTeam {
  id: string;
  title: string;
  version: number;
  members: { profileId: string; responsibility: string }[];
}

export interface MissionTeamSave extends Pick<MissionTeam, 'title' | 'members'> {
  id?: string;
  expectedVersion?: number;
}

interface MissionTeamsHost {
  db: DatabaseSync;
  atomic<T>(work: () => T): T;
  authorized(scope: MissionScope): boolean;
  profileAvailable(scope: MissionScope, id: string): boolean;
}

const ACTIVE_TEAMS_PER_SCOPE = 32;
const RETAINED_TEAMS = 512;
const MAX_TITLE_BYTES = 120;
const MAX_RESPONSIBILITY_BYTES = 512;
const identifier = (value: unknown): value is string => typeof value === 'string' &&
  value.length >= 1 && value.length <= 120 && !/[^\w.:-]/u.test(value);
const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

function boundedText(value: unknown, bytes: number, code: string): string {
  ensure(typeof value === 'string' && value.length <= bytes && Buffer.byteLength(value) <= bytes &&
    !/[\u0000-\u001f\u007f]/u.test(value) && value.trim(), code);
  return value.trim();
}

function membersFrom(value: unknown, code: string): MissionTeam['members'] {
  ensure(Array.isArray(value) && value.length >= 2 && value.length <= 4, code);
  const members: MissionTeam['members'] = [];
  const seen = new Set<string>();
  for (const member of value) {
    ensure(member && typeof member === 'object' && Object.keys(member).length === 2 &&
      Object.hasOwn(member, 'profileId') && Object.hasOwn(member, 'responsibility') &&
      identifier(member.profileId) && !seen.has(member.profileId), code);
    seen.add(member.profileId);
    members.push({ profileId: member.profileId, responsibility: boundedText(member.responsibility, MAX_RESPONSIBILITY_BYTES, code) });
  }
  return members;
}

function teamFromRow(row: Record<string, unknown>): MissionTeam {
  const { id, title, version: revision, members } = row;
  const code = 'invalid_mission_team_record';
  ensure(identifier(id) && typeof title === 'string' && version(revision) && typeof members === 'string' &&
    Buffer.byteLength(members) <= 16 * 1024, code);
  let value: unknown;
  try { value = JSON.parse(members); } catch { throw new ServiceError(code); }
  return { id, title: boundedText(title, MAX_TITLE_BYTES, code), version: revision, members: membersFrom(value, code) };
}

/** Stores team assignments only. Execution resolves and authorizes each profile independently. */
export class MissionTeams {
  private readonly host: MissionTeamsHost;

  constructor(host: MissionTeamsHost) {
    this.host = host;
    host.atomic(() => host.db.exec(`CREATE TABLE IF NOT EXISTS vela_mission_teams (
      id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, title TEXT NOT NULL, title_key TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
      archived INTEGER NOT NULL CHECK(archived IN (0,1)), members TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS vela_mission_teams_active_title
      ON vela_mission_teams(scope_key,title_key) WHERE archived=0;`));
  }

  private scopeKey(scope: MissionScope, code: string): string {
    ensure(scope && identifier(scope.workspaceId) && (scope.projectId === null || identifier(scope.projectId)) &&
      this.host.authorized(scope), code);
    return scope.projectId === null ? `workspace:${scope.workspaceId}` : `project:${scope.projectId}`;
  }

  private lookup(id: string, scopeKey: string): MissionTeam {
    ensure(identifier(id), 'invalid_mission_team');
    const row = this.host.db.prepare('SELECT id,title,version,members FROM vela_mission_teams WHERE id=? AND scope_key=? AND archived=0')
      .get(id, scopeKey);
    ensure(row, 'mission_team_not_found');
    return teamFromRow(row);
  }

  list(scope: MissionScope): MissionTeam[] {
    const scopeKey = this.scopeKey(scope, 'mission_team_scope_denied');
    return this.host.db.prepare(`SELECT id,title,version,members FROM vela_mission_teams
      WHERE scope_key=? AND archived=0 ORDER BY title_key,id`).all(scopeKey).map(teamFromRow);
  }

  read(id: string, scope: MissionScope): MissionTeam {
    return this.lookup(id, this.scopeKey(scope, 'mission_team_not_found'));
  }

  save(input: MissionTeamSave, scope: MissionScope): MissionTeam {
    const invalid = 'invalid_mission_team';
    ensure(input && typeof input === 'object' && Object.hasOwn(input, 'title') && Object.hasOwn(input, 'members') &&
      Object.keys(input).every(key => ['id', 'expectedVersion', 'title', 'members'].includes(key)), invalid);
    const { id, expectedVersion } = input;
    ensure(id === undefined ? expectedVersion === undefined : identifier(id) && version(expectedVersion), invalid);
    const title = boundedText(input.title, MAX_TITLE_BYTES, invalid);
    const members = membersFrom(input.members, invalid);
    const titleKey = title.normalize('NFC').toLowerCase();

    return this.host.atomic(() => {
      const scopeKey = this.scopeKey(scope, id === undefined ? 'mission_team_scope_denied' : 'mission_team_not_found');
      const existing = id === undefined ? undefined : this.lookup(id, scopeKey);
      ensure(!existing || existing.version === expectedVersion, 'mission_team_version_conflict');
      ensure(members.every(member => this.host.profileAvailable(scope, member.profileId)), 'mission_team_profile_unavailable');
      const db = this.host.db;
      ensure(!db.prepare(`SELECT 1 FROM vela_mission_teams WHERE scope_key=? AND title_key=? AND archived=0 AND id IS NOT ?`)
        .get(scopeKey, titleKey, id ?? null), 'mission_team_title_conflict');
      const json = JSON.stringify(members);
      if (existing) {
        const result = db.prepare(`UPDATE vela_mission_teams SET title=?,title_key=?,members=?,version=version+1
          WHERE id=? AND scope_key=? AND version=? AND archived=0`)
          .run(title, titleKey, json, existing.id, scopeKey, existing.version);
        ensure(result.changes === 1, 'mission_team_version_conflict');
        return { id: existing.id, title, members, version: existing.version + 1 };
      }

      ensure(Number(db.prepare('SELECT count(*) AS count FROM vela_mission_teams WHERE scope_key=? AND archived=0').get(scopeKey)!.count) <
        ACTIVE_TEAMS_PER_SCOPE && Number(db.prepare('SELECT count(*) AS count FROM vela_mission_teams').get()!.count) < RETAINED_TEAMS,
      'mission_team_capacity');
      const newId = randomUUID();
      db.prepare(`INSERT INTO vela_mission_teams (id,scope_key,title,title_key,version,archived,members) VALUES (?,?,?,?,1,0,?)`)
        .run(newId, scopeKey, title, titleKey, json);
      return { id: newId, title, members, version: 1 };
    });
  }

  archive(id: string, expectedVersion: number, scope: MissionScope): MissionTeam {
    ensure(version(expectedVersion), 'invalid_mission_team');
    return this.host.atomic(() => {
      const scopeKey = this.scopeKey(scope, 'mission_team_not_found');
      const team = this.lookup(id, scopeKey);
      ensure(team.version === expectedVersion, 'mission_team_version_conflict');
      const result = this.host.db.prepare(`UPDATE vela_mission_teams SET archived=1,version=version+1
        WHERE id=? AND scope_key=? AND version=? AND archived=0`).run(id, scopeKey, expectedVersion);
      ensure(result.changes === 1, 'mission_team_version_conflict');
      return { ...team, version: team.version + 1 };
    });
  }
}
