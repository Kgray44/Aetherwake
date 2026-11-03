import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
        prompt: "Exact user request",
        executionText:
          "Reviewed synthetic excerpt\nUser request:\nExact user request",
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
  assert.ok(
    f.dialogs[0].detail.endsWith(
      "Reviewed synthetic excerpt\nUser request:\nExact user request",
    ),
  );
  assert.equal(f.calls.at(-1).input.grantId, "host-only-grant");
  assert.equal(
    f.calls.at(-1).input.fingerprint,
    "source-and-request-fingerprint",
  );
  assert.equal(f.calls.at(-2).input.grantId, undefined);
});

test("a missing or oversized assembled request cannot fall back to prompt-only consent", async () => {
  for (const executionText of [undefined, "", "x".repeat(65537)]) {
    const f = fixture("codex"),
      call = f.call;
    f.call = async (name, input) => {
      const result = await call(name, input);
      return name === "conversationSendPreview"
        ? { ...result, executionText }
        : result;
    };
    await assert.rejects(conversationCommand(f), /invalid_native_send_preview/);
    assert.equal(f.dialogs.length, 0);
    assert.equal(
      f.calls.some(
        (value) =>
          value.name === "authorizeConversationSend" ||
          value.name === "conversationSend",
      ),
      false,
    );
  }
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

function planFixture({ shared = false, approve = true } = {}) {
  const f = fixture("local"),
    original = f.call,
    reviews = [];
  f.call = async (name, input) => {
    const result = await original(name, input);
    if (name === "desktop")
      return {
        resources: [
          { ...result.resources[0], providerId: "chatgpt-plan-responses" },
        ],
      };
    if (name === "conversationClock") return null;
    if (name === "conversationSendPreview") {
      const messages = [
        { role: "user", content: "An earlier question" },
        { role: "assistant", content: "An earlier real answer" },
        ...(shared
          ? [{ role: "user", content: "A reviewed selected source" }]
          : []),
        { role: "user", content: input.content },
      ];
      const model = "synthetic-catalog-model",
        instructions = "Synthetic ordinary instructions";
      const body = JSON.stringify({
        model,
        instructions,
        input: messages,
        store: false,
        stream: true,
      });
      return {
        ...result,
        providerId: "chatgpt-plan-responses",
        resourceId: input.resourceId,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        context: shared
          ? [
              {
                sourceResourceId: "selected-note",
                content: "A reviewed selected source",
              },
            ]
          : [],
        responses: {
          model,
          instructions,
          configurationId: "aerynth.chatgpt-plan.primary",
          connectionVersion: 1,
          messages,
          history: [
            { resourceId: "conversation", messageId: "q" },
            {
              resourceId: "conversation",
              messageId: "a",
              providerId: "chatgpt-plan-responses",
            },
          ],
          bodyDigest: createHash("sha256").update(body).digest("hex"),
          bodyBytes: Buffer.byteLength(body),
          requiresSourceReview: shared,
        },
      };
    }
    return result;
  };
  f.reviewSources = async (request) => {
    reviews.push(request);
    return approve;
  };
  return { ...f, reviews };
}

test("ordinary ChatGPT-plan sends use real canonical execution even when the legacy resource projection is local", async () => {
  const f = planFixture();
  await conversationCommand(f);
  assert.deepEqual(
    f.calls.map((value) => value.name),
    [
      "desktop",
      "conversationClock",
      "conversationSendPreview",
      "authorizeConversationSend",
      "conversationSend",
    ],
  );
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.reviews.length, 0);
  assert.equal(f.calls.at(-1).input.grantId, "host-only-grant");
  assert.equal(f.calls[2].input.grantId, undefined);
});

test("ordinary selected-source sharing uses the full exact request in the native Aerynth pane and cancellation denies execution", async () => {
  for (const approve of [false, true]) {
    const f = planFixture({ shared: true, approve });
    if (approve) await conversationCommand(f);
    else
      await assert.rejects(conversationCommand(f), /authorization_cancelled/);
    assert.equal(f.reviews.length, 1);
    const review = f.reviews[0];
    assert.equal(review.experience, "ordinary");
    assert.equal(review.review.providerId, "chatgpt-plan-responses");
    assert.equal(JSON.parse(review.review.prompt).store, false);
    assert.equal(
      JSON.parse(review.review.prompt).input.at(-1).content,
      "Exact user request",
    );
    assert.equal(
      review.review.context.included[0].content,
      "A reviewed selected source",
    );
    assert.equal(
      f.calls.some((value) => value.name === "authorizeConversationSend"),
      approve,
    );
  }
});

test("changed exact Responses body, model, request or source-review classification cannot obtain a native grant", async () => {
  for (const change of [
    (r) => (r.bodyDigest = "0".repeat(64)),
    (r) => r.bodyBytes++,
    (r) => (r.model = "substituted"),
    (r) => (r.messages.at(-1).content = "substituted"),
  ]) {
    const f = planFixture(),
      original = f.call;
    f.call = async (name, input) => {
      const value = await original(name, input);
      if (name === "conversationSendPreview") change(value.responses);
      return value;
    };
    await assert.rejects(
      conversationCommand(f),
      /invalid_native_responses_preview/,
    );
    assert.equal(
      f.calls.some((value) => value.name === "authorizeConversationSend"),
      false,
    );
  }
  const f = planFixture({ shared: true }),
    original = f.call;
  f.call = async (name, input) => {
    const value = await original(name, input);
    if (name === "conversationSendPreview")
      value.responses.requiresSourceReview = false;
    return value;
  };
  await assert.rejects(
    conversationCommand(f),
    /invalid_native_responses_preview/,
  );
  assert.equal(f.reviews.length, 0);
});
