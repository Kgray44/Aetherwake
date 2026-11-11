const profiles = [
  ["balanced", "Balanced"],
  ["gaming_focus", "Foreground / Gaming"],
  ["max_throughput", "High Throughput"],
];
const reasons = {
  awaiting_native_sample: "Waiting for a resource sample",
  memory_unavailable: "Available RAM is unknown",
  safety_floor: "Local resources are below the safety floor",
  os_memory_pressure: "Windows reports low physical memory",
  windows_commit_pressure: "Low Windows commit headroom",
  foreground_protection: "Protecting foreground activity",
  external_desktop_activity: "Protecting recent desktop activity during contention",
  renderer_latency: "Protecting renderer responsiveness",
  power_protection: "Respecting battery power or a CPU speed limit",
  system_suspended: "System suspended",
  recovery_dwell: "Waiting for resource headroom to stabilize",
  cpu_conservative: "Conservative CPU admission",
  cpu_contention: "Sustained CPU load",
  disk_contention: "Disk contention",
  gpu_contention: "GPU contention",
  gpu_recovery_dwell: "Waiting for GPU headroom to stabilize",
  gpu_thermal_pressure: "GPU driver reports thermal slowdown",
  throughput_profile: "Throughput profile has headroom",
  balanced: "Balanced admission",
};
const originLabels = { default: "Default", host: "Host preset", user: "User-selected" };

function describe(view) {
  const profile = profiles.find(([mode]) => mode === view.mode)?.[1] ?? "Unknown";
  const source = originLabels[view.origin] ?? "Unknown source";
  const effective = view.effective;
  const estimate = view.dedicatedVramEstimate;
  const activity = view.externalDesktopActivity;
  const lowMemory = view.windowsLowMemory;
  const commit = view.windowsCommitHeadroom;
  const thermals = view.nvidiaGpuThermals;
  const detail = [
    `${source} profile: ${profile}`,
    reasons[view.reason] ?? "Waiting for policy evidence",
    `CPU worker limit: ${effective.cpu} effective, ${view.limits.cpu} configured`,
    `Other admission limits: build ${effective.build}, host I/O ${effective.host_io}, GPU ${effective.gpu}, remote requests ${effective.remote}`,
    `Estimated dedicated VRAM headroom: ${estimate ? `${(estimate.bytes / 2 ** 30).toFixed(2)} GiB (${Math.ceil(estimate.ageMs / 1000)} s old)` : "Unavailable"}`,
    `Supplemental Windows counters: ${!view.windowsCountersSupported ? "Unavailable" : view.windowsMonitoring ? "Enabled" : "Disabled"}`,
    `Windows low-memory notification: ${lowMemory ? `${lowMemory.active ? "Active" : "Clear"} (${Math.ceil(lowMemory.ageMs / 1000)} s old)` : "Unavailable"}`,
    `Windows commit headroom: ${commit ? `${(commit.bytes / 2 ** 30).toFixed(2)} GiB (${Math.ceil(commit.ageMs / 1000)} s old)` : "Unavailable"}`,
    `Other desktop activity protection (system idle time and Aerynth focus): ${view.externalActivityProtection ? "On" : "Off"}`,
  ];
  if (thermals) {
    const temperature = thermals.temperatureCelsius === null ? "temperature unavailable" : `${thermals.temperatureCelsius} °C`;
    const slowdown = thermals.slowdown === null ? "slowdown state unavailable" : thermals.slowdown ? "slowdown active" : "slowdown clear";
    detail.push(`NVIDIA GPU thermals: ${temperature}, ${slowdown} (${Math.ceil(thermals.ageMs / 1000)} s old)`);
  } else detail.push("NVIDIA GPU thermals: Unavailable");
  if (view.externalActivityProtection) detail.push(activity ?
    `Desktop activity sample: ${activity.active ? "Recent input with Aerynth unfocused" : "No recent input outside Aerynth"} (${Math.ceil(activity.ageMs / 1000)} s old)` :
    "Desktop activity sample: Unavailable");
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
  const runGpuDiagnostic = async () => {
    if (busy || !ready()) return;
    busy = true;
    try {
      const preview = await call("gpuReadbackNative", { name: "preview" });
      if (preview.kind !== "preview" || !ready()) return;
      const detail = `Workspace: ${preview.workspaceTitle}\nARIE reserves ${preview.vramBytes / 2 ** 20} MiB VRAM and ${preview.ramBytes / 2 ** 20} MiB RAM. The mission waits for available resources before copying and verifying the test buffers.`;
      const choice = await show({ type: "question", title: "GPU buffer diagnostic", message: "Run this diagnostic?",
        detail, buttons: ["Run Diagnostic", "Cancel"], defaultId: 1, cancelId: 1 });
      if (choice.response !== 0 || !ready()) return;
      if (!(await canWrite()) || !ready()) throw Error("storage_reserve_admission_denied");
      await call("gpuReadbackNative", { name: "start", reviewId: preview.reviewId });
      if (ready()) await show({ type: "info", title: "GPU buffer diagnostic", message: "Diagnostic queued",
        detail: "Follow the result in your workspace’s missions." });
    } catch (error) {
      const detail = error?.message === "gpu_readback_disabled" ? "Enable one GPU diagnostic worker in the Performance menu on Windows." :
        error?.message === "mission_workspace_required" ? "Open a workspace and try again." :
        error?.message === "gpu_readback_review_changed" ? "The workspace or resource policy changed. Review the diagnostic again." :
        error?.message === "storage_reserve_admission_denied" ? "The storage reserve prevented this diagnostic." :
        "The GPU diagnostic could not be queued.";
      if (ready()) await show({ type: "warning", title: "GPU buffer diagnostic", message: "Diagnostic unavailable", detail }).catch(() => {});
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
      { label: "Desktop Activity Protection…", click: choose("Protect other desktop activity during contention?", view =>
        [{ label: view.externalActivityProtection ? "Disable" : "Enable",
          request: { name: "set-external-activity-protection", enabled: !view.externalActivityProtection } }]) },
      { label: "GPU Diagnostic Limit…", click: choose("Set the local GPU diagnostic limit", view =>
        view.windowsCountersSupported ? [
          { label: "Off", request: { name: "set-gpu-limit", limit: 0 } },
          { label: "One Worker", request: { name: "set-gpu-limit", limit: 1 } },
        ] : []) },
      { label: "Run GPU Buffer Diagnostic…", click: runGpuDiagnostic },
      { type: "separator" },
      { label: "Undo Last Policy Change…", click: choose("Undo the last resource policy change", view =>
        view.canRollback ? [{ label: "Undo", request: { name: "rollback" } }] : []) },
      { label: "Restore Policy Defaults…", click: choose("Restore the default resource policy",
        () => [{ label: "Restore Defaults", request: { name: "restore-defaults" } }]) },
    ],
  };
};
