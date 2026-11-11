const assert = require("node:assert/strict");
const test = require("node:test");
const { resourcePolicyMenu } = require("../native/resource-policy-menu.cjs");

test("native resource controls submit only a confirmed versioned selection", async () => {
  const calls = [], dialogs = [];
  const current = {
    mode: "balanced", origin: "default", reason: "balanced", configVersion: 7, maxCpuWorkers: 3,
    windowsMonitoring: true, windowsCountersSupported: true, limits: { cpu: 3 },
    dedicatedVramEstimate: { bytes: 2 * 1024 ** 3, ageMs: 2200 },
    windowsLowMemory: { active: false, ageMs: 2000 },
    windowsCommitHeadroom: { bytes: 5 * 2 ** 30, ageMs: 1200 },
    remainingRamReservationBytes: 1.5 * 2 ** 30,
    lastTransition: { previousReason: "cpu_contention", reason: "balanced", observedAtUtc: "2026-11-11T08:19:00.000Z",
      checkpointRequests: { cpu: 1 } },
    nvidiaGpuThermals: { temperatureCelsius: 60.81, slowdown: false, ageMs: 280 },
    effective: { cpu: 2, build: 1, host_io: 3, gpu: 0, remote: 3 },
  };
  let response = 3, admitted = true;
  const menu = resourcePolicyMenu({
    call: async (command, input) => { calls.push([command, input]); return current; },
    show: async options => { dialogs.push(options); return { response }; },
    ready: () => true,
    canWrite: async () => admitted,
  });
  await menu.submenu[0].click();
  assert.deepEqual(calls, [["resourcePolicyNative", { name: "inspect" }]]);
  assert.match(dialogs[0].detail, /CPU worker limit: 2 effective, 3 configured/u);
  assert.match(dialogs[0].detail, /Estimated dedicated VRAM headroom: 2\.00 GiB \(3 s old\)/u);
  assert.match(dialogs[0].detail, /Windows low-memory notification: Clear \(2 s old\)/u);
  assert.match(dialogs[0].detail, /Windows commit headroom: 5\.00 GiB \(2 s old\)/u);
  assert.match(dialogs[0].detail, /RAM available for new reservations: 1\.50 GiB/u);
  assert.match(dialogs[0].detail, /Last effective change: Sustained CPU load → Balanced admission/u);
  assert.match(dialogs[0].detail, /Checkpoint requests at that change: 1/u);
  assert.match(dialogs[0].detail, /NVIDIA GPU thermals: 60\.81 °C, slowdown clear \(1 s old\)/u);
  assert.equal(dialogs[0].defaultId, dialogs[0].cancelId);
  response = 1;
  await menu.submenu[0].click();
  assert.deepEqual(calls.at(-1), ["resourcePolicyNative", { name: "set-mode", mode: "gaming_focus", expectedVersion: 7 }]);
  admitted = false;
  response = 0;
  await menu.submenu[1].click();
  assert.deepEqual(calls.at(-1), ["resourcePolicyNative", { name: "inspect" }]);
  assert.match(dialogs.at(-1).detail, /storage reserve/u);
  admitted = true;
  await menu.submenu.find(item => item.label === "Desktop Activity Protection…").click();
  assert.match(dialogs.at(-2).detail, /system idle time and Aerynth focus.*Off/u);
  assert.deepEqual(calls.at(-1), ["resourcePolicyNative", { name: "set-external-activity-protection", enabled: true, expectedVersion: 7 }]);
});

test("GPU diagnostic uses a native workspace review and submits only after confirmation", async () => {
  const calls = [], dialogs = [];
  let response = 1;
  const menu = resourcePolicyMenu({
    call: async (command, input) => {
      calls.push([command, input]);
      return input.name === "preview" ? { kind: "preview", reviewId: "review",
        workspaceTitle: "Synthetic workspace", ramBytes: 64 * 2 ** 20, vramBytes: 256 * 2 ** 20 } :
        { kind: "started", missionId: "mission" };
    },
    show: async options => { dialogs.push(options); return { response }; },
    ready: () => true,
    canWrite: async () => true,
  });
  const action = menu.submenu.find(item => item.label === "Run GPU Buffer Diagnostic…");
  await action.click();
  assert.deepEqual(calls, [["gpuReadbackNative", { name: "preview" }]]);
  assert.match(dialogs[0].detail, /Synthetic workspace.*256 MiB VRAM and 64 MiB RAM/su);
  response = 0;
  await action.click();
  assert.deepEqual(calls.at(-1), ["gpuReadbackNative", { name: "start", reviewId: "review" }]);
});
