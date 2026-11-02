/* Actual native child/input qualification on the integrated desktop parent.
 * Disclosure data is synthetic; no grants, provider ports or model calls. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { BrowserWindow, ipcMain } = require("electron");
const { showVelaReview } = require("./vela-review.cjs");
const {
  consoleErrorHandler,
} = require("../../../block-library/tests/native-console.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex");

exports.verify = async ({
  win,
  app,
  privateRoot,
  source,
  moduleStarted,
  startupErrors,
  call,
}) => {
  const output = path.resolve(
    __dirname,
    "../.runtime/application-evidence/native-review-" + Date.now(),
  );
  const receipt = {
    contract: "aerynth.actual-native-sharing-surface@1",
    source,
    syntheticOnly: true,
    passed: false,
    cases: [],
    errors: [],
    screenshots: [],
    limits: {
      milliseconds: 35000,
      pngs: 2,
      pngBytes: 8388608,
      jsonBytes: 524288,
    },
    scope:
      "Actual integrated desktop parent and released native disclosure/preload; real native Cancel, Escape and synthetic Send once decision, expiry and child close. No backend approval grant, provider connection, inference, user-data mutation or live-assistant claim.",
  };
  const deadline = Date.now() + receipt.limits.milliseconds;
  let owned, listener;
  const budget = () => assert(Date.now() < deadline, "native_review_deadline");
  const foreground = (target) => {
    budget();
    assert(
      target &&
        !target.isDestroyed() &&
        !target.webContents.isDestroyed() &&
        target.isVisible() &&
        !target.isMinimized() &&
        target.isFocused(),
      "native_review_focus_lost",
    );
  };
  const wait = async (predicate, timeout = 3000) => {
    const end = Math.min(deadline, Date.now() + timeout);
    while (Date.now() < end) {
      budget();
      if (await predicate()) return;
      await pause(25);
    }
    throw Error("native_review_wait_timeout");
  };
  const click = async (target, selector) => {
    foreground(target);
    const point = await target.webContents.executeJavaScript(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!r||!r.width||!r.height||e.disabled)throw Error('native_review_control_unavailable');const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('native_review_control_occluded');return{x,y}})()`,
    );
    for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
      foreground(target);
      target.webContents.sendInputEvent({
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
    }
  };
  const review = {
    providerId: "codex-app-server",
    prompt:
      "Synthetic native disclosure. No provider will receive this text.\n" +
      "Exact request inspection and wrapping. ".repeat(300),
    promptDigest: "",
    context: {
      included: [
        {
          id: "synthetic-note",
          kind: "resource",
          title: "Synthetic selected note",
          content: "Native disclosure lifecycle fixture only.",
        },
      ],
      discovered: [
        {
          id: "synthetic-note",
          kind: "resource",
          title: "Synthetic selected note",
        },
        {
          id: "synthetic-task",
          kind: "resource",
          title: "Synthetic metadata-only task",
        },
      ],
    },
    history: {
      messages: [
        { role: "user", content: "Synthetic prior request" },
        {
          role: "assistant",
          providerId: "codex-app-server",
          content: "Synthetic prior provider reply",
        },
      ],
    },
  };
  review.promptDigest = hash(JSON.stringify(review.prompt));
  const beforeListeners = ipcMain.listenerCount("vela-review-decision");
  const beforeWindows = BrowserWindow.getAllWindows()
    .map((value) => value.id)
    .sort();
  const stable = (value) => JSON.stringify(value);
  try {
    assert(
      /^review-native-sharing-/.test(path.basename(privateRoot)),
      "dedicated_synthetic_profile_required",
    );
    assert(Array.isArray(startupErrors));
    assert.deepEqual(startupErrors, []);
    foreground(win);
    await wait(() =>
      win.webContents.executeJavaScript(
        'document.body.dataset.applicationHydrated==="true"',
      ),
    );
    const before = await call("desktop", { type: "snapshot" });
    assert.deepEqual(
      Object.values((await call("snapshot", {})).executions),
      [],
    );
    for (const mode of ["cancel", "escape", "approve", "expiry", "close"]) {
      foreground(win);
      let settled = false,
        result;
      const started = Date.now(),
        expiresAt = new Date(
          Date.now() + (mode === "expiry" ? 1200 : 8000),
        ).toISOString();
      const pending = showVelaReview({
        parent: win,
        review,
        intent: "Synthetic native sharing check — no provider execution",
        expiresAt,
      }).then((value) => {
        settled = true;
        result = value;
        return value;
      });
      await wait(() => {
        owned = BrowserWindow.getAllWindows().find(
          (value) => value.getParentWindow() === win,
        );
        if (settled) throw Error("native_review_closed_before_show");
        return owned?.isVisible() && owned.isFocused();
      });
      listener = consoleErrorHandler(receipt);
      owned.webContents.on("console-message", listener);
      const component = await owned.webContents.executeJavaScript(
        `(()=>{const c=document.querySelector('.content'),f=document.querySelector('footer').getBoundingClientRect();return {title:document.title,body:document.body.scrollWidth,width:innerWidth,height:innerHeight,footerBottom:f.bottom,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,prompt:document.querySelector('details:last-child pre').textContent,bridge:typeof window.aerynthHost,node:typeof require,role:document.querySelector('main').getAttribute('role'),active:document.activeElement.id}})()`,
      );
      assert.equal(component.prompt, review.prompt);
      assert.equal(component.bridge, "undefined");
      assert.equal(component.node, "undefined");
      assert.equal(component.role, "dialog");
      assert.equal(component.active, "cancel");
      assert(component.footerBottom <= component.height + 1);
      assert(component.body <= component.width + 1);
      assert.equal(owned.getParentWindow(), win);
      assert.equal(
        win.isEnabled(),
        false,
        "Modal child disables actual parent",
      );
      const item = {
        mode,
        component: {
          ...component,
          promptBytes: Buffer.byteLength(component.prompt),
          promptSha256: hash(component.prompt),
          prompt: undefined,
        },
      };
      receipt.cases.push(item);
      if (mode === "cancel") {
        await click(owned, "details:last-child summary");
        const png = (await owned.webContents.capturePage()).toPNG();
        assert(png.length <= receipt.limits.pngBytes);
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, "native-disclosure.png"), png, {
          flag: "wx",
        });
        receipt.screenshots.push({
          file: "native-disclosure.png",
          bytes: png.length,
          sha256: hash(png),
          scope:
            "Actual native child Chromium capture; main V3.5 rendering intentionally pauses while modal parent is inactive.",
        });
        await click(owned, "#cancel");
      } else if (mode === "escape") {
        for (const type of ["keyDown", "keyUp"]) {
          foreground(owned);
          owned.webContents.sendInputEvent({ type, keyCode: "Escape" });
        }
      } else if (mode === "approve") await click(owned, "#approve");
      else if (mode === "close") owned.close();
      await wait(() => settled, mode === "expiry" ? 2000 : 1500);
      assert.equal(await pending, mode === "approve");
      item.result = result;
      item.elapsedMs = Date.now() - started;
      assert(owned.isDestroyed());
      owned = undefined;
      listener = undefined;
      assert.equal(
        ipcMain.listenerCount("vela-review-decision"),
        beforeListeners,
        "Native decision listeners released",
      );
      assert.deepEqual(
        BrowserWindow.getAllWindows()
          .map((value) => value.id)
          .sort(),
        beforeWindows,
        "No native review window left",
      );
      // Accept OS restoration after the modal closes; never refocus the app.
      await wait(() => win.isFocused() && win.isEnabled(), 1000);
      foreground(win);
    }
    const after = await call("desktop", { type: "snapshot" });
    for (const key of [
      "projects",
      "workspaces",
      "resources",
      "relationships",
      "blocks",
      "presence",
      "viewport",
      "activeWorkspaceId",
      "navigation",
    ])
      assert.equal(
        stable(after[key]),
        stable(before[key]),
        "No canonical mutation: " + key,
      );
    assert.deepEqual(
      Object.values((await call("snapshot", {})).executions),
      [],
    );
    assert.deepEqual(startupErrors, []);
    assert.deepEqual(receipt.errors, []);
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.stack ?? error).slice(0, 12000);
  } finally {
    if (owned && !owned.isDestroyed()) {
      if (listener)
        owned.webContents.removeListener("console-message", listener);
      owned.destroy();
    }
    receipt.startupErrors = startupErrors;
    receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    await fs.mkdir(output, { recursive: true });
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2));
    assert(bytes.length <= receipt.limits.jsonBytes);
    await fs.writeFile(path.join(output, "native-review.json"), bytes, {
      flag: "wx",
    });
    process.stdout.write(
      JSON.stringify({
        passed: receipt.passed,
        evidence: output,
        error: receipt.error,
      }) + "\n",
    );
    app.exit(receipt.passed ? 0 : 1);
  }
};
