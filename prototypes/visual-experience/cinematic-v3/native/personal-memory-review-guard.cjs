const assert = require('node:assert/strict');
const { realpathSync } = require('node:fs');
const { basename, isAbsolute, resolve } = require('node:path');

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

module.exports = { createMemoryReviewGuard, memoryWitnessDeadline, memoryWitnessRoot };
