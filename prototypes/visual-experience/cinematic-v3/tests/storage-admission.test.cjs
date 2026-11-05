const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorageAdmission } = require("../native/storage-admission.cjs");

test("a failed reserve observation pauses writes, coalesces a demand check, and announces recovery", async () => {
  let resolveProbe, probes = 0, now = 1000;
  const transitions = [];
  const storage = createStorageAdmission({
    initiallyAdmitted: true,
    probe() { probes++; return new Promise((resolve) => { resolveProbe = resolve; }); },
    changed(value) { transitions.push(value); },
    now: () => now,
  });
  assert.equal(await storage.allowWrite(), true);
  const periodic = storage.recheck();
  const during = storage.allowWrite();
  await Promise.resolve();
  assert.equal(probes, 1);
  resolveProbe(false);
  assert.equal(await periodic, false);
  assert.equal(await during, false);
  const demand = storage.allowWrite(), second = storage.allowWrite();
  await Promise.resolve();
  assert.equal(probes, 2);
  resolveProbe(false);
  assert.equal(await demand, false);
  assert.equal(await second, false);
  assert.equal(await storage.allowWrite(), false);
  assert.equal(probes, 2);
  now += 15001;
  const recovery = storage.allowWrite();
  await Promise.resolve();
  resolveProbe(true);
  assert.equal(await recovery, true);
  assert.equal(await storage.allowWrite(), true);
  assert.deepEqual(transitions, [false, true]);
});

test("an unavailable guard remains fail closed", async () => {
  const changes = [];
  const storage = createStorageAdmission({
    initiallyAdmitted: true,
    probe() { throw Error("synthetic probe timeout"); },
    changed(value) { changes.push(value); },
  });
  assert.equal(await storage.recheck(), false);
  assert.equal(await storage.allowWrite(), false);
  assert.deepEqual(changes, [false]);
});
