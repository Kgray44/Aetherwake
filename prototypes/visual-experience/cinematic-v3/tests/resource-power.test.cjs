const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { observeResourcePower } = require("../native/resource-power.cjs");

test("native power events preserve the OS speed limit and invalidate it across sleep", () => {
  const monitor = new EventEmitter();
  monitor.isOnBatteryPower = () => true;
  monitor.getSystemIdleTime = () => 21;
  const observed = [];
  const stop = observeResourcePower(monitor, signal => observed.push(signal.hostPower));
  try {
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: 21, suspended: false, speedLimitPercent: null });
    monitor.emit("speed-limit-change", { limit: 75 });
    assert.equal(observed.at(-1).speedLimitPercent, 75);
    monitor.emit("suspend");
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: null, suspended: true, speedLimitPercent: null });
    monitor.emit("resume");
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: 21, suspended: false, speedLimitPercent: null });
  } finally { stop(); }
  assert.equal(monitor.listenerCount("resume"), 0);
});
