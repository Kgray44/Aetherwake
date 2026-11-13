const assert = require("node:assert/strict");
const test = require("node:test");
const { managePersonalMemory } = require("../native/personal-memory-management.cjs");

test("turning off ChatGPT memory requires current gesture and forwards only a version-bound disable", async () => {
  const calls = [];
  let active = false;
  const options = {
    input: { type: "disableProviderMemory", assistant: "ordinary", version: 3, enable: true },
    trustedFrame: () => true,
    observeGesture: () => active,
    allowWrite: () => true,
    call: async (command, request) => { calls.push([command, request]); return { ordinaryEnabled: false }; },
  };
  await assert.rejects(managePersonalMemory(options), /personal_memory_user_gesture_required/);
  assert.deepEqual(calls, []);
  active = true;
  assert.deepEqual(await managePersonalMemory(options), { ordinaryEnabled: false });
  await managePersonalMemory({ ...options, input: { ...options.input, assistant: "vela" } });
  await assert.rejects(managePersonalMemory({ ...options, input: { ...options.input, assistant: "foreign" } }), /invalid_privacy_policy/);
  assert.deepEqual(calls, [
    ["personalMemoryPolicyNative", { assistant: "ordinary", enable: false, expectedVersion: 3 }],
    ["personalMemoryPolicyNative", { assistant: "vela", enable: false, expectedVersion: 3 }],
  ]);
});

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
    chooseExport: async () => { calls.push("choose"); return "synthetic.json"; },
    writeExport: (path, value) => { assert.equal(path, "synthetic.json"); assert.equal(value, bundle); calls.push("write"); },
  });
  assert.deepEqual(result, { status: "exported" });
  assert.deepEqual(calls, ["preview", "choose", "commit", "write"]);
});

test("cancelled and stale export choices never write a file", async () => {
  for (const choose of [false, true]) {
    let version = 1;
    const calls = [];
    const operation = managePersonalMemory({
      input: { type: "manage", action: "export", id: "fact", version: 1 },
      trustedFrame: () => true, observeGesture: async () => true, allowWrite: async () => true,
      async call(_command, request) {
        calls.push(request.type);
        if (request.type === "preview") return { ticket: "private", version };
        if (request.type === "commit") {
          assert.notEqual(request.review.version, version);
          throw Error("stale_personal_context_version");
        }
      },
      confirm: async () => true,
      chooseExport: async () => { version++; return choose ? "synthetic.json" : null; },
      writeExport: () => assert.fail("No stale export should be written"),
    });
    if (choose) await assert.rejects(operation, /stale_personal_context_version/);
    else assert.deepEqual(await operation, { status: "cancelled" });
    assert.deepEqual(calls, choose ? ["preview", "commit", "cancel"] : ["preview", "cancel"]);
  }
});
