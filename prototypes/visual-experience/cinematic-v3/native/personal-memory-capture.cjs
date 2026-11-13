/** Called from a trusted native IPC handler. Only the main process sees the
 * private review ticket and can send a commit to the backend. */
async function capturePersonalMemory({ input, observeGesture, trustedFrame, allowWrite, preview, showReview, commit, cancel }) {
  if (!trustedFrame() || !await observeGesture() || !trustedFrame()) {
    throw Error('personal_memory_user_gesture_required');
  }
  if (!await allowWrite()) throw Error('storage_reserve_admission_denied');
  if (!trustedFrame()) throw Error('personal_memory_frame_changed');
  const review = await preview(input);
  let committed = false;
  try {
    if (!trustedFrame()) throw Error('personal_memory_frame_changed');
    if (await showReview(structuredClone(review)) !== true) return { status: 'cancelled' };
    if (!trustedFrame()) throw Error('personal_memory_frame_changed');
    if (!await allowWrite()) throw Error('storage_reserve_admission_denied');
    if (!trustedFrame()) throw Error('personal_memory_frame_changed');
    const saved = await commit(review);
    committed = true;
    return { status: 'saved', id: saved.id };
  } finally {
    if (!committed) {
      // The ticket also expires in the backend if the IPC connection closed.
      try { await cancel(review.id); } catch {}
    }
  }
}

module.exports = { capturePersonalMemory };
