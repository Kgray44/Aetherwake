const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { startMemoryInspectorFixture } = require("./memory-inspector-fixture-startup.cjs");

// Dormant entry. The dedicated caller owns its Electron process and binds the
// handoff to the verified fixture artifact before supplying Electron.
function startIsolatedMemoryInspector({ electron, handoff, allowWrite, spawnWorker = spawn,
  importModule = url => import(url), readinessMs = 3000, shutdownMs = 1000 }) {
  const { app, BrowserWindow, ipcMain, session, dialog } = electron;
  let storage;
  const runtime = {
    prepareStorage({ profileRoot, check }) {
      check();
      if (app.isReady()) throw Error("memory_fixture_storage_too_late");
      // Keep Chromium outside the marker-only database directory.
      storage = mkdtempSync(join(dirname(profileRoot), "memory-inspector-chromium-"));
      for (const name of ["userData", "sessionData", "crashDumps", "logs"]) {
        check();
        app.setPath(name, storage);
      }
      app.commandLine.appendSwitch("disable-background-networking");
    },
    async createProtector({ modulePath, ...options }) {
      const { createSyntheticMemoryProtector } = await importModule(pathToFileURL(modulePath).href);
      return createSyntheticMemoryProtector(options);
    },
    async startBackend({ executable, args, env, protector, wirePath, check, close }) {
      const { createNativeHostServer } = await importModule(pathToFileURL(wirePath).href);
      check();
      let child;
      const wire = createNativeHostServer({ secrets: protector }, message => write(message));
      try {
        child = spawnWorker(executable, args, {
          env, cwd: storage, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
        });
      } catch (error) { wire.close(); throw error; }
      const pending = new Map();
      let sequence = 0, active = true, stopping = false, buffer = "";
      const exited = new Promise(resolve => {
        child.once("close", resolve);
      });
      const write = message => {
        check();
        child.stdin.write(JSON.stringify(message) + "\n");
      };
      const fail = () => {
        active = false;
        for (const request of pending.values()) request.reject(Error("memory_fixture_worker_disconnected"));
        pending.clear();
        if (!stopping) void close().catch(() => {});
      };
      child.once("error", fail);
      child.once("close", fail);
      child.stdin.on("error", fail);
      child.stdout.setEncoding("utf8").on("data", chunk => {
        if (!active) return;
        try {
          check();
          buffer += chunk;
          if (buffer.length > 2 ** 21) throw Error("memory_fixture_reply_too_large");
          let split;
          while ((split = buffer.indexOf("\n")) !== -1) {
            const message = JSON.parse(buffer.slice(0, split));
            buffer = buffer.slice(split + 1);
            if (wire?.handle(message) || message.event) continue;
            const request = pending.get(message.id);
            if (!request) throw Error("memory_fixture_unexpected_reply");
            pending.delete(message.id);
            if (message.error) request.reject(Error(message.error));
            else request.resolve(message.result);
          }
        } catch { fail(); }
      });
      let ready = false;
      const worker = {
        ready: () => active && ready,
        call(request) {
          if (!active || pending.size >= 16) throw Error("memory_fixture_worker_unavailable");
          const id = ++sequence;
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            try { write({ id, ...request }); }
            catch (error) { pending.delete(id); reject(error); }
          });
        },
        async waitUntilReady() {
          const reply = await bounded(worker.call({ command: "capabilities", input: {} }), readinessMs);
          if (reply?.providerId !== "fixture-codex") throw Error("memory_fixture_worker_not_ready");
          ready = true;
        },
        async close() {
          stopping = true;
          fail();
          wire?.close();
          child.stdin.end();
          if (await bounded(exited.then(() => true), shutdownMs)) return;
          try { child.kill(); } catch { /* Exit acknowledgement is authoritative. */ }
          if (await bounded(exited.then(() => true), shutdownMs)) return;
          writeFileSync(join(handoff.profileRoot, "synthetic-worker-unresolved.json"),
            JSON.stringify({ workerPid: child.pid ?? null, ownerPid: process.pid }), { flag: "wx", mode: 0o600 });
          throw Error("memory_fixture_worker_outcome_unresolved");
        },
      };
      return worker;
    },
    async createSurface({ preloadPath, check, close }) {
      await app.whenReady();
      check();
      const isolated = session.fromPartition("memory-inspector-" + randomUUID(), { cache: false });
      isolated.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
      isolated.setPermissionCheckHandler(() => false);
      let approvedURL;
      isolated.webRequest.onBeforeRequest((details, reply) => {
        // The renderer artifact is a single HTML page and its single bundle.
        reply({ cancel: !approvedURL || details.url !== approvedURL &&
          details.url !== new URL("memory-inspector.js", approvedURL).href });
      });
      check();
      const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: preloadPath, session: isolated, sandbox: true,
          contextIsolation: true, nodeIntegration: false, devTools: false },
      });
      let mounted = false;
      const finish = () => {
        void close().catch(() => {});
        if (!win.isDestroyed()) win.destroy();
      };
      const beforeQuit = event => {
        event.preventDefault();
        void close().then(() => app.quit(), () => app.exit(2));
      };
      const timer = setInterval(() => {
        try { check(); } catch { finish(); }
      }, 200);
      timer.unref?.();
      win.once("closed", finish);
      app.once("before-quit", beforeQuit);
      try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", event => event.preventDefault());
        win.webContents.on("will-attach-webview", event => event.preventDefault());
        win.webContents.once("render-process-gone", finish);
      } catch (error) {
        clearInterval(timer);
        app.removeListener("before-quit", beforeQuit);
        if (!win.isDestroyed()) win.destroy();
        throw error;
      }
      return {
        win, dialog,
        async mount({ rendererURL, dispatch }) {
          check();
          approvedURL = rendererURL;
          ipcMain.handle("application-command", dispatch);
          mounted = true;
          await win.loadURL(rendererURL);
          check();
          win.show();
        },
        close() {
          clearInterval(timer);
          app.removeListener("before-quit", beforeQuit);
          win.removeListener("closed", finish);
          if (mounted) ipcMain.removeHandler("application-command");
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
  };
  return startMemoryInspectorFixture({ handoff, runtime, allowWrite });
}

async function bounded(result, ms) {
  let timer;
  try { return await Promise.race([result, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
}

module.exports = { startIsolatedMemoryInspector };
