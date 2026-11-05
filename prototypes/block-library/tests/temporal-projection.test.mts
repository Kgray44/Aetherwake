import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineFixture } from './timeline-view-fixture.mts';
import { temporalProjection, temporalTicks, temporalZoom, recordedReviewTime } from '../temporal-projection.ts';

test('LI-05: exact time geometry, chronological keyboard order and source lanes survive dense clustering', t => {
  const f = timelineFixture(t);
  f.add({ receivedAt: '2026-11-02T18:00:00.000Z', providerId: 'b' });
  f.add({ receivedAt: '2026-11-02T06:00:00.000Z', providerId: 'a' });
  f.add({ receivedAt: '2026-11-02T06:00:01.000Z', providerId: 'a' });
  const items = f.service.query({ resourceId: f.created.resourceId, expectedVersion: 1 }).items;
  const from = Date.parse(f.view.viewport.from), to = Date.parse(f.view.viewport.to);
  const geometry = temporalProjection(items, 'receivedAt', from, to, 400, true);
  assert.deepEqual(geometry.lanes, ['a', 'b']);
  assert.deepEqual(geometry.timed.map(value => value.item.event.providerId), ['a', 'a', 'b']);
  assert.equal(geometry.timed[0].position, 100);
  assert.equal(geometry.timed[2].position, 300);
  assert.equal(geometry.clusters.length, 2);
  assert.equal(geometry.clusters[0].members.length, 2);
  const chosen = geometry.timed[1].key;
  const selected = temporalProjection(items, 'receivedAt', from, to, 400, true, chosen);
  assert.equal(selected.clusters[0].representative.key, chosen);
  assert.equal(selected.clusters[0].position, selected.timed[1].position);
  const untimed = temporalProjection(items, 'reportedAt', from, to, 400, true);
  assert.equal(untimed.timed.length, 0, 'Unavailable source timestamps are not invented');
});

test('LI-05: zoom preserves selected fraction and selected instant across min/max scales', () => {
  const bounds = temporalZoom(0, 10000, .5, 2000);
  assert.deepEqual(bounds, { from: 1000, to: 6000 });
  assert.equal((2000 - bounds.from) / (bounds.to - bounds.from), .2);
  assert.equal(temporalZoom(0, 10000, .0001).to - temporalZoom(0, 10000, .0001).from, 1000);
});

test('LI-05: elapsed-time ticks disclose both offsets through DST overlap', () => {
  const ticks = temporalTicks(Date.parse('2026-11-01T05:00:00Z'), Date.parse('2026-11-01T07:00:00Z'), 600, 'America/New_York');
  assert.ok(ticks.some(value => /GMT-4/.test(value.label)));
  assert.ok(ticks.some(value => /GMT-5/.test(value.label)));
  assert.ok(ticks.every((value, index) => !index || value.position > ticks[index - 1].position));
  assert.equal(temporalTicks(0, 0, 600, 'UTC').length, 0);
  assert.ok(temporalTicks(0, 86400000, 600, 'invalid zone').every(value => /GMT/.test(value.label)));
});

test('LI-06 partial: recorded-time review advances by source milliseconds and selected rate, then clamps', () => {
  assert.equal(recordedReviewTime(1000, 250, 1, 10000), 1250);
  assert.equal(recordedReviewTime(1000, 250, 10, 10000), 3500);
  assert.equal(recordedReviewTime(1000, 2000, 10, 10000), 10000);
  assert.equal(recordedReviewTime(1000, -1, 10, 10000), 1000);
});
