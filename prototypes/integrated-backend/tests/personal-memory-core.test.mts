import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
import { BackendCore } from '../src/core.mts';
import type { NativePersonalMemory } from '../src/personal-memory.mts';

function memoryOwner(core: BackendCore) {
  return (core as unknown as { personalMemory?: NativePersonalMemory }).personalMemory;
}

test('Core composes a lazy private memory owner only in a native private profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-core-'));
  let availabilityChecks = 0;
  const secrets = {
    async available() { availabilityChecks++; return false; },
    async seal() { throw Error('unexpected seal'); },
    async open() { throw Error('unexpected open'); },
  };
  let privateCore: BackendCore | undefined;
  let fixtureCore: BackendCore | undefined;
  try {
    privateCore = new BackendCore({ path: join(root, 'private.sqlite'), privateRoot: root,
      provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
    fixtureCore = new BackendCore({ path: join(root, 'fixture.sqlite'), provider: 'fixture',
      contentPolicy: 'synthetic-only' }, undefined, { secrets });
    assert.equal(memoryOwner(fixtureCore), undefined);
    const owner = memoryOwner(privateCore);
    assert.ok(owner);
    const beforeOpen = availabilityChecks;
    await assert.rejects(owner.open(), /private_key_unavailable/);
    assert.equal(availabilityChecks, beforeOpen + 1);
    await privateCore.command('close', {});
    privateCore = undefined;
    await assert.rejects(owner.open(), /personal_memory_closed/);
  } finally {
    await Promise.allSettled([privateCore?.command('close', {}), fixtureCore?.command('close', {})]);
    rmSync(root, { recursive: true, force: true });
  }
});

test('Core native capture persists a canonical user message across a private profile restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-memory-capture-'));
  let wrapped: string;
  const secrets = {
    available: async () => true,
    async seal(value: string) { wrapped = value; return randomBytes(64); },
    async open() { return wrapped; },
  };
  const open = () => new BackendCore({ path: join(root, 'profile.sqlite'), privateRoot: root,
    provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
  let core: BackendCore | undefined;
  try {
    core = open();
    const chat = await core.command('createConversation', { title: 'Synthetic chat', commandId: 'chat' });
    const content = 'I prefer a synthetic relay.';
    const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content, expectedRevision: chat.revision, commandId: 'message' });
    const preview = await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: message.id,
      scope: 'conversation', category: 'preferences', text: content, keywords: ['relay'],
    });
    assert.equal(preview.sourceText, content);
    const saved = await core.command('personalMemoryCaptureCommitNative', preview);
    await assert.rejects(core.command('personalMemoryCaptureCommitNative', preview), /personal_memory_review_mismatch/);
    await core.command('close', {});
    core = open();
    const inspection = (core as unknown as { personalMemoryReview: ReturnType<typeof createPersonalMemoryReview> }).personalMemoryReview;
    const fact = await inspection.read(saved.id);
    assert.equal(fact.text, content);
    assert.equal(fact.provenance.kind, 'conversation-message');
    assert.equal((await inspection.inspect({ after: null, limit: 8 })).policy.ordinaryEnabled, false);
  } finally {
    await core?.command('close', {});
    rmSync(root, { recursive: true, force: true });
  }
});
