import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeResources} from '../../scripts/agent/resources.mjs';

const byName = samples => Object.fromEntries(samples.map(sample => [sample.name, sample]));
const runNode = code => spawn(process.execPath, ['-e', code], {stdio: 'ignore', shell: false});

test('one Linux sample cannot establish CPU or disk deltas', {skip: process.platform !== 'linux'}, async () => {
  const child = runNode('setTimeout(() => {}, 10000)');
  const closed = once(child, 'close');
  try {
    await once(child, 'spawn');
    const metrics = byName(await observeResources(child.pid, {intervalMs: 10_000}).stop());
    assert.equal(metrics.resource_sample_count.value, 1);
    assert.ok(metrics.child_sampled_peak_rss_bytes.value > 0);
    for (const name of ['child_sampled_cpu_ms', 'child_sampled_disk_read_bytes', 'child_sampled_disk_write_bytes']) {
      assert.equal(metrics[name].availability, 'unavailable');
      assert.equal(Object.hasOwn(metrics[name], 'value'), false);
    }
  } finally {
    child.kill();
    await closed;
  }
});

test('default Windows capture skips quick commands and reports missing samples', {skip: process.platform !== 'win32'}, async () => {
  const child = runNode('');
  const observer = observeResources(child.pid);
  assert.deepEqual(await once(child, 'close'), [0, null]);
  const metrics = byName(await observer.stop());
  assert.equal(metrics.resource_sample_count.value, 0);
  assert.equal(metrics.child_sampled_cpu_ms.availability, 'unavailable');
  assert.equal(metrics.child_sampled_cpu_ms.source, 'windows_process_api');
  assert.deepEqual(byName(await observer.stop()), metrics);
});

test('a sustained Windows direct child yields CPU delta and working-set samples', {skip: process.platform !== 'win32', timeout: 12_000}, async () => {
  const child = runNode('const end=Date.now()+6000; while (Date.now()<end) Math.sqrt(Date.now());');
  const closed = once(child, 'close');
  const observer = observeResources(child.pid, {windowsStartDelayMs:0});
  try {
    assert.deepEqual(await closed, [0, null]);
    const metrics = byName(await observer.stop());
    assert.ok(metrics.resource_sample_count.value >= 2);
    assert.ok(metrics.child_sampled_cpu_ms.value > 0);
    assert.ok(metrics.child_sampled_peak_rss_bytes.value > 0);
    assert.ok(metrics.child_observed_high_water_rss_bytes.value >= metrics.child_sampled_peak_rss_bytes.value);
    assert.equal(metrics.child_sampled_disk_read_bytes.availability, 'unavailable');
    assert.equal(metrics.child_sampled_disk_write_bytes.availability, 'unavailable');
    assert.equal(metrics.child_sampled_cpu_ms.method, 'sampled_direct_child_only');
  } finally {
    await observer.stop();
    if (child.exitCode === null) child.kill();
    await closed;
  }
});
