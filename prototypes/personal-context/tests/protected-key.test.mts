import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { PersonalContextService } from '../src/service.mts';
import type { PersonalContextHost } from '../src/contracts.ts';
import * as protectedKey from '../src/protected-key.mts';

const host: PersonalContextHost = {
  identity: () => ({ userId: 'synthetic-owner', policyVersion: '1' }),
  resolveScope: scope => ({ scope, version: '1' }),
  authorize: () => ({ decision: 'allow', policyVersion: '1', authorizationRef: 'synthetic-review' }),
};

// Models the native protector boundary with a key external to SQLite.
function fixtureProtector() {
  const key = randomBytes(32);
  let available = true;
  return {
    lock() { available = false; },
    available: async () => available,
    async seal(value: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    async open(value: Uint8Array) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}

test('canonical memory opens with the same protected key after reopening custody', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const protector = fixtureProtector();
  try {
    const transaction = kernel.withTransaction.bind(kernel);
    const db = transaction(connection => connection);
    const first = await protectedKey.openPersonalContextCrypto({ transaction, protector });
    const writer = new PersonalContextService({ db, transaction, host, crypto: first });
    writer.setPolicy({ expectedVersion: 0, patch: { storageEnabled: true } });
    first.close();
    assert.equal(first.available(), false);
    assert.throws(() => writer.policy(), /private_crypto_unavailable/);
    const reopened = await protectedKey.openPersonalContextCrypto({ transaction, protector });
    try {
      const reader = new PersonalContextService({ db, transaction, host, crypto: reopened });
      assert.equal(reader.policy().storageEnabled, true);
      const sealed = reopened.encrypt(Buffer.from('synthetic fact'), 'fact-one');
      assert.throws(() => reopened.decrypt(sealed, 'fact-two'));
    } finally {
      reopened.close();
    }
  } finally {
    kernel.close();
  }
});

test('concurrent custody opens converge on the same key', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const protector = fixtureProtector();
  try {
    const transaction = kernel.withTransaction.bind(kernel);
    const [first, second] = await Promise.all([
      protectedKey.openPersonalContextCrypto({ transaction, protector }),
      protectedKey.openPersonalContextCrypto({ transaction, protector }),
    ]);
    try {
      const data = Buffer.from('synthetic fact');
      assert.deepEqual(second.decrypt(first.encrypt(data, 'fact'), 'fact'), data);
    } finally {
      first.close();
      second.close();
    }
  } finally {
    kernel.close();
  }
});

test('locked, wrong, and missing custody never replace retained memory', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const protector = fixtureProtector();
  try {
    const transaction = kernel.withTransaction.bind(kernel);
    const db = transaction(connection => connection);
    const crypto = await protectedKey.openPersonalContextCrypto({ transaction, protector });
    const writer = new PersonalContextService({ db, transaction, host, crypto });
    writer.setPolicy({ expectedVersion: 0, patch: { storageEnabled: true } });
    crypto.close();
    await assert.rejects(protectedKey.openPersonalContextCrypto({ transaction, protector: fixtureProtector() }), /private_key_unavailable/);
    protector.lock();
    await assert.rejects(protectedKey.openPersonalContextCrypto({ transaction, protector }), /private_key_unavailable/);
    db.exec('DELETE FROM personal_context_key');
    const fresh = fixtureProtector();
    await assert.rejects(protectedKey.openPersonalContextCrypto({ transaction, protector: fresh }), /private_key_missing/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM personal_context_revisions').get()?.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM personal_context_key').get()?.n, 0);
  } finally {
    kernel.close();
  }
});
