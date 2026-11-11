import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHoldout, type HoldoutSource } from './cie-retrieval-holdout.mts';

test('held-out comparison scores misses and irrelevant authorized citations separately', async () => {
  const report = await evaluateHoldout((_query, owner) => owner.recent().sources.slice(-1));
  assert.equal(report.phases, 9);
  assert.equal(report.expected, 10);
  assert.equal(report.matched, 0);
  assert.equal(report.invalidReturns, 0);
  assert.equal(report.rows.find(row => row.category === 'conflict')?.missed.length, 2);
  assert.equal(report.unexpected, 9);
});

test('phase owner excludes denied sources and detects stale citations even for a shared source', async () => {
  const deniedIds = new Set(['riverside-closed-minutes', 'birch-return-draft']);
  let previousHarbor: readonly HoldoutSource[] = [];
  let previousScanner: readonly HoldoutSource[] = [];
  const report = await evaluateHoldout((query, owner) => {
    const { sources } = owner.recent();
    assert.ok(sources.every(source => owner.isCurrent(source) && !deniedIds.has(source.sourceId)));
    assert.ok(owner.search(query).sources.every(source => sources.includes(source)));
    if (query.includes('Harbor')) {
      if (owner.provider === 'fixture-a') {
        previousHarbor = sources;
      } else {
        assert.ok(sources.some(source => source.sourceId === 'harbor-release-register'));
        assert.ok(sources.every(source => source.sourceId !== 'harbor-rehearsal-incident'));
        assert.ok(previousHarbor.every(source => !owner.isCurrent(source)));
        return [...sources, ...previousHarbor];
      }
    }
    if (query.includes('loaner scanner')) {
      if (previousScanner.length) {
        assert.ok(sources.every(source => source.sourceId !== 'scanner-handoff-grant'));
        assert.ok(previousScanner.every(source => !owner.isCurrent(source)));
        return [...sources, ...previousScanner];
      }
      previousScanner = sources;
    }
    return sources;
  });
  assert.equal(report.invalidReturns, 5);
});
