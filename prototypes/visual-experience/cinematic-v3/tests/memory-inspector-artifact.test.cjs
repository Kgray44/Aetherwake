const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const test = require("node:test");
const { digest } = require("../native/memory-fixture-entry.cjs");
const { manifestName, paths, resolveMemoryInspectorArtifact } = require("../native/memory-inspector-artifact.cjs");

test("acceptance artifact verifies exact inventory and refuses mutations, missing files and extra files", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-artifact-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifact");
  const profileRoot = join(root, "memory-witness-stub");
  const dependency = "prototypes/integrated-backend/src/service.mts";
  const inventory = [...Object.values(paths), dependency].map(path => ({ path, sha256: digest(path) }));
  for (const { path } of inventory) {
    const target = join(artifactRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path);
  }
  const artifactPath = join(artifactRoot, manifestName);
  const manifest = JSON.stringify({ contract: "aerynth.memory-inspector-artifact@1", files: inventory });
  writeFileSync(artifactPath, manifest);
  const input = { artifactPath, artifactSha256: digest(manifest), profileRoot, check() {} };
  assert.equal(resolveMemoryInspectorArtifact(input).hostPath, join(artifactRoot, paths.host));
  writeFileSync(join(artifactRoot, dependency), "mutation");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  writeFileSync(join(artifactRoot, dependency), dependency);
  writeFileSync(join(artifactRoot, "extra.js"), "");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  rmSync(join(artifactRoot, "extra.js"));
  rmSync(join(artifactRoot, paths.bundle));
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  writeFileSync(artifactPath, manifest + "\n");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
});
