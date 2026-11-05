const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const {
  CLIPBOARD_CONTRACT,
  CLIPBOARD_TEXT_MAX_BYTES,
  copyRequest,
  createClipboardCapability,
} = require("../native/clipboard-capability.cjs");
const contract = import(
  pathToFileURL(
    path.resolve(__dirname, "../../../application-contract/clipboard.ts"),
  ).href
);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const request = (text) => ({ type: "copyText", text });
const event = { synthetic: "owned main-frame event double" };
function fixture(overrides = {}) {
  const writes = [],
    gates = [];
  const broker = createClipboardCapability({
    writeText: async (text) => {
      writes.push(text);
    },
    isTrustedApplicationFrame: (e) => {
      gates.push(e);
      return e === event;
    },
    authorizeUserCopy: async (e) => e === event,
    ...overrides,
  });
  return { broker, writes, gates };
}

test("strict copy-only DTO accepts exact Unicode/newlines and UTF8 ceiling, never getter/native method/grant inputs", async () => {
  const shared = await contract;
  assert.equal(CLIPBOARD_CONTRACT, shared.CLIPBOARD_CONTRACT);
  assert.equal(CLIPBOARD_TEXT_MAX_BYTES, shared.CLIPBOARD_TEXT_MAX_BYTES);
  for (const text of [
    "",
    "https://example.invalid/\n研究 😀\r\nExact text",
    "a".repeat(CLIPBOARD_TEXT_MAX_BYTES),
    "😀".repeat(CLIPBOARD_TEXT_MAX_BYTES / 4),
  ]) {
    assert.equal(copyRequest(request(text)).text, text);
    assert.equal(shared.validClipboardText(text), true);
  }
  for (const text of [
    "a".repeat(CLIPBOARD_TEXT_MAX_BYTES + 1),
    "😀".repeat(CLIPBOARD_TEXT_MAX_BYTES / 4 + 1),
    "a\0b",
    "\ud800",
    "\udc00",
    "\ud800x",
  ]) {
    assert.equal(copyRequest(request(text)), null);
    assert.equal(shared.validClipboardText(text), false);
  }
  const getter = {
    type: "copyText",
    get text() {
      throw Error("Getter must not run");
    },
  };
  for (const bad of [
    null,
    [],
    "copy",
    { text: "x" },
    { type: "readText", text: "x" },
    { ...request("x"), authorized: true },
    { ...request("x"), html: "<b>x</b>" },
    Object.assign(Object.create({ text: "inherited" }), { type: "copyText" }),
    getter,
    { ...request("x"), [Symbol("grant")]: true },
  ])
    assert.equal(copyRequest(bad), null);
});
test("native promise must resolve before copied; exact text passed once and no public payload echoes text", async () => {
  const write = deferred(),
    f = fixture({
      writeText: (text) => {
        f.writes.push(text);
        return write.promise;
      },
    });
  let settled = false;
  const copy = f.broker
    .copy(event, request("Synthetic Unicode\n😀"))
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(f.writes, ["Synthetic Unicode\n😀"]);
  assert.equal(
    (await f.broker.copy(event, request("second"))).code,
    "clipboard_busy",
  );
  write.resolve();
  assert.deepEqual(await copy, {
    contract: CLIPBOARD_CONTRACT,
    status: "copied",
  });
  assert.equal(f.gates.length >= 2, true);
  f.broker.close();
});
test("malformed, foreign, absent gesture and gate errors cause zero writes with code-only failures", async () => {
  const f = fixture();
  assert.equal(
    (await f.broker.copy(event, { ...request("private"), grant: true })).code,
    "clipboard_invalid_request",
  );
  assert.equal(
    (await f.broker.copy({}, request("private"))).code,
    "clipboard_unauthorized_sender",
  );
  assert.equal(f.writes.length, 0);
  f.broker.close();
  for (const authorizeUserCopy of [
    async () => false,
    async () => "true",
    async () => {
      throw Error("PRIVATE error detail");
    },
  ]) {
    const x = fixture({ authorizeUserCopy });
    const result = await x.broker.copy(event, request("PRIVATE body"));
    assert.notEqual(result.status, "copied");
    assert(!JSON.stringify(result).includes("PRIVATE"));
    assert.equal(x.writes.length, 0);
    x.broker.close();
  }
  assert.throws(
    () => createClipboardCapability({ writeText: async () => {} }),
    /dependencies_required/,
  );
});
test("navigation/revocation during await is checked again, immutable request snapshot prevents text replacement", async () => {
  const auth = deferred();
  let trusted = true;
  const f = fixture({
    authorizeUserCopy: () => auth.promise,
    isTrustedApplicationFrame: () => trusted,
  });
  const copy = f.broker.copy(event, request("original"));
  trusted = false;
  auth.resolve(true);
  assert.equal((await copy).code, "clipboard_unauthorized_sender");
  assert.equal(f.writes.length, 0);
  f.broker.close();
  const auth2 = deferred(),
    x = fixture({ authorizeUserCopy: () => auth2.promise }),
    input = request("original");
  const pending = x.broker.copy(event, input);
  input.text = "replaced";
  auth2.resolve(true);
  assert.equal((await pending).status, "copied");
  assert.deepEqual(x.writes, ["original"]);
  x.broker.close();
});
test("expired authorization cannot dispatch late and a later explicitly authorized copy can proceed", async () => {
  const auth = deferred();
  let first = true;
  const f = fixture({
    deadlineMs: 10,
    authorizeUserCopy: () =>
      first ? ((first = false), auth.promise) : Promise.resolve(true),
  });
  assert.equal(
    (await f.broker.copy(event, request("expired"))).code,
    "clipboard_authorization_timeout",
  );
  assert.equal(
    (await f.broker.copy(event, request("cannot accumulate unbounded checks")))
      .code,
    "clipboard_busy",
  );
  auth.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.writes.length, 0);
  assert.equal(
    (await f.broker.copy(event, request("new explicit copy"))).status,
    "copied",
  );
  assert.deepEqual(f.writes, ["new explicit copy"]);
  f.broker.close();
});
test("dispatched timeout is unknown, stays single-flight through actual settlement, never retries or publishes late success", async () => {
  const write = deferred(),
    f = fixture({
      deadlineMs: 10,
      writeText: (text) => {
        f.writes.push(text);
        return write.promise;
      },
    });
  const unknown = await f.broker.copy(event, request("Synthetic late write"));
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.code, "clipboard_write_timeout");
  assert.equal(
    (await f.broker.copy(event, request("cannot race"))).code,
    "clipboard_busy",
  );
  assert.equal(f.writes.length, 1);
  write.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unknown.status, "unknown");
  f.broker.close();
});
test("close invalidates pending pre-dispatch authorization and dispatched completion without claiming rollback", async () => {
  const auth = deferred(),
    f = fixture({ authorizeUserCopy: () => auth.promise });
  const copy = f.broker.copy(event, request("never write"));
  f.broker.close();
  assert.equal((await copy).code, "clipboard_closed");
  auth.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.writes.length, 0);
  const write = deferred(),
    x = fixture({ writeText: () => write.promise });
  const pending = x.broker.copy(event, request("already dispatched"));
  await new Promise((resolve) => setImmediate(resolve));
  x.broker.close();
  assert.equal((await pending).code, "clipboard_closed_after_dispatch");
  write.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await x.broker.copy(event, request("later"))).code,
    "clipboard_closed",
  );
});
test("native throw/reject/missing returned promise never reports copied or leaks error text", async () => {
  for (const writeText of [
    () => {
      throw Error("PRIVATE native failure");
    },
    async () => {
      throw Error("PRIVATE native failure");
    },
    () => undefined,
  ]) {
    const f = fixture({ writeText });
    const result = await f.broker.copy(
      event,
      request("PRIVATE clipboard text"),
    );
    assert.equal(result.status, "unknown");
    assert.equal(result.code, "clipboard_write_unconfirmed");
    assert(!JSON.stringify(result).includes("PRIVATE"));
    f.broker.close();
  }
});
test("renderer client uses dedicated copy port once with typed outcomes and no browser/native fallback", async () => {
  const shared = await contract;
  let calls = 0;
  const client = shared.createClipboardClient({
    async copyText(text) {
      calls++;
      assert.equal(text, "Synthetic selected text");
      return { contract: CLIPBOARD_CONTRACT, status: "copied" };
    },
  });
  assert.equal(
    (await client.copyText("Synthetic selected text")).status,
    "copied",
  );
  assert.equal(calls, 1);
  assert.equal((await client.copyText("bad\0text")).status, "denied");
  assert.equal(calls, 1);
  assert.equal(
    (await shared.createClipboardClient(null).copyText("text")).status,
    "unavailable",
  );
  assert.equal(
    (
      await shared
        .createClipboardClient({
          async copyText() {
            throw Error("PRIVATE IPC");
          },
        })
        .copyText("text")
    ).code,
    "clipboard_request_unconfirmed",
  );
  for (const bad of [
    { contract: CLIPBOARD_CONTRACT, status: "copied", text: "leak" },
    { contract: CLIPBOARD_CONTRACT, status: "copied", code: "invented" },
    { contract: CLIPBOARD_CONTRACT, status: "denied", code: "PRIVATE error" },
    { status: "copied" },
  ])
    assert.equal(
      (
        await shared
          .createClipboardClient({
            async copyText() {
              return bad;
            },
          })
          .copyText("text")
      ).code,
      "clipboard_invalid_native_result",
    );
});

test("native surface exposes write-only explicit copy/close and never accepts reflective clipboard operations", async () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.broker).sort(), ["close", "copy"]);
  for (const type of [
    "readText",
    "read",
    "writeHTML",
    "clear",
    "execute",
    "copyFiles",
  ])
    assert.equal(
      (await f.broker.copy(event, { type, text: "Synthetic body" })).code,
      "clipboard_invalid_request",
    );
  assert.equal(f.writes.length, 0);
  f.broker.close();
});
