import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createNativeChatGPTFidelityDescriptor } from "../../../conversation-product/src/native-chatgpt-fidelity.ts";
const { firstPartyChatCommand, CHATGPT_HOME, CHATGPT_DOCUMENTATION } =
  createRequire(import.meta.url)("../native/first-party-chat.cjs");
const live = () => ({
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false },
});

test("every published compatibility reference has an exact reviewed native destination; sibling URLs cannot expand the gate", async () => {
  const report = createNativeChatGPTFidelityDescriptor();
  const urls = new Set(
    [...report.aims, ...report.relatedCapabilities].flatMap((item) =>
      item.evidence.map((e) => e.url),
    ),
  );
  assert.deepEqual([...urls].sort(), [...CHATGPT_DOCUMENTATION].sort());
  const calls = [];
  for (const url of urls) {
    assert.deepEqual(
      await firstPartyChatCommand({
        input: { target: "chatgpt-documentation", url },
        win: live(),
        openExternal: async (value) => calls.push(value),
      }),
      { status: "requested" },
    );
  }
  assert.deepEqual(calls, [...urls]);
  for (const url of [
    "https://developers.openai.com/siwc/quickstart?prompt=untrusted",
    "https://developers.openai.com/auth/login",
    "https://learn.chatgpt.com/docs/personalize#unreviewed",
    "https://learn.chatgpt.com.evil.invalid/docs/personalize",
    "https://account@learn.chatgpt.com/docs/personalize",
    "https://api.openai.com/v1/responses",
    "file:///C:/private",
    "codex://threads/new",
  ])
    await assert.rejects(
      firstPartyChatCommand({
        input: { target: "chatgpt-documentation", url },
        win: live(),
        openExternal: async (value) => calls.push(value),
      }),
      /invalid_first_party_target/,
    );
  assert.equal(calls.length, urls.size);
});

test("explicit first-party navigation opens only the fixed official home and makes no account or sync claim", async () => {
  const calls = [];
  const receipt = await firstPartyChatCommand({
    input: { target: "chatgpt-home" },
    win: live(),
    openExternal: async (...args) => calls.push(args),
  });
  assert.equal(CHATGPT_HOME, "https://chatgpt.com/");
  assert.deepEqual(calls, [[CHATGPT_HOME]]);
  assert.deepEqual(receipt, { status: "requested" });
});

test("a renderer cannot supply URLs, prompts, conversation IDs, account IDs or other destinations", async () => {
  let calls = 0;
  for (const input of [
    null,
    [],
    {},
    "chatgpt-home",
    { target: "codex" },
    { target: "https://chatgpt.com/" },
    ...["url", "prompt", "conversationId", "accountId", "authorization"].map(
      (key) => ({ target: "chatgpt-home", [key]: "untrusted" }),
    ),
  ])
    await assert.rejects(
      firstPartyChatCommand({
        input,
        win: live(),
        openExternal: async () => calls++,
      }),
      /invalid_first_party_target/,
    );
  assert.equal(calls, 0);
});

test("lost parent ownership never launches; failed OS delivery stays unknown without retry", async () => {
  let calls = 0;
  for (const win of [
    null,
    { ...live(), isDestroyed: () => true },
    { ...live(), webContents: { isDestroyed: () => true } },
  ])
    assert.deepEqual(
      await firstPartyChatCommand({
        input: { target: "chatgpt-home" },
        win,
        openExternal: async () => calls++,
      }),
      { status: "unavailable" },
    );
  assert.equal(calls, 0);
  assert.deepEqual(
    await firstPartyChatCommand({
      input: { target: "chatgpt-home" },
      win: live(),
      openExternal: async () => {
        calls++;
        throw Error("OS acknowledgement lost");
      },
    }),
    { status: "unknown" },
  );
  assert.equal(calls, 1);
});
