import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const { validateReview, reviewPage, showVelaReview, isOwnedVelaReviewWindow } =
  createRequire(import.meta.url)("../native/vela-review.cjs");
const digest = (text) =>
  createHash("sha256").update(JSON.stringify(text)).digest("hex");
test("memory review presents the exact escaped source, fact and scope", () => {
  const review = {
    sourceText: "User source </pre><script>capture()</script>",
    draft: { text: "Save <relay>", category: "decisions", keywords: ["relay", "<budget>"],
      scope: { kind: "project", id: "project-1" } },
    enableStorage: true,
  };
  const html = reviewPage(review, "", "memory-capture");
  assert.match(html, /Save this memory\?/);
  assert.match(html, /User source &lt;\/pre&gt;&lt;script&gt;capture/);
  assert.match(html, /Save &lt;relay&gt;/);
  assert.match(html, /project-1/);
  assert.match(html, /relay, &lt;budget&gt;/);
  assert.match(html, /Enable local memory storage/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script>/);
  assert.throws(() => reviewPage({ ...review, sourceText: "x".repeat(16385) }, "", "memory-capture"), /invalid_native_memory_review/);
});
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
          id: "note",
          kind: "resource",
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

test("resource metadata is disclosed even when its body was not selected", () => {
  const r = disclosure();
  r.context.discovered = [
    { id: "note", kind: "resource", title: "Selected Note" },
    { id: "project", kind: "project", title: "Current project metadata" },
    { id: "workspace", kind: "workspace", title: "Current workspace metadata" },
  ];
  validateReview(preview, r);
  const html = reviewPage(r);
  assert(html.includes("Shared resources (3)"));
  assert(html.includes("Current project metadata"));
  assert(html.includes("Current workspace metadata"));
  assert.equal(html.split("Metadata only").length - 1, 2);
  assert.equal(html.split("Selected excerpt").length - 1, 1);
  assert(
    html.includes(
      'role="dialog" aria-modal="true" aria-labelledby="review-title"',
    ),
  );
  assert(html.includes('id="review-title"'));
});

test("default experience remains the exact Vela presentation and limits", () => {
  const r = disclosure();
  assert.equal(reviewPage(r, "Intent"), reviewPage(r, "Intent", "vela"));
  assert(reviewPage(r).includes("<title>Vela · Review sharing</title>"));
  assert(reviewPage(r).includes("Previous messages (2)"));
  assert.throws(() => reviewPage({ ...r, prompt: "&".repeat(110000) }), /native_vela_review_capacity_exceeded/);
});

test("ordinary presentation preserves the full 256KiB raw JSON body, safely escaped, without inventing a Vela request", () => {
  const source = "&".repeat(262132), prompt = JSON.stringify({ input: source });
  assert.equal(Buffer.byteLength(prompt), 262144);
  const review = {
    providerId: "chatgpt-plan-responses", prompt,
    // Ordinary native caller binds the raw request bytes, independently of Vela.
    promptDigest: createHash("sha256").update(prompt).digest("hex"),
    context: { included: [{ id: "synthetic:note", kind: "resource", title: "Untrusted </h2><script>bad()</script>", content: source }] },
    history: { messages: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", providerId: "chatgpt-plan-responses", content: `Synthetic local history ${index} <img src=private>` })) },
  };
  const before = structuredClone(review), html = reviewPage(review, 'Ask <now> "once"', "ordinary");
  assert(html.includes("<title>Aerynth · Review sharing</title>"));
  assert(html.includes("Send to ChatGPT plan?"));
  assert(html.includes("Aerynth local history (6)"));
  assert(html.includes("Synthetic local history 5 &lt;img src=private&gt;"));
  assert(html.includes("One request in this chat. Review exactly what will be shared."));
  const encodedPrompt = prompt.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  assert(html.includes(`<pre>${encodedPrompt}</pre>`), "all exact provider bytes remain inspectable after safe HTML decoding");
  assert(Buffer.byteLength(html) > 524288 && Buffer.byteLength(html) < 4 * 1024 * 1024);
  assert(html.includes("Untrusted &lt;/h2&gt;&lt;script&gt;bad()&lt;/script&gt;"));
  assert(!html.includes("<script>") && !html.includes("<img") && !html.includes("Vela"));
  assert(html.includes("default-src 'none'") && html.includes("script-src 'none'") && html.includes(".content{overflow:auto"));
  assert.deepEqual(review, before);
  assert.throws(() => validateReview(preview, review), /invalid_native_vela_review/, "ordinary presentation does not expand Vela validation/authority");
});

test("unknown native presentation experiences fail closed", async () => {
  for (const experience of ["Ordinary", "", null, false, {}, "external"]) {
    assert.throws(() => reviewPage(disclosure(), "", experience), /invalid_native_review_experience/);
    const f = runtime();
    await assert.rejects(showVelaReview({ parent: f.parent, review: disclosure(), expiresAt: new Date(Date.now() + 1000).toISOString(), runtime: f.runtime, experience }), /invalid_native_review_experience/);
    assert.equal(f.children.length, 0);
    assert.equal(f.ipcMain.eventNames().length, 0);
  }
});

test("Codex review renders its full escaped egress and keeps native thread context distinct", () => {
  const prompt = "&".repeat(65000) + "<end>";
  const html = reviewPage({
    providerId: "codex-app-server",
    context: { included: [] },
    prompt,
    promptDigest: "a".repeat(64),
  }, "Exact request", "codex");
  assert.match(html, /Send to Codex\?/);
  assert.match(html, /Existing thread context stays with Codex/);
  assert(html.includes("&amp;".repeat(65000) + "&lt;end&gt;"));
});

function runtime({ autoReady = true, autoPaint = true } = {}) {
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
      this.webContents.mainFrame = { url: "",executeJavaScript:async script=>{assert.equal(script,'navigator.userActivation.isActive && document.hasFocus()');return true;} };
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openHandler = handler;
      };
      children.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isFocused(){return this.shown&&!this.destroyed;}
    getParentWindow() {
      return this.options.parent;
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
      queueMicrotask(() => {
        if (autoPaint) this.emit("ready-to-show");
        if (autoReady)
          ipcMain.emit(
            "vela-review-ready",
            {
              sender: this.webContents,
              senderFrame: this.webContents.mainFrame,
            },
            {
              token:
                this.options.webPreferences.additionalArguments[0].slice(20),
            },
          );
      });
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
    preloadReady: (
      child,
      extra = {},
      token = child.options.webPreferences.additionalArguments[0].slice(20),
    ) =>
      ipcMain.emit(
        "vela-review-ready",
        {
          sender: child.webContents,
          senderFrame: child.webContents.mainFrame,
          ...extra,
        },
        { token },
      ),
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
const fileDisclosure=()=>({files:[{path:'C:\\Synthetic\\sample.mjs',before:'old',after:'new',beforeDigest:'a'.repeat(64),afterDigest:'b'.repeat(64)}]});
const openThree=f=>showVelaReview({parent:f.parent,review:fileDisclosure(),expiresAt:new Date(Date.now()+30000).toISOString(),runtime:f.runtime,experience:'file-edit',decisionMode:'three-way'});

test('selected-source review closes when its backend owner retires', async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=runtime();let current=true;
  const pending=showVelaReview({parent:f.parent,review:disclosure(),intent:'Read selected evidence',
    expiresAt:new Date(Date.now()+30000).toISOString(),runtime:f.runtime,
    experience:'vela-initiated-analysis',isCurrent:()=>current});
  const child=f.children[0];await Promise.resolve();assert.equal(child.shown,true);
  current=false;t.mock.timers.tick(250);
  assert.equal(await pending,false);
  assert.equal(child.destroyed,true);
  assert.equal(f.ipcMain.listenerCount('vela-review-decision'),0);
});

test('selected-source approval requires a trusted gesture in the owned review', async ()=>{
  for(const active of [false,true]){
    const f=runtime();
    const pending=showVelaReview({parent:f.parent,review:disclosure(),intent:'Read selected evidence',
      expiresAt:new Date(Date.now()+30000).toISOString(),runtime:f.runtime,
      experience:'vela-initiated-analysis',isCurrent:()=>true});
    const child=f.children[0];await Promise.resolve();
    child.webContents.mainFrame.executeJavaScript=async()=>active;
    f.decide(child,'approve');
    assert.equal(await pending,active);
  }
});

test('optional three-way review has a genuine No while legacy HTML and boolean semantics remain unchanged',async()=>{
  const review=fileDisclosure();assert(!reviewPage(review,'','file-edit').includes('id="reject"'));
  assert(reviewPage(review,'','file-edit',undefined,'three-way').includes('id="reject" type="button">No</button>'));
  for(const mode of ['boolean',true,{},null])assert.throws(()=>reviewPage(review,'','file-edit',undefined,mode),/invalid_native_review_decision_mode/);
  for(const [decision,expected]of [['approve','yes'],['reject','no'],['cancel','cancel']]){
    const f=runtime(),pending=openThree(f);await Promise.resolve();f.decide(f.children[0],decision);assert.equal(await pending,expected);assert.equal(f.ipcMain.eventNames().length,0);
  }
  const legacy=runtime(),pending=open(legacy);await Promise.resolve();legacy.decide(legacy.children[0],'reject');assert.equal(legacy.children[0].destroyed,false);legacy.decide(legacy.children[0],'approve');assert.equal(await pending,true);
});

test('explicit rejection needs exact child token/frame/readiness and fresh focused Blink activation',async()=>{
  const f=runtime({autoReady:false}),pending=openThree(f),child=f.children[0];await Promise.resolve();f.decide(child,'reject');assert.equal(child.destroyed,false);
  f.preloadReady(child);
  f.decide(child,'reject',{sender:f.parent.webContents});f.decide(child,'reject',{senderFrame:{url:child.url}});
  f.ipcMain.emit('vela-review-decision',{sender:child.webContents,senderFrame:child.webContents.mainFrame},{token:'wrong',decision:'reject'});
  f.ipcMain.emit('vela-review-decision',{sender:child.webContents,senderFrame:child.webContents.mainFrame},{token:child.options.webPreferences.additionalArguments[0].slice(20),decision:'reject',observedGesture:true});
  assert.equal(child.destroyed,false);f.decide(child,'reject');f.decide(child,'approve');assert.equal(await pending,'no');
  const inactive=runtime(),notApproved=openThree(inactive);await Promise.resolve();inactive.children[0].webContents.mainFrame.executeJavaScript=async()=>false;inactive.decide(inactive.children[0],'reject');assert.equal(await notApproved,'cancel');
  for(const fault of ['frame','focus','close']){
    const stale=runtime(),waiting=openThree(stale);await Promise.resolve();const window=stale.children[0];let release;
    window.webContents.mainFrame.executeJavaScript=()=>new Promise(resolve=>{release=resolve;});stale.decide(window,'reject');
    if(fault==='frame')window.webContents.mainFrame={url:window.url};if(fault==='focus')window.isFocused=()=>false;if(fault==='close')window.destroy();release(true);
    assert.equal(await waiting,'cancel',fault);assert.equal(stale.ipcMain.eventNames().length,0);
  }
});

test('three-way expiry during activation cannot become an explicit No',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});const f=runtime(),pending=openThree(f);await Promise.resolve();const child=f.children[0];let release;
  child.webContents.mainFrame.executeJavaScript=()=>new Promise(resolve=>{release=resolve;});f.decide(child,'reject');t.mock.timers.tick(30001);release(true);
  assert.equal(await pending,'cancel');assert.equal(f.ipcMain.eventNames().length,0);
});

test('isolated preload exposes only fixed button decisions; Escape is Cancel and legacy has no No button',()=>{
  const source=readFileSync(new URL('../native/vela-review-preload.cjs',import.meta.url),'utf8');
  const create=withNo=>{const listeners={},sent=[],buttons={};for(const id of ['cancel','approve',...(withNo?['reject']:[])])buttons[id]={addEventListener(_name,handler){this.click=handler;},focus(){}};
    vm.runInNewContext(source,{process:{argv:['--vela-review-token=owned-token']},require:()=>({ipcRenderer:{send:(...packet)=>sent.push(packet)}}),addEventListener:(name,fn)=>{listeners[name]=fn;},document:{getElementById:id=>buttons[id]??null}});listeners.DOMContentLoaded();return {listeners,sent,buttons};};
  const no=create(true);no.buttons.reject.click();no.buttons.approve.click();assert.equal(no.sent.filter(packet=>packet[0]==='vela-review-decision').length,1);assert.equal(no.sent.at(-1)[1].decision,'reject');
  const escape=create(true);let prevented=false;escape.listeners.keydown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(escape.sent.at(-1)[1].decision,'cancel');
  const legacy=create(false);legacy.buttons.cancel.click();assert.equal(legacy.sent.at(-1)[1].decision,'cancel');
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

test("ordinary review reuses the same sandbox, authenticated readiness and child-only decision lifecycle", async () => {
  const f = runtime({ autoReady: false });
  const pending = showVelaReview({ parent: f.parent, review: { providerId: "chatgpt-plan-responses", prompt: '{"input":"Synthetic only"}', promptDigest: "b".repeat(64), context: { included: [] } }, intent: "One ordinary request", expiresAt: new Date(Date.now() + 30000).toISOString(), runtime: f.runtime, experience: "ordinary" });
  const child = f.children[0]; await Promise.resolve();
  assert.equal(child.options.title, "Aerynth · Review sharing");
  assert.equal(child.shown, false);
  const p = child.options.webPreferences;
  assert(p.sandbox && p.contextIsolation && !p.nodeIntegration && !p.devTools);
  const page = decodeURIComponent(child.url.slice("data:text/html;charset=utf-8,".length));
  assert(page.includes("Send to ChatGPT plan?"));
  assert(page.includes("No Aerynth local history included."));
  f.decide(child, "approve"); assert.equal(child.destroyed, false);
  f.preloadReady(child); assert.equal(isOwnedVelaReviewWindow(child, f.parent), true);
  f.decide(child, "approve", { sender: f.parent.webContents }); assert.equal(child.destroyed, false);
  f.decide(child, "cancel"); assert.equal(await pending, false);
  assert.equal(isOwnedVelaReviewWindow(child, f.parent), false);
  assert.equal(f.ipcMain.listenerCount("vela-review-decision"), 0);
});

test("only the owned memory review window can approve a save", async () => {
  const f = runtime();
  const pending = showVelaReview({
    parent: f.parent, runtime: f.runtime, experience: "memory-capture",
    expiresAt: new Date(Date.now() + 30000).toISOString(),
    review: { sourceText: "Synthetic source", enableStorage: false, draft: {
      text: "Synthetic fact", category: "technical", keywords: ["synthetic"],
      scope: { kind: "conversation", id: "synthetic-chat" },
    } },
  });
  const child = f.children[0];
  await Promise.resolve();
  assert.equal(child.options.title, "Aerynth · Review memory");
  assert.equal(isOwnedVelaReviewWindow(child, f.parent), true);
  f.decide(child, "approve", { sender: f.parent.webContents });
  assert.equal(child.destroyed, false);
  f.decide(child, "approve");
  assert.equal(await pending, true);
  assert.equal(f.ipcMain.listenerCount("vela-review-decision"), 0);
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
  assert.equal(f.children.length, 0);
});

test("native ownership requires exact authenticated preload readiness and is revoked at close", async () => {
  const f = runtime({ autoReady: false }),
    pending = open(f),
    child = f.children[0];
  await Promise.resolve();
  assert.equal(child.shown, false);
  assert.equal(isOwnedVelaReviewWindow(child, f.parent), false);
  f.preloadReady(child, { sender: f.parent.webContents });
  f.preloadReady(child, { senderFrame: { url: child.url } });
  f.preloadReady(child, {}, "wrong-token");
  f.decide(child, "approve");
  assert.equal(child.shown, false);
  assert.equal(
    child.destroyed,
    false,
    "readiness and painted UI are required before any decision",
  );
  f.preloadReady(child);
  assert.equal(child.shown, true);
  assert.equal(isOwnedVelaReviewWindow(child, f.parent), true);
  assert.equal(isOwnedVelaReviewWindow(child, {}), false);
  assert.equal(isOwnedVelaReviewWindow({}, f.parent), false);
  f.decide(child, "cancel");
  assert.equal(await pending, false);
  assert.equal(isOwnedVelaReviewWindow(child, f.parent), false);
  assert.equal(f.ipcMain.listenerCount("vela-review-ready"), 0);
  assert.equal(f.ipcMain.listenerCount("vela-review-decision"), 0);
});

test("a missing preload or lost owner cannot show a ready-looking window", async () => {
  const missing = runtime({ autoReady: false }),
    pending = open(missing),
    child = missing.children[0];
  await Promise.resolve();
  child.webContents.emit("preload-error");
  assert.equal(await pending, false);
  assert.equal(child.shown, false);
  assert.equal(isOwnedVelaReviewWindow(child, missing.parent), false);
  const late = runtime({ autoPaint: false }),
    waiting = open(late),
    other = late.children[0];
  await Promise.resolve();
  assert.equal(
    other.shown,
    false,
    "preload readiness alone cannot show before paint",
  );
  late.defocus();
  other.emit("ready-to-show");
  assert.equal(await waiting, false);
  assert.equal(other.shown, false);
});
