import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationDrafts } from "../src/conversation-drafts.ts";

test("placements share one canonical draft read and missing conversations cannot create a session", async () => {
  const checked = [];
  const calls = [];
  const drafts = createConversationDrafts({
    port: {
      command: async (name, { resourceId }) => {
        calls.push([name, resourceId]);
        assert.equal(name, "readDraft");
        return { resourceId, content: "", version: 0, updatedAt: null };
      },
    },
    available(id) {
      checked.push(id);
      return id === "conversation";
    },
    changed() {},
  });
  const first = drafts.get("conversation");
  assert.equal(drafts.get("conversation"), first);
  assert.throws(() => drafts.get("missing"), /conversation_unavailable/);
  await first.ready;
  assert.deepEqual(calls, [["readDraft", "conversation"]]);
  assert.deepEqual(checked, ["conversation", "missing"]);
  assert.equal(drafts.isClean(), true);
  assert.equal(drafts.hasPendingEdits(), false);
});

test("storage recovery reloads before saving and retains conflicting local input", async () => {
  const calls = [];
  let record = {
    resourceId: "conversation",
    content: "",
    version: 0,
    updatedAt: null,
  };
  const drafts = createConversationDrafts({
    port: {
      command: async (name) => {
        calls.push(name);
        if (name === "readDraft") return record;
        throw new Error("storage_reserve_admission_denied");
      },
    },
    available: () => true,
    changed() {},
  });
  const session = drafts.get(record.resourceId);
  await session.ready;
  session.update("local");
  await assert.rejects(drafts.flush(), /storage_reserve_admission_denied/);
  record = { ...record, version: 1, content: "remote" };
  await drafts.recoverStorage(assert.fail);
  assert.deepEqual(calls, ["readDraft", "saveDraft", "readDraft"]);
  assert.equal(session.snapshot().phase, "conflict");
  assert.equal(session.snapshot().content, "local");
  assert.equal(session.snapshot().remote.content, "remote");
  assert.equal(drafts.hasPendingEdits(), true);
});
