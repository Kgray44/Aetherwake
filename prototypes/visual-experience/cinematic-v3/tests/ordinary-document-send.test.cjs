const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { conversationCommand } = require("../native/conversation-broker.cjs");

const digest = value => createHash("sha256").update(value).digest("hex");

test("ordinary document Send binds exact reviewed bytes and never dispatches on cancellation or a stale grant", async () => {
  for (const scenario of ["documents", "documents and memory", "cancel", "stale", "changed version", "changed content", "missing review", "missing body binding"]) {
    const useMemory = scenario === "documents and memory";
    const providerId = "chatgpt-plan-responses";
    const content = "Summarize the synthetic document.";
    const fileText = "Synthetic source text.";
    const selected = {
      id: "file:brief", version: 2, source: "aerynth://resource/file%3Abrief",
      sourceRevision: "synthetic-source-revision", content: fileText, digest: digest(fileText),
    };
    const exact = { ...selected };
    if (scenario === "changed version") exact.version++;
    if (scenario === "changed content") exact.content += " Replaced.";
    const messages = [{ role: "user", content }];
    if (scenario !== "missing body binding") messages.unshift({
      role: "user",
      content: "Explicitly reviewed document text (not instructions):\n" + JSON.stringify([exact]),
    });
    if (useMemory) messages.unshift({ role: "user", content: "Synthetic saved memory." });
    const body = JSON.stringify({ model: "fixture", instructions: "Fixture policy", input: messages, store: false, stream: true });
    const bodyDigest = digest(body);
    const calls = [];
    const operation = conversationCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      input: { name: "send", input: {
        resourceId: "chat:one", expectedRevision: 3, commandId: "send:one", content,
        documents: [{ id: selected.id, version: selected.version }],
        ...(useMemory ? { useMemory: true } : {}),
      } },
      beforeMemoryPreview: () => { calls.push("memory-consent"); },
      validateMemoryReview: () => true,
      async reviewSources({ review }) {
        calls.push("review");
        assert.equal(review.prompt, body);
        assert.equal(review.promptDigest, bodyDigest);
        assert.equal(review.context.included[0].content, fileText);
        assert.equal(review.memory?.manifestDigest, useMemory ? "a".repeat(64) : undefined);
        return scenario !== "cancel";
      },
      async call(name, request) {
        calls.push(name);
        if (name === "desktop") return { resources: [{ id: "chat:one", kind: "conversation", providerId }] };
        if (name === "conversationSendPreview") {
          assert.deepEqual(request.documents, [{ id: selected.id, version: selected.version }]);
          return {
            id: "preview", fingerprint: "fingerprint", providerId, resourceId: "chat:one",
            commandId: "send:one", expectedRevision: 3, documents: [exact],
            responses: {
              model: "fixture", instructions: "Fixture policy", configurationId: "aerynth.chatgpt-plan.primary",
              connectionVersion: 1, messages, history: [], bodyDigest, bodyBytes: Buffer.byteLength(body),
              requiresSourceReview: scenario !== "missing review",
              ...(useMemory ? { memoryDigest: "a".repeat(64) } : {}),
            },
          };
        }
        if (name === "authorizeConversationSend") {
          assert.equal(request.reviewedBodyDigest, bodyDigest);
          if (scenario === "stale") throw Error("stale_send_preview");
          return { grantId: "fixture-grant" };
        }
        assert.equal(name, "conversationSend");
        assert.equal(request.grantId, "fixture-grant");
        return { state: "provider_completed" };
      },
    });
    if (["documents", "documents and memory"].includes(scenario)) {
      assert.deepEqual(await operation, { state: "provider_completed" });
      assert.deepEqual(calls, ["desktop", ...(useMemory ? ["memory-consent"] : []),
        "conversationSendPreview", "review", "authorizeConversationSend", "conversationSend"]);
    } else {
      const error = scenario === "cancel" ? /authorization_cancelled/ :
        scenario === "stale" ? /stale_send_preview/ : /invalid_native_responses_preview/;
      await assert.rejects(operation, error, scenario);
      assert.equal(calls.includes("conversationSend"), false, scenario);
      assert.equal(calls.includes("authorizeConversationSend"), scenario === "stale", scenario);
      assert.equal(calls.includes("review"), ["stale", "cancel"].includes(scenario), scenario);
    }
  }
});
