const path = require("node:path");

function checkNativeHelpers() {
  const lookup = { paths: [path.resolve(__dirname, ".."), path.resolve(__dirname, "../../visual-experience/cinematic-v3")] };
  const ts = require(require.resolve("typescript", lookup));
  const typeRoot = path.resolve(path.dirname(require.resolve("typescript/package.json", lookup)), "../@types");
  const files = ["integrated-native.cjs", "native-labels.cjs", "native-input.cjs", "prepared-workspaces.cjs"].map((name) => path.join(__dirname, name));
  const selected = new Set(files.map((file) => path.resolve(file)));
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"], typeRoots: [typeRoot],
  });
  const codes = new Set([2304, 2448, 2454, 2349, 2451]);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && selected.has(path.resolve(d.file.fileName)) && codes.has(d.code))
    .map((d) => ({ file: path.relative(__dirname, d.file.fileName),
      line: d.file.getLineAndCharacterOfPosition(d.start).line + 1,
      code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, " ") }));
}

exports.checkNativeHelpers = checkNativeHelpers;
if (require.main === module) {
  const diagnostics = checkNativeHelpers();
  console.log(JSON.stringify({ passed: diagnostics.length === 0,
    scope: "Actual owned native helpers: unbound names, temporal-dead-zone/unassigned reads and callability; no native execution", diagnostics }));
  if (diagnostics.length) process.exitCode = 1;
}
