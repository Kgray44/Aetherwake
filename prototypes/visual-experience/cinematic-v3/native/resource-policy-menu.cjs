const profiles = [
  ["balanced", "Balanced"],
  ["gaming_focus", "Foreground / Gaming"],
  ["max_throughput", "High Throughput"],
];
const reasons = {
  awaiting_native_sample: "Waiting for a resource sample",
  memory_unavailable: "Available RAM is unknown",
  safety_floor: "Local resources are below the safety floor",
  foreground_protection: "Protecting foreground activity",
  recovery_dwell: "Waiting for resource headroom to stabilize",
  cpu_conservative: "Conservative CPU admission",
  disk_contention: "Disk contention",
  throughput_profile: "Throughput profile has headroom",
  balanced: "Balanced admission",
};
const originLabels = { default: "Default", host: "Host preset", user: "User-selected" };

function describe(view) {
  const profile = profiles.find(([mode]) => mode === view.mode)?.[1] ?? "Unknown";
  const source = originLabels[view.origin] ?? "Unknown source";
  const effective = view.effective;
  const detail = [
    `${source} profile: ${profile}`,
    reasons[view.reason] ?? "Waiting for policy evidence",
    `CPU worker limit: ${effective.cpu} effective, ${view.limits.cpu} configured`,
    `Other admission limits: build ${effective.build}, host I/O ${effective.host_io}, GPU ${effective.gpu}, remote requests ${effective.remote}`,
    `Supplemental Windows counters: ${!view.windowsCountersSupported ? "Unavailable" : view.windowsMonitoring ? "Enabled" : "Disabled"}`,
  ];
  if (view.configurationHealth === "fallback") detail.push("Saved preferences were invalid. Safe settings are active.");
  return detail.join("\n");
}

exports.resourcePolicyMenu = function resourcePolicyMenu({ call, show, ready, canWrite }) {
  let busy = false;
  const request = input => call("resourcePolicyNative", input);
  const choose = (message, options) => async () => {
    if (busy || !ready()) return;
    busy = true;
    try {
      const before = await request({ name: "inspect" });
      const choices = options(before);
      const cancelId = choices.length;
      const { response } = await show({
        type: "question", title: "Resource policy", message, detail: describe(before),
        buttons: [...choices.map(choice => choice.label), "Cancel"], cancelId, defaultId: cancelId,
      });
      const choice = choices[response];
      if (!choice || !ready()) return;
      if (!(await canWrite()) || !ready()) throw Error("storage_reserve_admission_denied");
      const after = await request({ ...choice.request, expectedVersion: before.configVersion });
      if (ready()) await show({ type: "info", title: "Resource policy", message: "Resource policy saved", detail: describe(after) });
    } catch (error) {
      const detail = error?.message === "stale_resource_policy" ? "The policy changed. Reopen this control to review its current settings." :
        error?.message === "storage_reserve_admission_denied" ? "The storage reserve prevented this change." :
        "The resource policy could not be read or saved.";
      if (ready()) await show({ type: "warning", title: "Resource policy", message: "Resource policy unavailable", detail }).catch(() => {});
    } finally { busy = false; }
  };
  return {
    label: "Performance",
    submenu: [
      { label: "Resource Profile…", click: choose("Choose a resource profile",
        () => profiles.map(([mode, label]) => ({ label, request: { name: "set-mode", mode } }))) },
      { label: "CPU Worker Limit…", click: choose("Set the maximum local CPU workers", view =>
        Array.from({ length: view.maxCpuWorkers + 1 }, (_, limit) =>
          ({ label: String(limit), request: { name: "set-cpu-limit", limit } }))) },
      { label: "Supplemental Windows Counters…", click: choose("Control supplemental Windows counters", view =>
        view.windowsCountersSupported ? [{ label: view.windowsMonitoring ? "Disable" : "Enable",
          request: { name: "set-windows-monitoring", enabled: !view.windowsMonitoring } }] : []) },
      { type: "separator" },
      { label: "Undo Last Policy Change…", click: choose("Undo the last resource policy change", view =>
        view.canRollback ? [{ label: "Undo", request: { name: "rollback" } }] : []) },
      { label: "Restore Policy Defaults…", click: choose("Restore the default resource policy",
        () => [{ label: "Restore Defaults", request: { name: "restore-defaults" } }]) },
    ],
  };
};
