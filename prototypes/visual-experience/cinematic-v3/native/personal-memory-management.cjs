/** Main-process command adapter. The renderer receives neither review tickets
 * nor plaintext export bundles. */
async function managePersonalMemory({ input, trustedFrame, observeGesture, allowWrite, call, confirm, chooseExport, writeExport }) {
  const send = request => call("personalMemoryManagementNative", request);
  const requireFrame = () => {
    if (!trustedFrame()) throw Error("personal_memory_frame_changed");
  };
  requireFrame();
  if (input?.type === "list" || input?.type === "read") {
    const result = await send(input.type === "list" ? { type: "list", after: input.after ?? null } : { type: "read", id: input.id });
    requireFrame();
    return result;
  }
  if (!["manage", "enableProviderMemory", "disableProviderMemory", "revokeSource"].includes(input?.type))
    throw Error("invalid_personal_memory_management");
  if (!await observeGesture()) throw Error("personal_memory_user_gesture_required");
  requireFrame();
  if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
  requireFrame();
  if (input.type === "enableProviderMemory" || input.type === "disableProviderMemory") {
    const { assistant, version } = input;
    if (!["ordinary", "vela"].includes(assistant) || !Number.isSafeInteger(version) || version < 1)
      throw Error("invalid_privacy_policy");
    const enable = input.type === "enableProviderMemory";
    if (enable) {
      const policy = await call("personalMemoryPolicyNative", {});
      requireFrame();
      if (policy.version !== version) throw Error("stale_personal_context_version");
      if (!policy.storageEnabled) throw Error("personal_storage_disabled");
      if (policy[assistant === "ordinary" ? "ordinaryEnabled" : "velaEnabled"]) return policy;
      if (await confirm({ action: "enableProviderMemory", assistant }) !== true) return { status: "cancelled" };
      requireFrame();
      if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
      requireFrame();
    }
    const updated = await call("personalMemoryPolicyNative", { assistant, enable, expectedVersion: version });
    requireFrame();
    return updated;
  }
  if (input.type === "revokeSource") {
    const { id, version } = input;
    const selection = { type: "previewSourceRevocation", id, version };
    const { binding, sourceText } = await send(selection);
    requireFrame();
    if (binding?.reviewedFact?.id !== id || binding.reviewedFact.version !== version)
      throw Error("personal_memory_review_mismatch");
    if (!await confirm({ action: "revokeSource", sourceText, binding, id, version })) return { status: "cancelled" };
    requireFrame();
    if (!await allowWrite()) throw Error("storage_reserve_admission_denied");
    requireFrame();
    // The memory can change during review independently of its source conversation.
    const current = await send(selection);
    requireFrame();
    if (current.binding?.reviewedFact?.id !== id || current.binding.reviewedFact.version !== version ||
        current.sourceText !== sourceText || current.binding.conversationId !== binding.conversationId ||
        current.binding.messageId !== binding.messageId || current.binding.expectedRevision !== binding.expectedRevision)
      throw Error("personal_memory_review_mismatch");
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
