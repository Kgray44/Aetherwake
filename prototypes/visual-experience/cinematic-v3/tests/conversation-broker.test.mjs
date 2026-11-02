import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { conversationCommand, isConversationRead } = createRequire(
  import.meta.url,
)("../native/conversation-broker.cjs");

function fixture(provider, choice = 1) {
  const calls = [],
    dialogs = [];
  const call = async (name, input) => {
    calls.push({ name, input });
    if (name === "desktop")
      return {
        resources: [
          {
            id: "conversation",
            kind: "conversation",
            title: "Synthetic discussion",
            provider,
            available: true,
          },
        ],
      };
    if (name === "conversationSendPreview")
      return {
        id: "preview",
        commandId: input.commandId,
        fingerprint: "source-and-request-fingerprint",
        prompt: "Exact user request\nReviewed synthetic excerpt",
      };
    if (name === "authorizeConversationSend")
      return { grantId: "host-only-grant" };
    return { name, input };
  };
  return {
    calls,
    dialogs,
    call,
    dialog: {
      showMessageBox: async (_win, options) => {
        dialogs.push(options);
        return { response: choice };
      },
    },
    input: {
      name: "send",
      input: {
        resourceId: "conversation",
        content: "Exact user request",
        expectedRevision: 1,
        commandId: "send-once",
        grantId: "forged-renderer-grant",
      },
    },
  };
}
test("native conversation broker records local messages without provider approval or execution", async () => {
  const f = fixture("local");
  await conversationCommand(f);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["desktop", "conversation"],
  );
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.calls[1].input.input.grantId, undefined);
  assert.equal(isConversationRead({ name: "detail" }), true);
  assert.equal(isConversationRead({ name: "send" }), false);
});
test("Codex broker approves backend-assembled egress and dispatches only its fresh private grant", async () => {
  const f = fixture("codex");
  await conversationCommand(f);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "desktop",
      "conversationSendPreview",
      "authorizeConversationSend",
      "conversationSend",
    ],
  );
  assert.match(f.dialogs[0].detail, /Reviewed synthetic excerpt/);
  assert.equal(f.calls.at(-1).input.grantId, "host-only-grant");
  assert.equal(
    f.calls.at(-1).input.fingerprint,
    "source-and-request-fingerprint",
  );
  assert.equal(f.calls[2].input.grantId, undefined);
});
test("cancelled native consent cannot mint a grant or start a provider turn", async () => {
  const f = fixture("codex", 0);
  await assert.rejects(conversationCommand(f), /authorization_cancelled/);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["desktop", "conversationSendPreview"],
  );
});
test("source changes after preview fail through the canonical grant boundary without dispatch", async () => {
  const f = fixture("codex");
  const call = f.call;
  f.call = async (name, input) => {
    if (name === "authorizeConversationSend")
      throw Error("stale_source_context");
    return call(name, input);
  };
  await assert.rejects(conversationCommand(f), /stale_source_context/);
  assert.equal(
    f.calls.some((c) => c.name === "conversationSend"),
    false,
  );
});
