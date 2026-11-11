const assert = require("node:assert/strict");
const test = require("node:test");
const { resourcePolicyMenu } = require("../native/resource-policy-menu.cjs");

test("native resource controls submit only a confirmed versioned selection", async () => {
  const calls = [], dialogs = [];
  const current = {
    mode: "balanced", origin: "default", reason: "balanced", configVersion: 7, maxCpuWorkers: 3,
    windowsMonitoring: true, windowsCountersSupported: true, limits: { cpu: 3 },
    dedicatedVramEstimate: { bytes: 2 * 1024 ** 3, ageMs: 2200 },
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
  assert.equal(dialogs[0].defaultId, dialogs[0].cancelId);
  response = 1;
  await menu.submenu[0].click();
  assert.deepEqual(calls.at(-1), ["resourcePolicyNative", { name: "set-mode", mode: "gaming_focus", expectedVersion: 7 }]);
  admitted = false;
  response = 0;
  await menu.submenu[1].click();
  assert.deepEqual(calls.at(-1), ["resourcePolicyNative", { name: "inspect" }]);
  assert.match(dialogs.at(-1).detail, /storage reserve/u);
});
