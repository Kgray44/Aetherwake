const { randomBytes } = require("node:crypto");
const { join } = require("node:path");
const { enterMemoryFixture } = require("./memory-fixture-entry.cjs");
const { resolveMemoryInspectorArtifact } = require("./memory-inspector-artifact.cjs");
const { applicationFrameTrust, nativeReviewBoundary, createPersonalMemoryDesktopRoute } =
  require("./personal-memory-desktop-route.cjs");

// Acceptance composition only. A package owner must supply an artifact
// verifier and isolated runtime before this can be used as an executable entry.
async function startMemoryInspectorFixture({ handoff, verifyArtifact = resolveMemoryInspectorArtifact, runtime, allowWrite }) {
  const entered = enterMemoryFixture({ ...handoff, allowWrite });
  const { backendDescriptor, release } = entered;
  let backend, protector, surface;
  let closed = false;
  let starting = true, shutdownRequested = false;
  let cleanup;
  const check = () => {
    entered.check();
    if (closed || shutdownRequested) throw Error("memory_fixture_closed");
  };
  const requestClose = () => {
    shutdownRequested = true;
    return starting ? Promise.resolve() : close();
  };
  function close() {
    if (cleanup) return cleanup;
    closed = true;
    cleanup = (async () => {
      try { await surface?.close(); }
      finally {
        try { await backend?.close(); }
        finally { try { protector?.close(); } finally { release(); } }
      }
    })();
    return cleanup;
  }
  try {
    const assets = await verifyArtifact({
      artifactPath: handoff.artifactPath, artifactSha256: entered.artifactSha256, profileRoot: backendDescriptor.profileRoot, check,
    });
    if (!assets?.rendererURL?.startsWith("file:") || !assets.preloadPath || !assets.hostPath || !assets.nodePath)
      throw Error("memory_fixture_artifact_unverified");
    check();
    runtime.prepareStorage?.({ profileRoot: backendDescriptor.profileRoot, check });
    const key = randomBytes(32);
    const policyToken = randomBytes(32).toString("base64url");
    try {
      protector = await runtime.createProtector({
        modulePath: assets.protectorPath,
        profileRoot: backendDescriptor.profileRoot,
        databasePath: join(backendDescriptor.profileRoot, "aerynth.sqlite"), fixtureKey: key, mode: "create",
      });
    } finally { key.fill(0); }
    check();
    backend = await runtime.startBackend({
      executable: assets.nodePath,
      args: [assets.hostPath, "--memory-fixture-bootstrap-v1", JSON.stringify(backendDescriptor)],
      env: { AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN: policyToken },
      protector, wirePath: assets.wirePath, check, close: requestClose,
    });
    check();
    surface = await runtime.createSurface({
      profileRoot: backendDescriptor.profileRoot, preloadPath: assets.preloadPath, check, close: requestClose,
    });
    check();
    const { win, dialog } = surface;
    const frames = applicationFrameTrust(win, assets.rendererURL);
    const { reviewDialogs } = nativeReviewBoundary({ dialog, checkDesktopTest: check });
    const call = (command, input) => {
      check();
      if (closed) throw Error("memory_fixture_closed");
      // Only the owned native memory adapter can reach this policy write.
      const approval = command === "personalMemoryPolicyNative" && typeof input.enable === "boolean";
      return backend.call({ command, input, ...(approval ? { fixturePolicyToken: policyToken } : {}) });
    };
    const route = createPersonalMemoryDesktopRoute({
      win, frames, backendIdentity: () => backend,
      backendReady: () => { check(); return !closed && backend.ready(); },
      allowWrite: () => { check(); return allowWrite(); },
      call, reviewDialogs, writeExport: () => { throw Error("memory_fixture_export_denied"); },
    });
    const dispatch = async (event, command, input) => {
      try {
        check();
        if (closed || !frames.trustedApplicationFrame(event)) throw Error("unauthorized_sender");
        let result;
        if (command === "personalMemory" &&
            ["list", "read", "enableProviderMemory", "disableProviderMemory", "revokeSource"].includes(input?.type))
          result = await route(event, input);
        else if (command === "openResource" && typeof input?.resourceId === "string" &&
            typeof input.selection?.messageId === "string")
          result = await call("openResource", {
            resourceId: input.resourceId, selection: { messageId: input.selection.messageId },
          });
        else throw Error("memory_fixture_command_denied");
        check();
        if (closed || !frames.trustedApplicationFrame(event)) throw Error("unauthorized_sender");
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: /^[a-z][a-z0-9_]+$/u.test(error?.message) ? error.message : "memory_fixture_command_failed" };
      }
    };
    await surface.mount({ rendererURL: assets.rendererURL, dispatch, check });
    check();
    starting = false;
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { startMemoryInspectorFixture };
