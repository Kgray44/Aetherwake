import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CommandMap } from '../src/contracts.mts';
import { createNativeHostServer } from '../src/native-host.mts';
import { createSyntheticMemoryProtector } from '../src/synthetic-memory-protector.mts';
const require = createRequire(import.meta.url);
const { superviseMemoryFixture } = require('../../visual-experience/cinematic-v3/native/memory-fixture-supervisor.cjs');
const { enterMemoryFixture } = require('../../visual-experience/cinematic-v3/native/memory-fixture-entry.cjs');

test('admitted desktop fixture captures and revokes a canonical source through the worker custody wire', { timeout: 25_000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aerynth-joint-memory-')));
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert.match(basename(root), /^aerynth-joint-memory-/u);
    rmSync(root, { recursive: true });
  });
  const profileRoot = join(root, 'memory-witness-joint');
  const databasePath = join(profileRoot, 'aerynth.sqlite');
  const unrelatedProfile = join(root, 'real-profile-sentinel');
  const artifactPath = join(root, 'acceptance-artifact.stub');
  mkdirSync(profileRoot);
  writeFileSync(artifactPath, 'Synthetic artifact identity only.');
  const permit = { token: 'synthetic-permit', owner: 'joint-memory', availabilityId: 'synthetic-slot',
    expiresAt: Date.now() + 40_000 };
  let occupied = false;
  const admission = {
    checkPermit(token: string) { assert.equal(token, permit.token); return permit; },
    status() { return { lease: occupied ? { pid: process.pid } : null }; },
    claim(token: string, pid: number) {
      assert.equal(token, permit.token);
      assert.equal(pid, process.pid);
      assert.equal(occupied, false);
      occupied = true;
      return { check: () => assert.equal(occupied, true), release: () => { occupied = false; } };
    },
  };
  const options = {
    profileRoot, artifactPath, token: permit.token, allowWrite: () => true,
    locateDesktop: () => root, openAdmission: () => admission,
  };
  const handoff = superviseMemoryFixture({
    ...options, allocation: { ...permit, profileRoot, contract: 'aerynth.memory-fixture-allocation@1' },
    startFixture: (value: { descriptorDigest: string }) => value,
  });
  const entry = { ...options, descriptorDigest: handoff.descriptorDigest };
  const hostPath = fileURLToPath(new URL('../src/desktop-host.mts', import.meta.url));
  const hostArgs = (descriptor: unknown) => [hostPath, '--memory-fixture-bootstrap-v1', JSON.stringify(descriptor)];
  const policyToken = randomBytes(32).toString('base64url');
  const env = {
    AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN: policyToken,
    AERYNTH_MEMORY_FIXTURE_SEED: 'inspector-v1',
    SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root,
    APPDATA: unrelatedProfile, LOCALAPPDATA: unrelatedProfile, USERPROFILE: unrelatedProfile,
    HOME: unrelatedProfile, CODEX_HOME: unrelatedProfile,
  };
  const launchOptions = { env, windowsHide: true };
  const premature = spawnSync(process.execPath, hostArgs({
    contract: 'aerynth.memory-fixture-bootstrap@1', profileRoot, expiresAt: permit.expiresAt,
  }), { ...launchOptions, timeout: 5000, encoding: 'utf8' });
  assert.equal(premature.status, 1);
  assert.match(premature.stderr, /memory_fixture_bootstrap_invalid/u);
  assert.throws(() => enterMemoryFixture({ ...entry, descriptorDigest: '0'.repeat(64) }), /descriptor_invalid/u);
  assert.equal(occupied, false);
  assert.deepEqual(readdirSync(profileRoot), ['synthetic-packaged.started']);

  const entered = enterMemoryFixture(entry);
  try {
    entered.check();
    assert.deepEqual(readdirSync(profileRoot).sort(), ['synthetic-packaged.consumed', 'synthetic-packaged.started']);
    assert.equal(existsSync(databasePath), false);
    const unsupportedSeed = spawnSync(process.execPath, hostArgs(entered.backendDescriptor), {
      ...launchOptions, env: { ...env, AERYNTH_MEMORY_FIXTURE_SEED: 'unknown' },
      timeout: 5000, encoding: 'utf8',
    });
    assert.equal(unsupportedSeed.status, 1);
    assert.match(unsupportedSeed.stderr, /memory_fixture_seed_invalid/u);
    assert.deepEqual(readdirSync(profileRoot).sort(), ['synthetic-packaged.consumed', 'synthetic-packaged.started']);
    const key = randomBytes(32);
    let protector: ReturnType<typeof createSyntheticMemoryProtector>;
    try {
      protector = createSyntheticMemoryProtector({ profileRoot, databasePath, fixtureKey: key, mode: 'create' });
    } finally { key.fill(0); }

    // Also inherited by the Backend worker. Deny and count any attempt before it can reach the host.
    const tripwire = `
      import cp from 'node:child_process';
      import net from 'node:net';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const deny = () => { process.stderr.write('fixture external effect attempted\\n'); throw Error('fixture_external_effect'); };
      globalThis.fetch = deny;
      net.Socket.prototype.connect = deny;
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = deny;
      for (const name of ['accessSync', 'existsSync', 'lstatSync', 'statSync', 'openSync',
        'readFileSync', 'readdirSync', 'mkdirSync', 'writeFileSync']) {
        const original = fs[name];
        fs[name] = function(path, ...args) {
          if (String(path).includes('real-profile-sentinel')) deny();
          return original.call(this, path, ...args);
        };
      }
      syncBuiltinESMExports();
    `;
    const child = spawn(process.execPath, [
      '--import', 'data:text/javascript;base64,' + Buffer.from(tripwire).toString('base64'),
      ...hostArgs(entered.backendDescriptor),
    ], { ...launchOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    const done = once(child, 'exit');
    const stopChild = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    t.signal.addEventListener('abort', stopChild, { once: true });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const custodyOperations: string[] = [];
    const server = createNativeHostServer({ secrets: protector }, response =>
      child.stdin.write(JSON.stringify(response) + '\n'));
    const lines = createInterface({ input: child.stdout });
    const replies = lines[Symbol.asyncIterator]();
    let id = 0;
    const seeds: { contract: string; conversationId: string; messageId: string; factId: string }[] = [];
    async function call<K extends keyof CommandMap>(command: K, input: CommandMap[K]['input'], fixturePolicyToken?: string): Promise<CommandMap[K]['output']> {
      entered.check();
      const wanted = ++id;
      child.stdin.write(JSON.stringify({ id: wanted, command, input, fixturePolicyToken }) + '\n');
      for (;;) {
        const line = await replies.next();
        assert.equal(line.done, false, stderr);
        const response = JSON.parse(line.value);
        if (server.handle(response)) {
          custodyOperations.push(response.nativeHost.operation);
          continue;
        }
        if (response.fixtureSeed) { seeds.push(response.fixtureSeed); continue; }
        if (response.event) continue;
        assert.equal(response.id, wanted);
        if (response.error) throw Error(response.error);
        return response.result;
      }
    }

    try {
      assert.equal((await call('capabilities', {})).providerId, 'fixture-codex');
      for (const command of ['providerAuth', 'velaApiConfigure', 'velaVoiceNative', 'velaWakeNative', 'githubTimeline'] as const)
        await assert.rejects(call(command, {} as never), /memory_fixture_command_denied|native_api_configuration_required|unsupported_command/u);
      await assert.rejects(call('fixtureSeed' as never, {} as never), /unsupported_command/u);
      assert.equal(seeds.length, 1);
      const [seed] = seeds;
      assert.equal(seed.contract, 'aerynth.memory-fixture-seed@1');
      const snapshot = await call('snapshot', {});
      const chat = snapshot.conversations.find(item => item.resourceId === seed.conversationId)!;
      const source = snapshot.graph.messages.find(item => item.id === seed.messageId)!;
      assert.equal(snapshot.conversations.length, 1);
      assert.equal(snapshot.graph.messages.length, 1);
      assert.equal(source.role, 'user');
      const receipt = { id: seed.factId };
      const listing = await call('personalMemoryManagementNative', { type: 'list', after: null });
      const page = listing as { records: { id: string }[] };
      assert.deepEqual(page.records.map(item => item.id), [receipt.id]);
      const fact = await call('personalMemoryManagementNative', { type: 'read', id: receipt.id });
      const saved = fact as import('../../personal-context/src/contracts.ts').ReviewedFact;
      assert.equal(saved.id, receipt.id);
      assert.equal(saved.text, source.content);
      assert.equal(saved.provenance.kind, 'conversation-message');
      if (saved.provenance.kind === 'conversation-message') {
        assert.equal(saved.provenance.conversationId, seed.conversationId);
        assert.equal(saved.provenance.messageId, seed.messageId);
      }
      const policy = await call('personalMemoryPolicyNative', {});
      assert.equal(policy.storageEnabled, true);
      assert.equal(policy.ordinaryEnabled, false);
      assert.equal(policy.velaEnabled, false);
      const enable = { assistant: 'ordinary', enable: true, expectedVersion: policy.version } as const;
      await assert.rejects(call('personalMemoryPolicyNative', enable), /memory_fixture_command_denied/u);
      await assert.rejects(call('personalMemoryPolicyNative', enable, randomBytes(32).toString('base64url')),
        /memory_fixture_command_denied/u);
      await assert.rejects(call('personalMemoryPolicyNative', { ...enable, pauseStorage: true }, policyToken),
        /memory_fixture_command_denied/u);
      const ordinary = await call('personalMemoryPolicyNative', enable, policyToken);
      assert.equal(ordinary.ordinaryEnabled, true);
      assert.equal(ordinary.velaEnabled, false);
      await assert.rejects(call('personalMemoryPolicyNative', enable, policyToken), /stale_personal_context_version/u);
      const both = await call('personalMemoryPolicyNative', {
        assistant: 'vela', enable: true, expectedVersion: ordinary.version,
      }, policyToken);
      assert.equal(both.ordinaryEnabled, true);
      assert.equal(both.velaEnabled, true);
      await assert.rejects(call('velaApiConfigure', {} as never), /native_api_configuration_required/u);
      const target = { resourceId: chat.resourceId, selection: { messageId: source.id } };
      const opened = await call('openResource', target);
      assert.equal(opened.status, 'ready');
      assert.deepEqual(opened.status === 'ready' && opened.selection, target.selection);
      const other = await call('createConversation', { title: 'Unrelated synthetic chat', commandId: 'joint-other' });
      assert.equal((await call('openResource', { ...target, resourceId: other.resourceId })).status, 'unavailable');
      const revocation = await call('personalMemoryManagementNative', {
        type: 'previewSourceRevocation', id: receipt.id, version: 1,
      }) as { binding: CommandMap['personalMemoryRevokeSourceNative']['input'] };
      assert.equal(revocation.binding.messageId, source.id);
      assert.deepEqual(await call('personalMemoryRevokeSourceNative', revocation.binding), {
        revision: chat.revision + 1, erasedFacts: 1,
      });
      await assert.rejects(call('personalMemoryManagementNative', { type: 'read', id: receipt.id }), /personal_record_unavailable/u);
      assert.equal((await call('openResource', target)).status, 'unavailable');
      assert.equal((await call('providerActivity', {})).providerRequests, 0);
      await call('close', {});
      assert.deepEqual(await done, [0, null]);
      assert.equal(stderr, '');
      assert.ok(custodyOperations.includes('seal') && custodyOperations.includes('open'));
    } finally {
      lines.close();
      server.close();
      protector.close();
      t.signal.removeEventListener('abort', stopChild);
      stopChild();
      await done;
    }
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT wrapped_key FROM personal_context_key').get();
      assert.match(Buffer.from(row!.wrapped_key as Uint8Array).toString(), /^aerynth\.synthetic-memory-custody\/1:/u);
    } finally { db.close(); }
    assert.equal(existsSync(unrelatedProfile), false);
    assert.throws(() => enterMemoryFixture(entry), /profile_not_pending/u);
    const replay = spawnSync(process.execPath, hostArgs(entered.backendDescriptor), {
      ...launchOptions, timeout: 5000, encoding: 'utf8',
    });
    assert.equal(replay.status, 1);
    assert.match(replay.stderr, /memory_fixture_bootstrap_invalid/u);
  } finally { entered.release(); }
  assert.equal(occupied, false);
});
