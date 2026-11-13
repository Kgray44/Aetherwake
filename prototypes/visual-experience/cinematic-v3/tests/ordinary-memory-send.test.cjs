const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { conversationCommand } = require("../native/conversation-broker.cjs");

const providerId = "chatgpt-plan-responses";
test("ordinary Send offers opted-in memory and binds the exact native review before dispatch", async () => {
  for (const scenario of ["match", "miss", "off", "web", "cancel", "stale"]) {
    const calls = [];
    const input = { resourceId: "chat", content: "Synthetic request", expectedRevision: 2, commandId: "send",
      ...(scenario === "web" ? { webSearch: true } : {}) };
    const includeMemory = ["match", "cancel", "stale"].includes(scenario);
    const messages = [{ role: "user", content: input.content }];
    if (includeMemory) messages.unshift({ role: "user", content: "Synthetic saved memory" });
    const exact = JSON.stringify({
      model: "test", instructions: "Trusted", input: messages, store: false, stream: true,
      ...(input.webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}),
    });
    const digest = createHash("sha256").update(exact).digest("hex");
    let reviews = 0, policyReads = 0;
    const operation = conversationCommand({
      input: { name: "send", input },
      shouldPreviewMemory: async () => { policyReads++; return scenario !== "off"; },
      validateMemoryReview: () => scenario !== "stale",
      reviewSources: async ({ review }) => {
        reviews++;
        assert.equal(review.prompt, exact);
        assert.equal(review.promptDigest, digest);
        return scenario !== "cancel";
      },
      async call(name, request) {
        calls.push([name, request]);
        if (name === "desktop") return { resources: [{ id: "chat", kind: "conversation", providerId }] };
        if (name === "conversationClock") return null;
        if (name === "conversationSendPreview") {
          if (request.useMemory && scenario === "miss") throw Error("personal_memory_no_eligible_context");
          assert.equal(request.useMemory === true, includeMemory);
          return { id: "preview", providerId, resourceId: "chat", commandId: "send", fingerprint: "fingerprint",
            responses: { model: "test", instructions: "Trusted", configurationId: "aerynth.chatgpt-plan.primary",
              connectionVersion: 1, messages, history: [], webSearch: input.webSearch, bodyBytes: Buffer.byteLength(exact),
              bodyDigest: digest, requiresSourceReview: includeMemory,
              ...(includeMemory ? { memoryDigest: "a".repeat(64) } : {}) } };
        }
        if (name === "authorizeConversationSend") {
          assert.equal(request.reviewedBodyDigest, includeMemory ? digest : undefined);
          return { grantId: "grant" };
        }
        assert.equal(name, "conversationSend");
        assert.equal(request.grantId, "grant");
        return { state: "provider_completed" };
      },
    });
    if (scenario === "cancel") await assert.rejects(operation, /authorization_cancelled/);
    else if (scenario === "stale") await assert.rejects(operation, /personal_memory_frame_changed/);
    else assert.deepEqual(await operation, { state: "provider_completed" });
    const previews = calls.filter(([name]) => name === "conversationSendPreview").map(([, request]) => request.useMemory);
    assert.deepEqual(previews, scenario === "miss" ? [true, undefined] : [includeMemory ? true : undefined]);
    assert.equal(reviews, Number(includeMemory));
    assert.equal(policyReads, Number(scenario !== "web"));
    if (scenario === "cancel" || scenario === "stale") {
      assert(!calls.some(([name]) => name === "conversationSend" || name === "authorizeConversationSend"));
    }
  }
});
