import { app, BrowserWindow, ipcMain, screen, session } from "electron";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = path.join(ROOT, ".runtime");
const INDEX = path.join(ROOT, "dist", "index.html");
const STATE = path.join(RUNTIME, "window-state.json");
const BENCHMARK = process.argv.includes("--benchmark");
const blockId =
  /^(overview|conversation|activity|projects|notes|timeline|metrics|files|agents|tasks|signal|calendar)$/;
let mainWindow: BrowserWindow | null = null;
const detached = new Map<string, BrowserWindow>();

mkdirSync(RUNTIME, { recursive: true });
app.setPath("userData", RUNTIME);

function savedBounds() {
  try {
    const value = JSON.parse(readFileSync(STATE, "utf8")) as Electron.Rectangle;
    if (
      [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
      value.width >= 900 &&
      value.height >= 600 &&
      screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return (
          value.x < b.x + b.width - 100 &&
          value.y < b.y + b.height - 100 &&
          value.x + value.width > b.x + 100 &&
          value.y + value.height > b.y + 100
        );
      })
    )
      return value;
  } catch {
    /* fresh launch or invalid state */
  }
  return { width: 1500, height: 950 };
}
function trusted(sender: Electron.WebContents) {
  try {
    const url = new URL(sender.getURL()),
      expected = new URL(pathToFileURL(INDEX).href);
    return url.protocol === "file:" && url.pathname === expected.pathname;
  } catch {
    return false;
  }
}
function configureWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).pathname !== new URL(pathToFileURL(INDEX).href).pathname)
        event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  win.webContents.on("render-process-gone", (_event, details) =>
    console.error("Renderer process gone", details.reason),
  );
  win.loadFile(INDEX, {
    query: {
      benchmark: BENCHMARK ? "1" : "0",
      detached: win === mainWindow ? "" : "1",
    },
  });
}
function createMain() {
  mainWindow = new BrowserWindow({
    ...savedBounds(),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#07111d",
    title: "Aerynth · Electron visual lab",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  configureWindow(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (BENCHMARK)
      setTimeout(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
          const dir = path.join(ROOT, "evidence");
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            path.join(dir, "prototype-initial.png"),
            (await mainWindow.webContents.capturePage()).toPNG(),
          );
          console.log("Captured initial Electron window");
        } catch (error) {
          console.error("Initial capture failed", error);
        }
      }, 700);
  });
  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mkdirSync(RUNTIME, { recursive: true });
      writeFileSync(STATE, JSON.stringify(mainWindow.getBounds()));
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    for (const child of detached.values()) child.close();
    detached.clear();
  });
}
function detach(id: string) {
  if (!blockId.test(id)) return false;
  const existing = detached.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  const win = new BrowserWindow({
    width: 780,
    height: 620,
    minWidth: 520,
    minHeight: 380,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: "#00000000",
    title: `Aerynth · ${id}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  detached.set(id, win);
  win.loadFile(INDEX, { query: { detached: id } });
  win.once("ready-to-show", () => {
    win.show();
    if (BENCHMARK)
      setTimeout(async () => {
        if (win.isDestroyed()) return;
        try {
          writeFileSync(
            path.join(ROOT, "evidence", "prototype-detached.png"),
            (await win.webContents.capturePage()).toPNG(),
          );
        } catch (error) {
          console.error("Detached capture failed", error);
        }
      }, 500);
  });
  win.on("closed", () => detached.delete(id));
  return true;
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  createMain();
  app.on("activate", () => {
    if (!mainWindow) createMain();
  });
});
app.on("window-all-closed", () => app.quit());

ipcMain.handle(
  "lab:detach",
  (event, id: unknown) =>
    trusted(event.sender) && typeof id === "string" && detach(id),
);
ipcMain.handle("lab:close-detached", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win !== mainWindow) win.close();
});
ipcMain.handle("lab:environment", async (event) => {
  if (!trusted(event.sender)) return null;
  let gpu: unknown = null;
  try {
    gpu = await app.getGPUInfo("basic");
  } catch {
    gpu = "unavailable";
  }
  return {
    platform: process.platform,
    architecture: process.arch,
    osVersion: os.release(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    gpu,
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      scaleFactor: d.scaleFactor,
      bounds: d.bounds,
      workArea: d.workArea,
    })),
    processes: app
      .getAppMetrics()
      .map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu, memory: m.memory })),
    time: new Date().toISOString(),
  };
});
ipcMain.handle("lab:capture", async (event, name: unknown) => {
  if (
    !trusted(event.sender) ||
    !BENCHMARK ||
    name !== "expanded" ||
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return false;
  writeFileSync(
    path.join(ROOT, "evidence", "prototype-expanded.png"),
    (await mainWindow.webContents.capturePage()).toPNG(),
  );
  return true;
});
ipcMain.handle("lab:background-probe", async (event) => {
  if (
    !trusted(event.sender) ||
    !BENCHMARK ||
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return null;
  mainWindow.hide();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  mainWindow.show();
  return { hiddenDurationMs: 1200, visibleAfter: mainWindow.isVisible() };
});
ipcMain.handle("lab:benchmark-report", async (event, report: unknown) => {
  if (
    !trusted(event.sender) ||
    event.sender !== mainWindow?.webContents ||
    !BENCHMARK ||
    typeof report !== "object" ||
    report === null
  )
    return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(report);
    if (serialized.length > 2_000_000) return false;
  } catch {
    return false;
  }
  const dir = path.join(ROOT, "evidence");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "benchmark-local.json");
  writeFileSync(target, JSON.stringify(JSON.parse(serialized), null, 2));
  console.log(`Benchmark report: ${target}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const capture = await mainWindow.webContents.capturePage();
      writeFileSync(path.join(dir, "prototype-local.png"), capture.toPNG());
      console.log("Captured actual Electron window");
    } catch (error) {
      console.error("Screenshot capture failed", error);
    }
  }
  setTimeout(() => app.quit(), 1200);
  return true;
});
