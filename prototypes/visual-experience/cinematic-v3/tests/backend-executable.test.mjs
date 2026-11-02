import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const { backendExecutable } = createRequire(import.meta.url)(
  "../native/backend-executable.cjs",
);
test("development uses installed Node; a portable native bootstrap can select an existing absolute runtime", () => {
  assert.equal(backendExecutable(undefined), "node");
  const folder = mkdtempSync(join(tmpdir(), "aerynth-node-path-"));
  const executable = join(folder, "node.exe");
  writeFileSync(executable, "synthetic path validation only");
  assert.equal(backendExecutable(executable), executable);
  for (const invalid of [
    "",
    "node",
    "../node.exe",
    folder,
    join(folder, "missing.exe"),
    null,
  ])
    assert.throws(
      () => backendExecutable(invalid),
      /invalid_native_node_executable/,
    );
});
