import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}
const files = [
  ...filesUnder(path.join(root, "dist")),
  ...filesUnder(path.join(root, "dist-electron")).filter(
    (file) => !file.endsWith("build-manifest.json"),
  ),
  path.join(root, "package.json"),
  path.join(root, "package-lock.json"),
].sort((a, b) => a.localeCompare(b));
const entries = files.map((file) => ({
  path: path.relative(root, file).replaceAll("\\", "/"),
  sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
}));
const buildHash = createHash("sha256")
  .update(entries.map((x) => `${x.path}\0${x.sha256}\n`).join(""))
  .digest("hex");
let sourceCommit = "unavailable",
  sourceDirty = true;
try {
  sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  sourceDirty =
    execFileSync("git", ["status", "--porcelain", "--", "."], {
      cwd: root,
      encoding: "utf8",
    }).trim().length > 0;
} catch {
  /* packaged or source archive without Git */
}
const manifest = {
  schema: 1,
  product: "Aerynth Electron visual lab",
  fixtureSeed: 20261101,
  sourceCommit,
  sourceDirty,
  buildHash,
  files: entries,
  electronVersion: JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ).devDependencies.electron,
};
writeFileSync(
  path.join(root, "dist-electron", "build-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`Build manifest SHA-256: ${buildHash}`);
