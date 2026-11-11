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
  renderer_latency: "Protecting renderer responsiveness",
  power_protection: "Respecting battery power or a CPU speed limit",
  system_suspended: "System suspended",
  recovery_dwell: "Waiting for resource headroom to stabilize",
  cpu_conservative: "Conservative CPU admission",
  disk_contention: "Disk contention",
  gpu_contention: "GPU contention",
  throughput_profile: "Throughput profile has headroom",
  balanced: "Balanced admission",
};
const originLabels = { default: "Default", host: "Host preset", user: "User-selected" };

function describe(view) {
  const profile = profiles.find(([mode]) => mode === view.mode)?.[1] ?? "Unknown";
  const source = originLabels[view.origin] ?? "Unknown source";
  const effective = view.effective;
  const estimate = view.dedicatedVramEstimate;
  const detail = [
    `${source} profile: ${profile}`,
    reasons[view.reason] ?? "Waiting for policy evidence",
    `CPU worker limit: ${effective.cpu} effective, ${view.limits.cpu} configured`,
    `Other admission limits: build ${effective.build}, host I/O ${effective.host_io}, GPU ${effective.gpu}, remote requests ${effective.remote}`,
    `Estimated dedicated VRAM headroom: ${estimate ? `${(estimate.bytes / 2 ** 30).toFixed(2)} GiB (${Math.ceil(estimate.ageMs / 1000)} s old)` : "Unavailable"}`,
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
