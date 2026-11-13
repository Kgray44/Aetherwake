const assert = require('node:assert/strict');
const { realpathSync, writeFileSync } = require('node:fs');
const { basename, isAbsolute, join, resolve } = require('node:path');

function createMemoryReviewGuard({ parent, focusedWindow, isOwned, deadline, now = () => performance.now() }) {
  assert(Number.isFinite(deadline) && deadline > now(), 'native_memory_deadline_required');
  let failure;
  function check(target, review) {
    if (failure) throw failure;
    if (now() >= deadline) failure = Error('native_memory_work_deadline');
    else if (focusedWindow() !== target || (review && !isOwned(target, parent)))
      failure = Error('native_memory_foreground_lost');
    if (failure) throw failure;
  }
  return {
    observeFocus(target) {
      if (target !== parent && !isOwned(target, parent)) failure ??= Error('native_memory_foreground_lost');
    },
    checkParent: () => check(parent, false),
    checkReview: child => check(child, true),
  };
}

function memoryWitnessDeadline(admission, mode, wallNow = Date.now(), monotonicNow = performance.now()) {
  assert(admission?.purpose === 'synthetic-memory-review' && admission.mode === mode &&
    Number.isSafeInteger(admission.expiresAt) && admission.expiresAt > wallNow &&
    admission.expiresAt - wallNow <= 45000, 'native_memory_admission_required');
  return monotonicNow + admission.expiresAt - wallNow;
}

function memoryWitnessRoot(admission, requested, canonical = realpathSync) {
  assert(typeof requested === 'string' && typeof admission?.profileRoot === 'string' &&
    isAbsolute(requested) && isAbsolute(admission.profileRoot), 'native_memory_profile_required');
  const root = canonical(requested);
  assert(root === resolve(requested) && root === resolve(admission.profileRoot) &&
    /^memory-witness-[a-z0-9-]+$/u.test(basename(root)), 'native_memory_profile_mismatch');
  return root;
}

function claimMemoryWitnessPhase(root, mode) {
  assert(['save', 'restore'].includes(mode), 'native_memory_invalid_phase');
  try {
    writeFileSync(join(root, `synthetic-${mode}.started`), '', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('native_memory_phase_already_started');
    throw error;
  }
}

module.exports = { createMemoryReviewGuard, memoryWitnessDeadline, memoryWitnessRoot, claimMemoryWitnessPhase };
