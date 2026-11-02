import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const { validateReview, reviewPage, showVelaReview } = createRequire(
  import.meta.url,
)("../native/vela-review.cjs");
const digest = (text) =>
  createHash("sha256").update(JSON.stringify(text)).digest("hex");
function disclosure() {
  const prompt = 'Exact provider text\n{"source":"untrusted <script>"}';
  return {
    previewId: "preview",
    signature: "signature",
    providerId: "codex-app-server",
    prompt,
    promptDigest: digest(prompt),
    reviewDigest: "a".repeat(64),
    context: {
      included: [
        {
          title: 'Note <img src="private">',
          content: "Untrusted </pre><script>send()</script>",
        },
      ],
    },
    history: {
      messages: [
        { role: "user", content: "Earlier question" },
        {
          role: "assistant",
          providerId: "codex-app-server",
          content: "Earlier exact answer",
        },
      ],
    },
  };
}
const preview = {
  id: "preview",
  signature: "signature",
  providerId: "codex-app-server",
};

test("exact native review rejects substituted identity, digest, prompt and capacity without truncation", () => {
  const r = disclosure();
  assert.equal(validateReview(preview, r), r);
  for (const change of [
    { previewId: "other" },
    { signature: "other" },
    { providerId: "other" },
    { prompt: "changed" },
    { promptDigest: "b".repeat(64) },
    { reviewDigest: "" },
    { history: { messages: Array(5).fill({ content: "extra" }) } },
    { prompt: "x".repeat(16385), promptDigest: digest("x".repeat(16385)) },
    { context: { included: [], excess: "x".repeat(65537) } },
  ])
    assert.throws(
      () => validateReview(preview, { ...r, ...change }),
      /invalid_native_vela_review/,
    );
});

test("bounded disclosure escapes source/history/prompt markup, retains full text and has no page scripts or app bridge", () => {
  const r = disclosure(),
    html = reviewPage(r, 'Create "a workspace" <now>');
  assert(html.includes("Create &quot;a workspace&quot; &lt;now&gt;"));
  assert(html.includes("Earlier exact answer"));
  assert(
    html.includes("Untrusted &lt;/pre&gt;&lt;script&gt;send()&lt;/script&gt;"),
  );
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(!html.includes("window.aerynthHost"));
  assert(html.includes("script-src 'none'"));
  assert(html.includes("default-src 'none'"));
  assert(html.includes("grid-template-rows:auto minmax(0,1fr) auto"));
  assert(html.includes('id="cancel" type="button" autofocus'));
  const longest = {
    ...r,
    prompt: "λ".repeat(8192),
    promptDigest: digest("λ".repeat(8192)),
  };
  assert.equal(validateReview(preview, longest), longest);
  assert(
    reviewPage(longest).includes(longest.prompt),
    "the exact UTF-8 ceiling stays inspectable",
  );
});

function runtime() {
  const parent = new EventEmitter(),
    ipcMain = new EventEmitter(),
    children = [];
  let alive = true,
    focused = true;
  Object.assign(parent, {
    isDestroyed: () => !alive,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => focused,
    getContentBounds: () => ({ width: 800, height: 650 }),
    webContents: { isDestroyed: () => !alive },
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.shown = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "" };
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openHandler = handler;
      };
      children.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    show() {
      this.shown = true;
    }
    loadURL(url) {
      this.url = url;
      this.webContents.mainFrame.url = url;
      queueMicrotask(() => this.emit("ready-to-show"));
      return Promise.resolve();
    }
  }
  const partition = {
    setPermissionRequestHandler: (handler) => {
      partition.permission = handler;
    },
    setPermissionCheckHandler: (handler) => {
      partition.check = handler;
    },
    webRequest: {
      onBeforeRequest: (_filter, handler) => {
        partition.request = handler;
      },
    },
  };
  return {
    parent,
    ipcMain,
    children,
    partition,
    runtime: {
      BrowserWindow,
      ipcMain,
      session: { fromPartition: () => partition },
    },
    loseParent: () => {
      alive = false;
      parent.emit("closed");
    },
    defocus: () => {
      focused = false;
    },
    decide: (child, decision, extra = {}) =>
      ipcMain.emit(
        "vela-review-decision",
        {
          sender: child.webContents,
          senderFrame: child.webContents.mainFrame,
          ...extra,
        },
        {
          token: child.options.webPreferences.additionalArguments[0].slice(20),
          decision,
        },
      ),
  };
}
const open = (f) =>
  showVelaReview({
    parent: f.parent,
    review: disclosure(),
    intent: "Exact intent",
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    runtime: f.runtime,
  });

test("only the exact child main frame can approve; a parent renderer, foreign frame or navigation cannot grant", async () => {
  const f = runtime(),
    pending = open(f),
    child = f.children[0];
  await Promise.resolve();
  assert(child.shown);
  const p = child.options.webPreferences;
  assert(p.sandbox && p.contextIsolation && !p.nodeIntegration && !p.devTools);
  assert(child.options.width <= 800 && child.options.height <= 650);
  assert.deepEqual(child.openHandler({ url: "https://example.invalid" }), {
    action: "deny",
  });
  f.decide(child, "approve", { sender: f.parent.webContents });
  f.decide(child, "approve", { senderFrame: { url: child.url } });
  assert(!child.destroyed);
  let denied;
  f.partition.request({}, (value) => {
    denied = value.cancel;
  });
  assert(denied);
  assert.equal(f.partition.check(), false);
  f.decide(child, "approve");
  assert.equal(await pending, true);
  assert(child.destroyed);
  assert.equal(f.ipcMain.listenerCount("vela-review-decision"), 0);
  assert.equal(f.parent.listenerCount("closed"), 0);
});

test("cancel, parent close, child focus loss and process loss deny and release all owned listeners", async () => {
  for (const action of [
    (f, c) => f.decide(c, "cancel"),
    (f) => f.loseParent(),
    (_f, c) => c.emit("blur"),
    (_f, c) => c.webContents.emit("render-process-gone"),
    (_f, c) => c.destroy(),
  ]) {
    const f = runtime(),
      pending = open(f),
      child = f.children[0];
    await Promise.resolve();
    action(f, child);
    assert.equal(await pending, false);
    assert(child.destroyed);
    assert.equal(f.ipcMain.listenerCount("vela-review-decision"), 0);
    assert.equal(f.parent.listenerCount("closed"), 0);
  }
});

test("expiry and lost parent ownership cannot create or show a focus-taking approval window", async () => {
  const expired = runtime();
  assert.equal(
    await showVelaReview({
      parent: expired.parent,
      review: disclosure(),
      expiresAt: new Date(0).toISOString(),
      runtime: expired.runtime,
    }),
    false,
  );
  assert.equal(expired.children.length, 0);
  const f = runtime();
  f.defocus();
  assert.equal(await open(f), false);
  assert(!f.children[0].shown);
  assert(f.children[0].destroyed);
});
