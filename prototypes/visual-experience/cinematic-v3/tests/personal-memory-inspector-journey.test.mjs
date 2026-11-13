import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { componentDocument, named, until } from "../../../conversation-product/test/component-dom.mts";
import { BackendCore } from "../../../integrated-backend/src/core.mts";
import { createPersonalMemoryView } from "../src/personal-memory-view.ts";
import native from "../native/personal-memory-command.cjs";

test("fresh synthetic profile reviews independent provider consent and exact source revocation through Saved memories", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-inspector-fixture-"));
  const f = componentDocument();
  const restoreDocument = f.install();
  let wrapped, core, host, decision;
  const dialogs = [];
  const nativeCalls = [];
  const win = {};
  const open = () => new BackendCore({
    path: join(root, "profile.sqlite"), privateRoot: root,
    provider: "fixture", contentPolicy: "local-private",
  }, undefined, { secrets: {
    available: async () => true,
    seal: async value => { wrapped = value; return randomBytes(64); },
    open: async () => wrapped,
  } });
  const commands = new Set(["personalMemoryManagementNative", "personalMemoryPolicyNative", "personalMemoryRevokeSourceNative"]);
  const frame = {
    async executeJavaScript(script, activate) {
      assert.equal(script, "navigator.userActivation.isActive && document.hasFocus()");
      assert.equal(activate, false);
      return true;
    },
  };
  const event = { senderFrame: frame };
  vm.runInNewContext(readFileSync(new URL("../native/desktop-preload.cjs", import.meta.url), "utf8"), {
    process: { argv: [] },
    navigator: { userActivation: { isActive: true } },
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "aerynthHost"); host = value; } },
        ipcRenderer: {
          async invoke(channel, command, input) {
            assert.equal(channel, "application-command");
            assert.equal(command, "personalMemory");
            const owner = core;
            const result = await native.personalMemoryCommand({
              input, event, win,
              currentFrame: () => owner === core,
              trustedActiveFrame: received => received === event,
              allowWrite: () => true,
              call: (name, request) => {
                assert.ok(commands.has(name), name);
                nativeCalls.push([name, request]);
                return owner.command(name, request);
              },
              reviewDialogs: {
                async showMessageBox(parent, options) {
                  assert.equal(parent, win);
                  assert.equal(options.defaultId, options.cancelId);
                  assert.ok(decision, "unexpected native confirmation");
                  const { response, message } = decision;
                  decision = undefined;
                  assert.match(options.message, message);
                  dialogs.push(options);
                  return { response };
                },
              },
              writeExport: () => assert.fail("fixture cannot export"),
            });
            return { ok: true, result };
          },
        },
      };
    },
  });
  const inspector = () => createPersonalMemoryView(input => host.command("personalMemory", input));
  const click = async (view, label) => {
    const button = named(view, label);
    assert.ok(button && !button.hidden && !button.disabled, label);
    button.fire("click");
    await until(() => !button.disabled);
  };
  const load = view => click(view, "Load saved memories");
  const writeCount = () => nativeCalls.filter(([name, input]) =>
    name === "personalMemoryRevokeSourceNative" || name === "personalMemoryPolicyNative" && input.enable !== undefined ||
    name === "personalMemoryManagementNative" && input.type === "commit").length;
  const assertNoProvider = async () => {
    const activity = await core.command("providerActivity", {});
    assert.equal(activity.providerRequests, 0);
    assert.equal(activity.codexConnections, 0);
  };

  try {
    core = open();
    let view = inspector();
    await load(view);
    assert.match(view.textContent, /ChatGPT memory: Off.*Vela memory: Off/);
    assert.equal(named(view, "Turn on ChatGPT memory").hidden, true);
    assert.equal(named(view, "Turn on Vela memory").hidden, true);

    // Seed only local capture. Every policy write and source revocation below originates in the inspector.
    const chat = await core.command("createConversation", { title: "Synthetic inspector chat", commandId: "chat" });
    const text = "The synthetic quartz relay is preferred.";
    const message = await core.command("addMessage", {
      resourceId: chat.resourceId, role: "user", content: text, expectedRevision: chat.revision, commandId: "message",
    });
    const selection = { resourceId: chat.resourceId, selection: { messageId: message.id } };
    const capture = await core.command("personalMemoryCapturePreviewNative", {
      conversationId: chat.resourceId, messageId: message.id, scope: "conversation",
      category: "preferences", text, keywords: ["quartz", "relay"],
    });
    const saved = await core.command("personalMemoryCaptureCommitNative", capture);
    await load(view);
    assert.match(view.textContent, /ChatGPT memory: Off.*Vela memory: Off/);

    decision = { response: 0, message: /ChatGPT/ };
    await click(view, "Turn on ChatGPT memory");
    assert.match(view.textContent, /Memory settings were not changed/);
    assert.equal(writeCount(), 0);
    decision = { response: 1, message: /ChatGPT/ };
    await click(view, "Turn on ChatGPT memory");
    assert.match(view.textContent, /ChatGPT memory: Enabled for reviewed sends.*Vela memory: Off/);
    decision = { response: 1, message: /Vela’s OpenAI API/ };
    await click(view, "Turn on Vela memory");
    assert.match(view.textContent, /ChatGPT memory: Enabled for reviewed sends.*Vela memory: Enabled for reviewed sends/);
    assert.match(dialogs[2].detail, /review the exact request/);
    await assertNoProvider();
    await core.command("close", {});
    core = open();

    view = inspector();
    await load(view);
    assert.match(view.textContent, /ChatGPT memory: Enabled for reviewed sends.*Vela memory: Enabled for reviewed sends/);
    await click(view, "Turn off ChatGPT memory");
    assert.match(view.textContent, /ChatGPT memory: Off.*Vela memory: Enabled for reviewed sends/);
    await click(view, "Turn off Vela memory");
    await click(view, `Memory ${saved.id} · conversation · active`);

    const beforeDelete = writeCount();
    decision = { response: 0, message: /^Delete memory/ };
    await click(view, "Delete");
    assert.equal(writeCount(), beforeDelete);
    assert.equal((await core.command("openResource", selection)).status, "ready");

    decision = { response: 0, message: /^Revoke original message/ };
    await click(view, "Revoke original message");
    assert.equal(writeCount(), beforeDelete);
    assert.equal((await core.command("openResource", selection)).status, "ready");
    decision = { response: 1, message: /^Revoke original message/ };
    await click(view, "Revoke original message");
    assert.equal(writeCount(), beforeDelete + 1);
    assert.match(dialogs.at(-1).detail, /synthetic quartz relay/);
    assert.ok(dialogs.at(-1).detail.includes(message.id));
    const [, revoke] = nativeCalls.find(([name]) => name === "personalMemoryRevokeSourceNative");
    assert.equal(revoke.reviewedFact.id, saved.id);
    assert.equal(revoke.messageId, message.id);
    assert.equal(revoke.expectedRevision, message.revision);
    await assertNoProvider();
    await core.command("close", {});
    core = open();
    view = inspector();
    await load(view);
    assert.match(view.textContent, /ChatGPT memory: Off.*Vela memory: Off/);
    assert.match(view.textContent, /No saved memories/);
    assert.equal((await core.command("openResource", selection)).status, "unavailable");
    await assertNoProvider();
  } finally {
    restoreDocument();
    try { await core?.command("close", {}); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});
