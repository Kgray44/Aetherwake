import assert from "node:assert/strict";
import { test } from "node:test";
import { createVelaObservationRefresh } from "../src/vela-observation-refresh.ts";

function setup(read = async () => {}) {
  let available = true;
  const reads = [];
  const errors = [];
  const callbacks = new Map();
  let token = 0;
  const refresh = createVelaObservationRefresh({
    available: () => available,
    read: () => {
      reads.push("read");
      return read();
    },
    failed: (error) => errors.push(error),
    timer: {
      set(callback, delay) {
        callbacks.set(++token, { callback, delay });
        return token;
      },
      clear(id) {
        callbacks.delete(id);
      },
    },
  });
  async function tick() {
    const [id, { callback }] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  return {
    refresh,
    callbacks,
    reads,
    errors,
    tick,
    hide: () => {
      available = false;
    },
  };
}

test("event bursts coalesce into one read and active observation polls once", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { refresh, callbacks, reads, tick } = setup(() => pending);
  refresh.request();
  refresh.request();
  refresh.observeActivity(true);
  assert.deepEqual(
    [...callbacks.values()].map(({ delay }) => delay),
    [150],
  );
  await tick();
  refresh.request();
  assert.deepEqual(reads, ["read"]);
  assert.equal(callbacks.size, 0);
  resolve();
  await pending;
  assert.deepEqual(
    [...callbacks.values()].map(({ delay }) => delay),
    [1000],
  );
  refresh.observeActivity(false);
  await tick();
  assert.equal(reads.length, 2);
  assert.equal(callbacks.size, 0);
});

test("hidden observations skip reads and permanent stop suppresses late failures", async () => {
  let reject;
  const pending = new Promise((_, fail) => {
    reject = fail;
  });
  const hidden = setup();
  hidden.refresh.request();
  hidden.hide();
  await hidden.tick();
  assert.equal(hidden.reads.length, 0);

  const current = setup(() => pending);
  current.refresh.observeActivity(true);
  await current.tick();
  current.refresh.stop();
  reject(new Error("backend disconnected"));
  await pending.catch(() => {});
  current.refresh.request();
  assert.deepEqual(current.errors, []);
  assert.equal(current.callbacks.size, 0);
});

test("a superseded observation schedules one follow-up without reporting failure", async () => {
  const { refresh, callbacks, errors, tick } = setup(async () => {
    throw new Error("vela_observation_superseded");
  });
  refresh.request();
  await tick();
  assert.deepEqual(
    [...callbacks.values()].map(({ delay }) => delay),
    [1000],
  );
  assert.deepEqual(errors, []);
  refresh.stop();
  assert.equal(callbacks.size, 0);
});
