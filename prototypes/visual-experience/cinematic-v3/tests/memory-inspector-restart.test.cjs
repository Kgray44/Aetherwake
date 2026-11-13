const assert = require("node:assert/strict");
const test = require("node:test");
const { prepareMemoryInspectorRestart } = require("../native/memory-inspector-restart.cjs");

test("restart custody waits for clean worker exit and closes an unhanded descriptor on revocation", async () => {
  const close = Promise.withResolvers();
  const steps = [];
  let active = true, exited = false;
  const restart = { close: () => steps.push("cancel custody") };
  const options = {
    check() { if (!active) throw Error("slot_closed"); },
    worker: {
      close: () => close.promise,
      assertWorkerExited() { if (!exited) throw Error("clean_exit_required"); },
    },
    protector: {
      async prepareRestart(authority) {
        authority.check();
        authority.assertWorkerExited();
        steps.push("prepare custody");
        return restart;
      },
    },
  };
  const preparing = prepareMemoryInspectorRestart(options);
  await Promise.resolve();
  assert.deepEqual(steps, []);
  exited = true;
  close.resolve();
  assert.equal(await preparing, restart);
  assert.deepEqual(steps, ["prepare custody"]);
  await assert.rejects(prepareMemoryInspectorRestart({ ...options, worker: {
    ...options.worker, close: async () => { throw Error("worker_outcome_unresolved"); },
  } }), /worker_outcome_unresolved/u);
  exited = false;
  await assert.rejects(prepareMemoryInspectorRestart(options), /clean_exit_required/u);
  exited = true;
  await assert.rejects(prepareMemoryInspectorRestart({ ...options, protector: {
    async prepareRestart() { active = false; return restart; },
  } }), /slot_closed/u);
  assert.deepEqual(steps, ["prepare custody", "cancel custody"]);
});
