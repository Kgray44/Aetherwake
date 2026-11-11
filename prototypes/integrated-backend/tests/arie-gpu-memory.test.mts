import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateDedicatedHeadroom as pair } from '../src/windows-gpu-memory.mts';

test('dedicated headroom pairs capacity and usage on the same unlinked adapter', () => {
  const gib = 1024 ** 3;
  const capacities = [{ luid: '00000000_0001AAAA', bytes: 8 * gib },
    { luid: '00000000_0001BBBB', bytes: 4 * gib }];
  const counters = [{ Name: 'luid_0x00000000_0x0001aaaa_phys_0', DedicatedUsage: 7 * gib },
    { Name: 'luid_0x00000000_0x0001BBBB_phys_0', DedicatedUsage: 1 * gib }];
  assert.deepEqual(pair(capacities, counters), { gpuDedicatedCapacityBytes: 4 * gib,
    gpuDedicatedInUseBytes: gib, vramAvailableBytes: 3 * gib });
  assert.deepEqual(pair(capacities, [...counters, { Name: 'luid_0x00000000_0x0001bbbb_phys_1', DedicatedUsage: 0 }]),
    { gpuDedicatedCapacityBytes: 8 * gib, gpuDedicatedInUseBytes: 7 * gib, vramAvailableBytes: gib });
  assert.equal(pair(capacities, [{ ...counters[0], DedicatedUsage: 9 * gib }]), undefined);
  assert.equal(pair(capacities, [{ Name: 'luid_0x00000000_0x0001cccc_phys_0', DedicatedUsage: 0 }]), undefined);
  assert.equal(pair([capacities[0], capacities[0]], [counters[0]]), undefined);
});
