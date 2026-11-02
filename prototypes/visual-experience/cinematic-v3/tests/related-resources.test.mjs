import test from "node:test";
import assert from "node:assert/strict";
import { createRelatedResourcesPort } from "../src/related-resources.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const snapshot = { resources: [], relationships: [] };
const action = {
  type: "relate",
  sourceId: "note-a",
  targetId: "note-b",
  kind: "related_to",
};

test("a view closed behind the app queue cannot dispatch a read or graph mutation", async () => {
  const queue = deferred();
  let active = true,
    reads = 0,
    changes = 0,
    flushes = 0;
  const port = createRelatedResourcesPort({
    active: () => active,
    enqueue: async (run) => {
      await queue.promise;
      return run();
    },
    flush: async () => {
      flushes++;
    },
    read: async () => {
      reads++;
      return snapshot;
    },
    change: async () => {
      changes++;
      return snapshot;
    },
    openResource() {},
  });
  const read = port.read(),
    change = port.change(action);
  active = false;
  queue.resolve();
  await assert.rejects(read, /related_surface_unavailable/);
  await assert.rejects(change, /related_surface_unavailable/);
  assert.deepEqual([reads, changes, flushes], [0, 0, 0]);
});

test("closure during draft flush cancels a not-yet-dispatched graph mutation", async () => {
  const flush = deferred();
  let active = true,
    changes = 0;
  const port = createRelatedResourcesPort({
    active: () => active,
    enqueue: (run) => run(),
    flush: () => flush.promise,
    read: async () => snapshot,
    change: async () => {
      changes++;
      return snapshot;
    },
    openResource() {},
  });
  const pending = port.change(action);
  active = false;
  flush.resolve();
  await assert.rejects(pending, /related_surface_unavailable/);
  assert.equal(changes, 0);
});

test("native results remain authoritative after departure; unknown outcomes are not retried", async () => {
  const response = deferred(),
    calls = [];
  let active = true;
  const port = createRelatedResourcesPort({
    active: () => active,
    enqueue: (run) => run(),
    flush: async () => {},
    read: async () => snapshot,
    change: async (value) => {
      calls.push(value);
      active = false;
      return response.promise;
    },
    openResource() {},
  });
  const pending = port.change(action);
  await Promise.resolve();
  response.resolve(snapshot);
  assert.equal(await pending, snapshot);
  assert.deepEqual(calls, [action]);
  active = true;
  const failing = createRelatedResourcesPort({
    active: () => active,
    enqueue: (run) => run(),
    flush: async () => {},
    read: async () => snapshot,
    change: async (value) => {
      calls.push(value);
      throw Error("outcome_unknown");
    },
    openResource() {},
  });
  await assert.rejects(failing.change(action), /outcome_unknown/);
  assert.equal(calls.length, 2);
});

test("late metadata cannot repopulate a closed surface and reads never flush drafts", async () => {
  const response = deferred();
  let active = true,
    flushes = 0,
    opens = 0;
  const port = createRelatedResourcesPort({
    active: () => active,
    enqueue: (run) => run(),
    flush: async () => {
      flushes++;
    },
    read: () => response.promise,
    change: async () => snapshot,
    openResource: () => {
      opens++;
    },
  });
  const pending = port.read();
  active = false;
  response.resolve(snapshot);
  await assert.rejects(pending, /related_surface_unavailable/);
  assert.throws(
    () => port.openResource("note-a"),
    /related_surface_unavailable/,
  );
  assert.equal(flushes, 0);
  assert.equal(opens, 0);
});
