import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function bridge() {
  let exposed;
  const calls = [];
  vm.runInNewContext(
    readFileSync(
      new URL("../native/desktop-preload.cjs", import.meta.url),
      "utf8",
    ),
    {
      process: { argv: [] },
      require(name) {
        assert.equal(name, "electron");
        return {
          contextBridge: {
            exposeInMainWorld(name, value) {
              assert.equal(name, "aerynthHost");
              exposed = value;
            },
          },
          ipcRenderer: {
            on() {},
            async invoke(...args) {
              calls.push(args);
              return { ok: true, result: "canonical-result" };
            },
          },
        };
      },
    },
  );
  return { host: exposed, calls };
}
test("desktop preload admits only public product families through the native command channel", async () => {
  const { host, calls } = bridge();
  for (const name of ["conversation", "vela", "library", "notes"]) {
    assert.equal(
      await host.command(name, { name: "state", input: {} }),
      "canonical-result",
    );
  }
  assert.deepEqual(
    calls.map((c) => c.slice(0, 2)),
    [
      ["application-command", "conversation"],
      ["application-command", "vela"],
      ["application-command", "library"],
      ["application-command", "notes"],
    ],
  );
  assert.equal(Object.isFrozen(host), true);
});
test("renderer cannot invoke private grant creation, raw provider execution or handler registration", async () => {
  const { host, calls } = bridge();
  for (const name of [
    "authorizeVelaRequest",
    "authorizeVelaDelegation",
    "authorizeConversationSend",
    "conversationSend",
    "execute",
    "registerVelaNativeCapabilities",
    "constructor",
    "__proto__",
  ])
    await assert.rejects(host.command(name, {}), /unsupported_command/);
  assert.equal(calls.length, 0);
});
