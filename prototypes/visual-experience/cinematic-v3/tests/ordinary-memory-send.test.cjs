const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { conversationCommand } = require("../native/conversation-broker.cjs");
const { reviewPage } = require("../native/vela-review.cjs");

const providerId = "chatgpt-plan-responses";
test("ordinary memory requires an explicit send choice and approval of the exact reviewed bytes", async () => {
  for (const scenario of ["approve", "cancel", "stale-preview", "stale-review", "stale-grant", "untrusted", "tampered", "default", "web", "web-with-memory", "unexpected-memory"]) {
    const calls = [];
    const useMemory = !["default", "web", "unexpected-memory"].includes(scenario);
    const hasMemory = useMemory || scenario === "unexpected-memory";
    const webSearch = ["web", "web-with-memory"].includes(scenario);
    const input = { resourceId: "chat", content: "Synthetic question", expectedRevision: 2, commandId: "send",
      ...(useMemory ? { useMemory: true } : {}), ...(webSearch ? { webSearch: true } : {}) };
    const messages = [{ role: "user", content: input.content }];
    if (hasMemory) messages.unshift({ role: "user", content: "Synthetic saved memory <script>alert(1)</script>" });
    const body = JSON.stringify({ model: "test", instructions: "Trusted", input: messages, store: false, stream: true,
      ...(webSearch ? { tools: [{ type: "web_search" }], tool_choice: "required" } : {}) });
    const digest = createHash("sha256").update(body).digest("hex");
    let reviewOpened = false, grantIssued = false;
    const operation = conversationCommand({
      input: { name: "send", input },
      ...(scenario === "untrusted" ? {} : { beforeMemoryPreview: async () => { calls.push("native-consent"); } }),
      validateMemoryReview: () => scenario !== "stale-preview" &&
        !(scenario === "stale-review" && reviewOpened) && !(scenario === "stale-grant" && grantIssued),
      reviewSources: async ({ review, intent, experience }) => {
        calls.push("native-review");
        reviewOpened = true;
        assert.equal(review.prompt, body);
        assert.equal(review.promptDigest, digest);
        const html = reviewPage(review, intent, experience);
        assert.match(html, /<details open><summary>Exact provider request with saved memory/);
        assert.match(html, /Synthetic saved memory &lt;script&gt;/);
        assert.doesNotMatch(html, /<script>alert/);
        return scenario !== "cancel";
      },
      async call(name, request) {
        calls.push(name);
        if (name === "desktop") return { resources: [{ id: "chat", kind: "conversation", providerId }] };
        if (name === "conversationClock") return null;
        if (name === "conversationSendPreview") {
          assert.equal(request.useMemory, useMemory ? true : undefined);
          return { id: "preview", providerId, resourceId: "chat", commandId: "send", fingerprint: "fingerprint",
            responses: { model: "test", instructions: "Trusted", configurationId: "aerynth.chatgpt-plan.primary",
              connectionVersion: 1, messages, history: [], webSearch: input.webSearch, bodyBytes: Buffer.byteLength(body),
              bodyDigest: scenario === "tampered" ? "b".repeat(64) : digest, requiresSourceReview: hasMemory,
              ...(hasMemory ? { memoryDigest: "a".repeat(64) } : {}) } };
        }
        if (name === "authorizeConversationSend") {
          assert.equal(request.reviewedBodyDigest, hasMemory ? digest : undefined);
          grantIssued = true;
          return { grantId: "grant" };
        }
        assert.equal(name, "conversationSend");
        assert.equal(request.grantId, "grant");
        return { state: "provider_completed" };
      },
    });
    const errors = { cancel: /authorization_cancelled/, "stale-preview": /personal_memory_frame_changed/, "stale-review": /personal_memory_frame_changed/,
      "stale-grant": /personal_memory_frame_changed/, untrusted: /personal_memory_native_required/,
      tampered: /invalid_native_responses_preview/, "web-with-memory": /invalid_memory_scope/,
      "unexpected-memory": /invalid_native_responses_preview/ };
    if (errors[scenario]) {
      await assert.rejects(operation, errors[scenario], scenario);
      assert.equal(calls.includes("conversationSend"), false, scenario);
      assert.equal(grantIssued, scenario === "stale-grant", scenario);
    } else {
      assert.deepEqual(await operation, { state: "provider_completed" }, scenario);
    }
    assert.equal(calls.includes("native-review"), ["approve", "cancel", "stale-review", "stale-grant"].includes(scenario), scenario);
    assert.equal(calls.includes("native-consent"), ["approve", "cancel", "stale-preview", "stale-review", "stale-grant", "tampered"].includes(scenario), scenario);
  }
});
