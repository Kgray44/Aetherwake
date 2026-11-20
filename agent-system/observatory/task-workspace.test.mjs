import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyGraph, organizeTasks, parseTaskHref, taskActivity, taskHref } from './src/task-workspace.mjs';

const accepted = { id: 'accepted', title: 'Ready input', state: 'accepted', classification: { primary: 'integration' } };
const blocked = { id: 'blocked', title: 'Build runtime', state: 'blocked', classification: { primary: 'integration' } };
const current = { id: 'task_a', title: 'Build editor', objective: 'Landing workspace', state: 'proposed',
  prerequisites: { task_ids: ['accepted', 'blocked', 'unknown', 'accepted'] }, classification: { primary: 'visual' } };
const downstream = { id: 'next', title: 'Verify workspace', state: 'ready', prerequisites: { task_ids: ['task_a'] } };

test('task links preserve the registry and direct detail routes', () => {
  assert.deepEqual(parseTaskHref('#tasks'), { id: null });
  assert.deepEqual(parseTaskHref(taskHref('roadmap:task.1')), { id: 'roadmap:task.1' });
  assert.equal(parseTaskHref('#tasks/../../private'), null);
  assert.equal(parseTaskHref('#tasks/a%2Fb'), null);
  assert.equal(parseTaskHref('#pull-requests/12'), null);
});

test('search and filters compose before grouping and priority order preserves unknowns', () => {
  const tasks = [accepted, blocked, current, downstream];
  assert.deepEqual(organizeTasks(tasks, { query: 'BUILD', source: 'private', sort: 'priority', group: 'state' },
    { task_a: { priority: 'urgent' } }).map(([name, items]) => [name, items.map(t => t.id)]), [['proposed', ['task_a']]]);
  const [group] = organizeTasks(tasks, { sort: 'priority' }, { blocked: { priority: 'low' }, task_a: { priority: 'urgent' } });
  assert.deepEqual(group[1].slice(0, 2).map(t => t.id), ['task_a', 'blocked']);
  assert.deepEqual(organizeTasks(tasks, { state: 'failed' }), []);
  assert.deepEqual(organizeTasks(tasks, { query: 'landing', group: 'category' }), [['visual', [current]]]);
});

test('direct dependency edges preserve direction and unknown evidence', () => {
  const graph = dependencyGraph(current, [current, accepted, blocked, downstream]);
  assert.deepEqual(graph.upstream.map(({ id, status }) => [id, status]), [
    ['accepted', 'satisfied'], ['blocked', 'unsatisfied'], ['unknown', 'unverified'],
  ]);
  assert.deepEqual(graph.downstream.map(({ id }) => id), ['next']);
});

import { commandForTask, executionActions, reviewRevision, taskEngineRequest, taskTokenRows } from './src/task-engine-client.mjs';

test('canonical operation choices use stored state and the current attempt count', () => {
  assert.deepEqual(executionActions({ lifecycle: { state: 'blocked', stored_state: 'admitted', executor: 'codex' } }), ['pause', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'paused', stored_state: 'paused' }, attempts: [{}] }), ['resume', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'failed', stored_state: 'failed' }, attempts: [{}, {}, {}] }), []);
  assert.deepEqual(executionActions({ lifecycle: { state: 'verifying', stored_state: 'verifying' } }), ['accept', 'reject', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { stored_state: 'proposed' } }, { publishedIntake: true }), ['admit']);
  assert.deepEqual(commandForTask({ task: { id: 'task_a' }, version: 4 }, { type: 'pause' }, 'operation'),
    { op: 'command', task_id: 'task_a', expected_version: 4, operation_id: 'operation', action: { type: 'pause' } });
});

test('engine discovery distinguishes absent endpoints from errors and preserves server feedback', async () => {
  assert.equal(await taskEngineRequest({ op: 'list' }, {}, { fetcher: async () => new Response('', { status: 404 }) }), null);
  await assert.rejects(taskEngineRequest({ op: 'command' }, {}, {
    fetcher: async () => Response.json({ error: 'Owner action required' }, { status: 403 }),
  }), error => error.status === 403 && error.message === 'Owner action required');
  await assert.rejects(taskEngineRequest({ op: 'register' }, {}, { fetcher: async () => new Response('', { status: 404 }) }),
    error => error.status === 404);
});

test('Task token rows retain exact Task identity and observed null values', () => {
  const row = { taskId: 'task_a', attemptId: 'try_1', revision: 'a'.repeat(40), coverage: 'partial',
    observed: { inputTokens: 350, totalTokens: null } };
  assert.deepEqual(taskTokenRows({ schemaVersion: 1, byAttempt: [row, { ...row, taskId: 'other' }] }, 'task_a'), [row]);
  assert.deepEqual(taskTokenRows(undefined, 'task_a'), []);
});

test('registry activity distinguishes intake, reported attempts and authoritative engine state', () => {
  const task = { id: 'task_a', state: 'proposed' };
  assert.deepEqual(taskActivity(task, [], [], null), { label: 'No execution reported', at: null });
  const attempt = { id: 'attempt_a', task_id: task.id, state: 'running', started_at: '2026-11-19T20:00:00Z' };
  assert.deepEqual(taskActivity(task, [attempt], [{ task_id: 'another', occurred_at: '2026-11-20T00:00:00Z' }], null),
    { label: 'Attempt last reported running', at: attempt.started_at });
  assert.deepEqual(taskActivity(task, [{ ...attempt, state: 'succeeded', finished_at: '2026-11-19T20:05:00Z' }], [], null),
    { label: 'Latest attempt succeeded', at: '2026-11-19T20:05:00Z' });
  assert.deepEqual(taskActivity(task, [attempt], [], { state: 'scheduled', start_at: 1795200000000 }),
    { label: 'Engine scheduled', at: '2026-11-20T18:40:00.000Z' });
  assert.equal(task.state, 'proposed');
});

test('owner evidence pins the candidate revision rather than the attempt base', () => {
  const base = 'a'.repeat(40);
  const candidate = 'b'.repeat(40);
  assert.equal(reviewRevision({ revision: base, candidate_revision: candidate }), candidate);
  assert.equal(reviewRevision({ revision: base }), base);
  assert.equal(reviewRevision(undefined), null);
});
