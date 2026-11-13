const assert = require('node:assert/strict');
const test = require('node:test');
const { createMemoryReviewGuard } = require('./personal-memory-review-guard.cjs');

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
