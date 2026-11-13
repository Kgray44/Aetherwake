const assert = require("node:assert/strict");
const test = require("node:test");
const { managePersonalMemory } = require("../native/personal-memory-management.cjs");

test("management keeps review private and cancels after frame loss", async () => {
  const calls = [];
  let current = true;
  const options = {
    input: { type: "manage", action: "delete", id: "fact", version: 1, review: "forged" },
    trustedFrame: () => current,
    observeGesture: async () => true,
    allowWrite: async () => true,
    call: async (command, request) => {
      assert.equal(command, "personalMemoryManagementNative");
      calls.push(request);
      return { ticket: "private" };
    },
    confirm: async () => { current = false; return true; },
  };
  await assert.rejects(managePersonalMemory(options), /personal_memory_frame_changed/);
  assert.deepEqual(calls, [
    { type: "preview", request: { action: "delete", id: "fact", version: 1 } },
    { type: "cancel", ticket: "private" },
  ]);
});

test("an export bundle stays in the native save flow", async () => {
  const bundle = { records: ["synthetic"] };
  const calls = [];
  const result = await managePersonalMemory({
    input: { type: "manage", action: "export", id: "fact", version: 1 },
    trustedFrame: () => true, observeGesture: async () => true, allowWrite: async () => true,
    call: async (_command, request) => {
      calls.push(request.type);
      return request.type === "preview" ? { ticket: "review" } : { action: "export", bundle };
    },
    confirm: async () => true,
    saveExport: async value => { assert.equal(value, bundle); return true; },
  });
  assert.deepEqual(result, { status: "exported" });
  assert.deepEqual(calls, ["preview", "commit"]);
});
