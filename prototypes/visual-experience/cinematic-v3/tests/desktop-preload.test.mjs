import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
function bridge(active = false) {
  let exposed;
  const calls = [];
  const events = new EventEmitter();
  vm.runInNewContext(
    readFileSync(
      new URL("../native/desktop-preload.cjs", import.meta.url),
      "utf8",
    ),
    {
      process: { argv: [] },
      navigator: { userActivation: { isActive: active } },
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
            on: (...args) => events.on(...args),
            removeListener: (...args) => events.removeListener(...args),
            async invoke(...args) {
              calls.push(args);
              if (args[0] === "application-copy-text")
                return { contract: "aerynth.clipboard@1", status: "copied" };
              return { ok: true, result: "canonical-result" };
            },
          },
        };
      },
    },
  );
  return { host: exposed, calls, events };
}

test("closing a chat observer removes only its own native IPC listener", () => {
  const { host, events } = bridge();
  const first = [],
    second = [];
  const stop = host.onEvent((value) => first.push(value));
  const stopOther = host.onEvent((value) => second.push(value));
  events.emit("application-event", {}, { type: "actual-observation" });
  stop();
  stop();
  assert.equal(events.listenerCount("application-event"), 1);
  events.emit("application-event", {}, { type: "later-observation" });
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  stopOther();
  assert.equal(events.listenerCount("application-event"), 0);
});

test("explicit native Copy requires current isolated-world activation and never exposes reads or generic clipboard commands", async () => {
  const denied = bridge();
  assert.equal(
    (await denied.host.copyText("Synthetic copy")).code,
    "clipboard_user_gesture_required",
  );
  assert.equal(denied.calls.length, 0);
  const allowed = bridge(true);
  assert.equal(
    (await allowed.host.copyText("Synthetic Ω\ncopy")).status,
    "copied",
  );
  assert.deepEqual(
    allowed.calls.map((call) => [call[0], JSON.parse(JSON.stringify(call[1]))]),
    [
      [
        "application-copy-text",
        { type: "copyText", text: "Synthetic Ω\ncopy" },
      ],
    ],
  );
  assert.equal(allowed.host.readText, undefined);
  assert.equal(
    (await allowed.host.copyText("x".repeat(262145))).code,
    "clipboard_invalid_request",
  );
  for (const name of ["clipboard", "copyText", "readText"])
    await assert.rejects(allowed.host.command(name, {}), /unsupported_command/);
  assert.equal(allowed.calls.length, 1);
});
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
    "snapshot",
    "providerActivity",
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

test("first-party navigation exposes only its public native family, never a general external-open command", async () => {
  const { host, calls } = bridge();
  await host.command("firstPartyChat", { target: "chatgpt-home" });
  assert.deepEqual(calls, [
    ["application-command", "firstPartyChat", { target: "chatgpt-home" }],
  ]);
  for (const command of ["openExternal", "shell", "openURL"])
    await assert.rejects(
      host.command(command, "https://untrusted.invalid"),
      /unsupported_command/,
    );
  assert.equal(calls.length, 1);
});

test("scoped conversation activity remains a public read without exposing execution authorization", async () => {
  const { host, calls } = bridge();
  assert.equal(
    await host.command("conversationActivity", {
      resourceIds: ["canonical-conversation"],
    }),
    "canonical-result",
  );
  assert.deepEqual(calls, [
    [
      "application-command",
      "conversationActivity",
      { resourceIds: ["canonical-conversation"] },
    ],
  ]);
  await assert.rejects(
    host.command("authorizeConversationSend", {}),
    /unsupported_command/,
  );
  assert.equal(calls.length, 1);
});
