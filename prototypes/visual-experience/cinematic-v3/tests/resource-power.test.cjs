const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { observeResourcePower } = require("../native/resource-power.cjs");

test("native power events preserve the OS speed limit and invalidate it across sleep", () => {
  const monitor = new EventEmitter();
  monitor.isOnBatteryPower = () => true;
  monitor.getSystemIdleTime = () => 21;
  const observed = [];
  const observer = observeResourcePower(monitor, signal => observed.push(signal.hostPower));
  try {
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: 21, suspended: false, speedLimitPercent: null });
    monitor.emit("speed-limit-change", { limit: 75 });
    assert.equal(observed.at(-1).speedLimitPercent, 75);
    monitor.emit("suspend");
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: null, suspended: true, speedLimitPercent: null });
    monitor.emit("resume");
    assert.deepEqual(observed.at(-1), { battery: true, idleSeconds: 21, suspended: false, speedLimitPercent: null });
  } finally { observer.close(); }
  assert.equal(monitor.listenerCount("resume"), 0);
});

test("a focus transition sends the new focus and a freshly observed idle time together", () => {
  const monitor = new EventEmitter();
  let focused = true;
  let idle = 21;
  monitor.isOnBatteryPower = () => false;
  monitor.getSystemIdleTime = () => idle;
  const observed = [];
  const observer = observeResourcePower(monitor, signal => observed.push(signal.hostPower), () => focused);
  try {
    assert.equal(observed[0].aerynthFocused, true);
    assert.equal(observed[0].idleSeconds, 21);
    focused = false;
    idle = 0;
    observer.refreshFocus();
    observer.refreshFocus();
    assert.equal(observed.length, 2);
    assert.equal(observed[1].aerynthFocused, false);
    assert.equal(observed[1].idleSeconds, 0);
  } finally { observer.close(); }
});
