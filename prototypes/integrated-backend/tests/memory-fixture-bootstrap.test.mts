import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { BackendCore, type MemoryFixtureBootstrap } from '../src/core.mts';

test('fixture startup rejects a foreign database and accepts only local memory commands', async t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'aerynth-memory-bootstrap-')));
  t.after(() => {
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.match(basename(parent), /^aerynth-memory-(?:bootstrap|host)-/u);
    rmSync(parent, { recursive: true });
  });
  const profileRoot = join(parent, 'memory-witness-test');
  mkdirSync(profileRoot);
  writeFileSync(join(profileRoot, 'synthetic-packaged.started'), '{}');
  writeFileSync(join(profileRoot, 'synthetic-packaged.consumed'), '');
  const descriptor: MemoryFixtureBootstrap = {
    contract: 'aerynth.memory-fixture-bootstrap@1', profileRoot, expiresAt: Date.now() + 30_000,
  };
  const key = randomBytes(32);
  const inputs: string[] = [];
  const protector = {
    available: async () => true,
    async seal(value: string) {
      inputs.push(value.split(':')[0]);
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    async open(bytes: Uint8Array) {
      const value = Buffer.from(bytes);
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString();
    },
  };
  const options = { path: join(profileRoot, 'aerynth.sqlite'), provider: 'fixture' as const,
    contentPolicy: 'synthetic-only' as const };
  assert.throws(() => new BackendCore({ ...options, path: join(parent, 'foreign.sqlite') },
    undefined, undefined, undefined, undefined, { descriptor, protector }), /memory_fixture_bootstrap_invalid/);
  assert.deepEqual(readdirSync(parent), ['memory-witness-test']);
  assert.deepEqual(readdirSync(profileRoot).sort(), ['synthetic-packaged.consumed', 'synthetic-packaged.started']);
  const core = new BackendCore(options, undefined, undefined, undefined, undefined, { descriptor, protector });
  try {
    for (const field of ['velaApiConnection', 'velaApiRuntime', 'velaVoiceRuntime', 'velaWakeRuntime', 'ordinaryConnections'])
      assert.equal(Reflect.get(core, field), undefined, field);
    assert.equal((await core.command('capabilities', {})).providerId, 'fixture-codex');
    assert.equal((await core.command('personalMemoryPolicyNative', {})).version, 0);
    for (const command of ['providerAuth', 'velaApiConfigure', 'velaVoiceNative', 'velaWakeNative', 'githubTimeline'] as const)
      await assert.rejects(core.command(command, {} as never), /memory_fixture_command_denied/);
    await assert.rejects(core.command('personalMemoryPolicyNative', { enable: true, expectedVersion: 0 }),
      /memory_fixture_command_denied/);
    const local = await core.command('createConversation', { title: 'Synthetic', commandId: 'fixture-chat' });
    assert.equal(local.providerId, 'local');
    const content = 'My synthetic preference is a numbered list.';
    const message = await core.command('addMessage', { resourceId: local.resourceId, role: 'user',
      content, expectedRevision: local.revision, commandId: 'fixture-source' });
    const review = await core.command('personalMemoryCapturePreviewNative', {
      conversationId: local.resourceId, messageId: message.id, scope: 'conversation',
      category: 'preferences', text: content, keywords: ['list'],
    });
    const receipt = await core.command('personalMemoryCaptureCommitNative', review);
    assert.ok(receipt.id);
    await assert.rejects(core.command('personalMemoryCaptureCommitNative', review), /personal_memory_review_mismatch/);
    assert.deepEqual(inputs, ['aerynth.personal-context.key/1']);
    assert.throws(() => new BackendCore(options, undefined, undefined, undefined, undefined, { descriptor, protector }),
      /memory_fixture_bootstrap_invalid/);
  } finally { await core.command('close', {}); }
});

test('desktop fixture transport fails closed and serves a valid worker without native brokers', t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'aerynth-memory-host-')));
  t.after(() => {
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.match(basename(parent), /^aerynth-memory-(?:bootstrap|host)-/u);
    rmSync(parent, { recursive: true });
  });
  const profileRoot = join(parent, 'memory-witness-host');
  mkdirSync(profileRoot);
  writeFileSync(join(profileRoot, 'synthetic-packaged.started'), '{}');
  const host = fileURLToPath(new URL('../src/desktop-host.mts', import.meta.url));
  const descriptor = { contract: 'aerynth.memory-fixture-bootstrap@1', profileRoot, expiresAt: Date.now() + 30_000 };
  const launch = (args: string[], commands = '') => spawnSync(process.execPath, [host, ...args], {
    windowsHide: true, encoding: 'utf8', input: commands, timeout: 10_000,
  });
  for (const args of [
    [JSON.stringify(descriptor)],
    [JSON.stringify({ ...descriptor, profileRoot: join(parent, 'real-profile') })],
    [JSON.stringify({ ...descriptor, provider: 'codex' })],
    [JSON.stringify({ ...descriptor, expiresAt: 1 })],
    [JSON.stringify(descriptor), '--native-secrets'],
  ]) {
    const failed = launch(['--memory-fixture-bootstrap-v1', ...args]);
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /memory_fixture_bootstrap_invalid/);
    assert.deepEqual(readdirSync(profileRoot), ['synthetic-packaged.started']);
  }
  writeFileSync(join(profileRoot, 'synthetic-packaged.consumed'), '');
  const requests = [
    { id: 1, command: 'capabilities', input: {} },
    { id: 2, command: 'personalMemoryPolicyNative', input: {} },
    { id: 3, command: 'velaApiConnection', input: { type: 'status' } },
    { id: 4, command: 'close', input: {} },
  ];
  const success = launch(['--memory-fixture-bootstrap-v1', JSON.stringify(descriptor)],
    requests.map(request => JSON.stringify(request)).join('\n') + '\n');
  assert.equal(success.status, 0, success.stderr);
  const replies = success.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
  assert.equal(replies.find(reply => reply.id === 1)?.result.providerId, 'fixture-codex');
  assert.equal(replies.find(reply => reply.id === 2)?.result.version, 0);
  assert.equal(replies.find(reply => reply.id === 3)?.error, 'memory_fixture_command_denied');
  assert.equal(replies.find(reply => reply.id === 4)?.result, null);
  assert.equal(replies.some(reply => reply.nativeHost), false);
});
