const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { EventEmitter, once } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const { digest } = require("../native/memory-fixture-entry.cjs");
const { manifestName, paths, resolveMemoryInspectorArtifact } = require("../native/memory-inspector-artifact.cjs");
const { startIsolatedMemoryInspector } = require("../native/memory-inspector-electron-adapter.cjs");
const { createAdmission } = require("../native/native-test-admission.cjs");
const { superviseMemoryFixture } = require("../native/memory-fixture-supervisor.cjs");

test("acceptance artifact verifies exact inventory and refuses mutations, missing files and extra files", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-artifact-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifact");
  const profileRoot = join(root, "memory-witness-stub");
  const dependency = "prototypes/integrated-backend/src/service.mts";
  const inventory = [...Object.values(paths), dependency].map(path => ({ path, sha256: digest(path) }));
  for (const { path } of inventory) {
    const target = join(artifactRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path);
  }
  const artifactPath = join(artifactRoot, manifestName);
  const manifest = JSON.stringify({ contract: "aerynth.memory-inspector-artifact@1", files: inventory });
  writeFileSync(artifactPath, manifest);
  const input = { artifactPath, artifactSha256: digest(manifest), profileRoot, check() {} };
  assert.equal(resolveMemoryInspectorArtifact(input).hostPath, join(artifactRoot, paths.host));
  writeFileSync(join(artifactRoot, dependency), "mutation");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  writeFileSync(join(artifactRoot, dependency), dependency);
  writeFileSync(join(artifactRoot, "extra.js"), "");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  rmSync(join(artifactRoot, "extra.js"));
  rmSync(join(artifactRoot, paths.bundle));
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
  writeFileSync(artifactPath, manifest + "\n");
  assert.throws(() => resolveMemoryInspectorArtifact(input), /artifact_unverified/);
});

test("isolated Electron adapter owns storage, IPC and worker exit under a fixture permit", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memory-electron-stub-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifact");
  const profileRoot = join(root, "memory-witness-stub");
  mkdirSync(profileRoot);
  const files = Object.values(paths).map(path => ({ path, sha256: digest(path) }));
  for (const { path } of files) {
    const target = join(artifactRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path);
  }
  const artifactPath = join(artifactRoot, manifestName);
  writeFileSync(artifactPath, JSON.stringify({ contract: "aerynth.memory-inspector-artifact@1", files }));
  const directory = join(root, "slot");
  const admission = createAdmission(directory);
  admission.resume(Date.now());
  const permit = admission.open("memory-inspector", 1);
  const gate = { profileRoot, artifactPath, token: permit.token,
    locateDesktop: () => directory, openAdmission: () => admission };
  const handoff = { ...gate, ...superviseMemoryFixture({
    ...gate, allocation: { ...permit, profileRoot, expiresAt: Date.now() + 30_000, contract: "aerynth.memory-fixture-allocation@1" },
    allowWrite: () => true, startFixture: value => value,
  }) };
  const effects = [], handlers = new Map();
  let storage, win, blockRequest;
  const app = Object.assign(new EventEmitter(), {
    isReady: () => false,
    whenReady: async () => {},
    setPath(name, path) {
      assert.ok(admission.status().lease);
      storage ??= path;
      assert.equal(path, storage);
      assert.equal(dirname(storage), root);
      assert.notEqual(storage, profileRoot);
      effects.push(name);
    },
    commandLine: { appendSwitch: name => assert.equal(name, "disable-background-networking") },
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      assert.ok(admission.status().lease);
      assert.equal(options.show, false);
      assert.equal(options.webPreferences.preload, join(artifactRoot, paths.preload));
      assert.equal(options.webPreferences.sandbox, true);
      this.webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false, setWindowOpenHandler: handler => assert.deepEqual(handler(), { action: "deny" }),
        mainFrame: {},
      });
      win = this;
    }
    async loadURL(url) { this.webContents.mainFrame.url = url; }
    isDestroyed() { return this.destroyed === true; }
    isVisible() { return this.visible === true; }
    isMinimized() { return false; }
    isFocused() { return true; }
    show() { this.visible = true; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new Writable({
    write(bytes, _encoding, done) {
      const request = JSON.parse(bytes);
      assert.equal(request.command, "personalMemoryManagementNative");
      child.stdout.write(JSON.stringify({ id: request.id, result: { records: [] } }) + "\n");
      done();
    },
  });
  child.stdin.on("finish", () => child.emit("close", 0));
  const config = {
    handoff, allowWrite: () => true,
    electron: {
      app, BrowserWindow, dialog: {},
      ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
      session: { fromPartition(name, options) {
        assert.doesNotMatch(name, /^persist:/u);
        assert.equal(options.cache, false);
        return {
          setPermissionRequestHandler() {}, setPermissionCheckHandler: callback => assert.equal(callback(), false),
          webRequest: { onBeforeRequest: callback => { blockRequest = callback; } },
        };
      } },
    },
    spawnWorker(executable, args, options) {
      assert.equal(executable, join(artifactRoot, paths.node));
      assert.equal(args[0], join(artifactRoot, paths.host));
      assert.equal(options.cwd, storage);
      assert.deepEqual(Object.keys(options.env), ["AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN"]);
      effects.push("worker");
      return child;
    },
    importModule: async url => url.endsWith("/synthetic-memory-protector.mts") ? {
      createSyntheticMemoryProtector: () => ({ close: () => effects.push("protector closed") }),
    } : { createNativeHostServer: () => ({ handle: () => false, close: () => effects.push("wire closed") }) },
  };
  await assert.rejects(startIsolatedMemoryInspector({ ...config, handoff: { ...handoff, token: "wrong" } }), /slot_closed/);
  assert.deepEqual(effects, []);
  assert.equal(win, undefined);
  await startIsolatedMemoryInspector(config);
  assert.deepEqual(effects.slice(0, 5), ["userData", "sessionData", "crashDumps", "logs", "worker"]);
  blockRequest({ url: "https://example.invalid" }, result => assert.deepEqual(result, { cancel: true }));
  const dispatch = handlers.get("application-command");
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.deepEqual(await dispatch({ ...event, senderFrame: {} }, "personalMemory", { type: "list" }),
    { ok: false, error: "unauthorized_sender" });
  assert.deepEqual(await dispatch(event, "providerAuth", {}), { ok: false, error: "memory_fixture_command_denied" });
  assert.deepEqual(await dispatch(event, "personalMemory", { type: "list" }), { ok: true, result: { records: [] } });
  const workerExit = once(child, "close");
  win.destroy();
  await workerExit;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handlers.size, 0);
  assert.equal(admission.status().lease, null);
  assert.deepEqual(effects.slice(-2), ["wire closed", "protector closed"]);
});
