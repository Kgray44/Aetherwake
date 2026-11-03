const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  dialog,
  nativeTheme,
  shell,
  safeStorage,
  clipboard,
} = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { createInterface } = require("node:readline");
const {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { sendToWindow } = require("./host-lifecycle.cjs");
const { backendExecutable } = require("./backend-executable.cjs");
const {
  conversationCommand,
  isConversationRead,
} = require("./conversation-broker.cjs");
const { velaCommand, isVelaRead } = require("./vela-broker.cjs");
const { productCommand, isProductRead } = require("./product-commands.cjs");
const { firstPartyChatCommand } = require("./first-party-chat.cjs");
const { createProtectedStorageBroker } = require("./protected-storage.cjs");
const { createClipboardCapability } = require("./clipboard-capability.cjs");
const {
  createProviderConnectionBroker,
} = require("./provider-connections.cjs");
const root = path.resolve(__dirname, "..");
const moduleStarted = Date.now();
const moduleStartedMonotonicMs = performance.now();
const repository = path.resolve(root, "../../..");
const sourceHashes = {};
function hashFolder(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name.startsWith(".") ||
      entry.name === "evidence"
    )
      continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) hashFolder(full);
    else if (/\.(?:ts|mts|css|cjs|sql)$/.test(entry.name))
      sourceHashes[path.relative(repository, full).replaceAll("\\", "/")] =
        createHash("sha256").update(readFileSync(full)).digest("hex");
  }
}
for (const folder of [
  "prototypes/integrated-backend/src",
  "prototypes/openai-provider",
  "prototypes/connected-conversations/src",
  "prototypes/codex-bridge/src",
  "prototypes/workspace-kernel",
  "prototypes/workspace-engine",
  "prototypes/constellation",
  "prototypes/application-contract",
  "prototypes/vela-core/src",
  "prototypes/conversation-product/src",
  "prototypes/block-library",
  "prototypes/agent-product",
  "prototypes/checklist-product",
  "prototypes/timeline-product",
  "prototypes/task-product",
  "prototypes/visual-experience/cinematic-v3/src",
  "prototypes/visual-experience/cinematic-v3/native",
])
  hashFolder(path.join(repository, folder));
const source = {
  startedAt: new Date(moduleStarted).toISOString(),
  hashes: sourceHashes,
  buildAssets: Object.fromEntries(
    readdirSync(path.join(root, "dist/assets")).map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(path.join(root, "dist/assets", name)))
        .digest("hex"),
    ]),
  ),
};
const verify =
  process.argv.includes("--integration-chat-motion") ||
  process.argv.includes("--integration-task-objectives") ||
  process.argv.includes("--integration-timeline") ||
  process.argv.includes("--integration-checklists") ||
  process.argv.includes("--integration-agents") ||
  process.argv.includes("--integration-desktop-basics") ||
  process.argv.includes("--integration-environments") ||
  process.argv.includes("--integration-resource-opening") ||
  process.argv.includes("--integration-native-review") ||
  process.argv.includes("--integration-workspace-views") ||
  process.argv.includes("--integration-product-ui") ||
  process.argv.includes("--integration-visual-smoke") ||
  process.argv.includes("--integration-verify") ||
  process.argv.includes("--integration-live") ||
  process.argv.includes("--integration-benchmark") ||
  process.argv.includes("--integration-constellation") ||
  process.argv.includes("--integration-organization") ||
  process.argv.includes("--integration-direct") ||
  process.argv.includes("--integration-drag-glide") ||
  process.argv.includes("--integration-conversation-product") ||
  process.argv.includes("--integration-vela") ||
  process.argv.includes("--integration-vela-live") ||
  process.argv.includes("--integration-expanded") ||
  process.argv.includes("--integration-spatial-benchmark");
const offscreenScale = process.argv.includes("--integration-benchmark") &&
  process.argv.includes("--offscreen-renderer");
const profileArg = process.argv.find((a) => a.startsWith("--profile="));
const checkCatalog = process.argv.includes("--check-model-catalog");
if (
  checkCatalog &&
  (verify || !profileArg || !path.isAbsolute(profileArg.slice(10)))
)
  throw Error("explicit_normal_profile_required_for_catalog_check");
if (verify && (!profileArg || !path.isAbsolute(profileArg.slice(10)))) {
  console.error("absolute_verification_profile_required");
  process.exit(2);
}
const privateRoot = profileArg
  ? path.resolve(profileArg.slice(10))
  : path.join(app.getPath("appData"), "Aerynth", "review");
if (offscreenScale) {
  const scale = require("./integration-block-scale.cjs").options(process.argv);
  if (!/^review-block-scale-(?:0|1|3|10|25|50)-\d+$/.test(path.basename(privateRoot)))
    throw Error("isolated_block_scale_profile_required");
  const marker = JSON.parse(readFileSync(path.join(privateRoot, "block-scale-seed.json"), "utf8"));
  if (marker.contract !== "aerynth.native-block-scale@1" || marker.syntheticData !== true || marker.count !== scale.count)
    throw Error("synthetic_block_scale_seed_required");
}
let admitted = false;
function reserveGuard() {
  if (process.platform !== "win32") return true;
  try {
    const guard = path.join(
      app.getPath("home"),
      "AppData/Local/AeroStorageWatch/ReserveGuard.ps1",
    );
    const receipt = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          guard,
          "-EstimatedCBytes",
          "1073741824",
          "-EstimatedDBytes",
          privateRoot.toUpperCase().startsWith("D:") ? "536870912" : "0",
        ],
        { windowsHide: true, encoding: "utf8", timeout: 15000 },
      ),
    );
    return receipt.allowed === true;
  } catch {
    return false;
  }
}
admitted = reserveGuard();
if (!admitted) {
  console.error("storage_reserve_admission_denied");
  app.exit(1);
}
mkdirSync(privateRoot, { recursive: true });
app.commandLine.appendSwitch("disk-cache-size", "33554432");
app.setPath("userData", path.join(privateRoot, "chromium"));
app.setAppUserModelId("org.aetherwake.aerynth.review");
let win,
  child,
  serial = 0,
  closing = false;
const deadlineArgument = process.argv.find((argument) =>
  argument.startsWith("--verification-deadline-ms="),
);
if (deadlineArgument) {
  const deadlineMs = Number(deadlineArgument.split("=")[1]);
  if (
    !verify ||
    !profileArg ||
    !Number.isInteger(deadlineMs) ||
    deadlineMs < 1000 ||
    deadlineMs > 180000 ||
    process.argv.includes("--integration-live") ||
    process.argv.includes("--integration-vela-live")
  )
    throw new Error("bounded_offline_verification_profile_required");
  const deadline = setTimeout(() => {
    try {
      writeFileSync(
        path.join(privateRoot, "verification-timeout.json"),
        JSON.stringify(
          {
            contract: "aerynth.native-check-deadline@1",
            state: "timed_out",
            deadlineMs,
            at: new Date().toISOString(),
            complete: false,
          },
          null,
          2,
        ),
      );
    } finally {
      console.error(
        "native_verification_deadline_reached; closing owned desktop and backend",
      );
      if (child && !child.killed) child.kill();
      app.exit(124);
    }
  }, deadlineMs);
  deadline.unref();
}
const pending = new Map();
let nativeSecretBroker;
let providerConnections;
let nativeClipboard;
function call(command, input) {
  if (!child || child.killed || !child.stdin.writable)
    return Promise.reject(new Error("backend_disconnected"));
  if (pending.size >= 64) return Promise.reject(new Error("backpressure"));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(
          new Error(
            command === "execute"
              ? "unknown_execution_outcome"
              : "backend_timeout",
          ),
        );
      },
      command === "conversationSend" ? 120000 : 90000,
    );
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, command, input }) + "\n");
  });
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  const localURL = pathToFileURL(path.join(root, "dist/index.html")).href;
  child = spawn(
    backendExecutable(process.env.AERYNTH_NODE_BIN),
    [
      path.resolve(root, "../../integrated-backend/src/desktop-host.mts"),
      path.join(privateRoot, "aerynth.sqlite"),
      privateRoot,
      root,
      "--native-secrets",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  nativeSecretBroker = createProtectedStorageBroker({
    safeStorage,
    isReady: () => app.isReady(),
    platform: process.platform,
    send: (wire) => {
      if (!child || child.killed || !child.stdin.writable)
        throw Error("native_secret_closed");
      child.stdin.write(JSON.stringify(wire) + "\n");
    },
  });
  providerConnections = createProviderConnectionBroker({
    call,
    openExternal: (url) => shell.openExternal(url),
  });
  const fail = () => {
    nativeSecretBroker?.close();
    providerConnections?.close();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("backend_disconnected"));
    }
    pending.clear();
    if (!closing)
      sendToWindow(win, "application-event", {
        type: "backend/disconnected",
        classification: "observed",
      });
  };
  child.on("error", fail);
  child.on("exit", fail);
  // Native diagnostics may contain private paths; never forward stderr to the renderer or public evidence.
  child.stderr.on("data", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      if (nativeSecretBroker.handle(m)) return;
      if (m.event) {
        sendToWindow(win, "application-event", m.event);
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    } catch {
      fail();
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_d, callback) => callback({ cancel: true }),
  );
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    useContentSize: process.argv.includes("--integration-drag-glide"),
    minWidth: 800,
    minHeight: 650,
    show: !offscreenScale,
    backgroundColor: "#05060c",
    title: verify
      ? "Aerynth · Automated check"
      : "Aerynth · Working environment",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#080910", symbolColor: "#d8cee9", height: 42 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "desktop-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(offscreenScale ? { offscreen: true, backgroundThrottling: false } : {}),
      additionalArguments: process.argv.includes("--integration-drag-glide")
        ? ["--aerynth-geometry-observation"]
        : [],
    },
  });
  const startupErrors = [];
  if (verify) win.on("page-title-updated", (event) => event.preventDefault());
  const velaRequestDiagnostics = [];
  const observeVelaRequest = process.argv.includes("--integration-vela-live")
    ? (event) => {
        velaRequestDiagnostics.push({ ...event });
        if (velaRequestDiagnostics.length > 24) velaRequestDiagnostics.shift();
      }
    : undefined;
  if (verify)
    win.webContents.on("console-message", (details) => {
      if (details.level === "error") {
        startupErrors.push({
          message: String(details.message).slice(0, 2048),
          line: details.lineNumber,
          source: String(details.sourceId).slice(0, 300),
        });
        if (startupErrors.length > 32) startupErrors.shift();
      }
    });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== localURL) event.preventDefault();
  });
  const trustedCopyFrame = (event) =>
    !win.isDestroyed() &&
    !win.webContents.isDestroyed() &&
    win.isVisible() &&
    !win.isMinimized() &&
    win.isFocused() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame.url === localURL;
  nativeClipboard = createClipboardCapability({
    writeText: (text) => clipboard.writeText(text),
    isTrustedApplicationFrame: trustedCopyFrame,
    authorizeUserCopy: async (event) => {
      if (!trustedCopyFrame(event)) return false;
      // Observe Blink's existing activation; never synthesize a user gesture.
      return (
        (await event.senderFrame.executeJavaScript(
          "navigator.userActivation.isActive && document.hasFocus()",
          false,
        )) === true
      );
    },
  });
  ipcMain.handle("application-copy-text", (event, input) =>
    nativeClipboard.copy(event, input),
  );
  win.on("closed", () => nativeClipboard?.close());
  ipcMain.handle("application-command", async (event, command, input) => {
    try {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== localURL
      )
        throw new Error("unauthorized_sender");
      if (
        Buffer.byteLength(JSON.stringify(input ?? {})) >
        (command === "viewState"
          ? 2 * 1024 * 1024 + 1024
          : command === "checklists"
            ? 600 * 1024
            : 200000)
      )
        throw new Error("command_too_large");
      if (
        !admitted &&
        ![
          "replay",
          "executionStatus",
          "conversationActivity",
          "openResource",
          "interrupt",
          "firstPartyChat",
        ].includes(command) &&
        !(command === "conversation" && isConversationRead(input)) &&
        !(command === "vela" && isVelaRead(input)) &&
        !isProductRead(command, input) &&
        !(command === "notes" && input?.name === "readNote") &&
        !(command === "providerConnection" && input?.type === "status") &&
        !(
          command === "library" &&
          [
            "inspectWorkspace",
            "capabilities",
            "preferences",
            "findResources",
            "listTemplates",
            "getTemplate",
            "getBlockSettings",
            "previewTemplate",
            "previewWorkspaceFromResources",
            "subjectTargets",
            "projectOverview",
            "browseResources",
          ].includes(input?.name)
        ) &&
        !(command === "desktop" && input?.type === "snapshot")
      )
        throw new Error("storage_reserve_admission_denied");
      let result;
      if (command === "desktop") result = await call("desktop", input);
      else if (command === "openResource")
        result = await call("openResource", input);
      else if (command === "providerConnection")
        result = await providerConnections.command(input);
      else if (command === "graphAction")
        result = await require("./graph-actions.cjs").graphAction(input, call);
      else if (command === "viewState") result = await call("viewState", input);
      else if (command === "capabilities")
        result = await call("capabilities", {});
      else if (command === "replay") {
        const bounds = await call("replay", { after: 0, limit: 1 });
        result = await call("replay", {
          after: Math.max(0, bounds.latest - 250),
          limit: 250,
        });
        result.truncated ||= bounds.latest > 250;
      } else if (command === "conversationActivity")
        result = await call("conversationActivity", input);
      else if (command === "executionStatus")
        result = Object.values((await call("snapshot", {})).executions);
      else if (command === "interrupt")
        result = await call("interrupt", { executionId: input.executionId });
      else if (command === "send") {
        if (
          typeof input.content !== "string" ||
          !input.content.trim() ||
          Buffer.byteLength(input.content) > 16000
        )
          throw new Error("invalid_message");
        const state = await call("desktop", { type: "snapshot" });
        const resource = state.resources.find(
          (r) =>
            r.id === input.resourceId &&
            r.kind === "conversation" &&
            r.available !== false,
        );
        if (!resource) throw new Error("resource_not_found");
        if (resource.provider === "local")
          result = await call("addMessage", {
            resourceId: resource.id,
            role: "user",
            content: input.content,
            sensitivity: "internal",
            expectedRevision: input.expectedVersion,
          });
        else {
          // Dedicated owner-requested verification authorizes this exact synthetic prompt only.
          // Ordinary application launches always require the native dialog.
          const syntheticAuthorization =
            process.argv.includes("--integration-live") &&
            input.content ===
              "Reply with exactly AERYNTH_LIVE_OK. Do not use tools or inspect files.";
          const response = syntheticAuthorization
            ? { response: 1 }
            : await dialog.showMessageBox(win, {
                type: "question",
                title: "Authorize Codex turn",
                message: `Send this message to Codex in “${resource.title}”?`,
                detail: `Uses your configured local Codex account and native instructions. This review build requests a read-only sandbox and denies approval requests. It does not grant tool or write approvals.\n\n${input.content}`,
                buttons: ["Cancel", "Send once"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
          if (response.response !== 1)
            throw new Error("authorization_cancelled");
          result = await call("execute", {
            resourceId: resource.id,
            prompt: input.content,
            authorized: true,
            commandId: randomUUID(),
          });
        }
      } else if (command === "firstPartyChat") {
        result = await firstPartyChatCommand({
          input,
          win,
          openExternal: (url) => shell.openExternal(url),
        });
      } else if (command === "conversation") {
        result = await conversationCommand({ win, dialog, call, input, openExternal: (url) => shell.openExternal(url) });
      } else if (command === "vela") {
        result = await velaCommand({
          win,
          dialog,
          call,
          input,
          observeNativeRequest: observeVelaRequest,
        });
      } else if (command === "library") {
        result = await call("library", input);
      } else if (command === "notes") {
        result = await call("notes", input);
      } else if (
        command === "agents" ||
        command === "checklists" ||
        command === "timelines" ||
        command === "taskObjectives"
      ) {
        result = await productCommand({ family: command, input, call });
      } else throw new Error("unsupported_command");
      return { ok: true, result };
    } catch (e) {
      const message = String(e.message);
      return {
        ok: false,
        error: /^[a-zA-Z_-]{1,80}$/.test(message)
          ? message
          : "operation_failed",
      };
    }
  });
  const active = () => {
    sendToWindow(
      win,
      "host-active",
      win.isVisible() && !win.isMinimized() && win.isFocused(),
    );
  };
  win.on("close", (event) => {
    if (!closing) {
      event.preventDefault();
      app.quit();
    }
  });
  for (const event of ["focus", "blur", "show", "hide", "minimize", "restore"])
    win.on(event, active);
  await win.loadURL(localURL);
  if (offscreenScale) {
    await require("./integration-offscreen-scale.cjs").verify({
      win, app, privateRoot, call, source, moduleStartedMonotonicMs, startupErrors,
    });
    return;
  }
  win.show();
  win.focus();
  active();
  const reserveTimer = setInterval(() => {
    admitted = reserveGuard();
    if (!admitted) {
      sendToWindow(win, "application-event", {
        type: "storage/reserve-admission-denied",
        classification: "observed",
      });
      call("snapshot", {})
        .then((snapshot) => {
          for (const e of Object.values(snapshot.executions))
            if (e.state === "running" && e.turnId)
              void call("interrupt", { executionId: e.id }).catch(() => {});
        })
        .catch(() => {});
    }
  }, 240000);
  reserveTimer.unref();
  if (checkCatalog) {
    // Explicit CLI support action uses this normal app's existing managed
    // connection. The window stays open; this installs no input hooks.
    const receipt = await require("./model-catalog-check.cjs")
      .checkModelCatalog({ call })
      .catch(() => ({
        contract: "aerynth.native-model-catalog-check@1",
        state: "check-unavailable",
        modelInferenceAttempted: false,
        openedAuthorization: false,
        billingFallbackUsed: false,
        credentialsExported: false,
      }));
    const bytes = JSON.stringify(receipt, null, 2);
    if (Buffer.byteLength(bytes) > 8192)
      throw Error("catalog_diagnostic_capacity");
    writeFileSync(
      path.join(privateRoot, `model-catalog-check-${Date.now()}.json`),
      bytes,
      { flag: "wx" },
    );
  }
  if (verify) {
    if (process.argv.includes("--integration-chat-motion")) {
      await require("./integration-chat-motion.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        observeProviderActivity: () => call("providerActivity", {}),
        session: session.defaultSession,
        localURL,
      });
      return;
    }
    if (process.argv.includes("--integration-task-objectives")) {
      await require("./integration-task-objectives.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        observeProviderActivity: () => call("providerActivity", {}),
      });
      return;
    }
    if (process.argv.includes("--integration-timeline")) {
      await require("./integration-timeline.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        observeProviderActivity: () => call("providerActivity", {}),
      });
      return;
    }
    if (process.argv.includes("--integration-checklists")) {
      await require("./integration-checklists.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        observeProviderActivity: () => call("providerActivity", {}),
      });
      return;
    }
    if (process.argv.includes("--integration-agents")) {
      await require("./integration-agents.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        observeProviderActivity: () => call("providerActivity", {}),
      });
      return;
    }
    if (process.argv.includes("--integration-desktop-basics")) {
      await require("./integration-desktop-basics.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        moduleStartedMonotonicMs,
        clipboard: { readText: () => clipboard.readText() },
        observeProviderActivity: () => call("providerActivity", {}),
      });
      return;
    }
    if (process.argv.includes("--integration-environments")) {
      await require("./integration-environments.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        session: session.defaultSession,
        localURL,
        moduleStartedMonotonicMs,
      });
      return;
    }
    if (process.argv.includes("--integration-native-review")) {
      await require("./integration-native-review.cjs").verify({
        win,
        app,
        privateRoot,
        source,
        moduleStarted,
        startupErrors,
        call,
      });
      return;
    }
    if (process.argv.includes("--integration-workspace-views")) {
      await require("../../../block-library/tests/workspace-native.cjs").verify(
        {
          win,
          app,
          privateRoot,
          source,
          moduleStarted,
          startupErrors,
          inspectProviderState: process.argv.includes(
            "--verify-functional-workspace",
          )
            ? async () => {
                const snapshot = await call("snapshot", {});
                return {
                  executionCount: Object.keys(snapshot.executions).length,
                  bindingCount: Object.values(snapshot.bindings).flat().length,
                  assistantMessageCount: snapshot.graph.messages.filter(
                    (message) => message.role === "assistant",
                  ).length,
                };
              }
            : undefined,
        },
      );
      return;
    }
    if (process.argv.includes("--integration-resource-opening")) {
      await require("./integration-resource-opening.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        startupErrors,
        session: session.defaultSession,
        localURL,
        moduleStartedMonotonicMs,
      });
      return;
    }
    if (process.argv.includes("--integration-product-ui")) {
      await require("./integration-product-ui.cjs").verify({
        win,
        app,
        privateRoot,
        source,
        startupErrors,
        session: session.defaultSession,
        localURL,
      });
      return;
    }
    if (process.argv.includes("--integration-visual-smoke")) {
      await require("./integration-visual-smoke.cjs").verify({
        win,
        app,
        privateRoot,
        source,
        startupErrors,
      });
      return;
    }
    if (process.argv.includes("--integration-vela-live")) {
      await require("../../../vela-core/test/native-live.cjs").verify({
        win,
        app,
        privateRoot,
        source,
        startupErrors,
        getNativeRequestDiagnostics: () =>
          velaRequestDiagnostics.map((event) => ({ ...event })),
        ownsNativeReviewWindow:
          require("./vela-review.cjs").isOwnedVelaReviewWindow,
        slotStartedAt: moduleStartedMonotonicMs,
        deadlineMs: 85000,
        cancelOwnedPlanning: async ({ requestId }) => {
          const current = await call("vela", { name: "state", input: {} });
          const request = current.requests.find(
            (item) => item.id === requestId,
          );
          if (
            !request ||
            request.state !== "planning" ||
            request.providerId !== "codex-app-server" ||
            request.conversationId !== current.conversation?.id
          )
            throw Error("owned_planning_request_not_active");
          return call("vela", { name: "cancel", input: requestId });
        },
      });
      return;
    }
    if (process.argv.includes("--integration-vela")) {
      await require("../../../vela-core/test/native-desktop.cjs").verify({
        win,
        app,
        privateRoot,
        source,
      });
      return;
    }
    if (process.argv.includes("--integration-conversation-product")) {
      await require("../../../conversation-product/test/native-desktop.cjs").verify(
        {
          win,
          app,
          privateRoot,
          source,
        },
      );
      return;
    }
    if (process.argv.includes("--integration-drag-glide")) {
      await require("../../../block-library/tests/drag-glide-native.cjs").verify(
        {
          win,
          app,
          privateRoot,
          call,
          source,
          moduleStarted,
          startupErrors,
          session: session.defaultSession,
          localURL,
        },
      );
      return;
    }
    if (process.argv.includes("--integration-direct")) {
      await require("./integration-direct.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        moduleStarted,
        session: session.defaultSession,
        localURL,
      });
      return;
    }
    if (process.argv.includes("--integration-spatial-benchmark")) {
      await require("./integration-spatial-benchmark.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        moduleStarted,
        moduleStartedMonotonicMs,
        startupErrors,
      });
      return;
    }
    if (process.argv.includes("--integration-expanded")) {
      await require("../../../constellation/tests/integrated-native.cjs").verify(
        {
          win,
          app,
          privateRoot,
          source,
          moduleStartedMonotonicMs,
          startupErrors,
          session: session.defaultSession,
          localURL,
        },
      );
      return;
    }
    if (process.argv.includes("--integration-organization")) {
      await require("./integration-organization.cjs").verify({
        win,
        app,
        privateRoot,
        source,
        session: session.defaultSession,
        localURL,
      });
      return;
    }
    if (process.argv.includes("--integration-constellation")) {
      await require("./integration-constellation.cjs").verify({
        win,
        app,
        privateRoot,
        call,
        source,
        moduleStarted,
        session: session.defaultSession,
        localURL,
      });
      return;
    }
    const checks = require("./desktop-verify.cjs");
    await (
      process.argv.includes("--integration-live")
        ? checks.live
        : process.argv.includes("--integration-benchmark")
          ? checks.benchmark
          : checks.verify
    )({ win, app, privateRoot, call, source, moduleStarted });
  }
});
async function unlockEditingAfterKeptOpen() {
  if (win && !win.isDestroyed())
    await win.webContents
      .executeJavaScript("document.documentElement.inert = false")
      .catch(() => {});
  closing = false;
}
app.on("before-quit", (event) => {
  if (!child || closing) return;
  event.preventDefault();
  closing = true;
  const flush =
    win && !win.isDestroyed()
      ? win.webContents.executeJavaScript(
          "(async()=>{document.documentElement.inert=true;await window.__aerynth?.flush()})()",
        )
      : Promise.resolve();
  flush
    .then(async () => {
      const snapshot = await call("snapshot", {});
      const active = Object.values(snapshot.executions).filter((e) =>
        ["running", "dispatching"].includes(e.state),
      );
      if (active.length) {
        const choice = await dialog.showMessageBox(win, {
          type: "question",
          message: active.every(
            (execution) => execution.providerId === "chatgpt-plan-responses",
          )
            ? "A response is still being received."
            : "An AI turn is still active.",
          detail:
            "Closing requests interruption. If the provider cannot confirm it, the outcome will be unknown after restart.",
          buttons: ["Keep open", "Interrupt and close"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) {
          await unlockEditingAfterKeptOpen();
          return;
        }
        for (const e of active)
          if (e.turnId || e.providerId === "chatgpt-plan-responses")
            await call("interrupt", { executionId: e.id }).catch(() => {});
      }
      await call("close", {}).catch(() => {});
      providerConnections?.close();
      nativeSecretBroker?.close();
      child.kill();
      app.quit();
    })
    .catch(async () => {
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        message: "Your latest edits could not be saved.",
        detail:
          "Keep this window open to retain the draft. Existing saved data remains intact.",
        buttons: ["Keep open", "Close without latest edits"],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response === 1) {
        providerConnections?.close();
        nativeSecretBroker?.close();
        child.kill();
        app.quit();
      } else await unlockEditingAfterKeptOpen();
    });
});
app.on("window-all-closed", () => app.quit());
