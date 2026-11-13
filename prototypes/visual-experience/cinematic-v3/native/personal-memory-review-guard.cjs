const assert = require('node:assert/strict');

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

module.exports = { createMemoryReviewGuard, memoryWitnessDeadline };
