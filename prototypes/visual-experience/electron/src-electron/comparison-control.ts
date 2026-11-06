import { app, BrowserWindow, screen } from "electron";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import * as path from "node:path";
import {
  isRendererCommand,
  validateControlRequest,
  type BlockId,
  type ControlCommand,
  type ControlRequest,
  type RendererCommand,
} from "./comparison-contract";

type WindowFactory = (id: BlockId) => BrowserWindow;
type NativeReceipt = {
  actionId: string;
  op: string;
  clock: "main-hrtime-nanoseconds";
  dispatchAtNs: string;
  stateCommittedAtNs: string;
  nextFrameAtNs: null;
  wallUtc: string;
  result?: unknown;
};

export class ComparisonControl {
  private watcher: FSWatcher | null = null;
  private fallback: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = new Set<string>();
  private rendererReady = new Set<number>();
  private eventsFile: string;
  constructor(
    private dir: string,
    private getMain: () => BrowserWindow | null,
    private getDetached: (id: BlockId) => BrowserWindow | undefined,
    private ensureDetached: WindowFactory,
    private buildManifest: unknown,
    private processStartedAtNs: string,
    private processStartedWallUtc: string,
  ) {
    mkdirSync(dir, { recursive: true });
    this.eventsFile = path.join(dir, `electron-${process.pid}.events.jsonl`);
  }
  start() {
    this.mark("control-ready", {
      processStartedAtNs: this.processStartedAtNs,
      processStartedWallUtc: this.processStartedWallUtc,
      buildManifest: this.buildManifest,
    });
    this.watcher = watch(this.dir, () => this.scan());
    this.fallback = setInterval(() => this.scan(), 1000);
    this.scan();
  }
  stop() {
    this.watcher?.close();
    if (this.fallback) clearInterval(this.fallback);
  }
  mark(event: string, data: Record<string, unknown> = {}) {
    appendFileSync(
      this.eventsFile,
      JSON.stringify({
        event,
        mainMonotonicNs: process.hrtime.bigint().toString(),
        wallUtc: new Date().toISOString(),
        ...data,
      }) + "\n",
    );
  }
  markRendererReady(win: BrowserWindow, marker: Record<string, unknown>) {
    this.rendererReady.add(win.webContents.id);
    this.mark("renderer-first-callback", {
      windowId: win.id,
      rendererPid: win.webContents.getOSProcessId(),
      marker,
    });
  }
  private scan() {
    let names: string[];
    try {
      names = readdirSync(this.dir)
        .filter((n) => /^[a-zA-Z0-9_-]{1,64}\.request\.json$/.test(n))
        .sort();
    } catch (error) {
      this.mark("control-scan-failed", { error: String(error) });
      return;
    }
    for (const name of names) {
      const id = name.slice(0, -".request.json".length);
      if (
        this.pending.has(id) ||
        existsSync(path.join(this.dir, `${id}.response.json`))
      )
        continue;
      this.pending.add(id);
      this.queue = this.queue
        .then(() => this.processRequest(id))
        .catch((error) =>
          this.mark("control-queue-failed", { id, error: String(error) }),
        );
    }
  }
  private async processRequest(id: string) {
    const receivedAtNs = process.hrtime.bigint().toString(),
      receivedWallUtc = new Date().toISOString();
    let response: Record<string, unknown>;
    try {
      const file = path.join(this.dir, `${id}.request.json`);
      if (statSync(file).size > 16_384)
        throw new Error("Request exceeds 16 KiB");
      const request = validateControlRequest(
        JSON.parse(readFileSync(file, "utf8")),
      );
      if (request.id !== id) throw new Error("Filename and request ID differ");
      const result = await this.execute(request);
      response = {
        id,
        ok: true,
        receivedAtNs,
        receivedWallUtc,
        completedAtNs: process.hrtime.bigint().toString(),
        completedWallUtc: new Date().toISOString(),
        result,
      };
    } catch (error) {
      response = {
        id,
        ok: false,
        receivedAtNs,
        receivedWallUtc,
        completedAtNs: process.hrtime.bigint().toString(),
        completedWallUtc: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const target = path.join(this.dir, `${id}.response.json`),
      temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(response, null, 2));
    renameSync(temp, target);
    this.mark("command-receipt", { id, ok: response.ok });
    this.pending.delete(id);
    if (response.ok && (response.result as { op?: string })?.op === "quit")
      setTimeout(() => app.quit(), 100);
  }
  private async execute(request: ControlRequest): Promise<unknown> {
    const { id, command } = request;
    if (isRendererCommand(command)) {
      const result = await this.dispatchRenderer(id, command);
      if (command.op === "frameStop") return this.persistFrameTrace(id, result);
      return result;
    }
    if (command.op === "status") {
      const main = this.requireMain();
      return {
        op: command.op,
        buildManifest: this.buildManifest,
        mainWindow: this.windowInfo(main),
        detachedWindows: [...this.getOpenDetached()].map(([block, win]) => ({
          block,
          ...this.windowInfo(win),
        })),
        displays: screen.getAllDisplays().map((d) => ({
          id: d.id,
          bounds: d.bounds,
          workArea: d.workArea,
          scaleFactor: d.scaleFactor,
          displayFrequency:
            (d as unknown as { displayFrequency?: number }).displayFrequency ??
            null,
        })),
        processMetrics: app.getAppMetrics().map((m) => ({
          type: m.type,
          pid: m.pid,
          cpu: m.cpu,
          memory: m.memory,
        })),
        renderer: await this.dispatchRenderer(id, { op: "state" }),
        controlDirectory: this.dir,
      };
    }
    return this.executeNative(id, command);
  }
  private *getOpenDetached(): Iterable<[BlockId, BrowserWindow]> {
    const ids: BlockId[] = [
      "overview",
      "conversation",
      "activity",
      "projects",
      "notes",
      "timeline",
      "metrics",
      "files",
      "agents",
      "tasks",
      "signal",
      "calendar",
    ];
    for (const id of ids) {
      const win = this.getDetached(id);
      if (win && !win.isDestroyed()) yield [id, win];
    }
  }
  private requireMain() {
    const main = this.getMain();
    if (!main || main.isDestroyed()) throw new Error("Main window unavailable");
    return main;
  }
  private windowInfo(win: BrowserWindow) {
    return {
      id: win.id,
      outerBounds: win.getBounds(),
      contentBounds: win.getContentBounds(),
      visible: win.isVisible(),
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      rendererPid: win.webContents.getOSProcessId(),
      devToolsOpen: win.webContents.isDevToolsOpened(),
    };
  }
  private async dispatchRenderer(id: string, command: RendererCommand) {
    const main = this.requireMain();
    if (!this.rendererReady.has(main.webContents.id))
      throw new Error("Renderer has not reached its first callback");
    const expression = `window.__labComparison.dispatch(${JSON.stringify(command)}, ${JSON.stringify(id)})`;
    return main.webContents.executeJavaScript(expression, true);
  }
  private persistFrameTrace(id: string, value: unknown) {
    const receipt = value as {
      result?: { intervalsMs?: number[]; summary?: unknown; scenario?: string };
    };
    const trace = receipt.result;
    if (!trace || !Array.isArray(trace.intervalsMs))
      throw new Error("Frame trace missing intervals");
    const json = JSON.stringify(trace);
    if (json.length > 12_000_000)
      throw new Error("Frame trace exceeds 12 million characters");
    const fileName = `${id}.frames.json`,
      target = path.join(this.dir, fileName),
      temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, json);
    renameSync(temp, target);
    const { intervalsMs: _raw, ...withoutRaw } = trace;
    return {
      ...receipt,
      result: withoutRaw,
      rawFrameFile: fileName,
      rawFrameSha256: createHash("sha256").update(json).digest("hex"),
      rawFrameCount: trace.intervalsMs.length,
    };
  }
  private async executeNative(
    id: string,
    command: Exclude<ControlCommand, RendererCommand>,
  ): Promise<NativeReceipt> {
    const dispatchAtNs = process.hrtime.bigint().toString(),
      wallUtc = new Date().toISOString();
    let result: unknown = null;
    switch (command.op) {
      case "openWindow": {
        const old = this.getDetached(command.block);
        const win = this.ensureDetached(command.block);
        if (!old || old.isDestroyed())
          await new Promise<void>((resolve, reject) => {
            if (win.isVisible()) return resolve();
            const timer = setTimeout(
              () => reject(new Error("Detached window show timed out")),
              10_000,
            );
            win.once("show", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        result = {
          block: command.block,
          alreadyOpen: !!old && !old.isDestroyed(),
          window: this.windowInfo(win),
        };
        break;
      }
      case "closeWindow": {
        const win = this.getDetached(command.block);
        if (!win || win.isDestroyed())
          throw new Error("Detached window is not open");
        await new Promise<void>((resolve) => {
          win.once("closed", resolve);
          win.close();
        });
        result = { block: command.block, closed: true };
        break;
      }
      case "focusWindow": {
        const win =
          command.target === "main"
            ? this.requireMain()
            : this.getDetached(command.target);
        if (!win || win.isDestroyed())
          throw new Error("Focus target is not open");
        win.show();
        win.focus();
        result = { target: command.target, window: this.windowInfo(win) };
        break;
      }
      case "setWindowBounds": {
        const win =
          command.target === "main"
            ? this.requireMain()
            : this.getDetached(command.target);
        if (!win || win.isDestroyed())
          throw new Error("Resize target is not open");
        win.setSize(command.width, command.height);
        result = {
          target: command.target,
          requested: { width: command.width, height: command.height },
          window: this.windowInfo(win),
        };
        break;
      }
      case "hideWindow":
        this.requireMain().hide();
        result = this.windowInfo(this.requireMain());
        break;
      case "minimizeWindow":
        this.requireMain().minimize();
        result = this.windowInfo(this.requireMain());
        break;
      case "restoreWindow": {
        const win = this.requireMain();
        win.restore();
        win.show();
        result = this.windowInfo(win);
        break;
      }
      case "quit":
        result = { quitting: true };
        break;
      default:
        throw new Error("Unsupported native command");
    }
    return {
      actionId: id,
      op: command.op,
      clock: "main-hrtime-nanoseconds",
      dispatchAtNs,
      stateCommittedAtNs: process.hrtime.bigint().toString(),
      nextFrameAtNs: null,
      wallUtc,
      result,
    };
  }
}
