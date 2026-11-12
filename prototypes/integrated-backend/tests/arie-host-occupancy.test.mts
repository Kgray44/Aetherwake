import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { occupancy } from '../src/arie-host-occupancy.mts';
const row = (start: number, end: number, threadId = 1) => ({ startNs: String(start), endNs: String(end), threadId });
test('host evidence measures worker operation overlap rather than submitted promises', () => {
  assert.deepEqual(occupancy([row(0, 10), row(10, 20, 2)]), { peak: 1, overlappingOperationMs: 0 });
  assert.deepEqual(occupancy([row(0, 10), row(5, 20, 2)]), { peak: 2, overlappingOperationMs: 0.000005 });
  assert.deepEqual(occupancy([]), { peak: 0, overlappingOperationMs: 0 });
  assert.deepEqual(occupancy([row(1, 1)]), { peak: 0, overlappingOperationMs: 0 });
  assert.throws(() => occupancy([row(2, 1)]), /invalid_worker_interval/u);
  assert.throws(() => occupancy([row(0, 10), row(5, 20)]), /overlapping_same_worker_intervals/u);
  assert.throws(() => occupancy([row(-1, 0)]), /invalid_worker_interval/u);
  assert.throws(() => occupancy([row(0, 1, 0)]), /invalid_worker_identity/u);
});

test('host verifier refuses missing opt-in and unknown arguments before native work', () => {
  const script = fileURLToPath(new URL('../src/arie-host-occupancy.mts', import.meta.url));
  for (const [optIn, args, expected] of [
    ['', [], /explicit host verification opt-in required/u],
    ['1', ['--unbounded'], /unsupported host verification arguments/u],
  ] as const) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, AERYNTH_VERIFY_HOST_OCCUPANCY: optIn },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(result.stdout, '');
  }
});
