import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductClients } from '../src/product-clients.ts';

test('Timeline planning client preserves canonical command identity, UTC duration/zone DTO and host snapshot application', async () => {
  const calls = [], snapshots = [], snapshot = { contract: 'synthetic-desktop-snapshot' };
  const result = { resourceId: 'timeline', version: 5, operationId: 'same-command', item: { id: 'server-generated-item' } };
  const client = createProductClients({ command: async (...args) => { calls.push(args); return { result, desktop: snapshot }; }, apply: value => snapshots.push(value) });
  const input = { op: 'create', commandId: 'same-command', resourceId: 'timeline', expectedVersion: 4,
    values: { title: 'Synthetic plan', startAt: '2026-11-01T05:30:00.000Z', durationMs: 7200000, timeZone: 'America/New_York', laneId: 'review' } };
  assert.equal(await client.timelines.planning(input), result);
  assert.deepEqual(calls, [['timelines', { name: 'planning', input }]]);
  assert.equal(snapshots[0], snapshot);
  assert.equal(calls[0][1].input, input, 'transport never rewrites a version or creates another command ID');
});

test('planning list stays a passive host read and failed writes are neither applied nor retried', async () => {
  const calls = [], snapshots = [];
  const client = createProductClients({ command: async (family, request) => { calls.push({family,request}); if (request.input.op !== 'list') throw Error('timeline_version_conflict'); return {result:{resourceId:'timeline',resourceVersion:4,canEdit:false,items:[]}}; }, apply: value => snapshots.push(value) });
  assert.equal((await client.timelines.planning({op:'list',resourceId:'timeline',expectedVersion:4})).canEdit,false);
  await assert.rejects(client.timelines.planning({op:'delete',commandId:'only-once',resourceId:'timeline',expectedVersion:4,itemId:'plan'}),/timeline_version_conflict/);
  assert.equal(calls.length,2); assert.equal(snapshots.length,0);
});
