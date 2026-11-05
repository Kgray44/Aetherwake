// Public navigation only. No account, conversation, memory or inference access.
const CHATGPT_HOME = "https://chatgpt.com/";
const CHATGPT_DOCUMENTATION = Object.freeze([
  "https://developers.openai.com/siwc/quickstart",
  "https://developers.openai.com/siwc/token-sharing-open-source",
  "https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference",
  "https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations",
  "https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions",
  "https://github.com/openai/codex/blob/rust-v0.153.3/codex-rs/app-server/README.md",
  "https://learn.chatgpt.com/docs/app/commands#deep-links",
  "https://learn.chatgpt.com/docs/customization/memories",
  "https://learn.chatgpt.com/docs/personalize",
  "https://learn.chatgpt.com/docs/projects?surface=app",
  "https://learn.chatgpt.com/docs/use-chatgpt",
  "https://learn.chatgpt.com/docs/whats-new",
]);
const documentation = new Set(CHATGPT_DOCUMENTATION);

async function firstPartyChatCommand({ input, win, openExternal }) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Object.hasOwn(input, "target")
  )
    throw new Error("invalid_first_party_target");
  const keys = Object.keys(input);
  const url =
    input.target === "chatgpt-home" && keys.length === 1
      ? CHATGPT_HOME
      : input.target === "chatgpt-documentation" &&
          keys.length === 2 &&
          Object.hasOwn(input, "url") &&
          documentation.has(input.url)
        ? input.url
        : null;
  if (!url) throw new Error("invalid_first_party_target");
  if (!win || win.isDestroyed() || win.webContents.isDestroyed())
    return { status: "unavailable" };
  try {
    await openExternal(url);
    // OS acknowledgement does not establish login, foreground or navigation.
    return { status: "requested" };
  } catch {
    // The OS may have delivered the request before reporting an error. No retry.
    return { status: "unknown" };
  }
}

module.exports = { CHATGPT_HOME, CHATGPT_DOCUMENTATION, firstPartyChatCommand };
