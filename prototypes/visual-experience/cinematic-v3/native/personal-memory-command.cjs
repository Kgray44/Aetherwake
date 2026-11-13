const { managePersonalMemory } = require("./personal-memory-management.cjs");

function personalMemoryCommand({ input, event, win, currentFrame, trustedActiveFrame, allowWrite, call, reviewDialogs, writeExport }) {
  return managePersonalMemory({
    input, trustedFrame: currentFrame,
    observeGesture: () => trustedActiveFrame(event) &&
      event.senderFrame.executeJavaScript("navigator.userActivation.isActive && document.hasFocus()", false).catch(() => false),
    allowWrite, call,
    confirm: async review => {
      if (review.action === "enableProviderMemory") {
        const name = review.assistant === "ordinary" ? "ChatGPT" : "Vela’s OpenAI API";
        const choice = await reviewDialogs.showMessageBox(win, {
          type: "question", title: "Aerynth memory", message: `Enable saved memory for ${name}?`,
          detail: "Aerynth can look for relevant saved memories in eligible conversations. You’ll review the exact request before anything is shared. You can turn this off in Saved memories.",
          buttons: ["Cancel", "Enable memory"], defaultId: 0, cancelId: 0, noLink: true,
        });
        return choice.response === 1;
      }
      const labels = { correct: "Correct memory", revoke: "Revoke memory", delete: "Delete memory", export: "Export memory", revokeSource: "Revoke original message" };
      const scope = review.target?.scope;
      const detail = review.action === "revokeSource"
        ? "Hide this message and remove saved memories that depend on it. The original remains in local history storage. Previous exports, backups, and provider copies may still contain it.\n\nOriginal message\n" + review.sourceText +
          "\n\nConversation " + review.binding.conversationId + " · revision " + review.binding.expectedRevision + " · message " + review.binding.messageId
        : (review.action === "correct" ? "Current memory\n" + review.fact.text + "\n\nReplacement\n" + review.text +
          (review.keywords ? "\n\nReplacement search terms\n" + review.keywords.join(", ") : "")
          : review.action === "export" ? "Export this memory and its retained revisions to a readable JSON file.\n\n" + review.fact.text
          : review.action === "delete" ? "Remove this memory and its retained revisions from the profile."
          : "Keep the record for inspection and exclude it from future recall.") +
          "\n\nMemory " + review.id + " · revision " + review.version + " · " + scope.kind + (scope.id ? " " + scope.id : "");
      const choice = await reviewDialogs.showMessageBox(win, { type: "question", title: "Aerynth memory",
        message: labels[review.action] + "?", detail, buttons: ["Cancel", labels[review.action]], defaultId: 0, cancelId: 0, noLink: true });
      return choice.response === 1;
    },
    chooseExport: async () => {
      const choice = await reviewDialogs.showSaveDialog(win, { title: "Export memory", defaultPath: "aerynth-memory.json",
        filters: [{ name: "JSON", extensions: ["json"] }] });
      return choice.canceled ? null : choice.filePath ?? null;
    },
    writeExport,
  });
}

module.exports = { personalMemoryCommand };
