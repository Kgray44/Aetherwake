const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");
const reviewPreload = path.join(__dirname, "vela-review-preload.cjs");
const ownedReviews = new WeakMap();
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
function handoffMatches(preview, review) {
  if (JSON.stringify(preview.handoff) !== JSON.stringify(review.handoff)) return false;
  const handoff = review.handoff;
  if (handoff === undefined) return true;
  const history = review.history;
  const evidence = handoff?.purpose === "reviewed-evidence";
  if (!handoff || typeof handoff.taskId !== 'string' || !/^[a-f0-9-]{36}$/u.test(handoff.taskId) ||
      (evidence ? review.semanticContext !== true : handoff.purpose !== undefined || review.semanticContext === true) ||
      handoff.destinationProviderId !== review.providerId || (!evidence && handoff.sourceProviderId === review.providerId) ||
      !hash(handoff.contextDigest) || handoff.contextDigest !== preview.history?.digest ||
      history?.schemaVersion !== 1 || history.coverage !== "bounded-authorized-whole-messages" ||
      !Array.isArray(history.messages) || history.messages.length !== 2 || Buffer.byteLength(JSON.stringify(history)) > 4096)
    return false;
  const [user, answer] = history.messages;
  if (user?.role !== "user" || user.source !== "user" || user.classification !== "observed" || user.providerId !== undefined ||
      answer?.role !== "assistant" || answer.source !== "provider" || answer.classification !== "reported" ||
      answer.id !== handoff.sourceMessageId || answer.providerId !== handoff.sourceProviderId ||
      !history.messages.every(message => message.requestId === handoff.sourceRequestId &&
        typeof message.content === "string" && digest(message.content) === message.contentDigest))
    return false;
  // This is the sorted JSON history format used by the canonical proof.
  return digest({ coverage: history.coverage, messages: history.messages.map(message =>
    Object.fromEntries(Object.entries(message).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))), schemaVersion: history.schemaVersion }) === handoff.contextDigest;
}
function validateFileEditReview(requestId, review) {
  const rawDigest = (body) => createHash("sha256").update(body, "utf8").digest("hex");
  const files = review?.files;
  if (!review || review.requestId !== requestId ||
      typeof review.reviewId !== "string" || !/^[a-f0-9-]{36}$/.test(review.reviewId) ||
      !(Date.parse(review.expiresAt) > Date.now()) || !Array.isArray(files) || files.length < 1 || files.length > 4 ||
      !files.every(file => file &&
        typeof file.path === "string" && /^[CD]:[\\/]/i.test(file.path) && file.path.length <= 180 &&
        (file.before === null && file.beforeDigest === null ||
          typeof file.before === "string" && Buffer.byteLength(file.before) <= 8192 && rawDigest(file.before) === file.beforeDigest) &&
        typeof file.after === "string" && Buffer.byteLength(file.after) <= 8192 &&
        rawDigest(file.after) === file.afterDigest &&
        file.beforeDigest !== file.afterDigest) ||
      new Set(files.map(file => file.path.toLowerCase())).size !== files.length ||
      ["before", "after"].some(key => files.reduce((sum, file) => sum + Buffer.byteLength(file[key] ?? ""), 0) > 10240))
    throw Error("invalid_vela_edit_review");
  return review;
}
const css = `:root{color-scheme:dark;font:14px/1.5 system-ui,sans-serif;color:#ece9f4;background:#0c0d17}*{box-sizing:border-box}body{margin:0}.review{height:100vh;padding:24px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:16px}.review>*{min-width:0}h1{font-size:22px;font-weight:550;margin:0 0 6px}header p{margin:0;color:#bcb7cb}.intent{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}.content{overflow:auto;min-height:0;scrollbar-gutter:stable}details{margin:8px 0;border:1px solid #c6bce72a;border-radius:12px;background:linear-gradient(145deg,#c5b4ff0c,#c1deff04);overflow:hidden}summary{padding:12px 14px;cursor:pointer;color:#d9d1ed}section{padding:0 14px 14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,Consolas,monospace;margin:8px 0}article+article{border-top:1px solid #c6bce724;margin-top:14px;padding-top:14px}h2{font-size:13px;font-weight:550;color:#c9bfdf;margin:0}footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #c6bce724;padding-top:16px}button{font:inherit;color:inherit;padding:8px 18px;border:1px solid #c6bce744;border-radius:10px;background:#c3b0ff0c;cursor:pointer}button:focus-visible,summary:focus-visible{outline:2px solid #c2a7ff;outline-offset:3px}#approve{background:#b59ae725}small{color:#a8a2ba;overflow-wrap:anywhere}`;

function reviewedStateMatches(preview, review) {
  if (!preview) return review === undefined;
  if (!review) return false;
  const { text, ...reference } = review;
  return JSON.stringify(reference) === JSON.stringify(preview) && typeof text === "string" &&
    !!text.trim() && Buffer.byteLength(text) <= 4096;
}

function projectEvidenceMatches(preview, review) {
  if (!preview || !review) return preview === review;
  const { sources, ...reference } = review;
  return JSON.stringify(reference) === JSON.stringify(preview) && Array.isArray(sources) &&
    sources.length > 0 && sources.length <= 12 &&
    JSON.stringify(sources.map(source => source?.id)) === JSON.stringify(reference.sourceIds) &&
    Buffer.byteLength(JSON.stringify(sources)) <= 16000 &&
    new Set(sources.map(source => source?.id)).size === sources.length &&
    sources.every(source => source && source.projectId === reference.projectId &&
      ["file", "note"].includes(source.resourceKind) && typeof source.content === "string" &&
      Buffer.byteLength(source.content) <= 2048 && digest(source.content) === source.contentDigest) &&
    digest(sources.map(source => [source.id, source.version, source.title, source.resourceKind, source.contentDigest, source.source])) === reference.digest;
}

/** Read-only native disclosure. No renderer receives approval authority. */
function validateReview(preview, review) {
  if (
    !preview ||
    !review ||
    review.previewId !== preview.id ||
    review.signature !== preview.signature ||
    review.providerId !== preview.providerId ||
    review.semanticContext !== preview.semanticContext ||
    !reviewedStateMatches(preview.missionCheckpoint, review.missionCheckpoint) ||
    !reviewedStateMatches(preview.workspaceState, review.workspaceState) ||
    !projectEvidenceMatches(preview.projectEvidence, review.projectEvidence) ||
    ((preview.missionCheckpoint || preview.workspaceState || preview.projectEvidence) && !review.semanticContext) ||
    (review.semanticContext && (review.providerId !== "openai-api-vela" || (!!review.history !== (review.handoff?.purpose === "reviewed-evidence")) ||
      !Array.isArray(review.context?.included) || (!review.context.included.length && !review.missionCheckpoint && !review.workspaceState && !review.projectEvidence && !review.handoff) ||
      review.context.included.some(source => !["note", "file"].includes(source?.resourceKind)))) ||
    (preview.workingDirectory !== undefined && review.workingDirectory !== preview.workingDirectory) ||
    JSON.stringify(review.route) !== JSON.stringify(preview.route) ||
    JSON.stringify(review.routingSettings) !== JSON.stringify(preview.routingSettings) ||
    JSON.stringify(review.routingAgent) !== JSON.stringify(preview.routingAgent) ||
    (review.agentInstructions !== undefined && (!review.routingAgent || typeof review.agentInstructions !== "string" ||
      typeof review.prompt !== "string" || !review.prompt.includes(JSON.stringify(review.agentInstructions)))) ||
    !handoffMatches(preview, review) ||
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
/** Presentation only. Each trusted native caller validates its own exact DTO,
 * body digest, source policy and capacity before opening this read-only pane. */
function presentation(experience) {
  if (!["vela", "ordinary", "codex", "file-edit"].includes(experience))
    throw Error("invalid_native_review_experience");
  if (experience === "file-edit")
    return { title: "Vela · Review file changes", htmlBytes: 524288 };
  if (experience === "codex")
    return {
      title: "Aerynth · Authorize Codex conversation",
      subtitle: "Uses your installed Codex account and native thread context. This review requests a read-only sandbox and denies approval requests.",
      historyLabel: "Conversation context",
      emptyHistory: "Existing thread context stays with Codex.",
      htmlBytes: 2 * 1024 * 1024,
    };
  return experience === "ordinary"
    ? {
        title: "Aerynth · Review sharing",
        subtitle: "One request in this chat. Review exactly what will be shared.",
        historyLabel: "Aerynth local history",
        emptyHistory: "No Aerynth local history included.",
        // Full 256KiB request plus its disclosed sources may expand on escaping.
        htmlBytes: 4 * 1024 * 1024,
      }
    : {
        title: "Vela · Review sharing",
        subtitle: "One provider response. App changes still require review.",
        historyLabel: "Previous messages",
        emptyHistory: "No prior messages included.",
        htmlBytes: 524288,
      };
}
function reviewPage(review, intent = "", experience = "vela", workflow, decisionMode) {
  if(decisionMode!==undefined&&(decisionMode!=='three-way'||experience!=='file-edit'))throw Error('invalid_native_review_decision_mode');
  const view = presentation(experience);
  if (experience === "file-edit") {
    const styleHash = createHash("sha256").update(css).digest("base64");
    const fileEvidence = (body, sha) => {
      const crlf = (body.match(/\r\n/g) ?? []).length;
      const lf = (body.match(/\n/g) ?? []).length - crlf;
      const cr = (body.match(/\r/g) ?? []).length - crlf;
      const bom = body.startsWith("\uFEFF") ? "UTF-8 BOM · " : "";
      return `${Buffer.byteLength(body)} bytes · ${crlf} CRLF · ${lf} LF · ${cr} CR · ${bom}SHA-256 ${escape(sha)}`;
    };
    const files = review.files.map(file => {
      const create = file.before === null;
      const current = create ? "<p>The destination is absent.</p>"
        : `<pre>${escape(file.before)}</pre><small>${fileEvidence(file.before, file.beforeDigest)}</small>`;
      return `<article><h2>${escape(file.path)}</h2><details open><summary>${create ? "Create new file" : "Current file"}</summary><section>${current}</section></details><details open><summary>${create ? "Proposed new contents" : "Proposed replacement"}</summary><section><pre>${escape(file.after)}</pre><small>${fileEvidence(file.after, file.afterDigest)}</small></section></details></article>`;
    }).join("");
    const creates = review.files.some(file => file.before === null);
    const count = review.files.length;
    const changes = creates ? (count === 1 ? "one new file" : count + " file changes")
      : (count === 1 ? "one replacement" : count + " replacements");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><title>${escape(view.title)}</title><style>${css}</style></head><body><main class="review" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><h1 id="review-title">Apply ${changes}?</h1><p>Aerynth keeps backups of replaced files and checks each write. If one fails, the batch stops and shows each file outcome.</p></header><div class="content" tabindex="0" aria-label="Review before and after contents">${files}</div><footer><button id="cancel" type="button" autofocus>Cancel</button>${decisionMode==='three-way'?'<button id="reject" type="button">No</button>':''}<button id="approve" type="button">Apply reviewed files</button></footer></main></body></html>`;
    if (Buffer.byteLength(html) > view.htmlBytes) throw Error("native_vela_review_capacity_exceeded");
    return html;
  }
  const providerLabel = (id) =>
    id === "codex-app-server"
      ? "Codex"
      : id === "chatgpt-plan-responses"
        ? "ChatGPT plan"
        : id;
  const provider = providerLabel(review.providerId);
  const route = review.route;
  const origins = review.routingSettings?.origins;
  const routeSummary = route ? [
    review.handoff?.purpose === "reviewed-evidence" ? "Reviewed exchange from " + providerLabel(review.handoff.sourceProviderId) :
      review.handoff && "Handoff from " + providerLabel(review.handoff.sourceProviderId) + " to " + provider,
    review.routingAgent && "Agent profile " + review.routingAgent.title + " · version " + review.routingAgent.profileVersion,
    route.kind === "file-edit" ? "Read-only Codex proposal. File changes require a separate review." +
      (route.followUpCheck ? " The requested project check also requires a separate review." : "")
      : route.kind === "composite" ? "Native reading shared with Codex in a read-only sandbox"
      : route.kind === "agentic" ? "Local read-only sandbox"
      : route.kind === "conversational" ? route.nativeMetric || route.nativeLog
        ? workflow ? "ChatGPT will analyze the selected evidence. Codex will receive this exchange and the selected file contents."
          : "Share this local evidence for analysis. The Codex step will require its own review."
        : route.depth + " conversation" : "Reviewed app proposal",
    route.model && "Requested model " + route.model + (origins?.model ? " (" + origins.model + ")" : ""),
    route.effort && "Requested effort " + route.effort + (origins?.reasoningEffort ? " (" + origins.reasoningEffort + ")" : ""),
    review.workingDirectory && "Starting directory " + review.workingDirectory,
    review.editPaths?.length && "Selected files " + review.editPaths.join(" · "),
    route.escalation && "One approved deeper attempt on an output limit",
  ].filter(Boolean).join(" · ") : "";
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
        `<article><h2>${escape(source.title ?? source.id ?? "Selected resource")}</h2><small>${source.kind === "resource" && source.id === review.context.activeResourceId ? "Selected card · " : ""}${included.has(sourceKey(source)) ? "Selected excerpt" : "Metadata only"}</small>${included.has(sourceKey(source)) ? `<pre>${escape(included.get(sourceKey(source)).content)}</pre>` : ""}</article>`,
    )
    .join("");
  const history = (review.history?.messages ?? [])
    .map(
      (message) =>
        `<article><h2>${escape(message.role === "user" ? "You" : providerLabel(message.providerId ?? review.providerId))}</h2><pre>${escape(message.content)}</pre></article>`,
    )
    .join("");
  const workflowScope = workflow ? `<details open><summary>Files and test command</summary><section>
    <p>Codex will propose the changes using ${escape(workflow.codex.model)}${workflow.codex.effort ? " · " + escape(workflow.codex.effort) : ""}. Aerynth will apply changes to these files and keep backups of replacements.</p>
    <ul>${workflow.files.map(file => `<li>${file.operation === "create" ? "Create" : "Edit"} <small>${escape(file.path)}</small></li>`).join("")}</ul>
    <p>Then Aerynth will run this check in a read-only sandbox. It requests restricted networking. Effective isolation depends on the installed Windows sandbox mode.</p>
    <small>${escape(workflow.check.cwd)}</small><pre>${escape(workflow.check.argv.map(part => JSON.stringify(part)).join(" "))}</pre>
    </section></details>` : "";
  const historyLabel = review.handoff ? "Selected prior exchange" : view.historyLabel;
  const agentInstructions = review.agentInstructions
    ? `<details open><summary>Additional agent instructions</summary><section><pre>${escape(review.agentInstructions)}</pre></section></details>` : "";
  const semanticDetails = review.missionPlanning
    ? "<p>Vela will investigate these reviewed sources and send checked passages to the mission planner. This uses up to six API calls, including synthetic compatibility checks. You’ll review the proposed tasks before they can start.</p>"
    : review.semanticContext
      ? `<p>Vela will interpret your question and check the selected evidence using this model. The answer uses checked passages. ${review.handoff ? "Only the selected exchange is included from the conversation." : "Conversation history is excluded."} Tools are disabled. This can use up to six API calls, including synthetic compatibility checks.</p>` : "";
  const checkpointDetails = review.missionCheckpoint
    ? `<details open><summary>Mission checkpoint</summary><section><pre>${escape(review.missionCheckpoint.text)}</pre></section></details>` : "";
  const workspaceDetails = review.workspaceState
    ? `<details open><summary>Workspace state</summary><section><p>Placed resource titles and types.</p><pre>${escape(review.workspaceState.text)}</pre></section></details>` : "";
  const projectDetails = review.projectEvidence
    ? `<details open><summary>Project evidence (${review.projectEvidence.sources.length})</summary><section><p>Vela can search these reviewed sources and send matching source text for evidence checking. ${review.projectEvidence.partial ? "Some project sources are outside this review." : ""}</p>${review.projectEvidence.sources.map(source => `<article><h2>${escape(source.title)}</h2><pre>${escape(source.content)}</pre></article>`).join("")}</section></details>` : "";
  const executiveDetails = review.missionExecutive
    ? "<p>Vela will send one request with the mission objective, task states and verification summaries shown below. A suggested revision needs a separate decision before it can take effect.</p>" : "";
  const styleHash = createHash("sha256").update(css).digest("base64");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'"><title>${escape(view.title)}</title><style>${css}</style></head><body><main class="review" role="dialog" aria-modal="true" aria-labelledby="review-title"><header><h1 id="review-title">${workflow ? "Run this workflow?" : review.missionExecutive ? "Review this mission checkpoint?" : "Send to " + escape(provider) + "?"}</h1><p>${workflow ? "Review once to share the selected evidence, make the listed edits, and run the check." : escape(view.subtitle)}</p>${routeSummary ? `<p>${escape(routeSummary)}</p>` : ""}</header><div class="content" tabindex="0" aria-label="Review what will be shared"><p class="intent">${escape(intent)}</p>${agentInstructions}${workflowScope}${semanticDetails}${executiveDetails}${checkpointDetails}${workspaceDetails}${projectDetails}<details${sources ? " open" : ""}><summary>Shared resources (${resources.length})</summary><section>${sources || "No selected source content."}</section></details><details${history ? " open" : ""}><summary>${escape(historyLabel)} (${review.history?.messages.length ?? 0})</summary><section>${history || escape(view.emptyHistory)}</section></details><details${review.missionExecutive ? " open" : ""}><summary>${review.semanticContext ? "Reviewed source envelope" : "Exact provider request"}</summary><section><pre>${escape(review.prompt)}</pre><small>Request digest: ${escape(review.promptDigest)}</small></section></details></div><footer><button id="cancel" type="button" autofocus>Cancel</button><button id="approve" type="button">${workflow ? "Run workflow" : review.missionExecutive ? "Request review" : "Send once"}</button></footer></main></body></html>`;
  if (Buffer.byteLength(html) > view.htmlBytes)
    throw Error(experience === "vela" ? "native_vela_review_capacity_exceeded" : "native_ordinary_review_capacity_exceeded");
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
function ownerCanReview(parent) {
  return ownerAlive(parent) && parent.isVisible() &&
    !parent.isMinimized() && parent.isFocused();
}
/** A finite, parent-owned native approval surface. It has no application bridge,
 * scripts, network access, credentials, grant, canonical writes or provider port. */
async function showVelaReview({ parent, review, intent, expiresAt, runtime, experience = "vela", workflow, decisionMode }) {
  if(decisionMode!==undefined&&(decisionMode!=='three-way'||experience!=='file-edit'))throw Error('invalid_native_review_decision_mode');
  const cancelled=decisionMode==='three-way'?'cancel':false;
  const view = presentation(experience);
  if (!ownerCanReview(parent)) return cancelled;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return cancelled;
  const url =
    "data:text/html;charset=utf-8," +
    encodeURIComponent(reviewPage(review, intent, experience, workflow, decisionMode));
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
    title: view.title,
    minimizable: false,
    webPreferences: {
      preload: reviewPreload,
      additionalArguments: ["--vela-review-token=" + token],
      session: partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  const ownership = {
    parent,
    url,
    preload: reviewPreload,
    ready: false,
    shown: false,
  };
  ownedReviews.set(child, ownership);
  return new Promise((resolve) => {
    let done = false,
      painted = false, decisionChecking=false;
    const listeners = [];
    const listen = (emitter, name, handler) => {
      emitter.on(name, handler);
      listeners.push([emitter, name, handler]);
    };
    const finish = (approved) => {
      if (done) return;
      done = true;
      ownedReviews.delete(child);
      clearTimeout(timer);
      for (const [emitter, name, handler] of listeners)
        emitter.removeListener(name, handler);
      try {
        if (!child.isDestroyed()) child.destroy();
      } catch {
        approved = false;
      }
      resolve(decisionMode==='three-way'?(approved===true?'yes':approved==='no'?'no':'cancel'):approved===true);
    };
    const timer = setTimeout(() => finish(false), Math.min(remaining, 180000));
    timer.unref?.();
    listen(parent, "closed", () => finish(false));
    listen(child, "closed", () => finish(false));
    listen(child, "blur", () => finish(false));
    listen(child.webContents, "render-process-gone", () => finish(false));
    listen(child.webContents, "preload-error", () => finish(false));
    listen(child.webContents, "will-navigate", (event) =>
      event.preventDefault(),
    );
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const validChildEvent = (event, value) =>
      !done &&
      event.sender === child.webContents &&
      event.senderFrame === child.webContents.mainFrame &&
      event.senderFrame.url === url &&
      value?.token === token;
    const focusedChild=()=>{try{return ownerAlive(child)&&child.isFocused()===true;}catch{return false;}};
    const showWhenReady = () => {
      if (done || ownership.shown || !painted || !ownership.ready) return;
      if (!ownerCanReview(parent))
        return finish(false);
      ownership.shown = true;
      try {
        child.show();
      } catch {
        finish(false);
      }
    };
    listen(ipcMain, "vela-review-ready", (event, value) => {
      if (!validChildEvent(event, value)) return;
      ownership.ready = true;
      showWhenReady();
    });
    listen(ipcMain, channel, async (event, value) => {
      if (
        !validChildEvent(event, value) ||
        !ownership.ready ||
        !ownership.shown ||
        !["approve", "cancel",...(decisionMode==='three-way'?["reject"]:[])].includes(value?.decision) ||
        Object.keys(value).sort().join(',')!=='decision,token'
      )
        return;
      if(decisionMode==='three-way'&&value.decision!=='cancel'){
        if(decisionChecking)return;decisionChecking=true;
        let active=false;
        try{active=focusedChild()&&await event.senderFrame.executeJavaScript('navigator.userActivation.isActive && document.hasFocus()',false)===true;}catch{}
        if(!validChildEvent(event,value)||!ownership.ready||!ownership.shown||!ownerAlive(parent)||
          !active||!focusedChild()||Date.now()>=Date.parse(expiresAt))return finish(false);
      }
      finish(
        ownerAlive(parent) && Date.now() < Date.parse(expiresAt)
          ? value.decision==='reject'?'no':value.decision==='approve'
          : false,
      );
    });
    listen(child, "ready-to-show", () => {
      painted = true;
      showWhenReady();
    });
    try {
      child.loadURL(url).catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}
exports.validateReview = validateReview;
exports.projectEvidenceMatches = projectEvidenceMatches;
exports.validateFileEditReview = validateFileEditReview;
exports.reviewPage = reviewPage;
exports.showVelaReview = showVelaReview;
exports.isReviewOwnerAlive = ownerAlive;
/** Private native ownership only. This exposes no token, prompt, grant or IPC capability. */
exports.isOwnedVelaReviewWindow = (child, parent) => {
  try {
    const entry = ownedReviews.get(child);
    return (
      !!entry &&
      entry.parent === parent &&
      entry.preload === reviewPreload &&
      entry.ready === true &&
      entry.shown === true &&
      ownerAlive(parent) &&
      ownerAlive(child) &&
      child.getParentWindow() === parent &&
      child.webContents.getURL() === entry.url
    );
  } catch {
    return false;
  }
};
