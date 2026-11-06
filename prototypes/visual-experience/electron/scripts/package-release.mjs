import { packager } from "@electron/packager";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([
  ".git",
  ".runtime",
  ".release",
  "evidence",
  "src",
  "src-electron",
  "scripts",
  "tests",
  "public",
]);
const ignore = (absolute) => {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const first = relative.split("/")[0];
  return (
    excluded.has(first) ||
    relative === ".gitignore" ||
    relative.endsWith(".md") ||
    relative === "node_modules/.bin" ||
    relative.startsWith("node_modules/.bin/") ||
    relative === "node_modules/electron" ||
    relative.startsWith("node_modules/electron/") ||
    relative === "node_modules/electron-nightly" ||
    relative.startsWith("node_modules/electron-nightly/")
  );
};
const output = await packager({
  dir: root,
  out: path.join(root, ".release"),
  name: "AerynthElectronLab",
  executableName: "AerynthElectronLab",
  platform: "win32",
  arch: "x64",
  asar: true,
  prune: true,
  overwrite: true,
  ignore,
});
console.log(output.join("\n"));
