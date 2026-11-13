import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { nodeClosure } from "./review-build.mjs";
import artifact from "../prototypes/visual-experience/cinematic-v3/native/memory-inspector-artifact.cjs";

const { paths } = artifact;

// Inventory input for the acceptance-only package. The caller supplies its
// exact source inventory and selected Node binary, as for the review build.
export async function planMemoryInspectorArtifact({ sourceRoot, tracked, rendererDirectory, nodePath }) {
  const closure = await nodeClosure(sourceRoot, tracked, [
    paths.startup, paths.preload, paths.host, paths.worker, paths.protector, paths.wire,
  ]);
  if (closure.excludedVerificationImports.length) throw Error("memory_fixture_unbound_runtime_import");
  const files = [
    ...closure.files.map(path => ({ path, source: join(sourceRoot, path) })),
    ...closure.vendorFiles.map(file => ({ path: file.target.slice("resources/app/".length), source: file.file })),
    { path: paths.renderer, source: join(rendererDirectory, "memory-inspector.html") },
    { path: paths.bundle, source: join(rendererDirectory, "memory-inspector.js") },
    { path: paths.node, source: nodePath },
  ];
  let total = 0;
  const inventory = [];
  for (const { path, source } of files) {
    const info = await stat(source);
    total += info.size;
    if (!info.isFile() || total > 1024 ** 3) throw Error("memory_fixture_artifact_capacity");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    inventory.push({ path, sha256: hash.digest("hex") });
  }
  return {
    files,
    manifest: { contract: "aerynth.memory-inspector-artifact@1", files: inventory },
  };
}
