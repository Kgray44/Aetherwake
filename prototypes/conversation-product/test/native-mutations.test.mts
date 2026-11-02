import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../../integrated-backend/src/core.mts";
import type { ProviderPort } from "../../integrated-backend/src/contracts.mts";
import {
  ConversationProduct,
  type CanonicalConversationHost,
} from "../src/service.mts";
import type { Detail } from "../src/contracts.ts";
import type { createCanonicalOrganizationAdapter } from "../src/canonical-host.mts";

test("trusted synchronous product mutations share public canonical behavior, preserve drafts and cannot be called by RPC method name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-product-native-mutations-"));
  const core = new BackendCore({
    path: join(dir, "canonical.sqlite"),
    privateRoot: dir,
    cwd: dir,
    provider: "codex",
    contentPolicy: "local-private",
  });
  let connections = 0;
  (core as unknown as { port: ProviderPort }).port.connect = async () => {
    connections++;
    throw new Error("Metadata mutation must not connect");
  };
  const owning = core as unknown as {
    db: DatabaseSync;
    conversations: ConversationProduct;
    conversationOrganization: ReturnType<
      typeof createCanonicalOrganizationAdapter
    >;
  };
  const product = owning.conversations,
    organize = owning.conversationOrganization;
  try {
    const created = await core.command("createConversation", {
        title: "Synthetic product metadata",
        providerId: "local",
        commandId: randomUUID(),
      }),
      resourceId = created.resourceId;
    const draft = await product.command("saveDraft", {
      resourceId,
      expectedVersion: 0,
      content: "Synthetic retained unsent text",
    });
    await product.command("favorite", { resourceId, favorite: true });
    assert.equal(
      (await product.command("detail", { resourceId })).conversation.favorite,
      true,
    );
    assert.equal(
      product.nativeFavorite({ resourceId, favorite: false }),
      false,
    );
    assert.equal(
      (await product.command("detail", { resourceId })).conversation.favorite,
      false,
    );
    assert.equal(
      owning.db
        .prepare(
          "SELECT count(*) AS count FROM cp_audit WHERE action='favorite' AND subject_id=?",
        )
        .get(resourceId)!.count,
      2,
    );
    const first = await product.command("detail", { resourceId });
    const pending = organize({
      type: "renameConversation",
      resourceId,
      title: "Synthetic public rename",
      expectedVersion: first.conversation.version,
      expectedRevision: first.conversation.revision,
    });
    assert.equal(typeof pending.then, "function");
    await pending;
    const second = await product.command("detail", { resourceId });
    assert.equal(second.conversation.title, "Synthetic public rename");
    const native = organize.native({
      type: "renameConversation",
      resourceId,
      title: "Synthetic trusted rename",
      expectedVersion: second.conversation.version,
      expectedRevision: second.conversation.revision,
    }) as Detail["conversation"];
    assert.notEqual(typeof (native as any)?.then, "function");
    assert.equal(
      (await product.command("detail", { resourceId })).conversation.title,
      "Synthetic trusted rename",
    );
    assert.deepEqual(await product.command("readDraft", { resourceId }), draft);
    await assert.rejects(
      core.command("conversation", {
        name: "nativeFavorite",
        input: { resourceId, favorite: true },
      } as any),
      /unsupported_product_command/,
    );
    await assert.rejects(
      core.command("conversation", {
        name: "native",
        input: {
          type: "renameConversation",
          resourceId,
          title: "Must not apply",
        },
      } as any),
      /unsupported_product_command/,
    );
    const host = (product as unknown as { host: CanonicalConversationHost })
        .host,
      access = host.access;
    host.access = () => false;
    try {
      assert.throws(
        () => product.nativeFavorite({ resourceId, favorite: true }),
        /source_unavailable/,
      );
    } finally {
      host.access = access;
    }
    assert.equal(
      (await product.command("detail", { resourceId })).conversation.favorite,
      false,
    );
    const snapshot = await core.command("desktop", { type: "snapshot" }),
      before = snapshot.resources.find((r) => r.id === resourceId)!;
    await core.command("desktop", {
      type: "archiveSubject",
      kind: "resource",
      id: resourceId,
      expectedVersion: before.version,
      archived: true,
    });
    assert.throws(
      () => product.nativeFavorite({ resourceId, favorite: true }),
      /source_unavailable/,
    );
    assert.equal(
      owning.db
        .prepare(
          "SELECT count(*) AS count FROM cp_audit WHERE action='favorite' AND subject_id=?",
        )
        .get(resourceId)!.count,
      2,
    );
    assert.equal(connections, 0);
    assert.deepEqual((await core.command("snapshot", {})).executions, {});
  } finally {
    await core.command("close", {});
    const target = resolve(dir),
      part = relative(resolve(tmpdir()), target);
    assert(
      part.startsWith("aerynth-product-native-mutations-") &&
        !part.startsWith("..") &&
        !isAbsolute(part),
    );
    rmSync(target, { recursive: true, force: true });
  }
});
