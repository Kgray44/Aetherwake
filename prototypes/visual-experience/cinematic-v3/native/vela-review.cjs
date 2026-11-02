const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const digest = (text) =>
  createHash("sha256").update(JSON.stringify(text)).digest("hex");
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const css = `:root{color-scheme:dark;font:14px/1.5 system-ui,sans-serif;color:#ece9f4;background:#0c0d17}*{box-sizing:border-box}body{margin:0}.review{height:100vh;padding:24px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:16px}.review>*{min-width:0}h1{font-size:22px;font-weight:550;margin:0 0 6px}header p{margin:0;color:#bcb7cb}.intent{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}.content{overflow:auto;min-height:0;scrollbar-gutter:stable}details{margin:8px 0;border:1px solid #c6bce72a;border-radius:12px;background:linear-gradient(145deg,#c5b4ff0c,#c1deff04);overflow:hidden}summary{padding:12px 14px;cursor:pointer;color:#d9d1ed}section{padding:0 14px 14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,Consolas,monospace;margin:8px 0}article+article{border-top:1px solid #c6bce724;margin-top:14px;padding-top:14px}h2{font-size:13px;font-weight:550;color:#c9bfdf;margin:0}footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #c6bce724;padding-top:16px}button{font:inherit;color:inherit;padding:8px 18px;border:1px solid #c6bce744;border-radius:10px;background:#c3b0ff0c;cursor:pointer}button:focus-visible,summary:focus-visible{outline:2px solid #c2a7ff;outline-offset:3px}#approve{background:#b59ae725}small{color:#a8a2ba;overflow-wrap:anywhere}`;

/** Read-only native disclosure. No renderer receives approval authority. */
function validateReview(preview, review) {
  if (
    !preview ||
    !review ||
    review.previewId !== preview.id ||
    review.signature !== preview.signature ||
    review.providerId !== preview.providerId ||
    typeof review.prompt !== "string" ||
    !review.prompt.trim() ||
    Buffer.byteLength(review.prompt) > 16384 ||
    !hash(review.promptDigest) ||
    digest(review.prompt) !== review.promptDigest ||
    !hash(review.reviewDigest) ||
    !review.context ||
    !Array.isArray(review.context.included) ||
    !review.context.included.every(
      (source) =>
        source &&
        typeof source.id === "string" &&
        typeof source.kind === "string" &&
        typeof source.title === "string" &&
        typeof source.content === "string",
    ) ||
    (review.context.discovered !== undefined &&
      (!Array.isArray(review.context.discovered) ||
        !review.context.discovered.every(
          (source) =>
            source &&
            typeof source.id === "string" &&
            typeof source.kind === "string" &&
            typeof source.title === "string",
        ))) ||
    (review.history !== undefined &&
      (!Array.isArray(review.history.messages) ||
        review.history.messages.length > 4 ||
        !review.history.messages.every(
          (message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string",
        ))) ||
    Buffer.byteLength(JSON.stringify(review)) > 65536
  )
    throw Error("invalid_native_vela_review");
  return review;
}
function reviewPage(review, intent = "") {
  const provider =
    review.providerId === "codex-app-server" ? "Codex" : review.providerId;
  const sourceKey = (source) => JSON.stringify([source.kind, source.id]);
  const included = new Map(
    review.context.included.map((source) => [sourceKey(source), source]),
  );
  const resources = [...(review.context.discovered ?? review.context.included)];
  for (const source of review.context.included)
    if (
      !resources.some((resource) => sourceKey(resource) === sourceKey(source))
    )
      resources.push(source);
  const sources = resources
    .map(
      (source) =>
        `<article><h2>${escape(source.title ?? source.id ?? "Selected resource")}</h2><small>${included.has(sourceKey(source)) ? "Selected excerpt" : "Metadata only"}</small>${included.has(sourceKey(source)) ? `<pre>${escape(included.get(sourceKey(source)).content)}</pre>` : ""}</article>`,
    )
    .join("");
  const history = (review.history?.messages ?? [])
    .map(
      (message) =>
        `<article><h2>${escape(message.role === "user" ? "You" : message.providerId === "codex-app-server" ? "Codex" : (message.providerId ?? provider))}</h2><pre>${escape(message.content)}</pre></article>`,
    )
    .join("");
  const styleHash = createHash("sha256").update(css).digest("base64");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><title>Vela · Review sharing</title><style>${css}</style></head><body><main class="review" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><h1 id="review-title">Send to ${escape(provider)}?</h1><p>One provider response. App changes still require review.</p></header><div class="content" tabindex="0" aria-label="Review what will be shared"><p class="intent">${escape(intent)}</p><details${sources ? " open" : ""}><summary>Shared resources (${resources.length})</summary><section>${sources || "No selected source content."}</section></details><details${history ? " open" : ""}><summary>Previous messages (${review.history?.messages.length ?? 0})</summary><section>${history || "No prior messages included."}</section></details><details><summary>Exact provider request</summary><section><pre>${escape(review.prompt)}</pre><small>Request digest: ${escape(review.promptDigest)}</small></section></details></div><footer><button id="cancel" type="button" autofocus>Cancel</button><button id="approve" type="button">Send once</button></footer></main></body></html>`;
  if (Buffer.byteLength(html) > 524288)
    throw Error("native_vela_review_capacity_exceeded");
  return html;
}
function ownerAlive(parent) {
  try {
    return (
      !!parent && !parent.isDestroyed() && !parent.webContents.isDestroyed()
    );
  } catch {
    return false;
  }
}
/** A finite, parent-owned native approval surface. It has no application bridge,
 * scripts, network access, credentials, grant, canonical writes or provider port. */
async function showVelaReview({ parent, review, intent, expiresAt, runtime }) {
  if (!ownerAlive(parent)) return false;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return false;
  const url =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(reviewPage(review, intent));
  const { BrowserWindow, ipcMain, session } = runtime ?? require("electron");
  const token = randomUUID(),
    channel = "vela-review-decision",
    partition = session.fromPartition("vela-review:" + token, { cache: false });
  partition.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_request, callback) => callback({ cancel: true }),
  );
  const bounds = parent.getContentBounds();
  const child = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: Math.min(920, bounds.width),
    height: Math.min(720, bounds.height),
    backgroundColor: "#0c0d17",
    autoHideMenuBar: true,
    title: "Vela · Review sharing",
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, "vela-review-preload.cjs"),
      additionalArguments: ["--vela-review-token=" + token],
      session: partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  return new Promise((resolve) => {
    let done = false;
    const listeners = [];
    const listen = (emitter, name, handler) => {
      emitter.on(name, handler);
      listeners.push([emitter, name, handler]);
    };
    const finish = (approved) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const [emitter, name, handler] of listeners)
        emitter.removeListener(name, handler);
      try {
        if (!child.isDestroyed()) child.destroy();
      } catch {
        approved = false;
      }
      resolve(approved);
    };
    const timer = setTimeout(() => finish(false), Math.min(remaining, 180000));
    timer.unref?.();
    listen(parent, "closed", () => finish(false));
    listen(child, "closed", () => finish(false));
    listen(child, "blur", () => finish(false));
    listen(child.webContents, "render-process-gone", () => finish(false));
    listen(child.webContents, "will-navigate", (event) =>
      event.preventDefault(),
    );
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    listen(ipcMain, channel, (event, value) => {
      if (
        done ||
        event.sender !== child.webContents ||
        event.senderFrame !== child.webContents.mainFrame ||
        event.senderFrame.url !== url ||
        value?.token !== token ||
        !["approve", "cancel"].includes(value?.decision)
      )
        return;
      finish(
        value.decision === "approve" &&
          ownerAlive(parent) &&
          Date.now() < Date.parse(expiresAt),
      );
    });
    listen(child, "ready-to-show", () => {
      if (
        !ownerAlive(parent) ||
        !parent.isVisible() ||
        parent.isMinimized() ||
        !parent.isFocused()
      )
        finish(false);
      else child.show();
    });
    try {
      child.loadURL(url).catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}
exports.validateReview = validateReview;
exports.reviewPage = reviewPage;
exports.showVelaReview = showVelaReview;
exports.isReviewOwnerAlive = ownerAlive;
