const { createHash } = require("node:crypto");
const { isIP } = require("node:net");
const { showVelaReview } = require("./vela-review.cjs");
const PLAN = "chatgpt-plan-responses";
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
  "readViewState",
  "openCitation",
]);
exports.isConversationRead = (input) => input && readNames.has(input.name);

/** Runs only after the owning IPC handler verifies the exact native main frame. */
exports.conversationCommand = async ({
  win,
  dialog,
  call,
  input,
  reviewSources = showVelaReview,
  openExternal,
}) => {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.input ||
    typeof input.input !== "object"
  )
    throw Error("invalid_conversation_command");
  if (input.name === "openCitation") {
    const { resourceId, messageId, index } = input.input;
    const { url: source } = await call("conversationCitation", { resourceId, messageId, index });
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || /\.(?:localhost|local|internal)\.?$/i.test(url.hostname) || isIP(url.hostname))
      throw Error("citation_url_not_supported");
    await openExternal(url.href);
    return { requested: true };
  }
  if (input.name !== "send") return call("conversation", input);
  const { resourceId, content, expectedRevision, commandId, model, webSearch } =
    input.input;
  if (webSearch !== undefined && webSearch !== true) throw Error("invalid_web_search_scope");
  const request = {
    resourceId,
    content,
    expectedRevision,
    commandId,
    ...(model ? { model } : {}),
    ...(webSearch ? { webSearch: true } : {}),
  };
  const state = await call("desktop", { type: "snapshot" });
  const resource = state.resources.find(
    (r) =>
      r.id === request.resourceId &&
      r.kind === "conversation" &&
      r.available !== false,
  );
  if (!resource) throw Error("resource_not_found");
  if (webSearch && resource.providerId !== PLAN) throw Error("invalid_web_search_scope");
  if (resource.providerId === PLAN) {
    if (!webSearch) {
      const local = await call("conversationClock", request);
      if (local !== null) return local;
    }
    const preview = await call("conversationSendPreview", request);
    const r = preview?.responses;
    if (
      !r ||
      preview.providerId !== PLAN ||
      preview.resourceId !== resourceId ||
      preview.commandId !== commandId ||
      typeof r.model !== "string" ||
      !r.model ||
      typeof r.instructions !== "string" ||
      r.configurationId !== "aerynth.chatgpt-plan.primary" ||
      !Number.isSafeInteger(r.connectionVersion) ||
      r.connectionVersion < 1 ||
      !Array.isArray(r.messages) ||
      !r.messages.length ||
      r.messages.length > 128 ||
      !r.messages.every(
        (m) =>
          m &&
          Object.keys(m).length === 2 &&
          ["user", "assistant", "developer"].includes(m.role) &&
          typeof m.content === "string",
      ) ||
      !Array.isArray(r.history) ||
      r.history.length >= r.messages.length ||
      r.webSearch !== webSearch ||
      (webSearch && (r.messages.length !== 1 || r.history.length || r.requiresSourceReview)) ||
      typeof r.requiresSourceReview !== "boolean" ||
      r.messages.at(-1).role !== "user" ||
      r.messages.at(-1).content !== request.content ||
      (!r.requiresSourceReview &&
        ((preview.context?.length ?? 0) > 0 || !!preview.handoff))
    )
      throw Error("invalid_native_responses_preview");
    const body = JSON.stringify({
      model: r.model,
      instructions: r.instructions,
      input: r.messages.map(({ role, content }) => ({ role, content })),
      store: false,
      stream: true,
      ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}),
    });
    const bytes = Buffer.byteLength(body),
      digest = createHash("sha256").update(body).digest("hex");
    if (bytes > 262144 || r.bodyBytes !== bytes || r.bodyDigest !== digest)
      throw Error("invalid_native_responses_preview");
    if (r.requiresSourceReview) {
      const grouped = new Map();
      const include = (id, content) => {
        if (typeof id !== "string" || typeof content !== "string")
          throw Error("invalid_native_responses_preview");
        const entry = grouped.get(id) ?? {
          id,
          kind: "resource",
          title:
            state.resources.find((item) => item.id === id)?.title ??
            "Selected source",
          content: "",
        };
        entry.content += (entry.content ? "\n\n" : "") + content;
        grouped.set(id, entry);
      };
      for (const source of preview.context ?? [])
        include(source.sourceResourceId, source.content);
      for (const source of preview.handoff?.items ?? [])
        include(preview.handoff.sourceResourceId, source.content);
      const approved = await reviewSources({
        parent: win,
        experience: "ordinary",
        expiresAt: preview.expiresAt,
        intent:
          "Share these selected sources in this ChatGPT-plan conversation?",
        review: {
          providerId: PLAN,
          prompt: body,
          promptDigest: digest,
          context: { included: [...grouped.values()] },
          history: {
            messages: r.messages
              .slice(0, r.history.length)
              .map((message, index) => ({
                ...message,
                providerId: r.history[index]?.providerId ?? "Unattributed",
              })),
          },
        },
      });
      if (approved !== true) throw Error("authorization_cancelled");
    }
    // An ordinary Send authorizes this exact own-chat request. Source sharing
    // has the additional native review above; neither path can mint its own
    // grant from renderer fields or choose an API-key billing fallback.
    const binding = {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      commandId: preview.commandId,
    };
    const grant = await call("authorizeConversationSend", binding);
    return call("conversationSend", { ...binding, grantId: grant.grantId });
  }
  if (resource.provider === "local")
    return call("conversation", { name: "send", input: request });
  if (resource.provider !== "codex") throw Error("provider_unavailable");
  // The backend assembles and validates the actual prospective egress. Nothing
  // in a renderer-provided request can supply its own grant or replace this text.
  const preview = await call("conversationSendPreview", request);
  if (
    typeof preview.executionText !== "string" ||
    !preview.executionText.trim() ||
    Buffer.byteLength(preview.executionText) > 65536
  )
    throw Error("invalid_native_send_preview");
  const response = await dialog.showMessageBox(win, {
    type: "question",
    title: "Authorize Codex conversation",
    message: `Send this request to Codex in “${resource.title}”?`,
    detail: `Uses the configured native Codex account and instructions. This review requests a read-only sandbox and denies approval requests. Included excerpts are source data, not additional authority.\n\nComplete outgoing request and included source excerpts:\n${preview.executionText}`,
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
