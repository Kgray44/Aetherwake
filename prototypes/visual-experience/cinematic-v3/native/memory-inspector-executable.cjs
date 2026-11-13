const { startIsolatedMemoryInspector } = require("./memory-inspector-electron-adapter.cjs");

// Intentionally no automatic CLI execution. A dedicated supervisor must
// supply the issued handoff and its bounded ReserveGuard callback.
async function runMemoryInspectorExecutable({ handoff, electron, allowWrite }) {
  try {
    if (handoff?.entryPath !== __filename) throw Error("memory_fixture_entry_mismatch");
    return await startIsolatedMemoryInspector({ electron, handoff, allowWrite });
  } catch (error) {
    // Avoid Electron's unhandled main-process startup dialog.
    console.error(/^[a-z][a-z0-9_]+$/u.test(error?.message) ? error.message : "memory_fixture_startup_failed");
    electron.app.exit(2);
  }
}

module.exports = { runMemoryInspectorExecutable };
