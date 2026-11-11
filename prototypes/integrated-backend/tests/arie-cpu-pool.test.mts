import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { createMissionCpuPool } from '../src/mission-cpu-pool.mts';
import { missionCpuWorkerProtocol } from '../src/mission-cpu-worker.mts';

test('bounded CPU threads run independent shipped inspections and reuse an idle worker', async () => {
  const pool = createMissionCpuPool(2);
  try {
    const signal = new AbortController().signal;
    const first = pool.inspect(signal), second = pool.inspect(signal);
    await assert.rejects(pool.inspect(signal), /mission_cpu_backpressure/u);
    const [a, b] = await Promise.all([first, second]);
    assert.notEqual(a.threadId, b.threadId);
    assert.deepEqual(a.evidence, b.evidence);
    assert.match(a.evidence.value.sha256, /^[a-f0-9]{64}$/u);
    assert.ok([a.threadId, b.threadId].includes((await pool.inspect(signal)).threadId));
  } finally { await pool.close(); }
});

test('a crashed worker frees its slot and only an explicitly submitted job runs on its replacement', async () => {
  let spawns = 0;
  const pool = createMissionCpuPool(1, () => ++spawns === 1 ?
    new Worker('process.exit(17)', { eval: true }) :
    new Worker(new URL('../src/mission-cpu-worker.mts', import.meta.url), { workerData: missionCpuWorkerProtocol }));
  try {
    const signal = new AbortController().signal;
    await assert.rejects(pool.inspect(signal), /mission_cpu_worker_exited/u);
    assert.equal(spawns, 1);
    assert.equal((await pool.inspect(signal)).evidence.value.module, 'core.mts');
    assert.equal(spawns, 2);
  } finally { await pool.close(); }
});

test('cancellation holds the slot until its worker exits', async () => {
  let spawns = 0;
  const pool = createMissionCpuPool(1, () => {
    spawns++;
    return new Worker('setInterval(() => {}, 1000)', { eval: true });
  });
  try {
    const abort = new AbortController();
    const pending = pool.inspect(abort.signal);
    abort.abort(Error('test-cancelled'));
    await assert.rejects(pool.inspect(new AbortController().signal), /mission_cpu_backpressure/u);
    await assert.rejects(pending, /test-cancelled/u);
    assert.equal(spawns, 1);
  } finally { await pool.close(); }
});
