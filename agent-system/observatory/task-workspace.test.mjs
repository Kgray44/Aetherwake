import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyGraph, organizeTasks, parseTaskHref, taskHref } from './src/task-workspace.mjs';

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
