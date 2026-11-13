const { lstatSync, readFileSync, readdirSync, realpathSync } = require("node:fs");
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");
const { artifactDigest, digest } = require("./memory-fixture-entry.cjs");

const paths = Object.freeze({
  renderer: "renderer/memory-inspector.html",
  bundle: "renderer/memory-inspector.js",
  adapter: "prototypes/visual-experience/cinematic-v3/native/memory-inspector-electron-adapter.cjs",
  executable: "prototypes/visual-experience/cinematic-v3/native/memory-inspector-executable.cjs",
  startup: "prototypes/visual-experience/cinematic-v3/native/memory-inspector-fixture-startup.cjs",
  preload: "prototypes/visual-experience/cinematic-v3/native/desktop-preload.cjs",
  host: "prototypes/integrated-backend/src/desktop-host.mts",
  worker: "prototypes/integrated-backend/src/worker.mts",
  protector: "prototypes/integrated-backend/src/synthetic-memory-protector.mts",
  wire: "prototypes/integrated-backend/src/native-host.mts",
  node: "vendor/node.exe",
});
const manifestName = "memory-inspector-artifact.json";
const invalid = () => { throw Error("memory_fixture_artifact_unverified"); };

function resolveMemoryInspectorArtifact({ artifactPath, artifactSha256, profileRoot, check }) {
  check();
  const root = dirname(artifactPath);
  const fromArtifact = relative(root, profileRoot);
  if (!fromArtifact.startsWith(".." + sep) && !isAbsolute(fromArtifact)) invalid();
  if (artifactPath !== join(root, manifestName) || realpathSync(artifactPath) !== artifactPath) invalid();
  const manifestStat = lstatSync(artifactPath);
  if (!manifestStat.isFile() || manifestStat.nlink !== 1 || manifestStat.size > 1024 * 1024) invalid();
  const bytes = readFileSync(artifactPath);
  if (digest(bytes) !== artifactSha256) invalid();
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest?.contract !== "aerynth.memory-inspector-artifact@1" || !Array.isArray(manifest.files) ||
      manifest.files.length > 4096) invalid();
  const inventory = new Map();
  for (const item of manifest.files) {
    if (typeof item?.path !== "string" || item.path.length > 240 ||
        !item.path.split("/").every(part => /^[a-z0-9_.-]+$/iu.test(part) && part !== "." && part !== "..") ||
        inventory.has(item.path.toLowerCase()) || item.path.toLowerCase() === manifestName ||
        !/^[a-f0-9]{64}$/u.test(item.sha256 ?? "")) invalid();
    inventory.set(item.path.toLowerCase(), item);
  }
  for (const name of Object.values(paths)) if (inventory.get(name.toLowerCase())?.path !== name) invalid();
  let total = 0, entries = 0;
  function verifyDirectory(directory, prefix = "", depth = 0) {
    if (depth > 24) invalid();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      check();
      if (++entries > 8192) invalid();
      const name = prefix + entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (realpathSync(path) !== path) invalid();
        verifyDirectory(path, name + "/", depth + 1);
        continue;
      }
      if (!entry.isFile()) invalid();
      if (path === artifactPath) continue;
      const item = inventory.get(name.toLowerCase());
      if (item?.path !== name) invalid();
      const stat = lstatSync(path);
      total += stat.size;
      if (stat.nlink !== 1 || total > 1024 ** 3 || artifactDigest(path, check) !== item.sha256) invalid();
      inventory.delete(name.toLowerCase());
    }
  }
  verifyDirectory(root);
  if (inventory.size) invalid();
  return {
    rendererURL: pathToFileURL(resolve(root, paths.renderer)).href,
    entryPath: resolve(root, paths.executable),
    preloadPath: resolve(root, paths.preload),
    hostPath: resolve(root, paths.host),
    nodePath: resolve(root, paths.node),
    protectorPath: resolve(root, paths.protector),
    wirePath: resolve(root, paths.wire),
  };
}

module.exports = { resolveMemoryInspectorArtifact, paths, manifestName };
