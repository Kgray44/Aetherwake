import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { MissionScope } from '../src/mission-contracts.mts';
import { MissionTeams, type MissionTeamSave } from '../src/mission-teams.mts';

const scope = { projectId: 'project', workspaceId: 'first' };
const sibling = { ...scope, workspaceId: 'second' };
const otherProject = { projectId: 'other-project', workspaceId: 'third' };
const standalone = { projectId: null, workspaceId: 'standalone' };
const otherStandalone = { projectId: null, workspaceId: 'other-standalone' };
const original: MissionTeamSave = { title: 'Survey', members: [
  { profileId: 'researcher', responsibility: 'Collect the source material' },
  { profileId: 'reviewer', responsibility: 'Verify findings' },
] };

function fixture(path = ':memory:') {
  const kernel = WorkspaceKernel.open(path);
  const scopes = [scope, sibling, otherProject, standalone, otherStandalone];
  const revoked = new Set<string>();
  const teams = new MissionTeams({ db: kernel.withTransaction(db => db), atomic: work => kernel.withTransaction(work),
    authorized: (candidate: MissionScope) => scopes.some(allowed =>
      allowed.projectId === candidate.projectId && allowed.workspaceId === candidate.workspaceId),
    profileAvailable: (_, id) => ['researcher', 'reviewer', 'editor'].includes(id) && !revoked.has(id),
  });
  return { teams, revoked, kernel, close: () => kernel.close() };
}

test('project teams are shared only by authorized workspaces in that project', () => {
  const { teams, close } = fixture();
  try {
    const team = teams.save(original, scope);
    assert.deepEqual(teams.list(sibling), [team]);
    assert.deepEqual(teams.read(team.id, sibling), team);
    assert.deepEqual(teams.list(otherProject), []);
    assert.throws(() => teams.read(team.id, otherProject), /mission_team_not_found/);
    assert.throws(() => teams.save({ ...original, id: team.id, expectedVersion: 1 }, otherProject), /mission_team_not_found/);
    assert.throws(() => teams.archive(team.id, 1, otherProject), /mission_team_not_found/);
    assert.throws(() => teams.list({ ...scope, workspaceId: 'unauthorized' }), /mission_team_scope_denied/);
    assert.throws(() => teams.read(team.id, { ...scope, workspaceId: 'unauthorized' }), /mission_team_not_found/);

    const local = teams.save(original, standalone);
    assert.deepEqual(teams.list(standalone), [local]);
    assert.deepEqual(teams.list(otherStandalone), []);
    assert.throws(() => teams.read(local.id, scope), /mission_team_not_found/);
    assert.throws(() => teams.read(local.id, otherStandalone), /mission_team_not_found/);
    assert.throws(() => teams.save({ ...original, title: ' survey ' }, sibling), /mission_team_title_conflict/);
  } finally { close(); }
});

test('team validation, version fences and archive preserve a repairable assignment', () => {
  const { teams, revoked, close } = fixture();
  try {
    const team = teams.save(original, scope);
    assert.equal(team.version, 1);
    for (const input of [
      { ...original, members: [original.members[0]] },
      { ...original, members: [original.members[0], original.members[0]] },
      { ...original, members: [original.members[0], { profileId: 'reviewer', responsibility: ' ' }] },
      { ...original, members: [original.members[0], { profileId: 'reviewer', responsibility: 'é'.repeat(257) }] },
      { ...original, members: Array(5).fill(original.members[0]) },
      { ...original, title: 'é'.repeat(61) },
      { ...original, id: team.id },
      { ...original, expectedVersion: 1 },
      { ...original, providerGrant: true },
    ]) assert.throws(() => teams.save(input, scope), /invalid_mission_team/);

    revoked.add('reviewer');
    assert.deepEqual(teams.read(team.id, scope), team);
    assert.throws(() => teams.save({ ...original, id: team.id, expectedVersion: 1 }, scope), /mission_team_profile_unavailable/);
    const input = { ...original, id: team.id, expectedVersion: 1, members: [original.members[0],
      { profileId: 'editor', responsibility: 'Confirm references' }] };
    const revised = teams.save(input, sibling);
    assert.equal(revised.version, 2);
    assert.throws(() => teams.save(input, scope), /mission_team_version_conflict/);
    assert.throws(() => teams.archive(team.id, 1, scope), /mission_team_version_conflict/);
    assert.deepEqual(teams.archive(team.id, 2, sibling), { ...revised, version: 3 });
    assert.deepEqual(teams.list(scope), []);
    assert.throws(() => teams.read(team.id, scope), /mission_team_not_found/);
    assert.throws(() => teams.save({ ...input, expectedVersion: 3 }, scope), /mission_team_not_found/);
    assert.throws(() => teams.archive(team.id, 3, scope), /mission_team_not_found/);
    assert.notEqual(teams.save({ title: input.title, members: input.members }, scope).id, team.id);
  } finally { close(); }
});

test('team rows reopen with existing workspace data and active capacity is released by archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-teams-'));
  const path = join(dir, 'workspace.sqlite');
  let state: ReturnType<typeof fixture> | undefined;
  try {
    const existing = WorkspaceKernel.open(path);
    let workspaceId: string;
    try { workspaceId = existing.createWorkspace('Existing workspace', null).id; } finally { existing.close(); }
    state = fixture(path);
    const saved = Array.from({ length: 32 }, (_, i) => state!.teams.save({ ...original, title: `Team ${i}` }, scope));
    assert.throws(() => state!.teams.save(original, sibling), /mission_team_capacity/);
    state.teams.archive(saved[0].id, saved[0].version, scope);
    state.teams.save(original, sibling);
    state.close();
    state = undefined;
    state = fixture(path);
    assert.equal(state.teams.list(sibling).length, 32);
    assert.deepEqual(state.teams.read(saved[1].id, sibling), saved[1]);
    assert.throws(() => state!.teams.read(saved[0].id, scope), /mission_team_not_found/);
    assert.equal(state.kernel.withTransaction(db =>
      db.prepare('SELECT title FROM workspaces WHERE id=?').get(workspaceId)?.title), 'Existing workspace');
  } finally {
    state?.close();
    // The only files created by the fixture are in the freshly allocated temporary directory.
    for (const suffix of ['', '-journal', '-shm', '-wal']) rmSync(path + suffix, { force: true });
    rmdirSync(dir);
  }
});
