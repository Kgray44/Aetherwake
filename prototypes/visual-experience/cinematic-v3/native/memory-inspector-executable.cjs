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

async function consumeMemoryInspectorHandoff({ env, electron, allowWrite }) {
  const serialized = env.AERYNTH_MEMORY_FIXTURE_HANDOFF;
  const token = env.AERYNTH_NATIVE_TEST_SLOT;
  delete env.AERYNTH_MEMORY_FIXTURE_HANDOFF;
  delete env.AERYNTH_NATIVE_TEST_SLOT;
  let handoff;
  try {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > 8192 || typeof token !== "string")
      throw Error("memory_fixture_handoff_invalid");
    const { profileRoot, artifactPath, descriptorDigest, entryPath } = JSON.parse(serialized);
    handoff = { profileRoot, artifactPath, descriptorDigest, entryPath, token };
  } catch {
    electron.app.exit(2);
    return;
  }
  return runMemoryInspectorExecutable({ handoff, electron, allowWrite });
}

module.exports = { runMemoryInspectorExecutable, consumeMemoryInspectorHandoff };
