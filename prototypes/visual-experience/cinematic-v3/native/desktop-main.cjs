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
  powerMonitor,
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
const {createMissionFileEditBroker,PRIVATE_MISSION_FILE_EDIT_COMMANDS}=require('./mission-file-edit-broker.cjs');
const {showVelaReview}=require('./vela-review.cjs');
const {createDocumentExtractionBroker}=require('./document-extraction-broker.cjs');
const { productCommand, isProductRead } = require("./product-commands.cjs");
const { firstPartyChatCommand } = require("./first-party-chat.cjs");
const { createProtectedStorageBroker } = require("./protected-storage.cjs");
const { createClipboardCapability } = require("./clipboard-capability.cjs");
const {
  createProviderConnectionBroker,
} = require("./provider-connections.cjs");
const { createVelaApiSetup } = require('./vela-api-setup.cjs');
const { createVelaApiConnectionBroker, safeApiStatus } = require('./vela-api-connections.cjs');
const { createLiveMediaBroker } = require('./live-media-broker.cjs');
const {createWindowsSystemBroker}=require('./windows-system-broker.cjs');
const {createWindowsMaintenanceBroker}=require('./windows-maintenance-broker.cjs');
const {createWindowsComputerBroker}=require('./windows-computer-broker.cjs');
const {reviewVelaOwner}=require('./vela-owner-review.cjs');
const {startReviewedMission}=require('./mission-start-broker.cjs');
const { reviewMissionExecutive } = require("./mission-executive-broker.cjs");
const { createVelaVoiceBroker } = require('./vela-voice-broker.cjs');
const { createWakeMediaBroker } = require('./wake-media-broker.cjs');
const { loadWakeController } = require('./wake-controller-loader.cjs');
const { createVelaWakeBroker } = require('./vela-wake-broker.cjs');
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
    else if (/\.(?:ts|mts|css|cjs|cpp|sql|html)$/.test(entry.name))
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
  "prototypes/timer-product",
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
if (verifyMissions) {
  if(process.argv.includes('--missions-persistence-reopen-only'))require('./mission-persistence.cjs').assertMissionPersistenceReopen({profile:privateRoot,argv:process.argv,source});
  else if(!/^review-vela-missions-\d+$/u.test(path.basename(privateRoot))||existsSync(privateRoot))throw Error('fresh_offline_mission_profile_required');
}
if(process.argv.includes('--weather-deny-fixture')&&(!verifyMissions||!process.argv.includes('--missions-weather-product-only')||!process.env.LOCALAPPDATA||path.resolve(path.dirname(privateRoot)).toLowerCase()!==path.resolve(process.env.LOCALAPPDATA,'Aerynth').toLowerCase()||process.argv.filter(value=>value.startsWith('--profile=')).length!==1))throw Error('owned_weather_fixture_journey_required');
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
let windowsSystemBroker;
let windowsMaintenanceBroker;
let windowsComputerBroker;
const maintenanceReviewFrames=new Map();
let documentTextBroker;
let providerConnections;
let velaApiSetup;
let velaApiConnections;
let liveMediaBroker;
let velaVoiceBroker;
let wakeController;
let velaWakeBroker;
let nativeClipboard;
const storage = createStorageAdmission({
  probe: runtimeReserve,
  initiallyAdmitted: true,
  changed(admitted) {
    if (closing) return;
    sendMissionHostSignal({ storageAdmitted: admitted });
    sendToWindow(win, "application-event", {
      type: admitted ? "storage/reserve-admission-restored" : "storage/reserve-admission-denied",
      classification: "observed",
    });
    if (admitted) return;
    windowsMaintenanceBroker?.revoke();windowsComputerBroker?.revoke();maintenanceReviewFrames.clear();
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
  windowsSystemBroker?.close();
  windowsMaintenanceBroker?.close();maintenanceReviewFrames.clear();
  windowsComputerBroker?.close();
  nativeSecretBroker?.close();
  providerConnections?.close();
  velaApiSetup?.close();
  velaApiConnections?.close();
  velaVoiceBroker?.close();
  velaWakeBroker?.close(); wakeController?.dispose();
  liveMediaBroker?.close();
  documentTextBroker?.close();
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
  const cleanup=command==='close'||command==='velaWakeCaptureState'||command==='velaWake'&&['masterOff','disableWake'].includes(input?.name)||command==='velaVoice'&&(['stop','stopSpeech'].includes(input?.name)||input?.name==='setSpeakReplies'&&input?.input?.enabled===false);
  if (pending.size >= (cleanup?68:64)) return Promise.reject(new Error("backpressure"));
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
let timerResumeBarrier = Promise.resolve();
function sendMissionHostSignal(missionHostSignal) {
  if (!closing && backendWritable()) {
    try { writeBackend(JSON.stringify({ missionHostSignal }) + "\n"); } catch { /* The backend transport reports disconnect. */ }
  }
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
      "--native-system-facts",
      "--native-maintenance",
      "--native-computer",
      "--native-documents",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.on("error", failBackend);
  child.on("error", failBackend);
  child.on("exit", failBackend);
  powerMonitor?.on?.('resume', () => {
    if (closing || !backendWritable()) return;
    timerResumeBarrier = call('timerHostResume', {});
    void timerResumeBarrier.catch(() => {});
  });
  documentTextBroker=createDocumentExtractionBroker({BrowserWindow,ipcMain,call,send:wire=>writeBackend(JSON.stringify(wire)+'\n'),preloadPath:path.join(root,'dist/vela-document-text-preload.cjs'),htmlPath:path.join(__dirname,'document-text.html')});
  nativeSecretBroker = createProtectedStorageBroker({
    safeStorage,
    isReady: () => app.isReady(),
    platform: process.platform,
    send: (wire) => writeBackend(JSON.stringify(wire) + "\n"),
  });
  windowsSystemBroker=createWindowsSystemBroker({root,getOwner:()=>win,dialog,send:wire=>writeBackend(JSON.stringify(wire)+'\n')});
  try {
    wakeController = loadWakeController(root)({call,send:wire=>writeBackend(JSON.stringify(wire)+'\n'),
      capture:onFrame=>createWakeMediaBroker({BrowserWindow,ipcMain,onFrame,onState:state=>{
        if(!['failed','stopped','disposed'].includes(state.phase)||wakeController?.state().generation!==state.generation)return;
        const attemptId=wakeController.state().liveAttemptId;
        if(attemptId)liveMediaBroker?.wakeSourceLost(attemptId);
        void call('velaWakeCaptureState',state).catch(()=>{});
      },
        preloadPath:path.join(root,'dist/vela-wake-capture-preload.cjs'),
        htmlPath:path.join(__dirname,'wake-media.html'),workletPath:path.join(root,'dist/vela-wake-pcm-worklet.js')})});
  } catch { wakeController = null; }
  liveMediaBroker = createLiveMediaBroker({ BrowserWindow, ipcMain,
    authorizeOutputOnlyPrepare:async input=>{
      if(closing||backendFailed||input?.outputOnly!==true||!await storage.allowWrite())return false;
      const ack=await call('velaVoiceNative',{name:'authorizeSpeechMedia',input:{attemptId:input.attemptId}});
      return !closing&&!backendFailed&&await storage.allowWrite()&&ack?.authorized===true&&Object.keys(ack).length===1;
    },
    ...(wakeController?{wakeSource:{claimLive:(ref,attempt,feed)=>wakeController.claimLive(ref,attempt,feed),releaseLive:attempt=>wakeController.releaseLive(attempt)}}:{}),
    send: wire => writeBackend(JSON.stringify(wire) + '\n'),
    preloadPath: path.join(root, 'dist/vela-live-media-preload.cjs'),
    htmlPath: path.join(__dirname, 'voice-media.html'),
    syntheticInput: process.argv.includes('--missions-voice-live-only') && process.argv.includes('--voice-synthetic-input'),
  });
  providerConnections = createProviderConnectionBroker({
    call,
    openExternal: (url) => shell.openExternal(url),
  });
  velaApiSetup = createVelaApiSetup({ BrowserWindow, ipcMain,
    storageAllowed: () => storage.allowWrite(),
    status: async () => safeApiStatus(await call('velaApiConnection', { type: 'status' })),
    configure: async (credential, expectedVersion) => safeApiStatus(await call('velaApiConfigure', { credential, expectedVersion })),
  });
  // Native diagnostics may contain private paths; never forward stderr to the renderer or public evidence.
  child.stderr.on("data", () => {});
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (backendFailed) return;
    try {
      const m = JSON.parse(line);
      if (wakeController?.handle(m)) return;
      if (m.nativeWakeHost) { const h=m.nativeWakeHost; writeBackend(JSON.stringify({nativeWakeHost:{version:1,kind:'response',id:h.id,operation:h.operation,error:'wake_host_unavailable'}})+'\n'); return; }
      if(windowsSystemBroker.handle(m))return;
      if(windowsMaintenanceBroker?.handle(m))return;
      if(windowsComputerBroker?.handle(m))return;
      if(documentTextBroker.handle(m))return;
      if (nativeSecretBroker.handle(m)) return;
      if (liveMediaBroker.handle(m)) return;
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
    titleBarOverlay: { color: "#00000000", symbolColor: "#e5e3f2", height: 44 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "desktop-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(offscreenScale ? { offscreen: true, backgroundThrottling: false } : {}),
      additionalArguments: process.argv.includes("--integration-drag-glide") || process.argv.includes("--integration-expanded")
        ? ["--aerynth-geometry-observation"]
        : [],
    },
  });
  const owner = win.webContents;
  let lastMissionActivity = -Infinity;
  const observeMissionActivity = () => {
    const at = performance.now();
    if (!win.isFocused() || owner.getURL() !== localURL || at - lastMissionActivity < 1000) return;
    lastMissionActivity = at;
    sendMissionHostSignal({ foregroundInput: true });
  };
  owner.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown") observeMissionActivity();
  });
  owner.on("before-mouse-event", (_event, input) => {
    if (input.type === "mouseDown") observeMissionActivity();
  });
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
  owner.on('render-process-gone', () => {
    windowsMaintenanceBroker?.revoke();windowsComputerBroker?.revoke();maintenanceReviewFrames.clear();
    // Stop local capture immediately even when the application renderer cannot send End.
    documentTextBroker?.close();velaWakeBroker?.close(); wakeController?.dispose(); velaVoiceBroker?.close(); liveMediaBroker?.close();
    void call('velaWake', {name:'masterOff',input:{}}).catch(() => {});
    void call('velaVoice', {name:'stop',input:{}}).catch(() => {});
  });
  owner.on("destroyed", playback.clear);
  owner.on("did-start-loading", playback.clear);
  owner.on('did-start-loading',()=>{windowsMaintenanceBroker?.revoke();windowsComputerBroker?.revoke();maintenanceReviewFrames.clear();});
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
  const trustedApplicationFrame = (event) =>
    !win.isDestroyed() &&
    !win.webContents.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame?.url === localURL;
  // The renderer has one compose submission at a time. Core still owns its result.
  const velaSubmissions = new WeakMap();
  const isVelaSubmissionId = (id) => typeof id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id);
  const trustedActiveFrame = (event) =>
    trustedApplicationFrame(event) &&
    win.isVisible() &&
    !win.isMinimized() &&
    win.isFocused();
  let nativeReviewBusy=false;
  const nativeReviewGate=async work=>{if(nativeReviewBusy)throw Error('native_review_busy');nativeReviewBusy=true;try{return await work();}finally{nativeReviewBusy=false;}};
  const reviewProvider=args=>nativeReviewGate(()=>showVelaReview(args));
  const reviewDialogs={showMessageBox:(...args)=>nativeReviewGate(()=>dialog.showMessageBox(...args)),showOpenDialog:(...args)=>nativeReviewGate(()=>dialog.showOpenDialog(...args)),showSaveDialog:(...args)=>nativeReviewGate(()=>dialog.showSaveDialog(...args))};
  const validateHostOperation=async(binding,{phase='before-dispatch'}={})=>{
      const frame=maintenanceReviewFrames.get(binding.operationId);
      const trusted=()=>!closing&&!backendFailed&&!!frame&&maintenanceReviewFrames.get(binding.operationId)===frame&&(phase==='after-dispatch'?trustedApplicationFrame:trustedActiveFrame)({sender:win.webContents,senderFrame:frame});
      if(!trusted()||!await storage.allowWrite()||!trusted())return false;
      const current=await call('hostOperationReviewNative',{operationId:binding.operationId});
      return trusted()&&await storage.allowWrite()&&trusted()&&JSON.stringify(current)===JSON.stringify(binding);
  };
  const protectedPids=()=>[process.pid,child?.pid,...app.getAppMetrics().map(metric=>metric.pid)].filter(Number.isSafeInteger);
  windowsMaintenanceBroker=createWindowsMaintenanceBroker({root,getOwner:()=>win,dialog:reviewDialogs,call,
    send:wire=>writeBackend(JSON.stringify(wire)+'\n'),getProtectedPids:protectedPids,canReclaim:validateHostOperation});
  windowsComputerBroker=createWindowsComputerBroker({root,getOwner:()=>win,dialog:reviewDialogs,call,
    send:wire=>writeBackend(JSON.stringify(wire)+'\n'),getProtectedPids:protectedPids,canAct:validateHostOperation});
  const missionFileEditBroker=createMissionFileEditBroker({win,trustedDocumentUrl:localURL,call,nodeExecutable:backendExecutable(process.env.AERYNTH_NODE_BIN),runtime:{BrowserWindow,ipcMain,session,dialog},reviewGate:nativeReviewGate});
  velaVoiceBroker = createVelaVoiceBroker({call,mediaBroker:liveMediaBroker,
    maximumVoiceSeconds: process.argv.includes('--missions-voice-live-only') && process.argv.includes('--voice-synthetic-input') ? 30 : 300,
    storageAllowed: () => storage.allowWrite(),
    authorize: async context => context?.observedGesture === true && trustedActiveFrame(context.event),
  });
  velaApiConnections = createVelaApiConnectionBroker({ call,
    setup: () => velaApiSetup.open(win),
    authorize: async context => context?.observedGesture === true && trustedActiveFrame(context.event),
  });
  velaWakeBroker = createVelaWakeBroker({call,storageAllowed:()=>storage.allowWrite(),
    authorize:async context=>context?.observedGesture===true&&trustedActiveFrame(context.event),
    masterOffLocal:async()=>{try{wakeController?.masterOffLocal();}finally{await liveMediaBroker.quiesceAll();}}});
  nativeClipboard = createClipboardCapability({
    writeText: (text) => clipboard.writeText(text),
    isTrustedApplicationFrame: trustedActiveFrame,
    authorizeUserCopy: async (event) => {
      if (!trustedActiveFrame(event)) return false;
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
  win.on("closed", () => { documentTextBroker?.close();velaWakeBroker?.close(); wakeController?.dispose(); windowsSystemBroker?.close();windowsMaintenanceBroker?.close();windowsComputerBroker?.close();maintenanceReviewFrames.clear(); nativeClipboard?.close(); velaApiSetup?.close(); velaApiConnections?.close(); velaVoiceBroker?.close(); liveMediaBroker?.close(); });
  ipcMain.handle("application-command", async (event, command, input) => {
    try {
      if(PRIVATE_MISSION_FILE_EDIT_COMMANDS.includes(command)||['hostOperationReviewNative','hostOperationDispatchNative','hostOperationResultNative'].includes(command))throw Error('unauthorized_private_command');
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
      let apiGesture = false;
      let voiceGesture = false;
      let wakeGesture = false;
      if(command==='folders'&&input?.type==='openExternal'){
        if(!trustedActiveFrame(event)||await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()',false).catch(()=>false)!==true||!trustedActiveFrame(event))throw Error('folder_user_gesture_required');
      }
      if (command === 'velaWake' && ['enable','save'].includes(input?.name)) {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error('wake_user_gesture_required');
        wakeGesture = true;
      }
      if (command === 'weatherPermission' && input?.type !== 'status') {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error('weather_user_gesture_required');
      }
      if (command === 'velaVoice' && (['start','reconnect','audition','speak','createVoice','saveVoice'].includes(input?.name)||input?.name==='setSpeakReplies'&&input?.input?.enabled===true)) {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error('voice_user_gesture_required');
        voiceGesture = true;
      }
      if (command === 'velaApiConnection' && !['status','usageStatus'].includes(input?.type)) {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error('api_user_gesture_required');
        apiGesture = true;
      }
      const clockMutation = command === 'clockTimers' && ['create', 'mutate'].includes(input?.name) ||
        command === 'library' && input?.name === 'createBlock' && input?.input?.kind === 'clock_timer' ||
        command === 'desktop' && input?.type === 'createResource' && input?.kind === 'clock_timer';
      if (clockMutation) {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()', false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error('timer_user_gesture_required');
      }
      if (command === 'clockTimers' || command === 'library' || clockMutation) await timerResumeBarrier;
      if (command === "missions" && input?.name === "revision-apply") {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript("navigator.userActivation.isActive && document.hasFocus()", false).catch(() => false) !== true ||
            !trustedActiveFrame(event))
          throw Error("mission_user_gesture_required");
      }
      if (command === "workspaceRecovery" && input?.name === "apply") {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript("navigator.userActivation.isActive && document.hasFocus()", false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error("workspace_recovery_user_gesture_required");
      }
      if (command === "vela" && ["request", "native", "apply", "pickSources", "fileProposal", "missionFileEdit", "hostOperation"].includes(input?.name)) {
        if (!trustedActiveFrame(event) ||
            await event.senderFrame.executeJavaScript("navigator.userActivation.isActive && document.hasFocus()", false).catch(() => false) !== true ||
            !trustedActiveFrame(event)) throw Error("vela_user_gesture_required");
      }
      if (
        ![
          "rendererEventPage",
          "replay",
          "executionStatus",
          "conversationActivity",
          "openResource",
          "interrupt",
          "firstPartyChat",
          "folders",
        ].includes(command) &&
        !(command === "conversation" && isConversationRead(input)) &&
        !(command === "media" && ["describe", "readBytes", "acquirePlayback", "releasePlayback"].includes(input?.name)) &&
        !(command === "vela" && (isVelaRead(input) || input?.name === "submissionStatus")) &&
        !(command === "missions" && ["preview", "list", "read", "revision-preview", "workroom-preview", "workroom-resource", "team-library"].includes(input?.name)) &&
        !(command === "workspaceRecovery" && ["state", "preview"].includes(input?.name)) &&
        !(command === "githubTimeline" && ["sources", "openCommit"].includes(input?.name)) &&
        !isProductRead(command, input) &&
        !(command === "notes" && input?.name === "readNote") &&
        !(command === "providerConnection" && input?.type === "status") &&
        !(command === 'velaApiConnection' && ['status', 'usageStatus', 'catalog'].includes(input?.type)) &&
        !(command === 'weatherPermission' && ['status', 'windows-settings'].includes(input?.type)) &&
        !(command === 'velaWake' && ['state','disableWake','masterOff','reconcile'].includes(input?.name)) &&
        !(command === 'velaVoice' && (['state','devices','refreshVoices','stop','stopSpeech','mute','setInputDevice','setOutputDevice','resumePlayback','interruptPlayback'].includes(input?.name)||input?.name==='setSpeakReplies'&&input?.input?.enabled===false)) &&
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
      else if (command === 'velaApiConnection') {
        result = await velaApiConnections.command(input, { event, observedGesture: apiGesture });
      }
      else if (command === 'velaVoice') {
        result = await velaVoiceBroker.command(input, {event, observedGesture: voiceGesture});
      }
      else if (command === 'weatherPermission') {
        result = await windowsSystemBroker.permission(input, call, url => shell.openExternal(url));
      }
      else if (command === 'velaWake') {
        result = await velaWakeBroker.command(input,{event,observedGesture:wakeGesture});
      }
      else if(command==='folders'){
        if(input?.type==='openExternal'){
          if(!input||Object.keys(input).some(key=>!['type','resourceId','entryId'].includes(key))||typeof input.resourceId!=='string'||input.entryId!==undefined&&typeof input.entryId!=='string')throw Error('invalid_folder_request');
          const target=await call('folderOpenNative',{resourceId:input.resourceId,...(input.entryId?{entryId:input.entryId}:{})});
          if(typeof target?.path!=='string'||!path.isAbsolute(target.path))throw Error('folder_target_unavailable');
          const failure=await shell.openPath(target.path);if(failure)throw Error('folder_open_failed');result={opened:true};
        }else result=await call('folders',input);
      }
      else if (command === "graphAction")
        result = await require("./graph-actions.cjs").graphAction(input, call);
      else if (command === "viewState") result = await call("viewState", input);
      else if (command === "capabilities")
        result = await call("capabilities", {});
      else if (command === "rendererEventPage")
        result = await call("rendererEventPage", input);
      else if (command === "replay") {
        // Legacy review callers receive the old bounded tail shape, still
        // projected by Core under the current renderer authorization.
        const { events, earliest, latest, truncated } = await call("rendererEventPage", { recent: true, limit: 250 });
        result = { events, earliest, latest, truncated };
      }
      else if (command === "conversationActivity")
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
        result = await conversationCommand({ win, call, input,reviewSources:reviewProvider, openExternal: (url) => shell.openExternal(url) });
      } else if (command === "vela") {
        if (input?.name === "submissionStatus") {
          const submissionId = input.input?.submissionId;
          if (!isVelaSubmissionId(submissionId)) throw Error("invalid_vela_submission");
          const frame = event.senderFrame;
          const submission = velaSubmissions.get(frame);
          result = null;
          if (submission?.id === submissionId && submission.requestId) {
            const state = await call("vela", { name: "state", input: {} });
            if (trustedApplicationFrame(event) && velaSubmissions.get(frame) === submission)
              result = state.requests.find((request) => request.id === submission.requestId) ?? null;
          }
        } else if(input?.name==='hostOperation'){
          const request=input.input;
          if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).length!==1||
            typeof request.operationId!=='string'||!/^[a-z0-9][a-z0-9_.:-]{0,127}$/iu.test(request.operationId))throw Error('invalid_host_operation');
          if(maintenanceReviewFrames.has(request.operationId))throw Error('native_review_busy');
          maintenanceReviewFrames.set(request.operationId,event.senderFrame);
          try{
            const binding=await call('hostOperationReviewNative',{operationId:request.operationId});
            if(binding?.contract==='aerynth.windows.maintenance-review@1')result=await windowsMaintenanceBroker.review(request.operationId);
            else if(binding?.contract==='aerynth.windows.computer-review@1')result=await windowsComputerBroker.review(request.operationId);
            else if(binding?.contract==='aerynth.vela.owner-review@1')result=await reviewVelaOwner({binding,win,event,localURL,call,dialog:reviewDialogs,storage,
              canAct:validateHostOperation,reviewGate:nativeReviewGate,runtime:{BrowserWindow,ipcMain,session,dialog},nodeExecutable:backendExecutable(process.env.AERYNTH_NODE_BIN)});
            else throw Error('invalid_host_operation');
          }
          finally{maintenanceReviewFrames.delete(request.operationId);}
        } else if (input?.name === 'missionFileEdit') {
          result = await missionFileEditBroker.command(event, input.input);
        } else {
          const { submissionId, ...brokerInput } = input ?? {};
          const frame = event.senderFrame;
          let submission;
          if (submissionId !== undefined) {
            if (input.name !== "request" || !isVelaSubmissionId(submissionId)) throw Error("invalid_vela_submission");
            submission = { id: submissionId, requestId: null };
            velaSubmissions.set(frame, submission);
          }
          result = await velaCommand({
            win,
            dialog:reviewDialogs,
            call,
            input: brokerInput,
            reviewProvider,
            missionFileEditRequest:request=>missionFileEditBroker.prepare(event,request),
            observeNativeRequest: observeVelaRequest,
            offerPlanningByDefault: !verify || verifyAirLocal,
            directMessageSend: !verify || verifyAirLocal || verifyMissions && (process.argv.includes('--missions-api-live-only')||process.argv.includes('--missions-persistence-live-only')),
            routeNative: true,
            requireInspectionDirectory: !verify && process.platform === "win32",
          });
          if (submission && typeof result?.id === "string") submission.requestId = result.id;
        }
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
      } else if (command === "workspaceRecovery") {
        result = await call("workspaceRecovery", input);
      } else if (command === "library") {
        result = await call("library", input);
      } else if (command === "notes") {
        result = await call("notes", input);
      } else if (command === "missions") {
        if (input?.name === "executive-review") {
          if (!trustedActiveFrame(event)) throw Error("unauthorized_sender");
          result = await reviewMissionExecutive({ request: input.input, parent: win, call, reviewProvider,
            isCurrent: () => trustedApplicationFrame(event) && win.isVisible() && !win.isMinimized(),
            allowWrite: () => storage.allowWrite() });
        } else if (input?.name === "plan") {
          const { objective, noteIds, fileIds, fingerprint } = input.input ?? {};
          const offer = await call("missions", { name: "preview", input: { objective, noteIds, fileIds } });
          if (offer?.kind !== "planning-offer" || offer.fingerprint !== input.input?.fingerprint)
            throw Error("mission_preview_changed");
          if (!offer.planner) throw Error("mission_planner_unavailable");
          const { model, effort, capabilities, provider } = offer.planner;
          let approved;
          const hasSources = Boolean(offer.notes || offer.files);
          if (hasSources) {
            const reviewed = await call("missionPlanningReview", { objective, noteIds, fileIds, fingerprint });
            const matches = (sources, expected) => Array.isArray(sources) &&
              JSON.stringify(sources.map(({ text, ...ref }) => ref)) === JSON.stringify(expected ?? []);
            if (!trustedActiveFrame(event) || reviewed?.offer?.fingerprint !== fingerprint ||
              reviewed.offer.planner?.provider !== "openai-api-vela" ||
              !matches(reviewed.notes, offer.notes) || !matches(reviewed.files, offer.files))
              throw Error("mission_preview_changed");
            const prompt = JSON.stringify({ objective, capabilities }, null, 2);
            approved = await reviewProvider({ parent: win, intent: objective, expiresAt: new Date(Date.now() + 90_000).toISOString(),
              review: { providerId: provider, semanticContext: true, missionPlanning: true, prompt,
                promptDigest: createHash("sha256").update(JSON.stringify(prompt)).digest("hex"),
                route: { kind: "app-planning", model, effort },
                context: { included: [
                  ...reviewed.notes.map(note => ({ id: note.id, kind: "resource", resourceKind: "note", title: note.title, content: note.text })),
                  ...reviewed.files.map(file => ({ id: file.id, kind: "resource", resourceKind: "file", title: file.title, content: file.text })),
                ] },
              },
            });
          } else {
            const choice = await reviewDialogs.showMessageBox(win, {
            type: "question", buttons: ["Cancel", "Request plan"], defaultId: 0, cancelId: 0,
            title: "Review mission planning request", message: `Send one planning request to ${provider==='openai-api-vela'?'Vela’s dedicated API':'ChatGPT plan'}?`,
            detail: `Model: ${model}${effort ? " · " + effort : ""}\n\nObjective:\n${offer.objective}\n\nCapability descriptions:\n${capabilities.join("\n")}\n\nReview the resulting tasks before starting the mission.`,
            });
            approved = choice.response === 1;
          }
          if (approved !== true) throw Error("mission_review_declined");
          if (win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== localURL)
            throw Error("unauthorized_sender");
          if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
          if (hasSources && !trustedActiveFrame(event)) throw Error("unauthorized_sender");
          result = await call("missionPlanReviewed", input.input);
        } else if (input?.name === "revision-apply") {
          const { fingerprint, ...revisionInput } = input.input ?? {};
          const preview = await call("missions", { name: "revision-preview", input: revisionInput });
          if (preview?.kind !== "revision-preview" || preview.missionId !== revisionInput.id ||
              preview.revision !== revisionInput.revision || preview.fingerprint !== fingerprint)
            throw Error("mission_revision_preview_changed");
          if (!trustedActiveFrame(event)) throw Error("unauthorized_sender");
          if (preview.externalReview) {
            const { provider, model, effort, objective, instructions, webSearch } = preview.externalReview;
            const choice = await reviewDialogs.showMessageBox(win, {
              type: "question", buttons: ["Cancel", "Approve reassignment"], defaultId: 0, cancelId: 0,
              title: "Review mission specialist reassignment",
              message: "Apply this reassignment to the paused mission?",
              detail: [
                preview.summary,
                `Provider · ${provider}\nModel · ${model}\nReasoning effort · ${effort ?? "Model default"}\nPublic web search · ${webSearch ? "Enabled" : "Disabled"}`,
                `Mission objective\n${objective}`,
                `Specialist instructions\n${instructions}`,
                provider === 'Vela dedicated API' ? "One request may be sent when you resume this mission using the dedicated API key and authorized usage limits." : "One request may be sent when you resume this mission. The provider may count it against your plan.",
              ].join("\n\n"),
            });
            if (choice.response !== 1) throw Error("mission_review_declined");
          }
          if (!trustedApplicationFrame(event)) throw Error("unauthorized_sender");
          if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
          if (!trustedApplicationFrame(event)) throw Error("unauthorized_sender");
          result = await call("missionRevisionReviewed", { ...revisionInput, fingerprint });
        } else if (input?.name === "start") {
          result = await startReviewedMission({win,event,localURL,storage,call,dialog:reviewDialogs,input});
        } else result = await call("missions", input);
      } else if (
        command === "agents" ||
        command === "checklists" ||
        command === "clockTimers" ||
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
  if(process.argv.includes('--weather-deny-fixture')){
    if(!verifyMissions||!process.argv.includes('--missions-weather-product-only'))throw Error('owned_weather_fixture_journey_required');
    const permission=await call('velaWeatherPermissionNative',{type:'status'});
    if(permission.decision!=='unknown')throw Error('fresh_weather_fixture_permission_required');
    const denied=await call('velaWeatherPermissionNative',{type:'set',expectedVersion:permission.version,decision:'deny'});
    if(denied.decision!=='deny')throw Error('weather_fixture_deny_required');
  }
  await win.loadURL(localURL);
  // Restores explicit local detection consent only; this command never starts paid voice.
  void call('velaWakeNative',{name:'ready',input:{}}).catch(()=>{});
  if (process.argv.includes('--bootstrap-vela-api')) {
    if (!profileArg || !path.isAbsolute(profileArg.slice(10))) throw Error('explicit_api_profile_required');
    const imported = await require('./vela-api-bootstrap.cjs').importVelaApiBootstrap({ call, profileDirectory: privateRoot, storageAllowed: () => storage.allowWrite() });
    writeFileSync(path.join(privateRoot, 'vela-api-import-receipt.json'), JSON.stringify(imported));
  }
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
        win, app, privateRoot, call, source, startupErrors, moduleStartedMonotonicMs,systemFactsAudit:()=>windowsSystemBroker.audit(),
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
      velaWakeBroker?.close(); wakeController?.dispose();
      velaVoiceBroker?.close();
      liveMediaBroker?.close();
      documentTextBroker?.close();
      providerConnections?.close();
      velaApiSetup?.close();
      velaApiConnections?.close();
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
        velaWakeBroker?.close(); wakeController?.dispose();
        velaVoiceBroker?.close();
        liveMediaBroker?.close();
        documentTextBroker?.close();
        providerConnections?.close();
        velaApiSetup?.close();
        velaApiConnections?.close();
        nativeSecretBroker?.close();
        child.kill();
        app.quit();
      } else await unlockEditingAfterKeptOpen();
    });
});
app.on("window-all-closed", () => app.quit());
