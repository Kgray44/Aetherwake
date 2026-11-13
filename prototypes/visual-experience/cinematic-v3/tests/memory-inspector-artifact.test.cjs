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
const { superviseMemoryInspectorExecutable } = require("../native/memory-fixture-supervisor.cjs");

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

for (const outcome of ["ready", "unresolved", "unready", "missing-seed", "invalid-seed", "duplicate-seed", "seed-failed", "restart", "wrong-restart"]) test(`isolated Electron adapter handles ${outcome} worker under a fixture permit`, async t => {
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
  const supervisor = {
    ...gate, allocation: { ...permit, profileRoot, expiresAt: Date.now() + 30_000, contract: "aerynth.memory-fixture-allocation@1" },
    allowWrite: () => true, startFixture: value => value,
  };
  const bundle = join(artifactRoot, paths.bundle);
  writeFileSync(bundle, "changed");
  assert.throws(() => superviseMemoryInspectorExecutable({
    ...supervisor, startFixture: () => assert.fail("mutated package reached process start"),
  }), /artifact_unverified/);
  writeFileSync(bundle, paths.bundle);
  const handoff = { ...gate, ...superviseMemoryInspectorExecutable(supervisor) };
  assert.equal(handoff.entryPath, join(artifactRoot, paths.executable));
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
  let child;
  let workers = 0;
  function makeWorker(reopen) {
    const child = new EventEmitter();
    child.pid = 321;
    let kills = 0;
    child.kill = () => { kills++; };
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(bytes, _encoding, done) {
        const request = JSON.parse(bytes);
        if (request.command === "capabilities") {
          const line = message => child.stdout.write(JSON.stringify(message) + "\n");
          const seed = { fixtureSeed: { contract: "aerynth.memory-fixture-seed@1",
            conversationId: "synthetic-chat", messageId: "synthetic-message", factId: "synthetic-fact" } };
          if (reopen) line({ fixtureRestart: {
            ...seed.fixtureSeed, contract: "aerynth.memory-fixture-restart-ready@1",
            ...(outcome === "wrong-restart" ? { factId: "different-fact" } : {}),
          } });
          else if (["ready", "unresolved", "duplicate-seed", "restart", "wrong-restart"].includes(outcome)) line(seed);
          if (outcome === "duplicate-seed") line(seed);
          if (outcome === "invalid-seed") line({ ...seed, extra: true });
          if (outcome === "seed-failed") line({ startupError: "memory_fixture_seed_failed" });
          if (outcome !== "unready") child.stdout.write(JSON.stringify({
            id: request.id, result: { providerId: "fixture-codex" },
          }) + "\n");
          done();
          return;
        }
        assert.equal(request.command, "personalMemoryManagementNative");
        child.stdout.write(JSON.stringify({ id: request.id, result: { records: [] } }) + "\n");
        done();
      },
    });
    if (outcome !== "unresolved") child.stdin.on("finish", () => child.emit("close", 0));
    return child;
  }
  const config = {
    handoff, allowWrite: () => true, readinessMs: 20, shutdownMs: 20,
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
      const reopen = ++workers === 2;
      assert.equal(executable, join(artifactRoot, paths.node));
      assert.equal(args[0], join(artifactRoot, paths.host));
      assert.equal(options.cwd, storage);
      assert.equal(args[1], reopen ? "--memory-fixture-restart-v1" : "--memory-fixture-bootstrap-v1");
      assert.equal(options.env.AERYNTH_MEMORY_FIXTURE_SEED, reopen ? undefined : "inspector-v1");
      assert.deepEqual(Object.keys(options.env), [
        "AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN", "AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN",
        ...(!reopen ? ["AERYNTH_MEMORY_FIXTURE_SEED"] : []),
      ]);
      effects.push("worker");
      return child = makeWorker(reopen);
    },
    importModule: async url => url.endsWith("/synthetic-memory-protector.mts") ? {
      createSyntheticMemoryProtector: () => ({
        close: () => effects.push("protector closed"),
        async prepareRestart({ check, assertWorkerExited }) {
          check();
          assertWorkerExited();
          const descriptor = { contract: "aerynth.memory-fixture-restart@1", profileRoot, expiresAt: handoff.expiresAt };
          return { descriptor, async claim(input) {
            assert.equal(input, descriptor);
            return { close: () => effects.push("reopened protector closed") };
          }, close: () => effects.push("restart custody closed") };
        },
      }),
    } : { createNativeHostServer: () => ({ handle: () => false, close: () => effects.push("wire closed") }) },
  };
  await assert.rejects(startIsolatedMemoryInspector({ ...config, handoff: { ...handoff, token: "wrong" } }), /slot_closed/);
  assert.deepEqual(effects, []);
  assert.equal(win, undefined);
  if (!["ready", "unresolved", "restart", "wrong-restart"].includes(outcome)) {
    await assert.rejects(startIsolatedMemoryInspector(config), {
      message: outcome === "seed-failed" ? "memory_fixture_seed_failed" :
        outcome === "invalid-seed" || outcome === "duplicate-seed" ? "memory_fixture_seed_invalid" : "memory_fixture_worker_not_ready",
    });
    assert.equal(win, undefined);
    assert.equal(handlers.size, 0);
    assert.equal(admission.status().lease, null);
    return;
  }
  const fixture = await startIsolatedMemoryInspector(config);
  assert.deepEqual(effects.slice(0, 5), ["userData", "sessionData", "crashDumps", "logs", "worker"]);
  blockRequest({ url: "https://example.invalid" }, result => assert.deepEqual(result, { cancel: true }));
  const dispatch = handlers.get("application-command");
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.deepEqual(await dispatch({ ...event, senderFrame: {} }, "personalMemory", { type: "list" }),
    { ok: false, error: "unauthorized_sender" });
  assert.deepEqual(await dispatch(event, "providerAuth", {}), { ok: false, error: "memory_fixture_command_denied" });
  assert.deepEqual(await dispatch(event, "personalMemory", { type: "list" }), { ok: true, result: { records: [] } });
  if (outcome === "restart" || outcome === "wrong-restart") {
    if (outcome === "wrong-restart") {
      await assert.rejects(fixture.restartWorker(), /restart_invalid/u);
      assert.equal(handlers.size, 0);
    } else {
      await fixture.restartWorker();
      assert.deepEqual(await dispatch(event, "personalMemory", { type: "list" }), { ok: true, result: { records: [] } });
      await assert.rejects(fixture.restartWorker(), /restart_unavailable/u);
      await fixture.close();
    }
    assert.equal(workers, 2);
    assert.equal(admission.status().lease, null);
    return;
  }
  if (outcome === "unresolved") {
    await assert.rejects(fixture.close(), /worker_outcome_unresolved/);
    assert.equal(kills, 1);
    assert.equal(handlers.size, 0);
    assert.equal(admission.status().lease.pid, process.pid);
    assert.equal(JSON.parse(require("node:fs").readFileSync(join(profileRoot, "synthetic-worker-unresolved.json"))).workerPid, 321);
    return;
  }
  const workerExit = once(child, "close");
  win.destroy();
  await workerExit;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handlers.size, 0);
  assert.equal(admission.status().lease, null);
  assert.deepEqual(effects.slice(-2), ["wire closed", "protector closed"]);
});
