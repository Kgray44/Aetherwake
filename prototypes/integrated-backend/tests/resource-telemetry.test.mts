import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMissionAdmission } from '../src/mission-admission.mts';

test('governor exposes source, units, freshness and explicit unavailable native sensors', () => {
  let time = 0;
  const admission = createMissionAdmission({ maxWorkers: 2, now: () => time,
    availableMemory: () => 1024 ** 3, readWindowsPressure: null });
  try {
    const inspect = () => Reflect.get(admission, 'telemetry')();
    assert.equal(typeof Reflect.get(admission, 'telemetry'), 'function');
    assert.equal(inspect().metrics.availableMemoryBytes.availability, 'not_sampled');
    admission.read(true);
    const snapshot = inspect();
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.metrics.availableMemoryBytes.value, 1024 ** 3);
    assert.equal(snapshot.metrics.availableMemoryBytes.unit, 'bytes');
    assert.equal(snapshot.metrics.availableMemoryBytes.source, 'node:os.freemem');
    assert.equal(snapshot.metrics.gpuEnginePercent.availability, 'unsupported');
    assert.equal(snapshot.metrics.gpuEnginePercent.value, null);
    time = 5_001;
    assert.equal(inspect().metrics.availableMemoryBytes.availability, 'stale');
    assert.equal(inspect().metrics.availableMemoryBytes.value, null);
  } finally { admission.dispose(); }
});
