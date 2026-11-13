import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BackendCore } from '../src/core.mts';
import { DatabaseSync } from 'node:sqlite';
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
    writeFileSync(join(profileRoot, 'synthetic-backend.started'), '', { flag: 'wx' });
    return { profileRoot, databasePath: join(profileRoot, 'aerynth.sqlite'), fixtureKey };
  }
  return { profile };
}

test('synthetic custody uses canonical Core capture, reopen and atomic source revocation', async t => {
  const options = fixture(t).profile('memory-witness-canonical');
  const initial = createSyntheticMemoryProtector({ ...options, mode: 'create' });
  async function withCore(secrets: Pick<typeof initial, 'seal' | 'open' | 'available' | 'close'>,
    run: (core: BackendCore) => Promise<void>) {
    let core: BackendCore | undefined;
    try {
      core = new BackendCore({ path: options.databasePath, privateRoot: options.profileRoot,
        provider: 'fixture', contentPolicy: 'local-private' }, undefined, { secrets });
      await run(core);
    } finally {
      await core?.command('close', {});
    }
  }
  let savedId = '';
  t.after(() => initial.close());
  await withCore(initial, async core => {
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
  let admitted = true;
  const restart = await initial.prepareRestart({
    check() { if (!admitted) throw Error('fixture_lease_revoked'); },
    assertWorkerExited() {},
  });
  t.after(() => restart.close());
  assert.equal(await initial.available(), false);
  const reopened = await restart.claim(restart.descriptor);
  t.after(() => reopened.close());
  await assert.rejects(restart.claim(restart.descriptor), /synthetic_memory_restart_consumed/);
  await assert.rejects(reopened.seal('synthetic-secret'), /synthetic_memory_custody_state/);
  await withCore(reopened, async core => {
    const fact = await core.command('personalMemoryManagementNative', { type: 'read', id: savedId }) as { version: number; text: string };
    assert.match(fact.text, /synthetic project/);
    const review = await core.command('personalMemoryManagementNative', {
      type: 'previewSourceRevocation', id: savedId, version: fact.version,
    }) as { binding: import('../src/contracts.mts').CommandMap['personalMemoryRevokeSourceNative']['input'] };
    assert.equal((await core.command('personalMemoryRevokeSourceNative', review.binding)).erasedFacts, 1);
    await assert.rejects(core.command('personalMemoryManagementNative', { type: 'read', id: savedId }), /personal_record_unavailable/);
  });
  admitted = false;
  assert.equal(await reopened.available(), false);
});

test('synthetic custody rejects wrong root, production profiles and foreign database paths', async t => {
  const { profile } = fixture(t);
  const options = profile('memory-witness-original');
  const foreign = profile('memory-witness-foreign');
  const production = profile('normal-profile');
  assert.throws(() => createSyntheticMemoryProtector({ ...production, mode: 'create' }), /synthetic_memory_profile_mismatch/);
  assert.throws(() => createSyntheticMemoryProtector({ ...options, databasePath: foreign.databasePath, mode: 'create' }), /synthetic_memory_profile_mismatch/);

});

async function seedEnvelope(t: test.TestContext, options: ReturnType<ReturnType<typeof fixture>['profile']>) {
  const secrets = createSyntheticMemoryProtector({ ...options, mode: 'create' });
  t.after(() => secrets.close());
  const kernel = WorkspaceKernel.open(options.databasePath);
  const owner = new NativePersonalMemory({ kernel, secrets, host: {
    identity: () => ({ userId: 'synthetic-fixture', policyVersion: '1' }),
    resolveScope: scope => ({ scope, version: '1' }),
    authorize: () => ({ decision: 'deny' }),
  } });
  try {
    await assert.rejects(secrets.seal('synthetic-provider-credential'), /synthetic_memory_key_envelope_invalid/);
    await owner.open();
    await assert.rejects(secrets.open(randomBytes(100)), /synthetic_memory_key_envelope_invalid/);
    await assert.rejects(secrets.seal('aerynth.personal-context.key/1:' + randomBytes(32).toString('base64url')),
      /synthetic_memory_custody_state/);
  } finally { owner.close(); kernel.close(); }
  return secrets;
}

test('restart refuses a foreign root and burns the one-use claim', async t => {
  const { profile } = fixture(t);
  const options = profile('memory-witness-original');
  const foreign = profile('memory-witness-foreign');
  const secrets = await seedEnvelope(t, options);
  const restart = await secrets.prepareRestart({ check() {}, assertWorkerExited() {} });
  t.after(() => restart.close());
  copyFileSync(options.databasePath, foreign.databasePath);
  await assert.rejects(restart.claim({ ...restart.descriptor, profileRoot: foreign.profileRoot }),
    /synthetic_memory_restart_descriptor_mismatch/);
  await assert.rejects(restart.claim(restart.descriptor), /synthetic_memory_restart_consumed/);
});

test('restart refuses a foreign wrapping key even on the same root', async t => {
  const options = fixture(t).profile('memory-witness-original');
  const secrets = await seedEnvelope(t, options);
  const db = new DatabaseSync(options.databasePath);
  try {
    const row = db.prepare('SELECT wrapped_key FROM personal_context_key WHERE singleton=1').get()!;
    const forged = Buffer.from(row.wrapped_key as Uint8Array);
    // Preserve the fixture envelope header while substituting another wrapping payload.
    forged.set(randomBytes(32), forged.length - 32);
    db.prepare('UPDATE personal_context_key SET wrapped_key=? WHERE singleton=1').run(forged);
  } finally { db.close(); }
  await assert.rejects(secrets.prepareRestart({ check() {}, assertWorkerExited() {} }),
    /synthetic_memory_key_envelope_invalid/);
  assert.equal(await secrets.available(), false);
});

for (const failure of ['existing restart marker', 'replaced restart marker', 'replaced backend marker',
  'replaced admission marker', 'expired admission', 'live worker'] as const) {
  test('restart refuses ' + failure, async t => {
    const options = fixture(t).profile('memory-witness-original');
    const marker = join(options.profileRoot, 'synthetic-backend.restart');
    const backendMarker = join(options.profileRoot, 'synthetic-backend.started');
    const secrets = await seedEnvelope(t, options);
    const authority = {
      check() {},
      assertWorkerExited() { if (failure === 'live worker') throw Error('fixture_worker_live'); },
    };
    if (failure === 'existing restart marker') {
      writeFileSync(marker, '', { flag: 'wx' });
      await assert.rejects(secrets.prepareRestart(authority), /synthetic_memory_restart_marker_unavailable/);
    } else if (failure === 'live worker') {
      await assert.rejects(secrets.prepareRestart(authority), /fixture_worker_live/);
    } else {
      const restart = await secrets.prepareRestart(authority);
      t.after(() => restart.close());
      if (failure === 'expired admission') {
        t.mock.method(Date, 'now', () => restart.descriptor.expiresAt);
        await assert.rejects(restart.claim(restart.descriptor), /synthetic_memory_restart_expired/);
      } else {
        const replaced = failure === 'replaced restart marker' ? marker :
          failure === 'replaced backend marker' ? backendMarker : join(options.profileRoot, 'synthetic-packaged.consumed');
        renameSync(replaced, replaced + '.original');
        writeFileSync(replaced, '', { flag: 'wx' });
        await assert.rejects(restart.claim(restart.descriptor), /synthetic_memory_profile_mismatch/);
      }
      await assert.rejects(restart.claim(restart.descriptor), /synthetic_memory_restart_consumed/);
    }
  });
}
