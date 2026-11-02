import test from "node:test";
import assert from "node:assert/strict";
import { blockDocument } from "../../../block-library/tests/component-dom.mts";
import { until } from "../../../conversation-product/test/component-dom.mts";
import { mountProviderConnections } from "../src/provider-connections.ts";

// Mounted CPU event/DOM + synthetic native DTOs only. No account, network,
// OAuth, real catalog/model, browser layout or native acceptance is exercised.
const baseStatus = () => ({ contract: "aerynth.provider-connection@1", providerId: "chatgpt-plan-responses", billingRoute: "chatgpt-plan", state: "disconnected", storageAvailable: true, pending: false, registrationVersion: null, planUsageEnabled: false, inferenceVerified: false, nativeAccountHistory: false, nativeAccountMemory: false, nativeAccountSync: false });
const signedIn = () => ({ ...baseStatus(), state: "ready", registrationVersion: 4, planUsageEnabled: true });
const diagnostic = (overrides = {}) => ({ contract: "aerynth.model-catalog-diagnostic@1", outcome: "http-error", httpStatus: 403, serverRequestId: "req_fixture123", bodyShape: "error", remoteCode: "subscription_sharing_user_not_eligible", returnedCount: null, listedCount: null, observedAt: 1700000000000, ...overrides });
const catalogFailure = (overrides = {}) => ({ ...signedIn(), modelCatalog: { state: "unavailable", diagnostic: diagnostic(overrides) } });
const catalogReady = () => ({ ...signedIn(), modelCatalog: { state: "ready", diagnostic: diagnostic({ outcome: "accepted", httpStatus: 200, bodyShape: "models", remoteCode: null, returnedCount: 2, listedCount: 1 }) } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(command, changed = async () => {}) {
  const dom = blockDocument(), restore = dom.install(), calls = []; let chats = 0, codex = 0;
  const view = mountProviderConnections(dom.root, { command: async input => { calls.push(input); return command(input, calls.length); }, newConversation: async () => { chats++; }, codex: async () => { codex++; throw Error("not requested"); }, changed });
  return { dom, view, calls, action: name => dom.root.querySelector(`[data-connection-action="${name}"]`), status: () => dom.root.querySelector('[role="status"]').textContent, get chats() { return chats; }, get codex() { return codex; }, close() { view.dispose(); restore(); } };
}

test("successful sign-in followed by rejected model discovery keeps ready identity and reads safe diagnostic once without OAuth/session retry", async () => {
  let connected = false, modelsFailed = false, changed = 0;
  const f = fixture(async input => {
    if (input.type === "connect") { connected = true; return { ...baseStatus(), pending: true }; }
    if (input.type === "refreshModels") { modelsFailed = true; throw Error("PRIVATE remote body"); }
    assert.equal(input.type, "status"); return !connected ? baseStatus() : modelsFailed ? catalogFailure() : signedIn();
  }, async () => { changed++; });
  try {
    await f.view.ready; f.action("connect").onclick(); await until(() => !f.action("cancel").hidden); await f.view.refresh();
    assert.deepEqual(f.calls.map(c => c.type), ["status", "connect", "status", "refreshModels", "status"]);
    assert.equal(f.dom.root.dataset.connectionState, "ready"); assert.equal(f.action("connect").hidden, true); assert.equal(f.action("chat").disabled, true); assert.equal(changed, 1);
    assert.equal(f.status(), "Signed in. Model discovery was not permitted."); assert.equal(f.dom.root.textContent.includes("PRIVATE"), false); assert.equal(f.dom.root.textContent.includes("connection could not be completed"), false); assert.equal(f.chats, 0); assert.equal(f.codex, 0);
    const details = f.dom.root.querySelector(".connection-catalog-diagnostic"); assert.equal(details.open, false); assert.equal(details.hidden, false); details.open = true;
    assert.deepEqual(details.querySelectorAll("dd").map(n => n.textContent), ["403", "error", "subscription_sharing_user_not_eligible", "req_fixture123"]);
    for (const control of [...f.dom.root.querySelectorAll("button"), ...f.dom.root.querySelectorAll("summary")]) assert.equal(control.dataset.aerynthMotionControl, "true");
  } finally { f.close(); }
});

test("explicit refresh failure reports HTTP200 parse failure independently and never starts a passive model GET", async () => {
  let failed = false; const f = fixture(async input => { if (input.type === "refreshModels") { failed = true; throw Error("PRIVATE parse body"); } assert.equal(input.type, "status"); return failed ? catalogFailure({ outcome: "invalid-catalog", httpStatus: 200, bodyShape: "invalid-json", remoteCode: null }) : signedIn(); });
  try {
    await f.view.ready; assert.deepEqual(f.calls.map(c => c.type), ["status"]); assert.equal(f.status(), "Signed in. Models have not been checked."); assert.equal(f.action("chat").disabled, true);
    f.action("refreshModels").onclick(); f.action("refreshModels").onclick(); await until(() => f.status().includes("unsupported response")); await until(() => !f.action("refreshModels").disabled);
    assert.deepEqual(f.calls.map(c => c.type), ["status", "refreshModels", "status"]); assert.equal(f.dom.root.dataset.connectionState, "ready"); assert.equal(f.action("chat").disabled, true);
    assert.deepEqual(f.dom.root.querySelector(".connection-catalog-diagnostic").querySelectorAll("dd").map(n => n.textContent), ["200", "invalid-json", "req_fixture123"]);
  } finally { f.close(); }
});

test("the one discovery following explicit sign-in holds the busy guard through the actual catalog result", async () => {
  const pending = deferred(); let connected = false;
  const f = fixture(async input => { if (input.type === "connect") { connected = true; return { ...baseStatus(), pending: true }; } if (input.type === "refreshModels") return pending.promise; return connected ? signedIn() : baseStatus(); });
  try { await f.view.ready; f.action("connect").onclick(); await until(() => !f.action("cancel").hidden); const completion = f.view.refresh(); await until(() => f.calls.length === 4); assert.equal(f.action("refreshModels").disabled, true); f.action("refreshModels").onclick(); f.action("connect").onclick(); assert.equal(f.calls.length, 4); pending.resolve(catalogReady()); await completion; assert.equal(f.action("chat").disabled, false); assert.deepEqual(f.calls.map(c => c.type), ["status", "connect", "status", "refreshModels"]); }
  finally { pending.resolve(catalogReady()); f.close(); }
});

test("diagnostic disclosure is text-only and rejects arbitrary remote code, private URL/request and unknown body shape", async () => {
  const f = fixture(async () => catalogFailure({ bodyShape: "<img src=PRIVATE>", remoteCode: "PRIVATE arbitrary detail", serverRequestId: "https://PRIVATE.invalid" }));
  try { await f.view.ready; const details = f.dom.root.querySelector(".connection-catalog-diagnostic"); assert.deepEqual(details.querySelectorAll("dd").map(n => n.textContent), ["403", "unavailable"]); assert.equal(f.dom.root.textContent.includes("PRIVATE"), false); assert.equal(details.open, false); assert.equal(f.calls.length, 1); }
  finally { f.close(); }
});

test("New chat requires canonical ready catalog and rechecks local status without another model GET", async () => {
  const f = fixture(async input => { assert.equal(input.type, "status"); return catalogReady(); });
  try { await f.view.ready; assert.equal(f.action("chat").disabled, false); assert.equal(f.status(), "Signed in. Models are ready."); f.action("chat").onclick(); await until(() => f.chats === 1); assert.deepEqual(f.calls.map(c => c.type), ["status", "status"]); assert.equal(f.codex, 0); }
  finally { f.close(); }
  let calls = 0; const revoked = fixture(async () => ++calls === 1 ? catalogReady() : catalogFailure());
  try { await revoked.view.ready; revoked.action("chat").onclick(); await until(() => revoked.action("chat").disabled); await until(() => revoked.status().includes("not permitted")); assert.equal(revoked.chats, 0); assert.deepEqual(revoked.calls.map(c => c.type), ["status", "status"]); }
  finally { revoked.close(); }
});

test("legacy absent catalog never becomes ready merely because refreshModels resolved", async () => {
  const f = fixture(async () => signedIn());
  try { await f.view.ready; f.action("refreshModels").onclick(); await until(() => f.calls.length === 2 && !f.action("refreshModels").disabled); assert.equal(f.action("chat").disabled, true); f.action("chat").onclick(); assert.equal(f.calls.length, 2); assert.equal(f.chats, 0); assert.equal(f.dom.root.querySelector(".connection-catalog-diagnostic").hidden, true); }
  finally { f.close(); }
});

test("failed recovery read disables previously ready catalog until an actual later status reestablishes it", async () => {
  let statuses = 0; const f = fixture(async input => { if (input.type === "refreshModels") throw Error("synthetic catalog failure"); if (++statuses === 2) throw Error("synthetic status unavailable"); return catalogReady(); });
  try { await f.view.ready; f.action("refreshModels").onclick(); await until(() => !f.action("refreshModels").disabled); await until(() => f.status().includes("Model discovery could not")); assert.equal(f.action("chat").disabled, true); assert.equal(f.dom.root.dataset.modelCatalogState, "unconfirmed"); assert.equal(f.dom.root.querySelector(".connection-catalog-diagnostic").hidden, true); f.action("chat").onclick(); assert.equal(f.chats, 0); await f.view.refresh(); assert.equal(f.action("chat").disabled, false); assert.equal(f.status(), "Signed in. Models are ready."); }
  finally { f.close(); }
});

test("stale rejected status cannot overwrite a newer canonical ready result", async () => {
  const old = deferred(); const f = fixture(async (_input, count) => count === 1 ? old.promise : catalogReady());
  try { await f.view.refresh(); old.reject(Error("PRIVATE stale error")); await f.view.ready; assert.equal(f.status(), "Signed in. Models are ready."); assert.equal(f.action("chat").disabled, false); assert.equal(f.calls.length, 2); }
  finally { f.close(); }
});

test("stale catalog failure after a newer disconnection cannot restore old ready identity or fetch a recovery status", async () => {
  const pending = deferred(); const f = fixture(async (input, count) => input.type === "refreshModels" ? pending.promise : count === 1 ? signedIn() : baseStatus());
  try { await f.view.ready; f.action("refreshModels").onclick(); await f.view.refresh(); pending.reject(Error("PRIVATE old catalog failure")); await until(() => !f.action("connect").disabled); assert.equal(f.status(), "Not connected"); assert.equal(f.action("chat").hidden, true); assert.deepEqual(f.calls.map(c => c.type), ["status", "refreshModels", "status"]); }
  finally { f.close(); }
});

test("dispose fences late diagnostic recovery and prevents follow-up UI changes, notifications and New chat", async () => {
  const pending = deferred(); let statuses = 0, changed = 0; const f = fixture(async input => { if (input.type === "refreshModels") throw Error("synthetic catalog failure"); return ++statuses === 1 ? signedIn() : pending.promise; }, async () => { changed++; });
  try { await f.view.ready; f.action("refreshModels").onclick(); await until(() => f.calls.length === 3); f.view.dispose(); const text = f.dom.root.textContent; pending.resolve(catalogFailure()); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.dom.root.textContent, text); assert.equal(changed, 0); assert.equal(f.chats, 0); assert.equal(f.calls.length, 3); }
  finally { f.close(); }
});

test("host view-refresh failure cannot relabel a known model restriction as failed sign-in", async () => {
  let failed = false; const f = fixture(async input => { if (input.type === "refreshModels") { failed = true; throw Error("synthetic catalog failure"); } return failed ? catalogFailure() : signedIn(); }, async () => { throw Error("PRIVATE application refresh"); });
  try { await f.view.ready; f.action("refreshModels").onclick(); await until(() => f.status().includes("not permitted")); await until(() => !f.action("refreshModels").disabled); assert.equal(f.status(), "Signed in. Model discovery was not permitted."); assert.equal(f.action("connect").hidden, true); }
  finally { f.close(); }
});
