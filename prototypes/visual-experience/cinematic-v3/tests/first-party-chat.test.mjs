import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { firstPartyChatCommand, CHATGPT_HOME } = createRequire(import.meta.url)(
  "../native/first-party-chat.cjs",
);
const live = () => ({
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false },
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
    null, [], {}, "chatgpt-home", { target: "codex" },
    { target: "https://chatgpt.com/" },
    ...["url", "prompt", "conversationId", "accountId", "authorization"].map(
      (key) => ({ target: "chatgpt-home", [key]: "untrusted" }),
    ),
  ])
    await assert.rejects(
      firstPartyChatCommand({ input, win: live(), openExternal: async () => calls++ }),
      /invalid_first_party_target/,
    );
  assert.equal(calls, 0);
});

test("lost parent ownership never launches; failed OS delivery stays unknown without retry", async () => {
  let calls = 0;
  for (const win of [null, { ...live(), isDestroyed: () => true },
    { ...live(), webContents: { isDestroyed: () => true } }])
    assert.deepEqual(await firstPartyChatCommand({
      input: { target: "chatgpt-home" }, win, openExternal: async () => calls++,
    }), { status: "unavailable" });
  assert.equal(calls, 0);
  assert.deepEqual(await firstPartyChatCommand({
    input: { target: "chatgpt-home" }, win: live(),
    openExternal: async () => { calls++; throw Error("OS acknowledgement lost"); },
  }), { status: "unknown" });
  assert.equal(calls, 1);
});
