import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BackendCore } from "../src/core.mts";
import type { CommandMap, ConversationSendPreview, ProviderPort } from "../src/contracts.mts";
const { conversationCommand } = createRequire(import.meta.url)("../../visual-experience/cinematic-v3/native/conversation-broker.cjs");

test("native confirmation shows the actual canonical assembled context and cancellation creates no grant, connection or user message", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-native-send-preview-"));
  const core = new BackendCore({ path: join(root, "canonical.sqlite"), privateRoot: root, cwd: root, provider: "codex", contentPolicy: "local-private" });
  let connections = 0;
  (core as unknown as { port: ProviderPort }).port.connect = async () => { connections++; throw new Error("Consent inspection must not connect"); };
  try {
    const parent = await core.command("createConversation", { title: "Synthetic native context review", providerId: "codex-app-server", commandId: randomUUID() });
    const origin = await core.command("addMessage", { resourceId: parent.resourceId, role: "user", content: "Synthetic shared origin", expectedRevision: 1 });
    const child = await core.command("branch", { resourceId: parent.resourceId, messageId: origin.id, includeMessageIds: [origin.id], providerId: "local", title: "Synthetic local finding", commandId: randomUUID(), tokenBudget: 32768 });
    const finding = await core.command("addMessage", { resourceId: child.conversation.resourceId, role: "user", content: "Synthetic selected finding: pressure is 12.", expectedRevision: 1 });
    await core.command("addMessage", { resourceId: child.conversation.resourceId, role: "user", content: "Synthetic omitted source content", expectedRevision: 2 });
    const share = await core.command("conversation", { name: "publish", input: { sourceResourceId: child.conversation.resourceId, sourceMessageId: finding.id, evidence: "reported" } }) as { id: string };
    await core.command("conversation", { name: "inspectShare", input: { resourceId: parent.resourceId, shareId: share.id } });
    await core.command("conversation", { name: "attachShare", input: { resourceId: parent.resourceId, shareId: share.id, attach: true } });
    const before = await core.command("snapshot", {}), calls: string[] = [];
    let shownPreview: ConversationSendPreview | undefined, reviews = 0;
    const content = "Answer this exact synthetic request.";
    await assert.rejects(conversationCommand({
      call: async (name: keyof CommandMap, input: any) => {
        calls.push(name);
        const result = await core.command(name, input);
        if (name === "conversationSendPreview") shownPreview = result as ConversationSendPreview;
        return result;
      },
      input: { name: "send", input: { resourceId: parent.resourceId, content, expectedRevision: 2, commandId: randomUUID(), grantId: "ignored-renderer-forgery" } },
      dialog: { showMessageBox: async (_window: unknown, options: { detail: string; defaultId: number; cancelId: number }) => {
        reviews++;
        assert.ok(shownPreview);
        assert.equal(shownPreview.prompt, content, "The ordinary prompt alone omits selected source context");
        assert.equal(shownPreview.context.length, 1);
        assert.ok(options.detail.endsWith(shownPreview.executionText), "Native review includes the complete actual assembled request");
        assert.match(options.detail, /pressure is 12/);
        assert.match(options.detail, new RegExp(finding.id));
        assert.doesNotMatch(options.detail, /omitted source content|ignored-renderer-forgery/);
        assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
        return { response: 0 };
      } },
    }), /authorization_cancelled/);
    assert.deepEqual(calls, ["desktop", "conversationSendPreview"]);
    assert.equal(reviews, 1); assert.equal(connections, 0);
    const after = await core.command("snapshot", {});
    assert.deepEqual(after.graph.messages, before.graph.messages);
    assert.deepEqual(after.executions, {}); assert.deepEqual(after.bindings, {});
    assert.equal((core as any).sendGrants.size, 0);
  } finally {
    await core.command("close", {});
    const target = resolve(root), part = relative(resolve(tmpdir()), target);
    assert.ok(part.startsWith("aerynth-native-send-preview-") && !part.startsWith("..") && !isAbsolute(part));
    rmSync(target, { recursive: true, force: true });
  }
});
