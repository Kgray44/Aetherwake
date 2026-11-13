const assert = require('node:assert/strict');
const test = require('node:test');
const { capturePersonalMemory } = require('./personal-memory-capture.cjs');

test('native capture rechecks the trusted frame and storage after review', async () => {
  const input = { conversationId: 'chat', messageId: 'message' };
  const review = { id: 'review', sourceText: 'Synthetic source', draft: { text: 'Synthetic fact' } };
  const calls = [];
  let active = true;
  let writable = true;
  let approve = true;
  const options = {
    input, observeGesture: async () => true, trustedFrame: () => active,
    allowWrite: async () => writable,
    async preview(value) { assert.equal(value, input); calls.push('preview'); return review; },
    async showReview(value) { assert.deepEqual(value, review); calls.push('review'); return approve; },
    async commit(value) { assert.deepEqual(value, review); calls.push('commit'); return { id: 'saved' }; },
    async cancel(id) { assert.equal(id, review.id); calls.push('cancel'); },
  };
  assert.deepEqual(await capturePersonalMemory(options), { status: 'saved', id: 'saved' });
  assert.deepEqual(calls.splice(0), ['preview', 'review', 'commit']);
  await assert.rejects(capturePersonalMemory({
    ...options, async commit() { throw Error('stale_personal_scope'); },
  }), /stale_personal_scope/);
  assert.deepEqual(calls.splice(0), ['preview', 'review', 'cancel']);
  approve = false;
  assert.deepEqual(await capturePersonalMemory(options), { status: 'cancelled' });
  assert.deepEqual(calls.splice(0), ['preview', 'review', 'cancel']);
  approve = true;
  await assert.rejects(capturePersonalMemory({
    ...options, async showReview() { active = false; return true; },
  }), /personal_memory_frame_changed/);
  assert.deepEqual(calls.splice(0), ['preview', 'cancel']);
  active = true;
  await assert.rejects(capturePersonalMemory({
    ...options, async showReview() { writable = false; return true; },
  }), /storage_reserve_admission_denied/);
  assert.deepEqual(calls.splice(0), ['preview', 'cancel']);
  await assert.rejects(capturePersonalMemory({ ...options, observeGesture: async () => false }), /personal_memory_user_gesture_required/);
  assert.deepEqual(calls, []);
});
