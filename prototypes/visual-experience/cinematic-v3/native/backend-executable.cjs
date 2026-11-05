const path = require("node:path");
const { statSync } = require("node:fs");
/** Trusted native bootstrap configuration; never accepted through renderer IPC. */
exports.backendExecutable = function backendExecutable(override) {
  if (override === undefined) return "node";
  if (typeof override !== "string" || !path.isAbsolute(override))
    throw new Error("invalid_native_node_executable");
  try {
    if (!statSync(override).isFile()) throw new Error("not_a_file");
  } catch {
    throw new Error("invalid_native_node_executable");
  }
  return override;
};
