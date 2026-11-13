const { createHash } = require("node:crypto");
const { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, writeFileSync } = require("node:fs");
const { basename, isAbsolute, join, resolve } = require("node:path");
const { createAdmission, desktopDirectory } = require("./native-test-admission.cjs");

const descriptorName = "synthetic-packaged.started";
const consumedName = "synthetic-packaged.consumed";
const digest = value => createHash("sha256").update(value).digest("hex");

function canonicalPath(path, kind) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path ||
      (kind === "directory" ? !lstatSync(path).isDirectory() : !lstatSync(path).isFile()))
    throw Error("native_memory_fixture_path_mismatch");
  return path;
}

function artifactDigest(path, check) {
  canonicalPath(path, "file");
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(256 * 1024);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1) throw Error("native_memory_fixture_artifact_invalid");
    let offset = 0;
    while (offset < before.size) {
      check();
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!bytes) throw Error("native_memory_fixture_artifact_changed");
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
    const after = lstatSync(path);
    if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw Error("native_memory_fixture_artifact_changed");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

// This entry is independent of Electron. The eventual fixture bootstrap must
// invoke it before importing startup code or configuring application storage.
function enterMemoryFixture({
  profileRoot, artifactPath, descriptorDigest, token, allowWrite,
  locateDesktop = desktopDirectory, openAdmission = createAdmission, now = Date.now, pid = process.pid,
}) {
  const directory = locateDesktop();
  if (!directory) throw Error("native_test_desktop_slot_requires_windows");
  const admission = openAdmission(directory);
  const permit = admission.checkPermit(token);
  const root = canonicalPath(profileRoot, "directory");
  if (!/^memory-witness-[a-z0-9-]+$/u.test(basename(root)))
    throw Error("native_memory_profile_mismatch");
  if (readdirSync(root).join("\n") !== descriptorName)
    throw Error("native_memory_fixture_profile_not_pending");
  const descriptorPath = canonicalPath(join(root, descriptorName), "file");
  const fd = openSync(descriptorPath, "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(8193);
    const size = readSync(fd, buffer);
    if (!size || size === buffer.length) throw Error("native_memory_fixture_descriptor_invalid");
    bytes = buffer.subarray(0, size);
  } finally {
    closeSync(fd);
  }
  if (digest(bytes) !== descriptorDigest) throw Error("native_memory_fixture_descriptor_invalid");
  const descriptor = JSON.parse(bytes.toString("utf8"));
  if (descriptor?.contract !== "aerynth.memory-fixture-descriptor@1" ||
      descriptor.profileRoot !== root || descriptor.artifactPath !== artifactPath ||
      descriptor.owner !== permit.owner || descriptor.availabilityId !== permit.availabilityId ||
      descriptor.permitDigest !== digest(permit.token) ||
      !Number.isSafeInteger(descriptor.expiresAt) || descriptor.expiresAt > permit.expiresAt ||
      descriptor.expiresAt > now() + 45_000 || descriptor.expiresAt <= now())
    throw Error("native_memory_fixture_descriptor_invalid");
  const lease = admission.claim(token, pid);
  const check = () => {
    lease.check();
    if (now() >= descriptor.expiresAt) throw Error("native_memory_fixture_descriptor_expired");
  };
  try {
    if (artifactDigest(artifactPath, check) !== descriptor.artifactDigest)
      throw Error("native_memory_fixture_artifact_changed");
    if (allowWrite?.() !== true) throw Error("storage_reserve_admission_denied");
    check();
    canonicalPath(root, "directory");
    if (readdirSync(root).join("\n") !== descriptorName)
      throw Error("native_memory_fixture_profile_not_pending");
    writeFileSync(join(root, consumedName), "", { flag: "wx", mode: 0o600 });
    check();
    return {
      backendDescriptor: Object.freeze({
        contract: "aerynth.memory-fixture-bootstrap@1",
        profileRoot: root,
        expiresAt: descriptor.expiresAt,
      }),
      check,
      release: lease.release,
    };
  } catch (error) {
    lease.release();
    throw error;
  }
}

module.exports = { artifactDigest, descriptorName, digest, enterMemoryFixture };
