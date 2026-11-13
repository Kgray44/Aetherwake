const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { mkdtempSync, unlinkSync, rmdirSync, realpathSync, readdirSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createMemoryReviewGuard, memoryWitnessDeadline, memoryWitnessRoot, claimMemoryWitnessPhase, validateMemoryWitnessReceipt } = require('./personal-memory-review-guard.cjs');

test('memory approval accepts only the current authenticated review child', () => {
  const parent = {}, review = {}, foreign = {};
  let now = 1, focused = parent, owned = true;
  const guard = createMemoryReviewGuard({ parent, focusedWindow: () => focused,
    isOwned: (child, owner) => owned && child === review && owner === parent, deadline: 20, now: () => now });
  guard.checkParent();
  focused = review;
  guard.checkReview(review);
  focused = foreign;
  assert.throws(() => guard.checkReview(review), /native_memory_foreground_lost/);
  focused = review;
  assert.throws(() => guard.checkReview(review), /native_memory_foreground_lost/);
});

test('closed reviews and expired deadlines fail before more input', () => {
  const parent = {}, review = {};
  let now = 1, owned = false;
  const guard = () => createMemoryReviewGuard({ parent, focusedWindow: () => review,
    isOwned: () => owned, deadline: 20, now: () => now });
  assert.throws(() => guard().checkReview(review), /native_memory_foreground_lost/);
  owned = true;
  const expired = guard();
  now = 20;
  assert.throws(() => expired.checkReview(review), /native_memory_work_deadline/);
});

test('the source witness requires a current, bounded allocation for its phase', () => {
  const allocation = { purpose: 'synthetic-memory-review', mode: 'save', expiresAt: 2000 };
  assert.equal(memoryWitnessDeadline(allocation, 'save', 1000, 25), 1025);
  for (const invalid of [null, { ...allocation, mode: 'restore' }, { ...allocation, expiresAt: 1000 },
    { ...allocation, expiresAt: 46001 }]) {
    assert.throws(() => memoryWitnessDeadline(invalid, 'save', 1000, 25), /native_memory_admission_required/);
  }
});

test('a foreign focus event latches even if the authenticated dialog regains focus', () => {
  const parent = {}, review = {}, foreign = {};
  const guard = createMemoryReviewGuard({ parent, focusedWindow: () => review,
    isOwned: (target, owner) => target === review && owner === parent, deadline: 20, now: () => 1 });
  guard.observeFocus(review);
  guard.checkReview(review);
  guard.observeFocus(foreign);
  guard.observeFocus(review);
  assert.throws(() => guard.checkReview(review), /native_memory_foreground_lost/);
});

test('the unadmitted witness exits before importing Electron or touching the profile', () => {
  const env = { ...process.env };
  delete env.AERYNTH_MEMORY_WITNESS_ADMISSION;
  const witness = join(__dirname, 'personal-memory-native-verify.cjs');
  const result = spawnSync(process.execPath, [witness, 'unused-profile', 'save'],
    { env, encoding: 'utf8', windowsHide: true, timeout: 3000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    result: 'fail', mode: 'save', error: 'native_memory_admission_required',
  });
});

test('a valid memory allocation without a Windows desktop permit exits before touching the profile', {
  skip: process.platform !== 'win32',
}, () => {
  const folder = join(tmpdir(), 'memory-witness-slot-' + randomUUID());
  mkdirSync(folder);
  const root = realpathSync(folder);
  try {
    const env = { ...process.env, AERYNTH_MEMORY_WITNESS_ADMISSION: JSON.stringify({
      purpose: 'synthetic-memory-review', mode: 'save', expiresAt: Date.now() + 30000, profileRoot: root,
    }) };
    delete env.AERYNTH_NATIVE_TEST_SLOT;
    const result = spawnSync(process.execPath, [join(__dirname, 'personal-memory-native-verify.cjs'), root, 'save'],
      { env, encoding: 'utf8', windowsHide: true, timeout: 3000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stderr), { result: 'fail', mode: 'save', error: 'native_test_desktop_slot_closed' });
    assert.deepEqual(readdirSync(root), []);
  } finally { rmdirSync(root); }
});

test('the memory witness rejects a mismatched Windows desktop permit before profile writes', {
  skip: process.platform !== 'win32',
}, () => {
  const folder = join(tmpdir(), 'memory-witness-slot-' + randomUUID());
  mkdirSync(folder);
  const root = realpathSync(folder);
  const account = join(root, 'account');
  const directory = join(account, '.aerynth-native-test-admission-v2');
  mkdirSync(account);
  const { createAdmission } = require('./native-test-admission.cjs');
  const admission = createAdmission(directory);
  try {
    admission.resume(Date.now());
    admission.open('synthetic-owner', 1);
    const env = { ...process.env, AERYNTH_NATIVE_TEST_SLOT: 'synthetic-mismatched-token',
      AERYNTH_MEMORY_WITNESS_ADMISSION: JSON.stringify({
        purpose: 'synthetic-memory-review', mode: 'save', expiresAt: Date.now() + 30000, profileRoot: root,
      }) };
    const script = [
      "const Module = require('node:module');",
      "const account = process.argv[2];",
      "require('node:os').userInfo = () => ({ homedir: account });",
      "const load = Module._load;",
      "Module._load = function (id, ...args) {",
      "  if (id === 'electron') return {};",
      "  return load.call(this, id, ...args);",
      "};",
      "process.argv = [process.execPath, process.argv[1], process.argv[3], 'save'];",
      "require(process.argv[1]);",
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', script,
      join(__dirname, 'personal-memory-native-verify.cjs'), account, root],
      { env, encoding: 'utf8', windowsHide: true, timeout: 3000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr.trim(), 'native_test_desktop_slot_closed');
    assert.equal(admission.status().lease, null);
    assert.deepEqual(readdirSync(root), ['account']);
  } finally {
    admission.close();
    unlinkSync(join(directory, 'availability.json'));
    rmdirSync(directory);
    rmdirSync(account);
    rmdirSync(root);
  }
});

test('witness profile must be the admitted canonical synthetic directory', () => {
  const root = resolve('memory-witness-example');
  const other = resolve('memory-witness-other');
  const admission = { profileRoot: root };
  assert.equal(memoryWitnessRoot(admission, root, () => root), root);
  assert.throws(() => memoryWitnessRoot(admission, other, () => other), /native_memory_profile_mismatch/);
  assert.throws(() => memoryWitnessRoot(admission, root, () => other), /native_memory_profile_mismatch/);
  assert.throws(() => memoryWitnessRoot(admission, 'relative', () => root), /native_memory_profile_required/);
  const regularProfile = resolve('Aerynth');
  assert.throws(() => memoryWitnessRoot({ profileRoot: regularProfile }, regularProfile, () => regularProfile),
    /native_memory_profile_mismatch/);
});

test('save and restore are individually one-shot even if the first attempt fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-witness-phase-'));
  try {
    claimMemoryWitnessPhase(root, 'save');
    assert.throws(() => claimMemoryWitnessPhase(root, 'save'), /native_memory_phase_already_started/);
    claimMemoryWitnessPhase(root, 'restore');
    assert.throws(() => claimMemoryWitnessPhase(root, 'restore'), /native_memory_phase_already_started/);
  } finally {
    unlinkSync(join(root, 'synthetic-save.started'));
    unlinkSync(join(root, 'synthetic-restore.started'));
    rmdirSync(root);
  }
});

test('restore requires a completed save receipt from another process for the same project', () => {
  const receipt = { contract: 'aerynth.synthetic-memory-save@1', pid: 13, id: 'fact', workspaceId: 'workspace',
    projectId: 'project', input: { conversationId: 'chat', messageId: 'message', scope: 'project', expectedProjectId: 'project' } };
  assert.equal(validateMemoryWitnessReceipt(receipt, 14), receipt);
  assert.throws(() => validateMemoryWitnessReceipt(receipt, 13), /native_memory_save_receipt_invalid/);
  assert.throws(() => validateMemoryWitnessReceipt({ ...receipt, projectId: 'foreign' }, 14), /native_memory_save_receipt_invalid/);
  assert.throws(() => validateMemoryWitnessReceipt({}, 14), /native_memory_save_receipt_invalid/);
});
const { launchMemoryWitness } = require('./personal-memory-witness-launch.cjs');

test('the supervisor refuses missing, expired, revoked and wrong permits before resolving Electron', () => {
  const { createAdmission } = require('./native-test-admission.cjs');
  const directory = mkdtempSync(join(tmpdir(), 'memory-supervisor-slot-'));
  let now = Date.now();
  const admission = createAdmission(directory, () => now);
  const unexpected = () => assert.fail('Electron resolution or spawn was reached');
  const attempt = token => launchMemoryWitness({
    profileRoot: 'unused-profile', mode: 'save', electronPath: 'unused-electron',
    env: { AERYNTH_NATIVE_TEST_SLOT: token }, locateDesktop: () => directory,
    openAdmission: () => admission, resolveElectron: unexpected, spawnElectron: unexpected,
  });
  try {
    admission.resume(now);
    const { token } = admission.open('memory-test', 1);
    assert.throws(() => attempt(undefined), /native_test_desktop_slot_closed/);
    assert.throws(() => attempt('wrong'), /native_test_desktop_slot_closed/);
    now += 60_000;
    assert.throws(() => attempt(token), /native_test_desktop_slot_closed/);
    admission.pause();
    assert.throws(() => attempt(token), /native_test_desktop_gaming/);
  } finally {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
test('the supervisor binds a hidden child to the same permit and rechecks immediately before spawning', () => {
  const { createAdmission } = require('./native-test-admission.cjs');
  const directory = mkdtempSync(join(tmpdir(), 'memory-supervisor-slot-'));
  const root = join(directory, 'memory-witness-stub');
  mkdirSync(root);
  const canonicalRoot = realpathSync(root);
  const admission = createAdmission(directory);
  let spawned = 0;
  try {
    admission.resume(Date.now());
    const { token, expiresAt } = admission.open('memory-test', 1);
    const executable = join(directory, 'electron-stub.exe');
    const options = {
      profileRoot: canonicalRoot, mode: 'save', electronPath: executable, locateDesktop: () => directory,
      env: { AERYNTH_NATIVE_TEST_SLOT: token, ELECTRON_RUN_AS_NODE: '1' },
      spawnElectron(file, args, settings) {
        spawned++;
        assert.equal(file, executable);
        assert.deepEqual(args, [join(__dirname, 'personal-memory-native-verify.cjs'), canonicalRoot, 'save']);
        assert.equal(settings.windowsHide, true);
        assert.equal(settings.env.AERYNTH_NATIVE_TEST_SLOT, token);
        assert.equal(settings.env.ELECTRON_RUN_AS_NODE, undefined);
        const phase = JSON.parse(settings.env.AERYNTH_MEMORY_WITNESS_ADMISSION);
        assert.equal(phase.profileRoot, canonicalRoot);
        assert.equal(phase.mode, 'save');
        assert(phase.expiresAt <= expiresAt);
        assert(memoryWitnessDeadline(phase, 'save') > performance.now());
        return { status: 0 };
      },
    };
    assert.equal(launchMemoryWitness({ ...options, resolveElectron: () => executable }), 0);
    assert.throws(() => launchMemoryWitness({ ...options, resolveElectron() {
      admission.pause();
      return executable;
    } }), /native_test_desktop_gaming/);
    assert.equal(spawned, 1);
    assert.deepEqual(readdirSync(canonicalRoot), []);
  } finally {
    rmdirSync(root);
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
