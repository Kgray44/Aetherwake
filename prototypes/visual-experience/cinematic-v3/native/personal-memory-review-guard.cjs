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
    checkParent: () => check(parent, false),
    checkReview: child => check(child, true),
  };
}

module.exports = { createMemoryReviewGuard };
