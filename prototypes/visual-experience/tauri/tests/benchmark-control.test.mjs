import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BenchmarkLedger } from '../src/benchmark-control.ts';

test('script trace preserves dispatch, commit, and next callback as distinct clocks', async () => {
  const priorWindow = globalThis.window;
  const priorRaf = globalThis.requestAnimationFrame;
  globalThis.window = { setTimeout };
  // A real rAF frame timestamp can precede a state change made during that frame.
  globalThis.requestAnimationFrame = callback => setImmediate(() => callback(1));
  try {
    const ledger = new BenchmarkLedger('main');
    await ledger.step('S6-select', () => {}, 120);
    await new Promise(resolve => setImmediate(resolve));
    const record = ledger.snapshot().records[0];
    assert.equal(record.source, 'scripted-renderer');
    assert.equal(record.intendedOffsetMs, 120);
    assert.equal(record.status, 'committed');
    assert.ok(record.dispatchMs <= record.handlerStartMs);
    assert.ok(record.handlerStartMs <= record.stateCommitMs);
    assert.ok(record.stateCommitMs <= record.nextFrameMs);
    assert.notEqual(record.nextFrameMs, 1);
    assert.match(ledger.snapshot().limits.join(' '), /not an OS display present/);
  } finally {
    globalThis.window = priorWindow;
    globalThis.requestAnimationFrame = priorRaf;
  }
});
