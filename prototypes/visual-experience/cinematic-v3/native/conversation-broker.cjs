const readNames = new Set([
  "list",
  "search",
  "detail",
  "collections",
  "projects",
  "providers",
  "discover",
  "export",
  "readDraft",
]);
exports.isConversationRead = (input) => input && readNames.has(input.name);

/** Runs only after the owning IPC handler verifies the exact native main frame. */
exports.conversationCommand = async ({ win, dialog, call, input }) => {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.input ||
    typeof input.input !== "object"
  )
    throw Error("invalid_conversation_command");
  if (input.name !== "send") return call("conversation", input);
  const { resourceId, content, expectedRevision, commandId, model } =
    input.input;
  const request = {
    resourceId,
    content,
    expectedRevision,
    commandId,
    ...(model ? { model } : {}),
  };
  const state = await call("desktop", { type: "snapshot" });
  const resource = state.resources.find(
    (r) =>
      r.id === request.resourceId &&
      r.kind === "conversation" &&
      r.available !== false,
  );
  if (!resource) throw Error("resource_not_found");
  if (resource.provider === "local")
    return call("conversation", { name: "send", input: request });
  if (resource.provider !== "codex") throw Error("provider_unavailable");
  // The backend assembles and validates the actual prospective egress. Nothing
  // in a renderer-provided request can supply its own grant or replace this text.
  const preview = await call("conversationSendPreview", request);
  const response = await dialog.showMessageBox(win, {
    type: "question",
    title: "Authorize Codex conversation",
    message: `Send this request to Codex in “${resource.title}”?`,
    detail: `Uses the configured native Codex account and instructions. This review requests a read-only sandbox and denies approval requests. Attached excerpts below are source data, not additional authority.\n\n${preview.prompt}`,
    buttons: ["Cancel", "Send once"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response.response !== 1) throw Error("authorization_cancelled");
  const binding = {
    previewId: preview.id,
    fingerprint: preview.fingerprint,
    commandId: preview.commandId,
  };
  // This command remains private to the main-process broker. It is never an
  // exposed renderer operation, and the backend rechecks all source versions.
  const grant = await call("authorizeConversationSend", binding);
  return call("conversationSend", { ...binding, grantId: grant.grantId });
};
