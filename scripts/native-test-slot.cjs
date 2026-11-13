const {
  createAdmission, desktopDirectory,
} = require("../prototypes/visual-experience/cinematic-v3/native/native-test-admission.cjs");

try {
  const directory = desktopDirectory();
  if (!directory) throw Error("native_test_desktop_slot_requires_windows");
  const admission = createAdmission(directory);
  const [action, owner, duration, ...rest] = process.argv.slice(2);
  if (action === "open" && owner && duration && rest.length === 0) {
    console.log(JSON.stringify(admission.open(owner, Number(duration))));
  } else if (action === "close" && owner === undefined) {
    admission.close();
    console.log(JSON.stringify(admission.status()));
  } else if (["pause", "resume"].includes(action) && owner === undefined) {
    admission[action]();
    console.log(JSON.stringify(admission.status()));
  } else if (action === "status" && owner === undefined) {
    console.log(JSON.stringify(admission.status()));
  } else {
    throw Error("Usage: native-test-slot.cjs open OWNER MINUTES | close | pause | resume | status");
  }
} catch (error) {
  console.error(error.code ?? error.message);
  process.exitCode = 2;
}
