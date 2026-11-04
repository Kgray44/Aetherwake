const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  protocol,
  dialog,
  nativeTheme,
  shell,
  safeStorage,
  clipboard,
} = require("electron");
const { createMediaPlayback, scheme: mediaScheme } = require("./media-playback.cjs");
protocol.registerSchemesAsPrivileged([
  { scheme: mediaScheme, privileges: { standard: true, secure: true, stream: true } },
]);
const { spawn, execFile, execFileSync } = require("node:child_process");
const { createStorageAdmission } = require("./storage-admission.cjs");
const { createInterface } = require("node:readline");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
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
const verifyAirPlan = process.argv.includes("--integration-vela-air-plan");
const verifyMissions = process.argv.includes("--integration-vela-missions");
const verify = verifyAirPlan ||
  verifyMissions ||
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
const verifyAirLocal = process.argv.includes("--integration-vela") && process.argv.includes("--verify-air-local");
const profileArg = process.argv.find((a) => a.startsWith("--profile="));
const checkCatalog = process.argv.includes("--check-model-catalog");
if (process.argv.includes("--integration-live"))
  throw Error("use_standard_conversation_review");
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
if (verifyAirLocal && (!/^review-vela-air-offline-\d+$/u.test(path.basename(privateRoot)) || existsSync(privateRoot)))
  throw Error("fresh_offline_air_profile_required");
if (verifyMissions && (!/^review-vela-missions-\d+$/u.test(path.basename(privateRoot)) || existsSync(privateRoot)))
  throw Error("fresh_offline_mission_profile_required");
if (verifyAirPlan && (!/^review-vela-air-plan-\d+$/u.test(path.basename(privateRoot)) || !existsSync(privateRoot)))
  throw Error("signed_in_air_test_profile_required");
if (offscreenScale) {
  const scale = require("./integration-block-scale.cjs").options(process.argv);
  if (!/^review-block-scale-(?:0|1|3|10|25|50)-\d+$/.test(path.basename(privateRoot)))
    throw Error("isolated_block_scale_profile_required");
  const marker = JSON.parse(readFileSync(path.join(privateRoot, "block-scale-seed.json"), "utf8"));
  if (marker.contract !== "aerynth.native-block-scale@1" || marker.syntheticData !== true || marker.count !== scale.count)
    throw Error("synthetic_block_scale_seed_required");
}
const reserveArguments = [
  "-NoProfile", "-File",
  path.join(app.getPath("home"), "AppData/Local/AeroStorageWatch/ReserveGuard.ps1"),
  "-EstimatedCBytes", "1073741824",
  "-EstimatedDBytes", privateRoot.toUpperCase().startsWith("D:") ? "536870912" : "0",
];
const reserveOptions = { windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 65536 };
function admittedBy(receipt) {
  try { return JSON.parse(receipt)?.allowed === true; }
  catch { return false; }
}
function startupReserve() {
  if (process.platform !== "win32") return true;
  try { return admittedBy(execFileSync("powershell.exe", reserveArguments, reserveOptions)); }
  catch { return false; }
}
function runtimeReserve() {
  if (process.platform !== "win32") return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile("powershell.exe", reserveArguments, reserveOptions, (error, stdout) =>
      resolve(!error && admittedBy(stdout)),
    );
  });
}
if (!startupReserve()) {
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
let backendFailed = false;
let nativeSecretBroker;
let providerConnections;
let nativeClipboard;
const storage = createStorageAdmission({
  probe: runtimeReserve,
  initiallyAdmitted: true,
  changed(admitted) {
    if (closing) return;
    sendToWindow(win, "application-event", {
      type: admitted ? "storage/reserve-admission-restored" : "storage/reserve-admission-denied",
      classification: "observed",
    });
    if (admitted) return;
    call("snapshot", {}).then((snapshot) => {
      for (const execution of Object.values(snapshot.executions))
        if (execution.state === "running" && execution.turnId)
          void call("interrupt", { executionId: execution.id }).catch(() => {});
    }).catch(() => {});
  },
});
function failBackend() {
  if (backendFailed) return;
  backendFailed = true;
  nativeSecretBroker?.close();
  providerConnections?.close();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("backend_disconnected"));
  }
  pending.clear();
  if (!closing)
    sendToWindow(win, "application-event", {
      type: "backend/disconnected",
      classification: "observed",
    });
}
function backendWritable() {
  return !backendFailed && child && !child.killed && child.stdin.writable;
}
function writeBackend(line) {
  try {
    if (!backendWritable()) throw new Error("backend_disconnected");
    child.stdin.write(line);
  } catch {
    failBackend();
    throw new Error("backend_disconnected");
  }
}
function call(command, input) {
  if (!backendWritable())
    return Promise.reject(new Error("backend_disconnected"));
  if (pending.size >= 64) return Promise.reject(new Error("backpressure"));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const line = JSON.stringify({ id, command, input }) + "\n";
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
      command === "velaWorkflowRun" ? 360000
        : command === "conversationSend" || command === "velaFileEditApply" ? 120000 : 90000,
    );
    pending.set(id, { resolve, reject, timer });
    writeBackend(line);
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
      "--native-media",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.on("error", failBackend);
  child.on("error", failBackend);
  child.on("exit", failBackend);
  nativeSecretBroker = createProtectedStorageBroker({
    safeStorage,
    isReady: () => app.isReady(),
    platform: process.platform,
    send: (wire) => writeBackend(JSON.stringify(wire) + "\n"),
  });
  providerConnections = createProviderConnectionBroker({
    call,
    openExternal: (url) => shell.openExternal(url),
  });
  // Native diagnostics may contain private paths; never forward stderr to the renderer or public evidence.
  child.stderr.on("data", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (backendFailed) return;
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
      failBackend();
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    useContentSize: process.argv.includes("--integration-drag-glide"),
    minWidth: 800,
    minHeight: 650,
    show: !offscreenScale && !verifyAirPlan,
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
  const owner = win.webContents;
  const mediaOwnerAlive = () => !owner.isDestroyed() && owner.getURL() === localURL;
  const playback = createMediaPlayback({ call, ownerAlive: mediaOwnerAlive });
  session.defaultSession.protocol.handle(mediaScheme, playback.handle);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const external = /^(https?|wss?):/i.test(details.url);
    const foreignMedia = details.url.startsWith(`${mediaScheme}:`) &&
      (!mediaOwnerAlive() || details.webContentsId !== owner.id || details.resourceType !== "media");
    callback({ cancel: external || foreignMedia });
  });
  owner.on("render-process-gone", playback.clear);
  owner.on("destroyed", playback.clear);
  owner.on("did-start-loading", playback.clear);
  const mediaCommand = require("./media-broker.cjs").createMediaBroker({ win, dialog, shell, call, playback });
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
        ![
          "replay",
          "executionStatus",
          "conversationActivity",
          "openResource",
          "interrupt",
          "firstPartyChat",
        ].includes(command) &&
        !(command === "conversation" && isConversationRead(input)) &&
        !(command === "media" && ["describe", "readBytes", "acquirePlayback", "releasePlayback"].includes(input?.name)) &&
        !(command === "vela" && isVelaRead(input)) &&
        !(command === "missions" && ["preview", "list", "read", "workroom-preview", "workroom-resource", "team-library"].includes(input?.name)) &&
        !(command === "githubTimeline" && ["sources", "openCommit"].includes(input?.name)) &&
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
        !(command === "desktop" && input?.type === "snapshot") &&
        !(await storage.allowWrite())
      )
        throw new Error("storage_reserve_admission_denied");
      if (win.isDestroyed() || win.webContents.isDestroyed() ||
          event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== localURL)
        throw new Error("unauthorized_sender");
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
      else if (command === "media")
        result = await mediaCommand(input);
      else if (command === "reconcileConversationTurn")
        result = await call("reconcileConversationTurn", input);
      else if (command === "executionStatus")
        result = Object.values((await call("snapshot", {})).executions);
      else if (command === "interrupt")
        result = await call("interrupt", { executionId: input.executionId });
      else if (command === "firstPartyChat") {
        result = await firstPartyChatCommand({
          input,
          win,
          openExternal: (url) => shell.openExternal(url),
        });
      } else if (command === "conversation") {
        result = await conversationCommand({ win, call, input, openExternal: (url) => shell.openExternal(url) });
      } else if (command === "vela") {
        result = await velaCommand({
          win,
          dialog,
          call,
          input,
          observeNativeRequest: observeVelaRequest,
          offerPlanningByDefault: !verify || verifyAirLocal,
          directMessageSend: !verify || verifyAirLocal,
          routeNative: true,
          requireInspectionDirectory: !verify && process.platform === "win32",
        });
      } else if (command === "githubTimeline") {
        if (input?.name === "openCommit") {
          const { url } = await call("githubTimeline", input);
          if (win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame ||
              event.senderFrame?.url !== localURL ||
              typeof url !== "string" || !/^https:\/\/github\.com\/[a-z\d-]{1,39}\/[a-z\d_.-]{1,100}\/commit\/[a-f\d]{40}$/i.test(url))
            throw new Error("github_commit_unavailable");
          await shell.openExternal(url);
          result = { opened: true };
        } else if (input?.name === "sources") result = await call("githubTimeline", input);
        else throw new Error("unsupported_command");
      } else if (command === "library") {
        result = await call("library", input);
      } else if (command === "notes") {
        result = await call("notes", input);
      } else if (command === "missions") {
        if (input?.name === "plan") {
          const offer = await call("missions", { name: "preview", input: { objective: input.input?.objective } });
          if (offer?.kind !== "planning-offer" || offer.fingerprint !== input.input?.fingerprint)
            throw Error("mission_preview_changed");
          if (!offer.planner) throw Error("mission_planner_unavailable");
          const { model, effort, capabilities } = offer.planner;
          const choice = await dialog.showMessageBox(win, {
            type: "question", buttons: ["Cancel", "Request plan"], defaultId: 0, cancelId: 0,
            title: "Review mission planning request", message: "Send one planning request to ChatGPT plan?",
            detail: `Model: ${model}${effort ? " · " + effort : ""}\n\nObjective:\n${offer.objective}\n\nCapability descriptions:\n${capabilities.join("\n")}\n\nReview the resulting tasks before starting the mission.`,
          });
          if (choice.response !== 1) throw Error("mission_review_declined");
          if (win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== localURL)
            throw Error("unauthorized_sender");
          if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
          result = await call("missionPlanReviewed", input.input);
        } else if (input?.name === "start") {
          const preview = await call("missions", { name: "preview", input: {
            objective: input.input?.objective, ...(input.input?.agentProfileId ? { agentProfileId: input.input.agentProfileId } : {}),
            ...(input.input?.proposalId ? { proposalId: input.input.proposalId } : {}),
            ...(input.input?.teamId ? { teamId: input.input.teamId } : {}),
          } });
          if (!preview?.plan || preview.fingerprint !== input.input?.fingerprint) throw Error("mission_preview_changed");
          let approvedProjectCheck;
          if (preview.externalReview) {
            if (preview.executors.some(executor => !executor.available)) throw Error("mission_specialist_unavailable");
            const { provider, calls } = preview.externalReview;
            const assignments = preview.plan.tasks.filter(task => task.specialist).map(({ specialist }) =>
              `${specialist.role} — ${specialist.model}${specialist.effort ? " · " + specialist.effort : ""}${specialist.webSearch ? " · public web search" : ""}\n${specialist.instructions}`);
            const choice = await dialog.showMessageBox(win, {
              type: "question", buttons: ["Cancel", preview.localReview ? "Approve specialists" : "Start mission"], defaultId: 0, cancelId: 0,
              title: "Review specialist mission", message: `Send ${calls} separate requests to ${provider}?`,
              detail: `Objective sent to each specialist:\n${preview.plan.objective}\n\nInstructions:\n${assignments.join("\n\n")}\n\nThe provider may count these requests against your plan. No files, chat history or local measurements are sent.`,
            });
            if (choice.response !== 1) throw Error("mission_review_declined");
          }
          if (preview.localReview) {
            if (preview.executors.some(executor => !executor.available)) throw Error("mission_project_check_unavailable");
            const selected = await dialog.showOpenDialog(win, {
              title: "Choose tracked Node test files in one Git checkout",
              properties: ["openFile", "multiSelections"],
              filters: [{ name: "Node test sources", extensions: ["js", "cjs", "mjs", "ts", "mts"] }],
            });
            if (selected.canceled || !selected.filePaths.length) throw Error("mission_review_declined");
            const paths = selected.filePaths;
            if (paths.length > preview.localReview.maxFiles) throw Error("mission_project_check_selection_limit");
            const review = await call("missionCheckReview", { paths });
            const choice = await dialog.showMessageBox(win, {
              type: "question", buttons: ["Cancel", "Run reviewed mission"], defaultId: 0, cancelId: 0,
              title: "Review read-only project tests", message: "Run the selected Node tests alongside native measurements?",
              detail: `Checkout: ${review.cwd}\nCommit: ${review.head}\nArguments: ${JSON.stringify(review.argv)}\n\nCodex runs the selected command in a read-only sandbox with zero model requests. The sandbox requests restricted networking. Effective isolation depends on the installed Windows sandbox mode.`,
            });
            if (choice.response !== 1) throw Error("mission_review_declined");
            approvedProjectCheck = { paths, digest: review.digest };
          }
          if (preview.externalReview || approvedProjectCheck) {
            if (win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== localURL)
              throw Error("unauthorized_sender");
            if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
            result = await call("missionStartReviewed", { ...input.input, ...(approvedProjectCheck ? { approvedProjectCheck } : {}) });
          } else result = await call("missions", input);
        } else result = await call("missions", input);
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
  if (verifyAirPlan) {
    await require("../../../vela-core/test/native-plan-evaluation.cjs").run({ win, app, privateRoot, call });
    return;
  }
  if (offscreenScale) {
    await require("./integration-offscreen-scale.cjs").verify({
      win, app, privateRoot, call, source, moduleStartedMonotonicMs, startupErrors,
    });
    return;
  }
  if (!verify && !checkCatalog) {
    let renewing = false;
    const maintainSession = async () => {
      if (closing || renewing || win.isDestroyed()) return;
      renewing = true;
      try {
        if (await storage.allowWrite())
          await call("providerAuth", {
            type: "maintain",
            providerId: "chatgpt-plan-responses",
          });
      } catch {
        // Background recovery never opens a browser or retries a chat turn.
      } finally {
        renewing = false;
      }
    };
    win.on("focus", maintainSession);
    const sessionTimer = setInterval(maintainSession, 30000);
    sessionTimer.unref();
    win.once("closed", () => clearInterval(sessionTimer));
    void maintainSession();
  }
  win.show();
  win.focus();
  active();
  const reserveTimer = setInterval(() => { void storage.recheck(); }, 240000);
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
    if (verifyMissions) {
      await require("./integration-vela-missions.cjs").verify({
        win, app, privateRoot, call, source, startupErrors, moduleStartedMonotonicMs,
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
      process.argv.includes("--integration-benchmark")
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
