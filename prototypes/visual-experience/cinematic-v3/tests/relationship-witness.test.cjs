const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const vm = require("node:vm");
const path = require("node:path").win32;
const source = readFileSync(require.resolve("../native/main.cjs"), "utf8");

async function fixture({ deniedAt, reserveAllowed = true, rendererError = false } = {}) {
  const events = [];
  const writes = new Map();
  const app = new EventEmitter();
  let checks = 0;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  app.whenReady = () => Promise.resolve();
  app.setPath = (_, profile) => events.push(["profile", path.basename(profile)]);
  app.setAppUserModelId = () => {};
  app.exit = code => { events.push(["exit", code]); finish(code); };
  app.quit = () => assert.fail("relationship witness must exit explicitly");

  class Window extends EventEmitter {
    constructor(options) {
      super();
      events.push(["create", options.show]);
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      const samples = [
        { draws: 1 },
        { draws: 2, path: "M1 2 C3 4", opacity: 1, target: "subject" },
        { opacity: 0 },
      ];
      this.webContents.executeJavaScript = async script => {
        if (script.includes("snapshot()")) return samples.shift();
        if (script.includes(".demo()")) events.push(["demo"]);
      };
      this.webContents.capturePage = async () => {
        events.push(["capture"]);
        return { toPNG: () => Buffer.from("stub image") };
      };
    }
    setIgnoreMouseEvents() {}
    showInactive() { events.push(["show"]); }
    isVisible() { return true; }
    isMinimized() { return false; }
    async loadURL() {
      if (rendererError) this.webContents.emit("console-message", {}, { level: "error", message: "stub renderer failure" });
    }
  }

  const context = {
    __dirname: "D:/synthetic/native",
    process: { platform: "win32", argv: ["stub", "main.cjs", "--verify-relationship-only"], env: {
      LOCALAPPDATA: "C:/synthetic", SystemRoot: "C:/Windows",
    }, pid: 1234 },
    console: { error() {}, log() {} },
    setTimeout, setImmediate, performance,
    require(name) {
      switch (name) {
        case "electron": return { app, BrowserWindow: Window, nativeTheme: {}, session: {
          defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
            webRequest: { onBeforeRequest() {} } },
        } };
        case "./native-test-admission.cjs":
          return { installDesktopTestAdmission() {
            events.push(["admission"]);
            if (deniedAt === 0) throw Error("stub_initial_admission_denied");
            return { BrowserWindow: Window, check() {
              if (++checks === deniedAt) throw Error("stub_admission_revoked");
            } };
          } };
        case "node:path": return path;
        case "node:fs": return { readFileSync: () => Buffer.from("stub source"), readdirSync: () => [] };
        case "node:fs/promises": return { async mkdir() {}, async writeFile(file, value, options) {
          assert.equal(options.flag, "wx");
          writes.set(path.basename(file), value);
        } };
        case "node:child_process": return { execFileSync(file, args) {
          if (file === "git") return "stub-head";
          events.push(["reserve", Array.from(args).slice(-4)]);
          return JSON.stringify({ allowed: reserveAllowed });
        } };
        case "node:url": return { pathToFileURL: () => ({ href: "file:///synthetic/index.html" }) };
        case "node:crypto": return require("node:crypto");
        default: assert.fail("Unexpected module " + name);
      }
    },
  };
  try {
    vm.runInNewContext("(function () {" + source + "\n})()", context);
  } catch (error) {
    assert.equal(error.message, "stub_initial_admission_denied");
    return { events, writes };
  }
  return { exit: await done, events, writes };
}

test("relationship-only main refuses initial admission before reserve, profile or window", async () => {
  const { events, writes } = await fixture({ deniedAt: 0 });
  assert.deepEqual(events, [["admission"]]);
  assert.equal(writes.size, 0);
});

test("relationship-only main denies reserve and revocation before window creation or show", async () => {
  for (const config of [{ reserveAllowed: false }, { deniedAt: 2 }, { deniedAt: 3 }]) {
    const { exit, events, writes } = await fixture(config);
    assert.equal(exit, 1);
    assert.equal(events.some(([name]) => name === "show"), false);
    assert.equal(events.some(([name]) => name === "create"), config.deniedAt === 3);
    assert.equal(writes.size, 0);
  }
});

test("relationship-only main exits after visible and hidden readback or a renderer failure", async () => {
  for (const rendererError of [false, true]) {
    const { exit, events, writes } = await fixture({ rendererError });
    assert.equal(exit, rendererError ? 1 : 0);
    assert.deepEqual(events[1], ["reserve", ["-EstimatedCBytes", "0", "-EstimatedDBytes", "67108864"]]);
    assert.match(events[2][1], /^relationship-profile-1234-/);
    assert.deepEqual(events[3], ["create", false]);
    assert.equal(events.filter(([name]) => name === "demo").length, 2);
    const receipt = JSON.parse(writes.get("relationship.json"));
    assert.equal(receipt.passed, !rendererError);
    assert.equal(receipt.hidden.opacity, 0);
    assert.match(receipt.captureSha256, /^[a-f0-9]{64}$/);
  }
});

test("relationship-only main refuses capture after admission is revoked", async () => {
  const { exit, events, writes } = await fixture({ deniedAt: 9 });
  assert.equal(exit, 1);
  assert.equal(events.filter(([name]) => name === "demo").length, 1);
  assert.equal(events.some(([name]) => name === "capture"), false);
  assert.equal(writes.has("relationship.png"), false);
  assert.equal(JSON.parse(writes.get("relationship.json")).passed, false);
});
