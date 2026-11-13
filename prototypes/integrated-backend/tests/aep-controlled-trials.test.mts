import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePairedTrials } from '../src/aep-controlled-trials.mts';

test('paired confidence interval requires repeated improvement on each partition', () => {
  const supported = summarizePairedTrials([21, 26, 29, 31, 34, 35]);
  assert.equal(supported.median, 30);
  assert.deepEqual(supported.interval, { lower: 21, upper: 35, coverage: 0.96875 });
  assert.equal(summarizePairedTrials([21, 26, 29, 31, 34]).interval, null);
  assert.equal(summarizePairedTrials([-6, 26, 29, 31, 34, 35]).interval?.lower, -6);
});

test('bounds do not mutate original order and unavailable observations stay unavailable', () => {
  const observations = [27, 24, 13, null, 5, 9, 11];
  assert.deepEqual(summarizePairedTrials(observations), { enrolled: 7, measured: 6, median: null, interval: null });
  assert.deepEqual(observations, [27, 24, 13, null, 5, 9, 11]);
});
