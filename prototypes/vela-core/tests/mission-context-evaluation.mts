import assert from 'node:assert/strict';
import { compileMissionContext, MissionContextError, validateMissionContext } from '../src/mission-context.mts';
import type { MissionContextRequest, MissionContextSource, MissionSourceSnapshot } from '../src/mission-context.mts';

const scope = { projectId: 'synthetic-project', workspaceId: 'synthetic-workspace' };
function snapshot(id: string, content: string, version = 1): MissionSourceSnapshot {
  return {
    ref: { kind: 'resource', id }, version, content, certainty: 'reviewed',
    locator: 'aerynth://resource/' + id, scope: { kind: 'workspace', id: scope.workspaceId },
  };
}

// Freeze labels before comparing retrieval implementations. A semantic miss is
// a result of the evaluation, while disclosure of a forbidden source fails it.
const cases: {
  id: string;
  query: string;
  rows: MissionSourceSnapshot[];
  expected: string[];
  forbidden: string[];
}[] = [
  {
    id: 'lexical-control', query: 'Find the calibration checksum',
    rows: [snapshot('calibration', 'Calibration checksum is C7.'), snapshot('inventory', 'There are five sensors.')],
    expected: ['calibration'], forbidden: [],
  },
  {
    id: 'paraphrase', query: 'Which person takes over after dusk?',
    rows: [snapshot('night-owner', 'Night shift handoff owner is Marisol.')],
    expected: ['night-owner'], forbidden: [],
  },
  {
    id: 'conflicting-evidence', query: 'Collect the stated batch temperature',
    rows: [snapshot('log-a', 'Batch temperature was 42 C.'), snapshot('log-b', 'Batch temperature was 54 C.')],
    expected: ['log-a', 'log-b'], forbidden: [],
  },
  {
    id: 'correction', query: 'Find the current release window',
    rows: [snapshot('release-draft', 'Release window is Thursday.'), snapshot('release-approved', 'Release window is Friday.', 2)],
    expected: ['release-approved'], forbidden: ['release-draft'],
  },
  {
    id: 'permissions', query: 'Find the lab access schedule',
    rows: [snapshot('public-schedule', 'Lab access schedule is Tuesday.'), snapshot('private-schedule', 'Lab access schedule is Saturday.')],
    expected: ['public-schedule'], forbidden: ['private-schedule'],
  },
];

const inputFor = (id: string, objective: string): MissionContextRequest => ({
  missionId: id, revision: 1, taskId: 'evidence', scope, missionObjective: objective, taskObjective: objective,
  criteria: ['Locate supporting sources'], dependencyTaskIds: [], dependencies: [], maxTokens: 4096,
});
function sourceFor(rows: MissionSourceSnapshot[], denied: Set<string>, policy: string): MissionContextSource {
  const snapshots = new Map(rows.map(row => [row.ref.id, row]));
  return {
    scopeVersion: () => policy,
    retrieve: () => rows.map(row => row.ref),
    read: ref => denied.has(ref.id) ? null : snapshots.get(ref.id) ?? null,
  };
}

const timings: number[] = [];
for (const scenario of cases) {
  const input = inputFor(scenario.id, scenario.query);
  const source = sourceFor(scenario.rows, new Set(scenario.forbidden), 'fixture-policy');
  const selected = compileMissionContext(input, source).manifest.sources.map(item => item.ref.id);
  const missed = scenario.expected.filter(id => !selected.includes(id));
  assert(!selected.some(id => scenario.forbidden.includes(id)), scenario.id + ' disclosed a denied source');
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    compileMissionContext(input, source);
    timings.push(performance.now() - start);
  }
  console.log(JSON.stringify({ id: scenario.id, selected, missed }));
}

const binding = inputFor('continuity', 'Find the current manifest checksum');
const row = snapshot('manifest', 'Manifest checksum is C9.', 3);
const denied = new Set<string>();
const first = sourceFor([row], denied, 'fixture-destination-one');
const second = sourceFor([row], denied, 'fixture-destination-two');
const original = compileMissionContext(binding, first);
const errorCode = (code: string) => (error: unknown) => error instanceof MissionContextError && error.code === code;
assert.throws(() => validateMissionContext(original, binding, second), errorCode('mission_context_scope_changed'));
const rebuilt = compileMissionContext(binding, second);
assert.equal(rebuilt.manifest.sources.length, 1);
assert.deepEqual(rebuilt.manifest.sources, original.manifest.sources);
validateMissionContext(rebuilt, binding, second);
denied.add(row.ref.id);
assert.throws(() => validateMissionContext(rebuilt, binding, second), errorCode('mission_context_source_changed'));
assert.equal(compileMissionContext(binding, second).manifest.sources.length, 0);
console.log(JSON.stringify({ id: 'revocation-and-destination-policy', passed: true }));

timings.sort((a, b) => a - b);
const percentile = (p: number) => timings[Math.ceil(timings.length * p) - 1];
console.log(JSON.stringify({ samples: timings.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) }));
