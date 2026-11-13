import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { NativePersonalMemory } from '../src/personal-memory.mts';
import type { PersonalContextHost } from '../../personal-context/src/contracts.ts';

const host: PersonalContextHost = {
  identity: () => ({ userId: 'synthetic-user', policyVersion: '1' }),
  resolveScope: scope => ({ scope, version: '1' }),
  authorize: () => ({ decision: 'deny' }),
};

test('native memory opens lazily, retries unavailable custody, and preserves canonical authorization', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  try {
    let availabilityChecks = 0;
    let unlocked = false;
    const key = randomBytes(32);
    const memory = new NativePersonalMemory({
      kernel, host, secrets: {
        async available() { availabilityChecks++; return unlocked; },
        async seal(value) {
          const nonce = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', key, nonce);
          const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
          return Buffer.concat([nonce, cipher.getAuthTag(), body]);
        },
        async open(value) {
          const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
          cipher.setAuthTag(value.subarray(12, 28));
          return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
        },
      },
    });
    assert.equal(availabilityChecks, 0);
    await assert.rejects(memory.open(), /private_key_unavailable/);
    assert.equal(availabilityChecks, 1);
    unlocked = true;
    const pending = memory.open();
    assert.equal(memory.open(), pending);
    const service = await pending;
    assert.throws(() => service.policy(), /personal_context_not_authorized/);
    memory.close();
    await assert.rejects(memory.open(), /personal_memory_closed/);
    assert.throws(() => service.policy(), /personal_memory_closed/);
    assert.equal(availabilityChecks, 2);
  } finally {
    kernel.close();
  }
});

test('closing the native owner while OS custody is pending rejects the open', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  let kernelClosed = false;
  try {
    let completeAvailability!: (available: boolean) => void;
    const memory = new NativePersonalMemory({
      kernel, host, secrets: {
        available: () => new Promise(resolve => { completeAvailability = resolve; }),
        async seal() { throw Error('unexpected seal'); },
        async open() { throw Error('unexpected open'); },
      },
    });
    const pending = memory.open();
    memory.close();
    kernel.close();
    kernelClosed = true;
    completeAvailability(true);
    await assert.rejects(pending, /personal_memory_closed/);
  } finally {
    if (!kernelClosed) kernel.close();
  }
});
