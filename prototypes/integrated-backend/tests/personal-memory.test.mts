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

test('native source erasure joins the canonical transaction even when OS custody is locked', async () => {
  const kernel = WorkspaceKernel.open(':memory:');
  const source = { kind: 'conversation-message', conversationId: 'source-chat', messageId: 'source-message' } as const;
  const provenance = { ...source, version: '1', contentDigest: 'a'.repeat(64) };
  const scope = { kind: 'conversation', id: source.conversationId } as const;
  const proof = { ...provenance, projectId: null, role: 'user' as const, sensitive: false };
  const transaction = kernel.withTransaction.bind(kernel);
  let wrapped: string;
  const secrets = {
    async available() { return true; },
    async seal(value: string) { wrapped = value; return randomBytes(64); },
    async open() { return wrapped; },
  };
  let eraseAllowed = false;
  const ownerHost: PersonalContextHost = {
    ...host, resolveConversationSource: () => proof,
    authorize(input) {
      if (['source.erase', 'record.delete'].includes(input.operation) && !eraseAllowed) return { decision: 'deny' };
      return { decision: 'allow', policyVersion: '1', authorizationRef: 'synthetic-owner-review' };
    },
  };
  const writer = new NativePersonalMemory({ kernel, host: ownerHost, secrets });
  let credentialCalls = 0;
  const locked = new NativePersonalMemory({ kernel, host: ownerHost, secrets: {
    async available() { credentialCalls++; return false; },
    async seal() { throw Error('unexpected seal'); }, async open() { throw Error('unexpected open'); },
  } });
  try {
    const tables = () => transaction(db => db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'personal_context_%' ORDER BY name").all());
    assert.throws(() => locked.eraseConversationSource(source), /personal_context_not_authorized/);
    eraseAllowed = true;
    assert.deepEqual(locked.eraseConversationSource(source).deleted, []);
    assert.deepEqual(tables(), []);
    assert.equal(credentialCalls, 0);
    eraseAllowed = false;
    const service = await writer.open();
    service.setPolicy({ expectedVersion: 0, patch: { storageEnabled: true } });
    const draft = { scope, purpose: 'knowledge', category: 'preferences', text: 'Synthetic relay', keywords: ['relay'],
      certainty: 'explicit-statement', sensitive: false, expiresAt: null } as const;
    const linked = service.reviewFact({ ...draft, keywords: [...draft.keywords], source: provenance });
    const independent = service.reviewFact({ ...draft, keywords: [...draft.keywords], source: { kind: 'user-statement' } });
    assert.throws(() => locked.eraseConversationSource(source), /personal_context_not_authorized/);
    eraseAllowed = true;
    assert.throws(() => transaction(() => {
      assert.deepEqual(locked.eraseConversationSource(source).deleted.map(record => record.id), [linked.id]);
      throw Error('synthetic source-owner failure');
    }), /synthetic source-owner failure/);
    assert.equal(service.readFact(linked.id).id, linked.id);
    assert.deepEqual(locked.eraseConversationSource(source).deleted.map(record => record.id), [linked.id]);
    assert.throws(() => service.readFact(linked.id), /personal_record_unavailable/);
    assert.equal(service.readFact(independent.id).id, independent.id);
    assert.deepEqual(locked.eraseConversationSource(source).deleted, []);
    assert.equal(credentialCalls, 0);
    transaction(db => db.exec('DROP TABLE personal_context_conversation_sources'));
    assert.throws(() => locked.eraseConversationSource(source), /unsupported_personal_context_schema/);
    assert(!tables().some(table => table.name === 'personal_context_conversation_sources'));
  } finally {
    locked.close();
    writer.close();
    kernel.close();
  }
});
