// Public navigation only. No account, conversation, memory or inference access.
const CHATGPT_HOME = "https://chatgpt.com/";

async function firstPartyChatCommand({ input, win, openExternal }) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    input.target !== "chatgpt-home"
  )
    throw new Error("invalid_first_party_target");
  if (!win || win.isDestroyed() || win.webContents.isDestroyed())
    return { status: "unavailable" };
  try {
    await openExternal(CHATGPT_HOME);
    // OS acknowledgement does not establish login, foreground or navigation.
    return { status: "requested" };
  } catch {
    // The OS may have delivered the request before reporting an error. No retry.
    return { status: "unknown" };
  }
}

module.exports = { CHATGPT_HOME, firstPartyChatCommand };
