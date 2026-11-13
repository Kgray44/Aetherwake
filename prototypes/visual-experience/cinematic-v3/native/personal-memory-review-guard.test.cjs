const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
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
