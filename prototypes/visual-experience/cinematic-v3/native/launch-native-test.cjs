const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createAdmission, desktopDirectory } = require("./native-test-admission.cjs");

function checkNativeTestLaunch(env = process.env) {
  const directory = desktopDirectory();
  if (directory) createAdmission(directory).checkPermit(env.AERYNTH_NATIVE_TEST_SLOT);
}

const appRoot = path.resolve(__dirname, "..");
const prototypeModes = new Map([
  ["verify", ["--verify"]],
  ["record", ["--record"]],
  ["preview", ["--preview"]],
  ["soak", ["--soak", "--soak-seconds=90"]],
]);

function launchNativeTest(mode) {
  const prototypeArgs = prototypeModes.get(mode);
  if (!prototypeArgs && mode !== "constellation") throw Error("unknown_native_test_mode");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  checkNativeTestLaunch(env);
  const args = prototypeArgs
    ? [path.join(__dirname, "main.cjs"), ...prototypeArgs]
    : [path.resolve(appRoot, "../../constellation/tests/native.cjs")];
  const result = spawnSync(require("electron"), args, {
    cwd: appRoot, env, windowsHide: true, shell: false, stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

exports.checkNativeTestLaunch = checkNativeTestLaunch;

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error("expected_one_native_test_mode");
    process.exitCode = launchNativeTest(process.argv[2]);
  } catch (error) {
    console.error(error.code ?? error.message);
    process.exitCode = 1;
  }
}
