/** Publishes coarse OS state from Electron's main process. */
exports.observeResourcePower = function observeResourcePower(powerMonitor, send, readFocus = () => null) {
  let suspended = false;
  let speedLimitPercent = null;
  let previousFocus;
  const read = (fn) => { try { return fn(); } catch { return null; } };
  const publish = (focus = read(readFocus)) => {
    const battery = read(() => powerMonitor.isOnBatteryPower());
    const idle = suspended ? null : read(() => powerMonitor.getSystemIdleTime());
    previousFocus = focus;
    send({ hostPower: { suspended, battery: typeof battery === "boolean" ? battery : null,
      idleSeconds: Number.isSafeInteger(idle) && idle >= 0 && idle < 2 ** 31 ? idle : null, speedLimitPercent,
      ...(typeof focus === "boolean" ? { aerynthFocused: focus } : {}) } });
  };
  const onPowerChange = () => publish();
  const suspend = () => { suspended = true; speedLimitPercent = null; publish(); };
  const resume = () => { suspended = false; publish(); };
  const onSpeedLimit = ({ limit }) => {
    if (!suspended && Number.isFinite(limit) && limit >= 0 && limit <= 100) {
      speedLimitPercent = limit;
      publish();
    }
  };
  const listeners = [["suspend", suspend], ["resume", resume], ["on-ac", onPowerChange], ["on-battery", onPowerChange],
    ["speed-limit-change", onSpeedLimit]];
  for (const [event, listener] of listeners) powerMonitor.on(event, listener);
  publish();
  const timer = setInterval(() => { if (!suspended) publish(); }, 2000).unref();
  return {
    refreshFocus() {
      const focus = read(readFocus);
      if (typeof focus === "boolean" && focus !== previousFocus) publish(focus);
    },
    close() {
      clearInterval(timer);
      for (const [event, listener] of listeners) powerMonitor.off(event, listener);
    },
  };
};
