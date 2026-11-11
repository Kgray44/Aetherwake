/** Publishes coarse OS state from Electron's main process. */
exports.observeResourcePower = function observeResourcePower(powerMonitor, send) {
  let suspended = false;
  let speedLimitPercent = null;
  const read = (fn) => { try { return fn(); } catch { return null; } };
  const publish = () => {
    const battery = read(() => powerMonitor.isOnBatteryPower());
    const idle = suspended ? null : read(() => powerMonitor.getSystemIdleTime());
    send({ hostPower: { suspended, battery: typeof battery === "boolean" ? battery : null,
      idleSeconds: Number.isSafeInteger(idle) && idle >= 0 && idle < 2 ** 31 ? idle : null, speedLimitPercent } });
  };
  const suspend = () => { suspended = true; speedLimitPercent = null; publish(); };
  const resume = () => { suspended = false; publish(); };
  const onSpeedLimit = ({ limit }) => {
    if (!suspended && Number.isFinite(limit) && limit >= 0 && limit <= 100) {
      speedLimitPercent = limit;
      publish();
    }
  };
  const listeners = [["suspend", suspend], ["resume", resume], ["on-ac", publish], ["on-battery", publish],
    ["speed-limit-change", onSpeedLimit]];
  for (const [event, listener] of listeners) powerMonitor.on(event, listener);
  publish();
  const timer = setInterval(() => { if (!suspended) publish(); }, 5000).unref();
  return () => {
    clearInterval(timer);
    for (const [event, listener] of listeners) powerMonitor.off(event, listener);
  };
};
