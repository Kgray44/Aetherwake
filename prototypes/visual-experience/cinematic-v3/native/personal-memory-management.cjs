/** Main-process command adapter. The renderer receives neither review tickets
 * nor plaintext export bundles. */
async function managePersonalMemory({ input, trustedFrame, observeGesture, allowWrite, call, confirm, saveExport }) {
  const send = request => call("personalMemoryManagementNative", request);
  const requireFrame = () => {
    if (!trustedFrame()) throw Error("personal_memory_frame_changed");
  };
  requireFrame();
  if (input?.type === "list") return send({ type: "list", after: input.after ?? null });
  if (input?.type === "read") return send({ type: "read", id: input.id });
  if (input?.type !== "manage") throw Error("invalid_personal_memory_management");
  if (!await observeGesture()) throw Error("personal_memory_user_gesture_required");
  requireFrame();
  if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
  requireFrame();
  const { action, id, version, text } = input;
  const review = await send({ type: "preview", request: { action, id, version, ...(text === undefined ? {} : { text }) } });
  let committed = false;
  try {
    requireFrame();
    if (!await confirm(review)) return { status: "cancelled" };
    requireFrame();
    if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
    requireFrame();
    const result = await send({ type: "commit", review });
    committed = true;
    if (result.action === "export") {
      requireFrame();
      return { status: await saveExport(result.bundle) ? "exported" : "cancelled" };
    }
    return { status: "applied", id: result.id };
  } finally {
    if (!committed) {
      try { await send({ type: "cancel", ticket: review.ticket }); } catch {}
    }
  }
}

module.exports = { managePersonalMemory };
