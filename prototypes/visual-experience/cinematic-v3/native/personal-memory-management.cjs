/** Main-process command adapter. The renderer receives neither review tickets
 * nor plaintext export bundles. */
async function managePersonalMemory({ input, trustedFrame, observeGesture, allowWrite, call, confirm, chooseExport, writeExport }) {
  const send = request => call("personalMemoryManagementNative", request);
  const requireFrame = () => {
    if (!trustedFrame()) throw Error("personal_memory_frame_changed");
  };
  requireFrame();
  if (input?.type === "list") return send({ type: "list", after: input.after ?? null });
  if (input?.type === "read") return send({ type: "read", id: input.id });
  if (!["manage", "disableProviderMemory", "revokeSource"].includes(input?.type)) throw Error("invalid_personal_memory_management");
  if (!await observeGesture()) throw Error("personal_memory_user_gesture_required");
  requireFrame();
  if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
  requireFrame();
  if (input.type === "disableProviderMemory") {
    if (!["ordinary", "vela"].includes(input.assistant) || !Number.isSafeInteger(input.version) || input.version < 1)
      throw Error("invalid_privacy_policy");
    return call("personalMemoryPolicyNative", { assistant: input.assistant, enable: false, expectedVersion: input.version });
  }
  if (input.type === "revokeSource") {
    const { id, version } = input;
    const { binding, sourceText } = await send({ type: "previewSourceRevocation", id, version });
    requireFrame();
    if (!await confirm({ action: "revokeSource", sourceText })) return { status: "cancelled" };
    requireFrame();
    if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
    requireFrame();
    const { erasedFacts } = await call("personalMemoryRevokeSourceNative", binding);
    return { status: "applied", erasedFacts };
  }
  const { action, id, version, text, keywords } = input;
  const review = await send({ type: "preview", request: { action, id, version, ...(text === undefined ? {} : { text }),
    ...(keywords === undefined ? {} : { keywords }) } });
  let committed = false;
  try {
    requireFrame();
    if (!await confirm(review)) return { status: "cancelled" };
    requireFrame();
    const exportPath = action === "export" ? await chooseExport() : null;
    if (action === "export" && !exportPath) return { status: "cancelled" };
    if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
    requireFrame();
    const result = await send({ type: "commit", review });
    committed = true;
    if (result.action === "export") {
      requireFrame();
      writeExport(exportPath, result.bundle);
      return { status: "exported" };
    }
    return { status: "applied", id: result.id };
  } finally {
    if (!committed) {
      try { await send({ type: "cancel", ticket: review.ticket }); } catch {}
    }
  }
}

module.exports = { managePersonalMemory };
