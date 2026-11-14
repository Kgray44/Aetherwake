const { createHash } = require("node:crypto");
const { isIP } = require("node:net");
const { showVelaReview, isReviewOwnerAlive } = require("./vela-review.cjs");
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

function reviewedResources(preview, resources, errorCode) {
  const grouped = new Map();
  const include = (id, content) => {
    if (typeof id !== "string" || typeof content !== "string")
      throw Error(errorCode);
    const entry = grouped.get(id) ?? {
      id,
      kind: "resource",
      title: resources.find((item) => item.id === id)?.title ?? "Selected source",
      content: "",
    };
    entry.content += (entry.content ? "\n\n" : "") + content;
    grouped.set(id, entry);
  };
  for (const source of preview.context ?? [])
    include(source.sourceResourceId, source.content);
  for (const source of preview.handoff?.items ?? [])
    include(preview.handoff.sourceResourceId, source.content);
  return [...grouped.values()];
}

/** Runs only after the owning IPC handler verifies the exact native main frame. */
exports.conversationCommand = async ({
  win,
  call,
  input,
  reviewSources = showVelaReview,
  openExternal,
  beforeMemoryPreview,
  validateMemoryReview,
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
  const { resourceId, content, expectedRevision, commandId, model, reasoningEffort, webSearch, useMemory } =
    input.input;
  if (useMemory !== undefined && (useMemory !== true || webSearch)) throw Error("invalid_memory_scope");
  if (webSearch !== undefined && webSearch !== true) throw Error("invalid_web_search_scope");
  if (model !== undefined && (typeof model !== "string" || !model || model.length > 200))
    throw Error("invalid_model");
  if (reasoningEffort !== undefined && (!model ||
      !["none", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)))
    throw Error("unsupported_reasoning_effort");
  const request = {
    resourceId,
    content,
    expectedRevision,
    commandId,
    ...(model ? { model } : {}),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(webSearch ? { webSearch: true } : {}),
    ...(useMemory ? { useMemory: true } : {}),
  };
  const state = await call("desktop", { type: "snapshot" });
  const resource = state.resources.find(
    (r) =>
      r.id === request.resourceId &&
      r.kind === "conversation" &&
      r.available !== false,
  );
  if (!resource) throw Error("resource_not_found");
  if (useMemory && resource.providerId !== PLAN) throw Error("invalid_memory_scope");
  if (webSearch && resource.providerId !== PLAN) throw Error("invalid_web_search_scope");
  if (reasoningEffort !== undefined && resource.providerId !== PLAN)
    throw Error("unsupported_reasoning_effort");
  if (resource.providerId === PLAN) {
    if (useMemory) {
      if (!beforeMemoryPreview || !validateMemoryReview) throw Error("personal_memory_native_required");
      await beforeMemoryPreview();
    } else if (!webSearch) {
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
      (model !== undefined && r.model !== model) ||
      r.reasoningEffort !== reasoningEffort ||
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
      (useMemory ? !/^[a-f0-9]{64}$/u.test(r.memoryDigest ?? "") || r.requiresSourceReview !== true : r.memoryDigest !== undefined) ||
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
      ...(reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } }),
      ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}),
    });
    const bytes = Buffer.byteLength(body),
      digest = createHash("sha256").update(body).digest("hex");
    if (bytes > 262144 || r.bodyBytes !== bytes || r.bodyDigest !== digest)
      throw Error("invalid_native_responses_preview");
    if (r.requiresSourceReview) {
      if (useMemory && !validateMemoryReview()) throw Error("personal_memory_frame_changed");
      const approved = await reviewSources({
        parent: win,
        experience: "ordinary",
        expiresAt: preview.expiresAt,
        intent: useMemory ? "Share the saved memory shown below with ChatGPT for this request?"
          : "Share these selected sources in this ChatGPT-plan conversation?",
        review: {
          providerId: PLAN,
          prompt: body,
          promptDigest: digest,
          ...(useMemory ? { memory: { manifestDigest: r.memoryDigest } } : {}),
          context: { included: reviewedResources(preview, state.resources, "invalid_native_responses_preview") },
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
      if (useMemory && !validateMemoryReview()) throw Error("personal_memory_frame_changed");
    }
    // An ordinary Send authorizes this exact own-chat request. Source sharing
    // has the additional native review above; neither path can mint its own
    // grant from renderer fields or choose an API-key billing fallback.
    const binding = {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      commandId: preview.commandId,
    };
    const grant = await call("authorizeConversationSend", {
      ...binding, ...(useMemory ? { reviewedBodyDigest: digest } : {}),
    });
    if (useMemory && !validateMemoryReview()) throw Error("personal_memory_frame_changed");
    return call("conversationSend", { ...binding, grantId: grant.grantId });
  }
  if (resource.provider === "local")
    return call("conversation", { name: "send", input: request });
  if (resource.provider !== "codex") throw Error("provider_unavailable");
  // The backend assembles and validates the actual prospective egress. Nothing
  // in a renderer-provided request can supply its own grant or replace this text.
  const preview = await call("conversationSendPreview", request);
  if (
    !preview ||
    preview.resourceId !== request.resourceId ||
    preview.providerId !== resource.providerId ||
    preview.commandId !== request.commandId ||
    preview.expectedRevision !== request.expectedRevision ||
    preview.prompt !== request.content ||
    preview.model !== model ||
    typeof preview.id !== "string" || !preview.id ||
    typeof preview.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(preview.fingerprint) ||
    !Number.isFinite(Date.parse(preview.expiresAt)) ||
    typeof preview.executionText !== "string" ||
    !preview.executionText.trim() ||
    Buffer.byteLength(preview.executionText) > 65536
  )
    throw Error("invalid_native_send_preview");
  const approved = await reviewSources({
    parent: win,
    experience: "codex",
    intent: request.content,
    expiresAt: preview.expiresAt,
    review: {
      providerId: preview.providerId,
      prompt: preview.executionText,
      promptDigest: createHash("sha256").update(preview.executionText).digest("hex"),
      context: { included: reviewedResources(preview, state.resources, "invalid_native_send_preview") },
    },
  });
  if (approved !== true || !isReviewOwnerAlive(win))
    throw Error("authorization_cancelled");
  const binding = {
    previewId: preview.id,
    fingerprint: preview.fingerprint,
    commandId: preview.commandId,
  };
  // This command remains private to the main-process broker. It is never an
  // exposed renderer operation, and the backend rechecks all source versions.
  const grant = await call("authorizeConversationSend", binding);
  if (!isReviewOwnerAlive(win)) throw Error("authorization_cancelled");
  return call("conversationSend", { ...binding, grantId: grant.grantId });
};
