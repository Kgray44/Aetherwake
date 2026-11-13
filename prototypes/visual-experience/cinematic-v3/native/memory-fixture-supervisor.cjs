const { lstatSync, readdirSync, realpathSync, writeFileSync } = require("node:fs");
const { basename, isAbsolute, join, resolve } = require("node:path");
const { createAdmission, desktopDirectory } = require("./native-test-admission.cjs");

// The fixture host must supply its own launcher and claim the canonical lease.
// There is deliberately no executable, CLI, or inherited child environment here.
function superviseMemoryFixture({
  allocation, profileRoot, token, allowWrite, startFixture,
  locateDesktop = desktopDirectory, openAdmission = createAdmission, now = Date.now,
}) {
  const directory = locateDesktop();
  if (!directory) throw Error("native_test_desktop_slot_requires_windows");
  const admission = openAdmission(directory);
  const check = () => {
    const permit = admission.checkPermit(token);
    if (admission.status().lease) throw Error("native_test_desktop_slot_busy");
    const time = now();
    if (allocation?.contract !== "aerynth.memory-fixture-allocation@1" ||
        allocation.owner !== permit.owner || allocation.availabilityId !== permit.availabilityId || allocation.token !== permit.token ||
        !Number.isSafeInteger(allocation.expiresAt) || allocation.expiresAt <= time ||
        allocation.expiresAt > Math.min(time + 45_000, permit.expiresAt))
      throw Error("native_memory_fixture_allocation_invalid");
  };
  check();
  if (typeof profileRoot !== "string" || !isAbsolute(profileRoot) ||
      allocation.profileRoot !== profileRoot || resolve(profileRoot) !== profileRoot ||
      !/^memory-witness-[a-z0-9-]+$/u.test(basename(profileRoot)))
    throw Error("native_memory_profile_mismatch");
  const requireFreshProfile = () => {
    const stat = lstatSync(profileRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(profileRoot) !== profileRoot)
      throw Error("native_memory_profile_mismatch");
    if (readdirSync(profileRoot).length !== 0) throw Error("native_memory_profile_not_fresh");
  };
  requireFreshProfile();
  if (typeof startFixture !== "function") throw Error("native_memory_fixture_host_unavailable");
  if (allowWrite?.() !== true) throw Error("storage_reserve_admission_denied");
  check();
  requireFreshProfile();
  // Once handed off, retain the marker even when the outcome is uncertain.
  writeFileSync(join(profileRoot, "synthetic-packaged.started"), "", { flag: "wx", mode: 0o600 });
  check();
  return startFixture({
    profileRoot,
    expiresAt: allocation.expiresAt,
    env: { AERYNTH_NATIVE_TEST_SLOT: token },
  });
}

module.exports = { superviseMemoryFixture };
