const assert = require("node:assert/strict");
const test = require("node:test");
const { managePersonalMemory } = require("../native/personal-memory-management.cjs");

test("read results are withheld after frame retirement and private management verbs cannot route", async () => {
  let current = true;
  const calls = [];
  const options = { trustedFrame: () => current, call: async (name, input) => {
    calls.push([name, input]);
    current = false;
    return { text: "synthetic private memory" };
  } };
  for (const type of ["commit", "preview", "cancel", "previewSourceRevocation"])
    await assert.rejects(managePersonalMemory({ ...options, input: { type } }), /invalid_personal_memory_management/);
  await assert.rejects(managePersonalMemory({ ...options, input: { type: "read", id: "fact" } }), /personal_memory_frame_changed/);
  assert.deepEqual(calls, [["personalMemoryManagementNative", { type: "read", id: "fact" }]]);
});

test("correction reviews and commits the exact canonical search terms", async () => {
  const request = { action: "correct", id: "fact", version: 2, text: "New synthetic text", keywords: ["new term"] };
  const review = { ...request, ticket: "native-only" };
  const result = await managePersonalMemory({
    input: { type: "manage", ...request, ticket: "forged" }, trustedFrame: () => true,
    observeGesture: () => true, allowWrite: () => true,
    confirm: async value => { assert.equal(value, review); return true; },
    call: async (name, value) => {
      assert.equal(name, "personalMemoryManagementNative");
      if (value.type === "preview") { assert.deepEqual(value.request, request); return review; }
      assert.deepEqual(value, { type: "commit", review });
      return { action: "correct", id: "fact" };
    },
  });
  assert.deepEqual(result, { status: "applied", id: "fact" });
});

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

test("provider memory opt-in requires native consent and a current version, frame and write admission", async () => {
  for (const outcome of ["ordinary", "vela", "cancelled", "stale", "storage off", "frame", "reserve", "changed during review", "lost result"]) {
    const assistant = outcome === "ordinary" ? "ordinary" : "vela";
    const calls = [];
    let current = true;
    let writesAllowed = true;
    let confirmed = false;
    const policy = { version: outcome === "stale" ? 4 : 3, storageEnabled: outcome !== "storage off" };
    const operation = managePersonalMemory({
      input: { type: "enableProviderMemory", assistant, version: 3, confirmed: true },
      trustedFrame: () => current,
      observeGesture: () => true,
      allowWrite: () => writesAllowed,
      async confirm(review) {
        assert.deepEqual(review, { action: "enableProviderMemory", assistant });
        confirmed = true;
        if (outcome === "frame") current = false;
        if (outcome === "reserve") writesAllowed = false;
        return outcome !== "cancelled";
      },
      async call(command, request) {
        assert.equal(command, "personalMemoryPolicyNative");
        calls.push(request);
        if (calls.length === 1) return policy;
        assert.equal(confirmed, true);
        if (outcome === "changed during review") throw Error("stale_personal_context_version");
        if (outcome === "lost result") current = false;
        return { ...policy, version: 4, [assistant === "ordinary" ? "ordinaryEnabled" : "velaEnabled"]: true };
      },
    });
    const errors = {
      stale: /stale_personal_context_version/, "storage off": /personal_storage_disabled/,
      frame: /personal_memory_frame_changed/, reserve: /storage_reserve_admission_denied/,
      "changed during review": /stale_personal_context_version/, "lost result": /personal_memory_frame_changed/,
    };
    if (errors[outcome]) await assert.rejects(operation, errors[outcome]);
    else if (outcome === "cancelled") assert.deepEqual(await operation, { status: "cancelled" });
    else assert.equal((await operation).version, 4);
    const attemptedWrite = ["ordinary", "vela", "changed during review", "lost result"].includes(outcome);
    assert.deepEqual(calls, attemptedWrite ? [{}, { assistant, enable: true, expectedVersion: 3 }] : [{}], outcome);
    assert.equal(confirmed, !["stale", "storage off"].includes(outcome));
  }
});

test("source revocation only commits the native binding after confirmation and renewed admission", async () => {
  const binding = { conversationId: "chat", messageId: "message", expectedRevision: 7, reviewedFact: { id: "fact", version: 3 } };
  for (const outcome of ["apply", "cancel", "frame", "reserve", "gesture", "stale", "changed source", "unbound", "changed fact binding"]) {
    const calls = [];
    let current = true;
    let storageAllowed = true;
    const operation = managePersonalMemory({
      input: { type: "revokeSource", id: "fact", version: 3, messageId: "forged" },
      trustedFrame: () => current,
      observeGesture: () => outcome !== "gesture",
      allowWrite: () => storageAllowed,
      async call(command, request) {
        calls.push([command, request]);
        if (calls.length === 2 && outcome === "stale") throw Error("stale_personal_context_version");
        if (calls.length === 2 && outcome === "changed source") return { binding: { ...binding, expectedRevision: 8 }, sourceText: "Synthetic original" };
        if (outcome === "unbound") return { binding: { ...binding, reviewedFact: undefined }, sourceText: "Synthetic original" };
        if (calls.length === 2 && outcome === "changed fact binding")
          return { binding: { ...binding, reviewedFact: { id: "other", version: 3 } }, sourceText: "Synthetic original" };
        return request.type === "previewSourceRevocation"
          ? { binding, sourceText: "Synthetic original" }
          : { erasedFacts: 2 };
      },
      async confirm(review) {
        assert.notEqual(outcome, "unbound");
        assert.deepEqual(review, { action: "revokeSource", sourceText: "Synthetic original", binding, id: "fact", version: 3 });
        current = outcome !== "frame";
        storageAllowed = outcome !== "reserve";
        return outcome !== "cancel";
      },
    });
    if (outcome === "apply") assert.deepEqual(await operation, { status: "applied", erasedFacts: 2 });
    if (outcome === "cancel") assert.deepEqual(await operation, { status: "cancelled" });
    if (outcome === "frame") await assert.rejects(operation, /personal_memory_frame_changed/);
    if (outcome === "reserve") await assert.rejects(operation, /storage_reserve_admission_denied/);
    if (outcome === "gesture") await assert.rejects(operation, /personal_memory_user_gesture_required/);
    if (outcome === "stale") await assert.rejects(operation, /stale_personal_context_version/);
    if (["changed source", "unbound", "changed fact binding"].includes(outcome)) await assert.rejects(operation, /personal_memory_review_mismatch/);
    const expected = outcome === "gesture" ? [] : [
      ["personalMemoryManagementNative", { type: "previewSourceRevocation", id: "fact", version: 3 }],
    ];
    if (["apply", "stale", "changed source", "changed fact binding"].includes(outcome)) expected.push(expected[0]);
    if (outcome === "apply") expected.push(["personalMemoryRevokeSourceNative", binding]);
    assert.deepEqual(calls, expected);
  }
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
