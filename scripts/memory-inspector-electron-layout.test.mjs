import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { win32 } from "node:path";
import { fixtureBootstrap } from "./memory-inspector-electron-layout.mjs";

test("fixture bootstrap binds exact entry bytes and supplies only the hidden reserve probe", async () => {
  const entry = "native/memory-inspector-executable.cjs";
  const root = "D:\\artifact", entryPath = win32.join(root, entry), artifactPath = win32.join(root, "manifest.json");
  const content = "fixture entry";
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const manifest = Buffer.from(JSON.stringify({ contract: "aerynth.memory-inspector-artifact@1",
    files: [{ path: entry, sha256: sha(content) }] }));
  const effects = [];
  function invoke(handoff) {
    vm.runInNewContext(fixtureBootstrap(entry), {
      Buffer,
      process: { env: { AERYNTH_MEMORY_FIXTURE_HANDOFF: JSON.stringify(handoff),
        AERYNTH_NATIVE_TEST_SLOT: "synthetic", SystemRoot: "C:\\Windows" } },
      require(name) {
        if (name === "electron") return { app: { exit: code => effects.push(code) } };
        if (name === "node:path") return win32;
        if (name === "node:crypto") return { createHash };
        if (name === "node:os") return { userInfo: () => ({ homedir: "C:\\Synthetic" }) };
        if (name === "node:fs") return { realpathSync: path => path,
          readFileSync: path => path === entryPath ? Buffer.from(content) : manifest };
        if (name === "node:child_process") return { spawnSync(executable, args, options) {
          assert.match(executable, /powershell\.exe$/u);
          assert.ok(args.includes("C:\\Synthetic\\AppData\\Local\\AeroStorageWatch\\ReserveGuard.ps1"));
          assert.deepEqual(Array.from(args.slice(-4)), ["-EstimatedCBytes", "0", "-EstimatedDBytes", "268435456"]);
          assert.equal(options.windowsHide, true);
          effects.push("reserve");
          return { status: 0, stdout: '{"allowed":true}' };
        } };
        assert.equal(name, entryPath);
        return { async consumeMemoryInspectorHandoff({ allowWrite }) {
          assert.equal(allowWrite(), true);
          effects.push("fixture");
        } };
      },
    });
  }
  const handoff = { artifactPath, artifactSha256: sha(manifest), entryPath, profileRoot: "D:\\memory-witness-stub" };
  invoke({ ...handoff, artifactSha256: "changed" });
  assert.deepEqual(effects, [2]);
  invoke(handoff);
  assert.deepEqual(effects, [2, "reserve", "fixture"]);
});
