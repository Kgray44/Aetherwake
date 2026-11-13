import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { createInterface } from 'node:readline';

// Invoke only against a trusted local review build. The profile must be a fresh
// sibling of that build. This test starts the shipped Node worker, never Electron.
const [packagePath, profilePath, expectedHead] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert(isAbsolute(packagePath) && isAbsolute(profilePath));
assert.match(expectedHead, /^[a-f0-9]{40}$/u);
const root = await realpath(packagePath);
const parent = await realpath(dirname(profilePath));
assert.equal(parent, dirname(root));
assert.match(basename(profilePath), /^memory-witness-[a-z0-9-]+$/u);
const profile = join(parent, basename(profilePath));
const app = join(root, 'resources/app');
const db = join(profile, 'profile.sqlite');
const workerFile = 'resources/app/prototypes/integrated-backend/src/desktop-host.mts';
const brokerFile = 'resources/app/prototypes/visual-experience/cinematic-v3/native/protected-storage.cjs';
const manifest = await readFile(join(root, 'manifest.json'));
const manifestHash = createHash('sha256').update(manifest).digest('hex');
assert.equal((await readFile(join(root, 'manifest.sha256'), 'utf8')).trim().split(/\s+/u)[0], manifestHash);
const inventory = JSON.parse(manifest);
assert.equal(inventory.complete, true);
assert.equal(inventory.candidate.head, expectedHead);
const files = new Set();
for (const entry of inventory.files) {
  const file = join(root, entry.path);
  const rel = relative(root, file);
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel));
  assert.equal(await realpath(file), file);
  assert(!files.has(rel));
  files.add(rel);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  assert.equal(bytes, entry.bytes);
  assert.equal(hash.digest('hex'), entry.sha256);
}
for (const file of ['vendor/node.exe', workerFile, brokerFile]) assert(files.has(relative(root, join(root, file))));

const shell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const drive = profile[0].toUpperCase();
assert(['C', 'D'].includes(drive));
const guard = join(process.env.LOCALAPPDATA, 'AeroStorageWatch/ReserveGuard.ps1');
const admission = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', guard,
  '-EstimatedCBytes', drive === 'C' ? '33554432' : '0', '-EstimatedDBytes', drive === 'D' ? '33554432' : '0'],
{ encoding: 'utf8', windowsHide: true, timeout: 10000 });
assert.equal(admission.status, 0, 'Storage reserve check failed');
assert.equal(JSON.parse(admission.stdout).allowed, true);
await mkdir(profile);

function protect(operation, input) {
  const method = operation === 'seal' ? 'Protect' : 'Unprotect';
  const command = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;" +
    "$inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());" +
    "try{$outputBytes=[Security.Cryptography.ProtectedData]::" + method +
    "($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "try{[Console]::Out.Write([Convert]::ToBase64String($outputBytes))}" +
    "finally{[Array]::Clear($outputBytes,0,$outputBytes.Length)}}finally{[Array]::Clear($inputBytes,0,$inputBytes.Length)}";
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    input: input.toString('base64'), encoding: 'utf8', timeout: 8000, maxBuffer: 16384, windowsHide: true,
  });
  assert.equal(result.status, 0, 'Windows account protection failed');
  return Buffer.from(result.stdout, 'base64');
}

const require = createRequire(import.meta.url);
const { createProtectedStorageBroker } = require(join(root, brokerFile));
async function withWorker(locked, work) {
  const child = spawn(join(root, 'vendor/node.exe'), [join(root, workerFile), db, profile, profile, '--native-secrets'], {
    cwd: app, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
  });
  child.stderr.resume();
  const ended = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  let sequence = 0;
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const broker = createProtectedStorageBroker({
    isReady: () => true, send,
    safeStorage: {
      isAsyncEncryptionAvailable: async () => !locked,
      async encryptStringAsync(text) {
        const input = Buffer.from(text);
        try { return protect('seal', input); } finally { input.fill(0); }
      },
      async decryptStringAsync(bytes) {
        const output = protect('open', bytes);
        try { return { result: output.toString(), shouldReEncrypt: false }; } finally { output.fill(0); }
      },
    },
  });
  const lines = createInterface({ input: child.stdout });
  const rejectPending = error => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(error); }
    pending.clear();
  };
  child.once('error', rejectPending);
  child.stdin.on('error', rejectPending);
  child.once('exit', () => rejectPending(Error('Packaged worker exited during a request')));
  lines.on('line', line => {
    let reply;
    try { reply = JSON.parse(line); } catch { rejectPending(Error('Invalid worker reply')); return; }
    if (reply.nativeHost) { void broker.handle(reply); return; }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    clearTimeout(waiter.timeout);
    if (reply.error) waiter.reject(Error(reply.error.code ?? reply.error.message ?? reply.error));
    else waiter.resolve(reply.result);
  });
  function call(command, input) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(Error('Worker timed out: ' + command)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      send({ id, command, input });
    });
  }
  let exitTimeout;
  try {
    const result = await work(call);
    assert.equal(await call('close', {}), null);
    assert.equal(await Promise.race([ended, new Promise((_, reject) => {
      exitTimeout = setTimeout(() => reject(Error('Packaged worker did not shut down')), 5000);
    })]), 0);
    return result;
  } finally {
    clearTimeout(exitTimeout);
    broker.close();
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
  }
}

const sourceText = 'Use the synthetic quartz relay.';
const factText = 'The selected part is synthetic quartz.';
const saved = await withWorker(false, async call => {
  assert.equal((await call('personalMemoryPolicyNative', {})).storageEnabled, false);
  const chat = await call('conversation', { name: 'create', input: {
    title: 'Synthetic packaged memory', providerId: 'local', commandId: 'create',
  } });
  const source = await call('addMessage', {
    resourceId: chat.resourceId, role: 'user', content: sourceText, expectedRevision: chat.revision, commandId: 'message',
  });
  const review = await call('personalMemoryCapturePreviewNative', {
    conversationId: chat.resourceId, messageId: source.id, scope: 'conversation',
    category: 'decisions', text: factText, keywords: ['quartz'],
  });
  assert.equal(review.sourceText, sourceText);
  const fact = await call('personalMemoryCaptureCommitNative', review);
  return { factId: fact.id, conversationId: chat.resourceId, messageId: source.id, expectedRevision: source.revision };
});
const read = { type: 'read', id: saved.factId };
await withWorker(true, call => assert.rejects(call('personalMemoryManagementNative', read), /private_key_unavailable/u));
await withWorker(false, async call => {
  const fact = await call('personalMemoryManagementNative', read);
  assert.equal(fact.text, factText);
  assert.equal(fact.provenance.conversationId, saved.conversationId);
  assert.equal(fact.provenance.messageId, saved.messageId);
  const policy = await call('personalMemoryPolicyNative', {});
  assert.equal(policy.ordinaryEnabled, false);
  assert.equal(policy.velaEnabled, false);
  const { factId: _id, ...source } = saved;
  assert.equal((await call('personalMemoryRevokeSourceNative', source)).erasedFacts, 1);
});
await withWorker(false, async call => {
  await assert.rejects(call('personalMemoryManagementNative', read), /personal_record_unavailable/u);
  const opened = await call('openResource', { resourceId: saved.conversationId, selection: { messageId: saved.messageId } });
  assert.equal(opened.status, 'unavailable');
});
const receipt = { result: 'pass', candidate: inventory.candidate, manifestSha256: manifestHash, verifiedFiles: files.size,
  workerStarts: 4, sourceAttributed: true, lockedDenied: true, recovered: true, revokedAfterRestart: true,
  custody: 'Windows DPAPI CurrentUser through test adapter', approval: 'simulated', providerDispatch: false };
await writeFile(join(profile, 'worker-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));

