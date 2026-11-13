import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BackendCore } from '../src/core.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { NativePersonalMemory } from '../src/personal-memory.mts';
import { createSyntheticMemoryProtector } from '../src/synthetic-memory-protector.mts';

function fixture(t: test.TestContext) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-memory-protector-')));
  const fixtureKey = randomBytes(32);
  t.after(() => { fixtureKey.fill(0); rmSync(scratch, { recursive: true, force: true }); });
  function profile(name: string) {
    const profileRoot = join(scratch, name);
    mkdirSync(profileRoot);
    writeFileSync(join(profileRoot, 'synthetic-packaged.started'), JSON.stringify({
      contract: 'aerynth.memory-fixture-descriptor@1', profileRoot,
      artifactPath: join(scratch, 'synthetic.exe'), artifactDigest: 'a'.repeat(64),
      owner: 'memory-witness', availabilityId: 'fixture', permitDigest: 'b'.repeat(64),
      expiresAt: Date.now() + 40_000,
    }), { flag: 'wx' });
    writeFileSync(join(profileRoot, 'synthetic-packaged.consumed'), '', { flag: 'wx' });
    return { profileRoot, databasePath: join(profileRoot, 'aerynth.sqlite'), fixtureKey };
  }
  return { profile };
}

test('synthetic custody uses canonical Core capture, reopen and atomic source revocation', async t => {
  const options = fixture(t).profile('memory-witness-canonical');
  async function withCore(mode: 'create' | 'reopen', run: (core: BackendCore) => Promise<void>) {
    const secrets = createSyntheticMemoryProtector({ ...options, mode });
    let core: BackendCore | undefined;
    try {
      core = new BackendCore({ path: options.databasePath, privateRoot: options.profileRoot,
        provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
      await run(core);
    } finally {
      try { await core?.command('close', {}); } finally { secrets.close(); }
    }
  }
  let savedId = '';
  await withCore('create', async core => {
    const chat = await core.command('createConversation', { title: 'Synthetic chat', commandId: 'chat' });
    const text = 'The synthetic project uses a relay.';
    const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
      content: text, expectedRevision: chat.revision, commandId: 'message' });
    const review = await core.command('personalMemoryCapturePreviewNative', {
      conversationId: chat.resourceId, messageId: message.id, expectedProjectId: null,
      expectedSourceText: text, text, scope: 'conversation', category: 'decisions', keywords: ['relay'],
    });
    savedId = (await core.command('personalMemoryCaptureCommitNative', review)).id;
  });
  await withCore('reopen', async core => {
    const fact = await core.command('personalMemoryManagementNative', { type: 'read', id: savedId }) as { version: number; text: string };
    assert.match(fact.text, /synthetic project/);
    const review = await core.command('personalMemoryManagementNative', {
      type: 'previewSourceRevocation', id: savedId, version: fact.version,
    }) as { binding: import('../src/contracts.mts').CommandMap['personalMemoryRevokeSourceNative']['input'] };
    assert.equal((await core.command('personalMemoryRevokeSourceNative', review.binding)).erasedFacts, 1);
  });
  await withCore('reopen', async core => {
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'read', id: savedId }), /personal_record_unavailable/);
  });
});

test('synthetic custody rejects wrong root, production envelopes and invalid reopen state', async t => {
  const { profile } = fixture(t);
  const options = profile('memory-witness-original');
  const foreign = profile('memory-witness-foreign');
  const production = profile('normal-profile');
  assert.throws(() => createSyntheticMemoryProtector({ ...production, mode: 'create' }), /synthetic_memory_profile_mismatch/);
  assert.throws(() => createSyntheticMemoryProtector({ ...options, databasePath: foreign.databasePath, mode: 'create' }), /synthetic_memory_profile_mismatch/);
  assert.throws(() => createSyntheticMemoryProtector({ ...options, mode: 'reopen' }));
  const secrets = createSyntheticMemoryProtector({ ...options, mode: 'create' });
  const kernel = WorkspaceKernel.open(options.databasePath);
  const owner = new NativePersonalMemory({ kernel, secrets, host: {
    identity: () => ({ userId: 'synthetic-fixture', policyVersion: '1' }),
    resolveScope: scope => ({ scope, version: '1' }),
    authorize: () => ({ decision: 'deny' }),
  } });
  let envelope: Uint8Array;
  try {
    await assert.rejects(secrets.seal('synthetic-provider-credential'), /synthetic_memory_key_envelope_invalid/);
    await owner.open();
    envelope = kernel.withTransaction(db => db.prepare('SELECT wrapped_key FROM personal_context_key').get()!.wrapped_key as Uint8Array);
    await assert.rejects(secrets.open(randomBytes(envelope.length)), /synthetic_memory_key_envelope_invalid/);
    await assert.rejects(secrets.seal('aerynth.personal-context.key/1:' + randomBytes(32).toString('base64url')), /synthetic_memory_custody_state/);
  } finally {
    owner.close();
    secrets.close();
    kernel.close();
  }
  assert.equal(await secrets.available(), false);
  assert.throws(() => createSyntheticMemoryProtector({ ...options, mode: 'create' }), /synthetic_memory_custody_state/);
  const descriptorPath = join(options.profileRoot, 'synthetic-packaged.started');
  const consumedPath = join(options.profileRoot, 'synthetic-packaged.consumed');
  const descriptor = readFileSync(descriptorPath, 'utf8');
  const checkSubstitution = async () => {
    const substituted = createSyntheticMemoryProtector({ ...options, mode: 'reopen' });
    try { await assert.rejects(substituted.open(envelope!), /synthetic_memory_key_envelope_invalid/); }
    finally { substituted.close(); }
  };
  writeFileSync(descriptorPath, descriptor + ' ');
  await checkSubstitution();
  writeFileSync(descriptorPath, descriptor);
  renameSync(consumedPath, consumedPath + '.original');
  assert.throws(() => createSyntheticMemoryProtector({ ...options, mode: 'reopen' }));
  writeFileSync(consumedPath, '', { flag: 'wx' });
  await checkSubstitution();
  rmSync(consumedPath);
  renameSync(consumedPath + '.original', consumedPath);
  writeFileSync(descriptorPath, ' '.repeat(8193));
  assert.throws(() => createSyntheticMemoryProtector({ ...options, mode: 'reopen' }), /synthetic_memory_profile_mismatch/);
  writeFileSync(descriptorPath, descriptor);
  copyFileSync(options.databasePath, foreign.databasePath);
  const copied = createSyntheticMemoryProtector({ ...foreign, mode: 'reopen' });
  const wrongKey = createSyntheticMemoryProtector({ ...options, fixtureKey: randomBytes(32), mode: 'reopen' });
  const reopened = createSyntheticMemoryProtector({ ...options, mode: 'reopen' });
  try {
    await assert.rejects(copied.open(envelope!), /synthetic_memory_key_envelope_invalid/);
    await assert.rejects(wrongKey.open(envelope!), /synthetic_memory_key_envelope_invalid/);
    const tampered = Buffer.from(envelope!);
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(reopened.open(tampered), /synthetic_memory_key_envelope_invalid/);
  } finally { copied.close(); wrongKey.close(); reopened.close(); }
});
