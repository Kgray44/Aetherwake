const { randomBytes } = require("node:crypto");
const { join } = require("node:path");
const { enterMemoryFixture } = require("./memory-fixture-entry.cjs");
const { resolveMemoryInspectorArtifact } = require("./memory-inspector-artifact.cjs");
const { prepareMemoryInspectorRestart } = require("./memory-inspector-restart.cjs");
const { applicationFrameTrust, nativeReviewBoundary, createPersonalMemoryDesktopRoute } =
  require("./personal-memory-desktop-route.cjs");

// Acceptance composition only. A package owner must supply an artifact
// verifier and isolated runtime before this can be used as an executable entry.
async function startMemoryInspectorFixture({ handoff, verifyArtifact = resolveMemoryInspectorArtifact, runtime, allowWrite }) {
  const entered = enterMemoryFixture({ ...handoff, allowWrite });
  const { backendDescriptor, release } = entered;
  let backend, protector, surface;
  let closed = false;
  let starting = true, shutdownRequested = false, restarting = false, restarted = false;
  let cleanup, earlyShutdown;
  const check = () => {
    entered.check();
    if (closed || shutdownRequested) throw Error("memory_fixture_closed");
  };
  const requestClose = () => {
    shutdownRequested = true;
    if (!starting) return close();
    earlyShutdown ??= Promise.withResolvers();
    return earlyShutdown.promise;
  };
  function close() {
    if (cleanup) return cleanup;
    closed = true;
    cleanup = (async () => {
      try { await surface?.close(); }
      finally {
        let workerExited = false;
        try {
          await backend?.close();
          workerExited = true;
        } finally {
          try { protector?.close(); } finally { if (workerExited) release(); }
        }
      }
    })();
    if (earlyShutdown) cleanup.then(earlyShutdown.resolve, earlyShutdown.reject);
    return cleanup;
  }
  try {
    const assets = await verifyArtifact({
      artifactPath: handoff.artifactPath, artifactSha256: entered.artifactSha256, profileRoot: backendDescriptor.profileRoot, check,
    });
    if (!assets?.rendererURL?.startsWith("file:") || !assets.preloadPath || !assets.hostPath || !assets.nodePath)
      throw Error("memory_fixture_artifact_unverified");
    if (handoff.entryPath !== undefined && handoff.entryPath !== assets.entryPath)
      throw Error("memory_fixture_entry_mismatch");
    check();
    runtime.prepareStorage?.({ profileRoot: backendDescriptor.profileRoot, check });
    const key = randomBytes(32);
    const policyToken = randomBytes(32).toString("base64url");
    const detailToken = randomBytes(32).toString("base64url");
    try {
      protector = await runtime.createProtector({
        modulePath: assets.protectorPath,
        profileRoot: backendDescriptor.profileRoot,
        databasePath: join(backendDescriptor.profileRoot, "aerynth.sqlite"), fixtureKey: key, mode: "create",
      });
    } finally { key.fill(0); }
    check();
    const startBackend = ({ descriptor, mode, expected }) => runtime.startBackend({
      executable: assets.nodePath,
      args: [assets.hostPath, mode === "create" ? "--memory-fixture-bootstrap-v1" : "--memory-fixture-restart-v1",
        JSON.stringify(descriptor)],
      env: {
        AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN: policyToken,
        AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN: detailToken,
        ...(mode === "create" ? { AERYNTH_MEMORY_FIXTURE_SEED: "inspector-v1" } : {}),
      },
      protector, wirePath: assets.wirePath, check, close: requestClose, expected,
    });
    backend = await startBackend({ descriptor: backendDescriptor, mode: "create" });
    const originalSeed = await backend.waitUntilReady?.();
    check();
    surface = await runtime.createSurface({
      profileRoot: backendDescriptor.profileRoot, preloadPath: assets.preloadPath, check, close: requestClose,
    });
    check();
    const { win, dialog } = surface;
    const frames = applicationFrameTrust(win, assets.rendererURL);
    const detail = createFixtureDetailRoute({
      check, trustedFrame: frames.trustedApplicationFrame,
      detailToken, call: request => backend.call(request),
    });
    const { reviewDialogs } = nativeReviewBoundary({ dialog, checkDesktopTest: check });
    const call = (command, input) => {
      check();
      if (restarting) throw Error("memory_fixture_worker_not_ready");
      // Only the owned native memory adapter can reach this policy write.
      const approval = command === "personalMemoryPolicyNative" && typeof input.enable === "boolean";
      return backend.call({ command, input, ...(approval ? { fixturePolicyToken: policyToken } : {}) });
    };
    const route = createPersonalMemoryDesktopRoute({
      win, frames, backendIdentity: () => backend,
      backendReady: () => { check(); return !restarting && backend.ready(); },
      allowWrite: () => { check(); return allowWrite(); },
      call, reviewDialogs, writeExport: () => { throw Error("memory_fixture_export_denied"); },
    });
    const dispatch = async (event, command, input) => {
      try {
        check();
        if (restarting || !frames.trustedApplicationFrame(event)) throw Error("unauthorized_sender");
        const owner = backend;
        let result;
        if (command === "personalMemory" &&
            ["list", "read", "enableProviderMemory", "disableProviderMemory", "revokeSource"].includes(input?.type))
          result = await route(event, input);
        else if (command === "openResource" || command === "conversation")
          result = await detail.dispatch(event, command, input);
        else throw Error("memory_fixture_command_denied");
        check();
        if (restarting || owner !== backend || !frames.trustedApplicationFrame(event)) throw Error("unauthorized_sender");
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: /^[a-z][a-z0-9_]+$/u.test(error?.message) ? error.message : "memory_fixture_command_failed" };
      }
    };
    await surface.mount({ rendererURL: assets.rendererURL, dispatch, check, invalidateDetail: detail.clear });
    check();
    starting = false;
    return {
      close,
      async restartWorker() {
        check();
        if (!originalSeed || restarted) throw Error("memory_fixture_restart_unavailable");
        restarted = restarting = starting = true;
        detail.clear();
        let restart;
        try {
          restart = await prepareMemoryInspectorRestart({ check, worker: backend, protector });
          const { descriptor } = restart;
          protector = await restart.claim(descriptor);
          check();
          backend = await startBackend({ descriptor, mode: "reopen", expected: originalSeed });
          await backend.waitUntilReady();
          check();
        } catch (error) {
          await close();
          throw error;
        } finally {
          restart?.close();
          restarting = starting = false;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function createFixtureDetailRoute({ check, trustedFrame, detailToken, call }) {
  let selection, revision = 0;
  const clear = () => { selection = undefined; revision++; };
  const current = event => {
    check();
    if (!trustedFrame(event)) throw Error("unauthorized_sender");
  };
  const identifier = value => typeof value === "string" && value.length <= 256 && value.trim().length > 0;
  return {
    clear,
    async dispatch(event, command, input) {
      current(event);
      if (command === "openResource") {
        clear();
        const attempt = revision;
        const resourceId = input?.resourceId, messageId = input?.selection?.messageId;
        if (!identifier(resourceId) || !identifier(messageId)) throw Error("memory_fixture_command_denied");
        const result = await call({ command, input: { resourceId, selection: { messageId } }, fixtureDetailToken: detailToken });
        current(event);
        if (attempt !== revision) throw Error("source_unavailable");
        if (result?.status === "ready") {
          if (result.resourceId !== resourceId || result.resource?.kind !== "conversation" ||
              result.selection?.messageId !== messageId) throw Error("source_unavailable");
          selection = { resourceId, messageId, frame: event.senderFrame };
        }
        return result;
      }
      const accepted = selection;
      if (command !== "conversation" || input?.name !== "detail" || !accepted ||
          accepted.frame !== event.senderFrame || input.input?.resourceId !== accepted.resourceId ||
          input.input?.aroundMessageId !== accepted.messageId)
        throw Error("memory_fixture_command_denied");
      try {
        const result = await call({ command, fixtureDetailToken: detailToken, input: {
          name: "detail", input: { resourceId: accepted.resourceId, aroundMessageId: accepted.messageId },
        } });
        current(event);
        if (selection !== accepted) throw Error("source_unavailable");
        return result;
      } catch (error) {
        if (selection === accepted) clear();
        throw error;
      }
    },
  };
}

module.exports = { startMemoryInspectorFixture, createFixtureDetailRoute };
