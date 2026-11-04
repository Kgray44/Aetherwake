import test from "node:test";
import assert from "node:assert/strict";
import { componentDocument, until } from "../../../conversation-product/test/component-dom.mts";
import { mountWorkspaceRecovery } from "../src/workspace-recovery-view.ts";

const base = {
  workspaceId: "synthetic-room", title: "Synthetic current workspace", projectId: null,
  state: "active", version: 1, layoutVersion: 3, placementCount: 4, resourceCount: 3,
  creationEventId: "synthetic-creation-event", createdAt: "2026-11-04T03:00:00.000Z", scope: "preserve-current-content",
};
const current = (changes = {}) => ({ kind: "state", available: true, action: "undo-creation", ...base, ...changes });
const review = (changes = {}) => ({ kind: "preview", action: "undo-creation", ...base, previewId: "synthetic-preview",
  fingerprint: "a".repeat(64), expiresAt: "2026-11-04T03:04:00.000Z", ...changes });
const receipt = (input, changes = {}) => ({ kind: "receipt", action: "undo-creation", ...base,
  state: "archived", version: 2, commandId: input.commandId, appliedAt: "2026-11-04T03:02:00.000Z", replayed: false, ...changes });
const button = (root, action) => root.querySelector(`[data-recovery-action="${action}"]`);
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

test("mount prepares exact scope without writing; only the reviewed click applies and retired controls cannot dispatch", async () => {
  const { root } = componentDocument(), requests = [];
  const view = mountWorkspaceRecovery(root, base.workspaceId, async request => {
    requests.push(structuredClone(request));
    if (request.name === "state") return current();
    if (request.name === "preview") return review();
    return receipt(request.input);
  }, () => {});
  try {
    await view.ready;
    assert.deepEqual(requests, [
      { name: "state", input: { workspaceId: base.workspaceId } },
      { name: "preview", input: { workspaceId: base.workspaceId, action: "undo-creation",
        creationEventId: base.creationEventId, expectedVersion: base.version, expectedLayoutVersion: base.layoutVersion } },
    ]);
    assert.match(root.textContent, /Keep all current resources, layouts and history/);
    assert.match(root.textContent, /4 blocks · 3 referenced resources/);
    const apply = button(root, "apply"), oldReview = button(root, "review"), oldClose = button(root, "close");
    apply.onclick();
    await until(() => root.dataset.state === "applied");
    assert.equal(requests.length, 3);
    assert.equal(requests[2].name, "apply");
    assert.equal(requests[2].input.previewId, "synthetic-preview");
    assert.equal(requests[2].input.fingerprint, "a".repeat(64));
    assert.ok(requests[2].input.commandId);
    apply.onclick(); oldReview.onclick(); oldClose.onclick();
    assert.equal(requests.length, 3, "Detached prior controls must neither apply nor re-read state");
    assert.match(root.textContent, /Workspace archived\. Content and history retained/);
  } finally { view.dispose(); }
});

test("lost apply response exposes an explicit retry with the identical durable command, without automatic retry", async () => {
  const { root } = componentDocument(), requests = [];
  let attempts = 0;
  const view = mountWorkspaceRecovery(root, base.workspaceId, async request => {
    requests.push(structuredClone(request));
    if (request.name === "state") return current();
    if (request.name === "preview") return review();
    if (++attempts === 1) throw Error("synthetic lost response after commit");
    return receipt(request.input, { replayed: true });
  }, () => {});
  try {
    await view.ready;
    button(root, "apply").onclick();
    await until(() => root.dataset.state === "error");
    assert.equal(requests.length, 3);
    assert.equal(button(root, "apply").textContent, "Retry reviewed action");
    assert.match(root.textContent, /Retry the same reviewed action/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 3);
    button(root, "apply").onclick();
    await until(() => root.dataset.state === "applied");
    assert.deepEqual(requests[3], requests[2]);
    assert.match(root.textContent, /already recorded/);
  } finally { view.dispose(); }
});

test("an unavailable creation record displays no title or apply control and requests no preview", async () => {
  const { root } = componentDocument(), requests = [];
  const view = mountWorkspaceRecovery(root, base.workspaceId, async request => {
    requests.push(request);
    return { kind: "state", available: false, workspaceId: base.workspaceId, scope: "preserve-current-content",
      reason: "creation_record_missing", title: "Private title must not be projected" };
  }, () => {});
  try {
    await view.ready;
    assert.deepEqual(requests.map(request => request.name), ["state"]);
    assert.equal(button(root, "apply"), null);
    assert.match(root.textContent, /Creation recovery is unavailable/);
    assert.doesNotMatch(root.textContent, /Private title/);
  } finally { view.dispose(); }
});

test("closing during state resolution retires the view immediately and prevents a late preview or old-button action", async () => {
  const { root } = componentDocument(), pending = deferred(), requests = [];
  let closed = 0;
  const view = mountWorkspaceRecovery(root, base.workspaceId, request => {
    requests.push(request); return pending.promise;
  }, () => { closed++; });
  const close = button(root, "close");
  close.onclick();
  assert.equal(closed, 1);
  assert.equal(root.children.length, 0);
  pending.resolve(current());
  await view.ready;
  close.onclick();
  assert.equal(closed, 1);
  assert.equal(requests.length, 1);
  assert.equal(root.children.length, 0);
});

test("disposing pending preview and apply results cannot repopulate a replaced dialog or dispatch another request", async () => {
  for (const phase of ["preview", "apply"]) {
    const { root } = componentDocument(), pending = deferred(), requests = [];
    const view = mountWorkspaceRecovery(root, base.workspaceId, async request => {
      requests.push(request);
      if (request.name === phase) return pending.promise;
      return request.name === "state" ? current() : review();
    }, () => {});
    let oldApply;
    if (phase === "apply") {
      await view.ready;
      oldApply = button(root, "apply"); oldApply.onclick();
    } else await until(() => requests.length === 2);
    const count = requests.length;
    view.dispose();
    const replacement = root.ownerDocument.createElement("p"); replacement.textContent = "New dialog content";
    root.append(replacement);
    pending.resolve(phase === "preview" ? review() : receipt(requests.at(-1).input));
    await view.ready;
    await new Promise(resolve => setImmediate(resolve));
    oldApply?.onclick();
    assert.equal(requests.length, count);
    assert.equal(root.textContent, "New dialog content");
  }
});

test("restore requires a fresh state and preview after undo and a separate explicit apply click", async () => {
  const { root } = componentDocument(), requests = [];
  let archived = false;
  const view = mountWorkspaceRecovery(root, base.workspaceId, async request => {
    requests.push(structuredClone(request));
    const next = archived ? { action: "restore", state: "archived", version: 2 } : {};
    if (request.name === "state") return current(next);
    if (request.name === "preview") return review({ ...next, previewId: archived ? "restore-preview" : "synthetic-preview",
      fingerprint: (archived ? "b" : "a").repeat(64) });
    const result = receipt(request.input, archived ? { action: "restore", state: "active", version: 3 } : {});
    archived = !archived;
    return result;
  }, () => {});
  try {
    await view.ready;
    button(root, "apply").onclick();
    await until(() => root.dataset.state === "applied");
    button(root, "review").onclick();
    await until(() => root.dataset.state === "review");
    assert.deepEqual(requests.map(request => request.name), ["state", "preview", "apply", "state", "preview"]);
    assert.equal(requests[4].input.action, "restore");
    assert.equal(requests[4].input.expectedVersion, 2);
    assert.equal(button(root, "apply").textContent, "Restore workspace");
    button(root, "apply").onclick();
    await until(() => root.dataset.state === "applied");
    assert.equal(requests[5].input.previewId, "restore-preview");
    assert.notEqual(requests[5].input.commandId, requests[2].input.commandId);
    assert.match(root.textContent, /Workspace restored/);
  } finally { view.dispose(); }
});
